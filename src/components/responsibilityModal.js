import { supabase } from '../lib/supabaseClient.js'
import { clearProfileCache } from '../lib/auth.js'

export function showResponsibilityModal(userId, onDone) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="glass modal stack">
      <h2>قبل از ورود...</h2>
      <p class="text-dim">
        این‌جا یه فضای خصوصیه، نه یه شبکه‌ی اجتماعی عمومی. هر کسی مسئول
        رفتار و محتوایی هست که خودش می‌ذاره. آزار، تحقیر یا مزاحمت برای
        بقیه‌ی اعضا مجاز نیست و منجر به محدود یا حذف شدن می‌شه. اگه رفتار
        نامناسبی دیدی، از دکمه‌ی Report یا Block استفاده کن.
      </p>
      <button class="primary" id="accept-responsibility">فهمیدم، قبول دارم</button>
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
