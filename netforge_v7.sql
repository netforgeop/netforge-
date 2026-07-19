-- ════════════════════════════════════════════════════════════════════
--  NetForge v7 — تگ‌های کاستوم + پاک‌کردن اعلان‌ها/لاگ + قبول دعوت + فیکس نقش گروه
-- ────────────────────────────────────────────────────────────────────
--  چطور اجراش کنم؟ (کاملاً امن — هر بار که بخوای می‌تونی دوباره Run کنی)
--  ۱) Supabase → منوی SQL Editor → New query
--  ۲) کل این فایل رو کپی و Paste کن
--  ۳) دکمه‌ی Run رو بزن — تهش باید NOTICE سبز ببینی: «NetForge v7 ready»
-- ════════════════════════════════════════════════════════════════════
begin;

-- ───────── ۱) حذف اعلان‌ها (دکمه‌ی «پاک کردن همه» توی زنگوله) ─────────
grant delete on public.notifications to authenticated;
drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications" on public.notifications
  for delete to authenticated using (auth.uid() = user_id);

-- ───────── ۲) ستون‌های تگ کاستوم ─────────
-- تگ سراسری کاربر (ادمین می‌دونه، روی پروفایل دیده می‌شه)
alter table public.users add column if not exists custom_tag text;
-- تگ اختصاصی هر عضو داخل گروه (سازنده/مدیر گروه/مدیر پلتفرم می‌ده)
alter table public.group_members add column if not exists custom_tag text;
-- تگ اختصاصی هر عضو داخل لابی (میزبان/کاپیتان/مدیر پلتفرم می‌ده)
alter table public.lobby_members add column if not exists custom_tag text;

-- ───────── ۳) فیکس باگ «مدیر گروه کن» ─────────
-- ستون role توی group_members از نوع enum است و متغیر text مستقیم نمی‌نشینه توش.
-- تایپ واقعی ستون رو می‌خونیم و با همون cast می‌کنیم (enum یا text — هر دو حالت امنه).
create or replace function public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare creator uuid; col_type text;
begin
  if p_role not in ('member', 'group_admin') then
    raise exception 'نقش نامعتبره';
  end if;
  select created_by into creator from public.groups where id = p_group_id;
  if creator is null then raise exception 'گروه پیدا نشد'; end if;
  if not (creator = auth.uid() or public.is_moderator_or_admin()) then
    raise exception 'فقط سازنده‌ی گروه یا مدیر پلتفرم می‌تونه نقش بده';
  end if;
  if p_user_id = creator and p_role <> 'group_admin' then
    raise exception 'نقش سازنده‌ی گروه قابل تغییر نیست';
  end if;

  select a.atttypid::regtype::text into col_type
    from pg_attribute a
    where a.attrelid = 'public.group_members'::regclass and a.attname = 'role' and not a.attisdropped;

  execute format('update public.group_members set role = %L::%s where group_id = $1 and user_id = $2',
                 p_role, coalesce(col_type, 'text'))
    using p_group_id, p_user_id;
  if not found then raise exception 'این کاربر عضو گروه نیست'; end if;
end $$;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;

-- ───────── ۴) پاک کردن لاگ سایت (فقط ادمین) ─────────
create or replace function public.admin_clear_mod_log()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'فقط ادمین می‌تونه لاگ سایت رو پاک کنه';
  end if;
  delete from public.mod_actions;
end $$;
grant execute on function public.admin_clear_mod_log() to authenticated;

-- ───────── ۵) تگ‌گذاری روی اعضای گروه ─────────
-- مجاز: سازنده‌ی گروه، مدیر گروه (group_admin)، ناظم/ادمین پلتفرم
create or replace function public.set_group_member_tag(p_group_id uuid, p_user_id uuid, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
declare creator uuid; caller_role text; tag text;
begin
  tag := nullif(btrim(coalesce(p_tag, '')), '');
  if tag is not null and char_length(tag) > 24 then
    raise exception 'تگ باید حداکثر ۲۴ کاراکتر باشه';
  end if;
  select created_by into creator from public.groups where id = p_group_id;
  if creator is null then raise exception 'گروه پیدا نشد'; end if;
  select role into caller_role from public.group_members
    where group_id = p_group_id and user_id = auth.uid();
  if not (creator = auth.uid() or public.is_moderator_or_admin() or caller_role = 'group_admin') then
    raise exception 'فقط مدیرای گروه می‌تونن تگ بدن';
  end if;
  update public.group_members set custom_tag = tag
    where group_id = p_group_id and user_id = p_user_id;
  if not found then raise exception 'این کاربر عضو گروه نیست'; end if;
end $$;
grant execute on function public.set_group_member_tag(uuid, uuid, text) to authenticated;

-- ───────── ۶) تگ‌گذاری روی اعضای لابی ─────────
-- مجاز: میزبان، کاپیتان (co_host)، ناظم/ادمین پلتفرم
create or replace function public.set_lobby_member_tag(p_lobby_id uuid, p_user_id uuid, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
declare host uuid; caller_role text; tag text;
begin
  tag := nullif(btrim(coalesce(p_tag, '')), '');
  if tag is not null and char_length(tag) > 24 then
    raise exception 'تگ باید حداکثر ۲۴ کاراکتر باشه';
  end if;
  select host_id into host from public.game_lobbies where id = p_lobby_id;
  if host is null then raise exception 'لابی پیدا نشد'; end if;
  select role into caller_role from public.lobby_members
    where lobby_id = p_lobby_id and user_id = auth.uid();
  if not (host = auth.uid() or public.is_moderator_or_admin() or caller_role = 'co_host') then
    raise exception 'فقط میزبان یا کاپیتان لابی می‌تونه تگ بده';
  end if;
  update public.lobby_members set custom_tag = tag
    where lobby_id = p_lobby_id and user_id = p_user_id;
  if not found then raise exception 'این کاربر عضو لابی نیست'; end if;
end $$;
grant execute on function public.set_lobby_member_tag(uuid, uuid, text) to authenticated;

-- ───────── ۷) قبول دعوت گروه (خودش عضوش می‌کنه) ─────────
create or replace function public.accept_group_invite(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare invited boolean; col_type text;
begin
  select exists(
    select 1 from public.notifications
    where user_id = auth.uid() and type = 'group_invite' and target_id = p_group_id
  ) into invited;
  if not invited then
    raise exception 'دعوت‌نامه‌ای برای این گروه نداری';
  end if;

  if not exists(select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
    select a.atttypid::regtype::text into col_type
      from pg_attribute a
      where a.attrelid = 'public.group_members'::regclass and a.attname = 'role' and not a.attisdropped;
    execute format('insert into public.group_members (group_id, user_id, role) values ($1, $2, %L::%s) on conflict do nothing',
                   'member', coalesce(col_type, 'text'))
      using p_group_id, auth.uid();
  end if;

  update public.notifications set is_read = true
    where user_id = auth.uid() and type = 'group_invite' and target_id = p_group_id;
end $$;
grant execute on function public.accept_group_invite(uuid) to authenticated;

-- ───────── ۸) قبول دعوت لابی (با چک ظرفیت) ─────────
create or replace function public.accept_lobby_invite(p_lobby_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare invited boolean; cap int; cnt int;
begin
  select exists(
    select 1 from public.notifications
    where user_id = auth.uid() and type = 'lobby_invite' and target_id = p_lobby_id
  ) into invited;
  if not invited then
    raise exception 'دعوت‌نامه‌ای برای این لابی نداری';
  end if;

  if not exists(select 1 from public.lobby_members where lobby_id = p_lobby_id and user_id = auth.uid()) then
    select capacity into cap from public.game_lobbies where id = p_lobby_id;
    if cap is null then raise exception 'لابی پیدا نشد'; end if;
    select count(*) into cnt from public.lobby_members where lobby_id = p_lobby_id;
    if cnt >= cap then raise exception 'لابی پره، ظرفیت تکمیله'; end if;
    insert into public.lobby_members (lobby_id, user_id, role)
      values (p_lobby_id, auth.uid(), 'member')
      on conflict do nothing;
  end if;

  update public.notifications set is_read = true
    where user_id = auth.uid() and type = 'lobby_invite' and target_id = p_lobby_id;
end $$;
grant execute on function public.accept_lobby_invite(uuid) to authenticated;

-- ───────── بررسی نهایی (این پیام‌ها رو باید توی خروجی ببینی) ─────────
do $$
declare t1 text; t2 text; t3 text;
begin
  select data_type into t1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'custom_tag';
  select data_type into t2 from information_schema.columns
    where table_schema = 'public' and table_name = 'group_members' and column_name = 'custom_tag';
  select data_type into t3 from information_schema.columns
    where table_schema = 'public' and table_name = 'lobby_members' and column_name = 'custom_tag';
  raise notice 'users.custom_tag = %, group_members.custom_tag = %, lobby_members.custom_tag = % (هر سه باید text باشن)',
    coalesce(t1, 'MISSING!'), coalesce(t2, 'MISSING!'), coalesce(t3, 'MISSING!');
end $$;

commit;
select 'NetForge v7 ready ✅ — tags + clear buttons + invite accept + group role fix' as status;
