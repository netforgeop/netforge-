-- ════════════════════════════════════════════════════════════════════
--  netforge_v5.sql — لابی خصوصی (فقط دعوتی) + لاگ مدیریت + تیکت
--                    + کامنت اینستاگرامی (لایک/ریپلای) + فیکس قطعی enum
--
--   ۱) فیکس قطعی باگ تأیید عضویت: ایندکس partial روی status اول حذف می‌شه
--      (همون چیزی بود که تبدیل enum→text توی v4 رو سکوتِ exception می‌بلعید!)
--   ۲) لابی خصوصی: از هر لیست/جایی محو می‌شه مگر برای میزبان و اعضا
--      جوین فقط با «دعوت‌نامه» (اعلان lobby_invite) ممکنه — حتی ادمین هم نمی‌بینه
--   ۳) mod_actions: لاگ همه‌ی حذف‌ها و محدودیت‌ها (کی، چی، چرا) برای
--      «لاگ سایت» پنل ادمین + کارت «اقدامات روی حساب من» توی پروفایل خود کاربر
--   ۴) سیستم تیکت: کاربر با دلیل مشخص برای «ادمین» یا «مدیریت» تیکت می‌زنه،
--      چت دوطرفه + وضعیت (باز/در حال بررسی/حل‌شده) + نوتیف
--   ۵) کامنت‌های اینستاگرامی: ریپلای (parent_id) + لایک کامنت (post_comment_likes)
--
--  هر چند بار اجرا شود امن است (idempotent). بعد از v4 اجرا کن.
-- ════════════════════════════════════════════════════════════════════

-- پیش‌نیاز
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;
create or replace function public.is_moderator_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('admin','moderator'));
$$;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_moderator_or_admin() to authenticated;

-- ───────── ۱) فیکس قطعی enum (نکته: ایندکس partial جلوی تبدیل رو می‌گرفت) ─────────
drop index if exists public.group_join_requests_one_pending;
alter table public.group_join_requests alter column status drop default;
alter table public.group_join_requests alter column status type text using status::text;
alter table public.group_join_requests alter column status set default 'pending';
update public.group_join_requests set status = 'pending' where status is null;
alter table public.group_join_requests drop constraint if exists gjr_status_values;
alter table public.group_join_requests add constraint gjr_status_values
  check (status in ('pending', 'approved', 'rejected'));
create unique index if not exists group_join_requests_one_pending
  on public.group_join_requests (group_id, user_id)
  where status = 'pending';

-- گزارش وضعیت نوع ستون (باید text بگه)
do $$ declare dt text; begin
  select data_type into dt from information_schema.columns
    where table_schema='public' and table_name='group_join_requests' and column_name='status';
  raise notice 'group_join_requests.status type = % (باید text باشد)', dt;
end $$;

-- RPC تأیید/رد (بازنویسی با status متنی)
create or replace function public.review_group_join_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare req record; grp record; caller_groups_role text;
begin
  select * into req from public.group_join_requests where id = p_request_id;
  if req.id is null then raise exception 'درخواست پیدا نشد'; end if;
  if req.status <> 'pending' then raise exception 'این درخواست قبلاً بررسی شده'; end if;

  select * into grp from public.groups where id = req.group_id;
  select role into caller_groups_role from public.group_members
    where group_id = req.group_id and user_id = auth.uid();

  if not (grp.created_by = auth.uid() or caller_groups_role = 'group_admin' or public.is_moderator_or_admin()) then
    raise exception 'فقط مدیر گروه می‌تونه این درخواست رو بررسی کنه';
  end if;

  update public.group_join_requests set status = case when p_approve then 'approved' else 'rejected' end
    where id = p_request_id;

  if p_approve then
    if not exists (select 1 from public.group_members
                   where group_id = req.group_id and user_id = req.user_id) then
      insert into public.group_members (group_id, user_id) values (req.group_id, req.user_id);
    end if;
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (req.user_id, auth.uid(), 'group_accepted',
            'درخواست عضویتت توی گروه «' || coalesce(grp.name,'گروه') || '» قبول شد — خوش اومدی!', req.group_id);
  else
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (req.user_id, auth.uid(), 'group_rejected',
            'درخواست عضویتت توی گروه «' || coalesce(grp.name,'گروه') || '» رد شد', req.group_id);
  end if;
end $$;
grant execute on function public.review_group_join_request(uuid, boolean) to authenticated;

-- ───────── ۲) لابی خصوصی (فقط دعوتی — از هر جایی محو مگر میزبان/اعضا) ─────────
alter table public.game_lobbies add column if not exists is_public boolean not null default true;

-- SELECT: عمومی‌ها برای همه؛ خصوصی‌ها فقط میزبان/اعضا (ادمین هم نمی‌بینه!)
do $$ declare r record; begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='game_lobbies' and cmd='SELECT' and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.game_lobbies', r.policyname);
  end loop;
end $$;
create policy game_lobbies_select_visible on public.game_lobbies
  for select to authenticated using (
    coalesce(is_public, true)
    or host_id = auth.uid()
    or exists (select 1 from public.lobby_members lm
               where lm.lobby_id = game_lobbies.id and lm.user_id = auth.uid())
  );

-- JOIN: عمومی‌ها آزاد؛ خصوصی‌ها فقط با دعوت‌نامه (اعلان lobby_invite)
drop policy if exists lobby_members_join_self on public.lobby_members;
create policy lobby_members_join_self on public.lobby_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.lobby_has_capacity(lobby_id)
    and exists (
      select 1 from public.game_lobbies l
      where l.id = lobby_members.lobby_id
        and (
          coalesce(l.is_public, true)
          or l.host_id = auth.uid()
          or exists (select 1 from public.notifications n
                     where n.user_id = auth.uid()
                       and n.type = 'lobby_invite' and n.target_id = l.id)
        )
    )
  );

-- کامنت‌ها و ریاکشن‌های لابی هم فقط برای کسانی که خود لابی رو می‌بینن
do $$ declare r record; begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='lobby_comments' and cmd='SELECT' and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.lobby_comments', r.policyname);
  end loop;
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='lobby_reactions' and cmd='SELECT' and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.lobby_reactions', r.policyname);
  end loop;
end $$;
create policy lobby_comments_select_visible on public.lobby_comments
  for select to authenticated using (
    exists (select 1 from public.game_lobbies l
            where l.id = lobby_comments.lobby_id
              and (coalesce(l.is_public, true) or l.host_id = auth.uid()))
    or exists (select 1 from public.lobby_members lm
               where lm.lobby_id = lobby_comments.lobby_id and lm.user_id = auth.uid())
  );
create policy lobby_reactions_select_visible on public.lobby_reactions
  for select to authenticated using (
    exists (select 1 from public.game_lobbies l
            where l.id = lobby_reactions.lobby_id
              and (coalesce(l.is_public, true) or l.host_id = auth.uid()))
    or exists (select 1 from public.lobby_members lm
               where lm.lobby_id = lobby_reactions.lobby_id and lm.user_id = auth.uid())
  );

-- ───────── ۳) لاگ اقدامات مدیریتی (۲و‌ل‌ا‌گ سایت) ─────────
create table if not exists public.mod_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,           -- delete_post, delete_comment, delete_lobby_comment, delete_message, delete_group, delete_lobby, ban, mute, timeout
  target_type text,
  target_id uuid,
  target_user_id uuid references public.users(id) on delete set null,
  reason text not null default '',
  snapshot text,                  -- خلاصه‌ای از محتوای پاک‌شده/هدف
  created_at timestamptz not null default now()
);
grant select, insert on public.mod_actions to authenticated;
alter table public.mod_actions enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='mod_actions' loop
    execute format('drop policy %I on public.mod_actions', r.policyname);
  end loop;
end $$;
-- مدیران همه رو می‌بینن؛ هر کاربر هم فقط اقدامات انجام‌شده روی «حساب خودش» رو می‌بینه
create policy mod_actions_select on public.mod_actions
  for select to authenticated using (
    public.is_moderator_or_admin() or target_user_id = auth.uid()
  );
create policy mod_actions_insert_staff on public.mod_actions
  for insert to authenticated with check (
    public.is_moderator_or_admin() and actor_id = auth.uid()
  );

-- ───────── ۴) سیستم تیکت (ارتباط با ادمین/مدیریت) ─────────
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  audience text not null default 'admin' check (audience in ('admin', 'mods')),
  subject text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null
);
create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.tickets to authenticated;
grant select, insert on public.ticket_messages to authenticated;

alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='tickets' loop
    execute format('drop policy %I on public.tickets', r.policyname);
  end loop;
  for r in select policyname from pg_policies where schemaname='public' and tablename='ticket_messages' loop
    execute format('drop policy %I on public.ticket_messages', r.policyname);
  end loop;
end $$;

-- تیکت: خود کاربر + مدیران می‌بینن (ادمین همه، ناظم فقط audience=mods)
create policy tickets_select on public.tickets
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or (audience = 'mods' and public.is_moderator_or_admin())
  );
create policy tickets_insert_self on public.tickets
  for insert to authenticated with check (user_id = auth.uid());
-- فقط مدیران وضعیت رو عوض می‌کنن
create policy tickets_update_staff on public.tickets
  for update to authenticated
  using (public.is_moderator_or_admin())
  with check (public.is_moderator_or_admin());

create policy ticket_messages_select on public.ticket_messages
  for select to authenticated using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id
        and (t.user_id = auth.uid()
             or public.is_admin()
             or (t.audience = 'mods' and public.is_moderator_or_admin()))
    )
  );
create policy ticket_messages_insert on public.ticket_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id
        and (t.user_id = auth.uid()
             or public.is_admin()
             or (t.audience = 'mods' and public.is_moderator_or_admin()))
        and t.status <> 'resolved'
    )
  );

-- نوتیف: تیکت جدید → مدیران هدف
create or replace function public.notify_new_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; sender_name text;
begin
  select nickname into sender_name from public.users where id = NEW.user_id;
  for r in select id from public.users
           where (case when NEW.audience = 'mods' then role in ('admin','moderator') else role = 'admin' end)
             and id <> NEW.user_id loop
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (r.id, NEW.user_id, 'ticket_new',
            coalesce(sender_name,'کاربر') || ' یه تیکت جدید زده: «' || left(NEW.subject, 50) || '»', NEW.id);
  end loop;
  return NEW;
end $$;
drop trigger if exists trg_notify_new_ticket on public.tickets;
create trigger trg_notify_new_ticket after insert on public.tickets
  for each row execute function public.notify_new_ticket();

-- نوتیف: پاسخ تیکت → طرف مقابل
create or replace function public.notify_ticket_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare tk record; r record; sender_name text; sender_is_staff boolean;
begin
  select * into tk from public.tickets where id = NEW.ticket_id;
  if tk.id is null then return NEW; end if;
  select nickname into sender_name from public.users where id = NEW.sender_id;
  sender_is_staff := coalesce(public.is_moderator_or_admin(), false);

  if NEW.sender_id = tk.user_id then
    -- صاحب تیکت پاسخ داده → به مدیران هدف خبر بده
    for r in select id from public.users
             where (case when tk.audience = 'mods' then role in ('admin','moderator') else role = 'admin' end)
               and id <> NEW.sender_id loop
      insert into public.notifications (user_id, sender_id, type, message, target_id)
      values (r.id, NEW.sender_id, 'ticket_reply',
              coalesce(sender_name,'کاربر') || ' توی تیکت «' || left(tk.subject, 40) || '» پاسخ داد', tk.id);
    end loop;
  else
    -- مدیر پاسخ داده → به صاحب تیکت خبر بده
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (tk.user_id, NEW.sender_id, 'ticket_reply',
            coalesce(sender_name,'مدیریت') || ' به تیکتت «' || left(tk.subject, 40) || '» پاسخ داد', tk.id);
  end if;
  -- آپدیت زمان آخرین فعالیت تیکت
  update public.tickets set updated_at = now() where id = tk.id;
  return NEW;
end $$;
drop trigger if exists trg_notify_ticket_reply on public.ticket_messages;
create trigger trg_notify_ticket_reply after insert on public.ticket_messages
  for each row execute function public.notify_ticket_reply();

-- ───────── ۵) کامنت اینستاگرامی: ریپلای + لایک کامنت ─────────
alter table public.post_comments add column if not exists parent_id uuid
  references public.post_comments(id) on delete cascade;

create table if not exists public.post_comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
grant select, insert, delete on public.post_comment_likes to authenticated;
alter table public.post_comment_likes enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='post_comment_likes' loop
    execute format('drop policy %I on public.post_comment_likes', r.policyname);
  end loop;
end $$;
create policy pcl_select on public.post_comment_likes
  for select to authenticated using (true);
create policy pcl_insert_self on public.post_comment_likes
  for insert to authenticated with check (user_id = auth.uid());
create policy pcl_delete_self on public.post_comment_likes
  for delete to authenticated using (user_id = auth.uid());

-- نوتیف: لایک کامنت → نویسنده‌ی کامنت
create or replace function public.notify_comment_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; liker_name text;
begin
  select * into c from public.post_comments where id = NEW.comment_id;
  if c.id is null or c.author_id = NEW.user_id then return NEW; end if;
  select nickname into liker_name from public.users where id = NEW.user_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (c.author_id, NEW.user_id, 'comment_like',
          coalesce(liker_name,'کاربر') || ' کامنتت رو پسندید', c.post_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_comment_like on public.post_comment_likes;
create trigger trg_notify_comment_like after insert on public.post_comment_likes
  for each row execute function public.notify_comment_like();

-- نوتیف: ریپلای کامنت → نویسنده‌ی کامنت مادر (اگر با نویسنده‌ی پست فرق داره که دوبل نشه)
create or replace function public.notify_comment_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent record; p_author uuid; replier_name text;
begin
  if NEW.parent_id is null then return NEW; end if;
  select * into parent from public.post_comments where id = NEW.parent_id;
  if parent.id is null or parent.author_id = NEW.author_id then return NEW; end if;
  select author_id into p_author from public.posts where id = NEW.post_id;
  if parent.author_id = p_author then return NEW; end if; -- نویسنده‌ی پست از تریگر post_comment نوتیف می‌گیره
  select nickname into replier_name from public.users where id = NEW.author_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (parent.author_id, NEW.author_id, 'comment_reply',
          coalesce(replier_name,'کاربر') || ' به کامنتت پاسخ داد: «' || left(coalesce(NEW.content,''), 50) || '»', NEW.post_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_comment_reply on public.post_comments;
create trigger trg_notify_comment_reply after insert on public.post_comments
  for each row execute function public.notify_comment_reply();

-- ───────── انواع اعلان جدید ─────────
do $$ begin
  alter table public.notifications drop constraint if exists notifications_type_check;
exception when undefined_object then null;
end $$;
do $$ begin
  alter table public.notifications add constraint notifications_type_check
    check (type in (
      'follow_request', 'follow_accept', 'new_follower', 'lobby_invite',
      'new_post', 'post_comment', 'post_reaction', 'post_rating',
      'group_message', 'lobby_message', 'invite_ready',
      'group_invite', 'group_join_request', 'group_accepted', 'group_rejected',
      'comment_like', 'comment_reply', 'ticket_new', 'ticket_reply'
    ));
exception when others then raise notice 'notifications_type_check skipped: %', sqlerrm;
end $$;

-- ───────── Realtime برای جدول‌های جدید ─────────
do $$
declare t text;
        tables text[] := array['mod_actions', 'tickets', 'ticket_messages', 'post_comment_likes'];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ───────── گزارش پایانی ─────────
do $$ begin
  raise notice 'NetForge v5 ready: private invite-only lobbies + mod action logs + tickets + instagram comments (likes/replies) + enum FIXED for good';
end $$;
