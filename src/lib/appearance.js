// ═══════════════════════════════════════════════════════════════════
// مدیریت ظاهر سراسری سایت:
//   ۱) حالت روز/شب (light/dark) — با دکمه‌ی خورشید/ماه توی نوار کناری عوض می‌شه
//      و توی localStorage ذخیره می‌مونه.
//   ۲) رنگ اصلی (اکسنت): گرادیان دکمه‌های primary، تب فعال، بج ادمین،
//      حباب چت خودم و... همه از رنگ انتخابی کاربر توی پروفایل
//      (ستون neon_color) میاد و روی <body> به‌صورت کلاس accent-* نشسته می‌شه.
//   ۳) تم‌های سفارشی ادمین (themes): رنگ + استایل کارت + پس‌زمینه
//      (رنگ/عکس/ویدیو) — روی اکسنت نئونی سوار می‌شه و اولویتش بیشتره.
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

// ────────────────────────────────────────────────────────────────────
//  تم‌های سفارشی (ساخته‌ی ادمین) — applyTheme روی body کار می‌ذاره:
//   · رنگ‌ها: متغیرهای --grad-a/--grad-b/--neon به‌صورت inline
//   · کارت‌ها:  body.cards-solid | cards-transparent | (glass = پیش‌فرض)
//   · پس‌زمینه: div ثابت #nf-theme-bg (رنگ/عکس/ویدیو) + بدنه‌ی شفاف
// ────────────────────────────────────────────────────────────────────

function ensureBgLayer() {
  let layer = document.getElementById('nf-theme-bg')
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'nf-theme-bg'
    document.body.prepend(layer)
  }
  return layer
}

export function applyTheme(theme) {
  const body = document.body
  // پاکسازی تم قبلی
  body.classList.remove('nf-custom-theme', 'cards-solid', 'cards-transparent')
  body.style.removeProperty('--grad-a')
  body.style.removeProperty('--grad-b')
  body.style.removeProperty('--neon')
  body.style.removeProperty('--gradient')
  body.style.removeProperty('--gradient-hover')
  const layer = document.getElementById('nf-theme-bg')
  if (layer) { layer.removeAttribute('style'); layer.innerHTML = ''; layer.style.display = 'none' }

  if (!theme) return

  body.classList.add('nf-custom-theme')
  body.style.setProperty('--grad-a', theme.accent || '#9333ea')
  body.style.setProperty('--grad-b', theme.accent2 || theme.accent || '#ec4899')
  body.style.setProperty('--neon', theme.accent || '#9333ea')
  body.style.setProperty('--gradient', `linear-gradient(135deg, ${theme.accent || '#9333ea'}, ${theme.accent2 || theme.accent || '#ec4899'})`)
  body.style.setProperty('--gradient-hover', `linear-gradient(135deg, ${theme.accent2 || theme.accent || '#ec4899'}, ${theme.accent || '#9333ea'})`)

  if (theme.card_style === 'solid') body.classList.add('cards-solid')
  else if (theme.card_style === 'transparent') body.classList.add('cards-transparent')
  // 'glass' = همون استایل پیش‌فرض سایت

  if (theme.bg_type && theme.bg_type !== 'none' && theme.bg_value) {
    const bg = ensureBgLayer()
    bg.style.display = 'block'
    if (theme.bg_type === 'color') {
      bg.style.background = theme.bg_value
    } else if (theme.bg_type === 'image') {
      bg.style.background = `linear-gradient(rgba(10,8,20,.35), rgba(10,8,20,.55)), url("${theme.bg_value}") center / cover no-repeat fixed`
    } else if (theme.bg_type === 'video') {
      bg.innerHTML = `<video src="${theme.bg_value}" autoplay muted loop playsinline></video><div class="nf-theme-bg-shade"></div>`
    }
  }
}

// پیش‌نمایش موقت تم (توی پنل ادمین) — با تأیید ذخیره می‌شه، با لغو برمی‌گرده
export function previewTheme(theme) {
  applyTheme(theme)
}
