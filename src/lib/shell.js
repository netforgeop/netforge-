import { requireAuth, getMyProfile } from './auth.js'
import { renderTopnav, attachTopnav } from '../components/navbar.js'
import { showResponsibilityModal } from '../components/responsibilityModal.js'
import { getMyActiveSanction, sanctionMessage } from './moderation.js'
import { escapeHtml } from './utils.js'
import { applyAccent } from './appearance.js'

/**
 * هر صفحه‌ی داخل داشبورد این رو صدا می‌زنه:
 *   return withShell('feed', async (profile) => ({ html, mount }))
 * خودش auth، پروفایل، نوار بالا و پاپ‌آپ مسئولیت‌پذیری رو مدیریت می‌کنه.
 * ── جدید: قبل از ساخت صفحه، وضعیت محدودیت کاربر رو هم چک می‌کنه ──
 *   · ban     → صفحه‌ی «حساب مسدود» (هیچ محتوایی داده نمی‌شه)
 *   · mute    → صفحه لود می‌شه ولی بنر هشدار بالاش میاد و فرم‌های ارسال
 *               محتوا (چت/کامنت/پست) خودشون چک می‌کنن و اجازه نمی‌دن
 */
export async function withShell(activeTab, buildContent) {
  const session = await requireAuth()
  if (!session) return { html: `<div class="spinner"></div>` }

  const profile = await getMyProfile()
  if (!profile) {
    return { html: `<div class="container empty-state">پروفایل پیدا نشد. لطفاً دوباره وارد شوید.</div>` }
  }

  // رنگ اصلی سایت (دکمه‌های primary، تب فعال، بج‌ها، حباب چت من) از
  // رنگ نئونی که کاربر توی پروفایلش انتخاب کرده میاد
  applyAccent(profile.neon_color)

  // چک محدودیت‌های فعال (اگه جدول sanctions هنوز ساخته نشده باشه، null برمی‌گرده و همه‌چیز مثل قبل کار می‌کنه)
  const sanction = await getMyActiveSanction(profile.id)

  // محدودیت فعال رو روی آبجکت پروفایل می‌ذاریم تا همه‌ی صفحات و کامپوننت‌ها
  // (فرم چت، فرم کامنت، مودال پست و...) بدون کوئری اضافه بهش دسترسی داشته باشن
  profile.activeSanction = sanction || null

  // ── بن کامل: هیچ صفحه‌ای سرو نمی‌شه ──
  if (sanction?.type === 'ban') {
    const html = `
      <div class="container" style="max-width:480px; padding-top:80px;">
        <div class="glass" style="padding:32px; text-align:center;">
          <div style="font-size:48px;">⛔</div>
          <h2>حساب شما مسدود شده است</h2>
          <p class="text-dim">${escapeHtml(sanctionMessage(sanction))}</p>
          ${sanction.reason ? `<p class="text-dim">دلیل: ${escapeHtml(sanction.reason)}</p>` : ''}
          <button id="banned-logout-btn" class="danger" style="margin-top:15px;">خروج از حساب</button>
        </div>
      </div>
    `
    return {
      html,
      mount: () => {
        document.getElementById('banned-logout-btn')?.addEventListener('click', async () => {
          const { logOut } = await import('./auth.js')
          await logOut()
          window.location.hash = '/login'
        })
      }
    }
  }

  const content = await buildContent(profile)

  // بنر هشدار برای mute/timeout بالای همه‌ی صفحات
  const muteBanner = sanction
    ? `<div class="glass sanction-banner" style="padding:10px 14px; margin-bottom:14px; border-color:var(--danger);">
         ⚠️ ${escapeHtml(sanctionMessage(sanction))}
       </div>`
    : ''

  const html = `
    ${renderTopnav(profile, activeTab)}
    <div class="container">${muteBanner}${content.html}</div>
  `

  async function mount(app) {
    attachTopnav(app)
    await content.mount?.(app, profile)
    if (!profile.has_seen_responsibility_popup) {
      showResponsibilityModal(profile.id)
    }
  }

  return { html, mount }
}
