import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast, icon } from '../lib/utils.js'

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

    let pendingRequests = []
    if (isGroupAdmin || isPlatformStaff) {
      const { data } = await supabase
        .from('group_join_requests')
        .select('*, author:users!group_join_requests_user_id_fkey(nickname, avatar_url, neon_color)')
        .eq('group_id', groupId).eq('status', 'pending')
      pendingRequests = data || []
    }

    const html = `
      <a href="#/groups">&#8594; بازگشت به گروه‌ها</a>
      <h2 style="margin-top:10px;">${escapeHtml(group.name)}</h2>
      <p class="text-dim">${escapeHtml(group.description || '')}</p>

      ${pendingRequests.length ? `
        <div class="glass card">
          <h3>درخواست‌های عضویت</h3>
          ${pendingRequests.map(r => `
            <div class="row between" style="margin-bottom:8px;">
              <div class="row">
                <img class="avatar sm ${neonClass(r.author?.neon_color)}" src="${escapeHtml(r.author?.avatar_url || defaultAvatar(r.author?.nickname))}">
                ${escapeHtml(r.author?.nickname)}
              </div>
              <div class="row">
                <button class="approve-btn" data-req="${r.id}">تأیید</button>
                <button class="reject-btn danger" data-req="${r.id}">رد</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="glass card">
        <h3>اعضا (${members?.length || 0})</h3>
        <div class="row" style="flex-wrap:wrap;">
          ${(members || []).map(m => `
            <div class="row" style="margin-left:14px;">
              <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
              <span>${escapeHtml(m.member?.nickname)}</span>
              <span class="presence-dot ${m.member?.is_online ? 'online' : ''}"></span>
              ${m.role === 'group_admin' ? '<span class="badge mod">مدیر</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>

      ${(myMembership || isGroupAdmin || isPlatformStaff) ? chatMarkup() : `
        <div class="glass card text-dim" style="text-align:center; padding:24px;">
          ${icon('eye-slash')} فقط اعضای گروه می‌تونن چت رو ببینن و پیام بفرستن.
        </div>
      `}
    `

    return {
      html,
      mount: async (app) => {
        app.querySelectorAll('.approve-btn').forEach(btn => btn.addEventListener('click', () => reviewRequest(app, btn.dataset.req, true)))
        app.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', () => reviewRequest(app, btn.dataset.req, false)))
        if (myMembership || isGroupAdmin || isPlatformStaff) {
          await mountChat(app, { targetType: 'group', targetId: groupId, me: profile })
        }
      }
    }
  })
}

async function reviewRequest(app, requestId, approve) {
  try {
    const { error } = await supabase.rpc('review_group_join_request', { p_request_id: requestId, p_approve: approve })
    if (error) throw error
    toast(approve ? 'کاربر پذیرفته شد' : 'درخواست رد شد')
    window.location.reload()
  } catch (err) {
    toast(err.message, { error: true })
  }
}
