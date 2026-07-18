import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'
import { liftSanction } from '../lib/moderation.js'

export default async function adminPage() {
  return withShell('admin', async (profile) => {
    if (profile.role !== 'admin') {
      return { html: `<div class="empty-state">این بخش فقط برای ادمین قابل مشاهده‌ست.</div>` }
    }

    const [
      { data: codes },
      { data: requests },
      { data: reports },
      { data: users },
      { data: sanctions }
    ] = await Promise.all([
      supabase.from('invite_codes').select('*').order('created_at', { ascending: false }),
      supabase.from('invite_requests').select('*, requester:users!invite_requests_requested_by_fkey(nickname)').eq('status', 'pending').order('requested_at'),
      supabase.from('reports').select('*, reporter:users!reports_reporter_id_fkey(nickname)').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('users').select('id, nickname, role, created_at').order('created_at'),
      supabase.from('user_sanctions').select('*, target:users!user_sanctions_user_id_fkey(nickname)').eq('is_active', true).order('created_at', { ascending: false })
    ])

    const html = `
      <h2>پنل ادمین</h2>

      <div class="glass card">
        <h3>ساخت کد دعوت</h3>
        <form id="new-code-form" class="row">
          <input name="code" placeholder="کد (مثلاً REZA-2026)" required style="flex:1;" />
          <input name="max_uses" type="number" min="1" value="1" style="width:90px;" />
          <button class="primary" type="submit">بساز</button>
        </form>
      </div>

      <div class="glass card">
        <h3>کدهای دعوت</h3>
        ${codes?.length ? codes.map(c => `
          <div class="row between" style="margin-bottom:6px;">
            <span>${escapeHtml(c.code)} <span class="text-dim">(${c.used_count}/${c.max_uses})</span> ${c.is_active ? '' : '<span class="badge">غیرفعال</span>'}</span>
            ${c.is_active ? `<button class="deactivate-code-btn" data-id="${c.id}">غیرفعال کن</button>` : ''}
          </div>
        `).join('') : '<p class="text-dim">هنوز کدی ساخته نشده.</p>'}
      </div>

      <div class="glass card">
        <h3>درخواست‌های دعوت در انتظار</h3>
        ${requests?.length ? requests.map(r => `
          <div class="row between" style="margin-bottom:6px;">
            <span>${escapeHtml(r.requester?.nickname)}</span>
            <div class="row">
              <button class="approve-invite-req-btn" data-id="${r.id}" data-user="${escapeHtml(r.requester?.nickname)}">تأیید و ساخت کد</button>
              <button class="reject-invite-req-btn danger" data-id="${r.id}">رد</button>
            </div>
          </div>
        `).join('') : '<p class="text-dim">درخواستی در انتظار نیست.</p>'}
      </div>

      <div class="glass card">
        <h3>گزارش‌های در انتظار بررسی</h3>
        ${reports?.length ? reports.map(r => `
          <div style="margin-bottom:10px;border-bottom:1px solid var(--glass-border);padding-bottom:8px;">
            <div>گزارش‌دهنده: ${escapeHtml(r.reporter?.nickname)} · نوع: ${r.target_type} · ${timeAgo(r.created_at)}</div>
            ${r.reason ? `<div class="text-dim">دلیل: ${escapeHtml(r.reason)}</div>` : ''}
            <div class="row" style="margin-top:6px;">
              ${r.target_type === 'user' && r.target_id ? `<a href="#/profile/${r.target_id}"><button style="font-size:12px;">پروفایل کاربر</button></a>` : ''}
              <button class="dismiss-report-btn" data-id="${r.id}">بررسی شد</button>
            </div>
          </div>
        `).join('') : '<p class="text-dim">گزارشی در انتظار نیست.</p>'}
      </div>

      <div class="glass card">
        <h3>⛔ محدودیت‌های فعال (Ban/Mute/Timeout)</h3>
        ${sanctions ? (sanctions.length ? sanctions.map(s => `
          <div class="row between" style="margin-bottom:8px; border-bottom:1px solid var(--glass-border); padding-bottom:8px;">
            <span>
              <b>${escapeHtml(s.target?.nickname || 'کاربر')}</b>
              <span class="badge danger-badge">${s.type}</span>
              <span class="text-dim" style="font-size:12px;">
                ${s.expires_at ? `تا ${new Date(s.expires_at).toLocaleString('fa-IR')}` : 'دائم'}
                ${s.reason ? ` · ${escapeHtml(s.reason)}` : ''}
              </span>
            </span>
            <button class="lift-sanction-btn" data-id="${s.id}">رفع محدودیت</button>
          </div>
        `).join('') : '<p class="text-dim">هیچ محدودیت فعالی نیست. 🎉</p>')
        : '<p class="text-dim">⚠️ جدول user_sanctions هنوز ساخته نشده؛ فایل moderation_setup.sql را در Supabase اجرا کنید.</p>'}
        <p class="text-dim" style="font-size:12px; margin-top:10px;">
          برای اعمال محدودیت جدید، به پروفایل کاربر بروید و روی «⚖️ اعمال محدودیت جدید» بزنید.
        </p>
      </div>

      <div class="glass card">
        <h3>کاربران</h3>
        ${(users || []).map(u => `
          <div class="row between" style="margin-bottom:6px;">
            <a href="#/profile/${u.id}" class="row" style="color:inherit;">
              ${escapeHtml(u.nickname)} <span class="badge ${u.role === 'admin' ? 'admin' : u.role === 'moderator' ? 'mod' : ''}">${u.role}</span>
            </a>
            <div class="row">
              ${u.role === 'member' ? `<button class="promote-btn" data-id="${u.id}">ترفیع به Moderator</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `

    return { html, mount: (app) => mountAdmin(app, profile, users || []) }
  })
}

function mountAdmin(app, profile, users) {
  const newCodeForm = app.querySelector('#new-code-form')
  if (newCodeForm) {
    newCodeForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      try {
        const { data: session } = await supabase.auth.getSession()
        const { error } = await supabase.from('invite_codes').insert({
          code: fd.get('code').trim(),
          max_uses: Number(fd.get('max_uses')) || 1,
          created_by: session.session.user.id
        })
        if (error) throw error
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  }

  app.querySelectorAll('.deactivate-code-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('invite_codes').update({ is_active: false }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.approve-invite-req-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const newCode = `${btn.dataset.user.replace(/\s+/g, '').slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        const { data: codeRow, error: codeErr } = await supabase.from('invite_codes').insert({
          code: newCode, max_uses: 1, created_by: session.session.user.id
        }).select().single()
        if (codeErr) throw codeErr
        const { error } = await supabase.from('invite_requests').update({
          status: 'approved', resulting_invite_code_id: codeRow.id, reviewed_by: session.session.user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id)
        if (error) throw error
        toast(`کد ساخته شد: ${newCode}`)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.reject-invite-req-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('invite_requests').update({ status: 'rejected' }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.dismiss-report-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('reports').update({ status: 'reviewed' }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.promote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const { error } = await supabase.rpc('promote_to_moderator', { p_user_id: btn.dataset.id })
        if (error) throw error
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // رفع محدودیت کاربران (Ban/Mute/Timeout)
  app.querySelectorAll('.lift-sanction-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await liftSanction(btn.dataset.id, profile)
        toast('محدودیت رفع شد')
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}
