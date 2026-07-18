import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'
import { isStaff, deletePostAsStaff, deleteCommentAsStaff } from '../lib/moderation.js'

const EMOJIS = ['👍', '❤️', '😂', '😮', '🔥']

export default async function feedPage() {
  return withShell('feed', async (profile) => {
    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(nickname, avatar_url, neon_color)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    const postIds = posts.map(p => p.id)
    const [{ data: ratings }, { data: comments }, { data: reactions }] = await Promise.all([
      postIds.length ? supabase.from('post_ratings').select('post_id, user_id, score').in('post_id', postIds) : { data: [] },
      postIds.length ? supabase.from('post_comments').select('*, author:users!post_comments_author_id_fkey(nickname, avatar_url, neon_color)').in('post_id', postIds).order('created_at') : { data: [] },
      postIds.length ? supabase.from('post_reactions').select('post_id, user_id, emoji').in('post_id', postIds) : { data: [] }
    ])

    const html = `
      <div id="posts-list" class="instagram-feed-container">
        ${posts.length ? posts.map(p => renderPost(p, profile, ratings, comments, reactions)).join('') : `<div class="empty-state">هنوز پستی نیست. اولین نفر باش.</div>`}
      </div>
    `

    return { html, mount: (app) => mountFeed(app, profile) }
  })
}

function renderPost(post, me, allRatings, allComments, allReactions) {
  const author = post.author || {}
  const myRating = allRatings.find(r => r.post_id === post.id && r.user_id === me.id)
  const postRatings = allRatings.filter(r => r.post_id === post.id)
  const avg = postRatings.length ? (postRatings.reduce((s, r) => s + r.score, 0) / postRatings.length).toFixed(1) : null
  const postComments = allComments.filter(c => c.post_id === post.id)
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
          ${showDelete ? `<button class="delete-post-btn-insta" data-id="${post.id}">${isMyPost ? 'حذف' : '🛡 حذف'}</button>` : ''}
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
              ${e} <small>${reactionCounts[e] || ''}</small>
            </span>
          `).join('')}
        </div>

        ${post.ratings_enabled ? `
          <div class="row insta-stars-container" style="gap:4px;">
            ${[2, 4, 6, 8, 10].map(val => {
              const isActive = (myRating?.score || 0) >= val;
              return `<span class="insta-star ${isActive ? 'active' : ''}" data-val="${val}">★</span>`;
            }).join('')}
            <span class="avg-score" style="margin-right:6px; font-size:12px; color:var(--text-dim);">
              ${avg ? `${avg}/10` : 'امتیاز دهید'}
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
          <div class="view-all-comments-btn">View all ${postComments.length} comments</div>
          <div class="comments-container stack" style="gap:6px;">
            ${postComments.map(c => `
              <div class="comment-row">
                <span class="bold-username">${escapeHtml(c.author?.nickname)}</span>
                <span>${escapeHtml(c.content)}</span>
                ${(c.author_id === me.id || isStaff(me)) ? `<button class="delete-comment-btn" data-id="${c.id}" title="حذف کامنت">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      ${['mute', 'timeout', 'ban'].includes(me.activeSanction?.type) ? `
        <div class="text-dim" style="text-align:center; font-size:13px; padding:6px;">🔇 به خاطر محدودیت فعال نمی‌توانید کامنت بگذارید.</div>
      ` : `
        <form class="comment-form-insta row">
          <input placeholder="Add a comment..." required />
          <button type="submit">Post</button>
        </form>
      `}
    </div>
  `
}

function mountFeed(app, me) {
  attachReportBlock(app, me)

  app.querySelectorAll('[data-post-id]').forEach(card => {
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
          window.location.reload()
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
          toast(`امتیاز ${val} ثبت شد`)
          window.location.reload()
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
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })

    const deleteBtn = card.querySelector('.delete-post-btn-insta')
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm('آیا از حذف این پست مطمئن هستید؟')) return
      try {
        await deletePostAsStaff(deleteBtn.dataset.id)
        toast('پست حذف شد')
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
      }
    })

    // حذف کامنت: نویسنده‌ی خود کامنت یا ادمین/ناظم
    card.querySelectorAll('.delete-comment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('کامنت حذف بشه؟')) return
        try {
          await deleteCommentAsStaff(btn.dataset.id)
          toast('کامنت حذف شد')
          window.location.reload()
        } catch (err) { toast(err.message, { error: true }) }
      })
    })
  })
}
