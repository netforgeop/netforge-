import { requireAuth, getMyProfile } from './auth.js'
import { supabase } from './supabaseClient.js'
import { renderTopnav, attachTopnav } from '../components/navbar.js'
import { showResponsibilityModal } from '../components/responsibilityModal.js'
import { getMyActiveSanction, sanctionMessage } from './moderation.js'
import { initWarningWatcher } from './warnings.js'
import { escapeHtml, icon } from './utils.js'
import { applyAccent, applyTheme } from './appearance.js'
import { t } from './i18n.js'

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
    return { html: `<div class="container empty-state">${t('پروفایل پیدا نشد. لطفاً دوباره وارد شوید.', 'Profile not found. Please log in again.')}</div>` }
  }

  // رنگ اصلی سایت (دکمه‌های primary، تب فعال، بج‌ها، حباب چت من) از
  // رنگ نئونی که کاربر توی پروفایلش انتخاب کرده میاد
  applyAccent(profile.neon_color)

  // تم سفارشی فعال (ساخته‌ی ادمین) — اگر کاربر انتخابش کرده، روی اکسنت سوار می‌شه
  if (profile.active_theme_id) {
    try {
      const { data: th } = await supabase.from('themes').select('*').eq('id', profile.active_theme_id).single()
      if (th) applyTheme(th)
      else await supabase.from('users').update({ active_theme_id: null }).eq('id', profile.id)
    } catch (err) {
      console.warn('theme apply skipped:', err.message)
    }
  }

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
          <div style="font-size:48px; color:var(--danger);"><i class="fa-solid fa-ban"></i></div>
          <h2>${t('حساب شما مسدود شده است', 'Your account is banned')}</h2>
          <p class="text-dim">${escapeHtml(sanctionMessage(sanction))}</p>
          ${sanction.reason ? `<p class="text-dim">${t('دلیل:', 'Reason:')} ${escapeHtml(sanction.reason)}</p>` : ''}
          <button id="banned-logout-btn" class="danger" style="margin-top:15px;">${t('خروج از حساب', 'Log out')}</button>
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
         ${icon('triangle-exclamation')} ${escapeHtml(sanctionMessage(sanction))}
       </div>`
    : ''

  const html = `
    ${renderTopnav(profile, activeTab)}
    <div class="container">${muteBanner}${content.html}</div>
  `

  async function mount(app) {
    attachTopnav(app)
    await content.mount?.(app, profile)
    // اخطارهای مدیریت: خوانده‌نشده‌ها الان، جدیدها به‌صورت realtime پاپ‌آپ می‌شن
    initWarningWatcher(profile)
    if (!profile.has_seen_responsibility_popup) {
      showResponsibilityModal(profile.id)
    }
  }

  return { html, mount }
}
