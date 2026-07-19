import { supabase } from './supabaseClient.js'
import { neonClass } from './auth.js'
import { escapeHtml, timeAgo, toast, icon } from './utils.js'
import { isStaff, deleteCommentAsStaff, moderatedDeleteComment, askModReason } from './moderation.js'
import { t } from './i18n.js'

// ════════════════════════════════════════════════════════════════════
//  پنجره‌ی کامنت‌های اینستاگرامی — ماژول مشترک بین «فید» و «ریلز»
//  · ورق کشویی تیره با دستگیره، قلب کنار هر کامنت، پاسخ، مشاهده پاسخ‌ها
//  · با بازسازی استایل دقیق اینستاگرام (dark sheet)
//  · بعد از هر تغییر، رویداد 'nf:comments-changed' با detail:{postId, comments}
//    پخش می‌شه تا کارت‌های صفحه شمارنده/پیش‌نمایش‌شون رو زنده آپدیت کنن
// ════════════════════════════════════════════════════════════════════

let cs = null
let sheetInjected = false

function ensureSheetDom() {
  if (sheetInjected || document.getElementById('comments-sheet-backdrop')) {
    sheetInjected = true
    return
  }
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div id="comments-sheet-backdrop" class="modal-backdrop comments-sheet-backdrop" style="display:none;">
      <div class="comments-sheet">
        <div class="comments-sheet-handle"></div>
        <div class="comments-sheet-header">
          <b>${t('نظرات', 'Comments')}</b>
          <button class="close-modal-btn" id="close-comments-sheet" aria-label="${t('بستن', 'Close')}">${icon('xmark')}</button>
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
  document.body.appendChild(wrap.firstElementChild)
  sheetInjected = true
  bindSheetShell()
}

function ensureState(me, blockedIds) {
  if (!cs) {
    cs = {
      me,
      blockedIds: blockedIds || new Set(),
      openPostId: null,
      replyParent: null,
      commentsByPost: new Map(),
      commentPost: new Map(),
      likesCount: new Map(),
      myLikes: new Set()
    }
  }
  cs.me = me
  if (blockedIds) cs.blockedIds = blockedIds
  return cs
}

// تغذیه‌ی اولیه از داده‌هایی که صفحه (مثلاً فید) همین حالا داره
export function seedComments(me, blockedIds, comments, commentLikes) {
  ensureSheetDom()
  ensureState(me, blockedIds)
  for (const c of comments || []) {
    if (!cs.commentsByPost.has(c.post_id)) cs.commentsByPost.set(c.post_id, [])
    if (!cs.commentsByPost.get(c.post_id).some(x => x.id === c.id)) cs.commentsByPost.get(c.post_id).push(c)
    cs.commentPost.set(c.id, c.post_id)
  }
  for (const l of commentLikes || []) {
    cs.likesCount.set(l.comment_id, (cs.likesCount.get(l.comment_id) || 0) + 1)
    if (l.user_id === me.id) cs.myLikes.add(l.comment_id)
  }
}

export function getCommentsFor(postId) {
  if (!cs) return []
  return (cs.commentsByPost.get(postId) || []).filter(c => !cs.blockedIds.has(c.author_id))
}

function announce(postId) {
  window.dispatchEvent(new CustomEvent('nf:comments-changed', {
    detail: { postId, comments: getCommentsFor(postId) }
  }))
}

// ── رندر ردیف کامنت (سبک اینستاگرام) ──
function sheetCommentRowHtml(c, isReply = false) {
  const me = cs.me
  const likes = cs.likesCount.get(c.id) || 0
  const liked = cs.myLikes.has(c.id)
  const canDelete = c.author_id === me.id || isStaff(me)
  return `
    <div class="ig-comment ${isReply ? 'is-reply' : ''}" data-comment-row="${c.id}">
      <img class="avatar ${isReply ? 'xs' : 'sm'} ${neonClass(c.author?.neon_color)}" src="${escapeHtml(c.author?.avatar_url || `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(c.author?.nickname || 'guest')}`)}">
      <div class="ig-comment-body">
        <div class="ig-comment-top"><b>${escapeHtml(c.author?.nickname)}</b> <span class="ig-comment-text">${escapeHtml(c.content)}</span></div>
        <div class="ig-comment-meta">
          <span>${timeAgo(c.created_at)}</span>
          ${likes ? `<span>${t(`${likes} پسند`, `${likes} likes`)}</span>` : ''}
          <button class="ig-reply-btn" data-comment-id="${c.id}" data-nick="${escapeHtml(c.author?.nickname || '')}">${t('پاسخ', 'Reply')}</button>
          ${canDelete ? `<button class="ig-delete-comment-btn" data-comment-id="${c.id}" title="${t('حذف کامنت', 'Delete comment')}">${icon('trash')}</button>` : ''}
        </div>
      </div>
      <button class="ig-like-btn ${liked ? 'liked' : ''}" data-comment-id="${c.id}" title="${t('پسندیدن', 'Like')}">
        <i class="${liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
      </button>
    </div>
  `
}

function parentChain(r, ancestor) {
  const byId = new Map(getCommentsFor(ancestor.post_id).map(x => [x.id, x]))
  let cur = r
  let hops = 0
  while (cur && cur.parent_id && hops < 10) {
    if (cur.parent_id === ancestor.id) return true
    cur = byId.get(cur.parent_id)
    hops++
  }
  return false
}

function renderSheetList(postId) {
  const list = document.getElementById('comments-sheet-list')
  if (!list) return
  const all = getCommentsFor(postId)
  const topLevel = all.filter(c => !c.parent_id)
  if (!topLevel.length) {
    list.innerHTML = `<div class="comments-sheet-empty">
      <b>${t('هنوز کامنتی نیست', 'No comments yet')}</b>
      <span class="text-dim">${t('گفتگو رو شروع کن.', 'Start the conversation.')}</span>
    </div>`
    return
  }
  list.innerHTML = topLevel.map(c => {
    const replies = all.filter(r => parentChain(r, c))
    return `
      ${sheetCommentRowHtml(c)}
      ${replies.length ? `
        <button class="ig-view-replies-btn" data-parent="${c.id}">
          <span class="ig-replies-line"></span>
          <span class="ig-view-replies-text">${t(`مشاهده پاسخ‌ها (${replies.length})`, `View replies (${replies.length})`)}</span>
        </button>
        <div class="ig-replies" data-replies-of="${c.id}" style="display:none;">
          ${replies.map(r => sheetCommentRowHtml(r, true)).join('')}
        </div>
      ` : ''}
    `
  }).join('')
}

function updateReplyIndicator() {
  const ind = document.getElementById('reply-indicator')
  if (!ind || !cs) return
  if (cs.replyParent) {
    ind.style.display = 'flex'
    ind.querySelector('span').innerHTML = t(`در حال پاسخ به <b>${escapeHtml(cs.replyParent.nick)}</b>`, `Replying to <b>${escapeHtml(cs.replyParent.nick)}</b>`)
  } else {
    ind.style.display = 'none'
  }
}

// ── تازه‌سازی کامنت‌های یه پست از دیتابیس (قلب منطق زنده) ──
export async function resyncPostComments(postId) {
  if (!cs || !postId) return
  const { data: comments } = await supabase
    .from('post_comments')
    .select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)')
    .eq('post_id', postId)
    .order('created_at')
  const rows = comments || []
  const ids = rows.map(c => c.id)

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

  if (cs.openPostId === postId) renderSheetList(postId)
  announce(postId)
}

export function closeCommentsSheet() {
  if (!cs) return
  cs.openPostId = null
  cs.replyParent = null
  const bd = document.getElementById('comments-sheet-backdrop')
  if (bd) bd.style.display = 'none'
}

export async function openCommentsSheet(postId, me, blockedIds) {
  ensureSheetDom()
  ensureState(me, blockedIds)
  await resyncPostComments(postId)
  cs.openPostId = postId
  cs.replyParent = null
  updateReplyIndicator()
  renderSheetList(postId)
  const bd = document.getElementById('comments-sheet-backdrop')
  bd.style.display = 'flex'
  requestAnimationFrame(() => bd.classList.add('open'))
  setTimeout(() => document.getElementById('sheet-comment-input')?.focus(), 150)
}

// ── هندلرهای پوسته‌ی پنجره (یک بار بایند می‌شن، delegation برای ردیف‌ها) ──
function bindSheetShell() {
  const backdrop = document.getElementById('comments-sheet-backdrop')
  const list = document.getElementById('comments-sheet-list')

  document.getElementById('close-comments-sheet')?.addEventListener('click', () => {
    backdrop.classList.remove('open')
    closeCommentsSheet()
  })
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.classList.remove('open')
      closeCommentsSheet()
    }
  })
  document.getElementById('cancel-reply-btn')?.addEventListener('click', () => {
    cs.replyParent = null
    updateReplyIndicator()
  })

  document.getElementById('sheet-comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!cs?.openPostId) return
    if (['mute', 'timeout', 'ban'].includes(cs.me.activeSanction?.type)) {
      toast(t('به خاطر محدودیت فعال نمی‌توانید کامنت بگذارید.', "You can't comment due to an active restriction."), { error: true })
      return
    }
    const input = document.getElementById('sheet-comment-input')
    const content = input.value.trim()
    if (!content) return
    const btn = e.target.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      const { error } = await supabase.from('post_comments').insert({
        post_id: cs.openPostId,
        author_id: cs.me.id,
        content,
        parent_id: cs.replyParent?.id || null
      })
      if (error) throw error
      input.value = ''
      cs.replyParent = null
      updateReplyIndicator()
      await resyncPostComments(cs.openPostId)
      list.scrollTop = list.scrollHeight
    } catch (err) {
      toast(err.message, { error: true })
    } finally {
      btn.disabled = false
    }
  })

  // delegation برای همه‌ی دکمه‌های ردیف‌ها (با هر رندر مجدد کار می‌کنه)
  list.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('.ig-like-btn')
    const replyBtn = e.target.closest('.ig-reply-btn')
    const delBtn = e.target.closest('.ig-delete-comment-btn')
    const viewBtn = e.target.closest('.ig-view-replies-btn')

    if (viewBtn) {
      const box = list.querySelector(`[data-replies-of="${viewBtn.dataset.parent}"]`)
      if (!box) return
      const open = box.style.display === 'none'
      box.style.display = open ? '' : 'none'
      const count = box.querySelectorAll('.ig-comment').length
      viewBtn.querySelector('.ig-view-replies-text').textContent = open
        ? t('پنهان کردن پاسخ‌ها', 'Hide replies')
        : t(`مشاهده پاسخ‌ها (${count})`, `View replies (${count})`)
      return
    }

    if (likeBtn) {
      const commentId = likeBtn.dataset.commentId
      const liked = cs.myLikes.has(commentId)
      try {
        if (liked) {
          await supabase.from('post_comment_likes').delete().match({ comment_id: commentId, user_id: cs.me.id })
        } else {
          await supabase.from('post_comment_likes').insert({ comment_id: commentId, user_id: cs.me.id })
        }
        await resyncPostComments(cs.commentPost.get(commentId))
      } catch (err) { toast(err.message, { error: true }) }
      return
    }

    if (replyBtn) {
      const commentId = replyBtn.dataset.commentId
      const postId = cs.commentPost.get(commentId)
      const clicked = (cs.commentsByPost.get(postId) || []).find(x => x.id === commentId)
      const topId = clicked?.parent_id || commentId
      cs.replyParent = { id: topId, nick: replyBtn.dataset.nick }
      updateReplyIndicator()
      document.getElementById('sheet-comment-input')?.focus()
      return
    }

    if (delBtn) {
      const commentId = delBtn.dataset.commentId
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
    }
  })
}
