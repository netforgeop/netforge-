import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff } from '../lib/moderation.js'

const STATUS_LABEL = { open: 'باز', full: 'پر', closed: 'بسته' }
const LOBBY_REACTIONS = ['👍', '🔥', '😂']
const LOBBY_REACTION_ICONS = { '👍': 'thumbs-up', '🔥': 'fire', '😂': 'face-laugh-squint' }

export default async function lobbiesPage() {
  return withShell('lobbies', async (profile) => {
    const { data: lobbies, error } = await supabase
      .from('game_lobbies')
      .select('*, users!game_lobbies_host_id_fkey(nickname, avatar_url, neon_color), lobby_members(user_id)')
      .neq('status', 'closed')
      .order('last_activity_at', { ascending: false })

    if (error) throw error

    const lobbyIds = lobbies.map(l => l.id)
    const [{ data: comments }, { data: reactions }] = await Promise.all([
      lobbyIds.length ? supabase.from('lobby_comments').select('*, author:users!lobby_comments_author_id_fkey(nickname, avatar_url, neon_color)').in('lobby_id', lobbyIds).order('created_at') : { data: [] },
      lobbyIds.length ? supabase.from('lobby_reactions').select('lobby_id, user_id, emoji').in('lobby_id', lobbyIds) : { data: [] }
    ])

    const html = `
      <div class="glass card">
        <h3>ساخت لابی جدید</h3>
        <form id="new-lobby-form" class="stack">
          <input name="game_name" placeholder="اسم بازی" required />
          <input name="category" placeholder="دسته‌بندی (اختیاری، مثلاً رقابتی/کژوال)" />
          <textarea name="description" placeholder="دنبال چه کسی می‌گردی؟" rows="2"></textarea>
          <input name="capacity" type="number" min="2" max="50" value="5" />
          <button class="primary" type="submit">ساخت لابی</button>
        </form>
      </div>

      <div id="lobbies-list">
        ${lobbies.length ? lobbies.map(l => renderLobby(l, profile, comments, reactions)).join('') : `<div class="empty-state">هیچ لابی بازی باز نیست.</div>`}
      </div>
    `

    return { html, mount: (app) => mountLobbies(app, profile) }
  })
}

function renderLobby(lobby, me, allComments, allReactions) {
  const host = lobby.users || {}
  const members = lobby.lobby_members || []
  const isMember = members.some(m => m.user_id === me.id)
  const isFull = members.length >= lobby.capacity
  const lobbyComments = allComments.filter(c => c.lobby_id === lobby.id)
  const lobbyReactions = allReactions.filter(r => r.lobby_id === lobby.id)
  const reactionCounts = {}
  lobbyReactions.forEach(r => { reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1 })
  const myReactions = new Set(lobbyReactions.filter(r => r.user_id === me.id).map(r => r.emoji))

  let actionBtn
  if (isMember) {
    actionBtn = `<a href="#/lobbies/${lobby.id}"><button class="primary">ورود به چت</button></a>`
  } else if (isFull) {
    actionBtn = `<button disabled>ظرفیت پره</button>`
  } else {
    actionBtn = `<button class="join-lobby-btn" data-join-lobby-id="${lobby.id}">پیوستن</button>`
  }

  return `
    <div class="glass card" data-lobby-id="${lobby.id}">
      <div class="row between">
        <div>
          <div class="row"><b>${escapeHtml(lobby.game_name)}</b> ${lobby.category ? `<span class="badge">${escapeHtml(lobby.category)}</span>` : ''}</div>
          <p class="text-dim" style="margin:6px 0;">${escapeHtml(lobby.description || '')}</p>
          <span class="text-dim" style="font-size:12px;">
            میزبان: ${escapeHtml(host.nickname)} · ${members.length}/${lobby.capacity} نفر · ${STATUS_LABEL[lobby.status]} · ${timeAgo(lobby.last_activity_at)}
          </span>
        </div>
        <div>${actionBtn}</div>
      </div>

      <div class="row" style="margin:10px 0;">
        ${LOBBY_REACTIONS.map(e => `
          <button class="lobby-react-btn ${myReactions.has(e) ? 'reacted' : ''}" data-emoji="${e}" style="padding:4px 10px;">
            ${icon(LOBBY_REACTION_ICONS[e])} ${reactionCounts[e] || ''}
          </button>
        `).join('')}
      </div>

      <div class="stack" style="font-size:13px;">
        ${lobbyComments.map(c => `
          <div class="row between">
            <span><b>${escapeHtml(c.author?.nickname)}</b>: ${escapeHtml(c.content)}</span>
            ${(c.author_id === me.id || isStaff(me)) ? `<button class="delete-lobby-comment-btn" data-id="${c.id}" title="حذف کامنت" style="background:transparent;border:none;color:var(--danger);padding:0 6px;font-size:11px;opacity:.55;">${icon('xmark')}</button>` : ''}
          </div>
        `).join('')}
      </div>
      <form class="lobby-comment-form row" style="margin-top:8px;">
        <input placeholder="کامنت بذار..." />
        <button type="submit">ارسال</button>
      </form>
    </div>
  `
}

function mountLobbies(app, me) {
  const form = app.querySelector('#new-lobby-form')
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(form)
      const btn = form.querySelector('button')
      btn.disabled = true
      try {
        const { error } = await supabase.from('game_lobbies').insert({
          game_name: fd.get('game_name').trim(),
          category: fd.get('category')?.trim() || null,
          description: fd.get('description')?.trim() || null,
          capacity: Number(fd.get('capacity')) || 5,
          host_id: me.id
        })
        if (error) throw error
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  }

  app.querySelectorAll('.join-lobby-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        const { error } = await supabase.from('lobby_members').insert({ lobby_id: btn.dataset.joinLobbyId, user_id: me.id })
        if (error) throw error
        window.location.reload()
      } catch (err) {
        // پیام قابل‌فهم به‌جای خطای خام RLS (ظرفیت پر یا لابی بسته)
        const msg = String(err.message || '')
        toast(msg.includes('row-level security') ? 'نتوانستی بپیوندی — ظرفیت لابی پر شده یا بسته است' : msg, { error: true })
        btn.disabled = false
      }
    })
  })

  // فقط کارت‌های لابی (نه دکمه‌ی join) — قبلاً هر دو data-lobby-id داشتن
  // و commentForm روی دکمه null می‌شد و mount با خطا می‌ترکید
  app.querySelectorAll('.glass.card[data-lobby-id]').forEach(card => {
    const lobbyId = card.dataset.lobbyId

    // ریاکشن لابی: کلیک = ثبت، کلیک مجدد روی همون = برداشتن (تاگل)
    card.querySelectorAll('.lobby-react-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const emoji = btn.dataset.emoji
        const active = btn.classList.contains('reacted')
        try {
          if (active) {
            await supabase.from('lobby_reactions').delete().match({ lobby_id: lobbyId, user_id: me.id, emoji })
          } else {
            await supabase.from('lobby_reactions').insert({ lobby_id: lobbyId, user_id: me.id, emoji })
          }
          window.location.reload()
        } catch (err) { toast(err.message, { error: true }) }
      })
    })

    // حذف کامنت لابی: نویسنده‌ی خودش یا مدیر
    card.querySelectorAll('.delete-lobby-comment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('کامنت حذف بشه؟')) return
        try {
          const { error } = await supabase.from('lobby_comments').delete().eq('id', btn.dataset.id)
          if (error) throw error
          toast('کامنت حذف شد')
          window.location.reload()
        } catch (err) { toast(err.message, { error: true }) }
      })
    })

    const commentForm = card.querySelector('.lobby-comment-form')
    commentForm?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const input = commentForm.querySelector('input')
      const content = input.value.trim()
      if (!content) return
      try {
        await supabase.from('lobby_comments').insert({ lobby_id: lobbyId, author_id: me.id, content })
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}
