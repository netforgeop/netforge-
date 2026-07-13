import { neonClass } from '../lib/auth.js'
import { escapeHtml } from '../lib/utils.js'

export function renderTopnav(profile, activeTab) {
  const tabs = [
    { key: 'feed', label: 'فید' },
    { key: 'groups', label: 'گروه‌ها' },
    { key: 'lobbies', label: 'لابی بازی' }
  ]
  if (profile.role === 'admin') tabs.push({ key: 'admin', label: 'پنل ادمین' })

  const roleBadge = profile.role === 'admin'
    ? '<span class="badge admin">Admin</span>'
    : profile.role === 'moderator'
      ? '<span class="badge mod">Mod</span>'
      : ''

  return `
    <div class="topnav">
      <div class="row">
        <div class="brand">محفل</div>
        <div class="tabs">
          ${tabs.map(t => `<button data-tab="${t.key}" class="${t.key === activeTab ? 'active' : ''}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div class="row">
        ${roleBadge}
        <a href="#/profile" title="${escapeHtml(profile.nickname)}">
          <img class="avatar sm ${neonClass(profile.neon_color)}" src="${escapeHtml(profile.avatar_url || defaultAvatar(profile.nickname))}" alt="">
        </a>
        <button id="logout-btn">خروج</button>
      </div>
    </div>
  `
}

export function attachTopnav(root) {
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => { window.location.hash = '/' + btn.dataset.tab })
  })
  const logoutBtn = root.querySelector('#logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const { logOut } = await import('../lib/auth.js')
      await logOut()
      window.location.hash = '/login'
    })
  }
}

export function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(seed || 'guest')}`
}
