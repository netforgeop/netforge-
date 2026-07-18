-- ════════════════════════════════════════════════════════════════════
--  netforge_v3.sql — گروه عمومی/خصوصی + تنظیمات گروه و لابی
--                    + سیستم دعوت (لابی/گروه) + فعال‌سازی Realtime
--
--   ۱) گروه‌ها دو نوع می‌شن: عمومی (عضویت فوری) / خصوصی (نیاز به تأیید مدیر)
--   ۲) سازنده‌ی گروه/میزبان لابی: ویرایش اسم، توضیح، ظرفیت و... + حذف کامل
--   ۳) درخواست عضویت گروه خصوصی → اعلان به سازنده + تأیید/رد با RPC
--   ۴) دعوت به لابی/گروه از بین فالوورها (اعلان group_invite + لینک درست)
--   ۵) Realtime: جدول‌ها به publication سوپابیس اضافه می‌شن تا پیام/کامنت/
--      اعلان «بدون رفرش» زنده بیان (قبلاً فقط کد کلاینت بود، سرور خاموش بود!)
--   ۶) حریم خصوصی: پیام‌های گروه خصوصی فقط برای اعضا دیده می‌شه (RLS)
--
--  هر چند بار اجرا شود امن است (idempotent). اول qa_fixes بعد v2 بعد این.
-- ════════════════════════════════════════════════════════════════════

-- ───────── ۰) پیش‌نیاز (اگر فایل‌های قبلی اجرا نشده باشن) ─────────
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

-- ════════════════════════════════════════════════════════════════
--  ۱) گروه عمومی/خصوصی
-- ════════════════════════════════════════════════════════════════
alter table public.groups add column if not exists is_public boolean not null default true;

grant update, delete on public.groups to authenticated;

-- سازنده‌ی گروه یا مدیران پلتفرم: ویرایش و حذف
do $$ declare r record; begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='groups' and cmd in ('UPDATE','DELETE') and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.groups', r.policyname);
  end loop;
end $$;

create policy groups_update_owner_or_staff on public.groups
  for update to authenticated
  using (created_by = auth.uid() or public.is_moderator_or_admin())
  with check (created_by = auth.uid() or public.is_moderator_or_admin());

create policy groups_delete_owner_or_staff on public.groups
  for delete to authenticated
  using (created_by = auth.uid() or public.is_moderator_or_admin());

-- ════════════════════════════════════════════════════════════════
--  ۲) عضویت: عمومی = فوری · خصوصی = فقط با تأیید (از طریق RPC امن)
--     پالیسی‌های group_members بازسازی می‌شن
-- ════════════════════════════════════════════════════════════════
grant select, insert, delete on public.group_members to authenticated;
alter table public.group_members enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='group_members' loop
    execute format('drop policy %I on public.group_members', r.policyname);
  end loop;
end $$;

create policy group_members_select_all on public.group_members
  for select to authenticated using (true);

-- عضویت مستقیم فقط برای گروه‌های «عمومی» (خصوصی‌ها از مسیر درخواست+RPC میان)
create policy group_members_join_self on public.group_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.groups g
      where g.id = group_members.group_id
        and (g.is_public or g.created_by = auth.uid())
    )
    or public.is_moderator_or_admin()
  );

create policy group_members_leave_or_kick on public.group_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_members.group_id and g.created_by = auth.uid())
    or public.is_moderator_or_admin()
  );

-- ════════════════════════════════════════════════════════════════
--  ۳) درخواست عضویت گروه: پالیسی‌ها + اعلان به سازنده + RPC تأیید/رد
-- ════════════════════════════════════════════════════════════════
grant select, insert, update, delete on public.group_join_requests to authenticated;
alter table public.group_join_requests enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='group_join_requests' loop
    execute format('drop policy %I on public.group_join_requests', r.policyname);
  end loop;
end $$;

create policy gjr_select_involved on public.group_join_requests
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_join_requests.group_id and g.created_by = auth.uid())
    or public.is_moderator_or_admin()
  );

-- درخواست دادن: فقط برای خودت و فقط اگر عضو نیستی
create policy gjr_insert_self on public.group_join_requests
  for insert to authenticated with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.group_members gm
      where gm.group_id = group_join_requests.group_id and gm.user_id = auth.uid()
    )
  );

create policy gjr_delete_own_or_admin on public.group_join_requests
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_join_requests.group_id and g.created_by = auth.uid())
    or public.is_moderator_or_admin()
  );

-- اعلان به سازنده‌ی گروه وقتی کسی درخواست عضویت می‌ده
create or replace function public.notify_group_join_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner_id uuid; grp_name text; req_name text;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  select created_by, name into owner_id, grp_name from public.groups where id = NEW.group_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select nickname into req_name from public.users where id = NEW.user_id;
  insert into public.notifications (user_id, sender_id, type, message, target_id)
  values (owner_id, NEW.user_id, 'group_join_request',
          coalesce(req_name,'کاربر') || ' می‌خواد عضو گروه «' || coalesce(grp_name,'گروه') || '» بشه', NEW.group_id);
  return NEW;
end $$;
drop trigger if exists trg_notify_group_join_request on public.group_join_requests;
create trigger trg_notify_group_join_request after insert on public.group_join_requests
  for each row execute function public.notify_group_join_request();

-- تأیید/رد توسط سازنده یا مدیر گروه (SECURITY DEFINER: عضو کردن طرف بدون RLSِ عمومی)
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

-- ════════════════════════════════════════════════════════════════
--  ۴) انواع اعلان جدید در چک‌کانسترینت
-- ════════════════════════════════════════════════════════════════
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
      'group_invite', 'group_join_request', 'group_accepted', 'group_rejected'
    ));
exception when others then raise notice 'notifications_type_check skipped: %', sqlerrm;
end $$;

-- ════════════════════════════════════════════════════════════════
--  ۵) لابی: ویرایش/حذف توسط میزبان یا مدیر پلتفرم
-- ════════════════════════════════════════════════════════════════
grant update, delete on public.game_lobbies to authenticated;
do $$ declare r record; begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='game_lobbies' and cmd in ('UPDATE','DELETE') and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.game_lobbies', r.policyname);
  end loop;
end $$;

create policy game_lobbies_update_host_or_staff on public.game_lobbies
  for update to authenticated
  using (host_id = auth.uid() or public.is_moderator_or_admin())
  with check (host_id = auth.uid() or public.is_moderator_or_admin());

create policy game_lobbies_delete_host_or_staff on public.game_lobbies
  for delete to authenticated
  using (host_id = auth.uid() or public.is_moderator_or_admin());

-- ════════════════════════════════════════════════════════════════
--  ۶) حذف کامل گروه / لابی با همه‌ی وابسته‌هاشون (RPC امن)
-- ════════════════════════════════════════════════════════════════
create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (exists (select 1 from public.groups where id = p_group_id and created_by = auth.uid())
          or public.is_moderator_or_admin()) then
    raise exception 'فقط سازنده‌ی گروه یا مدیر می‌تونه گروه رو حذف کنه';
  end if;
  delete from public.messages where target_type = 'group' and target_id = p_group_id;
  delete from public.notifications where target_id = p_group_id
    and type in ('group_message','group_invite','group_join_request','group_accepted','group_rejected');
  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_members where group_id = p_group_id;
  delete from public.groups where id = p_group_id;
end $$;
grant execute on function public.delete_group(uuid) to authenticated;

create or replace function public.delete_lobby(p_lobby_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (exists (select 1 from public.game_lobbies where id = p_lobby_id and host_id = auth.uid())
          or public.is_moderator_or_admin()) then
    raise exception 'فقط میزبان لابی یا مدیر می‌تونه لابی رو حذف کنه';
  end if;
  delete from public.messages where target_type = 'lobby' and target_id = p_lobby_id;
  delete from public.notifications where target_id = p_lobby_id and type in ('lobby_message','lobby_invite');
  delete from public.lobby_comments where lobby_id = p_lobby_id;
  delete from public.lobby_reactions where lobby_id = p_lobby_id;
  delete from public.lobby_members where lobby_id = p_lobby_id;
  delete from public.game_lobbies where id = p_lobby_id;
end $$;
grant execute on function public.delete_lobby(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════
--  ۷) حریم خصوصی پیام‌ها: چت گروه خصوصی/لابی فقط برای اعضا
--     + سازنده‌ی گروه/میزبان لابی هم حتی اگر عضو نشده باشه دسترسی داره
-- ════════════════════════════════════════════════════════════════
do $$ declare r record; begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='messages' and cmd='SELECT' and permissive='PERMISSIVE' loop
    execute format('drop policy %I on public.messages', r.policyname);
  end loop;
end $$;

create policy messages_select_scoped on public.messages
  for select to authenticated using (
    case
      when target_type = 'group' then
        exists (select 1 from public.group_members gm where gm.group_id = messages.target_id and gm.user_id = auth.uid())
        or exists (select 1 from public.groups g where g.id = messages.target_id and (g.is_public or g.created_by = auth.uid()))
        or public.is_moderator_or_admin()
      when target_type = 'lobby' then
        exists (select 1 from public.lobby_members lm where lm.lobby_id = messages.target_id and lm.user_id = auth.uid())
        or exists (select 1 from public.game_lobbies l where l.id = messages.target_id and l.host_id = auth.uid())
        or public.is_moderator_or_admin()
      else true
    end
  );

-- سازنده‌ی گروه/میزبان لابی هم بتونه پیام بفرسته حتی اگر هنوز جوین نشده
drop policy if exists messages_membership_insert on public.messages;
create policy messages_membership_insert on public.messages
  as restrictive for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (target_type = 'group' and (
        exists (select 1 from public.group_members gm where gm.group_id = messages.target_id and gm.user_id = auth.uid())
        or exists (select 1 from public.groups g where g.id = messages.target_id and g.created_by = auth.uid())
      ))
      or (target_type = 'lobby' and (
        exists (select 1 from public.lobby_members lm where lm.lobby_id = messages.target_id and lm.user_id = auth.uid())
        or exists (select 1 from public.game_lobbies l where l.id = messages.target_id and l.host_id = auth.uid())
      ))
      or (target_type not in ('group', 'lobby'))
    )
  );

-- ════════════════════════════════════════════════════════════════
--  ۸) ★ Realtime ★ — اضافه کردن جدول‌ها به publication سوپابیس
--     بدون این مرحله، اشتراک‌های کلاینت هیچ ایونتی دریافت نمی‌کنن
--     (دلیل اصلی اینکه «هیچ‌چیز realtime نبود»)
--
--     replica identity full: تا ایونت‌های DELETE هم همه‌ی ستون‌های رکورد
--     قدیمی رو بفرستن (وگرنه فقط id میاد و نمی‌شه فهمید مال کدوم پست/لابی بود)
-- ════════════════════════════════════════════════════════════════
do $$
declare t text;
        ri_tables text[] := array[
          'posts', 'post_comments', 'post_reactions', 'post_ratings',
          'lobby_comments', 'lobby_reactions', 'game_lobbies'
        ];
begin
  foreach t in array ri_tables loop
    begin
      execute format('alter table public.%I replica identity full', t);
    exception when others then
      raise notice 'replica identity % skipped: %', t, sqlerrm;
    end;
  end loop;
end $$;

do $$
declare t text;
        tables text[] := array[
          'messages', 'notifications', 'posts', 'post_comments',
          'post_reactions', 'post_ratings', 'lobby_comments',
          'lobby_reactions', 'group_members', 'lobby_members'
        ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then
        null; -- قبلاً اضافه شده
      end;
    end loop;
  else
    raise notice 'publication supabase_realtime پیدا نشد — realtime را از داشبورد فعال کنید';
  end if;
end $$;

-- ───────── گزارش پایانی ─────────
do $$ begin
  raise notice 'NetForge v3 ready: private/public groups + group/lobby settings + invites + REALTIME enabled';
end $$;
