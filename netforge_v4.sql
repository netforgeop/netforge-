-- ════════════════════════════════════════════════════════════════════
--  netforge_v4.sql — فیکس ارور تأیید عضویت + کیک/ترک/رول + فیکس لابی جدید
--
--   ۱) فیکس باگ «column status is of type group_join_status but expression
--      is of type text» → ستون status از enum به text تبدیل می‌شه (دیگه هر
--      مقداری از کلاینت بیاد بدون دردسر کار می‌کنه)
--   ۲) فیکس «لابی جدید توی لیست نمیاد»: status لابی‌های قدیمی NULL بود و
--      دیفالت ستون هم نبود → دیفالت 'open' + پر کردن NULLها
--   ۳) ستون role به lobby_members (کاپیتان لابی)
--   ۴) RPCهای مدیریت اعضا: کیک از گروه/لابی، دادن/گرفتن رول مدیر گروه
--      و کاپیتان لابی (SECURITY DEFINER — چک دسترسی داخل خودشون)
--   ۵) دادن/گرفتن نقش Moderator توسط ادمین از پنل (RPC رسمی)
--
--  هر چند بار اجرا شود امن است (idempotent). بعد از v3 اجرا کن.
-- ════════════════════════════════════════════════════════════════════

-- پیش‌نیاز (اگر فایل‌های قبلی اجرا نشده باشن)
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

-- ───────── ۱) فیکس enum: status درخواست‌های گروه → text ─────────
-- (باگ QA: «column "status" is of type group_join_status but expression is of type text»)
do $$ begin
  alter table public.group_join_requests alter column status drop default;
exception when others then raise notice 'drop default skipped: %', sqlerrm;
end $$;
do $$ begin
  alter table public.group_join_requests alter column status type text using status::text;
exception when others then raise notice 'text conversion skipped: %', sqlerrm;
end $$;
alter table public.group_join_requests alter column status set default 'pending';
update public.group_join_requests set status = 'pending' where status is null;
alter table public.group_join_requests drop constraint if exists gjr_status_values;
alter table public.group_join_requests add constraint gjr_status_values
  check (status in ('pending', 'approved', 'rejected'));

-- RPC تأیید/رد (بازنویسی با status متنی — بدون خطای enum)
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

-- ───────── ۲) فیکس «لابی جدید نمیاد»: status لابی NULL بود ─────────
alter table public.game_lobbies alter column status set default 'open';
update public.game_lobbies set status = 'open' where status is null;

-- ───────── ۳) رول کاپیتان برای اعضای لابی ─────────
alter table public.lobby_members add column if not exists role text not null default 'member';

-- ───────── ۴) RPCهای مدیریت اعضای گروه/لابی ─────────

-- ۴.الف) دادن/گرفتن نقش «مدیر گروه» (فقط سازنده‌ی گروه یا مدیر پلتفرم)
create or replace function public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare creator uuid;
begin
  if p_role not in ('member', 'group_admin') then
    raise exception 'نقش نامعتبره';
  end if;
  select created_by into creator from public.groups where id = p_group_id;
  if creator is null then raise exception 'گروه پیدا نشد'; end if;
  if not (creator = auth.uid() or public.is_moderator_or_admin()) then
    raise exception 'فقط سازنده‌ی گروه می‌تونه نقش بده';
  end if;
  if p_user_id = creator and p_role <> 'group_admin' then
    raise exception 'نقش سازنده‌ی گروه قابل تغییر نیست';
  end if;
  update public.group_members set role = p_role
    where group_id = p_group_id and user_id = p_user_id;
  if not found then raise exception 'این کاربر عضو گروه نیست'; end if;
end $$;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;

-- ۴.ب) کیک از گروه (سازنده/مدیر گروه/مدیر پلتفرم — سازنده کیک نمی‌شه؛
--      مدیر گروهِ غیرسازنده فقط اعضای معمولی رو می‌تونه کیک کنه)
create or replace function public.kick_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare creator uuid; caller_role text; target_role text;
begin
  select created_by into creator from public.groups where id = p_group_id;
  if creator is null then raise exception 'گروه پیدا نشد'; end if;
  select role into caller_role from public.group_members where group_id = p_group_id and user_id = auth.uid();
  select role into target_role from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if target_role is null then raise exception 'این کاربر عضو گروه نیست'; end if;
  if p_user_id = creator then raise exception 'سازنده‌ی گروه کیک نمی‌شه'; end if;

  if not (
    creator = auth.uid()
    or public.is_moderator_or_admin()
    or (caller_role = 'group_admin' and target_role <> 'group_admin')
  ) then
    raise exception 'اجازه‌ی کیک کردن نداری';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  -- درخواست‌های معلقش هم پاک بشه تا بعداً تمیز دوباره بتونه درخواست بده
  delete from public.group_join_requests where group_id = p_group_id and user_id = p_user_id and status = 'pending';
end $$;
grant execute on function public.kick_group_member(uuid, uuid) to authenticated;

-- ۴.ج) دادن/گرفتن نقش «کاپیتان لابی» (فقط میزبان یا مدیر پلتفرم)
create or replace function public.set_lobby_member_role(p_lobby_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare host uuid;
begin
  if p_role not in ('member', 'co_host') then
    raise exception 'نقش نامعتبره';
  end if;
  select host_id into host from public.game_lobbies where id = p_lobby_id;
  if host is null then raise exception 'لابی پیدا نشد'; end if;
  if not (host = auth.uid() or public.is_moderator_or_admin()) then
    raise exception 'فقط میزبان لابی می‌تونه نقش بده';
  end if;
  if p_user_id = host then
    raise exception 'نقش میزبان قابل تغییر نیست';
  end if;
  update public.lobby_members set role = p_role
    where lobby_id = p_lobby_id and user_id = p_user_id;
  if not found then raise exception 'این کاربر عضو لابی نیست'; end if;
end $$;
grant execute on function public.set_lobby_member_role(uuid, uuid, text) to authenticated;

-- ۴.د) کیک از لابی (میزبان/کاپیتان/مدیر پلتفرم — میزبان کیک نمی‌شه؛
--      کاپیتان فقط اعضای معمولی رو می‌تونه کیک کنه)
create or replace function public.kick_lobby_member(p_lobby_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare host uuid; caller_role text; target_role text;
begin
  select host_id into host from public.game_lobbies where id = p_lobby_id;
  if host is null then raise exception 'لابی پیدا نشد'; end if;
  select role into caller_role from public.lobby_members where lobby_id = p_lobby_id and user_id = auth.uid();
  select role into target_role from public.lobby_members where lobby_id = p_lobby_id and user_id = p_user_id;
  if target_role is null then raise exception 'این کاربر عضو لابی نیست'; end if;
  if p_user_id = host then raise exception 'میزبان لابی کیک نمی‌شه'; end if;

  if not (
    host = auth.uid()
    or public.is_moderator_or_admin()
    or (caller_role = 'co_host' and target_role = 'member')
  ) then
    raise exception 'اجازه‌ی کیک کردن نداری';
  end if;
  delete from public.lobby_members where lobby_id = p_lobby_id and user_id = p_user_id;
end $$;
grant execute on function public.kick_lobby_member(uuid, uuid) to authenticated;

-- ───────── ۵) نقش Moderator از پنل ادمین (دادن و گرفتن) ─────────
create or replace function public.promote_to_moderator(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not public.is_admin() then raise exception 'فقط ادمین'; end if;
  select role into target_role from public.users where id = p_user_id;
  if target_role is null then raise exception 'کاربر پیدا نشد'; end if;
  if target_role = 'admin' then raise exception 'نقش ادمین قابل تغییر نیست'; end if;
  update public.users set role = 'moderator' where id = p_user_id;
end $$;
grant execute on function public.promote_to_moderator(uuid) to authenticated;

create or replace function public.demote_from_moderator(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not public.is_admin() then raise exception 'فقط ادمین'; end if;
  select role into target_role from public.users where id = p_user_id;
  if target_role is null then raise exception 'کاربر پیدا نشد'; end if;
  if target_role <> 'moderator' then raise exception 'این کاربر ناظم نیست'; end if;
  update public.users set role = 'member' where id = p_user_id;
end $$;
grant execute on function public.demote_from_moderator(uuid) to authenticated;

-- ───────── گزارش پایانی ─────────
do $$ begin
  raise notice 'NetForge v4 ready: join-request enum FIXED + lobby status default + kick/roles RPCs + moderator promote/demote';
end $$;
