-- ════════════════════════════════════════════════════════════════════
--  NetForge — بک‌آپ‌گیر کامل دیتابیس (مخصوص نسخه‌ی رایگان Supabase)
-- ────────────────────────────────────────────────────────────────────
--  خروجی: یه سلول تنها که کل فایل بک‌آپ (ساختار + داده) توشه.
--
--  مراحل:
--  ۱) Supabase → SQL Editor → New query → کل این فایل رو Paste → Run
--  ۲) توی نتایج، روی سلول بزرگ جواب کلیک کن (یا آیکون expand گوشه‌ی سلول)
--  ۳) کل متنش رو Copy کن → توی Notepad پیست کن →
--     با اسم netforge_full_backup.sql ذخیره کن. تمام! ✅
--
--  برگردوندن بک‌آپ: اون فایل ذخیره‌شده رو همین‌جوری توی SQL Editor اجرا کن.
--  (ضدخرابی: همه‌چیز idempotent نوشته شده — چند بار اجرا هم امنه)
-- ════════════════════════════════════════════════════════════════════
begin;

create temp table _nf_dump(seq bigint generated always as identity, line text) on commit drop;

do $gen$
declare
  t      record;
  c      record;
  r      record;
  cols   text;
  exprs  text;
  q      text;
  acc    text;
  cnt    int;
  total  int;
  lastv  bigint;
begin
  -- ───────── هدر فایل بک‌آپ ─────────
  insert into _nf_dump(line) values
    ('-- ════════════════════════════════════════════════════════════════════'),
    ('--  NetForge FULL BACKUP (structure + data)'),
    ('--  ساخته شده: ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
    ('--'),
    ('--  طریقه‌ی استفاده:'),
    ('--  ۱) برگردوندن روی همین پروژه: همین فایل رو کامل توی SQL Editor اجرا کن.'),
    ('--  ۲) پروژه‌ی جدید: اول این فایل، بعد فایل‌های SQL ریپو رو به این ترتیب:'),
    ('--     qa_fixes.sql → netforge_v2.sql → netforge_v3.sql → netforge_v4.sql'),
    ('--     → netforge_v5.sql → netforge_v6.sql → netforge_v7.sql'),
    ('--  (همه چیز idempotent هست — چند بار اجرا کردن هیچ ضرری نداره)'),
    ('-- ════════════════════════════════════════════════════════════════════'),
    ('begin;'),
    ('set session_replication_role = replica;');

  -- ───────── سکوئنس‌ها (اگر باشن) ─────────
  for t in
    select cl.relname from pg_class cl
    where cl.relkind = 'S' and cl.relnamespace = 'public'::regnamespace
    order by cl.relname
  loop
    execute format('select last_value from public.%I', t.relname) into lastv;
    insert into _nf_dump(line) values
      ('do $nf$ begin create sequence public.' || quote_ident(t.relname) || '; exception when duplicate_object then null; end $nf$;'),
      ('select setval(' || quote_literal('public.' || t.relname) || ', ' || lastv || ');');
  end loop;

  -- ───────── Enum typeها ─────────
  for t in
    select ty.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
    from pg_type ty
    join pg_enum e on e.enumtypid = ty.oid
    join pg_namespace n on n.oid = ty.typnamespace
    where n.nspname = 'public'
    group by ty.typname
    order by ty.typname
  loop
    insert into _nf_dump(line) values
      ('do $nf$ begin create type public.' || quote_ident(t.typname) || ' as enum (' || t.labels ||
       '); exception when duplicate_object then null; end $nf$;');
  end loop;

  -- ───────── جدول‌ها + کانسترینت‌های غیر FK ─────────
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    insert into _nf_dump(line) values (
      E'\n-- ── جدول: ' || t.table_name || E' ──\n' ||
      'create table if not exists public.' || quote_ident(t.table_name) || ' (' ||
      (select E'\n  ' || string_agg(
              quote_ident(col.column_name) || ' ' || format_type(a.atttypid, a.atttypmod) ||
              case when col.column_default is not null then ' default ' || col.column_default else '' end ||
              case when col.is_nullable = 'NO' then ' not null' else '' end,
              E',\n  ' order by col.ordinal_position)
       from information_schema.columns col
       join pg_attribute a
         on a.attrelid = format('public.%I', t.table_name)::regclass
        and a.attname = col.column_name
       where col.table_schema = 'public' and col.table_name = t.table_name) ||
      E'\n);');

    for c in
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid = format('public.%I', t.table_name)::regclass
        and contype <> 'f'
      order by conname
    loop
      insert into _nf_dump(line) values (
        'do $nf$ begin alter table public.' || quote_ident(t.table_name) ||
        ' add constraint ' || quote_ident(c.conname) || ' ' || c.def ||
        '; exception when duplicate_object then null; end $nf$;');
    end loop;
  end loop;

  -- ───────── FKها (بعد از اینکه همه‌ی جدول‌ها ساخته شدن) ─────────
  for c in
    select conname, conrelid::regclass::text as rel, pg_get_constraintdef(oid) as def
    from pg_constraint
    where connamespace = 'public'::regnamespace and contype = 'f'
    order by 2, 1
  loop
    insert into _nf_dump(line) values (
      'do $nf$ begin alter table ' || c.rel ||
      ' add constraint ' || quote_ident(c.conname) || ' ' || c.def ||
      '; exception when duplicate_object then null; when undefined_object then raise notice ''fk skipped: ' || replace(c.conname, '''', ' ') || '''; end $nf$;');
  end loop;

  -- ───────── ایندکس‌های غیرکانسترینتی ─────────
  for c in
    select i.tablename, i.indexname, i.indexdef
    from pg_indexes i
    where i.schemaname = 'public'
      and not exists (select 1 from pg_constraint pc
                      where pc.connamespace = 'public'::regnamespace and pc.conname = i.indexname)
    order by i.tablename, i.indexname
  loop
    insert into _nf_dump(line) values (
      regexp_replace(c.indexdef, '^(create\s+(?:unique\s+)?index)\s+', '\1 if not exists ', 'i') || ';');
  end loop;

  -- ───────── روشن بودن RLS (پالیسی‌ها رو فایل‌های ریپو می‌سازن) ─────────
  for t in
    select relname from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
    order by relname
  loop
    insert into _nf_dump(line) values
      ('alter table public.' || quote_ident(t.relname) || ' enable row level security;');
  end loop;

  -- ───────── DATA — کل دیتای همه‌ی جدول‌ها ─────────
  insert into _nf_dump(line) values (E'\n-- ═══════════════ DATA ═══════════════');

  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t.table_name;

    select string_agg(
             'case when ' || quote_ident(column_name) || ' is null then ''null''' ||
             case when data_type in ('jsonb', 'json')
                  then ' else quote_literal(' || quote_ident(column_name) || '::text) || ''::' || udt_name || ''''
                  else ' else quote_literal(' || quote_ident(column_name) || '::text)' end,
             ' || '', '' || ' order by ordinal_position)
      into exprs
      from information_schema.columns
     where table_schema = 'public' and table_name = t.table_name;

    insert into _nf_dump(line) values (E'\n-- دیتای جدول: ' || t.table_name);
    acc := 'insert into public.' || quote_ident(t.table_name) || ' (' || cols || ') values';
    cnt := 0;
    total := 0;
    q := 'select ''('' || ' || exprs || ' || '')'' as tup from public.' || quote_ident(t.table_name);

    for r in execute q loop
      total := total + 1;
      if cnt = 0 then
        acc := acc || E'\n  ' || r.tup;
      else
        acc := acc || E'\n  ,' || r.tup;
      end if;
      cnt := cnt + 1;
      if cnt >= 150 then
        acc := acc || E'\non conflict do nothing;';
        insert into _nf_dump(line) values (acc);
        acc := 'insert into public.' || quote_ident(t.table_name) || ' (' || cols || ') values';
        cnt := 0;
      end if;
    end loop;

    if cnt > 0 then
      acc := acc || E'\non conflict do nothing;';
      insert into _nf_dump(line) values (acc);
    end if;
    if total = 0 then
      insert into _nf_dump(line) values ('-- (این جدول فعلاً خالیه)');
    end if;
  end loop;

  -- ───────── فوتر + لیست اکانت‌ها (فقط به‌صورت کامنت) ─────────
  insert into _nf_dump(line) values
    ('set session_replication_role = origin;'),
    ('commit;'),
    ('-- ════════════════════════════════════════════════════════════════════'),
    ('-- ✅ ریستور تمام شد!'),
    ('-- یادآوری: پالیسی‌ها/فانکشن‌ها/تریگرها/باکت استوریج/ریل‌تایم رو فایل‌های'),
    ('-- SQL ریپو می‌سازن (qa_fixes تا netforge_v7 — به ترتیب اجراشون کن).'),
    ('-- ── اکانت‌های لاگین (Supabase Auth) — فقط جهت دونستن:');

  for r in select id, email, created_at from auth.users order by created_at loop
    insert into _nf_dump(line) values
      ('--   account: ' || r.id || ' | ' || coalesce(r.email, '(no email)') || ' | ' || r.created_at);
  end loop;

  insert into _nf_dump(line) values ('-- ════════════════════════════════════════════════════════════════════');
end $gen$;

-- خروجی نهایی: یه سلول تنها که کل فایل بک‌آپ توشه 👇 روی سلول کلیک کن و کپی کن
select string_agg(line, E'\n' order by seq) as "backup_sql — کل این سلول رو کپی کن و با پسوند .sql ذخیره کن"
from _nf_dump;

commit;
