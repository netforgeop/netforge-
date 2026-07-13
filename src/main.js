import './styles/main.css'
import { initRouter, route, setNotFound } from './lib/router.js'
import { supabase } from './lib/supabaseClient.js'

import loginPage from './pages/login.js'
import feedPage from './pages/feed.js'
import groupsPage from './pages/groups.js'
import groupDetailPage from './pages/groupDetail.js'
import lobbiesPage from './pages/lobbies.js'
import lobbyDetailPage from './pages/lobbyDetail.js'
import profilePage from './pages/profile.js'
import adminPage from './pages/admin.js'

route('/login', loginPage)
route('/feed', feedPage)
route('/groups', (parts) => parts.length ? groupDetailPage(parts) : groupsPage())
route('/lobbies', (parts) => parts.length ? lobbyDetailPage(parts) : lobbiesPage())
route('/profile', (parts) => profilePage(parts)) // ارسال آرگومان‌ها به صورت مستقیم به پروفایل
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
