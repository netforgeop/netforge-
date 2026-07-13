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
          <label class="row" style="font-size:13px; width:auto; cursor:pointer;">
            <input type="checkbox" name="ratings_enabled" checked style="width:auto; margin:0 5px;" />
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

  const isMyPost = post.author_id === me.id

  return `
    <div class="glass card instagram-post" data-post-id="${post.id}">
      <div class="card-header between" style="justify-content:space-between;">
        <div class="row">
          <a href="#/profile/${post.author_id}" class="row" style="color:inherit; text-decoration:none;">
            <img class="avatar ${neonClass(author.neon_color)}" src="${author.avatar_url || defaultAvatar(author.nickname)}">
            <div class="meta" style="margin-right:8px;">
              <span class="name">${escapeHtml(author.nickname)}</span>
              <span class="time">${timeAgo(post.created_at)}</span>
            </div>
          </a>
        </div>
        <div class="row" style="gap:8px;">
          ${isMyPost ? `<button class="delete-post-btn danger" data-id="${post.id}" style="padding:4px 10px; font-size:12px;">حذف</button>` : ''}
          ${post.author_id !== me.id ? reportBlockMarkup(post.author_id, { targetType: 'post', targetId: post.id }) : ''}
        </div>
      </div>

      <!-- تصویر/مدیا پست -->
      ${post.media_url ? `
        <div class="post-media-container">
          <img src="${escapeHtml(post.media_url)}" onerror="this.parentElement.style.display='none'">
        </div>
      ` : ''}

      <!-- بخش دکمه‌های ری‌اکشن به سبک اینستاگرام -->
      <div class="post-actions-bar row between">
        <div class="row" style="gap:14px;">
          ${EMOJIS.map(e => `
            <span class="insta-emoji-btn ${myReactions.has(e) ? 'active' : ''}" data-emoji="${e}">
              ${e} <small>${reactionCounts[e] || ''}</small>
            </span>
          `).join('')}
        </div>

        <!-- امتیازدهی ستاره‌ای زیبا به جای اسلایدر نمره‌ دهی زشت -->
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

      <div class="comments-list stack" style="font-size:14px; margin-bottom: 10px;">
        ${postComments.map(c => `
          <div class="row" style="align-items:flex-start;">
            <a href="#/profile/${c.author_id}" style="color:inherit; text-decoration:none;">
              <img class="avatar sm ${neonClass(c.author?.neon_color)}" src="${c.author?.avatar_url || defaultAvatar(c.author?.nickname)}">
            </a>
            <div style="margin-right:8px;">
              <a href="#/profile/${c.author_id}" style="color:inherit; text-decoration:none; font-weight:bold;">${escapeHtml(c.author?.nickname)}</a>
              <span>${escapeHtml(c.content)}</span>
            </div>
          </div>
        ` : ''}
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
  newPostForm?.addEventListener('submit', async (e) => {
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

    // ری‌اکشن‌ها
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

    // امتیازدهی ستاره‌ای
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

    const commentForm = card.querySelector('.comment-form')
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

    const deleteBtn = card.querySelector('.delete-post-btn')
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm('آیا از حذف این پست مطمئن هستید؟')) return
      try {
        const { error } = await supabase.from('posts').delete().eq('id', deleteBtn.dataset.id)
        if (error) throw error
        toast('پست با موفقیت حذف شد')
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
      }
    })
  })
}
