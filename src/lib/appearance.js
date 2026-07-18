// ═══════════════════════════════════════════════════════════════════
// مدیریت ظاهر سراسری سایت:
//   ۱) حالت روز/شب (light/dark) — با دکمه‌ی خورشید/ماه توی نوار کناری عوض می‌شه
//      و توی localStorage ذخیره می‌مونه.
//   ۲) رنگ اصلی (اکسنت): گرادیان دکمه‌های primary، تب فعال، بج ادمین،
//      حباب چت خودم و... همه از رنگ انتخابی کاربر توی پروفایل
//      (ستون neon_color) میاد و روی <body> به‌صورت کلاس accent-* نشسته می‌شه.
// ═══════════════════════════════════════════════════════════════════

const MODE_KEY = 'nf_mode' // 'dark' | 'light'

export function getMode() {
  try { return localStorage.getItem(MODE_KEY) || 'dark' } catch { return 'dark' }
}

export function applyMode(mode) {
  const m = mode === 'light' ? 'light' : 'dark'
  if (m === 'light') {
    document.documentElement.dataset.themeMode = 'light'
  } else {
    delete document.documentElement.dataset.themeMode
  }
  return m
}

// سوییچ بین روز و شب + ذخیره
export function toggleMode() {
  const next = getMode() === 'light' ? 'dark' : 'light'
  try { localStorage.setItem(MODE_KEY, next) } catch { /* حافظه در دسترس نیست */ }
  return applyMode(next)
}

// موقع بالا اومدن سایت صدا زده می‌شه تا حالت ذخیره‌شده اعمال بشه
export function initMode() {
  applyMode(getMode())
}

const ACCENTS = ['accent-blue', 'accent-green', 'accent-red', 'accent-rgb', 'accent-vicecity']

/**
 * رنگ اصلی سایت رو از رنگ نئون انتخابی کاربر می‌گیره:
 *   'blue' | 'red' | 'green' | 'rgb-cycle' | 'vicecity'
 * null یعنی برگرد به پیش‌فرض (گرادیان بنفش-صورتی — مثلاً صفحه‌ی لاگین).
 */
export function applyAccent(color) {
  const cls = color === 'red' ? 'accent-red'
    : color === 'green' ? 'accent-green'
    : color === 'rgb-cycle' ? 'accent-rgb'
    : color === 'vicecity' ? 'accent-vicecity'
    : color === 'blue' ? 'accent-blue'
    : null
  ACCENTS.forEach(c => document.body.classList.remove(c))
  if (cls) document.body.classList.add(cls)
}
