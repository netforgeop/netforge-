import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { clearProfileCache, neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, toast } from '../lib/utils.js'

export default async function profilePage() {
  return withShell('profile', async (profile) => {
    const { data: blocks } = await supabase
      .from('user_blocks')
      .select('blocked_id, users!user_blocks_blocked_id_fkey(nickname, avatar_url)')
      .eq('blocker_id', profile.id)

    const html = `
      <div class="glass card" style="text-align:center;">
        <img class="avatar lg ${neonClass(profile.neon_color)}" src="${profile.avatar_url || defaultAvatar(profile.nickname)}">
        <h2>${escapeHtml(profile.nickname)}</h2>
        ${profile.status_text ? `<p class="text-dim">${escapeHtml(profile.status_text)}</p>` : ''}
      </div>

      <div class="glass card">
        <h3>ویرایش پروفایل</h3>
        <form id="edit-profile-form" class="stack">
          <label class="text-dim">لینک آواتار</label>
          <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" placeholder="لینک عکس پروفایل" />

          <label class="text-dim">درباره‌ی من</label>
          <textarea name="bio" rows="3" placeholder="چند خط درباره‌ی خودت">${escapeHtml(profile.bio || '')}</textarea>

          <label class="text-dim">موزیک پروفایل (لینک مستقیم فایل صوتی)</label>
          <input name="profile_music_url" value="${escapeHtml(profile.profile_music_url || '')}" placeholder="لینک موزیک" />

          <label class="text-dim">وضعیت/استوری کوتاه</label>
          <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

          <label class="text-dim">لینک GIF وضعیت (اختیاری)</label>
          <input name="status_gif_url" value="${escapeHtml(profile.status_gif_url || '')}" />

          <label class="text-dim">رنگ نئون</label>
          <select name="neon_color">
            <option value="blue" ${profile.neon_color === 'blue' ? 'selected' : ''}>آبی</option>
            <option value="red" ${profile.neon_color === 'red' ? 'selected' : ''}>قرمز</option>
            <option value="green" ${profile.neon_color === 'green' ? 'selected' : ''}>سبز</option>
            <option value="rgb-cycle" ${profile.neon_color === 'rgb-cycle' ? 'selected' : ''}>RGB متحرک</option>
          </select>

          <button class="primary" type="submit">ذخیره</button>
        </form>
      </div>

      ${profile.profile_music_url ? `
        <div class="glass card">
          <h3>پیش‌نمایش موزیک پروفایل</h3>
          <audio controls autoplay src="${escapeHtml(profile.profile_music_url)}" style="width:100%;"></audio>
        </div>
      ` : ''}

      <div class="glass card">
        <h3>کاربران بلاک‌شده</h3>
        ${blocks?.length ? blocks.map(b => `
          <div class="row between" style="margin-bottom:8px;">
            <div class="row">
              <img class="avatar sm" src="${b.users?.avatar_url || defaultAvatar(b.users?.nickname)}">
              ${escapeHtml(b.users?.nickname)}
            </div>
            <button class="unblock-btn" data-user-id="${b.blocked_id}">آنبلاک</button>
          </div>
        `).join('') : '<p class="text-dim">کسی رو بلاک نکردی.</p>'}
      </div>
    `

    return { html, mount: (app) => mountProfile(app, profile) }
  })
}

function mountProfile(app, me) {
  const form = app.querySelector('#edit-profile-form')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const btn = form.querySelector('button')
    btn.disabled = true
    try {
      const { error } = await supabase.from('users').update({
        avatar_url: fd.get('avatar_url')?.trim() || null,
        bio: fd.get('bio')?.trim() || null,
        profile_music_url: fd.get('profile_music_url')?.trim() || null,
        status_text: fd.get('status_text')?.trim() || null,
        status_gif_url: fd.get('status_gif_url')?.trim() || null,
        neon_color: fd.get('neon_color')
      }).eq('id', me.id)
      if (error) throw error
      clearProfileCache()
      toast('پروفایل به‌روزرسانی شد')
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })

  app.querySelectorAll('.unblock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('user_blocks').delete().match({ blocker_id: me.id, blocked_id: btn.dataset.userId })
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })
}
