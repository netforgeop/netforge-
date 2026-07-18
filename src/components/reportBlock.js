import { supabase } from '../lib/supabaseClient.js'
import { toast, icon } from '../lib/utils.js'

export function reportBlockMarkup(targetUserId, { targetType = 'user', targetId = targetUserId } = {}) {
  return `
    <div class="row" style="gap:4px;">
      <button class="report-btn" data-target-type="${targetType}" data-target-id="${targetId}" title="گزارش" style="padding:2px 8px;font-size:12px;">${icon('flag')}</button>
      <button class="block-btn" data-user-id="${targetUserId}" title="بلاک" style="padding:2px 8px;font-size:12px;">${icon('ban')}</button>
    </div>
  `
}

export function attachReportBlock(root, me) {
  root.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('دلیل گزارش رو بنویس (اختیاری):') || ''
      try {
        const { error } = await supabase.from('reports').insert({
          reporter_id: me.id,
          target_type: btn.dataset.targetType,
          target_id: btn.dataset.targetId,
          reason
        })
        if (error) throw error
        toast('گزارش ثبت شد. ممنون که خبر دادی.')
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  root.querySelectorAll('.block-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.userId === me.id) return
      if (!confirm('این کاربر بلاک بشه؟ محتواش دیگه برات نمایش داده نمی‌شه.')) return
      try {
        const { error } = await supabase.from('user_blocks').insert({ blocker_id: me.id, blocked_id: btn.dataset.userId })
        if (error) throw error
        toast('کاربر بلاک شد')
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}
