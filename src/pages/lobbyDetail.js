import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast, icon } from '../lib/utils.js'

export default async function lobbyDetailPage([lobbyId]) {
  return withShell('lobbies', async (profile) => {
    const { data: lobby, error } = await supabase.from('game_lobbies').select('*').eq('id', lobbyId).single()
    if (error) throw new Error('این لابی پیدا نشد')

    const { data: members } = await supabase
      .from('lobby_members')
      .select('user_id, member:users!lobby_members_user_id_fkey(nickname, avatar_url, neon_color, is_online)')
      .eq('lobby_id', lobbyId)

    const isMember = (members || []).some(m => m.user_id === profile.id)
    const isHost = lobby.host_id === profile.id
    const isPlatformStaff = profile.role === 'admin' || profile.role === 'moderator'
    const canManage = isHost || isPlatformStaff
    const isFull = (members?.length || 0) >= lobby.capacity && !isMember

    const html = `
      <a href="#/lobbies">&#8594; بازگشت به لابی‌ها</a>
      <div class="row" style="margin-top:10px; flex-wrap:wrap;">
        <h2 style="margin:0;">${escapeHtml(lobby.game_name)}</h2>
        ${lobby.category ? `<span class="badge">${escapeHtml(lobby.category)}</span>` : ''}
        ${lobby.status === 'closed' ? `<span class="privacy-badge private">${icon('lock')} بسته</span>` : ''}
      </div>
      <p class="text-dim">${escapeHtml(lobby.description || '')}</p>

      <div class="header-actions">
        ${canManage ? `<button id="lobby-settings-btn">${icon('gear')} تنظیمات لابی</button>` : ''}
        ${isMember ? `<button id="invite-friends-btn">${icon('user-plus')} دعوت از فالوورها</button>` : ''}
      </div>

      <div class="glass card">
        <h3>بازیکنان (${members?.length || 0}/${lobby.capacity})</h3>
        <div class="row" style="flex-wrap:wrap;">
          ${(members || []).map(m => `
            <a href="#/profile/${m.user_id}" class="row" style="margin-left:14px; color:inherit;">
              <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
              <span>${escapeHtml(m.member?.nickname)}</span>
              ${m.user_id === lobby.host_id ? `<span class="badge mod">${icon('crown')} میزبان</span>` : ''}
              <span class="presence-dot ${m.member?.is_online ? 'online' : ''}"></span>
            </a>
          `).join('')}
        </div>
      </div>

      ${isMember || isHost ? chatMarkup() : `
        <div class="glass card" style="text-align:center; padding:30px;">
          ${isFull
            ? '<p class="text-dim">ظرفیت این لابی کامل شده است.</p>'
            : `<p class="text-dim" style="margin-bottom:12px;">برای دیدن و فرستادن پیام، اول به لابی بپیوند.</p>
               <button class="primary" id="join-lobby-inline-btn">پیوستن به لابی</button>`}
        </div>
      `}

      ${canManage ? `
        <!-- مودال تنظیمات لابی (پاپ‌آپ) — میزبان یا مدیر پلتفرم -->
        <div class="modal-backdrop" id="lobby-settings-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('gear')} تنظیمات لابی</h3>
              <button class="danger" id="close-lobby-settings" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="lobby-settings-form" class="stack">
              <label class="text-dim">اسم بازی</label>
              <input name="game_name" value="${escapeHtml(lobby.game_name)}" required />

              <label class="text-dim">دسته‌بندی</label>
              <input name="category" value="${escapeHtml(lobby.category || '')}" placeholder="مثلاً رقابتی / کژوال" />

              <label class="text-dim">توضیح</label>
              <textarea name="description" rows="2">${escapeHtml(lobby.description || '')}</textarea>

              <label class="text-dim">ظرفیت (حداقل ${Math.max(members?.length || 1, 2)})</label>
              <input name="capacity" type="number" min="${Math.max(members?.length || 1, 2)}" max="50" value="${lobby.capacity}" />

              <label class="text-dim">وضعیت لابی</label>
              <select name="status">
                <option value="open" ${lobby.status !== 'closed' ? 'selected' : ''}>باز — جوین آزاد</option>
                <option value="closed" ${lobby.status === 'closed' ? 'selected' : ''}>بسته — جوین جدید نمی‌پذیره</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ذخیره تغییرات</button>
            </form>
            <div class="danger-zone">
              <button class="danger" id="delete-lobby-btn" style="width:100%;">${icon('trash-can')} حذف کامل لابی (برگشت‌ناپذیر)</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${isMember ? `
        <!-- مودال دعوت از فالوورها (به سبک استیم) -->
        <div class="modal-backdrop" id="invite-friends-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('user-plus')} دعوت به لابی «${escapeHtml(lobby.game_name)}»</h3>
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
        if (isMember || isHost) {
          await mountChat(app, { targetType: 'lobby', targetId: lobbyId, me: profile })
        } else {
          app.querySelector('#join-lobby-inline-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true
            try {
              const { error: joinErr } = await supabase.from('lobby_members').insert({ lobby_id: lobbyId, user_id: profile.id })
              if (joinErr) throw joinErr
              toast('به لابی پیوستی')
              window.location.reload()
            } catch (err) {
              const msg = String(err.message || '')
              toast(msg.includes('row-level security') ? 'نتوانستی بپیوندی — ظرفیت لابی پر شده یا بسته است' : msg, { error: true })
              e.target.disabled = false
            }
          })
        }

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
            toast('تنظیمات لابی ذخیره شد')
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            btn.disabled = false
          }
        })

        // حذف کامل لابی
        app.querySelector('#delete-lobby-btn')?.addEventListener('click', async (e) => {
          if (!confirm('لابی با همه‌ی پیام‌هاش برای همیشه حذف بشه؟')) return
          if (!confirm('واقعاً مطمئنی؟ این کار برگشت‌ناپذیره!')) return
          e.target.disabled = true
          try {
            const { error: delErr } = await supabase.rpc('delete_lobby', { p_lobby_id: lobbyId })
            if (delErr) throw delErr
            toast('لابی حذف شد')
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
              inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">همه‌ی فالوورهات داخل لابی هستن (یا هنوز فالووری نداری).</div>`
              return
            }
            inviteList.innerHTML = rows.map(f => `
              <div class="invite-user-row">
                <div class="row">
                  <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                  <b>${escapeHtml(f.follower?.nickname || '')}</b>
                </div>
                <button class="send-lobby-invite-btn primary" data-user-id="${f.follower_id}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} دعوت</button>
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
                    message: `${profile.nickname} تورو به لابی «${lobby.game_name}» دعوت کرد — بیا بازی کنیم!`
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
