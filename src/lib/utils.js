export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'همین الان'
  if (diff < 3600) return `${Math.floor(diff / 60)} دقیقه پیش`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعت پیش`
  return `${Math.floor(diff / 86400)} روز پیش`
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
