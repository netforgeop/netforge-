// ────────────────────────────────────────────────────────────────────
//  سیستم دوزبانه (فارسی/انگلیسی) با RTL/LTR خودکار
//  استفاده:   t('خانه', 'Home')
//  زبان انتخابی توی localStorage با کلید nf_lang ذخیره می‌شه و
//  جهت کل سند (dir/lang روی <html>) باهاش عوض می‌شه.
// ────────────────────────────────────────────────────────────────────

const KEY = 'nf_lang'

export function getLang() {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'fa'
  } catch {
    return 'fa'
  }
}

export function setLang(lang) {
  const l = lang === 'en' ? 'en' : 'fa'
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  applyLangDir()
  return l
}

export function toggleLang() {
  return setLang(getLang() === 'en' ? 'fa' : 'en')
}

// جهت و زبان تگ <html> — موتور چیدمان flex/متن خودش بر اساسش آینه می‌شه
export function applyLangDir() {
  const l = getLang()
  document.documentElement.lang = l
  document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl'
}

// ترجمه: پارامتر اول فارسی، پارامتر دوم انگلیسی
export function t(fa, en) {
  return getLang() === 'en' ? (en ?? fa) : fa
}

// لوکیل مناسب برای فرمت تاریخ/ساعت
export function dateLocale() {
  return getLang() === 'en' ? 'en-US' : 'fa-IR'
}
