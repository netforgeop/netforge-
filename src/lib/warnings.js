import { supabase } from './supabaseClient.js'
import { escapeHtml, icon } from './utils.js'
import { t } from './i18n.js'

// ════════════════════════════════════════════════════════════════════
//  اخطارهای مدیریت — پاپ‌آپ realtime روی صفحه‌ی کاربر
//  · اگر آنلاین باشه: همون لحظه که ادمین اخطار می‌ده بالا میاد
//  · اگر آفلاین باشه: اولین باری که سایت رو باز می‌کنه نشون داده می‌شه
//  کاربر باید «متوجه شدم» رو بزنه تا خوانده‌شده ثبت بشه.
// ════════════════════════════════════════════════════════════════════

let warnChannel = null
let popupOpen = false

function showWarningPopup(notif, onAck) {
  if (popupOpen) return
  popupOpen = true
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop warning-backdrop'
  wrap.innerHTML = `
    <div class="glass modal warning-modal">
      <div class="warning-icon">${icon('triangle-exclamation', 'fa-2x')}</div>
      <h3 style="margin:6px 0;">${t('اخطار مدیریت', 'Moderation warning')}</h3>
      <p class="warning-text">${escapeHtml(notif.message || '')}</p>
      <button class="primary" id="warning-ok-btn" style="width:100%;">${icon('check')} ${t('متوجه شدم', 'Got it')}</button>
    </div>
  `
  document.body.appendChild(wrap)
  wrap.querySelector('#warning-ok-btn').addEventListener('click', async () => {
    try { await onAck?.() } catch { /* ignore */ }
    wrap.remove()
    popupOpen = false
  })
}

async function checkPendingWarnings(me) {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', me.id)
    .eq('type', 'warning')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
  const list = data || []
  if (!list.length) return
  // یکی‌یکی نشون بده (آخرین اول)
  let i = 0
  const showNext = () => {
    if (i >= list.length) return
    const n = list[i++]
    showWarningPopup(n, async () => {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      showNext()
    })
  }
  showNext()
}

export function initWarningWatcher(me) {
  // ۱) اخطارهای خوانده‌نشده‌ی قبلی (اگر آفلاین بوده)
  checkPendingWarnings(me)

  // ۲) اخطار زنده (اگر آنلاینه)
  if (warnChannel) {
    supabase.removeChannel(warnChannel)
    warnChannel = null
  }
  warnChannel = supabase
    .channel(`warnings:${me.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, (payload) => {
      const n = payload.new
      if (n?.type !== 'warning') return
      showWarningPopup(n, async () => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      })
    })
    .subscribe()
}
