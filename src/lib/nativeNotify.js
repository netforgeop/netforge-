import { t } from './i18n.js'
import { icon } from './utils.js'

// ─────────────────────────────────────────────────────────────────────
// اعلان‌های سیستمی (مثل تلگرام/اینستاگرام): گرفتن مجوز Notification API
// + نمایش بنر سیستمی وقتی تب دیده نمی‌شه (پس‌زمینه/مینیمایز).
// ─────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'nf_native_notif_dismissed'
const ICON_192 = `${import.meta.env.BASE_URL}icons/icon-192.png`

export function nativeNotifSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function nativeNotifGranted() {
  return nativeNotifSupported() && Notification.permission === 'granted'
}

// پاپ‌آپ شیشه‌ای کوچک گوشه‌ی صفحه برای گرفتن مجوز (فقط یک بار؛ «بعداً» = ۷ روز سکوت)
export function initNativeNotifPrompt(delayMs = 6500) {
  if (!nativeNotifSupported()) return
  if (Notification.permission !== 'default') return
  setTimeout(() => {
    try {
      if (Notification.permission !== 'default') return
      const last = Number(localStorage.getItem(DISMISS_KEY) || 0)
      if (Date.now() - last < 7 * 864e5) return
      if (document.querySelector('.native-notif-prompt')) return

      const el = document.createElement('div')
      el.className = 'glass card native-notif-prompt'
      el.innerHTML = `
        <b class="row" style="gap:6px;">${icon('bell')} ${t('اعلان‌های سیستمی', 'System notifications')}</b>
        <p class="text-dim" style="font-size:12.5px; line-height:1.8; margin:8px 0 12px;">
          ${t('مثل تلگرام و اینستاگرام، اعلان‌هام با صدا روی گوشی/کامپیوترت بنر بشن؟ (حتی وقتی تب رو بستی یا مینیمایز کردی)', 'Want Telegram/Instagram-style banner notifications with sound (even when the tab is minimized)?')}
        </p>
        <div class="row" style="gap:8px;">
          <button class="primary" id="nn-yes" style="flex:1;">${icon('check')} ${t('بله، روشن کن', 'Turn on')}</button>
          <button id="nn-later">${t('بعداً', 'Later')}</button>
        </div>`
      document.body.appendChild(el)

      el.querySelector('#nn-yes').addEventListener('click', async () => {
        try { await Notification.requestPermission() } catch (_) { /* سکوت */ }
        el.remove()
      })
      el.querySelector('#nn-later').addEventListener('click', () => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()))
        el.remove()
      })
    } catch (_) { /* سکوت */ }
  }, delayMs)
}

// نمایش بنر سیستمی — فقط وقتی تب دیده نمی‌شه (وگرنه صدای داخل اپ کافیه)
export async function showNativeNotif(title, body, hashUrl, tag) {
  if (!nativeNotifGranted()) return
  if (!document.hidden) return
  try {
    const absUrl = hashUrl ? `${location.origin}${import.meta.env.BASE_URL}${hashUrl}` : `${location.origin}${import.meta.env.BASE_URL}`
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: ICON_192,
          badge: ICON_192,
          dir: 'rtl',
          lang: 'fa',
          tag: tag || 'netforge-notif',
          data: { url: absUrl }
        })
        return
      }
    }
    const n = new Notification(title, { body, icon: ICON_192, tag: tag || 'netforge-notif' })
    n.onclick = () => { window.focus(); if (absUrl) window.location.href = absUrl }
  } catch (_) { /* سکوت */ }
}
