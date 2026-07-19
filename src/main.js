import './styles/main.css'
import { initRouter, route, setNotFound } from './lib/router.js'
import { supabase } from './lib/supabaseClient.js'
import { initMode } from './lib/appearance.js'
import { applyLangDir } from './lib/i18n.js'

// حالت روز/شب و جهت زبان ذخیره‌شده رو همون اول کار اعمال کن (قبل از رندر صفحات)
initMode()
applyLangDir()

import loginPage from './pages/login.js'
import feedPage from './pages/feed.js'
import reelsPage from './pages/reels.js'
import groupsPage from './pages/groups.js'
import groupDetailPage from './pages/groupDetail.js'
import lobbiesPage from './pages/lobbies.js'
import lobbyDetailPage from './pages/lobbyDetail.js'
import profilePage from './pages/profile.js'
import publicProfilePage from './pages/publicProfile.js'
import adminPage from './pages/admin.js'
import ticketsPage from './pages/tickets.js'

route('/login', loginPage)
route('/feed', feedPage)
route('/reels', reelsPage)
route('/groups', (parts) => parts.length ? groupDetailPage(parts) : groupsPage())
route('/lobbies', (parts) => parts.length ? lobbyDetailPage(parts) : lobbiesPage())
route('/profile', (parts) => profilePage(parts)) // ارسال آرگومان‌ها به صورت مستقیم به پروفایل
route('/tickets', ticketsPage)
route('/admin', adminPage)

setNotFound(() => {
  window.location.hash = '/feed'
  return `<div class="spinner"></div>`
})

initRouter()

// ---------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------
async function markOnline(isOnline) {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return
  await supabase.from('users').update({ is_online: isOnline, last_seen_at: new Date().toISOString() }).eq('id', userId)
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') markOnline(true)
  if (event === 'SIGNED_OUT') markOnline(false)
})

window.addEventListener('load', () => markOnline(true))
window.addEventListener('beforeunload', () => markOnline(false))
setInterval(() => markOnline(true), 60_000)
