import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff } from '../lib/moderation.js'

const STATUS_LABEL = { open: 'باز', full: 'پر', closed: 'بسته' }
const LOBBY_REACTIONS = ['👍', '🔥', '😂']
const LOBBY_REACTION_ICONS = { '👍': 'thumbs-up', '🔥': 'fire', '😂': 'face-laugh-squint' }

// رفرنس ماژول-سطح به کانال realtime لابی‌ها
let lobbiesChannel = null

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
        <div>${lobbyActionBtn(lobby, isMember, isFull)}</div>
      </div>

      <div class="row lobby-reactions-row" style="margin:10px 0;">
        ${LOBBY_REACTIONS.map(e => `
          <button class="lobby-react-btn ${myReactions.has(e) ? 'reacted' : ''}" data-emoji="${e}" style="padding:4px 10px;">
            ${icon(LOBBY_REACTION_ICONS[e])} <small>${reactionCounts[e] || ''}</small>
          </button>
        `).join('')}
      </div>

      <div class="stack lobby-comments-list" style="font-size:13px;">
        ${lobbyComments.map(c => lobbyCommentRowHtml(c, me)).join('')}
      </div>
      <form class="lobby-comment-form row" style="margin-top:8px;">
        <input placeholder="کامنت بذار..." />
        <button type="submit">ارسال</button>
      </form>
    </div>
  `
}

function lobbyActionBtn(lobby, isMember, isFull) {
  if (isMember) return `<a href="#/lobbies/${lobby.id}"><button class="primary">ورود به چت</button></a>`
  if (isFull) return `<button disabled>ظرفیت پره</button>`
  return `<button class="join-lobby-btn" data-join-lobby-id="${lobby.id}">پیوستن</button>`
}

function lobbyCommentRowHtml(c, me) {
  return `
    <div class="row between" data-comment-id="${c.id}">
      <span><b>${escapeHtml(c.author?.nickname)}</b>: ${escapeHtml(c.content)}</span>
      ${(c.author_id === me.id || isStaff(me)) ? `<button class="delete-lobby-comment-btn" data-id="${c.id}" title="حذف کامنت" style="background:transparent;border:none;color:var(--danger);padding:0 6px;font-size:11px;opacity:.55;">${icon('xmark')}</button>` : ''}
    </div>
  `
}

// هندلرهای یه کارت لابی — هم برای رندر اولیه، هم برای کارت‌های realtime
function bindLobbyCard(card, me) {
  const lobbyId = card.dataset.lobbyId

  // پیوستن به لابی
  card.querySelector('.join-lobby-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    try {
      const { error } = await supabase.from('lobby_members').insert({ lobby_id: btn.dataset.joinLobbyId, user_id: me.id })
      if (error) throw error
      toast('به لابی پیوستی')
      window.location.reload()
    } catch (err) {
      const msg = String(err.message || '')
      toast(msg.includes('row-level security') ? 'نتوانستی بپیوندی — ظرفیت لابی پر شده یا بسته است' : msg, { error: true })
      btn.disabled = false
    }
  })

  // ریاکشن لابی: کلیک = ثبت، کلیک مجدد = لغو (تاگل) — شمارنده زنده آپدیت می‌شه
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
        updateLobbyReactionsRow(card, me)
      } catch (err) {
        const msg = String(err.message || '')
        toast(msg.includes('row-level security') ? 'فقط اعضای لابی می‌تونن ریاکشن بذارن — اول بپیوند' : msg, { error: true })
      }
    })
  })

  // حذف کامنت لابی (نویسنده یا مدیر)
  bindLobbyCommentDeleteButtons(card)

  // فرستادن کامنت — ظاهر شدنش با realtime اتفاق می‌افته (رفرش لازم نیست)
  const commentForm = card.querySelector('.lobby-comment-form')
  commentForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = commentForm.querySelector('input')
    const content = input.value.trim()
    if (!content) return
    try {
      await supabase.from('lobby_comments').insert({ lobby_id: lobbyId, author_id: me.id, content })
      input.value = ''
    } catch (err) {
      const msg = String(err.message || '')
      toast(msg.includes('row-level security') ? 'فقط اعضای لابی می‌تونن کامنت بذارن — اول بپیوند' : msg, { error: true })
    }
  })
}

function bindLobbyCommentDeleteButtons(scope) {
  scope.querySelectorAll('.delete-lobby-comment-btn').forEach(btn => {
    if (btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', async () => {
      if (!confirm('کامنت حذف بشه؟')) return
      try {
        const { error } = await supabase.from('lobby_comments').delete().eq('id', btn.dataset.id)
        if (error) throw error
        toast('کامنت حذف شد')
        btn.closest('[data-comment-id]')?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}

// شمارنده‌های ریاکشن یه لابی رو از دیتابیس تازه می‌کنه
async function updateLobbyReactionsRow(card, me) {
  const lobbyId = card.dataset.lobbyId
  const { data: rows } = await supabase.from('lobby_reactions').select('user_id, emoji').eq('lobby_id', lobbyId)
  const counts = {}
  ;(rows || []).forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1 })
  const mySet = new Set((rows || []).filter(r => r.user_id === me.id).map(r => r.emoji))
  card.querySelectorAll('.lobby-react-btn').forEach(btn => {
    const e = btn.dataset.emoji
    const small = btn.querySelector('small')
    if (small) small.textContent = counts[e] || ''
    btn.classList.toggle('reacted', mySet.has(e))
  })
}

function mountLobbies(app, me) {
  // ساخت لابی جدید
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
        toast('لابی ساخته شد')
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  }

  app.querySelectorAll('.glass.card[data-lobby-id]').forEach(card => bindLobbyCard(card, me))
  setupLobbiesRealtime(me)
}

// ────────────────────────────────────────────────────────────────────
// ★ Realtime لابی‌ها: لابی جدید/حذف‌شده، کامنت‌ها و ریاکشن‌ها — همه زنده
// ────────────────────────────────────────────────────────────────────
function setupLobbiesRealtime(me) {
  if (lobbiesChannel) {
    supabase.removeChannel(lobbiesChannel)
    lobbiesChannel = null
  }

  const channel = supabase.channel(`lobbies:${Date.now()}`)

  // لابی جدید → بالای لیست ظاهر می‌شه
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_lobbies' }, async (payload) => {
    const id = payload.new?.id
    if (!id || document.querySelector(`[data-lobby-id="${id}"]`)) return
    const { data: lobby } = await supabase
      .from('game_lobbies')
      .select('*, users!game_lobbies_host_id_fkey(nickname, avatar_url, neon_color), lobby_members(user_id)')
      .eq('id', id).single()
    if (!lobby || lobby.status === 'closed') return
    const list = document.getElementById('lobbies-list')
    if (!list) return
    const empty = list.querySelector('.empty-state')
    if (empty) empty.remove()
    const wrap = document.createElement('div')
    wrap.innerHTML = renderLobby(lobby, me, [], [])
    const card = wrap.firstElementChild
    list.prepend(card)
    bindLobbyCard(card, me)
  })

  // لابی حذف‌شده → محو
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'game_lobbies' }, (payload) => {
    const id = payload.old?.id
    if (id) document.querySelector(`[data-lobby-id="${id}"]`)?.remove()
  })

  // کامنت جدید لابی → زیر همون کارت
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lobby_comments' }, async (payload) => {
    const c = payload.new
    if (!c?.lobby_id) return
    const card = document.querySelector(`[data-lobby-id="${c.lobby_id}"]`)
    if (!card || card.querySelector(`[data-comment-id="${c.id}"]`)) return
    const { data: full } = await supabase
      .from('lobby_comments')
      .select('*, author:users!lobby_comments_author_id_fkey(nickname, avatar_url, neon_color)')
      .eq('id', c.id).single()
    const container = card.querySelector('.lobby-comments-list')
    if (!container) return
    container.insertAdjacentHTML('beforeend', lobbyCommentRowHtml(full || c, me))
    bindLobbyCommentDeleteButtons(container)
  })

  // کامنت حذف‌شده لابی → محو
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lobby_comments' }, (payload) => {
    const id = payload.old?.id
    if (id) document.querySelector(`[data-comment-id="${id}"]`)?.remove()
  })

  // ریاکشن‌های لابی → شمارنده زنده
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_reactions' }, (payload) => {
    const lobbyId = payload.new?.lobby_id || payload.old?.lobby_id
    if (!lobbyId) return
    const card = document.querySelector(`[data-lobby-id="${lobbyId}"]`)
    if (card) updateLobbyReactionsRow(card, me)
  })

  channel.subscribe()
  lobbiesChannel = channel

  window.addEventListener('hashchange', () => {
    if (lobbiesChannel === channel) {
      supabase.removeChannel(channel)
      lobbiesChannel = null
    }
  }, { once: true })
}
