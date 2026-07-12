import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { chatMarkup, mountChat } from '../components/chat.js'
import { escapeHtml } from '../lib/utils.js'

export default async function lobbyDetailPage([lobbyId]) {
  return withShell('lobbies', async (profile) => {
    const { data: lobby, error } = await supabase.from('game_lobbies').select('*').eq('id', lobbyId).single()
    if (error) throw new Error('این لابی پیدا نشد')

    const html = `
      <a href="#/lobbies">&#8594; بازگشت به لابی‌ها</a>
      <h2 style="margin-top:10px;">${escapeHtml(lobby.game_name)}</h2>
      <p class="text-dim">${escapeHtml(lobby.description || '')}</p>
      ${chatMarkup()}
    `

    return {
      html,
      mount: async (app) => {
        await mountChat(app, { targetType: 'lobby', targetId: lobbyId, me: profile })
      }
    }
  })
}
