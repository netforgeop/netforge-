-- ════════════════════════════════════════════════════════════════════════════
--  NetForge v6 — ریلز + استوری + تم‌های سفارشی ادمین + اخطار realtime + فیکس
--  Realtime لیست گروه‌ها/لابی‌ها (جدول‌های groups و game_lobbies توی publication
--  نبودن، برای همین بدون رفرش آپدیت نمی‌شدن!)
--
--  اجرا: کپی کل فایل توی Supabase → SQL Editor → Run
--  امن برای اجرای چندباره (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

-- توابع کمکی نقش (در صورت نبودن بساز)
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

-- ───────── ۱) ریلز: پست‌هایی با ویدیو ─────────
alter table public.posts add column if not exists is_reel boolean not null default false;
alter table public.posts add column if not exists media_type text not null default 'image';
create index if not exists posts_is_reel_idx on public.posts (is_reel) where is_reel;

-- ───────── ۲) استوری‌ها (۲۴ ساعته) ─────────
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  created_at timestamptz not null default now()
);
create index if not exists stories_user_created_idx on public.stories (user_id, created_at desc);
grant select, insert, delete on public.stories to authenticated;
alter table public.stories enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='stories' loop
    execute format('drop policy %I on public.stories', r.policyname);
  end loop;
end $$;
create policy stories_select_all on public.stories for select to authenticated using (true);
create policy stories_insert_own on public.stories for insert to authenticated with check (user_id = auth.uid());
create policy stories_delete_own_or_staff on public.stories for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator_or_admin());

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
grant select, insert, update on public.story_views to authenticated;
alter table public.story_views enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='story_views' loop
    execute format('drop policy %I on public.story_views', r.policyname);
  end loop;
end $$;
create policy story_views_select_involved on public.story_views for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_views.story_id and s.user_id = auth.uid())
    or public.is_admin()
  );
create policy story_views_insert_own on public.story_views for insert to authenticated with check (user_id = auth.uid());

-- ───────── ۳) تم‌های سفارشی (ساخت ادمین، دسترسی برای همه یا منتخب) ─────────
-- نکته: اول هر دو جدول ساخته می‌شن، بعد پالیسی‌ها — چون پالیسیِ themes به
-- theme_access ارجاع می‌ده (ترتیب قبلی باعث ارور 42P01 شد).
create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.users(id) on delete set null,
  accent text not null default '#9333ea',   -- رنگ اصلی (شروع گرادیان)
  accent2 text not null default '#ec4899',  -- رنگ دوم (پایان گرادیان)
  card_style text not null default 'glass' check (card_style in ('glass', 'solid', 'transparent')),
  bg_type text not null default 'none' check (bg_type in ('none', 'color', 'image', 'video')),
  bg_value text,                            -- رنگ (hex) یا لینک عکس/ویدیو
  is_public boolean not null default false, -- true = همه دسترسی دارن
  created_at timestamptz not null default now()
);
create table if not exists public.theme_access (
  theme_id uuid not null references public.themes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (theme_id, user_id)
);
grant select on public.themes to authenticated;
grant insert, update, delete on public.themes to authenticated;
grant select, insert, delete on public.theme_access to authenticated;
alter table public.themes enable row level security;
alter table public.theme_access enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename in ('themes','theme_access') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy themes_select_public_granted_admin on public.themes for select to authenticated
  using (
    is_public
    or exists (select 1 from public.theme_access ta where ta.theme_id = themes.id and ta.user_id = auth.uid())
    or public.is_admin()
  );
create policy themes_insert_admin on public.themes for insert to authenticated with check (public.is_admin());
create policy themes_update_admin on public.themes for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy themes_delete_admin on public.themes for delete to authenticated using (public.is_admin());
create policy theme_access_select_self_or_admin on public.theme_access for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy theme_access_insert_admin on public.theme_access for insert to authenticated with check (public.is_admin());
create policy theme_access_delete_admin on public.theme_access for delete to authenticated using (public.is_admin());

-- تمِ فعال هر کاربر
alter table public.users add column if not exists active_theme_id uuid references public.themes(id) on delete set null;

-- ───────── ۴) نوع اعلان جدید: warning (اخطار ادمین) ─────────
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
      'comment_like', 'comment_reply', 'ticket_new', 'ticket_reply',
      'warning'
    ));
exception when others then raise notice 'notifications_type_check skipped: %', sqlerrm;
end $$;

-- ───────── ۵) باکت آپلود رسانه (عکس/ویدیو برای پست، ریل و استوری) ─────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 104857600) -- 100MB
on conflict (id) do nothing;

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists media_auth_insert on storage.objects;
create policy media_auth_insert on storage.objects
  for insert with check (bucket_id = 'media' and auth.role() = 'authenticated');

drop policy if exists media_owner_delete on storage.objects;
create policy media_owner_delete on storage.objects
  for delete using (bucket_id = 'media' and owner = auth.uid());

-- ───────── ۶) ★ فیکس Realtime لیست‌ها: جدول‌ها رو به publication اضافه کن ─────────
-- groups و game_lobbies اصلاً publish نشده بودن → همون «باید رفرش کرد» که گفتی!
do $$
declare t text;
        tables text[] := array[
          'groups', 'game_lobbies', 'group_join_requests',
          'stories', 'story_views', 'themes', 'theme_access'
        ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
        raise notice 'realtime publication: +%', t;
      exception when duplicate_object then
        raise notice 'realtime publication: % already added', t;
      end;
    end loop;
  else
    raise notice 'publication supabase_realtime پیدا نشد — از داشبورد Supabase فعالش کن';
  end if;
end $$;

-- replica identity کامل تا payload آپدیت/حذف، کل ردیف رو بده (برای رندر زنده لازمه)
alter table public.groups replica identity full;
alter table public.game_lobbies replica identity full;
alter table public.stories replica identity full;
alter table public.group_members replica identity full;
alter table public.lobby_members replica identity full;

-- ───────── گزارش پایانی ─────────
do $$ begin
  raise notice 'NetForge v6 ready: reels + stories + custom themes + realtime warnings + groups/lobbies realtime FIXED';
end $$;
