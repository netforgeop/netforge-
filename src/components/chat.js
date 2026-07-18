import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from './navbar.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'
import { isStaff, softDeleteMessage } from '../lib/moderation.js'

// یه رفرنس ماژول-سطح به کانال چت فعال؛ قبل از باز کردن کانال جدید
// (مثلاً وقتی کاربر بین چت‌های مختلف جابه‌جا می‌شه) این رو می‌بندیم تا
// دو بار subscribe روی یه topic اتفاق نیفته.
let activeChannel = null

export function chatMarkup() {
  return `
    <div class="glass" style="padding:14px;">
      <div class="chat-scroll" id="chat-scroll"></div>
      <form id="chat-form" class="chat-input-row">
        <input id="chat-input" placeholder="پیام بنویس... (Enter = ارسال)" autocomplete="off" />
        <button type="button" id="chat-attach-toggle" title="پیوست" style="padding:6px 10px;">📎</button>
        <input id="chat-attachment" placeholder="لینک فایل..." style="max-width:150px; display:none;" />
        <button type="submit" class="primary">ارسال</button>
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

  // ── اجرای محدودیت در سمت کلاینت: میوت/تایم‌اوت/بن = فرم غیرفعال ──
  // (اجرا در سطح دیتابیس هم با RLS انجام می‌شه؛ این فقط برای UX بهتره)
  if (me.activeSanction && ['mute', 'timeout', 'ban'].includes(me.activeSanction.type)) {
    form.innerHTML = `<div class="text-dim" style="text-align:center; padding:8px;">🔇 به خاطر محدودیت فعال نمی‌توانید پیام بفرستید.</div>`
    // لیست پیام‌ها همچنان لود می‌شه تا کاربر بتونه چت رو ببینه (مگر بن باشه که shell جلوش رو می‌گیره)
  }

  // نمایش/پنهان کردن فیلد لینک پیوست با دکمه 📎 (مرتب‌تر، مخصوصاً روی موبایل)
  const attachToggle = app.querySelector('#chat-attach-toggle')
  attachToggle?.addEventListener('click', () => {
    attachmentInput.style.display = attachmentInput.style.display === 'none' ? '' : 'none'
    if (attachmentInput.style.display !== 'none') attachmentInput.focus()
  })

  // آیا پیام جدید باید باعث اسکرول به پایین بشه؟
  // فقط وقتی کاربر الان نزدیک ته اسکروله؛ وسط خواندن پیام‌های قدیمی پرش نداریم
  function isNearBottom() {
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120
  }

  async function loadMessages() {
    const wasNearBottom = isNearBottom()
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(nickname, avatar_url, neon_color)')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) { toast(error.message, { error: true }); return }
    scrollEl.innerHTML = data.length
      ? data.map(renderMessage).join('')
      : `<div class="empty-state" style="padding:30px;">هنوز پیامی نیست. اولین پیام رو تو بفرست 👋</div>`
    bindDeleteButtons()
    if (wasNearBottom) scrollEl.scrollTop = scrollEl.scrollHeight
  }

  function renderMessage(m) {
    const u = m.sender || {}
    if (m.is_deleted) {
      return `<div class="msg deleted"><div class="bubble">🗑 پیام حذف شد</div></div>`
    }
    const isMine = m.sender_id === me.id
    // دکمه حذف: فقط برای پیام خودم یا ادمین/ناظم
    const canDelete = isMine || isStaff(me)
    return `
      <div class="msg ${isMine ? 'mine' : ''}" data-msg-id="${m.id}">
        ${!isMine ? `<img class="avatar sm ${neonClass(u.neon_color)}" src="${escapeHtml(u.avatar_url || defaultAvatar(u.nickname))}">` : ''}
        <div class="msg-body">
          <div class="text-dim" style="font-size:12px;">
            ${escapeHtml(u.nickname)} · ${timeAgo(m.created_at)} ${m.is_edited ? '(ویرایش‌شده)' : ''}
            ${canDelete ? `<button class="msg-delete-btn" data-id="${m.id}" title="حذف پیام">🗑</button>` : ''}
          </div>
          <div class="bubble">
            ${m.content ? escapeHtml(m.content) : ''}
            ${m.attachment_url ? `<div><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">📎 پیوست</a></div>` : ''}
          </div>
        </div>
      </div>
    `
  }

  function bindDeleteButtons() {
    scrollEl.querySelectorAll('.msg-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('پیام حذف بشه؟')) return
        try {
          await softDeleteMessage(btn.dataset.id)
        } catch (err) { toast(err.message, { error: true }) }
      })
    })
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
    if (error) {
      // خطای RLS برای کاربر میوت‌شده رو فارسی و قابل‌فهم نشون بده
      if (me.activeSanction) {
        toast('به خاطر محدودیت فعال نمی‌توانید پیام بفرستید.', { error: true })
      } else if (String(error.message || '').includes('row-level security')) {
        toast('فقط اعضا می‌تونن پیام بفرستن 👀', { error: true })
      } else {
        toast(error.message, { error: true })
      }
      return
    }
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
