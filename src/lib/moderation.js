import { supabase } from './supabaseClient.js'
import { toast } from './utils.js'

// آیا کاربر فعلی ادمین یا ناظم است؟
export function isStaff(profile) {
  return profile?.role === 'admin' || profile?.role === 'moderator'
}

// نوع محدودیت فعال کاربر جاری (اگر هست) — برای غیرفعال کردن فرم‌ها
export async function getMyActiveSanction(myId) {
  const { data, error } = await supabase
    .from('user_sanctions')
    .select('type, reason, expires_at, created_at')
    .eq('user_id', myId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) {
    // اگه جدول user_sanctions هنوز ساخته نشده (SQL اجرا نشده)، سایت مثل قبل کار کنه
    console.warn('sanction check skipped:', error.message)
    return null
  }
  // فیلتر «هنوز منقضی نشده» رو سمت کلاینت انجام می‌دیم تا کوئری ساده بمونه
  const now = Date.now()
  return (data || []).find(s => !s.expires_at || new Date(s.expires_at).getTime() > now) || null
}

// پیام متناسب با محدودیت کاربر جاری (برای toast یا بنر)
export function sanctionMessage(s) {
  if (!s) return ''
  const expiry = s.expires_at
    ? ` تا ${new Date(s.expires_at).toLocaleString('fa-IR')}`
    : ' (دائم)'
  switch (s.type) {
    case 'ban': return `حساب شما مسدود شده است${expiry}.`
    case 'mute': return `شما میوت هستید و نمی‌توانید محتوا بفرستید${expiry}.`
    case 'timeout': return `شما در تایم‌اوت هستید${expiry}.`
    default: return 'حساب شما محدود شده است.'
  }
}

// --------------------------------------------------------------------
// اکشن‌های مدیریتی روی یک کاربر هدف (از پروفایل عمومی یا پنل ادمین)
// --------------------------------------------------------------------
export async function applySanction(me, { userId, type, minutes = null, reason = '' }) {
  if (!isStaff(me)) throw new Error('دسترسی کافی نداری')
  const row = {
    user_id: userId,
    type,
    reason,
    created_by: me.id,
    is_active: true,
    expires_at: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null
  }
  let { error } = await supabase.from('user_sanctions').insert(row)
  // سازگاری با اسکیمای قدیمی: اگر جدول ستون issued_by اجباری دارد، با آن هم retry کن
  if (error && /issued_by/i.test(error.message || '')) {
    ;({ error } = await supabase.from('user_sanctions').insert({ ...row, issued_by: me.id }))
  }
  if (error) throw error
}

export async function liftSanction(sanctionId, me) {
  const { error } = await supabase
    .from('user_sanctions')
    .update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: me.id })
    .eq('id', sanctionId)
  if (error) throw error
}

// گرفتن محدودیت فعال یک کاربر خاص (برای نمایش به مدیر)
export async function getActiveSanctionFor(userId) {
  const { data, error } = await supabase
    .from('user_sanctions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) return null
  const now = Date.now()
  return (data || []).find(s => !s.expires_at || new Date(s.expires_at).getTime() > now) || null
}

// --------------------------------------------------------------------
// حذف محتوا توسط مدیران (پست، کامنت پست، پیام چت)
// توجه: کاربر عادی فقط محتوای خودش را می‌تواند حذف کند (با RLS قبلی)
// --------------------------------------------------------------------
export async function deletePostAsStaff(postId) {
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  if (error) throw error
}

export async function deleteCommentAsStaff(commentId) {
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId)
  if (error) throw error
}

export async function softDeleteMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .update({ is_deleted: true, content: null, attachment_url: null })
    .eq('id', messageId)
  if (error) throw error
}

// --------------------------------------------------------------------
// مودال انتخاب نوع و مدت محدودیت — یک مودال ساده با خودِ سایت هماهنگ
// onDone بعد از ثبت موفق صدا زده می‌شود (مثلاً برای reload صفحه)
// --------------------------------------------------------------------
export function openSanctionModal(me, targetUser, onDone) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="glass modal" dir="rtl">
      <div class="row between" style="margin-bottom:15px;">
        <h3>⚖️ محدود کردن ${targetUser.nickname}</h3>
        <button class="danger" id="sm-close" style="padding:4px 8px;">✕</button>
      </div>
      <div class="stack">
        <label class="text-dim">نوع محدودیت</label>
        <select id="sm-type">
          <option value="timeout">⏳ تایم‌اوت (موقت، غیرفعال شدن ارسال محتوا)</option>
          <option value="mute">🔇 میوت (قطع ارسال محتوا تا رفع دستی)</option>
          <option value="ban">⛔ بن (مسدود شدن کامل حساب)</option>
        </select>

        <label class="text-dim">مدت زمان</label>
        <select id="sm-duration">
          <option value="10">۱۰ دقیقه</option>
          <option value="60" selected>۱ ساعت</option>
          <option value="1440">۱ روز</option>
          <option value="10080">۱ هفته</option>
          <option value="">دائم (تا رفع دستی)</option>
        </select>

        <label class="text-dim">دلیل (اختیاری)</label>
        <input id="sm-reason" placeholder="مثلاً: اسپم در چت گروه" />

        <button class="danger" id="sm-apply">اعمال محدودیت</button>
      </div>
    </div>
  `
  document.body.appendChild(wrap)
  wrap.querySelector('#sm-close').addEventListener('click', () => wrap.remove())
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove() })

  wrap.querySelector('#sm-apply').addEventListener('click', async () => {
    const btn = wrap.querySelector('#sm-apply')
    btn.disabled = true
    try {
      const type = wrap.querySelector('#sm-type').value
      const durVal = wrap.querySelector('#sm-duration').value
      const minutes = durVal === '' ? null : Number(durVal)
      const reason = wrap.querySelector('#sm-reason').value.trim()
      await applySanction(me, { userId: targetUser.id, type, minutes, reason })
      toast(`محدودیت ${type} روی ${targetUser.nickname} اعمال شد`)
      wrap.remove()
      onDone?.()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })
}
