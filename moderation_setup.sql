-- ====================================================================
-- NetForge — ابزارهای مدیریت (Ban / Mute / Timeout) + حذف محتوا + دعوت‌نامه
-- نسخه ۳ — «خود-ترمیم‌کننده» برای جداول قدیمی user_sanctions
--
-- این اسکریپت روی هر دو حالت درست کار می‌کند:
--   · جدول user_sanctions وجود نداشته باشد → با اسکیمای کامل ساخته می‌شود
--   · از قبل (با ساختار متفاوت) وجود داشته باشد → فقط ستون‌های گم‌شده
--     اضافه می‌شوند و هیچ داده‌ای پاک یا بازنویسی نمی‌شود
--   · ایدempotent است؛ هر چند بار که اجرا شود خطا نمی‌دهد
--
-- روش اجرا: کل فایل را در Supabase → SQL Editor کپی و Run کنید.
-- ====================================================================

-- --------------------------------------------------------------------
-- مرحله ۱) ساخت جدول در صورت نبودن (روی جدول قدیمی بی‌اثر است)
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

-- --------------------------------------------------------------------
-- مرحله ۲) ترمیم جدولِ از قبل موجود — افزودن هر ستون گم‌شده
-- (راه‌حل خطای 42703: column s.is_active does not exist)
-- --------------------------------------------------------------------
alter table public.user_sanctions add column if not exists id uuid default gen_random_uuid();
alter table public.user_sanctions add column if not exists user_id uuid;
alter table public.user_sanctions add column if not exists type text;
alter table public.user_sanctions add column if not exists reason text;
alter table public.user_sanctions add column if not exists created_by uuid;
alter table public.user_sanctions add column if not exists created_at timestamp with time zone default timezone('utc'::text, now());
alter table public.user_sanctions add column if not exists expires_at timestamp with time zone;
alter table public.user_sanctions add column if not exists lifted_at timestamp with time zone;
alter table public.user_sanctions add column if not exists lifted_by uuid;
alter table public.user_sanctions add column if not exists is_active boolean;

-- رکوردهایی که id ندارند (به‌ندرت) شناسه بگیرند
update public.user_sanctions set id = gen_random_uuid() where id is null;

-- پیش‌فرض‌های منطقی برای رکوردهای آینده
alter table public.user_sanctions alter column is_active set default true;
alter table public.user_sanctions alter column created_at set default timezone('utc'::text, now());

-- --------------------------------------------------------------------
-- رفع سازگاری با نام‌های قدیمی ستون‌ها (خطای issued_by)
-- جدول قدیمیِ شما به جای created_by ستون issued_by دارد که NOT NULL است
-- و چون کد جدید آن را نمی‌فرستد، اینسرت خطا می‌خورد. راه‌حل:
--   · مقدار پیش‌فرض auth.uid() روی issued_by (هر inserter خودش پرش می‌کند)
--   · دو ستون را دوطرفه با هم سینک می‌کنیم تا گزارش‌ها درست نمایش داده شوند
-- --------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='user_sanctions' and column_name='issued_by') then
    execute 'alter table public.user_sanctions alter column issued_by drop not null';
    execute 'alter table public.user_sanctions alter column issued_by set default auth.uid()';
    update public.user_sanctions set created_by = issued_by where created_by is null and issued_by is not null;
    update public.user_sanctions set issued_by = created_by where issued_by is null and created_by is not null;
  end if;
end $$;

-- نکته مهم: رکوردهای قدیمی با is_active = NULL به‌صورت طبیعی «غیرفعال»
-- در نظر گرفته می‌شوند (تابع has_active_sanction فقط true را قبول دارد)،
-- پس عمداً آن‌ها را true نمی‌کنیم تا محدودیتِ منقضی‌شده‌ی احتمالی زنده نشود.

-- --------------------------------------------------------------------
-- مرحله ۳) اگر ستون type از نوع enum است، هر سه مقدار را داشته باشد
-- --------------------------------------------------------------------
do $$
declare
  v_enum_name text;
  v_val text;
begin
  select t.typname into v_enum_name
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where c.relname = 'user_sanctions' and n.nspname = 'public'
    and a.attname = 'type' and t.typtype = 'e'
    and a.attnum > 0 and not a.attisdropped;

  if v_enum_name is not null then
    foreach v_val in array array['ban', 'mute', 'timeout'] loop
      execute format('alter type public.%I add value if not exists %L', v_enum_name, v_val);
    end loop;
  end if;
end $$;

-- --------------------------------------------------------------------
-- مرحله ۴) چک‌کانسترینت‌های قدیمیِ مربوط به ستون type که ممکن است مقدار
-- 'timeout' را نپذیرند حذف و جایشان یک چک سازگار (NOT VALID) گذاشته می‌شود
-- --------------------------------------------------------------------
do $$
declare
  v_con record;
begin
  for v_con in
    select con.conname as name, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'user_sanctions' and n.nspname = 'public' and con.contype = 'c'
  loop
    if v_con.def ilike '%type%' then
      execute format('alter table public.user_sanctions drop constraint %I', v_con.name);
    end if;
  end loop;

  begin
    alter table public.user_sanctions
      add constraint user_sanctions_type_values
      check (type::text in ('ban', 'mute', 'timeout')) not valid;
  exception when duplicate_object then null;
  end;
end $$;

-- --------------------------------------------------------------------
-- مرحله ۵) توابع کمکی امن (security definer تا با RLS تداخل نکنند)
-- مهم: این بخش باید «قبل» از پالیسی‌ها بیاید چون پالیسی‌ها به این
-- توابع ارجاع می‌دهند.
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
-- type::text می‌کنیم تا هم روی ستون text و هم enum درست کار کند
create or replace function public.has_active_sanction(p_user_id uuid, p_types text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sanctions s
    where s.user_id = p_user_id
      and s.is_active
      and s.type::text = any(p_types)
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- --------------------------------------------------------------------
-- مرحله ۶) فعال‌سازی RLS و بازسازی تمیز پالیسی‌های جدول user_sanctions
-- (پالیسی‌های قدیمی احتمالی همگی حذف و نسخه‌ی درست جایگزین می‌شود)
-- --------------------------------------------------------------------
alter table public.user_sanctions enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_sanctions'
  loop
    execute format('drop policy if exists %I on public.user_sanctions', p.policyname);
  end loop;
end $$;

create policy "sanctions_select_own_or_staff" on public.user_sanctions
for select to authenticated
using (user_id = auth.uid() or public.is_moderator_or_admin());

create policy "sanctions_insert_staff" on public.user_sanctions
for insert to authenticated
with check (
    created_by = auth.uid()
    and public.is_moderator_or_admin()
    -- هدف نباید ادمین باشد
    and not exists (select 1 from public.users u where u.id = user_id and u.role = 'admin')
    -- ناظم فقط member را محدود می‌کند؛ ادمین می‌تواند ناظم را هم محدود کند
    and (public.is_admin() or not exists (select 1 from public.users u where u.id = user_id and u.role = 'moderator'))
);

create policy "sanctions_update_staff" on public.user_sanctions
for update to authenticated
using (public.is_moderator_or_admin())
with check (public.is_moderator_or_admin());

create index if not exists user_sanctions_user_active_idx
    on public.user_sanctions (user_id, is_active);

-- --------------------------------------------------------------------
-- مرحله ۷) اجرای واقعی محدودیت در سطح دیتابیس (Restrictive Policies)
--    پالیسی‌های RESTRICTIVE با پالیسی‌های فعلی AND می‌شوند؛ یعنی بدون
--    دست زدن به پالیسی‌های قبلی، این قوانین «علاوه» بر آن‌ها اعمال می‌شوند.
-- --------------------------------------------------------------------

-- ۷-الف) میوت/تایم‌اوت/بن ⇒ ممنوعیت ایجاد محتوا (پست، کامنت، پیام چت)
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

-- ۷-ب) بن ⇒ ممنوعیت ایجاد هر تعامل دیگر + ممنوعیت دیدن محتوا
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
-- مرحله ۸) اجازه‌ی حذف محتوا به ادمین/ناظم (حذف پست/کامنت + حذف نرم پیام)
-- --------------------------------------------------------------------
drop policy if exists "posts_delete_staff" on public.posts;
create policy "posts_delete_staff" on public.posts
for delete to authenticated
using (public.is_moderator_or_admin());

drop policy if exists "post_comments_delete_staff_or_own" on public.post_comments;
create policy "post_comments_delete_staff_or_own" on public.post_comments
for delete to authenticated
using (author_id = auth.uid() or public.is_moderator_or_admin());

drop policy if exists "messages_update_own_or_staff" on public.messages;
create policy "messages_update_own_or_staff" on public.messages
for update to authenticated
using (sender_id = auth.uid() or public.is_moderator_or_admin())
with check (sender_id = auth.uid() or public.is_moderator_or_admin());

-- --------------------------------------------------------------------
-- مرحله ۹) درخواست کد دعوت توسط کاربران عادی (بخش Invite Requests UI)
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
-- مرحله ۱۰) گزارش نهایی — ساختار جدول را در تب Messages نشان می‌دهد تا
-- اگر باز هم چیزی خطا داد، بتوانید عکس/متن آن را برای دیباگ بفرستید.
-- --------------------------------------------------------------------
do $$
declare
  r record;
begin
  raise notice '=== ساختار نهایی جدول user_sanctions ===';
  for r in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'user_sanctions'
    order by ordinal_position
  loop
    raise notice '  ستون: %  نوع: %', r.column_name, r.data_type;
  end loop;
  raise notice '=== moderation_setup با موفقیت اجرا شد ✅ ===';
end $$;

-- --------------------------------------------------------------------
-- پایان ✅
-- --------------------------------------------------------------------
