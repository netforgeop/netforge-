import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { uploadMediaFile, isVideoUrl } from '../lib/mediaUpload.js'
import { t } from '../lib/i18n.js'

// ════════════════════════════════════════════════════════════════════
//  استوری‌ها — دایره‌های بالای فید + نمایشگر تمام‌صفحه (۲۴ ساعته)
//  · حلقه‌ی گرادیانی = دیده‌نشده | خاکستری = دیده‌شده
//  · استوری خودم: دکمه‌ی + میاد و با لمس، نمایشگر با شمارنده‌ی بازدید باز می‌شه
// ════════════════════════════════════════════════════════════════════

const STORY_TTL_MS = 24 * 60 * 60 * 1000
let st = null            // { me, groups:[{user, stories:[...]}], myStories:[...] }
let stChannel = null
let viewerTimer = null

function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(seed || 'guest')}`
}

async function fetchStories(me) {
  const since = new Date(Date.now() - STORY_TTL_MS).toISOString()
  const { data: stories } = await supabase
    .from('stories')
    .select('*, author:users!stories_user_id_fkey(nickname, avatar_url, neon_color)')
    .gte('created_at', since)
    .order('created_at')
  const rows = stories || []
  const ids = rows.map(s => s.id)
  const { data: views } = ids.length
    ? await supabase.from('story_views').select('story_id, user_id').in('story_id', ids)
    : { data: [] }

  const myViewed = new Set((views || []).filter(v => v.user_id === me.id).map(v => v.story_id))
  const viewCounts = {}
  ;(views || []).forEach(v => { viewCounts[v.story_id] = (viewCounts[v.story_id] || 0) + 1 })

  const byUser = new Map()
  for (const s of rows) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, [])
    byUser.get(s.user_id).push(s)
  }
  const groups = [...byUser.entries()].map(([uid, list]) => ({
    user: list[0].author || { nickname: '؟' },
    stories: list,
    allViewed: list.every(s => myViewed.has(s.id))
  }))
  return { groups, myViewed, viewCounts }
}

function barHtml() {
  const me = st.me
  const mine = st.groups.find(g => g.user && g.stories[0]?.user_id === me.id)
  const others = st.groups.filter(g => g !== mine)
  const myAvatar = me.avatar_url || defaultAvatar(me.nickname)
  const mineRing = mine ? (mine.allViewed ? 'viewed' : 'unviewed') : 'none'

  return `
    <!-- کاشی + : همیشه برای ساخت استوری جدید -->
    <div class="story-item" data-story-user="${me.id}" data-add="1">
      <div class="story-ring none">
        <img class="avatar md ${neonClass(me.neon_color)}" src="${escapeHtml(myAvatar)}">
        <span class="story-plus">${icon('plus')}</span>
      </div>
      <span class="story-name">${t('استوری جدید', 'New story')}</span>
    </div>
    ${mine ? `
      <div class="story-item" data-story-user="${me.id}">
        <div class="story-ring ${mineRing}">
          <img class="avatar md ${neonClass(me.neon_color)}" src="${escapeHtml(myAvatar)}">
        </div>
        <span class="story-name">${t('استوری من', 'My story')}</span>
      </div>
    ` : ''}
    ${others.map(g => `
      <div class="story-item" data-story-user="${g.stories[0].user_id}">
        <div class="story-ring ${g.allViewed ? 'viewed' : 'unviewed'}">
          <img class="avatar md ${neonClass(g.user?.neon_color)}" src="${escapeHtml(g.user?.avatar_url || defaultAvatar(g.user?.nickname))}">
        </div>
        <span class="story-name">${escapeHtml(g.user?.nickname || '')}</span>
      </div>
    `).join('')}
  `
}

export async function initStories(root, me) {
  const container = root.querySelector('#stories-bar')
  if (!container) return
  st = { me }

  async function refresh() {
    const { groups } = await fetchStories(me)
    st.groups = groups
    const bar = root.querySelector('#stories-bar')
    if (!bar) return
    bar.innerHTML = barHtml()
  }

  await refresh()

  // کلیک روی دایره‌ها: خودم (بدون استوری = آپلود | با استوری = نمایش) و بقیه = نمایش
  container.addEventListener('click', (e) => {
    const item = e.target.closest('.story-item')
    if (!item) return
    if (item.dataset.storyUser === me.id && item.dataset.add === '1') {
      openStoryComposer(me, refresh)
      return
    }
    const g = st.groups.find(g => g.stories[0]?.user_id === item.dataset.storyUser)
    if (g) openStoryViewer(g, refresh)
  })

  // Realtime: استوری جدید/حذف‌شده → بار تازه می‌شه (بدون رفرش صفحه)
  if (stChannel) supabase.removeChannel(stChannel)
  stChannel = supabase
    .channel(`stories:${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, refresh)
    .subscribe()
  window.addEventListener('hashchange', () => {
    if (stChannel) { supabase.removeChannel(stChannel); stChannel = null }
  }, { once: true })
}

// سازنده‌ی استوری: مثل پست — لینک عکس/ویدیو + توضیح (کپشن)؛ آپلود فایل هم به‌عنوان گزینه‌ی جایگزین
function openStoryComposer(me, after) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="glass modal" style="max-width:420px;">
      <div class="row between" style="margin-bottom:12px;">
        <h3>${icon('circle-plus')} ${t('استوری جدید', 'New story')}</h3>
        <button class="danger" id="sc-close" style="padding:4px 8px;">${icon('xmark')}</button>
      </div>
      <div class="stack" style="gap:10px;">
        <input id="sc-url" placeholder="${t('لینک عکس یا ویدیو رو اینجا بذار...', 'Paste image/video URL here...')}" />
        <input id="sc-caption" placeholder="${t('توضیح روی استوری (اختیاری)', 'Text on the story (optional)')}" maxlength="120" />
        <div class="text-dim" style="text-align:center; font-size:11px;">${t('— یا فایل از گالری —', '— or a file from gallery —')}</div>
        <input id="sc-file" type="file" accept="image/*,video/*" style="font-size:12px;" />
        <button class="primary" id="sc-publish">${icon('paper-plane')} ${t('انتشار استوری (۲۴ ساعته)', 'Publish story (24h)')}</button>
      </div>
    </div>
  `
  document.body.appendChild(wrap)
  const close = () => wrap.remove()
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
  wrap.querySelector('#sc-close').addEventListener('click', close)

  wrap.querySelector('#sc-publish').addEventListener('click', async () => {
    const urlIn = wrap.querySelector('#sc-url').value.trim()
    const caption = wrap.querySelector('#sc-caption').value.trim() || null
    const file = wrap.querySelector('#sc-file').files?.[0]
    if (!urlIn && !file) {
      toast(t('یه لینک بده یا فایل انتخاب کن', 'Paste a link or pick a file'), { error: true })
      return
    }
    const btn = wrap.querySelector('#sc-publish')
    btn.disabled = true
    try {
      let mediaUrl = urlIn || null
      let mediaType = isVideoUrl(urlIn) ? 'video' : 'image'
      if (file && file.size) {
        toast(t('در حال آپلود...', 'Uploading...'))
        const up = await uploadMediaFile(file)
        mediaUrl = up.url
        mediaType = up.mediaType
      }
      // سعی با caption؛ اگر ستونش هنوز نبود (SQL اجرا نشده) بدونش
      let { error } = await supabase.from('stories').insert({ user_id: me.id, media_url: mediaUrl, media_type: mediaType, caption })
      if (error && /caption/i.test(error.message || '')) {
        ;({ error } = await supabase.from('stories').insert({ user_id: me.id, media_url: mediaUrl, media_type: mediaType }))
      }
      if (error) throw error
      toast(t('استوری منتشر شد — ۲۴ ساعت می‌مونه', 'Story published — lives for 24h'))
      close()
      after?.()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })
}

// ────────────────────────────────────────────────────────────────────
//  نمایشگر استوری — تمام‌صفحه با نوار پیشرفت و ناوبری لمسی
// ────────────────────────────────────────────────────────────────────

async function openStoryViewer(group, refreshBar) {
  closeStoryViewer()
  const me = st.me
  const isMine = group.stories[0]?.user_id === me.id
  // از اولین دیده‌نشده شروع کن
  const { myViewed } = await fetchStories(me)
  let idx = group.stories.findIndex(s => !myViewed.has(s.id))
  if (idx === -1) idx = 0

  const { data: views } = isMine
    ? await supabase.from('story_views').select('story_id').in('story_id', group.stories.map(s => s.id))
    : { data: [] }
  const counts = {}
  ;(views || []).forEach(v => { counts[v.story_id] = (counts[v.story_id] || 0) + 1 })

  const wrap = document.createElement('div')
  wrap.id = 'story-viewer'
  document.body.appendChild(wrap)

  function render() {
    const s = group.stories[idx]
    if (!s) return close()
    wrap.innerHTML = `
      <div class="story-viewer-media">
        ${s.media_type === 'video'
          ? `<video id="story-video" src="${escapeHtml(s.media_url)}" autoplay playsinline></video>`
          : `<img src="${escapeHtml(s.media_url)}">`}
      </div>
      <div class="story-viewer-top">
        <div class="story-progress-row">
          ${group.stories.map((x, i) => `
            <div class="story-seg"><div class="story-seg-fill ${i < idx ? 'done' : ''}" id="seg-fill-${i}"></div></div>
          `).join('')}
        </div>
        <div class="story-viewer-header">
          <a href="#/profile/${s.user_id}" class="row" style="color:#fff; text-decoration:none; gap:8px;" onclick="closeStoriesViewerNav(event)">
            <img class="avatar sm ${neonClass(group.user?.neon_color)}" src="${escapeHtml(group.user?.avatar_url || defaultAvatar(group.user?.nickname))}">
            <b>${escapeHtml(group.user?.nickname || '')}</b>
            <span class="story-time">${timeAgo(s.created_at)}</span>
          </a>
          <div class="row" style="gap:6px;">
            ${isMine ? `<button id="story-views-info" class="story-ghost-btn" disabled>${icon('eye')} ${counts[s.id] || 0}</button>
            <button id="story-delete-btn" class="story-ghost-btn">${icon('trash')}</button>` : ''}
            <button id="story-close-btn" class="story-ghost-btn">${icon('xmark')}</button>
          </div>
        </div>
      </div>
      <div class="story-tap-zone prev" id="story-prev"></div>
      <div class="story-tap-zone next" id="story-next"></div>
      ${s.caption ? `<div class="story-caption-bubble">${escapeHtml(s.caption)}</div>` : ''}
    `
    wrap.querySelector('#story-close-btn').addEventListener('click', close)
    wrap.querySelector('#story-prev').addEventListener('click', prev)
    wrap.querySelector('#story-next').addEventListener('click', next)
    wrap.querySelector('#story-delete-btn')?.addEventListener('click', async () => {
      try {
        await supabase.from('stories').delete().eq('id', s.id)
        toast(t('استوری حذف شد', 'Story deleted'))
        group.stories.splice(idx, 1)
        if (idx >= group.stories.length) idx = group.stories.length - 1
        if (!group.stories.length) { close(); return }
        render()
        refreshBar?.()
      } catch (err) { toast(err.message, { error: true }) }
    })

    // علامت «دیده شد»
    supabase.from('story_views').upsert({ story_id: s.id, user_id: me.id }).then(() => {})

    // پیشرفت: عکس ۵ ثانیه | ویدیو تا آخرش
    clearTimeout(viewerTimer)
    const fill = wrap.querySelector(`#seg-fill-${idx}`)
    const video = wrap.querySelector('#story-video')
    if (video) {
      video.addEventListener('timeupdate', () => {
        if (fill && video.duration) fill.style.width = `${(video.currentTime / video.duration) * 100}%`
      })
      video.addEventListener('ended', next)
    } else {
      if (fill) {
        fill.style.transition = 'width 5s linear'
        requestAnimationFrame(() => { fill.style.width = '100%' })
      }
      viewerTimer = setTimeout(next, 5000)
    }
  }

  function next() {
    idx++
    if (idx >= group.stories.length) return close()
    render()
  }
  function prev() {
    if (idx > 0) idx--
    render()
  }
  function close() { closeStoryViewer(); refreshBar?.() }

  // برای بستن امن از بیرون (کلیک روی لینک پروفایل)
  window.__closeStoryViewer = closeStoryViewer
  render()
}

export function closeStoryViewer() {
  clearTimeout(viewerTimer)
  document.getElementById('story-viewer')?.remove()
}

// ناوبری به پروفایل از داخل نمایشگر (inline handler ساده)
window.closeStoriesViewerNav = function () { closeStoryViewer() }
