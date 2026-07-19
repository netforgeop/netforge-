-- ════════════════════════════════════════════════════════════════════
--  NetForge — پاک‌سازی کامل سایت (RESET)
-- ────────────────────────────────────────────────────────────────────
--  چی می‌مونه؟
--    ✅ اکانت Admin0007 (آی‌دی: 6b59e80a-d4de-4258-8314-141b8d01f5d2)
--    ✅ فقط تم‌هایی که خودت ساختی (themes.created_by = خودت)
--  چی پاک می‌شه؟
--    ❌ همه‌ی اکانت‌های دیگه (هم Auth هم پروفایل)
--    ❌ همه‌ی پست‌ها، گروه‌ها، لابی‌ها، پیام‌ها، اعلان‌ها، استوری‌ها،
--       کامنت‌ها، ری‌اکشن‌ها، تیکت‌ها، گزارش‌ها، محدودیت‌ها، لاگ مدیریت،
--       کدهای دعوت، فالوها، بلاک‌ها و هر محتوای دیگه
--
--  ⚠️ این کار برگشت نداره! مطمئنی بک‌آپ گرفتی؟ (backup_export.sql)
--
--  اجرا: Supabase → SQL Editor → New query → کل فایل Paste → Run
--  امن برای اجرای چندباره؛ انتظار خروجی نهایی:
--    NOTICE: باقی‌مانده: 1 کاربر و N تم
-- ════════════════════════════════════════════════════════════════════
begin;

-- آی‌دی اکانتی که باید بمونه (اگه روزی خواستی عوضش کنی، فقط همین خط)
-- Admin0007 = 6b59e80a-d4de-4258-8314-141b8d01f5d2

-- ───────── ۱) خالی کردن کامل جدول‌های محتوایی ─────────
truncate table
  public.follows,
  public.game_lobbies,
  public.group_join_requests,
  public.group_members,
  public.groups,
  public.invite_codes,
  public.invite_requests,
  public.lobby_comments,
  public.lobby_members,
  public.lobby_reactions,
  public.message_edit_history,
  public.message_reactions,
  public.messages,
  public.mod_actions,
  public.notifications,
  public.post_comment_likes,
  public.post_comments,
  public.post_ratings,
  public.post_reactions,
  public.posts,
  public.reports,
  public.stories,
  public.story_views,
  public.theme_access,
  public.ticket_messages,
  public.tickets,
  public.user_blocks,
  public.user_sanctions
restart identity cascade;

-- ───────── ۲) تم‌ها: فقط ساخته‌های خودم می‌مونن ─────────
-- (is distinct from = اون‌هایی هم که سازنده‌شون نامشخص/null پاک می‌شن)
delete from public.themes
where created_by is distinct from '6b59e80a-d4de-4258-8314-141b8d01f5d2';

-- ───────── ۳) اکانت‌ها: همه جز خودم — هم Auth هم پروفایل ─────────
-- حذف از auth.users خودش با cascade پروفایل‌ها رو هم پاک می‌کنه
delete from auth.users
where id <> '6b59e80a-d4de-4258-8314-141b8d01f5d2';

-- ───────── ۴) گزارش نهایی ─────────
do $$
declare u int; t int; a int;
begin
  select count(*) into u from public.users;
  select count(*) into t from public.themes;
  select count(*) into a from auth.users;
  raise notice 'باقی‌مانده: % کاربر (auth: %) و % تم — اگه کاربر اشتباهی مونده، مطمئن شو آی‌دی درسته', u, a, t;
end $$;

commit;

select '🧹 سایت کامل پاک شد — فقط Admin0007 + تم‌های خودش مونده' as status;
