-- اگه دکمه‌ی «حذف» روی پست خودت هنوز کار نکرد و توی کنسول مرورگر
-- خطای permission denied / RLS دیدی، این فایل رو توی Supabase SQL Editor اجرا کن.
-- این فقط یه پالیسی می‌سازه که به صاحب پست اجازه‌ی حذف پست خودش رو می‌ده؛
-- اگه از قبل وجود داشته باشه، اول پاکش می‌کنه و دوباره می‌سازه (خطا نمی‌ده).

drop policy if exists "posts_delete_own" on public.posts;

create policy "posts_delete_own"
on public.posts
for delete
to authenticated
using (author_id = auth.uid());

-- همین الگو برای مدیر/ادمین هم (اگه بعداً خواستی از پنل ادمین پست‌های
-- بقیه رو هم حذف کنی) -- فعلاً کامنته، اگه لازم شد از حالت کامنت درش بیار:
-- drop policy if exists "posts_delete_staff" on public.posts;
-- create policy "posts_delete_staff"
-- on public.posts
-- for delete
-- to authenticated
-- using (is_moderator_or_admin());
