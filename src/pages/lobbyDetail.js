import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast, icon } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

export default async function lobbyDetailPage([lobbyId]) {
  return withShell('lobbies', async (profile) => {
    const { data: lobby, error } = await supabase.from('game_lobbies').select('*').eq('id', lobbyId).single()
    if (error) throw new Error(t('این لابی پیدا نشد', 'This lobby was not found'))

    const { data: members } = await supabase
      .from('lobby_members')
      .select('user_id, role, member:users!lobby_members_user_id_fkey(nickname, avatar_url, neon_color, is_online)')
      .eq('lobby_id', lobbyId)

    const myMembership = (members || []).find(m => m.user_id === profile.id)
    const isMember = !!myMembership
    const isCoHost = myMembership?.role === 'co_host'
    const isHost = lobby.host_id === profile.id
    const isPlatformStaff = profile.role === 'admin' || profile.role === 'moderator'
    const canManage = isHost || isPlatformStaff // تنظیمات لابی + نقش‌ها
    const canKick = isHost || isPlatformStaff || isCoHost // کیک کردن اعضا
    const isFull = (members?.length || 0) >= lobby.capacity && !isMember
    const status = lobby.status || 'open'

    const html = `
      <a href="#/lobbies">${t('→ بازگشت به لابی‌ها', '← Back to lobbies')}</a>
      <div class="row" style="margin-top:10px; flex-wrap:wrap;">
        <h2 style="margin:0;">${escapeHtml(lobby.game_name)}</h2>
        ${lobby.category ? `<span class="badge">${escapeHtml(lobby.category)}</span>` : ''}
        ${status === 'closed' ? `<span class="privacy-badge private">${icon('lock')} ${t('بسته', 'Closed')}</span>` : ''}
      </div>
      <p class="text-dim">${escapeHtml(lobby.description || '')}</p>

      <div class="header-actions">
        ${canManage ? `<button id="lobby-settings-btn">${icon('gear')} ${t('تنظیمات لابی', 'Lobby settings')}</button>` : ''}
        ${isMember ? `<button id="invite-friends-btn">${icon('user-plus')} ${t('دعوت از فالوورها', 'Invite followers')}</button>` : ''}
        ${isMember && !isHost ? `<button id="leave-lobby-btn" class="danger">${icon('right-from-bracket')} ${t('ترک لابی', 'Leave lobby')}</button>` : ''}
      </div>

      <div class="glass card">
        <h3>${t('بازیکنان', 'Players')} (${members?.length || 0}/${lobby.capacity})</h3>
        <div class="stack" style="gap:8px;">
          ${(members || []).map(m => {
            const isTargetHost = m.user_id === lobby.host_id
            // کیک: میزبان هیچ‌وقت کیک نمی‌شه؛ خودم هم نه (برای خروج دکمه ترک هست)
            const showKick = canKick && !isTargetHost && m.user_id !== profile.id
            const showRoleBtn = canManage && !isTargetHost
            return `
              <div class="row between" style="flex-wrap:wrap;">
                <a href="#/profile/${m.user_id}" class="row" style="color:inherit;">
                  <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
                  <span>${escapeHtml(m.member?.nickname)}</span>
                  ${isTargetHost ? `<span class="badge admin">${icon('crown')} ${t('میزبان', 'Host')}</span>`
                    : m.role === 'co_host' ? `<span class="badge mod">${icon('star')} ${t('کاپیتان', 'Co-host')}</span>` : ''}
                  <span class="presence-dot ${m.member?.is_online ? 'online' : ''}"></span>
                </a>
                ${(showKick || showRoleBtn) ? `
                  <div class="row" style="gap:6px;">
                    ${showRoleBtn ? (m.role === 'co_host'
                      ? `<button class="demote-cohost-btn" data-user="${m.user_id}" style="padding:3px 10px; font-size:11px;">${icon('arrow-down')} ${t('برداشتن کاپیتان', 'Remove co-host')}</button>`
                      : `<button class="promote-cohost-btn" data-user="${m.user_id}" style="padding:3px 10px; font-size:11px;">${icon('arrow-up')} ${t('کاپیتان کن', 'Make co-host')}</button>`) : ''}
                    ${showKick ? `<button class="kick-lobby-member-btn danger" data-user="${m.user_id}" data-nick="${escapeHtml(m.member?.nickname || '')}" style="padding:3px 10px; font-size:11px;" title="${t('کیک از لابی', 'Kick from lobby')}">${icon('user-xmark')} ${t('کیک', 'Kick')}</button>` : ''}
                  </div>
                ` : ''}
              </div>
            `
          }).join('')}
        </div>
      </div>

      ${isMember || isHost ? chatMarkup() : `
        <div class="glass card" style="text-align:center; padding:30px;">
          ${isFull
            ? `<p class="text-dim">${t('ظرفیت این لابی کامل شده است.', 'This lobby is full.')}</p>`
            : status === 'closed'
              ? `<p class="text-dim">${t('این لابی بسته شده.', 'This lobby is closed.')}</p>`
              : `<p class="text-dim" style="margin-bottom:12px;">${t('برای دیدن و فرستادن پیام، اول به لابی بپیوند.', 'Join the lobby to see and send messages.')}</p>
                 <button class="primary" id="join-lobby-inline-btn">${t('پیوستن به لابی', 'Join lobby')}</button>`}
        </div>
      `}

      ${canManage ? `
        <!-- مودال تنظیمات لابی (پاپ‌آپ) — میزبان یا مدیر پلتفرم -->
        <div class="modal-backdrop" id="lobby-settings-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('gear')} ${t('تنظیمات لابی', 'Lobby settings')}</h3>
              <button class="danger" id="close-lobby-settings" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="lobby-settings-form" class="stack">
              <label class="text-dim">${t('اسم بازی', 'Game name')}</label>
              <input name="game_name" value="${escapeHtml(lobby.game_name)}" required />

              <label class="text-dim">${t('دسته‌بندی', 'Category')}</label>
              <input name="category" value="${escapeHtml(lobby.category || '')}" placeholder="${t('مثلاً رقابتی / کژوال', 'e.g. ranked / casual')}" />

              <label class="text-dim">${t('توضیح', 'Description')}</label>
              <textarea name="description" rows="2">${escapeHtml(lobby.description || '')}</textarea>

              <label class="text-dim">${t('ظرفیت', 'Capacity')} (${t('حداقل', 'min')} ${Math.max(members?.length || 1, 2)})</label>
              <input name="capacity" type="number" min="${Math.max(members?.length || 1, 2)}" max="50" value="${lobby.capacity}" />

              <label class="text-dim">${t('وضعیت لابی', 'Lobby status')}</label>
              <select name="status">
                <option value="open" ${status !== 'closed' ? 'selected' : ''}>${t('باز — جوین آزاد', 'Open — anyone can join')}</option>
                <option value="closed" ${status === 'closed' ? 'selected' : ''}>${t('بسته — جوین جدید نمی‌پذیره', 'Closed — no new joins')}</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ${t('ذخیره تغییرات', 'Save changes')}</button>
            </form>
            <div class="danger-zone">
              <button class="danger" id="delete-lobby-btn" style="width:100%;">${icon('trash-can')} ${t('حذف کامل لابی (برگشت‌ناپذیر)', 'Delete lobby permanently')}</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${isMember ? `
        <!-- مودال دعوت از فالوورها (به سبک استیم) -->
        <div class="modal-backdrop" id="invite-friends-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('user-plus')} ${t(`دعوت به لابی «${lobby.game_name}»`, `Invite to "${lobby.game_name}"`)}</h3>
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
        if (isMember || isHost) {
          await mountChat(app, { targetType: 'lobby', targetId: lobbyId, me: profile })
        } else {
          app.querySelector('#join-lobby-inline-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true
            try {
              const { error: joinErr } = await supabase.from('lobby_members').insert({ lobby_id: lobbyId, user_id: profile.id })
              if (joinErr) throw joinErr
              toast(t('به لابی پیوستی', 'You joined the lobby'))
              window.location.reload()
            } catch (err) {
              const msg = String(err.message || '')
              toast(msg.includes('row-level security') ? t('نتوانستی بپیوندی — ظرفیت لابی پر شده یا بسته است', "Couldn't join — lobby is full or closed") : msg, { error: true })
              e.target.disabled = false
            }
          })
        }

        // ترک لابی
        app.querySelector('#leave-lobby-btn')?.addEventListener('click', async (e) => {
          if (!confirm(t('از لابی خارج می‌شی؟', 'Leave this lobby?'))) return
          e.target.disabled = true
          try {
            const { error: leaveErr } = await supabase.from('lobby_members').delete()
              .match({ lobby_id: lobbyId, user_id: profile.id })
            if (leaveErr) throw leaveErr
            window.location.hash = '/lobbies'
          } catch (err) {
            toast(err.message, { error: true })
            e.target.disabled = false
          }
        })

        // ── کیک عضو از لابی (RPC امن) ──
        app.querySelectorAll('.kick-lobby-member-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm(t(`${btn.dataset.nick} از لابی کیک بشه؟`, `Kick ${btn.dataset.nick} from the lobby?`))) return
            btn.disabled = true
            try {
              const { error: kickErr } = await supabase.rpc('kick_lobby_member', { p_lobby_id: lobbyId, p_user_id: btn.dataset.user })
              if (kickErr) throw kickErr
              toast(t('کاربر کیک شد', 'Member kicked'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              btn.disabled = false
            }
          })
        })

        // ── دادن/گرفتن نقش کاپیتان ──
        app.querySelectorAll('.promote-cohost-btn, .demote-cohost-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const promote = btn.classList.contains('promote-cohost-btn')
            btn.disabled = true
            try {
              const { error: roleErr } = await supabase.rpc('set_lobby_member_role', {
                p_lobby_id: lobbyId,
                p_user_id: btn.dataset.user,
                p_role: promote ? 'co_host' : 'member'
              })
              if (roleErr) throw roleErr
              toast(promote ? t('کاپیتان شد', 'Made co-host') : t('کاپیتانی گرفته شد', 'Co-host role removed'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              btn.disabled = false
            }
          })
        })

        // ── مودال تنظیمات لابی ──
        const settingsModal = app.querySelector('#lobby-settings-modal')
        app.querySelector('#lobby-settings-btn')?.addEventListener('click', () => { settingsModal.style.display = 'flex' })
        app.querySelector('#close-lobby-settings')?.addEventListener('click', () => { settingsModal.style.display = 'none' })
        settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none' })

        app.querySelector('#lobby-settings-form')?.addEventListener('submit', async (e) => {
          e.preventDefault()
          const form = e.target
          const fd = new FormData(form)
          const btn = form.querySelector('button[type="submit"]')
          btn.disabled = true
          try {
            const { error: updErr } = await supabase.from('game_lobbies').update({
              game_name: fd.get('game_name').trim(),
              category: fd.get('category')?.trim() || null,
              description: fd.get('description')?.trim() || null,
              capacity: Math.max(Number(fd.get('capacity')) || 2, members?.length || 1),
              status: fd.get('status') || 'open'
            }).eq('id', lobbyId)
            if (updErr) throw updErr
            toast(t('تنظیمات لابی ذخیره شد', 'Lobby settings saved'))
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            btn.disabled = false
          }
        })

        // حذف کامل لابی
        app.querySelector('#delete-lobby-btn')?.addEventListener('click', async (e) => {
          if (!confirm(t('لابی با همه‌ی پیام‌هاش برای همیشه حذف بشه؟', 'Delete the lobby with all its messages forever?'))) return
          if (!confirm(t('واقعاً مطمئنی؟ این کار برگشت‌ناپذیره!', 'Are you sure? This cannot be undone!'))) return
          e.target.disabled = true
          try {
            const { error: delErr } = await supabase.rpc('delete_lobby', { p_lobby_id: lobbyId })
            if (delErr) throw delErr
            toast(t('لابی حذف شد', 'Lobby deleted'))
            window.location.hash = '/lobbies'
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
            const rows = (follows || []).filter(f => !memberIds.has(f.follower_id))
            if (!rows.length) {
              inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">${t('همه‌ی فالوورهات داخل لابی هستن (یا هنوز فالووری نداری).', 'All your followers are already in (or you have none yet).')}</div>`
              return
            }
            inviteList.innerHTML = rows.map(f => `
              <div class="invite-user-row">
                <div class="row">
                  <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                  <b>${escapeHtml(f.follower?.nickname || '')}</b>
                </div>
                <button class="send-lobby-invite-btn primary" data-user-id="${f.follower_id}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} ${t('دعوت', 'Invite')}</button>
              </div>
            `).join('')
            inviteList.querySelectorAll('.send-lobby-invite-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                btn.disabled = true
                try {
                  const { error: invErr } = await supabase.from('notifications').insert({
                    user_id: btn.dataset.userId,
                    sender_id: profile.id,
                    type: 'lobby_invite',
                    target_id: lobbyId,
                    message: t(`${profile.nickname} تورو به لابی «${lobby.game_name}» دعوت کرد — بیا بازی کنیم!`, `${profile.nickname} invited you to the lobby "${lobby.game_name}" — come play!`)
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
