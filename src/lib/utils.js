import { t } from './i18n.js'

export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return t('همین الان', 'just now')
  if (diff < 3600) return t(`${Math.floor(diff / 60)} دقیقه پیش`, `${Math.floor(diff / 60)}m ago`)
  if (diff < 86400) return t(`${Math.floor(diff / 3600)} ساعت پیش`, `${Math.floor(diff / 3600)}h ago`)
  return t(`${Math.floor(diff / 86400)} روز پیش`, `${Math.floor(diff / 86400)}d ago`)
}

// وضعیت آنلاین: ملاک «تازگی آخرین فعالیت» است نه پرچم is_online
// (چون گرفتن SIGNED_OUT/beforeunload — مخصوصاً روی موبایل — قابل اعتماد نیست و پرچم گیر می‌کند).
// هر ۶۰ ثانیه heartbeat مقدار last_seen_at را تازه می‌کند؛ پس < ۲.۵ دقیقه = آنلاین.
export function isOnlineNow(u) {
  if (!u || !u.last_seen_at) return false
  const ts = new Date(u.last_seen_at).getTime()
  if (Number.isNaN(ts)) return false
  return (Date.now() - ts) < 150_000
}

export function toast(message, { error = false, ms = 3200 } = {}) {
  const el = document.createElement('div')
  el.className = 'toast' + (error ? ' error' : '')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), ms)
}

export function qs(root, sel) { return root.querySelector(sel) }
export function qsa(root, sel) { return [...root.querySelectorAll(sel)] }

// آیکون Font Awesome — جایگزین رسمی ایموجی‌ها در کل رابط کاربری
export function icon(name, cls = '') {
  return `<i class="fa-solid fa-${name}${cls ? ' ' + cls : ''}"></i>`
}
