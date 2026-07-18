import { supabase } from './supabaseClient.js'
import { toast, icon } from './utils.js'
import { t, dateLocale } from './i18n.js'

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
    ? ` ${t('تا', 'until')} ${new Date(s.expires_at).toLocaleString(dateLocale())}`
    : t(' (دائم)', ' (permanent)')
  switch (s.type) {
    case 'ban': return t(`حساب شما مسدود شده است${expiry}.`, `Your account is banned${expiry}.`)
    case 'mute': return t(`شما میوت هستید و نمی‌توانید محتوا بفرستید${expiry}.`, `You are muted and cannot post content${expiry}.`)
    case 'timeout': return t(`شما در تایم‌اوت هستید${expiry}.`, `You are in timeout${expiry}.`)
    default: return t('حساب شما محدود شده است.', 'Your account is restricted.')
  }
}

// --------------------------------------------------------------------
// اکشن‌های مدیریتی روی یک کاربر هدف (از پروفایل عمومی یا پنل ادمین)
// --------------------------------------------------------------------
export async function applySanction(me, { userId, type, minutes = null, reason = '' }) {
  if (!isStaff(me)) throw new Error(t('دسترسی کافی نداری', 'Not enough permission'))
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
// لاگ اقدامات مدیریتی — هر حذف/محدودیت با «دلیل» ثبت می‌شه تا توی
// «لاگ سایت» (پنل ادمین) و کارت «اقدامات روی حساب من» (پروفایل خود کاربر) بیاد
// --------------------------------------------------------------------
export async function logModAction(me, { action, targetType = 'user', targetId = null, targetUserId = null, reason = '', snapshot = null }) {
  if (!isStaff(me)) return
  const { error } = await supabase.from('mod_actions').insert({
    actor_id: me.id,
    action,
    target_type: targetType,
    target_id: targetId,
    target_user_id: targetUserId,
    reason: reason || '',
    snapshot
  })
  if (error) console.warn('mod action log failed:', error.message)
}

// گرفتن دلیل از مدیر — برای حذف/محدودیت «اجباری» است؛ null = لغو شد
export function askModReason(what) {
  const reason = prompt(t(`دلیل ${what} رو بنویس (اجباری — توی لاگ سایت و پروفایل کاربر دیده می‌شه):`, `Reason for this action (required — shown in the site log and the user's profile):`))
  if (reason === null) return null
  if (!reason.trim()) {
    toast(t('نوشتن دلیل اجباریه', 'A reason is required'), { error: true })
    return null
  }
  return reason.trim()
}

// --------------------------------------------------------------------
// حذف محتوا توسط مدیران (پست، کامنت پست، پیام چت)
// توجه: کاربر عادی فقط محتوای خودش را می‌تواند حذف کند (با RLS قبلی)
// --------------------------------------------------------------------
export async function deletePostAsStaff(postId) {
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  if (error) throw error
}

// حذف پستِ کاربر دیگه توسط مدیر — با دلیل اجباری + لاگ
export async function moderatedDeletePost(me, post, reason) {
  await deletePostAsStaff(post.id)
  await logModAction(me, {
    action: 'delete_post', targetType: 'post', targetId: post.id,
    targetUserId: post.author_id, reason,
    snapshot: (post.caption || '').slice(0, 120) || t('(بدون کپشن)', '(no caption)')
  })
}

export async function deleteCommentAsStaff(commentId) {
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId)
  if (error) throw error
}

// حذف کامنتِ کاربر دیگه توسط مدیر — با دلیل اجباری + لاگ
export async function moderatedDeleteComment(me, comment, reason) {
  await deleteCommentAsStaff(comment.id)
  await logModAction(me, {
    action: 'delete_comment', targetType: 'comment', targetId: comment.id,
    targetUserId: comment.author_id, reason,
    snapshot: (comment.content || '').slice(0, 120)
  })
}

export async function softDeleteMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .update({ is_deleted: true, content: null, attachment_url: null })
    .eq('id', messageId)
  if (error) throw error
}

// حذف پیامِ کاربر دیگه توسط مدیر — با دلیل اجباری + لاگ
export async function moderatedDeleteMessage(me, messageId, authorId, snapshot, reason) {
  await softDeleteMessage(messageId)
  await logModAction(me, {
    action: 'delete_message', targetType: 'message', targetId: messageId,
    targetUserId: authorId, reason,
    snapshot: (snapshot || '').slice(0, 120)
  })
}

// --------------------------------------------------------------------
// مودال انتخاب نوع و مدت محدودیت — یک مودال ساده با خودِ سایت هماهنگ
// onDone بعد از ثبت موفق صدا زده می‌شود (مثلاً برای reload صفحه)
// --------------------------------------------------------------------
export function openSanctionModal(me, targetUser, onDone) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="glass modal">
      <div class="row between" style="margin-bottom:15px;">
        <h3>${icon('scale-balanced')} ${t(`محدود کردن ${targetUser.nickname}`, `Restrict ${targetUser.nickname}`)}</h3>
        <button class="danger" id="sm-close" style="padding:4px 8px;">${icon('xmark')}</button>
      </div>
      <div class="stack">
        <label class="text-dim">${t('نوع محدودیت', 'Restriction type')}</label>
        <select id="sm-type">
          <option value="timeout">${t('تایم‌اوت (موقت، غیرفعال شدن ارسال محتوا)', 'Timeout (temporary block from posting)')}</option>
          <option value="mute">${t('میوت (قطع ارسال محتوا تا رفع دستی)', 'Mute (no posting until lifted)')}</option>
          <option value="ban">${t('بن (مسدود شدن کامل حساب)', 'Ban (full account block)')}</option>
        </select>

        <label class="text-dim">${t('مدت زمان', 'Duration')}</label>
        <select id="sm-duration">
          <option value="10">${t('۱۰ دقیقه', '10 minutes')}</option>
          <option value="60" selected>${t('۱ ساعت', '1 hour')}</option>
          <option value="1440">${t('۱ روز', '1 day')}</option>
          <option value="10080">${t('۱ هفته', '1 week')}</option>
          <option value="">${t('دائم (تا رفع دستی)', 'Permanent (until lifted)')}</option>
        </select>

        <label class="text-dim">${t('دلیل (اجباری)', 'Reason (required)')}</label>
        <input id="sm-reason" placeholder="${t('مثلاً: اسپم در چت گروه', 'e.g. spam in group chat')}" />

        <button class="danger" id="sm-apply">${t('اعمال محدودیت', 'Apply restriction')}</button>
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
      // دلیل اجباریه (الزام کاربر: حذف و بن باید دلیل داشته باشه)
      if (!reason) {
        toast(t('نوشتن دلیل اجباریه', 'A reason is required'), { error: true })
        btn.disabled = false
        return
      }
      await applySanction(me, { userId: targetUser.id, type, minutes, reason })
      await logModAction(me, {
        action: type, targetType: 'user', targetId: targetUser.id,
        targetUserId: targetUser.id, reason,
        snapshot: minutes ? t(`${minutes} دقیقه`, `${minutes} minutes`) : t('دائم', 'permanent')
      })
      toast(t(`محدودیت ${type} روی ${targetUser.nickname} اعمال شد`, `Restriction ${type} applied to ${targetUser.nickname}`))
      wrap.remove()
      onDone?.()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })
}
