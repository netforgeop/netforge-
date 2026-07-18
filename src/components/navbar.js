import { neonClass } from '../lib/auth.js'
import { escapeHtml, toast, icon } from '../lib/utils.js'
import { getMode, toggleMode } from '../lib/appearance.js'
import { t, getLang, toggleLang, dateLocale } from '../lib/i18n.js'

// نقشه‌ی نوع اعلان → آیکون و مقصد کلیک
const NOTI_ICONS = {
  follow_request: 'user-plus',
  follow_accept: 'user-check',
  new_follower: 'user-plus',
  new_post: 'image',
  post_comment: 'comment',
  post_reaction: 'heart',
  post_rating: 'star',
  group_message: 'comments',
  lobby_message: 'gamepad',
  lobby_invite: 'gamepad',
  invite_ready: 'envelope',
  group_invite: 'users',
  group_join_request: 'user-plus',
  group_accepted: 'circle-check',
  group_rejected: 'circle-xmark'
}

function notiLink(n) {
  switch (n.type) {
    case 'group_message':
    case 'group_invite':
    case 'group_join_request':
    case 'group_accepted':
    case 'group_rejected':
      // اگر target تهی بود (اعلان‌های قدیمیِ خراب) لااقل به لیست گروه‌ها بره
      return n.target_id ? `#/groups/${n.target_id}` : '#/groups'
    case 'lobby_message':
    case 'lobby_invite':
      // فیکس باگ QA: دعوت‌نامه‌های قدیمی بدون target_id به #/lobbies/null می‌رفتن
      return n.target_id ? `#/lobbies/${n.target_id}` : '#/lobbies'
    case 'new_post':
    case 'post_comment':
    case 'post_reaction':
    case 'post_rating': return '#/feed'
    case 'invite_ready': return '#/profile'
    default: return `#/profile/${n.sender_id}`
  }
}

// رفرنس ماژول-سطح به کانال نوتیفیکیشن؛ مثل چت، قبل از ساخت کانال جدید
// (با هر ناوبری/رندر مجدد) کانال قبلی رو می‌بندیم تا روی یه topic
// دو بار subscribe نشیم (سوپابیس روی topic تکراری خطا/هشدار می‌ده).
let notiChannel = null
// هندلر کلیک روی document برای بستن دراپ‌داون؛ با هر رندر دوباره اضافه نشه
let docClickHandler = null

export function renderTopnav(profile, activeTab) {
  const tabs = [
    { key: 'feed', label: t('خانه', 'Home'), icon: 'house' },
    { key: 'new-post', label: t('پست جدید', 'New Post'), icon: 'square-plus' },
    { key: 'groups', label: t('گروه‌ها', 'Groups'), icon: 'users' },
    { key: 'lobbies', label: t('بازی‌ها', 'Games'), icon: 'gamepad' }
  ]
  if (profile.role === 'admin') tabs.push({ key: 'admin', label: t('پنل مدیریت', 'Admin Panel'), icon: 'shield-halved' })

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
            <span class="nav-icon">${icon(t.icon)}</span>
            <span class="nav-label">${t.label}</span>
          </button>
        `).join('')}
      </div>
      <div class="row user-control-row" style="gap: 12px;">
        <!-- دکمه تعویض زبان (fa ⇆ en) — جهت کل سایت هم باهاش عوض می‌شه -->
        <button id="lang-toggle-btn" title="${getLang() === 'en' ? 'فارسی' : 'English'}" style="background:transparent; border:none; font-size:15px; padding:4px;">
          ${icon('globe')} <b style="font-size:11px;">${getLang() === 'en' ? 'فا' : 'EN'}</b>
        </button>
        <!-- دکمه تعویض حالت روز/شب — توی حالت شب آیکون خورشید (یعنی کلیک کن بری روز) و برعکس -->
        <button id="mode-toggle-btn" title="${t('تعویض حالت روز / شب', 'Toggle day/night')}" style="background:transparent; border:none; font-size:17px; padding:4px;">
          ${icon(getMode() === 'light' ? 'moon' : 'sun')}
        </button>
        <!-- دکمه زنگوله نوتیفیکیشن‌ها -->
        <button id="noti-bell-btn" style="background:transparent; border:none; font-size:18px; position:relative; padding:4px;">
          ${icon('bell')}
          <span id="noti-badge" class="presence-dot online" style="display:none; position:absolute; top:2px; left:2px; width:8px; height:8px; background:var(--danger);"></span>
        </button>
        ${roleBadge}
        <a href="#/profile" title="${escapeHtml(profile.nickname)}">
          <img class="avatar sm ${neonClass(profile.neon_color)}" src="${escapeHtml(profile.avatar_url || defaultAvatar(profile.nickname))}" alt="">
        </a>

        <button id="logout-btn" class="nav-label" style="padding: 6px 10px; font-size:12px;">${icon('right-from-bracket')} ${t('خروج', 'Log out')}</button>
      </div>
    </div>

    <!-- دراپ‌داون نوتیفیکیشن‌ها — ثابت روی صفحه (fixed)؛ موقعیتش با JS کنار زنگوله ست می‌شه -->
    <div id="noti-dropdown" class="glass" style="display:none; top:65px; left:20px; width:280px; max-height:360px; overflow-y:auto; padding:10px; font-size:13px; box-shadow:var(--shadow-glass);">
      <div class="row between" style="border-bottom:1px solid var(--glass-border); padding-bottom:6px; margin-bottom:8px;">
        <b>${t('اعلان‌ها', 'Notifications')}</b>
        <button id="clear-notis-btn" style="padding:2px 6px; font-size:11px;">${t('خوانده شد', 'Mark read')}</button>
      </div>
      <div id="notis-list" class="stack" style="gap:8px;">
        <div class="text-dim" style="text-align:center; padding:10px;">${t('هیچ اعلانی نیست', 'No notifications yet')}</div>
      </div>
    </div>

    <!-- مودال/صفحه ساخت پست جدید به سبک اینستاگرام -->
    <div id="create-post-modal" class="modal-backdrop" style="display:none;">
      <div class="glass modal instagram-new-post-modal">
        <div class="new-post-modal-header row between">
          <button class="close-modal-btn" id="close-post-modal-btn">${icon('xmark')}</button>
          <h3>${t('ساخت پست جدید', 'Create New Post')}</h3>
          ${['mute', 'timeout', 'ban'].includes(profile.activeSanction?.type) ? '<span></span>' : `<button class="share-post-btn-insta" id="submit-post-btn">${t('اشتراک', 'Share')}</button>`}
        </div>
        ${['mute', 'timeout', 'ban'].includes(profile.activeSanction?.type) ? `
          <div class="text-dim" style="text-align:center; padding:24px 8px;">
            ${icon('volume-xmark')} ${t('به خاطر محدودیت فعال نمی‌توانید پست بگذارید.', "You can't post due to an active restriction.")}
          </div>
        ` : `
          <form id="new-post-form" class="stack" style="gap:15px; padding-top:15px;">
            <div class="row" style="align-items: flex-start; gap:12px;">
              <img class="avatar sm ${neonClass(profile.neon_color)}" src="${escapeHtml(profile.avatar_url || defaultAvatar(profile.nickname))}">
              <textarea name="caption" placeholder="${t('کپشن بنویس...', 'Write a caption...')}" rows="4" style="border:none; background:transparent; padding:0; resize:none; font-size:15px;" required></textarea>
            </div>
            <div style="border-top: 1px solid var(--glass-border); padding-top:12px;">
              <input name="media_url" placeholder="${t('لینک عکس/ویدیو رو اینجا بذار...', 'Paste image/video URL here...')}" style="background:var(--glass-strong); font-size:13px;" />
            </div>
            <label class="row" style="font-size:13px; width:auto; cursor:pointer;">
              <input type="checkbox" name="ratings_enabled" checked style="width:auto; margin:0 5px;" />
              ${t('فعال بودن امتیازدهی ستاره‌ای', 'Enable star rating')}
            </label>
          </form>
        `}
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

  // کلیک روی پس‌زمینه تیره مودال هم اون رو می‌بنده (رفتار استاندارد اینستاگرام)
  postModal?.addEventListener('click', (e) => {
    if (e.target === postModal) postModal.style.display = 'none'
  })

  submitPostBtn?.addEventListener('click', async () => {
    if (!postForm) return
    const fd = new FormData(postForm)
    const caption = fd.get('caption')?.trim()
    const media_url = fd.get('media_url')?.trim() || null
    if (!caption) {
      toast(t('لطفاً متنی برای پست بنویسید', 'Please write a caption'), { error: true })
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
      toast(t('پست جدید با موفقیت به اشتراک گذاشته شد!', 'Post shared successfully!'))
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      submitPostBtn.disabled = false
    }
  })

  // دکمه تعویض زبان — ذخیره و رفرش تا همه‌ی رشته‌ها و جهت صفحه عوض بشه
  const langBtn = root.querySelector('#lang-toggle-btn')
  langBtn?.addEventListener('click', () => {
    const next = toggleLang()
    location.reload()
  })

  // دکمه تعویض حالت روز/شب
  const modeBtn = root.querySelector('#mode-toggle-btn')
  modeBtn?.addEventListener('click', () => {
    const m = toggleMode()
    modeBtn.innerHTML = icon(m === 'light' ? 'moon' : 'sun')
    toast(m === 'light' ? t('حالت روز فعال شد', 'Light mode on') : t('حالت شب فعال شد', 'Dark mode on'))
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
    // موقعیت‌دهی دقیق دراپ‌داون کنار زنگوله (fixed = با اسکرول تکون نمی‌خوره)
    // اگر زنگوله نیمه‌ی بالای صفحه‌ست → دراپ‌داون زیرش باز می‌شه؛
    // اگر ته صفحه‌ست (سایدبار دسکتاپ) → بالای زنگوله باز می‌شه تا بیرون نره.
    function positionDropdown() {
      const rect = bellBtn.getBoundingClientRect()
      const margin = 10
      const ddW = 280
      dropdown.style.top = 'auto'
      dropdown.style.bottom = 'auto'
      dropdown.style.left = 'auto'
      dropdown.style.right = 'auto'
      // افقی: پهنای دراپ‌داون به لبه‌ی زنگوله تراز می‌شه و هیچ‌وقت از صفحه بیرون نمی‌زنه
      // (در RTL به سمت چپ باز می‌شه، در LTR به سمت راست)
      let x = document.documentElement.dir === 'rtl'
        ? window.innerWidth - rect.right - 20
        : rect.left - ddW + rect.width + 20
      x = Math.max(10, Math.min(x, window.innerWidth - ddW - 10))
      dropdown.style.left = x + 'px'
      // عمودی
      if (rect.top < 160) {
        dropdown.style.top = (rect.bottom + margin) + 'px'
      } else {
        dropdown.style.bottom = (window.innerHeight - rect.top + margin) + 'px'
      }
    }

    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const opening = dropdown.style.display === 'none'
      if (opening) positionDropdown()
      dropdown.style.display = opening ? 'block' : 'none'
    })

    // با هر رندرِ صفحه attachTopnav دوباره صدا زده می‌شه؛ اگه هر بار یه
    // listener جدید به document اضافه کنیم جمع می‌شن. فقط یه بار ثبت می‌کنیم.
    if (docClickHandler) {
      document.removeEventListener('click', docClickHandler)
    }
    docClickHandler = () => {
      const dd = document.getElementById('noti-dropdown')
      if (dd) dd.style.display = 'none'
    }
    document.addEventListener('click', docClickHandler)
    dropdown.addEventListener('click', (e) => e.stopPropagation())

    // گرفتن زنده اعلان‌ها از دیتابیس
    import('../lib/supabaseClient.js').then(async ({ supabase }) => {
      const { data: session } = await supabase.auth.getSession()
      const meId = session.session?.user?.id
      if (!meId) return

      // نیک‌نیم خودم برای متن اعلان «فالوت قبول شد»
      const { data: meRow } = await supabase.from('users').select('nickname').eq('id', meId).single()
      const myNickname = meRow?.nickname || t('یکی از کاربران', 'Someone')

      // قبول/رد درخواست فالو از داخل دراپ‌داون اعلان‌ها
      async function answerFollowRequest(senderId, notifId, accept) {
        try {
          if (accept) {
            const { error } = await supabase
              .from('follows')
              .update({ status: 'accepted' })
              .match({ follower_id: senderId, following_id: meId })
            if (error) throw error
            await supabase.from('notifications').insert({
              user_id: senderId,
              sender_id: meId,
              type: 'follow_accept',
              message: `${myNickname} ${t('درخواست فالوت رو قبول کرد', 'accepted your follow request')}`
            })
            toast(t('درخواست فالو قبول شد', 'Follow request accepted'))
          } else {
            await supabase.from('follows').delete().match({ follower_id: senderId, following_id: meId })
            toast(t('درخواست فالو رد شد', 'Follow request declined'))
          }
          await supabase.from('notifications').update({ is_read: true }).eq('id', notifId)
          loadNotifications()
        } catch (err) {
          toast(err.message, { error: true })
        }
      }

      async function loadNotifications() {
        // ممکنه کاربر وسط لود صفحه عوض کنه؛ اگه المان‌ها دیگه توی DOM نیستن، کاری نکن
        if (!document.getElementById('notis-list')) return
        const { data: notis } = await supabase
          .from('notifications')
          .select('*, sender:users!notifications_sender_id_fkey(nickname, avatar_url, neon_color)')
          .eq('user_id', meId)
          .order('created_at', { ascending: false })
          .limit(10)

        if (notis && notis.length) {
          const unread = notis.some(n => !n.is_read)
          notiBadge.style.display = unread ? 'block' : 'none'

          // اگر نوتیفیکیشن خوانده نشده جدید آمد، صدای زنگوله پخش کن
          const localStoredCount = localStorage.getItem('noti_count') || '0'
          if (notis.length > Number(localStoredCount)) {
            playNotiSound()
          }
          localStorage.setItem('noti_count', notis.length.toString())

          notisList.innerHTML = notis.map(n => `
            <a href="${notiLink(n)}" class="row noti-item" data-notif-id="${n.id}" style="align-items:flex-start; gap:8px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:6px; color:inherit; text-decoration:none; ${!n.is_read ? 'font-weight:bold; color:var(--neon);' : ''}">
              <img class="avatar sm" src="${escapeHtml(n.sender?.avatar_url || defaultAvatar(n.sender?.nickname))}">
              <div style="flex:1;">
                <div><span style="margin-left:5px; opacity:.8;">${icon(NOTI_ICONS[n.type] || 'bell')}</span>${escapeHtml(n.message)}</div>
                <div class="text-dim" style="font-size:10px;">${new Date(n.created_at).toLocaleTimeString(dateLocale())}</div>
                ${n.type === 'follow_request' ? `
                  <div class="row" style="gap:6px; margin-top:5px;">
                    <button class="follow-accept-btn" data-sender="${n.sender_id}" data-notif="${n.id}" style="padding:3px 10px; font-size:11px;">${icon('check')} ${t('قبول', 'Accept')}</button>
                    <button class="follow-decline-btn danger" data-sender="${n.sender_id}" data-notif="${n.id}" style="padding:3px 10px; font-size:11px;">${icon('xmark')} ${t('رد', 'Decline')}</button>
                  </div>
                ` : ''}
              </div>
            </a>
          `).join('')

          // کلیک روی اعلان: علاوه بر رفتن به مقصد، خوانده‌شده علامت بخوره
          notisList.querySelectorAll('.noti-item').forEach(item => {
            item.addEventListener('click', () => {
              supabase.from('notifications').update({ is_read: true }).eq('id', item.dataset.notifId)
            })
          })

          // دکمه‌های قبول/رد درخواست فالو (باگ QA: هیچ راه UI برای قبول وجود نداشت)
          notisList.querySelectorAll('.follow-accept-btn, .follow-decline-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation()
              answerFollowRequest(btn.dataset.sender, btn.dataset.notif, btn.classList.contains('follow-accept-btn'))
            })
          })
        } else {
          notiBadge.style.display = 'none'
          notisList.innerHTML = `<div class="text-dim" style="text-align:center; padding:10px;">${t('هیچ اعلانی نیست', 'No notifications yet')}</div>`
        }
      }

      loadNotifications()

      // بستن کانال قبلی قبل از ساخت کانال جدید (درست مثل کامپوننت چت)
      if (notiChannel) {
        supabase.removeChannel(notiChannel)
        notiChannel = null
      }

      // آپدیت زنده نوتیفیکیشن‌ها با اشتراک Supabase Realtime
      notiChannel = supabase
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
  osc.frequency.setValueAtTime(587.33, audioCtx.currentTime) // نت D5
  osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1) // نت A5
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4)
  osc.start(audioCtx.currentTime)
  osc.stop(audioCtx.currentTime + 0.4)
}

export function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(seed || 'guest')}`
}
