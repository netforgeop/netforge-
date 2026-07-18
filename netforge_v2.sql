-- ════════════════════════════════════════════════════════════════════
--  netforge_v2.sql — موتور نوتیفیکیشن + قبولی فوری + قدرت کامل ادمین
--
--   ۱) نوتیف برای هر اتفاق مهم (تریگر دیتابیسی — قابل اعتماد از هر کلاینت):
--      پست جدید فالووشده‌ها · کامنت زیر پست · ریاکشن پست · امتیاز ستاره‌ای
--      پیام چت گروه · پیام چت لابی · فالو جدید · قبول فالو (legacy)
--   ۲) قبولی فوری: فالو = بلافاصله accepted · عضویت گروه بدون تأیید
--      درخواست کد دعوت = ساخت خودکار کد در لحظه (سقف: روزی یک کد)
--   ۳) ادمین: آپدیت پروفایل هر کاربر + ریست رمز (auth.users) + تغییر نیک‌نیم
--      با سینک ایمیل داخلی → «برگردوندن حساب» بدون نیاز به ایمیل
--   ۴) بلاک واقعی: پالیسی‌های user_blocks (فیلتر سمت کلاینت)
--   ۵) حذف‌ها: کامنت لابی (خودی/مدیر)، لغوی ریاکشن لابی، ترک/کیک گروه
--
--  هر چند بار اجرا شود امن است (idempotent).
-- ════════════════════════════════════════════════════════════════════

-- ───────── ۰) پیش‌نیاز: توابع نقش (اگر moderation_setup اجرا نشده باشه) ─────────
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

-- ───────── ۱) انواع نوتیفیکیشن جدید در چک‌کانسترینت ─────────
do $$ begin
  alter table public.notifications drop constraint if exists notifications_type_check;
exception when undefined_object then null;
end $$;
do $$ begin
  alter table public.notifications add constraint notifications_type_check
    check (type in (
      'follow_request', 'follow_accept', 'new_follower', 'lobby_invite',
      'new_post', 'post_comment', 'post_reaction', 'post_rating',
      'group_message', 'lobby_message', 'invite_ready'
    ));
exception when others then raise notice 'notifications_type_check skipped: %', sqlerrm;
end $$;

-- ───────── ۲) تریگرهای نوتیفیکیشن ─────────

-- ۲.الف) پست جدید → همه‌ی فالوورهای accepted نویسنده
create or replace function public.notify_new_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; author_name text;
begin
  select nickname into author_name from public.users where id = NEW.author_id;
  for r in select follower_id from public.follows
           where following_id = NEW.author_id and status = 'accepted' loop
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (r.follower_id, NEW.author_id, 'new_post',
            coalesce(author_name,'کاربر') || ' پست جدید گذاشت', NEW.id);
  end loop;
  return NEW;
end $$;
drop trigger if exists trg_notify_new_post on public.posts;
create trigger trg_notify_new_post after insert on public.posts
  for each row execute function public.notify_new_post();

-- ۲.ب) کامنت زیر پست → نویسنده‌ی پست
create or replace function public.notify_post_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare post_author uuid; commenter_name text;
begin
  select author_id into post_author from public.posts where id = NEW.post_id;
  if post_author is null or post_author = NEW.author_id then return NEW; end if;
  select nickname into commenter_name from public.users where id = NEW.author_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (post_author, NEW.author_id, 'post_comment',
          coalesce(commenter_name,'کاربر') || ' زیر پستت کامنت گذاشت: «' ||
          left(coalesce(NEW.content,''), 60) || '»', NEW.post_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_post_comment on public.post_comments;
create trigger trg_notify_post_comment after insert on public.post_comments
  for each row execute function public.notify_post_comment();

-- ۲.ج) ریاکشن پست → نویسنده‌ی پست
create or replace function public.notify_post_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare post_author uuid; reactor_name text;
begin
  select author_id into post_author from public.posts where id = NEW.post_id;
  if post_author is null or post_author = NEW.user_id then return NEW; end if;
  select nickname into reactor_name from public.users where id = NEW.user_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (post_author, NEW.user_id, 'post_reaction',
          coalesce(reactor_name,'کاربر') || ' به پستت واکنش داد', NEW.post_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_post_reaction on public.post_reactions;
create trigger trg_notify_post_reaction after insert on public.post_reactions
  for each row execute function public.notify_post_reaction();

-- ۲.د) امتیاز ستاره‌ای → نویسنده‌ی پست
create or replace function public.notify_post_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare post_author uuid; rater_name text;
begin
  select author_id into post_author from public.posts where id = NEW.post_id;
  if post_author is null or post_author = NEW.user_id then return NEW; end if;
  select nickname into rater_name from public.users where id = NEW.user_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (post_author, NEW.user_id, 'post_rating',
          coalesce(rater_name,'کاربر') || ' به پستت ' || NEW.score || ' از ۱۰ امتیاز داد', NEW.post_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_post_rating on public.post_ratings;
create trigger trg_notify_post_rating after insert on public.post_ratings
  for each row execute function public.notify_post_rating();

-- ۲.ه) پیام چت گروه/لابی → همه‌ی اعضا به‌جز فرستنده
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; sender_name text; room_name text;
begin
  select nickname into sender_name from public.users where id = NEW.sender_id;
  if NEW.target_type = 'group' then
    select name into room_name from public.groups where id = NEW.target_id;
    for r in select user_id from public.group_members
             where group_id = NEW.target_id and user_id <> NEW.sender_id loop
      insert into public.notifications (user_id, sender_id, type, message, target_id)
      values (r.user_id, NEW.sender_id, 'group_message',
              coalesce(sender_name,'کاربر') || ' توی گروه «' || coalesce(room_name,'گروه') || '» پیام داد', NEW.target_id);
    end loop;
  elsif NEW.target_type = 'lobby' then
    select game_name into room_name from public.game_lobbies where id = NEW.target_id;
    for r in select user_id from public.lobby_members
             where lobby_id = NEW.target_id and user_id <> NEW.sender_id loop
      insert into public.notifications (user_id, sender_id, type, message, target_id)
      values (r.user_id, NEW.sender_id, 'lobby_message',
              coalesce(sender_name,'کاربر') || ' توی لابی «' || coalesce(room_name,'لابی') || '» پیام داد', NEW.target_id);
    end loop;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_notify_new_message on public.messages;
create trigger trg_notify_new_message after insert on public.messages
  for each row execute function public.notify_new_message();

-- ۲.و) فالو: درج accepted (فوری) → new_follower ؛ آپدیت pending→accepted → follow_accept
create or replace function public.notify_follow_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare follower_name text;
begin
  if NEW.status = 'accepted' then
    if NEW.follower_id = NEW.following_id then return NEW; end if;
    select nickname into follower_name from public.users where id = NEW.follower_id;
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (NEW.following_id, NEW.follower_id, 'new_follower',
            coalesce(follower_name,'کاربر') || ' حالا فالووت می‌کنه', NEW.follower_id);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_notify_follow_insert on public.follows;
create trigger trg_notify_follow_insert after insert on public.follows
  for each row execute function public.notify_follow_insert();

create or replace function public.notify_follow_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare accepter_name text;
begin
  if NEW.status = 'accepted' and OLD.status is distinct from NEW.status then
    select nickname into accepter_name from public.users where id = NEW.following_id;
    insert into public.notifications (user_id, sender_id, type, message, target_id)
    values (NEW.follower_id, NEW.following_id, 'follow_accept',
            coalesce(accepter_name,'کاربر') || ' درخواست فالوت رو قبول کرد', NEW.following_id);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_notify_follow_accept on public.follows;
create trigger trg_notify_follow_accept after update on public.follows
  for each row execute function public.notify_follow_accept();

-- ۲.ز) درخواست کد دعوت → ساخت خودکار کد در لحظه (قبولی فوری)
create or replace function public.auto_approve_invite_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; code text; new_code_id uuid; tries int := 0;
begin
  -- سقف مصرف: هر کاربر حداکثر یک کد در ۲۴ ساعت
  if exists (
    select 1 from public.invite_requests
    where requested_by = NEW.requested_by and id <> NEW.id
      and status = 'approved' and requested_at > now() - interval '24 hours'
  ) then
    raise exception 'هر ۲۴ ساعت فقط یک کد دعوت می‌تونی بگیری ⏳';
  end if;

  select lower(regexp_replace(coalesce(nickname,'vip'), '[^A-Za-z0-9]', '', 'g'))
    into base from public.users where id = NEW.requested_by;
  if coalesce(base, '') = '' then base := 'vip'; end if;

  loop
    code := upper(base) || '-' || upper(substr(md5(random()::text), 1, 4));
    begin
      insert into public.invite_codes (code, max_uses, is_active, created_by)
      values (code, 3, true, NEW.requested_by)
      returning id into new_code_id;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 10 then raise; end if;
    end;
  end loop;

  update public.invite_requests
    set status = 'approved', resulting_invite_code_id = new_code_id,
        reviewed_at = now()
    where id = NEW.id;

  insert into public.notifications (user_id, sender_id, type, message)
  values (NEW.requested_by, NEW.requested_by, 'invite_ready',
          'کد دعوتت ساخته شد — توی پروفایلت قابل مشاهده و کپی است');
  return NEW;
end $$;
drop trigger if exists trg_auto_approve_invite on public.invite_requests;
create trigger trg_auto_approve_invite after insert on public.invite_requests
  for each row execute function public.auto_approve_invite_request();

-- ───────── ۳) قدرت کامل ادمین ─────────

-- ۳.الف) ادمین بتونه ردیف public.users هر کسی رو آپدیت کنه (بیو/آواتار/نقش/تم/...)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='users_admin_update') then
    create policy users_admin_update on public.users
      for update to authenticated using (public.is_admin());
  end if;
end $$;

-- ۳.ب) ریست رمز هر کاربر توسط ادمین (چون ایمیل واقعی وصل نیست، این تنها راه «برگردوندن حساب» است)
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'فقط ادمین'; end if;
  if char_length(coalesce(p_new_password,'')) < 6 then
    raise exception 'رمز باید حداقل ۶ کاراکتر باشد';
  end if;
  update auth.users
    set encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    where id = p_user_id;
  if not found then raise exception 'کاربر پیدا نشد'; end if;
end $$;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;

-- ۳.ج) تغییر نیک‌نیم توسط ادمین + سینک ایمیل داخلی و متادیتا (وگرنه لاگین طرف می‌شکنه)
create or replace function public.admin_update_nickname(p_user_id uuid, p_new_nickname text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare new_nick text := btrim(p_new_nickname);
        old_email text; suffix text;
begin
  if not public.is_admin() then raise exception 'فقط ادمین'; end if;
  if char_length(new_nick) < 2 or char_length(new_nick) > 24 then
    raise exception 'نیک‌نیم باید بین ۲ تا ۲۴ کاراکتر باشد';
  end if;
  if exists (select 1 from public.users where nickname = new_nick and id <> p_user_id) then
    raise exception 'این نیک‌نیم قبلاً گرفته شده';
  end if;

  update public.users set nickname = new_nick where id = p_user_id;

  select email into old_email from auth.users where id = p_user_id;
  if old_email ~ '^[^@]+-[0-9a-fA-F]{8}@internal\.local$' then
    suffix := substring(old_email from '(-[0-9a-fA-F]{8})@internal\.local$');
    update auth.users
      set email = new_nick || suffix || '@internal.local',
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                               || jsonb_build_object('nickname', new_nick)
      where id = p_user_id;
  else
    update auth.users
      set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                               || jsonb_build_object('nickname', new_nick)
      where id = p_user_id;
  end if;
end $$;
grant execute on function public.admin_update_nickname(uuid, text) to authenticated;

-- ───────── ۴) بلاک واقعی (user_blocks) ─────────
create table if not exists public.user_blocks (
  id uuid default gen_random_uuid() primary key,
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (blocker_id, blocked_id)
);
grant select, insert, delete on public.user_blocks to authenticated;
alter table public.user_blocks enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='user_blocks' loop
    execute format('drop policy %I on public.user_blocks', r.policyname);
  end loop;
end $$;
create policy user_blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid() or blocked_id = auth.uid());
create policy user_blocks_insert on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy user_blocks_delete on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ───────── ۵) عضویت فوری گروه + ترک/کیک ─────────
grant select, insert, delete on public.group_members to authenticated;
alter table public.group_members enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='group_members' loop
    execute format('drop policy %I on public.group_members', r.policyname);
  end loop;
end $$;
create policy group_members_select_all on public.group_members
  for select to authenticated using (true);
create policy group_members_join_self on public.group_members
  for insert to authenticated with check (user_id = auth.uid());
create policy group_members_leave_or_kick on public.group_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_members.group_id and g.created_by = auth.uid())
  );

-- ───────── ۶) حذف کامنت لابی (خودی/مدیر) + لغوی ریاکشن لابی ─────────
grant delete on public.lobby_comments to authenticated;
grant delete on public.lobby_reactions to authenticated;
drop policy if exists lobby_comments_delete_own_or_staff on public.lobby_comments;
create policy lobby_comments_delete_own_or_staff on public.lobby_comments
  for delete to authenticated using (author_id = auth.uid() or public.is_moderator_or_admin());
drop policy if exists lobby_reactions_delete_own on public.lobby_reactions;
create policy lobby_reactions_delete_own on public.lobby_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ───────── گزارش پایانی ─────────
do $$ begin
  raise notice 'NetForge v2 ready: notification triggers + instant accepts + admin powers + blocks + member deletes';
end $$;
