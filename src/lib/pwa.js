import { escapeHtml, icon } from './utils.js'
import { t } from './i18n.js'

// ════════════════════════════════════════════════════════════════════
//  پیشنهاد نصب سایت (PWA) — پاپ‌آپ شیشه‌ای با لوگوی نت‌فورج
//  · کروم/اج (گوشی و کامپیوتر): رویداد beforeinstallprompt واقعی
//  · iOS Safari: دستورالعمل Share → Add to Home Screen
//  کاربر اگه «بعداً» بزنه به مدت ۷ روز دیگه سؤال نمی‌شه.
// ════════════════════════════════════════════════════════════════════

const DISMISS_KEY = 'nf_pwa_dismissed'
const DISMISS_DAYS = 7

let deferredPrompt = null
let promptShownOnce = false

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
})

function isIOS() {
  const ua = window.navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) && !window.navigator.standalone
}

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function dismissedRecently() {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch { return false }
}

function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
}

export function maybeShowInstallPrompt() {
  if (promptShownOnce || isInstalled() || dismissedRecently()) return

  // کمی صبر تا پاپ‌آپ‌های دیگه (مسئولیت‌پذیری/اخطار) تداخل نکنن
  setTimeout(() => {
    if (promptShownOnce || isInstalled()) return

    if (deferredPrompt) {
      showModal({
        title: t('نت‌فورج رو نصب کن!', 'Install NetForge!'),
        body: t('سایت مثل یه اپ واقعی روی گوشی/کامپیوترت می‌شینه — آیکون رو صفحه‌ی اصلی، بدون نوار مرورگر، سرعت بیشتر.', 'NetForge works like a real app — home-screen icon, no browser bar, faster launch.'),
        confirmText: `${icon('download')} ${t('نصب', 'Install')}`,
        onConfirm: async () => {
          const p = deferredPrompt
          deferredPrompt = null
          p.prompt()
          try { await p.userChoice } catch { /* cancelled */ }
          dismiss()
        }
      })
    } else if (isIOS()) {
      showModal({
        title: t('نت‌فورج رو به صفحه‌ی اصلی اضافه کن', 'Add NetForge to your Home Screen'),
        bodyHTML: t(
          `توی سافاری: دکمه‌ی <b>Share</b> <i class="fa-solid fa-arrow-up-from-bracket"></i> پایین مرورگر رو بزن بعد <b>«Add to Home Screen»</b> رو انتخاب کن.<br><span class="text-dim">اونوقت آیکون نت‌فورج مثل اپ رو صفحه‌ی گوشیت می‌افته و بدون نوار مرورگر باز می‌شه.</span>`,
          `In Safari: tap the <b>Share</b> <i class="fa-solid fa-arrow-up-from-bracket"></i> button, then choose <b>«Add to Home Screen»</b>.<br><span class="text-dim">NetForge will sit on your home screen like an app and open full-screen.</span>`
        ),
        confirmText: null
      })
    }
  }, 2500)
}

function showModal({ title, body, bodyHTML, confirmText, onConfirm }) {
  if (document.getElementById('pwa-install-modal')) return
  promptShownOnce = true
  const wrap = document.createElement('div')
  wrap.id = 'pwa-install-modal'
  wrap.className = 'modal-backdrop pwa-install-backdrop'
  wrap.innerHTML = `
    <div class="glass modal pwa-install-modal">
      <img src="icons/icon-192.png" class="pwa-install-icon" alt="NetForge">
      <h3>${escapeHtml(title)}</h3>
      ${bodyHTML ? `<p class="pwa-install-body">${bodyHTML}</p>` : `<p class="pwa-install-body">${escapeHtml(body || '')}</p>`}
      <div class="row" style="gap:8px; width:100%;">
        ${confirmText ? `<button class="primary" id="pwa-install-confirm" style="flex:1;">${confirmText}</button>` : ''}
        <button id="pwa-install-later" style="flex:1;">${t('بعداً', 'Not now')}</button>
      </div>
    </div>
  `
  document.body.appendChild(wrap)
  const close = () => { wrap.remove(); dismiss() }
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
  wrap.querySelector('#pwa-install-later').addEventListener('click', close)
  wrap.querySelector('#pwa-install-confirm')?.addEventListener('click', async () => {
    try { await onConfirm?.() } catch { /* ignore */ }
    wrap.remove()
  })
}
