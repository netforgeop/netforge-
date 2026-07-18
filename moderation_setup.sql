-- ====================================================================
-- NetForge — ابزارهای مدیریت (Ban / Mute / Timeout) + حذف محتوا
-- این فایل idempotent است؛ یعنی اگر چند بار اجرا شود، خطا نمی‌دهد.
-- کافی است کل فایل را در Supabase → SQL Editor کپی و Run کنید.
-- ====================================================================

-- --------------------------------------------------------------------
-- ۱) جدول محدودیت‌های کاربران (user_sanctions)
--    هر سطر یعنی یک محدودیت روی یک کاربر:
--      type = 'ban'     → مسدود کامل (هیچ محتوایی نمی‌بیند و نمی‌تواند کاری بکند)
--      type = 'mute'    → نمی‌تواند پست/کامنت/پیام بفرستد (دائم یا تا رفع دستی)
--      type = 'timeout' → مثل میوت ولی معمولاً کوتاه‌مدت و خودبه‌خود منقضی می‌شود
--    expires_at = NULL یعنی «دائم/تا رفع دستی»
-- --------------------------------------------------------------------
create table if not exists public.user_sanctions (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.users(id) on delete cascade not null,
    type text not null check (type in ('ban', 'mute', 'timeout')),
    reason text default '',
    created_by uuid references public.users(id) on delete set null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    expires_at timestamp with time zone,
    lifted_at timestamp with time zone,
    lifted_by uuid references public.users(id) on delete set null,
    is_active boolean default true not null
);

alter table public.user_sanctions enable row level security;

-- --------------------------------------------------------------------
-- ۲) توابع کمکی امن (security definer تا با RLS جدول users تداخل نکنند)
-- --------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_moderator_or_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin', 'moderator')
  );
$$;

-- آیا کاربر محدودیت فعال از نوع‌های داده‌شده دارد؟
create or replace function public.has_active_sanction(p_user_id uuid, p_types text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sanctions s
    where s.user_id = p_user_id
      and s.is_active
      and s.type = any(p_types)
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- --------------------------------------------------------------------
-- ۳) پالیسی‌های RLS جدول user_sanctions
--    - هر کاربر فقط محدودیت‌های خودش را می‌بیند (برای نمایش پیام بن/میوت)
--    - ادمین/ناظم همه را می‌بیند، ایجاد و رفع می‌کند
--    - ادمین‌ها را نمی‌توان محدود کرد؛ ناظم فقط member را محدود می‌کند
-- --------------------------------------------------------------------
drop policy if exists "sanctions_select_own_or_staff" on public.user_sanctions;
create policy "sanctions_select_own_or_staff" on public.user_sanctions
for select to authenticated
using (user_id = auth.uid() or public.is_moderator_or_admin());

drop policy if exists "sanctions_insert_staff" on public.user_sanctions;
create policy "sanctions_insert_staff" on public.user_sanctions
for insert to authenticated
with check (
    created_by = auth.uid()
    and public.is_moderator_or_admin()
    -- هدف نباید ادمین باشد
    and not exists (select 1 from public.users u where u.id = user_id and u.role = 'admin')
    -- ناظم‌ها فقط member را محدود کنند؛ ادمین می‌تواند ناظم را هم محدود کند
    and (public.is_admin() or not exists (select 1 from public.users u where u.id = user_id and u.role = 'moderator'))
);

drop policy if exists "sanctions_update_staff" on public.user_sanctions;
create policy "sanctions_update_staff" on public.user_sanctions
for update to authenticated
using (public.is_moderator_or_admin())
with check (public.is_moderator_or_admin());

-- ایندکس برای سرعت چک محدودیت‌ها
create index if not exists user_sanctions_user_active_idx
    on public.user_sanctions (user_id, is_active);

-- --------------------------------------------------------------------
-- ۴) اجرای واقعی محدودیت در سطح دیتابیس (Restrictive Policies)
--    پالیسی‌های RESTRICTIVE با پالیسی‌های فعلی AND می‌شوند؛ یعنی بدون
--    دست زدن به پالیسی‌های قبلی، این قوانین «علاوه» بر آن‌ها اعمال می‌شوند.
-- --------------------------------------------------------------------

-- ۴-الف) میوت/تایم‌اوت/بن ⇒ ممنوعیت ایجاد محتوا (پست، کامنت، پیام چت)
drop policy if exists "sanction_block_insert_posts" on public.posts;
create policy "sanction_block_insert_posts" on public.posts
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['mute','timeout','ban']));

drop policy if exists "sanction_block_insert_post_comments" on public.post_comments;
create policy "sanction_block_insert_post_comments" on public.post_comments
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['mute','timeout','ban']));

drop policy if exists "sanction_block_insert_messages" on public.messages;
create policy "sanction_block_insert_messages" on public.messages
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['mute','timeout','ban']));

-- ۴-ب) بن ⇒ ممنوعیت ایجاد هر تعامل دیگر + ممنوعیت دیدن محتوا
drop policy if exists "ban_block_insert_lobby_comments" on public.lobby_comments;
create policy "ban_block_insert_lobby_comments" on public.lobby_comments
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_insert_follows" on public.follows;
create policy "ban_block_insert_follows" on public.follows
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_insert_notifications" on public.notifications;
create policy "ban_block_insert_notifications" on public.notifications
as restrictive for insert to authenticated
with check (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_select_posts" on public.posts;
create policy "ban_block_select_posts" on public.posts
as restrictive for select to authenticated
using (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_select_messages" on public.messages;
create policy "ban_block_select_messages" on public.messages
as restrictive for select to authenticated
using (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_select_groups" on public.groups;
create policy "ban_block_select_groups" on public.groups
as restrictive for select to authenticated
using (not public.has_active_sanction(auth.uid(), array['ban']));

drop policy if exists "ban_block_select_game_lobbies" on public.game_lobbies;
create policy "ban_block_select_game_lobbies" on public.game_lobbies
as restrictive for select to authenticated
using (not public.has_active_sanction(auth.uid(), array['ban']));

-- --------------------------------------------------------------------
-- ۵) اجازه‌ی حذف محتوا به ادمین/ناظم (حذف پست/کامنت + حذف نرم پیام چت)
--    این پالیسی‌ها permissive هستند و با پالیسی‌های فعلی OR می‌شوند.
-- --------------------------------------------------------------------
drop policy if exists "posts_delete_staff" on public.posts;
create policy "posts_delete_staff" on public.posts
for delete to authenticated
using (public.is_moderator_or_admin());

drop policy if exists "post_comments_delete_staff_or_own" on public.post_comments;
create policy "post_comments_delete_staff_or_own" on public.post_comments
for delete to authenticated
using (author_id = auth.uid() or public.is_moderator_or_admin());

-- پیام: صاحب پیام یا ادمین/ناظم می‌تواند آپدیت کند (حذف نرم با is_deleted)
drop policy if exists "messages_update_own_or_staff" on public.messages;
create policy "messages_update_own_or_staff" on public.messages
for update to authenticated
using (sender_id = auth.uid() or public.is_moderator_or_admin())
with check (sender_id = auth.uid() or public.is_moderator_or_admin());

-- --------------------------------------------------------------------
-- ۶) درخواست کد دعوت توسط کاربران عادی (بخش Invite Requests UI)
--    کاربر می‌تواند برای خودش درخواست ثبت کند و وضعیتش را ببیند؛
--    کد ساخته‌شده توسط ادمین هم فقط برای خودش قابل مشاهده است.
-- --------------------------------------------------------------------
drop policy if exists "invite_requests_insert_own" on public.invite_requests;
create policy "invite_requests_insert_own" on public.invite_requests
for insert to authenticated
with check (requested_by = auth.uid());

drop policy if exists "invite_requests_select_own_or_staff" on public.invite_requests;
create policy "invite_requests_select_own_or_staff" on public.invite_requests
for select to authenticated
using (requested_by = auth.uid() or public.is_moderator_or_admin());

drop policy if exists "invite_codes_select_own_results" on public.invite_codes;
create policy "invite_codes_select_own_results" on public.invite_codes
for select to authenticated
using (
    public.is_moderator_or_admin()
    or exists (
        select 1 from public.invite_requests ir
        where ir.resulting_invite_code_id = invite_codes.id
          and ir.requested_by = auth.uid()
    )
);

-- --------------------------------------------------------------------
-- پایان ✅ اگر همه‌ی خطوط بدون خطا اجرا شد، بک‌اند آماده است.
-- --------------------------------------------------------------------
