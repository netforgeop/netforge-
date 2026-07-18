import { supabase } from '../lib/supabaseClient.js'
import { clearProfileCache } from '../lib/auth.js'
import { t } from '../lib/i18n.js'

export function showResponsibilityModal(userId, onDone) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="glass modal stack">
      <h2>${t('قبل از ورود...', 'Before you enter...')}</h2>
      <p class="text-dim">
        ${t(
          'این‌جا یه فضای خصوصیه، نه یه شبکه‌ی اجتماعی عمومی. هر کسی مسئول رفتار و محتوایی هست که خودش می‌ذاره. آزار، تحقیر یا مزاحمت برای بقیه‌ی اعضا مجاز نیست و منجر به محدود یا حذف شدن می‌شه. اگه رفتار نامناسبی دیدی، از دکمه‌ی Report یا Block استفاده کن.',
          'This is a private space, not a public social network. Everyone is responsible for their own behavior and content. Harassment or abuse toward other members is not allowed and leads to restriction or removal. If you see bad behavior, use the Report or Block buttons.'
        )}
      </p>
      <button class="primary" id="accept-responsibility">${t('فهمیدم، قبول دارم', 'I understand, I agree')}</button>
    </div>
  `
  document.body.appendChild(wrap)
  wrap.querySelector('#accept-responsibility').addEventListener('click', async () => {
    await supabase.from('users').update({ has_seen_responsibility_popup: true }).eq('id', userId)
    clearProfileCache()
    wrap.remove()
    onDone?.()
  })
}
