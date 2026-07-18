-- ════════════════════════════════════════════════════════════════════
--  فیکس‌های گزارش QA (18 July 2026) — qa_fixes.sql
--    ۱) GRANT فراموش‌شده روی follows / notifications  ⇒  خطای 403 permission denied
--    ۲) قبول/رد فالو ⇒ امکان آپدیت follows از سمت طرف مقابل + نوع follow_accept
--    ۳) شمارنده اعضای گروه/لابی ⇒ SELECT آزاد (فقط برای کاربران لاگین‌شده)
--    ۴) جوین لابی 403 ناپایدار ⇒ بازنویسی کامل پالیسی‌های lobby_members + ظرفیت اتمیک
--    ۵) امنیت ⇒ پیام/کامنت/ریاکشن فقط برای اعضا (RESTRICTIVE)
--    ۶) ردشدن از گروه ⇒ اجازه درخواست مجدد (یونیک فقط روی pending)
--    ۷) ضد اسپم درخواست کد دعوت ⇒ فقط یک pending برای هر نفر
--  این فایل روی دیتابیس فعلی و هر چند بار اجرا، امن است (idempotent).
-- ════════════════════════════════════════════════════════════════════

-- ───────── ۱) GRANT فراموش‌شده (دلیل اصلی خطای 403 فالو و اعلان) ─────────
grant select, insert, update, delete on public.follows to authenticated;
grant select, insert, update          on public.notifications to authenticated;

-- پالیسی‌های follows هم دوباره تمیز تعریف بشن
alter table public.follows enable row level security;
drop policy if exists "Users can view follows" on public.follows;
drop policy if exists "Users can insert follows" on public.follows;
drop policy if exists "Users can update/delete their own follow actions" on public.follows;
create policy "Users can view follows" on public.follows
  for select to authenticated using (true);
create policy "Users can insert follows" on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);
-- طرف دعوت‌شده هم می‌تونه سطر رو آپدیت (قبول) یا حذف (رد) کنه
create policy "Users can update/delete their own follow actions" on public.follows
  for all to authenticated using (auth.uid() = follower_id or auth.uid() = following_id);

-- پالیسی‌های notifications دوباره تمیز تعریف بشن
alter table public.notifications enable row level security;
drop policy if exists "Users can view their own notifications" on public.notifications;
drop policy if exists "Users can insert notifications" on public.notifications;
drop policy if exists "Users can update/delete their own notifications" on public.notifications;
create policy "Users can view their own notifications" on public.notifications
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert notifications" on public.notifications
  for insert to authenticated with check (auth.uid() = sender_id);
create policy "Users can update/delete their own notifications" on public.notifications
  for update to authenticated using (auth.uid() = user_id);

-- ───────── ۲) نوع اعلان follow_accept به چک‌کانسترینت اضافه بشه ─────────
do $$ begin
  alter table public.notifications drop constraint if exists notifications_type_check;
exception when undefined_object then null;
end $$;
do $$ begin
  alter table public.notifications add constraint notifications_type_check
    check (type in ('follow_request', 'follow_accept', 'lobby_invite'));
exception when others then raise notice 'notifications_type_check skipped: %', sqlerrm;
end $$;

-- ───────── ۳) SELECT آزاد برای اعضا (شمارنده و لیست اعضا درست نشون داده بشه) ─────────
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and polname='group_members_select_all') then
    create policy group_members_select_all on public.group_members for select to authenticated using (true);
  end if;
end $$;

-- ───────── ۴) lobby_members: حذف همه پالیسی‌های قدیمی (اسم نامشخص) + بازسازی ─────────
create or replace function public.lobby_has_capacity(p_lobby_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_lobbies l
    where l.id = p_lobby_id
      and coalesce(l.status, 'open') <> 'closed'
      and (select count(*) from public.lobby_members m
           where m.lobby_id = l.id) < greatest(coalesce(l.capacity, 5), 1)
  );
$$;
grant execute on function public.lobby_has_capacity(uuid) to authenticated;

alter table public.lobby_members enable row level security;
do $$ declare r record; begin
  for r in select polname from pg_policies where schemaname='public' and tablename='lobby_members' loop
    execute format('drop policy %I on public.lobby_members', r.polname);
  end loop;
end $$;

create policy lobby_members_select_all on public.lobby_members
  for select to authenticated using (true);
create policy lobby_members_join_self on public.lobby_members
  for insert to authenticated
  with check (user_id = auth.uid() and public.lobby_has_capacity(lobby_id));
create policy lobby_members_leave_self on public.lobby_members
  for delete to authenticated using (user_id = auth.uid());

-- ───────── ۵) فقط اعضا ⇒ پیام/کامنت/ریاکشن (RESTRICTIVE = AND با پالیسی‌های فعلی) ─────────
drop policy if exists messages_membership_insert on public.messages;
create policy messages_membership_insert on public.messages
  as restrictive for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (target_type = 'group' and exists (select 1 from public.group_members gm where gm.group_id = messages.target_id and gm.user_id = auth.uid()))
      or (target_type = 'lobby' and exists (select 1 from public.lobby_members lm where lm.lobby_id = messages.target_id and lm.user_id = auth.uid()))
      or (target_type not in ('group', 'lobby'))
    )
  );

drop policy if exists lobby_comments_members_only on public.lobby_comments;
create policy lobby_comments_members_only on public.lobby_comments
  as restrictive for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.lobby_members lm where lm.lobby_id = lobby_comments.lobby_id and lm.user_id = auth.uid())
  );

drop policy if exists lobby_reactions_members_only on public.lobby_reactions;
create policy lobby_reactions_members_only on public.lobby_reactions
  as restrictive for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.lobby_members lm where lm.lobby_id = lobby_reactions.lobby_id and lm.user_id = auth.uid())
  );

-- ───────── ۶) رد عضویت گروه ⇒ اجازه درخواست مجدد ─────────
-- یکتایی فقط روی درخواست‌های pending؛ رکوردهای rejected/approved می‌تونن تکراری باشن
do $$ begin
  delete from public.group_join_requests a
  using public.group_join_requests b
  where a.status = 'pending' and b.status = 'pending'
    and a.group_id = b.group_id and a.user_id = b.user_id
    and a.id <> b.id and a.ctid > b.ctid;
exception when others then raise notice 'group_join_requests dedupe skipped: %', sqlerrm;
end $$;

do $$ begin
  alter table public.group_join_requests drop constraint if exists group_join_requests_group_id_user_id_key;
exception when others then raise notice 'drop group_join_requests uq skipped: %', sqlerrm;
end $$;

drop index if exists public.group_join_requests_one_pending;
create unique index if not exists group_join_requests_one_pending
  on public.group_join_requests (group_id, user_id)
  where status = 'pending';

-- ───────── ۷) ضد اسپم درخواست کد دعوت ─────────
do $$ begin
  delete from public.invite_requests a
  using public.invite_requests b
  where a.status = 'pending' and b.status = 'pending'
    and a.requested_by = b.requested_by
    and a.id <> b.id and a.requested_at > b.requested_at;
exception when others then raise notice 'invite_requests dedupe skipped: %', sqlerrm;
end $$;

drop index if exists public.invite_requests_one_pending;
create unique index if not exists invite_requests_one_pending
  on public.invite_requests (requested_by)
  where status = 'pending';

-- ───────── گزارش پایانی ─────────
do $$
begin
  raise notice 'QA fixes applied: follows/notifications GRANTs OK, lobby_members rebuilt, member-only restrictive policies OK, pending-unique indexes OK';
end $$;
