import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, toast } from '../lib/utils.js'

export default async function publicProfilePage(parts = []) {
  const targetId = parts[0] // آیدی کاربر مورد بازدید

  return withShell('profile', async (myProfile) => {
    let profile = myProfile
    let isMe = true

    if (targetId && targetId !== myProfile.id) {
      isMe = false
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', targetId)
        .single()
      if (error || !data) {
        throw new Error('این کاربر پیدا نشد.')
      }
      profile = data
    }

    // تعداد فالوورها و فالووینگ‌ها
    const [{ data: followers }, { data: following }, { data: followStatus }] = await Promise.all([
      supabase.from('follows').select('*').eq('following_id', profile.id).eq('status', 'accepted'),
      supabase.from('follows').select('*').eq('follower_id', profile.id).eq('status', 'accepted'),
      !isMe ? supabase.from('follows').select('*').eq('follower_id', myProfile.id).eq('following_id', profile.id).single() : { data: null }
    ])

    const followersCount = followers?.length || 0
    const followingCount = following?.length || 0
    const isFollowing = followStatus?.status === 'accepted'
    const isPending = followStatus?.status === 'pending'

    // پست‌های این کاربر
    const { data: userPosts } = await supabase
      .from('posts')
      .select('*')
      .eq('author_id', profile.id)
      .order('created_at', { ascending: false })

    // هماهنگ‌سازی خودکار رنگ بدنه با رنگ نئون انتخابی کاربر
    const userThemeClass = profile.neon_color === 'red' ? 'theme-red' : profile.neon_color === 'green' ? 'theme-green' : profile.neon_color === 'blue' ? 'theme-blue' : 'theme-rgb'

    const html = `
      <div class="instagram-profile ${userThemeClass}">
        <header class="profile-header">
          <div class="profile-avatar-container">
            <div class="avatar-wrapper ${neonClass(profile.neon_color)}">
              <img class="avatar lg" src="${profile.avatar_url || defaultAvatar(profile.nickname)}">
            </div>
          </div>
          
          <div class="profile-details">
            <div class="profile-username-row">
              <h2>${escapeHtml(profile.nickname)}</h2>
              ${isMe ? `
                <button class="edit-profile-btn" id="go-edit-btn">Edit Profile</button>
              ` : `
                <div class="row" style="gap: 8px;">
                  <button class="follow-btn ${isFollowing ? 'active' : ''}" id="follow-action-btn">
                    ${isFollowing ? 'Following' : isPending ? 'Requested' : 'Follow'}
                  </button>
                  <button class="invite-lobby-btn" id="invite-lobby-btn">Invite to Game</button>
                </div>
              `}
            </div>
            
            <div class="profile-stats">
              <span><b>${userPosts?.length || 0}</b> posts</span>
              <span><b>${followersCount}</b> followers</span>
              <span><b>${followingCount}</b> following</span>
            </div>
            
            <div class="profile-bio-section">
              <span class="profile-real-name">${escapeHtml(profile.nickname)}</span>
              ${profile.bio ? `<p class="profile-bio-text">${escapeHtml(profile.bio)}</p>` : ''}
              ${profile.status_text ? `<div class="profile-status-bubble">💭 ${escapeHtml(profile.status_text)}</div>` : ''}
            </div>
          </div>
        </header>

        ${profile.profile_music_url ? `
          <div class="glass card music-card" style="margin-top: 20px;">
            <div class="row" style="gap:10px;">
              <span style="font-size:20px;">🎵</span>
              <div style="flex:1;">
                <div class="text-dim" style="font-size:11px;">PERSONAL SOUNDTRACK</div>
                <div style="font-weight:700;">آهنگ شخصی ${escapeHtml(profile.nickname)}</div>
              </div>
            </div>
            <audio controls src="${escapeHtml(profile.profile_music_url)}" style="width:100%; margin-top:10px;"></audio>
          </div>
        ` : ''}

        <div class="profile-posts-grid-container">
          <div class="grid-tabs">
            <button class="active">POSTS</button>
          </div>
          
          <div class="instagram-posts-grid">
            ${userPosts?.length ? userPosts.map(p => `
              <div class="grid-post-item" data-post-id="${p.id}">
                ${p.media_url ? `
                  <img src="${escapeHtml(p.media_url)}" onerror="this.src='https://placehold.co/400?text=Post'">
                ` : `
                  <div class="text-post-placeholder">
                    <p>${escapeHtml(p.caption || '')}</p>
                  </div>
                `}
              </div>
            `).join('') : `
              <div class="empty-state" style="grid-column: 1 / -1;">
                <p>No Posts Yet</p>
              </div>
            `}
          </div>
        </div>
      </div>

      <!-- مودال ویرایش فقط برای خود کاربر -->
      ${isMe ? `
        <div class="modal-backdrop" id="edit-profile-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>Edit Profile</h3>
              <button class="danger" id="close-edit-modal" style="padding:4px 8px;">✕</button>
            </div>
            <form id="edit-profile-form" class="stack">
              <label class="text-dim">Avatar Link</label>
              <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" placeholder="لینک عکس پروفایل" />

              <label class="text-dim">Bio</label>
              <textarea name="bio" rows="3" placeholder="چند خط درباره‌ی خودت">${escapeHtml(profile.bio || '')}</textarea>

              <label class="text-dim">Profile Music (Direct MP3 URL)</label>
              <input name="profile_music_url" value="${escapeHtml(profile.profile_music_url || '')}" placeholder="لینک مستقیم فایل صوتی" />

              <label class="text-dim">Status/Short Story</label>
              <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

              <label class="text-dim">Neon Theme Color</label>
              <select name="neon_color">
                <option value="blue" ${profile.neon_color === 'blue' ? 'selected' : ''}>آبی</option>
                <option value="red" ${profile.neon_color === 'red' ? 'selected' : ''}>قرمز</option>
                <option value="green" ${profile.neon_color === 'green' ? 'selected' : ''}>سبز</option>
                <option value="rgb-cycle" ${profile.neon_color === 'rgb-cycle' ? 'selected' : ''}>RGB متحرک</option>
              </select>

              <button class="primary" type="submit">Save Changes</button>
            </form>
          </div>
        </div>
      ` : ''}
    `

    return {
      html,
      mount: (app) => {
        if (isMe) {
          const modal = app.querySelector('#edit-profile-modal')
          const openBtn = app.querySelector('#go-edit-btn')
          const closeBtn = app.querySelector('#close-edit-modal')
          const form = app.querySelector('#edit-profile-form')

          openBtn?.addEventListener('click', () => { modal.style.display = 'flex' })
          closeBtn?.addEventListener('click', () => { modal.style.display = 'none' })

          form?.addEventListener('submit', async (e) => {
            e.preventDefault()
            const fd = new FormData(form)
            try {
              const { error } = await supabase.from('users').update({
                avatar_url: fd.get('avatar_url')?.trim() || null,
                bio: fd.get('bio')?.trim() || null,
                profile_music_url: fd.get('profile_music_url')?.trim() || null,
                status_text: fd.get('status_text')?.trim() || null,
                neon_color: fd.get('neon_color')
              }).eq('id', myProfile.id)
              if (error) throw error
              toast('پروفایل با موفقیت بروزرسانی شد')
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
            }
          })
        } else {
          // دکمه فالو
          const followBtn = app.querySelector('#follow-action-btn')
          followBtn?.addEventListener('click', async () => {
            try {
              if (isFollowing || isPending) {
                await supabase.from('follows').delete().match({ follower_id: myProfile.id, following_id: profile.id })
                toast('رابطه فالو لغو شد')
              } else {
                await supabase.from('follows').insert({ follower_id: myProfile.id, following_id: profile.id, status: 'pending' })
                await supabase.from('notifications').insert({
                  user_id: profile.id,
                  sender_id: myProfile.id,
                  type: 'follow_request',
                  message: `${myProfile.nickname} درخواست فالو برای شما فرستاد.`
                })
                toast('درخواست فالو ارسال شد')
              }
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
            }
          })

          // دکمه دعوت به بازی
          const inviteBtn = app.querySelector('#invite-lobby-btn')
          inviteBtn?.addEventListener('click', async () => {
            const gameName = prompt('اسم بازی که می‌خوای دعوتش کنی رو بنویس:')
            if (!gameName) return
            try {
              await supabase.from('notifications').insert({
                user_id: profile.id,
                sender_id: myProfile.id,
                type: 'lobby_invite',
                message: `${myProfile.nickname} شما را به بازی ${gameName} دعوت کرده است!`
              })
              toast('دعوت با موفقیت ارسال شد!')
            } catch (err) {
              toast(err.message, { error: true })
            }
          })
        }

        app.querySelectorAll('.grid-post-item').forEach(item => {
          item.addEventListener('click', () => {
            window.location.hash = '/feed'
          })
        })
      }
    }
  })
}
