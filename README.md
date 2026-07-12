# محفل — فرانت‌اند (Vite + Vanilla JS)

## اجرای لوکال

```bash
npm install
npm run dev
```

سایت روی `http://localhost:5173` بالا میاد. اطلاعات اتصال Supabase از
فایل `.env` خونده می‌شه (از قبل با URL و publishable key واقعی پروژه‌تون
پر شده).

## قبل از هر چیز: SQL رو روی Supabase اجرا کن

اگه هنوز اجرا نکردید، فایل‌های `schema/001` تا `005` و `auth/auth-flow.md`
(از پیام قبلی) رو به همون ترتیب توی SQL Editor پروژه‌ی
`udmxivzvsapuxzhtjoyy` اجرا کنید. بدون اون‌ها، این فرانت‌اند به دیتابیس
وصل می‌شه ولی هیچ جدول/RPC‌ای پیدا نمی‌کنه.

## ساختار پروژه

```
src/
  lib/
    supabaseClient.js   کلاینت Supabase (با publishable key جدید)
    router.js           روتر ساده‌ی مبتنی بر hash (بدون framework)
    auth.js             signUp/logIn/logOut/getMyProfile + RPCهای auth
    shell.js            پوسته‌ی مشترک صفحات (نوار بالا + پاپ‌آپ مسئولیت‌پذیری)
    utils.js            escapeHtml، timeAgo، toast
  components/
    navbar.js           نوار بالای صفحه + تب‌ها
    chat.js             چت Realtime قابل استفاده برای گروه/لابی
    responsibilityModal.js
    reportBlock.js       دکمه‌های گزارش/بلاک
  pages/
    login.js             ورود + ثبت‌نام با کد دعوت
    feed.js               فید عمومی (پست، کامنت، امتیاز، ریاکشن)
    groups.js / groupDetail.js
    lobbies.js / lobbyDetail.js
    profile.js
    admin.js
  styles/main.css        توکن‌های طراحی + افکت شیشه‌ای + سیستم نئون
```

## دیپلوی روی GitHub Pages

۱. توی `vite.config.js`، مقدار `base` رو به `'/اسم-ریپو/'` تغییر بده
   (با اسلش اول و آخر). اگه ریپو از نوع `username.github.io` هست،
   `base: '/'` بذار.

۲. یا با GitHub Actions (پیشنهادی) یا دستی:

```bash
npm run build
npx gh-pages -d dist
```

سپس توی تنظیمات ریپو (Settings → Pages) شاخه‌ی `gh-pages` رو به‌عنوان
منبع انتشار انتخاب کن.

## نکات امنیتی مهم که باید رعایت بشه

- **هرگز** `service_role` key رو اینجا یا هیچ فایل دیگه‌ای توی این
  ریپو قرار نده. فقط publishable key (که در `.env` هست) باید توی
  کلاینت باشه؛ امنیت واقعی رو RLS روی Supabase تأمین می‌کنه.
- توابعی که با کلاینت anon (بدون سشن) صدا زده می‌شن
  (`check_invite_code_valid`, `is_nickname_taken`, `get_internal_email`)
  فقط یه boolean/رشته‌ی کوچیک برمی‌گردونن، نه کل ردیف -- همین‌طور نگهش
  دارید تا کسی نتونه با brute-force جدول‌ها رو enumerate کنه.
- نام واقعی سازنده جایی توی کد یا محتوا نیست؛ deploy رو هم با
  گیت‌هاب/ایمیل مجزا انجام بدید، نه حساب شخصی.

## چیزهایی که هنوز MVP سطح هستن و می‌شه بهتر کرد

- **Presence**: الان فقط یه پرچم ساده‌ی `is_online` + heartbeat هر
  دقیقه‌ست. برای typing indicator واقعی باید از Supabase Presence API
  (کانال realtime مخصوص presence) استفاده بشه.
- **نوتیفیکیشن مرورگر (Web Push)**: هنوز پیاده نشده؛ نیاز به
  Service Worker + دریافت اجازه‌ی Notification داره.
- **پاک‌سازی خودکار لابی‌های راکد**: تابع SQL آماده‌ست ولی باید یک‌بار
  با `pg_cron` زمان‌بندی بشه (دستورش در `004_triggers.sql`).
- **race condition مصرف کد دعوت**: توضیحش در `auth/auth-flow.md` هست؛
  برای production بهتره signUp+redeem رو یه Edge Function اتمیک کنه.
