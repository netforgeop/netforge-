-- ۱. جدول فالوورها
create table if not exists public.follows (
    id uuid default gen_random_uuid() primary key,
    follower_id uuid references public.users(id) on delete cascade not null,
    following_id uuid references public.users(id) on delete cascade not null,
    status text default 'pending' check (status in ('pending', 'accepted')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(follower_id, following_id)
);

-- ۲. جدول نوتیفیکیشن‌ها
create table if not exists public.notifications (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.users(id) on delete cascade not null, -- دریافت‌کننده نوتیفیکیشن
    sender_id uuid references public.users(id) on delete cascade not null, -- فرستنده
    type text not null check (type in ('follow_request', 'follow_accept', 'lobby_invite')),
    message text not null,
    target_id uuid, -- مثلاً شناسه لابی یا آی‌دی پیگیری
    is_read boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- فعال‌سازی RLS
alter table public.follows enable row level security;
alter table public.notifications enable row level security;

-- حذف پالیسی‌های قدیمی در صورت وجود برای جلوگیری از خطا
drop policy if exists "Users can view follows" on public.follows;
drop policy if exists "Users can insert follows" on public.follows;
drop policy if exists "Users can update/delete their own follow actions" on public.follows;
drop policy if exists "Users can view their own notifications" on public.notifications;
drop policy if exists "Users can insert notifications" on public.notifications;
drop policy if exists "Users can update/delete their own notifications" on public.notifications;

-- پالیسی‌های جدول follows
create policy "Users can view follows" on public.follows for select to authenticated using (true);
create policy "Users can insert follows" on public.follows for insert to authenticated with check (auth.uid() = follower_id);
create policy "Users can update/delete their own follow actions" on public.follows 
    for all to authenticated using (auth.uid() = follower_id or auth.uid() = following_id);

-- پالیسی‌های جدول notifications
create policy "Users can view their own notifications" on public.notifications for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert notifications" on public.notifications for insert to authenticated with check (auth.uid() = sender_id);
create policy "Users can update/delete their own notifications" on public.notifications 
    for update to authenticated using (auth.uid() = user_id);
