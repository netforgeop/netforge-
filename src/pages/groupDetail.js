import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast, icon, isOnlineNow } from '../lib/utils.js'
import { isStaff, askModReason, logModAction } from '../lib/moderation.js'
import { t } from '../lib/i18n.js'
import { inviteAcceptCard } from '../lib/inviteAccept.js'

export default async function groupDetailPage([groupId]) {
  return withShell('groups', async (profile) => {
    const { data: group, error } = await supabase.from('groups').select('*').eq('id', groupId).single()
    if (error) {
      // شاید گروه خصوصیه و کاربر دعوت‌شده است — اعلان دعوتش رو چک کن و کارت دعوت نشون بده (نه ارور!)
      const { data: inv } = await supabase
        .from('notifications')
        .select('id, message')
        .eq('user_id', profile.id)
        .eq('type', 'group_invite')
        .eq('target_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!inv) throw new Error(t('این گروه پیدا نشد یا بهش دسترسی نداری', 'This group was not found or is not accessible.'))
      return inviteAcceptCard({
        iconName: 'users',
        title: t('به یه گروه خصوصی دعوت شدی!', "You're invited to a private group!"),
        message: inv.message,
        notifId: inv.id,
        rpcName: 'accept_group_invite',
        rpcParam: { p_group_id: groupId },
        backHash: '#/groups'
      })
    }

    const { data: members } = await supabase
      .from('group_members')
      .select('user_id, role, custom_tag, member:users!group_members_user_id_fkey(nickname, avatar_url, neon_color, is_online, last_seen_at)')
      .eq('group_id', groupId)

    const myMembership = members?.find(m => m.user_id === profile.id)
    const isGroupAdmin = myMembership?.role === 'group_admin' || group.created_by === profile.id
    const isPlatformStaff = profile.role === 'admin' || profile.role === 'moderator'
    const canManage = isGroupAdmin || isPlatformStaff
    const isPrivate = group.is_public === false
    const isCreator = group.created_by === profile.id
    // دادن/گرفتن نقش: فقط سازنده یا مدیر پلتفرم
    const canSetRoles = isCreator || profile.role === 'admin'
    // تگ‌گذاری روی اعضا: سازنده/مدیر گروه/ناظم یا ادمین پلتفرم
    const canTag = isGroupAdmin || isPlatformStaff

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
      <a href="#/groups">${t('→ بازگشت به گروه‌ها', '← Back to groups')}</a>
      <div class="row" style="margin-top:10px; flex-wrap:wrap;">
        <h2 style="margin:0;">${escapeHtml(group.name)}</h2>
        ${isPrivate
          ? `<span class="privacy-badge private">${icon('lock')} ${t('خصوصی', 'Private')}</span>`
          : `<span class="privacy-badge">${icon('globe')} ${t('عمومی', 'Public')}</span>`}
      </div>
      <p class="text-dim">${escapeHtml(group.description || '')}</p>

      <div class="header-actions">
        ${canManage ? `<button id="group-settings-btn">${icon('gear')} ${t('تنظیمات گروه', 'Group settings')}</button>` : ''}
        ${myMembership ? `<button id="invite-friends-btn">${icon('user-plus')} ${t('دعوت از فالوورها', 'Invite followers')}</button>` : ''}
        ${myMembership && !isCreator ? `<button id="leave-group-btn" class="danger">${icon('right-from-bracket')} ${t('ترک گروه', 'Leave group')}</button>` : ''}
      </div>

      ${pendingRequests.length ? `
        <div class="glass card">
          <h3>${icon('inbox')} ${t('درخواست‌های عضویت', 'Join requests')} (${pendingRequests.length})</h3>
          ${pendingRequests.map(r => `
            <div class="row between" style="margin-bottom:8px;">
              <div class="row">
                <img class="avatar sm ${neonClass(r.author?.neon_color)}" src="${escapeHtml(r.author?.avatar_url || defaultAvatar(r.author?.nickname))}">
                ${escapeHtml(r.author?.nickname)}
              </div>
              <div class="row">
                <button class="approve-btn" data-req="${r.id}">${icon('check')} ${t('تأیید', 'Approve')}</button>
                <button class="reject-btn danger" data-req="${r.id}">${icon('xmark')} ${t('رد', 'Reject')}</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="glass card">
        <h3>${t('اعضا', 'Members')} (${members?.length || 0})</h3>
        <div class="stack" style="gap:8px;">
          ${(members || []).map(m => {
            const isTargetCreator = m.user_id === group.created_by
            const memberRole = isTargetCreator ? 'creator' : (m.role === 'group_admin' ? 'group_admin' : 'member')
            // کیک: سازنده هیچ‌وقت کیک نمی‌شه؛ خودم هم نه (برای خروج دکمه ترک هست)
            const showKick = canManage && !isTargetCreator && m.user_id !== profile.id
            const showRoleBtn = canSetRoles && !isTargetCreator
            return `
              <div class="row between" style="flex-wrap:wrap;">
                <a href="#/profile/${m.user_id}" class="row" style="color:inherit;">
                  <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
                  <span>${escapeHtml(m.member?.nickname)}</span>
                  <span class="presence-dot ${isOnlineNow(m.member) ? 'online' : ''}"></span>
                  ${memberRole === 'creator' ? `<span class="badge admin">${icon('crown')} ${t('سازنده', 'Creator')}</span>`
                    : memberRole === 'group_admin' ? `<span class="badge mod">${t('مدیر', 'Admin')}</span>` : ''}
                  ${m.custom_tag ? `<span class="tag-badge">${icon('tag')} ${escapeHtml(m.custom_tag)}</span>` : ''}
                </a>
                ${(showKick || showRoleBtn || canTag) ? `
                  <div class="row" style="gap:6px; flex-wrap:wrap;">
                    ${canTag ? `<button class="tag-member-btn" data-user="${m.user_id}" data-nick="${escapeHtml(m.member?.nickname || '')}" data-current="${escapeHtml(m.custom_tag || '')}" style="padding:3px 10px; font-size:11px;" title="${t('تگ کاستوم برای این عضو', 'Custom tag for this member')}">${icon('tag')} ${t('تگ', 'Tag')}</button>` : ''}
                    ${showRoleBtn ? (m.role === 'group_admin'
                      ? `<button class="demote-group-admin-btn" data-user="${m.user_id}" style="padding:3px 10px; font-size:11px;">${icon('arrow-down')} ${t('عزل از مدیریت', 'Remove admin')}</button>`
                      : `<button class="promote-group-admin-btn" data-user="${m.user_id}" style="padding:3px 10px; font-size:11px;">${icon('arrow-up')} ${t('مدیر گروه کن', 'Make admin')}</button>`) : ''}
                    ${showKick ? `<button class="kick-member-btn danger" data-user="${m.user_id}" data-nick="${escapeHtml(m.member?.nickname || '')}" style="padding:3px 10px; font-size:11px;" title="${t('کیک از گروه', 'Kick from group')}">${icon('user-xmark')} ${t('کیک', 'Kick')}</button>` : ''}
                  </div>
                ` : ''}
              </div>
            `
          }).join('')}
        </div>
      </div>

      ${(myMembership || isCreator || isPlatformStaff) ? chatMarkup() : `
        <div class="glass card" style="text-align:center; padding:30px;">
          ${isPrivate
            ? (myPendingRequest
                ? `<p class="text-dim">${icon('clock')} ${t('درخواستت ثبت شده — منتظر تأیید مدیر گروه باش.', 'Your request is pending — wait for the group admin.')}</p>`
                : `<p class="text-dim" style="margin-bottom:12px;">${icon('lock')} ${t('این گروه خصوصیه؛ برای عضویت باید مدیر تأیید کنه.', 'This group is private; the admin must approve your join.')}</p>
                   <button class="primary" id="request-join-inline-btn">${icon('paper-plane')} ${t('درخواست عضویت', 'Request to join')}</button>`)
            : `<p class="text-dim" style="margin-bottom:12px;">${t('برای دیدن و فرستادن پیام، اول به گروه بپیوند.', 'Join the group to see and send messages.')}</p>
               <button class="primary" id="join-group-inline-btn">${t('پیوستن به گروه', 'Join group')}</button>`}
        </div>
      `}

      ${canManage ? `
        <!-- مودال تنظیمات گروه (پاپ‌آپ) — سازنده یا مدیر پلتفرم -->
        <div class="modal-backdrop" id="group-settings-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('gear')} ${t('تنظیمات گروه', 'Group settings')}</h3>
              <button class="danger" id="close-group-settings" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="group-settings-form" class="stack">
              <label class="text-dim">${t('اسم گروه', 'Group name')}</label>
              <input name="name" value="${escapeHtml(group.name)}" required maxlength="60" />

              <label class="text-dim">${t('توضیح', 'Description')}</label>
              <textarea name="description" rows="2">${escapeHtml(group.description || '')}</textarea>

              <label class="text-dim">${t('نوع گروه', 'Group type')}</label>
              <select name="is_public">
                <option value="public" ${!isPrivate ? 'selected' : ''}>${t('عمومی — هرکس مستقیم عضو می‌شه', 'Public — anyone joins instantly')}</option>
                <option value="private" ${isPrivate ? 'selected' : ''}>${t('خصوصی — عضویت با تأیید مدیر', 'Private — join needs approval')}</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ${t('ذخیره تغییرات', 'Save changes')}</button>
            </form>
            <div class="danger-zone">
              <button class="danger" id="delete-group-btn" style="width:100%;">${icon('trash-can')} ${t('حذف کامل گروه (برگشت‌ناپذیر)', 'Delete group permanently')}</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${myMembership ? `
        <!-- مودال دعوت از فالوورها (به سبک استیم) -->
        <div class="modal-backdrop" id="invite-friends-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('user-plus')} ${t(`دعوت به «${group.name}»`, `Invite to "${group.name}"`)}</h3>
              <button class="danger" id="close-invite-friends" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <div id="invite-friends-list" class="stack" style="gap:4px;">
              <div class="text-dim" style="text-align:center;">${t('در حال بارگذاری فالوورها...', 'Loading followers...')}</div>
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
            toast(t('به گروه پیوستی', 'You joined the group'))
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
            toast(t('درخواستت برای مدیر گروه فرستاده شد', 'Request sent to the group admin'))
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // ترک گروه
        app.querySelector('#leave-group-btn')?.addEventListener('click', async (e) => {
          if (!confirm(t('از گروه خارج می‌شی؟', 'Leave this group?'))) return
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

        // ── کیک عضو (RPC امن) ──
        app.querySelectorAll('.kick-member-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm(t(`${btn.dataset.nick} از گروه کیک بشه؟`, `Kick ${btn.dataset.nick} from the group?`))) return
            btn.disabled = true
            try {
              const { error: kickErr } = await supabase.rpc('kick_group_member', { p_group_id: groupId, p_user_id: btn.dataset.user })
              if (kickErr) throw kickErr
              toast(t('کاربر کیک شد', 'Member kicked'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              btn.disabled = false
            }
          })
        })

        // ── تگ کاستوم برای اعضا (RPC توی netforge_v7.sql) ──
        app.querySelectorAll('.tag-member-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const tag = prompt(
              t(`تگ «${btn.dataset.nick}» رو بنویس (خالی = حذف تگ، حداکثر ۲۴ کاراکتر):`,
                `Tag for "${btn.dataset.nick}" (empty = remove tag, max 24 chars):`),
              btn.dataset.current || ''
            )
            if (tag === null) return
            btn.disabled = true
            try {
              const { error } = await supabase.rpc('set_group_member_tag', {
                p_group_id: groupId, p_user_id: btn.dataset.user, p_tag: tag.trim()
              })
              if (error) throw error
              toast(tag.trim() ? t('تگ ذخیره شد', 'Tag saved') : t('تگ حذف شد', 'Tag removed'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              btn.disabled = false
            }
          })
        })

        // ── دادن/گرفتن نقش مدیر گروه ──
        app.querySelectorAll('.promote-group-admin-btn, .demote-group-admin-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const promote = btn.classList.contains('promote-group-admin-btn')
            btn.disabled = true
            try {
              const { error: roleErr } = await supabase.rpc('set_group_member_role', {
                p_group_id: groupId,
                p_user_id: btn.dataset.user,
                p_role: promote ? 'group_admin' : 'member'
              })
              if (roleErr) throw roleErr
              toast(promote ? t('مدیر گروه شد', 'Made group admin') : t('مدیریتش گرفته شد', 'Admin role removed'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              btn.disabled = false
            }
          })
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
            toast(t('تنظیمات گروه ذخیره شد', 'Group settings saved'))
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            btn.disabled = false
          }
        })

        // حذف کامل گروه (دوتا تأیید برای اطمینان)
        app.querySelector('#delete-group-btn')?.addEventListener('click', async (e) => {
          // اگر مدیرِ پلتفرم روی گروه کس دیگه‌ست → اول دلیل اجباری (بعد توی لاگ می‌ره)
          let staffReason = null
          if (group.created_by !== profile.id) {
            staffReason = askModReason(t('حذف این گروه', 'deleting this group'))
            if (!staffReason) return
          }
          if (!confirm(t('گروه با همه‌ی پیام‌ها و اعضاش برای همیشه حذف بشه؟', 'Delete the group with all messages and members forever?'))) return
          if (!confirm(t('واقعاً مطمئنی؟ این کار برگشت‌ناپذیره!', 'Are you sure? This cannot be undone!'))) return
          e.target.disabled = true
          try {
            const { error: delErr } = await supabase.rpc('delete_group', { p_group_id: groupId })
            if (delErr) throw delErr
            if (staffReason) {
              await logModAction(profile, {
                action: 'delete_group', targetType: 'group', targetId: groupId,
                targetUserId: group.created_by, reason: staffReason,
                snapshot: `${t('گروه', 'Group')}: ${group.name}`
              })
            }
            toast(t('گروه حذف شد', 'Group deleted'))
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
              inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">${t('همه‌ی فالوورهات عضو گروهن (یا هنوز فالووری نداری).', 'All your followers are already in (or you have none yet).')}</div>`
              return
            }
            inviteList.innerHTML = rows.map(f => `
              <div class="invite-user-row">
                <div class="row">
                  <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                  <b>${escapeHtml(f.follower?.nickname || '')}</b>
                </div>
                <button class="send-group-invite-btn primary" data-user-id="${f.follower_id}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} ${t('دعوت', 'Invite')}</button>
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
                    message: t(`${profile.nickname} تورو به گروه «${group.name}» دعوت کرد`, `${profile.nickname} invited you to the group "${group.name}"`)
                  })
                  if (invErr) throw invErr
                  btn.innerHTML = `${icon('check')} ${t('دعوت شد', 'Invited')}`
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
    toast(approve ? t('کاربر پذیرفته شد', 'Member approved') : t('درخواست رد شد', 'Request rejected'))
    window.location.reload()
  } catch (err) {
    toast(err.message, { error: true })
  }
}
