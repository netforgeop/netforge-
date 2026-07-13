import { neonClass } from '../lib/auth.js'
import { escapeHtml } from '../lib/utils.js'

export function renderTopnav(profile, activeTab) {
  const tabs = [
    { key: 'feed', icon: '🏠', label: 'Home' },
    { key: 'new-post', icon: '➕', label: 'Create' },
    { key: 'groups', icon: '👥', label: 'Groups' },
    { key: 'lobbies', icon: '🎮', label: 'Games' }
  ]
  if (profile.role === 'admin') tabs.push({ key: 'admin', icon: '⚙️', label: 'Admin' })

  const roleBadge = profile.role === 'admin'
    ? '<span class="badge admin">Admin</span>'
    : profile.role === 'moderator'
      ? '<span class="badge mod">Mod</span>'
      : ''

  return `
    <!-- سایدبار دسکتاپ سمت چپ (Discord structure) و نوار پایین گوشی (Instagram design) -->
    <div class="topnav">
      <div class="brand">NetForge</div>
      
      <div class="tabs">
        ${tabs.map(t => `
          <button data-tab="${t.key}" class="${t.key === activeTab ? 'active' : ''}">
            <span class="nav-icon">${t.icon}</span>
            <span class="nav-label">${t.label}</span>
          </button>
        `).join('')}
      </div>

      <div class="user-control-row">
        <!-- زنگوله نوتیفیکیشن -->
        <button id="noti-bell-btn" style="background:transparent; border:none; font-size:18px; position:relative; padding:4px;">
          🔔
          <span id="noti-badge" class="presence-dot online" style="display:none; position:absolute; top:2px; left:2px; width:8px; height:8px; background:var(--danger);"></span>
        </button>
        
        <a href="#/profile" title="${escapeHtml(profile.nickname)}" class="row" style="gap:8px; color:inherit; text-decoration:none;">
          <img class="avatar sm ${neonClass(profile.neon_color)}" src="${profile.avatar_url || defaultAvatar(profile.nickname)}" alt="">
          <span class="nav-label bold-username">${escapeHtml(profile.nickname)}</span>
        </a>

        <button id="logout-btn" class="nav-label" style="padding: 6px 10px; font-size:12px;">خروج</button>
      </div>
    </div>

    <!-- دراپ‌داون نوتیفیکیشن‌ها -->
    <div id="noti-dropdown" class="glass" style="display:none; position:absolute; top:65px; left:20px; z-index:100; width:280px; max-height:360px; overflow-y:auto; padding:10px; font-size:13px; box-shadow:var(--shadow-glass);">
      <div class="row between" style="border-bottom:1px solid var(--glass-border); padding-bottom:6px; margin-bottom:8px;">
        <b>اعلان‌ها (Notifications)</b>
        <button id="clear-notis-btn" style="padding:2px 6px; font-size:11px;">خوانده شد</button>
      </div>
      <div id="notis-list" class="stack" style="gap:8px;">
        <div class="text-dim" style="text-align:center; padding:10px;">هیچ اعلانی نیست</div>
      </div>
    </div>

    <!-- مودال/صفحه ساخت پست جدید به سبک اینستاگرام -->
    <div id="create-post-modal" class="modal-backdrop" style="display:none;">
      <div class="glass modal instagram-new-post-modal">
        <div class="new-post-modal-header row between">
          <button class="close-modal-btn" id="close-post-modal-btn">✕</button>
          <h3>Create New Post</h3>
          <button class="share-post-btn-insta" id="submit-post-btn">Share</button>
        </div>
        <form id="new-post-form" class="stack" style="gap:15px; padding-top:15px;">
          <div class="row" style="align-items: flex-start; gap:12px;">
            <img class="avatar sm ${neonClass(profile.neon_color)}" src="${profile.avatar_url || defaultAvatar(profile.nickname)}">
            <textarea name="caption" placeholder="Write a caption..." rows="4" style="border:none; background:transparent; padding:0; resize:none; font-size:15px;" required></textarea>
          </div>
          <div style="border-top: 1px solid var(--glass-border); padding-top:12px;">
            <input name="media_url" placeholder="Paste image/video URL here..." style="background:var(--glass-strong); font-size:13px;" />
          </div>
          <label class="row" style="font-size:13px; width:auto; cursor:pointer;">
            <input type="checkbox" name="ratings_enabled" checked style="width:auto; margin:0 5px;" />
            فعال بودن امتیازدهی ستاره‌ای
          </label>
        </form>
      </div>
    </div>
  `
}

export function attachTopnav(root) {
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      if (tab === 'new-post') {
        const postModal = root.querySelector('#create-post-modal')
        if (postModal) postModal.style.display = 'flex'
      } else {
        window.location.hash = '/' + tab
      }
    })
  })

  // کنترل مودال ساخت پست جدید
  const postModal = root.querySelector('#create-post-modal')
  const closePostModalBtn = root.querySelector('#close-post-modal-btn')
  const submitPostBtn = root.querySelector('#submit-post-btn')
  const postForm = root.querySelector('#new-post-form')

  closePostModalBtn?.addEventListener('click', () => {
    if (postModal) postModal.style.display = 'none'
  })

  submitPostBtn?.addEventListener('click', async () => {
    if (!postForm) return
    const fd = new FormData(postForm)
    const caption = fd.get('caption')?.trim()
    const media_url = fd.get('media_url')?.trim() || null
    if (!caption) {
      toast('لطفاً متنی برای پست بنویسید', { error: true })
      return
    }
    submitPostBtn.disabled = true
    try {
      const { supabase } = await import('../lib/supabaseClient.js')
      const { data: session } = await supabase.auth.getSession()
      const meId = session.session?.user?.id
      
      const { error } = await supabase.from('posts').insert({
        author_id: meId,
        media_url,
        caption,
        ratings_enabled: !!fd.get('ratings_enabled')
      })
      if (error) throw error
      toast('پست جدید با موفقیت به اشتراک گذاشته شد!')
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      submitPostBtn.disabled = false
    }
  })

  const logoutBtn = root.querySelector('#logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const { logOut } = await import('../lib/auth.js')
      await logOut()
      window.location.hash = '/login'
    })
  }

  // بخش نوتیفیکیشن‌ها
  const bellBtn = root.querySelector('#noti-bell-btn')
  const dropdown = root.querySelector('#noti-dropdown')
  const notisList = root.querySelector('#notis-list')
  const notiBadge = root.querySelector('#noti-badge')
  const clearBtn = root.querySelector('#clear-notis-btn')

  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'
    })

    document.addEventListener('click', () => { dropdown.style.display = 'none' })
    dropdown.addEventListener('click', (e) => e.stopPropagation())

    import('../lib/supabaseClient.js').then(async ({ supabase }) => {
      const { data: session } = await supabase.auth.getSession()
      const meId = session.session?.user?.id
      if (!meId) return

      async function loadNotifications() {
        const { data: notis } = await supabase
          .from('notifications')
          .select('*, sender:users!notifications_sender_id_fkey(nickname, avatar_url, neon_color)')
          .eq('user_id', meId)
          .order('created_at', { ascending: false })
          .limit(10)

        if (notis && notis.length) {
          const unread = notis.some(n => !n.is_read)
          notiBadge.style.display = unread ? 'block' : 'none'

          const localStoredCount = localStorage.getItem('noti_count') || '0'
          if (notis.length > Number(localStoredCount)) {
            playNotiSound()
          }
          localStorage.setItem('noti_count', notis.length.toString())

          notisList.innerHTML = notis.map(n => `
            <div class="row" style="align-items:flex-start; gap:8px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:6px; ${!n.is_read ? 'font-weight:bold; color:var(--neon);' : ''}">
              <a href="#/profile/${n.sender_id}">
                <img class="avatar sm" src="${n.sender?.avatar_url || defaultAvatar(n.sender?.nickname)}">
              </a>
              <div style="flex:1;">
                <div>${escapeHtml(n.message)}</div>
                <div class="text-dim" style="font-size:10px;">${new Date(n.created_at).toLocaleTimeString('fa-IR')}</div>
              </div>
            </div>
          `).join('')
        } else {
          notiBadge.style.display = 'none'
          notisList.innerHTML = '<div class="text-dim" style="text-align:center; padding:10px;">هیچ اعلانی نیست</div>'
        }
      }

      loadNotifications()

      supabase
        .channel(`notis:${meId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${meId}` }, () => {
          loadNotifications()
        })
        .subscribe()

      clearBtn?.addEventListener('click', async () => {
        await supabase.from('notifications').update({ is_read: true }).eq('user_id', meId)
        loadNotifications()
      })
    })
  }
}

function playNotiSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(587.33, audioCtx.currentTime)
  osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1)
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4)
  osc.start(audioCtx.currentTime)
  osc.stop(audioCtx.currentTime + 0.4)
}

export function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(seed || 'guest')}`
}
