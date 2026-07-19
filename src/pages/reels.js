import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff, deletePostAsStaff, moderatedDeletePost, askModReason } from '../lib/moderation.js'
import { openCommentsSheet } from '../lib/commentsSheet.js'
import { uploadMediaFile } from '../lib/mediaUpload.js'
import { t } from '../lib/i18n.js'

// صفحه‌ی ریلز — اسکرول عمودی تمام‌صفحه با اسنپ (دقیق مثل اینستاگرام)
// ریل = پستی با is_reel=true و ویدیو؛ لایک/کامنت/ریل‌تایم همون ماشین‌ریزی پست‌هاست
let reelsChannel = null
let reelObserver = null

export default async function reelsPage() {
  return withShell('reels', async (profile) => {
    const [{ data: reels, error }, { data: myBlocks }] = await Promise.all([
      supabase
        .from('posts')
        .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color), post_reactions(emoji, user_id), post_comments(count)')
        .eq('is_reel', true)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('user_blocks').select('blocked_id').eq('blocker_id', profile.id)
    ])
    if (error) throw error
    const blockedIds = new Set((myBlocks || []).map(b => b.blocked_id))
    const list = (reels || []).filter(r => !blockedIds.has(r.author_id))

    const html = `
      <div class="reels-header row between">
        <h2 style="margin:0;">${icon('clapperboard')} ${t('ریلز', 'Reels')}</h2>
        <button class="primary" id="new-reel-btn">${icon('plus')} ${t('ریل جدید', 'New reel')}</button>
      </div>
      <div id="reels-container" class="reels-container">
        ${list.length
          ? list.map(r => renderReel(r, profile)).join('')
          : `<div class="empty-state" style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;">
               ${icon('clapperboard', 'fa-2x')}
               <p>${t('هنوز ریلی نیست — اولین ریل رو تو بگذار!', 'No reels yet — post the first one!')}</p>
             </div>`}
      </div>

      <!-- مودال آپلود ریل -->
      <div class="modal-backdrop" id="reel-upload-modal" style="display:none;">
        <div class="glass modal">
          <div class="row between" style="margin-bottom:15px;">
            <h3>${icon('clapperboard')} ${t('ریل جدید', 'New reel')}</h3>
            <button class="danger" id="close-reel-modal" style="padding:4px 8px;">${icon('xmark')}</button>
          </div>
          ${['mute', 'timeout', 'ban'].includes(profile.activeSanction?.type) ? `
            <div class="text-dim" style="text-align:center; padding:20px;">${icon('volume-xmark')} ${t('به خاطر محدودیت فعال نمی‌توانی ریل بگذاری.', "You can't post reels due to an active restriction.")}</div>
          ` : `
            <form id="reel-upload-form" class="stack">
              <label class="text-dim">${t('فایل ویدیو (از گالری انتخاب کن)', 'Video file (pick from gallery)')}</label>
              <input name="video_file" type="file" accept="video/*" />
              <div class="text-dim" style="text-align:center; font-size:12px;">${t('— یا لینک مستقیم ویدیو —', '— or paste a direct video URL —')}</div>
              <input name="video_url" placeholder="https://.../video.mp4" />
              <label class="text-dim">${t('کپشن', 'Caption')}</label>
              <textarea name="caption" rows="2" placeholder="${t('یه کپشن جذاب بنویس...', 'Write a catchy caption...')}"></textarea>
              <button class="primary" type="submit">${icon('paper-plane')} ${t('انتشار ریل', 'Share reel')}</button>
            </form>
          `}
        </div>
      </div>
    `

    return { html, mount: (app) => mountReels(app, profile, blockedIds) }
  })
}

function renderReel(r, me) {
  const author = r.author || {}
  const hearts = (r.post_reactions || []).filter(x => x.emoji === '❤️')
  const liked = hearts.some(x => x.user_id === me.id)
  const likeCount = hearts.length || ''
  const commentCount = r.post_comments?.[0]?.count || ''
  const mine = r.author_id === me.id
  const canDelete = mine || isStaff(me)

  return `
    <div class="reel-slide" data-reel-id="${r.id}" data-author-id="${r.author_id}">
      <video class="reel-video" src="${escapeHtml(r.media_url)}" loop muted playsinline preload="metadata"></video>
      <div class="reel-scanlines"></div>

      <div class="reel-rail">
        <button class="reel-rail-btn reel-like-btn ${liked ? 'liked' : ''}" data-reel="${r.id}">
          <i class="${liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
          <small>${likeCount}</small>
        </button>
        <button class="reel-rail-btn reel-comments-btn" data-reel="${r.id}">
          ${icon('comment')}
          <small>${commentCount}</small>
        </button>
        <button class="reel-rail-btn reel-share-btn" data-reel="${r.id}">
          ${icon('paper-plane')}
          <small></small>
        </button>
        ${canDelete ? `<button class="reel-rail-btn reel-delete-btn" data-reel="${r.id}" title="${t('حذف ریل', 'Delete reel')}">${icon('trash')}<small></small></button>` : ''}
      </div>

      <div class="reel-info">
        <a href="#/profile/${r.author_id}" class="row" style="color:#fff; text-decoration:none; gap:8px;">
          <img class="avatar sm ${neonClass(author.neon_color)}" src="${escapeHtml(author.avatar_url || defaultAvatar(author.nickname))}">
          <b>${escapeHtml(author.nickname)}</b>
          <span class="reel-time">${timeAgo(r.created_at)}</span>
        </a>
        ${r.caption ? `<p class="reel-caption">${escapeHtml(r.caption)}</p>` : ''}
      </div>
    </div>
  `
}

function bindReelSlide(slide, me, blockedIds) {
  const reelId = slide.dataset.reelId
  const video = slide.querySelector('.reel-video')

  // تاچ روی ویدیو = پلی/پاز
  video?.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  })

  slide.querySelector('.reel-like-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const liked = btn.classList.contains('liked')
    try {
      if (liked) {
        await supabase.from('post_reactions').delete().match({ post_id: reelId, user_id: me.id, emoji: '❤️' })
      } else {
        await supabase.from('post_reactions').insert({ post_id: reelId, user_id: me.id, emoji: '❤️' })
      }
      await refreshReelLike(btn, reelId, me)
    } catch (err) { toast(err.message, { error: true }) }
  })

  slide.querySelector('.reel-comments-btn')?.addEventListener('click', () => {
    openCommentsSheet(reelId, me, blockedIds)
  })

  slide.querySelector('.reel-share-btn')?.addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#/reels`
    try {
      await navigator.clipboard.writeText(link)
      toast(t('لینک صفحه‌ی ریلز کپی شد', 'Reels page link copied'))
    } catch {
      prompt(t('لینک رو دستی کپی کن:', 'Copy the link manually:'), link)
    }
  })

  slide.querySelector('.reel-delete-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const authorId = slide.dataset.authorId
    const mine = authorId === me.id
    try {
      if (mine) {
        if (!confirm(t('ریل حذف بشه؟', 'Delete this reel?'))) return
        await deletePostAsStaff(reelId)
      } else {
        const reason = askModReason(t('حذف این ریل', 'deleting this reel'))
        if (!reason) return
        const caption = slide.querySelector('.reel-caption')?.textContent || ''
        await moderatedDeletePost(me, { id: reelId, author_id: authorId, caption }, reason)
      }
      toast(t('ریل حذف شد', 'Reel deleted'))
      slide.remove()
    } catch (err) { toast(err.message, { error: true }) }
  })
}

async function refreshReelLike(btn, reelId, me) {
  const { data: rows } = await supabase.from('post_reactions').select('user_id').eq('post_id', reelId).eq('emoji', '❤️')
  const count = (rows || []).length
  const liked = (rows || []).some(x => x.user_id === me.id)
  btn.classList.toggle('liked', liked)
  btn.querySelector('i').className = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'
  btn.querySelector('small').textContent = count || ''
}

// ویدیوی داخل دید پلی شه، بقیه پاز (استایل اینستا)
function setupReelObserver() {
  if (reelObserver) reelObserver.disconnect()
  reelObserver = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      const v = en.target.querySelector('.reel-video')
      if (!v) return
      if (en.intersectionRatio >= 0.6) {
        document.querySelectorAll('.reel-video').forEach(o => { if (o !== v) o.pause() })
        v.play().catch(() => {})
      } else {
        v.pause()
      }
    })
  }, { threshold: [0, 0.6, 1] })
  document.querySelectorAll('.reel-slide').forEach(s => reelObserver.observe(s))
}

function mountReels(app, me, blockedIds) {
  app.querySelectorAll('.reel-slide').forEach(slide => bindReelSlide(slide, me, blockedIds))
  setupReelObserver()

  // مودال آپلود
  const modal = app.querySelector('#reel-upload-modal')
  app.querySelector('#new-reel-btn')?.addEventListener('click', () => { modal.style.display = 'flex' })
  app.querySelector('#close-reel-modal')?.addEventListener('click', () => { modal.style.display = 'none' })
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none' })

  const form = app.querySelector('#reel-upload-form')
  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const file = fd.get('video_file')
    const urlIn = fd.get('video_url')?.trim()
    const caption = fd.get('caption')?.trim() || null
    if ((!file || !file.size) && !urlIn) {
      toast(t('یه ویدیو انتخاب کن یا لینک بده', 'Pick a video or paste a URL'), { error: true })
      return
    }
    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      let mediaUrl = urlIn || null
      if (file && file.size) {
        toast(t('در حال آپلود ویدیو...', 'Uploading video...'))
        mediaUrl = (await uploadMediaFile(file)).url
      }
      const { error } = await supabase.from('posts').insert({
        author_id: me.id,
        media_url: mediaUrl,
        media_type: 'video',
        caption,
        is_reel: true,
        ratings_enabled: false
      })
      if (error) throw error
      toast(t('ریل منتشر شد!', 'Reel published!'))
      modal.style.display = 'none'
      form.reset()
    } catch (err) {
      toast(err.message, { error: true })
    } finally {
      btn.disabled = false
    }
  })

  setupReelsRealtime(me, blockedIds)
}

function setupReelsRealtime(me, blockedIds) {
  if (reelsChannel) {
    supabase.removeChannel(reelsChannel)
    reelsChannel = null
  }
  const channel = supabase.channel(`reels:${Date.now()}`)

  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
    const p = payload.new
    if (!p?.id || !p.is_reel || blockedIds.has(p.author_id)) return
    if (document.querySelector(`[data-reel-id="${p.id}"]`)) return
    const { data: r } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color), post_reactions(emoji, user_id), post_comments(count)')
      .eq('id', p.id).single()
    if (!r) return
    const container = document.getElementById('reels-container')
    if (!container) return
    container.querySelector('.empty-state')?.remove()
    const wrap = document.createElement('div')
    wrap.innerHTML = renderReel(r, me)
    const slide = wrap.firstElementChild
    container.prepend(slide)
    bindReelSlide(slide, me, blockedIds)
    reelObserver?.observe(slide)
  })

  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
    const id = payload.old?.id
    if (id) document.querySelector(`[data-reel-id="${id}"]`)?.remove()
  })

  // شمارنده‌ی لایک زنده (اگر دیگری لایک کرد)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, async (payload) => {
    const postId = payload.new?.post_id || payload.old?.post_id
    if (!postId) return
    const btn = document.querySelector(`.reel-like-btn[data-reel="${postId}"]`)
    if (btn) await refreshReelLike(btn, postId, me)
  })

  channel.subscribe()
  reelsChannel = channel
  window.addEventListener('hashchange', () => {
    if (reelsChannel === channel) {
      supabase.removeChannel(channel)
      reelsChannel = null
    }
  }, { once: true })
}
