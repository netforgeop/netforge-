import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff } from '../lib/moderation.js'
import { t } from '../lib/i18n.js'

// رفرنس ماژول-سطح به کانال realtime تیکت
let ticketsChannel = null

const STATUS_META = {
  open: { cls: 'ticket-open', fa: 'باز', en: 'Open' },
  in_progress: { cls: 'ticket-progress', fa: 'در حال بررسی', en: 'In progress' },
  resolved: { cls: 'ticket-resolved', fa: 'حل‌شده', en: 'Resolved' }
}

export default async function ticketsPage() {
  return withShell('tickets', async (profile) => {
    const staff = isStaff(profile)
    const isAdmin = profile.role === 'admin'

    // تیکت‌های خودم (همیشه) + باکس ورودی برای مدیران
    // (ادمین همه رو می‌بینه؛ ناظم فقط تیکت‌هایی که برای «مدیریت» زده شدن — RLS هم همینه)
    const [{ data: tickets, error }] = await Promise.all([
      supabase
        .from('tickets')
        .select('*, owner:users!tickets_user_id_fkey(nickname, avatar_url, neon_color)')
        .order('updated_at', { ascending: false })
    ])
    if (error) throw error

    const myTickets = (tickets || []).filter(tk => tk.user_id === profile.id)
    const staffInbox = staff ? (tickets || []).filter(tk => tk.user_id !== profile.id) : []

    const html = `
      <div class="glass card">
        <h3>${icon('life-ring')} ${t('تیکت جدید', 'New ticket')}</h3>
        <p class="text-dim" style="font-size:13px;">${t('برای ارتباط با تیم پشتیبانی تیکت بزن؛ دلیلش رو بنویس و بگو کارِ کیه — مدیران پاسخ می‌دن.', 'Contact the support team with a ticket — write your reason and choose who it is for.')}</p>
        <form id="new-ticket-form" class="stack">
          <label class="text-dim">${t('موضوع / دلیل تیکت', 'Subject / reason')}</label>
          <input name="subject" maxlength="80" placeholder="${t('مثلاً: مشکل ورود به حساب', 'e.g. Problem logging in')}" required />
          <label class="text-dim">${t('این تیکت برای کیه؟', 'Who should handle it?')}</label>
          <select name="audience">
            <option value="admin">${t('فقط ادمین‌ها', 'Admins only')}</option>
            <option value="mods">${t('تیم مدیریت (ادمین و ناظم)', 'Mod team (admins & moderators)')}</option>
          </select>
          <label class="text-dim">${t('توضیح کامل', 'Full message')}</label>
          <textarea name="message" rows="3" placeholder="${t('مشکلت رو کامل بنویس...', 'Describe your issue...')}" required></textarea>
          <button class="primary" type="submit">${icon('paper-plane')} ${t('فرستادن تیکت', 'Send ticket')}</button>
        </form>
      </div>

      <div class="glass card">
        <h3>${t('تیکت‌های من', 'My tickets')} (${myTickets.length})</h3>
        ${myTickets.length ? myTickets.map(tk => ticketRowHtml(tk, false)).join('') : `<p class="text-dim">${t('هنوز تیکتی نزدی.', 'No tickets yet.')}</p>`}
      </div>

      ${staff ? `
        <div class="glass card">
          <h3>${icon('inbox')} ${t('صندوق تیکت‌ها (مدیریت)', 'Ticket inbox (staff)')} (${staffInbox.length})</h3>
          ${staffInbox.length ? staffInbox.map(tk => ticketRowHtml(tk, true)).join('') : `<p class="text-dim">${t('تیکتی نیست.', 'No tickets.')}</p>`}
        </div>
      ` : ''}

      <!-- کارت چت تیکت بازشده -->
      <div class="glass card" id="ticket-thread-card" style="display:none;">
        <div class="row between">
          <h3 id="ticket-thread-title" style="margin:0;"></h3>
          <button class="danger" id="close-ticket-thread" style="padding:4px 8px;">${icon('xmark')}</button>
        </div>
        <div id="ticket-thread-status-row" class="row" style="gap:6px; margin:6px 0 12px;"></div>
        <div class="ticket-thread stack" id="ticket-thread-list"></div>
        <div id="ticket-staff-actions" class="row" style="gap:8px; margin-top:12px;"></div>
        <form id="ticket-reply-form" class="chat-input-row">
          <input id="ticket-reply-input" placeholder="${t('پاسخ بنویس...', 'Write a reply...')}" autocomplete="off" />
          <button type="submit" class="primary">${t('ارسال', 'Send')}</button>
        </form>
      </div>
    `

    return { html, mount: (app) => mountTickets(app, profile) }
  })
}

function ticketRowHtml(tk, showOwner) {
  const st = STATUS_META[tk.status] || STATUS_META.open
  return `
    <div class="row between" style="margin-bottom:6px; padding:8px 0; border-top:1px solid var(--glass-border);">
      <div class="row">
        ${showOwner ? `<img class="avatar sm ${neonClass(tk.owner?.neon_color)}" src="${escapeHtml(tk.owner?.avatar_url || defaultAvatar(tk.owner?.nickname))}">` : ''}
        <div>
          <b>${escapeHtml(tk.subject)}</b>
          <div class="text-dim" style="font-size:11px;">
            ${showOwner ? `${escapeHtml(tk.owner?.nickname || '')} · ` : ''}
            ${tk.audience === 'mods' ? t('مدیریت', 'mods') : t('ادمین', 'admins')} · ${timeAgo(tk.updated_at)}
          </div>
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <span class="badge ${st.cls}">${t(st.fa, st.en)}</span>
        <button class="open-ticket-btn primary" data-ticket-id="${tk.id}" data-subject="${escapeHtml(tk.subject)}" data-status="${tk.status}" style="padding:4px 12px; font-size:12px;">${t('بازکردن', 'Open')}</button>
      </div>
    </div>
  `
}

function mountTickets(app, profile) {
  const staff = isStaff(profile)
  const isAdmin = profile.role === 'admin'
  let openTicket = null // { id, subject, status }

  // ── ساخت تیکت ──
  const form = app.querySelector('#new-ticket-form')
  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const subject = fd.get('subject')?.trim()
    const message = fd.get('message')?.trim()
    const audience = fd.get('audience')
    if (!subject || !message) return
    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      const { data: ticket, error } = await supabase
        .from('tickets')
        .insert({ user_id: profile.id, subject, audience })
        .select()
        .single()
      if (error) throw error
      const { error: msgErr } = await supabase.from('ticket_messages').insert({
        ticket_id: ticket.id, sender_id: profile.id, content: message
      })
      if (msgErr) throw msgErr
      toast(t('تیکتت فرستاده شد — مدیران بهت خبر می‌دن', 'Ticket sent — the staff will get back to you'))
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })

  // ── باز کردن رشته‌ی چت تیکت ──
  async function openTicketThread(ticketId, subject, status) {
    openTicket = { id: ticketId, subject, status }
    const card = app.querySelector('#ticket-thread-card')
    card.style.display = ''
    app.querySelector('#ticket-thread-title').textContent = `「${subject}」`
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    await renderThread()
  }

  function renderStatusRow() {
    if (!openTicket) return
    const st = STATUS_META[openTicket.status] || STATUS_META.open
    app.querySelector('#ticket-thread-status-row').innerHTML = `
      <span class="badge ${st.cls}">${t(st.fa, st.en)}</span>
      ${openTicket.status === 'resolved' ? `<span class="text-dim" style="font-size:12px;">${t('این تیکت بسته شده.', 'This ticket is closed.')}</span>` : ''}
    `
    // اکشن‌های مدیر: در حال بررسی / حل‌شده
    const actionsEl = app.querySelector('#ticket-staff-actions')
    if (staff && openTicket.status !== 'resolved') {
      actionsEl.innerHTML = `
        ${openTicket.status === 'open' ? `<button id="ticket-progress-btn" style="font-size:12px; padding:5px 12px;">${icon('hourglass-half')} ${t('در حال بررسی', 'Mark in progress')}</button>` : ''}
        <button id="ticket-resolve-btn" style="font-size:12px; padding:5px 12px;">${icon('circle-check')} ${t('حل‌شده', 'Mark resolved')}</button>
      `
      actionsEl.querySelector('#ticket-progress-btn')?.addEventListener('click', () => setTicketStatus('in_progress'))
      actionsEl.querySelector('#ticket-resolve-btn')?.addEventListener('click', () => setTicketStatus('resolved'))
    } else {
      actionsEl.innerHTML = ''
    }
    // فرم پاسخ برای تیکت حل‌شده مخفی می‌شه
    const replyForm = app.querySelector('#ticket-reply-form')
    if (replyForm) replyForm.style.display = openTicket.status === 'resolved' ? 'none' : 'flex'
  }

  async function setTicketStatus(status) {
    try {
      const { error } = await supabase.from('tickets').update({
        status,
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        resolved_by: status === 'resolved' ? profile.id : null
      }).eq('id', openTicket.id)
      if (error) throw error
      openTicket.status = status
      renderStatusRow()
      toast(status === 'resolved' ? t('تیکت حل‌شده علامت خورد', 'Marked as resolved') : t('وضعیت تیکت آپدیت شد', 'Ticket status updated'))
      setTimeout(() => window.location.reload(), 800)
    } catch (err) { toast(err.message, { error: true }) }
  }

  async function renderThread() {
    if (!openTicket) return
    const listEl = app.querySelector('#ticket-thread-list')
    const { data: msgs, error } = await supabase
      .from('ticket_messages')
      .select('*, sender:users!ticket_messages_sender_id_fkey(nickname, avatar_url, neon_color)')
      .eq('ticket_id', openTicket.id)
      .order('created_at')
    if (error) { toast(error.message, { error: true }); return }
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 100
    listEl.innerHTML = (msgs || []).map(m => {
      const mine = m.sender_id === profile.id
      // برای کاربر عادی، پیام‌های طرف مقابل = تیم پشتیبانی (بج می‌خوره)
      const staffBadge = !mine && !staff ? `<span class="badge mod">${t('تیم پشتیبانی', 'Support')}</span>` : ''
      return `
        <div class="msg ${mine ? 'mine' : ''}">
          ${!mine ? `<img class="avatar sm ${neonClass(m.sender?.neon_color)}" src="${escapeHtml(m.sender?.avatar_url || defaultAvatar(m.sender?.nickname))}">` : ''}
          <div class="msg-body">
            <div class="text-dim" style="font-size:12px;">${escapeHtml(m.sender?.nickname || '')} ${staffBadge} · ${timeAgo(m.created_at)}</div>
            <div class="bubble">${escapeHtml(m.content)}</div>
          </div>
        </div>
      `
    }).join('') || `<div class="empty-state">${t('پیامی نیست.', 'No messages.')}</div>`
    if (nearBottom) listEl.scrollTop = listEl.scrollHeight
    renderStatusRow()
  }

  app.querySelectorAll('.open-ticket-btn').forEach(btn => {
    btn.addEventListener('click', () => openTicketThread(btn.dataset.ticketId, btn.dataset.subject, btn.dataset.status))
  })
  app.querySelector('#close-ticket-thread')?.addEventListener('click', () => {
    openTicket = null
    app.querySelector('#ticket-thread-card').style.display = 'none'
  })

  // ── پاسخ ──
  const replyForm = app.querySelector('#ticket-reply-form')
  replyForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!openTicket) return
    const input = app.querySelector('#ticket-reply-input')
    const content = input.value.trim()
    if (!content) return
    const btn = replyForm.querySelector('button')
    btn.disabled = true
    try {
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: openTicket.id, sender_id: profile.id, content
      })
      if (error) throw error
      input.value = ''
      await renderThread() // بلافاصله ببینش؛ برای طرف مقابل هم realtime و اعلان می‌ره
    } catch (err) {
      toast(err.message, { error: true })
    } finally {
      btn.disabled = false
    }
  })

  // ── Realtime: پاسخ‌های زنده‌ی تیکت باز ──
  if (ticketsChannel) {
    supabase.removeChannel(ticketsChannel)
    ticketsChannel = null
  }
  const channel = supabase
    .channel(`tickets:${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages' }, async (payload) => {
      if (openTicket && payload.new?.ticket_id === openTicket.id) {
        await renderThread()
      }
    })
    .subscribe()
  ticketsChannel = channel
  window.addEventListener('hashchange', () => {
    if (ticketsChannel === channel) {
      supabase.removeChannel(channel)
      ticketsChannel = null
    }
  }, { once: true })
}
