/* سرویس‌ورکر NetForge — باعث می‌شه سایت «قابل نصب» بشه (آیکون روی گوشی/کامپیوتر
   و باز شدن بدون نوار مرورگر). کش: صفحه‌ی اصلی همیشه اول از شبکه (network-first)،
   فایل‌های استاتیک هش‌دار cache-first تا آپدیت‌ها گیر نکنن. */

const CACHE = 'netforge-v6-4'
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // فقط ریکوئست‌های GET و همین origin — Supabase و CDNهای خارجی مستقیم از شبکه
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // صفحات: همیشه اول شبکه (تا همیشه آخرین نسخه بیاد)، موقع آفلاین از کش
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('index.html', copy))
          return res
        })
        .catch(() => caches.match('index.html'))
    )
    return
  }

  // بقیه فایل‌ها (اسکریپت/استایل/آیکون هش‌دار): cache-first
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit
      return fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      })
    })
  )
})
