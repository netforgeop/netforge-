import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml, toast } from '../lib/utils.js'

export default async function lobbyDetailPage([lobbyId]) {
  return withShell('lobbies', async (profile) => {
    const { data: lobby, error } = await supabase.from('game_lobbies').select('*').eq('id', lobbyId).single()
    if (error) throw new Error('این لابی پیدا نشد')

    const { data: members } = await supabase
      .from('lobby_members')
      .select('user_id, member:users!lobby_members_user_id_fkey(nickname, avatar_url, neon_color, is_online)')
      .eq('lobby_id', lobbyId)

    const isMember = (members || []).some(m => m.user_id === profile.id)
    const isFull = (members?.length || 0) >= lobby.capacity && !isMember

    const html = `
      <a href="#/lobbies">&#8594; بازگشت به لابی‌ها</a>
      <h2 style="margin-top:10px;">${escapeHtml(lobby.game_name)}</h2>
      <p class="text-dim">${escapeHtml(lobby.description || '')}</p>

      <div class="glass card">
        <h3>بازیکنان (${members?.length || 0}/${lobby.capacity})</h3>
        <div class="row" style="flex-wrap:wrap;">
          ${(members || []).map(m => `
            <a href="#/profile/${m.user_id}" class="row" style="margin-left:14px; color:inherit;">
              <img class="avatar sm ${neonClass(m.member?.neon_color)}" src="${escapeHtml(m.member?.avatar_url || defaultAvatar(m.member?.nickname))}">
              <span>${escapeHtml(m.member?.nickname)}</span>
              <span class="presence-dot ${m.member?.is_online ? 'online' : ''}"></span>
            </a>
          `).join('')}
        </div>
      </div>

      ${isMember ? chatMarkup() : `
        <div class="glass card" style="text-align:center; padding:30px;">
          ${isFull
            ? '<p class="text-dim">ظرفیت این لابی کامل شده است.</p>'
            : `<p class="text-dim" style="margin-bottom:12px;">برای دیدن و فرستادن پیام، اول به لابی بپیوند.</p>
               <button class="primary" id="join-lobby-inline-btn">پیوستن به لابی</button>`}
        </div>
      `}
    `

    return {
      html,
      mount: async (app) => {
        if (isMember) {
          await mountChat(app, { targetType: 'lobby', targetId: lobbyId, me: profile })
        } else {
          app.querySelector('#join-lobby-inline-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true
            try {
              const { error: joinErr } = await supabase.from('lobby_members').insert({ lobby_id: lobbyId, user_id: profile.id })
              if (joinErr) throw joinErr
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
              e.target.disabled = false
            }
          })
        }
      }
    }
  })
}
