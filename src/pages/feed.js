import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'
import { isStaff, deletePostAsStaff, deleteCommentAsStaff } from '../lib/moderation.js'
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

// رفرنس ماژول-سطح به کانال realtime فید؛ با هر ناوبری بسته و دوباره ساخته می‌شه
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

    const feedPosts = (posts || []).filter(p => !blockedIds.has(p.author_id))
    const postIds = feedPosts.map(p => p.id)
    const [{ data: ratings }, { data: comments }, { data: reactions }] = await Promise.all([
      postIds.length ? supabase.from('post_ratings').select('post_id, user_id, score').in('post_id', postIds) : { data: [] },
      postIds.length ? supabase.from('post_comments').select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)').in('post_id', postIds).order('created_at') : { data: [] },
      postIds.length ? supabase.from('post_reactions').select('post_id, user_id, emoji').in('post_id', postIds) : { data: [] }
    ])

    const html = `
      <div id="posts-list" class="instagram-feed-container">
        ${feedPosts.length ? feedPosts.map(p => renderPost(p, profile, ratings, comments, reactions, blockedIds)).join('') : `<div class="empty-state">${t('هنوز پستی نیست. اولین نفر باش.', 'No posts yet — be the first!')}</div>`}
      </div>
    `

    return { html, mount: (app) => mountFeed(app, profile, blockedIds) }
  })
}

function renderPost(post, me, allRatings, allComments, allReactions, blockedIds = new Set()) {
  const author = post.author || {}
  const myRating = allRatings.find(r => r.post_id === post.id && r.user_id === me.id)
  const postRatings = allRatings.filter(r => r.post_id === post.id)
  const postComments = allComments.filter(c => c.post_id === post.id && !blockedIds.has(c.author_id))
  const postReactions = allReactions.filter(r => r.post_id === post.id)

  const reactionCounts = {}
  postReactions.forEach(r => { reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1 })
  const myReactions = new Set(postReactions.filter(r => r.user_id === me.id).map(r => r.emoji))

  const isMyPost = post.author_id === me.id
  // ادمین/ناظم می‌تواند هر پستی را حذف کند (دکمه قرمز مخصوص با برچسب مدیریت)
  const showDelete = isMyPost || isStaff(me)

  return `
    <div class="instagram-post-card" data-post-id="${post.id}">
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
          <img src="${escapeHtml(post.media_url)}" onerror="this.parentElement.style.display='none'">
        </div>
      ` : ''}

      <div class="post-actions-bar row between">
        <div class="row" style="gap:14px;">
          ${EMOJIS.map(e => `
            <span class="insta-emoji-btn ${myReactions.has(e) ? 'active' : ''}" data-emoji="${e}">
              ${icon(EMOJI_ICONS[e])} <small>${reactionCounts[e] || ''}</small>
            </span>
          `).join('')}
        </div>

        ${post.ratings_enabled ? `
          <div class="row insta-stars-container" style="gap:4px;">
            ${[2, 4, 6, 8, 10].map(val => {
              const isActive = (myRating?.score || 0) >= val;
              return `<span class="insta-star ${isActive ? 'active' : ''}" data-val="${val}">${icon('star')}</span>`;
            }).join('')}
            <span class="avg-score" style="margin-right:6px; font-size:12px; color:var(--text-dim);">
              ${avgText(postRatings)}
            </span>
          </div>
        ` : ''}
      </div>

      ${post.caption ? `
        <div class="post-caption-section">
          <span class="bold-username">${escapeHtml(author.nickname)}</span>
          <span class="caption-text">${escapeHtml(post.caption)}</span>
        </div>
      ` : ''}

      <div class="post-comments-section">
        ${postComments.length > 0 ? `
          <div class="view-all-comments-btn">${t(`مشاهده همه ${postComments.length} کامنت`, `View all ${postComments.length} comments`)}</div>
          <div class="comments-container stack" style="gap:6px;">
            ${postComments.map(c => commentRowHtml(c, me)).join('')}
          </div>
        ` : ''}
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

function avgText(postRatings) {
  const avg = postRatings.length ? (postRatings.reduce((s, r) => s + r.score, 0) / postRatings.length).toFixed(1) : null
  return avg ? `${avg}/10` : t('امتیاز دهید', 'Rate it')
}

function commentRowHtml(c, me) {
  return `
    <div class="comment-row" data-comment-id="${c.id}">
      <span class="bold-username">${escapeHtml(c.author?.nickname)}</span>
      <span>${escapeHtml(c.content)}</span>
      ${(c.author_id === me.id || isStaff(me)) ? `<button class="delete-comment-btn" data-id="${c.id}" title="${t('حذف کامنت', 'Delete comment')}">${icon('xmark')}</button>` : ''}
    </div>
  `
}

// هندلرهای یه کارت پست — هم برای رندر اولیه، هم برای کارت‌هایی که realtime میان
function bindPostCard(card, me) {
  const postId = card.dataset.postId

  card.querySelectorAll('.insta-emoji-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emoji = btn.dataset.emoji
      const active = btn.classList.contains('active')
      try {
        if (active) {
          await supabase.from('post_reactions').delete().match({ post_id: postId, user_id: me.id, emoji })
        } else {
          await supabase.from('post_reactions').insert({ post_id: postId, user_id: me.id, emoji })
        }
        // شمارنده‌ها خودشون با realtime آپدیت می‌شن؛ اگر realtime نبود، لااقل UI خودمون درست بشه
        updateReactionsRow(card, me)
      } catch (err) { toast(err.message, { error: true }) }
    })
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

  const commentForm = card.querySelector('.comment-form-insta')
  commentForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = commentForm.querySelector('input')
    const content = input.value.trim()
    if (!content) return
    try {
      await supabase.from('post_comments').insert({ post_id: postId, author_id: me.id, content })
      input.value = '' // کامنت با realtime ظاهر می‌شه؛ رفرش لازم نیست
    } catch (err) { toast(err.message, { error: true }) }
  })

  const deleteBtn = card.querySelector('.delete-post-btn-insta')
  deleteBtn?.addEventListener('click', async () => {
    if (!confirm(t('آیا از حذف این پست مطمئن هستید؟', 'Delete this post?'))) return
    try {
      await deletePostAsStaff(deleteBtn.dataset.id)
      toast(t('پست حذف شد', 'Post deleted'))
      document.querySelector(`[data-post-id="${deleteBtn.dataset.id}"]`)?.remove()
    } catch (err) {
      toast(err.message, { error: true })
    }
  })

  bindCommentDeleteButtons(card)
}

function bindCommentDeleteButtons(scope) {
  scope.querySelectorAll('.delete-comment-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', async () => {
      if (!confirm(t('کامنت حذف بشه؟', 'Delete this comment?'))) return
      try {
        await deleteCommentAsStaff(btn.dataset.id)
        toast(t('کامنت حذف شد', 'Comment deleted'))
        btn.closest('.comment-row')?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}

// شمارنده‌های ریاکشن یه پست رو از دیتابیس تازه می‌کنه (بعد از کلیک خودم یا ایونت realtime)
async function updateReactionsRow(card, me) {
  const postId = card.dataset.postId
  const { data: rows } = await supabase.from('post_reactions').select('user_id, emoji').eq('post_id', postId)
  const counts = {}
  ;(rows || []).forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1 })
  const mySet = new Set((rows || []).filter(r => r.user_id === me.id).map(r => r.emoji))
  card.querySelectorAll('.insta-emoji-btn').forEach(btn => {
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

function mountFeed(app, me, blockedIds = new Set()) {
  attachReportBlock(app, me)
  app.querySelectorAll('[data-post-id]').forEach(card => bindPostCard(card, me))
  setupFeedRealtime(me, blockedIds)
}

// ────────────────────────────────────────────────────────────────────
// ★ Realtime فید: پست جدید، کامنت جدید/حذف‌شده، ریاکشن و امتیاز — همه زنده
// ────────────────────────────────────────────────────────────────────
function setupFeedRealtime(me, blockedIds) {
  if (feedChannel) {
    supabase.removeChannel(feedChannel)
    feedChannel = null
  }

  const channel = supabase.channel(`feed:${Date.now()}`)

  // پست جدید → بالای فید ظاهر می‌شه
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
    const postId = payload.new?.id
    if (!postId || blockedIds.has(payload.new.author_id)) return
    if (document.querySelector(`[data-post-id="${postId}"]`)) return // از قبل هست
    const { data: post } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color)')
      .eq('id', postId).single()
    if (!post) return
    const list = document.getElementById('posts-list')
    if (!list) return // صفحه عوض شده
    const empty = list.querySelector('.empty-state')
    if (empty) empty.remove()
    const wrap = document.createElement('div')
    wrap.innerHTML = renderPost(post, me, [], [], [], blockedIds)
    list.prepend(wrap.firstElementChild)
    bindPostCard(list.firstElementChild, me)
    attachReportBlock(list.firstElementChild, me)
  })

  // پست حذف‌شده → از فید محو می‌شه
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
    const postId = payload.old?.id
    if (postId) document.querySelector(`[data-post-id="${postId}"]`)?.remove()
  })

  // کامنت جدید → زیر همون پست اضافه می‌شه (بدون رفرش)
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, async (payload) => {
    const c = payload.new
    if (!c?.post_id || blockedIds.has(c.author_id)) return
    const card = document.querySelector(`[data-post-id="${c.post_id}"]`)
    if (!card) return
    if (card.querySelector(`[data-comment-id="${c.id}"]`)) return // از قبل هست (ثبت کامنت خودم)
    const { data: full } = await supabase
      .from('post_comments')
      .select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)')
      .eq('id', c.id).single()
    const comment = full || c
    const section = card.querySelector('.post-comments-section')
    if (!section) return
    let container = section.querySelector('.comments-container')
    if (!container) {
      section.insertAdjacentHTML('afterbegin', `
        <div class="view-all-comments-btn">${t('مشاهده همه 1 کامنت', 'View 1 comment')}</div>
        <div class="comments-container stack" style="gap:6px;"></div>
      `)
      container = section.querySelector('.comments-container')
    }
    container.insertAdjacentHTML('beforeend', commentRowHtml(comment, me))
    bindCommentDeleteButtons(container)
    const viewBtn = section.querySelector('.view-all-comments-btn')
    if (viewBtn) viewBtn.textContent = t(`مشاهده همه ${container.children.length} کامنت`, `View all ${container.children.length} comments`)
  })

  // کامنت حذف‌شده → بلافاصله محو می‌شه (replica identity full = post_id دستمونه)
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments' }, (payload) => {
    const id = payload.old?.id
    if (!id) return
    const row = document.querySelector(`[data-comment-id="${id}"]`)
    if (!row) return
    const container = row.closest('.comments-container')
    row.remove()
    if (container) {
      const viewBtn = container.parentElement?.querySelector('.view-all-comments-btn')
      if (viewBtn) viewBtn.textContent = container.children.length ? t(`مشاهده همه ${container.children.length} کامنت`, `View all ${container.children.length} comments`) : ''
    }
  })

  // ریاکشن‌ها: ثبت/برداشت هر کسی → شمارنده‌ها زنده آپدیت می‌شن
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, (payload) => {
    const postId = payload.new?.post_id || payload.old?.post_id
    if (!postId) return
    const card = document.querySelector(`[data-post-id="${postId}"]`)
    if (card) updateReactionsRow(card, me)
  })

  // امتیازهای ستاره‌ای → میانگین زنده
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
