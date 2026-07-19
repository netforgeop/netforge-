import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'
import { isStaff, deletePostAsStaff, moderatedDeletePost, askModReason } from '../lib/moderation.js'
import { seedComments, openCommentsSheet, resyncPostComments, getCommentsFor } from '../lib/commentsSheet.js'
import { initStories } from '../components/stories.js'
import { isVideoUrl } from '../lib/mediaUpload.js'
import { t } from '../lib/i18n.js'

// کلید ریاکشن (همون مقدار قدیمی دیتابیسه) → آیکون Font Awesome
const EMOJIS = ['👍', '❤️', '😂', '😮', '🔥']
const EMOJI_ICONS = {
  '👍': 'thumbs-up',
  '❤️': 'heart',
  '😂': 'face-laugh-squint',
  '😮': 'face-surprise',
  '🔥': 'fire'
}

// رفرنس ماژول-سطح به کانال realtime فید
let feedChannel = null

export default async function feedPage() {
  return withShell('feed', async (profile) => {
    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    // فیلتر واقعی بلاک: پست/کامنت کسانی که بلاکشون کردم برام نمایش داده نمی‌شه
    const { data: myBlocks } = await supabase
      .from('user_blocks').select('blocked_id').eq('blocker_id', profile.id)
    const blockedIds = new Set((myBlocks || []).map(b => b.blocked_id))

    const feedPosts = (posts || []).filter(p => !blockedIds.has(p.author_id) && !p.is_reel)
    const postIds = feedPosts.map(p => p.id)
    const [{ data: ratings }, { data: comments }, { data: reactions }] = await Promise.all([
      postIds.length ? supabase.from('post_ratings').select('post_id, user_id, score').in('post_id', postIds) : { data: [] },
      postIds.length ? supabase.from('post_comments').select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)').in('post_id', postIds).order('created_at') : { data: [] },
      postIds.length ? supabase.from('post_reactions').select('post_id, user_id, emoji').in('post_id', postIds) : { data: [] }
    ])

    // لایک‌های کامنت‌ها → تغذیه‌ی استیت مشترک شیت کامنت‌ها
    const commentIds = (comments || []).map(c => c.id)
    const { data: commentLikes } = commentIds.length
      ? await supabase.from('post_comment_likes').select('comment_id, user_id').in('comment_id', commentIds)
      : { data: [] }

    const html = `
      <div id="stories-bar" class="stories-bar"></div>
      <div id="posts-list" class="instagram-feed-container">
        ${feedPosts.length ? feedPosts.map(p => renderPost(p, profile, ratings, comments || [], reactions || [], blockedIds)).join('') : `<div class="empty-state">${t('هنوز پستی نیست. اولین نفر باش.', 'No posts yet — be the first!')}</div>`}
      </div>
    `

    return {
      html,
      mount: (app) => {
        seedComments(profile, blockedIds, comments || [], commentLikes || [])
        mountFeed(app, profile, blockedIds)
        initStories(app, profile)
      }
    }
  })
}

function avgText(postRatings) {
  const avg = postRatings.length ? (postRatings.reduce((s, r) => s + r.score, 0) / postRatings.length).toFixed(1) : null
  return avg ? `${avg}/10` : t('امتیاز دهید', 'Rate it')
}

function commentPreviewRowHtml(c) {
  return `
    <div class="comment-row" data-comment-id="${c.id}">
      <span class="bold-username">${escapeHtml(c.author?.nickname)}</span>
      <span>${escapeHtml(c.content)}</span>
    </div>
  `
}

function renderPost(post, me, allRatings, allComments, allReactions, blockedIds = new Set()) {
  const author = post.author || {}
  const myRating = allRatings.find(r => r.post_id === post.id && r.user_id === me.id)
  const postRatings = allRatings.filter(r => r.post_id === post.id)
  const postComments = allComments.filter(c => c.post_id === post.id && !blockedIds.has(c.author_id))
  const postReactions = allReactions.filter(r => r.post_id === post.id)

  // پیش‌نمایش: فقط ۲ تا از آخرین کامنت‌های اصلی (مثل اینستاگرام)
  const topLevel = postComments.filter(c => !c.parent_id)
  const preview = topLevel.slice(-2)

  const reactionCounts = {}
  postReactions.forEach(r => { reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1 })
  const myReactions = new Set(postReactions.filter(r => r.user_id === me.id).map(r => r.emoji))

  const isMyPost = post.author_id === me.id
  const showDelete = isMyPost || isStaff(me)
  const isVideo = post.media_type === 'video' || (!post.media_type && isVideoUrl(post.media_url))

  return `
    <div class="instagram-post-card" data-post-id="${post.id}" data-author-id="${post.author_id}">
      <div class="post-header row between">
        <div class="row">
          <a href="#/profile/${post.author_id}" class="row" style="color:inherit; text-decoration:none; gap:10px;">
            <img class="avatar sm ${neonClass(author.neon_color)}" src="${escapeHtml(author.avatar_url || defaultAvatar(author.nickname))}">
            <div class="meta">
              <span class="name">${escapeHtml(author.nickname)}</span>
            </div>
          </a>
          <span style="color:var(--text-dim); margin:0 5px;">•</span>
          <span class="time" style="font-size:12px; color:var(--text-dim);">${timeAgo(post.created_at)}</span>
        </div>
        <div class="row" style="gap:8px;">
          ${showDelete ? `<button class="delete-post-btn-insta" data-id="${post.id}">${isMyPost ? t('حذف', 'Delete') : `${icon('shield-halved')} ${t('حذف', 'Delete')}`}</button>` : ''}
          ${post.author_id !== me.id ? reportBlockMarkup(post.author_id, { targetType: 'post', targetId: post.id }) : ''}
        </div>
      </div>

      ${post.media_url ? `
        <div class="post-media-container">
          ${isVideo
            ? `<video src="${escapeHtml(post.media_url)}" controls playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(post.media_url)}" onerror="this.parentElement.style.display='none'">`}
        </div>
      ` : ''}

      <!-- ردیف ۱: ری‌اکشن‌ها + کامنت (همیشه جدا از ستاره‌ها توی سطر خودش) -->
      <div class="post-actions-bar row" style="gap:14px;">
        ${EMOJIS.map(e => `
          <span class="insta-emoji-btn ${myReactions.has(e) ? 'active' : ''}" data-emoji="${e}">
            ${icon(EMOJI_ICONS[e])} <small>${reactionCounts[e] || ''}</small>
          </span>
        `).join('')}
        <span class="insta-emoji-btn open-comments-btn" title="${t('نظرات', 'Comments')}">
          ${icon('comment')} <small class="comments-count-num">${postComments.length || ''}</small>
        </span>
      </div>

      <!-- ردیف ۲: امتیاز ستاره‌ای — توی سطر جدا و تمام‌عرض تا با ری‌اکشن‌ها قاطی نشه -->
      ${post.ratings_enabled ? `
        <div class="post-rating-bar row" style="gap:4px;">
          ${[2, 4, 6, 8, 10].map(val => {
            const isActive = (myRating?.score || 0) >= val;
            return `<span class="insta-star ${isActive ? 'active' : ''}" data-val="${val}">${icon('star')}</span>`;
          }).join('')}
          <span class="avg-score" style="margin-right:6px; font-size:12px; color:var(--text-dim);">
            ${avgText(postRatings)}
          </span>
        </div>
      ` : ''}

      ${post.caption ? `
        <div class="post-caption-section">
          <span class="bold-username">${escapeHtml(author.nickname)}</span>
          <span class="caption-text">${escapeHtml(post.caption)}</span>
        </div>
      ` : ''}

      <div class="post-comments-section">
        <div class="view-all-comments-btn open-comments-btn" style="${postComments.length ? '' : 'display:none;'}">${t(`مشاهده همه ${postComments.length} کامنت`, `View all ${postComments.length} comments`)}</div>
        <div class="comments-container stack" style="gap:6px;">
          ${preview.map(c => commentPreviewRowHtml(c)).join('')}
        </div>
      </div>

      ${['mute', 'timeout', 'ban'].includes(me.activeSanction?.type) ? `
        <div class="text-dim" style="text-align:center; font-size:13px; padding:6px;">${icon('volume-xmark')} ${t('به خاطر محدودیت فعال نمی‌توانید کامنت بگذارید.', "You can't comment due to an active restriction.")}</div>
      ` : `
        <form class="comment-form-insta row">
          <input placeholder="${t('کامنت بذار...', 'Add a comment...')}" required />
          <button type="submit">${t('ارسال', 'Post')}</button>
        </form>
      `}
    </div>
  `
}

// آپدیت کارت پست: شمارنده، دکمه‌ی «مشاهده همه»، پیش‌نمایش ۲ کامنت آخر
function updateCardCommentsViews(postId, comments) {
  const card = document.querySelector(`[data-post-id="${postId}"]`)
  if (!card || !comments) return
  const topLevel = comments.filter(c => !c.parent_id)
  const preview = topLevel.slice(-2)

  const countEl = card.querySelector('.comments-count-num')
  if (countEl) countEl.textContent = comments.length || ''

  const viewBtn = card.querySelector('.post-comments-section .view-all-comments-btn')
  if (viewBtn) {
    viewBtn.style.display = comments.length ? '' : 'none'
    viewBtn.textContent = t(`مشاهده همه ${comments.length} کامنت`, `View all ${comments.length} comments`)
  }
  const container = card.querySelector('.comments-container')
  if (container) container.innerHTML = preview.map(c => commentPreviewRowHtml(c)).join('')
}

// هندلرهای یه کارت پست
function bindPostCard(card, me, blockedIds) {
  const postId = card.dataset.postId

  card.querySelectorAll('.insta-emoji-btn[data-emoji]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emoji = btn.dataset.emoji
      const active = btn.classList.contains('active')
      try {
        if (active) {
          await supabase.from('post_reactions').delete().match({ post_id: postId, user_id: me.id, emoji })
        } else {
          await supabase.from('post_reactions').insert({ post_id: postId, user_id: me.id, emoji })
        }
        updateReactionsRow(card, me)
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // باز کردن پنجره‌ی کامنت‌های اینستاگرامی (دکمه‌ی کامنت یا «مشاهده همه»)
  card.querySelectorAll('.open-comments-btn').forEach(btn => {
    btn.addEventListener('click', () => openCommentsSheet(postId, me, blockedIds))
  })

  card.querySelectorAll('.insta-star').forEach(star => {
    star.addEventListener('click', async () => {
      const val = Number(star.dataset.val)
      try {
        await supabase.from('post_ratings').upsert({
          post_id: postId, user_id: me.id, score: val, updated_at: new Date().toISOString()
        })
        toast(t(`امتیاز ${val} ثبت شد`, `Rated ${val}`))
        updateRatingDisplay(card, me)
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // کامنت سریع (زیر پست — ریپلای از داخل پنجره میاد)
  const commentForm = card.querySelector('.comment-form-insta')
  commentForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = commentForm.querySelector('input')
    const content = input.value.trim()
    if (!content) return
    try {
      await supabase.from('post_comments').insert({ post_id: postId, author_id: me.id, content })
      input.value = '' // ظاهر شدنش با realtime میاد (بدون رفرش)
    } catch (err) { toast(err.message, { error: true }) }
  })

  // حذف پست: مال خودم بدون دلیل | مدیریت روی پست بقیه با «دلیل» اجباری + لاگ
  const deleteBtn = card.querySelector('.delete-post-btn-insta')
  deleteBtn?.addEventListener('click', async () => {
    const authorId = card.dataset.authorId
    const mine = authorId === me.id
    try {
      if (mine) {
        if (!confirm(t('آیا از حذف این پست مطمئن هستید؟', 'Delete this post?'))) return
        await deletePostAsStaff(deleteBtn.dataset.id)
      } else {
        const reason = askModReason(t('حذف این پست', 'deleting this post'))
        if (!reason) return
        const caption = card.querySelector('.caption-text')?.textContent || ''
        await moderatedDeletePost(me, { id: deleteBtn.dataset.id, author_id: authorId, caption }, reason)
      }
      toast(t('پست حذف شد', 'Post deleted'))
      document.querySelector(`[data-post-id="${deleteBtn.dataset.id}"]`)?.remove()
    } catch (err) {
      toast(err.message, { error: true })
    }
  })
}

// شمارنده‌های ریاکشن یه پست
async function updateReactionsRow(card, me) {
  const postId = card.dataset.postId
  const { data: rows } = await supabase.from('post_reactions').select('user_id, emoji').eq('post_id', postId)
  const counts = {}
  ;(rows || []).forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1 })
  const mySet = new Set((rows || []).filter(r => r.user_id === me.id).map(r => r.emoji))
  card.querySelectorAll('.insta-emoji-btn[data-emoji]').forEach(btn => {
    const e = btn.dataset.emoji
    btn.querySelector('small').textContent = counts[e] || ''
    btn.classList.toggle('active', mySet.has(e))
  })
}

// میانگین ستاره‌ها + ستاره‌های فعالِ خودم
async function updateRatingDisplay(card, me) {
  const postId = card.dataset.postId
  const { data: rows } = await supabase.from('post_ratings').select('user_id, score').eq('post_id', postId)
  const avgEl = card.querySelector('.avg-score')
  if (avgEl) avgEl.textContent = avgText(rows || [])
  const mine = (rows || []).find(r => r.user_id === me.id)?.score || 0
  card.querySelectorAll('.insta-star').forEach(star => {
    star.classList.toggle('active', mine >= Number(star.dataset.val))
  })
}

function mountFeed(app, me, blockedIds) {
  attachReportBlock(app, me)
  app.querySelectorAll('[data-post-id]').forEach(card => bindPostCard(card, me, blockedIds))

  // کارت‌ها با هر تغییر کامنت (از ماژول مشترک شیت) زنده آپدیت می‌شن
  window.addEventListener('nf:comments-changed', (e) => {
    if (!document.getElementById('posts-list')) return
    updateCardCommentsViews(e.detail.postId, e.detail.comments)
  })

  setupFeedRealtime(me, blockedIds)
}

// ────────────────────────────────────────────────────────────────────
// ★ Realtime فید — همه‌چیز زنده: پست، کامنت (+پنجره)، لایک، ریاکشن، امتیاز
// ────────────────────────────────────────────────────────────────────
function setupFeedRealtime(me, blockedIds) {
  if (feedChannel) {
    supabase.removeChannel(feedChannel)
    feedChannel = null
  }

  const channel = supabase.channel(`feed:${Date.now()}`)

  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
    const postId = payload.new?.id
    if (!postId || blockedIds.has(payload.new.author_id)) return
    if (payload.new.is_reel) return // ریل‌ها فقط توی صفحه‌ی ریلز
    if (document.querySelector(`[data-post-id="${postId}"]`)) return
    const { data: post } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color)')
      .eq('id', postId).single()
    if (!post) return
    const list = document.getElementById('posts-list')
    if (!list) return
    const empty = list.querySelector('.empty-state')
    if (empty) empty.remove()
    const wrap = document.createElement('div')
    wrap.innerHTML = renderPost(post, me, [], [], [], blockedIds)
    list.prepend(wrap.firstElementChild)
    bindPostCard(list.firstElementChild, me, blockedIds)
    attachReportBlock(list.firstElementChild, me)
  })

  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
    const postId = payload.old?.id
    if (postId) document.querySelector(`[data-post-id="${postId}"]`)?.remove()
  })

  // کامنت جدید/حذف‌شده → ماژول مشترک تازه می‌کنه (کارت + شیت هر دو)
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, async (payload) => {
    const c = payload.new
    if (!c?.post_id || blockedIds.has(c.author_id)) return
    await resyncPostComments(c.post_id)
  })
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments' }, async (payload) => {
    const postId = payload.old?.post_id
    if (postId) await resyncPostComments(postId)
  })

  // لایک‌های کامنت
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_comment_likes' }, async (payload) => {
    const commentId = payload.new?.comment_id || payload.old?.comment_id
    if (!commentId) return
    // پست این کامنت رو از استیت مشترک پیدا کن و تازه‌اش کن
    for (const card of document.querySelectorAll('[data-post-id]')) {
      const pid = card.dataset.postId
      if (getCommentsFor(pid).some(c => c.id === commentId)) {
        await resyncPostComments(pid)
        break
      }
    }
  })

  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, (payload) => {
    const postId = payload.new?.post_id || payload.old?.post_id
    if (!postId) return
    const card = document.querySelector(`[data-post-id="${postId}"]`)
    if (card) updateReactionsRow(card, me)
  })

  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_ratings' }, (payload) => {
    const postId = payload.new?.post_id || payload.old?.post_id
    if (!postId) return
    const card = document.querySelector(`[data-post-id="${postId}"]`)
    if (card) updateRatingDisplay(card, me)
  })

  channel.subscribe()
  feedChannel = channel

  window.addEventListener('hashchange', () => {
    if (feedChannel === channel) {
      supabase.removeChannel(channel)
      feedChannel = null
    }
  }, { once: true })
}
