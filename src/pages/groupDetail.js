import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast, icon } from '../lib/utils.js'
import { isStaff } from '../lib/moderation.js'

export default async function groupDetailPage([groupId]) {
  return withShell('groups', async (profile) => {
    const { data: group, error } = await supabase.from('groups').select('*').eq('id', groupId).single()
    if (error) throw new Error('این گروه پیدا نشد یا بهش دسترسی نداری')

    const { data: members } = await supabase
      .from('group_members')
      .select('user_id, role, member:users!group_members_user_id_fkey(nickname, avatar_url, neon_color, is_online)')
      .eq('group_id', groupId)

    const myMembership = members?.find(m => m.user_id === profile.id)
    const isGroupAdmin = myMembership?.role === 'group_admin' || group.created_by === profile.id
    const isPlatformStaff = profile.role === 'admin' || profile.role === 'moderator'
    const canManage = isGroupAdmin || isPlatformStaff
    const isPrivate = group.is_public === false
    const isCreator = group.created_by === profile.id

    // درخواست‌های در انتظار — فقط مدیر گروه/مدیر پلتفرم می‌بینه
    let pendingRequests = []
    if (canManage) {
      const { data } = await supabase
        .from('group_join_requests')
        .select('*, author:users!group_join_requests_user_id_fkey(nickname, avatar_url, neon_color)')
        .eq('group_id', groupId).eq('status', 'pending')
      pendingRequests = data || []
    }

    // اگر عضو نیستم، وضعیت درخواستم رو چک کن (دکمه «در انتظار تأیید»)
    let myPendingRequest = null
    if (!myMembership) {
      const { data } = await supabase
        .from('group_join_requests')
        .select('id').eq('group_id', groupId).eq('user_id', profile.id).eq('status', 'pending')
      myPendingRequest = data?.[0] || null
    }

    const html = `
      <a href="#/groups">&#8594; بازگشت به گروه‌ها</a>
      <div class="row" style="margin-top:10px; flex-wrap:wrap;">
        <h2 style="margin:0;">${escapeHtml(group.name)}</h2>
        ${isPrivate
          ? `<span class="privacy-badge private">${icon('lock')} خصوصی</span>`
          : `<span class="privacy-badge">${icon('globe')} عمومی</span>`}
      </div>
      <p class="text-dim">${escapeHtml(group.description || '')}</p>

      <div class="header-actions">
        ${canManage ? `<button id="group-settings-btn">${icon('gear')} تنظیمات گروه</button>` : ''}
        ${myMembership ? `<button id="invite-friends-btn">${icon('user-plus')} دعوت از فالوورها</button>` : ''}
        ${myMembership && !isCreator ? `<button id="leave-group-btn" class="danger">${icon('right-from-bracket')} ترک گروه</button>` : ''}
      </div>

      ${pendingRequests.length ? `
        <div class="glass card">
          <h3>${icon('inbox')} درخواست‌های عضویت (${pendingRequests.length})</h3>
          ${pendingRequests.map(r => `
            <div class="row between" style="margin-bottom:8px;">
              <div class="row">
                <img class="avatar sm ${neonClass(r.author?.neon_color)}" src="${escapeHtml(r.author?.avatar_url || defaultAvatar(r.author?.nickname))}">
                ${escapeHtml(r.author?.nickname)}
              </div>
              <div class="row">
                <button class="approve-btn" data-req="${r.id}">${icon('check')} تأیید</button>
                <button class="reject-btn danger" data-req="${r.id}">${icon('xmark')} رد</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="glass card">
        <h3>اعضا (${members?.length || 0})</h3>
        <div class="row" style="flex-wrap:wrap;">
          ${(members || []).map(m => `
            <a href="#/profile/${m.user_id}" class="row" style="margin-left:14px; color:inherit;">
              <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
              <span>${escapeHtml(m.member?.nickname)}</span>
              <span class="presence-dot ${m.member?.is_online ? 'online' : ''}"></span>
              ${m.role === 'group_admin' ? '<span class="badge mod">مدیر</span>' : ''}
            </a>
          `).join('')}
        </div>
      </div>

      ${(myMembership || isCreator || isPlatformStaff) ? chatMarkup() : `
        <div class="glass card" style="text-align:center; padding:30px;">
          ${isPrivate
            ? (myPendingRequest
                ? `<p class="text-dim">${icon('clock')} درخواستت ثبت شده — منتظر تأیید مدیر گروه باش.</p>`
                : `<p class="text-dim" style="margin-bottom:12px;">${icon('lock')} این گروه خصوصیه؛ برای عضویت باید مدیر تأیید کنه.</p>
                   <button class="primary" id="request-join-inline-btn">${icon('paper-plane')} درخواست عضویت</button>`)
            : `<p class="text-dim" style="margin-bottom:12px;">برای دیدن و فرستادن پیام، اول به گروه بپیوند.</p>
               <button class="primary" id="join-group-inline-btn">پیوستن به گروه</button>`}
        </div>
      `}

      ${canManage ? `
        <!-- مودال تنظیمات گروه (پاپ‌آپ) — سازنده یا مدیر پلتفرم -->
        <div class="modal-backdrop" id="group-settings-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('gear')} تنظیمات گروه</h3>
              <button class="danger" id="close-group-settings" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="group-settings-form" class="stack">
              <label class="text-dim">اسم گروه</label>
              <input name="name" value="${escapeHtml(group.name)}" required maxlength="60" />

              <label class="text-dim">توضیح</label>
              <textarea name="description" rows="2">${escapeHtml(group.description || '')}</textarea>

              <label class="text-dim">نوع گروه</label>
              <select name="is_public">
                <option value="public" ${!isPrivate ? 'selected' : ''}>عمومی — هرکس مستقیم عضو می‌شه</option>
                <option value="private" ${isPrivate ? 'selected' : ''}>خصوصی — عضویت با تأیید مدیر</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ذخیره تغییرات</button>
            </form>
            <div class="danger-zone">
              <button class="danger" id="delete-group-btn" style="width:100%;">${icon('trash-can')} حذف کامل گروه (برگشت‌ناپذیر)</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${myMembership ? `
        <!-- مودال دعوت از فالوورها (به سبک استیم) -->
        <div class="modal-backdrop" id="invite-friends-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('user-plus')} دعوت به «${escapeHtml(group.name)}»</h3>
              <button class="danger" id="close-invite-friends" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <div id="invite-friends-list" class="stack" style="gap:4px;">
              <div class="text-dim" style="text-align:center;">در حال بارگذاری فالوورها...</div>
            </div>
          </div>
        </div>
      ` : ''}
    `

    return {
      html,
      mount: async (app) => {
        // تأیید/رد درخواست‌های عضویت
        app.querySelectorAll('.approve-btn').forEach(btn => btn.addEventListener('click', () => reviewRequest(btn.dataset.req, true)))
        app.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', () => reviewRequest(btn.dataset.req, false)))

        // چت (فقط اعضا/سازنده/مدیر پلتفرم)
        if (myMembership || isCreator || isPlatformStaff) {
          await mountChat(app, { targetType: 'group', targetId: groupId, me: profile })
        }

        // عضویت فوری (گروه عمومی)
        app.querySelector('#join-group-inline-btn')?.addEventListener('click', async (e) => {
          e.target.disabled = true
          try {
            const { error: joinErr } = await supabase.from('group_members').insert({ group_id: groupId, user_id: profile.id })
            if (joinErr) throw joinErr
            toast('به گروه پیوستی')
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // درخواست عضویت (گروه خصوصی)
        app.querySelector('#request-join-inline-btn')?.addEventListener('click', async (e) => {
          e.target.disabled = true
          try {
            const { error: reqErr } = await supabase.from('group_join_requests').insert({
              group_id: groupId, user_id: profile.id, status: 'pending'
            })
            if (reqErr) throw reqErr
            toast('درخواستت برای مدیر گروه فرستاده شد')
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // ترک گروه
        app.querySelector('#leave-group-btn')?.addEventListener('click', async (e) => {
          if (!confirm('از گروه خارج می‌شی؟')) return
          e.target.disabled = true
          try {
            const { error: leaveErr } = await supabase.from('group_members').delete()
              .match({ group_id: groupId, user_id: profile.id })
            if (leaveErr) throw leaveErr
            window.location.hash = '/groups'
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // ── مودال تنظیمات گروه ──
        const settingsModal = app.querySelector('#group-settings-modal')
        app.querySelector('#group-settings-btn')?.addEventListener('click', () => { settingsModal.style.display = 'flex' })
        app.querySelector('#close-group-settings')?.addEventListener('click', () => { settingsModal.style.display = 'none' })
        settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none' })

        app.querySelector('#group-settings-form')?.addEventListener('submit', async (e) => {
          e.preventDefault()
          const form = e.target
          const fd = new FormData(form)
          const btn = form.querySelector('button[type="submit"]')
          btn.disabled = true
          try {
            const { error: updErr } = await supabase.from('groups').update({
              name: fd.get('name').trim(),
              description: fd.get('description')?.trim() || null,
              is_public: fd.get('is_public') === 'public'
            }).eq('id', groupId)
            if (updErr) throw updErr
            toast('تنظیمات گروه ذخیره شد')
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            btn.disabled = false
          }
        })

        // حذف کامل گروه (دوتا تأیید برای اطمینان)
        app.querySelector('#delete-group-btn')?.addEventListener('click', async (e) => {
          if (!confirm('گروه با همه‌ی پیام‌ها و اعضاش برای همیشه حذف بشه؟')) return
          if (!confirm('واقعاً مطمئنی؟ این کار برگشت‌ناپذیره!')) return
          e.target.disabled = true
          try {
            const { error: delErr } = await supabase.rpc('delete_group', { p_group_id: groupId })
            if (delErr) throw delErr
            toast('گروه حذف شد')
            window.location.hash = '/groups'
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // ── مودال دعوت از فالوورها ──
        const inviteModal = app.querySelector('#invite-friends-modal')
        const inviteList = app.querySelector('#invite-friends-list')

        async function loadInvitableFollowers() {
          try {
            const { data: follows, error: fErr } = await supabase
              .from('follows')
              .select('follower_id, follower:users!follows_follower_id_fkey(nickname, avatar_url, neon_color)')
              .eq('following_id', profile.id)
              .eq('status', 'accepted')
            if (fErr) throw fErr
            const memberIds = new Set((members || []).map(m => m.user_id))
            // فقط فالوورهایی که عضو گروه نیستن قابل دعوت‌ان
            const rows = (follows || []).filter(f => !memberIds.has(f.follower_id))
            if (!rows.length) {
              inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">همه‌ی فالوورهات عضو گروهن (یا هنوز فالووری نداری).</div>`
              return
            }
            inviteList.innerHTML = rows.map(f => `
              <div class="invite-user-row">
                <div class="row">
                  <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                  <b>${escapeHtml(f.follower?.nickname || '')}</b>
                </div>
                <button class="send-group-invite-btn primary" data-user-id="${f.follower_id}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} دعوت</button>
              </div>
            `).join('')
            inviteList.querySelectorAll('.send-group-invite-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                btn.disabled = true
                try {
                  const { error: invErr } = await supabase.from('notifications').insert({
                    user_id: btn.dataset.userId,
                    sender_id: profile.id,
                    type: 'group_invite',
                    target_id: groupId,
                    message: `${profile.nickname} تورو به گروه «${group.name}» دعوت کرد`
                  })
                  if (invErr) throw invErr
                  btn.innerHTML = `${icon('check')} دعوت شد`
                } catch (err) {
                  toast(err.message, { error: true })
                  btn.disabled = false
                }
              })
            })
          } catch (err) {
            inviteList.innerHTML = `<div class="text-dim" style="text-align:center;">${escapeHtml(err.message)}</div>`
          }
        }

        app.querySelector('#invite-friends-btn')?.addEventListener('click', () => {
          inviteModal.style.display = 'flex'
          loadInvitableFollowers()
        })
        app.querySelector('#close-invite-friends')?.addEventListener('click', () => { inviteModal.style.display = 'none' })
        inviteModal?.addEventListener('click', (e) => { if (e.target === inviteModal) inviteModal.style.display = 'none' })
      }
    }
  })
}

async function reviewRequest(requestId, approve) {
  try {
    const { error } = await supabase.rpc('review_group_join_request', { p_request_id: requestId, p_approve: approve })
    if (error) throw error
    toast(approve ? 'کاربر پذیرفته شد' : 'درخواست رد شد')
    window.location.reload()
  } catch (err) {
    toast(err.message, { error: true })
  }
}
