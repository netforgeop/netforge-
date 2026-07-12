import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'

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
      <div class="glass card" id="new-post-card">
        <h3>پست جدید</h3>
        <form id="new-post-form" class="stack">
          <input name="media_url" placeholder="لینک عکس/ویدیو (اختیاری)" />
          <textarea name="caption" placeholder="چی می‌خوای بگی؟" rows="2"></textarea>
          <label class="row" style="font-size:13px;">
            <input type="checkbox" name="ratings_enabled" checked style="width:auto;" />
            امتیازدهی برای این پست فعال باشه
          </label>
          <button class="primary" type="submit">انتشار</button>
        </form>
      </div>

      <div id="posts-list">
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

  return `
    <div class="glass card" data-post-id="${post.id}">
      <div class="card-header between" style="justify-content:space-between;">
        <div class="row">
          <img class="avatar ${neonClass(author.neon_color)}" src="${author.avatar_url || defaultAvatar(author.nickname)}">
          <div class="meta">
            <span class="name">${escapeHtml(author.nickname)}</span>
            <span class="time">${timeAgo(post.created_at)}</span>
          </div>
        </div>
        ${post.author_id !== me.id ? reportBlockMarkup(post.author_id, { targetType: 'post', targetId: post.id }) : ''}
      </div>
      ${post.media_url ? `<div style="margin-bottom:10px;"><img src="${escapeHtml(post.media_url)}" style="width:100%;border-radius:12px;max-height:420px;object-fit:cover;" onerror="this.style.display='none'"></div>` : ''}
      ${post.caption ? `<p>${escapeHtml(post.caption)}</p>` : ''}

      <div class="row between" style="margin:10px 0;">
        <div class="row">
          ${EMOJIS.map(e => `<button class="react-btn ${myReactions.has(e) ? 'active' : ''}" data-emoji="${e}" style="padding:4px 10px;">${e} ${reactionCounts[e] || ''}</button>`).join('')}
        </div>
        ${post.ratings_enabled ? `
          <div class="row" style="font-size:13px;">
            ${avg ? `<span class="text-dim">میانگین: ${avg}/۱۰ (${postRatings.length} رأی)</span>` : '<span class="text-dim">هنوز امتیازی نیست</span>'}
            <input type="range" min="0" max="10" class="rate-input" value="${myRating?.score ?? 5}" style="width:100px;">
            <span class="rate-value">${myRating?.score ?? 5}</span>
          </div>` : ''}
      </div>

      <div class="comments-list stack" style="font-size:14px;">
        ${postComments.map(c => `
          <div class="row" style="align-items:flex-start;">
            <img class="avatar sm ${neonClass(c.author?.neon_color)}" src="${c.author?.avatar_url || defaultAvatar(c.author?.nickname)}">
            <div><b>${escapeHtml(c.author?.nickname)}</b> ${escapeHtml(c.content)}</div>
          </div>
        `).join('')}
      </div>
      <form class="comment-form row" style="margin-top:8px;">
        <input placeholder="کامنت بذار..." required />
        <button type="submit">ارسال</button>
      </form>
    </div>
  `
}

function mountFeed(app, me) {
  attachReportBlock(app, me)
  const newPostForm = app.querySelector('#new-post-form')
  newPostForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(newPostForm)
    const btn = newPostForm.querySelector('button')
    btn.disabled = true
    try {
      const { error } = await supabase.from('posts').insert({
        author_id: me.id,
        media_url: fd.get('media_url')?.trim() || null,
        caption: fd.get('caption')?.trim() || null,
        ratings_enabled: !!fd.get('ratings_enabled')
      })
      if (error) throw error
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })

  app.querySelectorAll('[data-post-id]').forEach(card => {
    const postId = card.dataset.postId

    card.querySelectorAll('.react-btn').forEach(btn => {
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

    const rateInput = card.querySelector('.rate-input')
    if (rateInput) {
      const rateValue = card.querySelector('.rate-value')
      rateInput.addEventListener('input', () => { rateValue.textContent = rateInput.value })
      rateInput.addEventListener('change', async () => {
        try {
          await supabase.from('post_ratings').upsert({
            post_id: postId, user_id: me.id, score: Number(rateInput.value), updated_at: new Date().toISOString()
          })
          toast('امتیازت ثبت شد')
        } catch (err) { toast(err.message, { error: true }) }
      })
    }

    const commentForm = card.querySelector('.comment-form')
    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const input = commentForm.querySelector('input')
      const content = input.value.trim()
      if (!content) return
      try {
        await supabase.from('post_comments').insert({ post_id: postId, author_id: me.id, content })
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}
