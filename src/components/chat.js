import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from './navbar.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'

// یه رفرنس ماژول-سطح به کانال چت فعال؛ قبل از باز کردن کانال جدید
// (مثلاً وقتی کاربر بین چت‌های مختلف جابه‌جا می‌شه) این رو می‌بندیم تا
// دو بار subscribe روی یه topic اتفاق نیفته.
let activeChannel = null

export function chatMarkup() {
  return `
    <div class="glass" style="padding:14px;">
      <div class="chat-scroll" id="chat-scroll"></div>
      <form id="chat-form" class="chat-input-row">
        <input id="chat-input" placeholder="پیام بنویس..." autocomplete="off" />
        <input id="chat-attachment" placeholder="لینک فایل (اختیاری)" style="max-width:160px;" />
        <button type="submit">ارسال</button>
      </form>
    </div>
  `
}

export async function mountChat(app, { targetType, targetId, me }) {
  const scrollEl = app.querySelector('#chat-scroll')
  const form = app.querySelector('#chat-form')
  const input = app.querySelector('#chat-input')
  const attachmentInput = app.querySelector('#chat-attachment')
  if (!scrollEl || !form || !input || !attachmentInput) return

  // اگه از یه چت دیگه اومدیم اینجا و کانال قبلی هنوز باز بود، اول ببندش
  if (activeChannel) {
    supabase.removeChannel(activeChannel)
    activeChannel = null
  }

  async function loadMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(nickname, avatar_url, neon_color)')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) { toast(error.message, { error: true }); return }
    scrollEl.innerHTML = data.map(renderMessage).join('')
    scrollEl.scrollTop = scrollEl.scrollHeight
  }

  function renderMessage(m) {
    const u = m.sender || {}
    if (m.is_deleted) {
      return `<div class="msg deleted"><div class="bubble">پیام حذف شد</div></div>`
    }
    return `
      <div class="msg">
        <img class="avatar sm ${neonClass(u.neon_color)}" src="${escapeHtml(u.avatar_url || defaultAvatar(u.nickname))}">
        <div>
          <div class="text-dim" style="font-size:12px;">${escapeHtml(u.nickname)} · ${timeAgo(m.created_at)} ${m.is_edited ? '(ویرایش‌شده)' : ''}</div>
          <div class="bubble">
            ${m.content ? escapeHtml(m.content) : ''}
            ${m.attachment_url ? `<div><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">📎 پیوست</a></div>` : ''}
          </div>
        </div>
      </div>
    `
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const content = input.value.trim()
    const attachment = attachmentInput.value.trim()
    if (!content && !attachment) return
    const { error } = await supabase.from('messages').insert({
      target_type: targetType,
      target_id: targetId,
      sender_id: me.id,
      content: content || null,
      attachment_url: attachment || null
    })
    if (error) { toast(error.message, { error: true }); return }
    input.value = ''
    attachmentInput.value = ''
  })

  await loadMessages()

  const channel = supabase
    .channel(`messages:${targetType}:${targetId}:${Date.now()}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'messages',
      filter: `target_id=eq.${targetId}`
    }, () => loadMessages())
    .subscribe()

  activeChannel = channel

  window.addEventListener('hashchange', () => {
    if (activeChannel === channel) {
      supabase.removeChannel(channel)
      activeChannel = null
    }
  }, { once: true })
}
