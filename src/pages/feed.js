import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'
import { isStaff, deletePostAsStaff, deleteCommentAsStaff, moderatedDeletePost, moderatedDeleteComment, askModReason } from '../lib/moderation.js'
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

// ── استیت کامنت‌ها (برای پنجره‌ی اینستاگرامی و آپدیت زنده) ──
// commentsByPost: Map(postId → [کامنت‌ها با parent_id])
// commentPost: Map(commentId → postId) برای پیدا کردن پستِ یه لایک
// likesCount: Map(commentId → عدد)   myLikes: Set(commentId)
let cs = null

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

    // لایک‌های کامنت‌ها
    const commentIds = (comments || []).map(c => c.id)
    const { data: commentLikes } = commentIds.length
      ? await supabase.from('post_comment_likes').select('comment_id, user_id').in('comment_id', commentIds)
      : { data: [] }

    const html = `
      <div id="posts-list" class="instagram-feed-container">
        ${feedPosts.length ? feedPosts.map(p => renderPost(p, profile, ratings, comments, reactions, blockedIds, commentLikes)).join('') : `<div class="empty-state">${t('هنوز پستی نیست. اولین نفر باش.', 'No posts yet — be the first!')}</div>`}
      </div>

      <!-- ── پنجره‌ی کامنت‌های اینستاگرامی (ورق پایین صفحه) ── -->
      <div id="comments-sheet-backdrop" class="modal-backdrop comments-sheet-backdrop" style="display:none;">
        <div class="glass comments-sheet">
          <div class="comments-sheet-header row between">
            <b>${t('نظرات', 'Comments')}</b>
            <button class="close-modal-btn" id="close-comments-sheet">${icon('xmark')}</button>
          </div>
          <div id="comments-sheet-list" class="comments-sheet-list"></div>
          <div id="reply-indicator" class="reply-indicator" style="display:none;">
            <span></span>
            <button id="cancel-reply-btn" title="${t('لغو پاسخ', 'Cancel reply')}">${icon('xmark')}</button>
          </div>
          <form id="sheet-comment-form" class="comment-form-insta row">
            <input id="sheet-comment-input" placeholder="${t('کامنت بذار...', 'Add a comment...')}" autocomplete="off" />
            <button type="submit">${t('ارسال', 'Post')}</button>
          </form>
        </div>
      </div>
    `

    return { html, mount: (app) => mountFeed(app, profile, blockedIds, comments || [], commentLikes || []) }
  })
}

function avgText(postRatings) {
  const avg = postRatings.length ? (postRatings.reduce((s, r) => s + r.score, 0) / postRatings.length).toFixed(1) : null
  return avg ? `${avg}/10` : t('امتیاز دهید', 'Rate it')
}

function commentPreviewRowHtml(c, me) {
  return `
    <div class="comment-row" data-comment-id="${c.id}">
      <span class="bold-username">${escapeHtml(c.author?.nickname)}</span>
      <span>${escapeHtml(c.content)}</span>
    </div>
  `
}

function renderPost(post, me, allRatings, allComments, allReactions, blockedIds = new Set(), allCommentLikes = []) {
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
          <span class="insta-emoji-btn open-comments-btn" title="${t('نظرات', 'Comments')}">
            ${icon('comment')} <small class="comments-count-num">${postComments.length || ''}</small>
          </span>
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
        <div class="view-all-comments-btn open-comments-btn" style="${postComments.length ? '' : 'display:none;'}">${t(`مشاهده همه ${postComments.length} کامنت`, `View all ${postComments.length} comments`)}</div>
        <div class="comments-container stack" style="gap:6px;">
          ${preview.map(c => commentPreviewRowHtml(c, me)).join('')}
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

// ════════════════════════════════════════════════════════════════════
//  پنجره‌ی کامنت‌های اینستاگرامی — لایک، ریپلای، زمان، آواتار
// ════════════════════════════════════════════════════════════════════

function initCommentState(me, blockedIds, comments, commentLikes) {
  cs = {
    me,
    blockedIds,
    openPostId: null,
    replyParent: null,   // { id, nick, topId }
    commentsByPost: new Map(),
    commentPost: new Map(),
    likesCount: new Map(),
    myLikes: new Set()
  }
  for (const c of comments) {
    if (!cs.commentsByPost.has(c.post_id)) cs.commentsByPost.set(c.post_id, [])
    cs.commentsByPost.get(c.post_id).push(c)
    cs.commentPost.set(c.id, c.post_id)
  }
  for (const l of commentLikes) {
    cs.likesCount.set(l.comment_id, (cs.likesCount.get(l.comment_id) || 0) + 1)
    if (l.user_id === me.id) cs.myLikes.add(l.comment_id)
  }
}

function visibleComments(postId) {
  return (cs.commentsByPost.get(postId) || []).filter(c => !cs.blockedIds.has(c.author_id))
}

// ردیف کامنت توی پنجره (سبک اینستاگرام: آواتار + نام/متن + متا + قلب سمت چپ)
function sheetCommentRowHtml(c, isReply = false) {
  const me = cs.me
  const likes = cs.likesCount.get(c.id) || 0
  const liked = cs.myLikes.has(c.id)
  const canDelete = c.author_id === me.id || isStaff(me)
  return `
    <div class="ig-comment ${isReply ? 'is-reply' : ''}" data-comment-row="${c.id}">
      <img class="avatar ${isReply ? 'xs' : 'sm'} ${neonClass(c.author?.neon_color)}" src="${escapeHtml(c.author?.avatar_url || defaultAvatar(c.author?.nickname))}">
      <div class="ig-comment-body">
        <div><b>${escapeHtml(c.author?.nickname)}</b> <span class="ig-comment-text">${escapeHtml(c.content)}</span></div>
        <div class="ig-comment-meta text-dim">
          <span>${timeAgo(c.created_at)}</span>
          ${likes ? `<span>${t(`${likes} پسند`, `${likes} likes`)}</span>` : ''}
          <button class="ig-reply-btn" data-comment-id="${c.id}" data-nick="${escapeHtml(c.author?.nickname || '')}">${t('پاسخ', 'Reply')}</button>
          ${canDelete ? `<button class="ig-delete-comment-btn" data-comment-id="${c.id}" title="${t('حذف کامنت', 'Delete comment')}">${icon('xmark')}</button>` : ''}
        </div>
      </div>
      <button class="ig-like-btn ${liked ? 'liked' : ''}" data-comment-id="${c.id}" title="${t('پسندیدن', 'Like')}">
        <i class="${liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
      </button>
    </div>
  `
}

function renderSheetList(postId) {
  const list = document.getElementById('comments-sheet-list')
  if (!list) return
  const all = visibleComments(postId)
  const topLevel = all.filter(c => !c.parent_id)
  if (!topLevel.length) {
    list.innerHTML = `<div class="empty-state">${t('هنوز کامنتی نیست. اولین نفر باش!', 'No comments yet — be the first!')}</div>`
    return
  }
  list.innerHTML = topLevel.map(c => {
    const replies = all.filter(r => parentChain(r, c))
    const replyCount = replies.length
    return `
      ${sheetCommentRowHtml(c)}
      ${replyCount ? `
        <button class="ig-view-replies-btn" data-parent="${c.id}">
          <span class="ig-replies-line"></span>
          ${t(`مشاهده پاسخ‌ها (${replyCount})`, `View replies (${replyCount})`)}
        </button>
        <div class="ig-replies" data-replies-of="${c.id}" style="display:none;">
          ${replies.map(r => sheetCommentRowHtml(r, true)).join('')}
        </div>
      ` : ''}
    `
  }).join('')
  bindSheetRowButtons(list)
}

// آیا r از نوادگانِ c است؟ (ریپلای‌ها می‌تونن زنجیره‌ای باشن)
function parentChain(r, ancestor) {
  const byId = new Map(visibleComments(ancestor.post_id).map(x => [x.id, x]))
  let cur = r
  let hops = 0
  while (cur && cur.parent_id && hops < 10) {
    if (cur.parent_id === ancestor.id) return true
    cur = byId.get(cur.parent_id)
    hops++
  }
  return false
}

function openCommentsSheet(postId, post) {
  cs.openPostId = postId
  cs.post = post
  cs.replyParent = null
  updateReplyIndicator()
  renderSheetList(postId)
  document.getElementById('comments-sheet-backdrop').style.display = 'flex'
  setTimeout(() => document.getElementById('sheet-comment-input')?.focus(), 50)
}

function closeCommentsSheet() {
  cs.openPostId = null
  cs.replyParent = null
  document.getElementById('comments-sheet-backdrop').style.display = 'none'
}

function updateReplyIndicator() {
  const ind = document.getElementById('reply-indicator')
  if (!ind) return
  if (cs.replyParent) {
    ind.style.display = 'flex'
    ind.querySelector('span').innerHTML = t(`در حال پاسخ به <b>${escapeHtml(cs.replyParent.nick)}</b>`, `Replying to <b>${escapeHtml(cs.replyParent.nick)}</b>`)
  } else {
    ind.style.display = 'none'
  }
}

function bindSheetRowButtons(list) {
  // باز/بسته کردن ریپلای‌ها
  list.querySelectorAll('.ig-view-replies-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', () => {
      const box = list.querySelector(`[data-replies-of="${btn.dataset.parent}"]`)
      if (!box) return
      const open = box.style.display === 'none'
      box.style.display = open ? '' : 'none'
      const count = box.querySelectorAll('.ig-comment').length
      btn.lastChild.textContent = open
        ? t(' پنهان کردن پاسخ‌ها', ' Hide replies')
        : t(` مشاهده پاسخ‌ها (${count})`, ` View replies (${count})`)
    })
  })

  // قلب کامنت (تاگل)
  list.querySelectorAll('.ig-like-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', async () => {
      const commentId = btn.dataset.commentId
      const liked = cs.myLikes.has(commentId)
      try {
        if (liked) {
          await supabase.from('post_comment_likes').delete().match({ comment_id: commentId, user_id: cs.me.id })
        } else {
          await supabase.from('post_comment_likes').insert({ comment_id: commentId, user_id: cs.me.id })
        }
        await resyncCommentLikes(cs.commentPost.get(commentId))
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // پاسخ
  list.querySelectorAll('.ig-reply-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', () => {
      const commentId = btn.dataset.commentId
      const postId = cs.commentPost.get(commentId)
      const all = cs.commentsByPost.get(postId) || []
      const clicked = all.find(x => x.id === commentId)
      // مثل اینستاگرام: ریپلای به ریپلای → به کامنت مادر اصلی وصل می‌شه
      const topId = clicked?.parent_id || commentId
      cs.replyParent = { id: topId, nick: btn.dataset.nick }
      updateReplyIndicator()
      document.getElementById('sheet-comment-input')?.focus()
    })
  })

  // حذف کامنت (خودم: بدون دلیل | مدیریت روی کامنت بقیه: دلیل اجباری + لاگ)
  list.querySelectorAll('.ig-delete-comment-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', async () => {
      const commentId = btn.dataset.commentId
      const postId = cs.commentPost.get(commentId)
      const comment = (cs.commentsByPost.get(postId) || []).find(x => x.id === commentId)
      if (!comment) return
      const mine = comment.author_id === cs.me.id
      if (!mine && !isStaff(cs.me)) return
      try {
        if (mine) {
          if (!confirm(t('کامنت حذف بشه؟', 'Delete this comment?'))) return
          await deleteCommentAsStaff(commentId)
        } else {
          const reason = askModReason(t(`حذف کامنت ${comment.author?.nickname || ''}`, `deleting ${comment.author?.nickname || ''}'s comment`))
          if (!reason) return
          await moderatedDeleteComment(cs.me, comment, reason)
        }
        toast(t('کامنت حذف شد', 'Comment deleted'))
        await resyncPostComments(postId)
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}

// تازه‌سازی کامنت‌های یه پست: استیت + کارت + پنجره (اگر بازه)
async function resyncPostComments(postId) {
  if (!cs) return
  if (!document.querySelector(`[data-post-id="${postId}"]`) && cs.openPostId !== postId) return
  const { data: comments } = await supabase
    .from('post_comments')
    .select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)')
    .eq('post_id', postId)
    .order('created_at')
  const rows = comments || []
  const ids = rows.map(c => c.id)

  // پاک‌سازی رفرنس‌های کامنت‌های این پست (حذف‌شده‌ها هم جمع می‌شن)
  for (const [cid, pid] of [...cs.commentPost]) {
    if (pid === postId) {
      cs.commentPost.delete(cid)
      cs.likesCount.delete(cid)
      cs.myLikes.delete(cid)
    }
  }
  cs.commentsByPost.set(postId, rows)
  for (const c of rows) cs.commentPost.set(c.id, postId)

  const { data: likes } = ids.length
    ? await supabase.from('post_comment_likes').select('comment_id, user_id').in('comment_id', ids)
    : { data: [] }
  for (const l of likes || []) {
    cs.likesCount.set(l.comment_id, (cs.likesCount.get(l.comment_id) || 0) + 1)
    if (l.user_id === cs.me.id) cs.myLikes.add(l.comment_id)
  }

  updateCardCommentsViews(postId)
  if (cs.openPostId === postId) renderSheetList(postId)
}

async function resyncCommentLikes(postId) {
  if (!postId) return
  await resyncPostComments(postId)
}

// آپدیت کارت پست: شمارنده، دکمه‌ی «مشاهده همه»، پیش‌نمایش ۲ کامنت آخر
function updateCardCommentsViews(postId) {
  const card = document.querySelector(`[data-post-id="${postId}"]`)
  if (!card) return
  const all = visibleComments(postId)
  const topLevel = all.filter(c => !c.parent_id)
  const preview = topLevel.slice(-2)

  const countEl = card.querySelector('.comments-count-num')
  if (countEl) countEl.textContent = all.length || ''

  const viewBtn = card.querySelector('.post-comments-section .view-all-comments-btn')
  if (viewBtn) {
    viewBtn.style.display = all.length ? '' : 'none'
    viewBtn.textContent = t(`مشاهده همه ${all.length} کامنت`, `View all ${all.length} comments`)
  }
  let container = card.querySelector('.comments-container')
  if (container) container.innerHTML = preview.map(c => commentPreviewRowHtml(c, cs?.me || {})).join('')
}

// هندلرهای یه کارت پست
function bindPostCard(card, me) {
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

  // باز کردن پنجره‌ی کامنت‌ها (دکمه‌ی کامنت یا «مشاهده همه کامنت‌ها»)
  card.querySelectorAll('.open-comments-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await resyncPostComments(postId)
      openCommentsSheet(postId)
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

function mountFeed(app, me, blockedIds, comments, commentLikes) {
  attachReportBlock(app, me)
  initCommentState(me, blockedIds, comments, commentLikes)
  app.querySelectorAll('[data-post-id]').forEach(card => bindPostCard(card, me))

  // کنترل پنجره‌ی کامنت‌ها
  const backdrop = app.querySelector('#comments-sheet-backdrop')
  app.querySelector('#close-comments-sheet')?.addEventListener('click', closeCommentsSheet)
  backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeCommentsSheet() })
  app.querySelector('#cancel-reply-btn')?.addEventListener('click', () => {
    cs.replyParent = null
    updateReplyIndicator()
  })

  // ارسال کامنت از داخل پنجره (با پشتیبانی ریپلای)
  const sheetForm = app.querySelector('#sheet-comment-form')
  sheetForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!cs.openPostId) return
    if (['mute', 'timeout', 'ban'].includes(me.activeSanction?.type)) {
      toast(t('به خاطر محدودیت فعال نمی‌توانید کامنت بگذارید.', "You can't comment due to an active restriction."), { error: true })
      return
    }
    const input = app.querySelector('#sheet-comment-input')
    const content = input.value.trim()
    if (!content) return
    const btn = sheetForm.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      await supabase.from('post_comments').insert({
        post_id: cs.openPostId,
        author_id: me.id,
        content,
        parent_id: cs.replyParent?.id || null
      })
      input.value = ''
      cs.replyParent = null
      updateReplyIndicator()
      await resyncPostComments(cs.openPostId) // بلافاصله ببینش (realtime هم میاد ولی تکراری نمی‌شه چون بازسازی کامله)
    } catch (err) {
      toast(err.message, { error: true })
    } finally {
      btn.disabled = false
    }
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
    wrap.innerHTML = renderPost(post, me, [], [], [], blockedIds, [])
    list.prepend(wrap.firstElementChild)
    bindPostCard(list.firstElementChild, me)
    attachReportBlock(list.firstElementChild, me)
  })

  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
    const postId = payload.old?.id
    if (postId) document.querySelector(`[data-post-id="${postId}"]`)?.remove()
  })

  // کامنت جدید/حذف‌شده → کارت + پنجره (اگر بازه) زنده آپدیت می‌شن
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, async (payload) => {
    const c = payload.new
    if (!c?.post_id || blockedIds.has(c.author_id)) return
    await resyncPostComments(c.post_id)
  })
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments' }, async (payload) => {
    const postId = payload.old?.post_id || cs?.commentPost.get(payload.old?.id)
    if (!postId) return
    await resyncPostComments(postId)
  })

  // لایک‌های کامنت
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'post_comment_likes' }, async (payload) => {
    const commentId = payload.new?.comment_id || payload.old?.comment_id
    const postId = cs?.commentPost.get(commentId)
    if (postId) await resyncCommentLikes(postId)
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
