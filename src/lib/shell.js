import { requireAuth, getMyProfile } from './auth.js'
import { renderTopnav, attachTopnav } from '../components/navbar.js'
import { showResponsibilityModal } from '../components/responsibilityModal.js'

/**
 * هر صفحه‌ی داخل داشبورد این رو صدا می‌زنه:
 *   return withShell('feed', async (profile) => ({ html, mount }))
 * خودش auth، پروفایل، نوار بالا و پاپ‌آپ مسئولیت‌پذیری رو مدیریت می‌کنه.
 */
export async function withShell(activeTab, buildContent) {
  const session = await requireAuth()
  if (!session) return { html: `<div class="spinner"></div>` }

  const profile = await getMyProfile()
  if (!profile) {
    return { html: `<div class="container empty-state">پروفایل پیدا نشد. لطفاً دوباره وارد شوید.</div>` }
  }

  const content = await buildContent(profile)

  const html = `
    ${renderTopnav(profile, activeTab)}
    <div class="container">${content.html}</div>
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
