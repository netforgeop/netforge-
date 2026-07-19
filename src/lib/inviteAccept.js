import { supabase } from './supabaseClient.js'
import { escapeHtml, toast, icon } from './utils.js'
import { t } from './i18n.js'

// ─────────────────────────────────────────────────────────────────────
// کارت دعوت به گروه/لابی خصوصی:
// وقتی کاربر دعوت‌شده لینک رو باز می‌کنه، چون هنوز عضو نیست RLS اجازه‌ی
// دیدن صفحه رو نمی‌ده؛ به‌جای ارور «پیدا نشد» این کارتِ دعوت می‌بینه و
// با «قبول و ورود» خودش عضو می‌شه (RPC امن توی netforge_v7.sql).
// ─────────────────────────────────────────────────────────────────────
export function inviteAcceptCard({ iconName, title, message, notifId, rpcName, rpcParam, backHash }) {
  const html = `
    <a href="${backHash}">${t('→ بازگشت', '← Back')}</a>
    <div class="glass card" style="text-align:center; padding:38px 20px; margin-top:14px;">
      <div style="font-size:38px; margin-bottom:12px; color:var(--neon);">${icon(iconName)}</div>
      <h2 style="margin:0 0 8px;">${title}</h2>
      <p class="text-dim" style="margin-bottom:20px; line-height:1.9;">${escapeHtml(message || '')}</p>
      <div class="row" style="justify-content:center; gap:10px;">
        <button class="primary" id="accept-invite-btn">${icon('check')} ${t('قبول و ورود', 'Accept & join')}</button>
        <button class="danger" id="decline-invite-btn">${icon('xmark')} ${t('رد دعوت', 'Decline')}</button>
      </div>
    </div>`

  const mount = (app) => {
    app.querySelector('#accept-invite-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        const { error } = await supabase.rpc(rpcName, rpcParam)
        if (error) throw error
        await supabase.from('notifications').delete().eq('id', notifId)
        toast(t('عضو شدی! خوش اومدی', 'Joined — welcome!'))
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
    app.querySelector('#decline-invite-btn')?.addEventListener('click', async () => {
      await supabase.from('notifications').delete().eq('id', notifId)
      window.location.hash = backHash
    })
  }

  return { html, mount }
}
