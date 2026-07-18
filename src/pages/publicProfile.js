import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff, openSanctionModal, getActiveSanctionFor, liftSanction } from '../lib/moderation.js'
import { t, dateLocale } from '../lib/i18n.js'
import { reportBlockMarkup, attachReportBlock } from '../components/reportBlock.js'

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
        throw new Error(t('این کاربر پیدا نشد.', 'This user was not found.'))
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

    // ابزار مدیریت: فقط ادمین/ناظم روی پروفایل بقیه می‌بیند
    // (ناظم حق محدود کردن ادمین/ناظم دیگر را ندارد؛ ادمین همه جز ادمین‌ها)
    let staffSection = ''
    if (!isMe && isStaff(myProfile)) {
      const targetIsStaff = profile.role === 'admin' || profile.role === 'moderator'
      const canSanction = myProfile.role === 'admin' ? profile.role !== 'admin' : !targetIsStaff
      if (canSanction) {
        const activeSanction = await getActiveSanctionFor(profile.id)
        staffSection = `
          <div class="glass card moderation-card" style="margin-top:15px;">
            <h3>${icon('scale-balanced')} ${t('ابزارهای مدیریت', 'Moderation tools')}</h3>
            ${activeSanction ? `
              <div class="row between">
                <span>${t('وضعیت فعلی:', 'Current status:')} <span class="badge danger-badge">${activeSanction.type}</span>
                  ${activeSanction.expires_at ? `${t('تا', 'until')} ${new Date(activeSanction.expires_at).toLocaleString(dateLocale())}` : t('(دائم)', '(permanent)')}
                </span>
                <button class="lift-sanction-btn" data-id="${activeSanction.id}">${t('رفع محدودیت', 'Lift restriction')}</button>
              </div>
            ` : `<p class="text-dim">${t('این کاربر الان محدودیتی ندارد.', 'This user has no active restrictions.')}</p>`}
            <button class="danger" id="sanction-user-btn" style="margin-top:8px;">${icon('scale-balanced')} ${t('اعمال محدودیت جدید', 'Apply restriction')}</button>
          </div>
        `
      }
    }

    // ── کارت مدیریت کامل حساب: فقط برای ادمین روی پروفایل غیرادمین‌ها ──
    // ویرایش همه‌چیز پروفایل + تغییر نقش + ریست رمز + تغییر نیک‌نیم (با سینک لاگین)
    let adminManageSection = ''
    if (!isMe && myProfile.role === 'admin' && profile.role !== 'admin') {
      adminManageSection = `
        <div class="glass card" style="margin-top:15px;">
          <h3>${icon('user-gear')} ${t(`مدیریت حساب ${profile.nickname}`, `Manage ${profile.nickname}'s account`)}</h3>
          <p class="text-dim" style="font-size:13px;">${t('ویرایش پروفایل، نقش، و ریست رمز عبور (چون ایمیل واقعی به حساب‌ها وصل نیست، از این‌جا می‌تونی حساب گمشده رو برگردونی).', 'Edit profile, role, and reset password (accounts are not tied to real emails — recover lost accounts here).')}</p>
          <div class="row" style="gap:8px; margin-top:10px;">
            <button id="admin-edit-user-btn" class="primary">${icon('pen-to-square')} ${t('ویرایش پروفایل کاربر', 'Edit user profile')}</button>
          </div>
        </div>

        <div class="modal-backdrop" id="admin-user-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${t(`ویرایش ${profile.nickname} (ادمین)`, `Edit ${profile.nickname} (admin)`)}</h3>
              <button class="danger" id="close-admin-user-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="admin-user-form" class="stack">
              <label class="text-dim">${t('نیک‌نیم (لاگین با همین انجام می‌شه)', 'Nickname (used for login)')}</label>
              <input name="nickname" value="${escapeHtml(profile.nickname)}" minlength="2" maxlength="24" required />

              <label class="text-dim">${t('نقش', 'Role')}</label>
              <select name="role">
                <option value="member" ${profile.role === 'member' ? 'selected' : ''}>${t('عضو معمولی', 'Member')}</option>
                <option value="moderator" ${profile.role === 'moderator' ? 'selected' : ''}>${t('ناظم (Moderator)', 'Moderator')}</option>
              </select>

              <label class="text-dim">${t('لینک آواتار', 'Avatar URL')}</label>
              <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" />

              <label class="text-dim">${t('بیو', 'Bio')}</label>
              <textarea name="bio" rows="2">${escapeHtml(profile.bio || '')}</textarea>

              <label class="text-dim">${t('استاتوس', 'Status')}</label>
              <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

              <label class="text-dim">${t('رمز جدید (خالی بذاری دست نمی‌خوره)', 'New password (leave empty to keep)')}</label>
              <input name="new_password" type="password" minlength="6" placeholder="${t('حداقل ۶ کاراکتر', 'min 6 characters')}" autocomplete="new-password" />

              <button class="primary" type="submit">${icon('floppy-disk')} ${t('ذخیره همه تغییرات', 'Save all changes')}</button>
            </form>
          </div>
        </div>
      `
    }

    // ── کارت «دعوت دوستان» فقط روی پروفایل خودم نمایش داده می‌شه ──
    // کاربر درخواست می‌ده، ادمین تایید می‌کنه، کد دعوت همین‌جا ظاهر می‌شه
    let inviteCard = ''
    if (isMe) {
      const { data: myInviteReqs, error: invErr } = await supabase
        .from('invite_requests')
        .select('*, resulting_code:invite_codes!invite_requests_resulting_invite_code_id_fkey(code, used_count, max_uses, is_active)')
        .eq('requested_by', myProfile.id)
        .order('requested_at', { ascending: false })
        .limit(5)

      // اگه جدول/پالیسی هنوز آماده نباشه (خطای RLS)، کارت رو نشون نمی‌دیم
      if (!invErr) {
        const hasPending = (myInviteReqs || []).some(r => r.status === 'pending')
        inviteCard = `
          <div class="glass card" style="margin-top:15px;" dir="rtl">
            <h3>${icon('envelope')} ${t('دعوت دوستان', 'Invite friends')}</h3>
            <p class="text-dim" style="font-size:13px;">${t('می‌خوای یکی از دوستات به نت‌فورج بیاد؟ درخواست کد دعوت بده؛ همون لحظه کد برات ساخته می‌شه (روزی یک کد).', 'Want a friend here? Request an invite code — it is generated instantly (one per day).')}</p>
            ${hasPending
              ? `<p class="text-dim">${t('درخواست در حال پردازش است...', 'Request is processing...')}</p>`
              : `<button class="primary" id="request-invite-btn">${icon('ticket')} ${t('درخواست کد دعوت جدید', 'Request new invite code')}</button>`}
            ${(myInviteReqs || []).filter(r => r.status !== 'pending').length ? `
              <div class="stack" style="margin-top:12px; gap:8px;">
                ${(myInviteReqs || []).filter(r => r.status !== 'pending').map(r => `
                  <div class="row between" style="font-size:13px; border-top:1px solid var(--glass-border); padding-top:8px;">
                    ${r.status === 'approved' && r.resulting_code ? `
                      <span>${t('کد شما:', 'Your code:')} <b class="invite-code-text" style="color:var(--neon); font-size:15px; letter-spacing:1px;">${escapeHtml(r.resulting_code.code)}</b>
                        <span class="text-dim">(${r.resulting_code.used_count}/${r.resulting_code.max_uses} ${t('استفاده', 'used')})</span>
                      </span>
                      <button class="copy-invite-btn" data-code="${escapeHtml(r.resulting_code.code)}">${icon('copy')} ${t('کپی', 'Copy')}</button>
                    ` : r.status === 'rejected' ? `
                      <span class="text-dim">${icon('xmark')} ${t(`درخواست ${timeAgo(r.requested_at)} رد شد`, `Request from ${timeAgo(r.requested_at)} was rejected`)}</span>
                    ` : `
                      <span class="text-dim">${t('در انتظار...', 'Pending...')}</span>
                    `}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `
      }
    }

    // نکته: رنگِ «کل سایت» (دکمه‌ها و اکسنت‌ها) از انتخابِ خودِ کاربر لاگین‌شده
    // ── کارت «اقدامات مدیریتی روی حساب من» — فقط خودِ کاربر می‌بینه ──
    let myModLogCard = ''
    if (isMe) {
      const { data: myModLog } = await supabase
        .from('mod_actions')
        .select('*')
        .eq('target_user_id', myProfile.id)
        .order('created_at', { ascending: false })
        .limit(10)
      if (myModLog && myModLog.length) {
        const lbl = {
          delete_post: t('پستت پاک شد', 'your post was deleted'),
          delete_comment: t('کامنتت پاک شد', 'your comment was deleted'),
          delete_lobby_comment: t('کامنت لابی‌ات پاک شد', 'your lobby comment was deleted'),
          delete_message: t('پیامت پاک شد', 'your message was deleted'),
          ban: t('حسابت بن شد', 'your account was banned'),
          mute: t('میوت شدی', 'you were muted'),
          timeout: t('تایم‌اوت شدی', 'you got a timeout')
        }
        myModLogCard = `
          <div class="glass card" style="margin-top:15px;">
            <h3>${icon('clipboard-list')} ${t('اقدامات مدیریتی روی حساب من', 'Moderation actions on my account')}</h3>
            <p class="text-dim" style="font-size:12px;">${t('این لیست فقط برای خودته — هر بار مدیریت چیزی ازت پاک کنه یا محدودیت بزنه، با دلیلش این‌جا میاد.', 'Only visible to you — moderation actions on your content with reasons.')}</p>
            ${myModLog.map(m => `
              <div style="margin-bottom:8px; border-top:1px solid var(--glass-border); padding-top:8px; font-size:13px;">
                <b>${lbl[m.action] || m.action}</b>
                <span class="text-dim" style="font-size:11px;"> · ${new Date(m.created_at).toLocaleString(dateLocale())}</span>
                ${m.reason ? `<div class="text-dim">${t('دلیل:', 'Reason:')} ${escapeHtml(m.reason)}</div>` : ''}
                ${m.snapshot ? `<div class="text-dim" style="font-size:11px; opacity:.75;">${escapeHtml(m.snapshot)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        `
      }
    }

    // ── کارت «درخواست‌های فالو» فقط روی پروفایل خودم ──
    // (باگ QA: قبلاً هیچ راهی برای قبول کردن فالو توی UI وجود نداشت)
    let followReqCard = ''
    let pendingFollowers = []
    if (isMe) {
      const { data } = await supabase
        .from('follows')
        .select('id, follower_id, follower:users!follows_follower_id_fkey(nickname, avatar_url, neon_color)')
        .eq('following_id', myProfile.id)
        .eq('status', 'pending')
      pendingFollowers = data || []
      if (pendingFollowers.length) {
        followReqCard = `
          <div class="glass card" style="margin-top:15px;">
            <h3>${icon('user-plus')} ${t('درخواست‌های فالو', 'Follow requests')} (${pendingFollowers.length})</h3>
            <div class="stack" style="gap:10px;">
              ${pendingFollowers.map(f => `
                <div class="row between">
                  <a href="#/profile/${f.follower_id}" class="row" style="color:inherit; text-decoration:none;">
                    <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                    <b>${escapeHtml(f.follower?.nickname || '')}</b>
                  </a>
                  <div class="row" style="gap:6px;">
                    <button class="follow-req-accept primary" data-id="${f.id}" style="padding:4px 14px; font-size:12px;">${icon('check')} ${t('قبول', 'Accept')}</button>
                    <button class="follow-req-decline danger" data-id="${f.id}" style="padding:4px 14px; font-size:12px;">${icon('xmark')} ${t('رد', 'Decline')}</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `
      }
    }

    // میاد و روی <body> نشسته می‌شه (در shell.js با applyAccent). پس دیگه کل
    // کانتینر پروفایل رو با تم طرف رنگ نمی‌کنیم تا با حالت روز/شب قاتی نشه؛
    // فقط حلقه‌ی نئون دور آواتار رنگِ انتخابیِ صاحب پروفایل رو نشون می‌ده.

    const html = `
      <div class="instagram-profile">
        <header class="profile-header">
          <div class="profile-avatar-container">
            <div class="avatar-wrapper ${neonClass(profile.neon_color)}">
              <img class="avatar lg" src="${escapeHtml(profile.avatar_url || defaultAvatar(profile.nickname))}">
            </div>
          </div>
          
          <div class="profile-details">
            <div class="profile-username-row">
              <h2>${escapeHtml(profile.nickname)}</h2>
              ${isMe ? `
                <button class="edit-profile-btn" id="go-edit-btn">${icon('pen-to-square')} ${t('ویرایش پروفایل', 'Edit Profile')}</button>
              ` : `
                <div class="row" style="gap: 8px;">
                  <button class="follow-btn ${isFollowing ? 'active' : ''}" id="follow-action-btn">
                    ${isFollowing ? t('فالو می‌کنی', 'Following') : isPending ? t('درخواست داده‌ای', 'Requested') : t('فالو', 'Follow')}
                  </button>
                  <button class="invite-lobby-btn" id="invite-lobby-btn">${icon('gamepad')} ${t('دعوت به بازی', 'Invite to Game')}</button>
                  ${reportBlockMarkup(profile.id, { targetType: 'user', targetId: profile.id })}
                </div>
              `}
            </div>
            
            <div class="profile-stats">
              <span><b>${userPosts?.length || 0}</b> ${t('پست', 'posts')}</span>
              <span><b>${followersCount}</b> ${t('دنبال‌کننده', 'followers')}</span>
              <span><b>${followingCount}</b> ${t('دنبال‌شونده', 'following')}</span>
            </div>
            
            <div class="profile-bio-section">
              <span class="profile-real-name">${escapeHtml(profile.nickname)}</span>
              ${profile.bio ? `<p class="profile-bio-text">${escapeHtml(profile.bio)}</p>` : ''}
              ${profile.status_text ? `<div class="profile-status-bubble">${icon('comment-dots')} ${escapeHtml(profile.status_text)}</div>` : ''}
            </div>
          </div>
        </header>

        ${staffSection}

        ${adminManageSection}

        ${followReqCard}

        ${inviteCard}

        ${myModLogCard}

        ${profile.profile_music_url ? `
          <div class="glass card music-card" style="margin-top: 20px;">
            <div class="row" style="gap:10px;">
              <span style="font-size:20px;">${icon('music')}</span>
              <div style="flex:1;">
                <div class="text-dim" style="font-size:11px;">${t('موزیکِ پروفایل', 'PROFILE SOUNDTRACK')}</div>
                <div style="font-weight:700;">${t(`آهنگ شخصی ${profile.nickname}`, `${profile.nickname}'s anthem`)}</div>
              </div>
            </div>
            <audio controls src="${escapeHtml(profile.profile_music_url)}" style="width:100%; margin-top:10px;"></audio>
          </div>
        ` : ''}

        <div class="profile-posts-grid-container">
          <div class="grid-tabs">
            <button class="active">${t('پست‌ها', 'POSTS')}</button>
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
                <p>${t('هنوز پستی نیست', 'No posts yet')}</p>
              </div>
            `}
          </div>
        </div>
      </div>

      ${!isMe ? `
        <!-- مودال دعوت به بازی: یکی از لابی‌هایی که خودم عضو هستم رو انتخاب می‌کنم
             تا دعوت‌نامه با target_id درست ساخته بشه (فیکس باگ #/lobbies/null) -->
        <div class="modal-backdrop" id="invite-game-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('gamepad')} ${t(`دعوت ${profile.nickname} به بازی`, `Invite ${profile.nickname} to a game`)}</h3>
              <button class="danger" id="close-invite-game-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <div id="invite-lobbies-list" class="stack" style="gap:4px;">
              <div class="text-dim" style="text-align:center;">${t('در حال بارگذاری لابی‌هات...', 'Loading your lobbies...')}</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- مودال ویرایش فقط برای خود کاربر -->
      ${isMe ? `
        <div class="modal-backdrop" id="edit-profile-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${t('ویرایش پروفایل', 'Edit Profile')}</h3>
              <button class="danger" id="close-edit-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="edit-profile-form" class="stack">
              <label class="text-dim">${t('لینک آواتار', 'Avatar URL')}</label>
              <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" placeholder="${t('لینک عکس پروفایل', 'Avatar image URL')}" />

              <label class="text-dim">${t('بیو', 'Bio')}</label>
              <textarea name="bio" rows="3" placeholder="${t('چند خط درباره‌ی خودت', 'A few lines about you')}">${escapeHtml(profile.bio || '')}</textarea>

              <label class="text-dim">${t('آهنگ پروفایل (لینک مستقیم MP3)', 'Profile music (direct MP3 URL)')}</label>
              <input name="profile_music_url" value="${escapeHtml(profile.profile_music_url || '')}" placeholder="${t('لینک مستقیم فایل صوتی', 'Direct audio file URL')}" />

              <label class="text-dim">${t('استاتوس / جمله‌ی کوتاه', 'Status / short line')}</label>
              <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

              <label class="text-dim">${t('رنگ تم (نئون)', 'Theme color (neon)')}</label>
              <select name="neon_color">
                <option value="blue" ${profile.neon_color === 'blue' ? 'selected' : ''}>${t('آبی', 'Blue')}</option>
                <option value="red" ${profile.neon_color === 'red' ? 'selected' : ''}>${t('قرمز', 'Red')}</option>
                <option value="green" ${profile.neon_color === 'green' ? 'selected' : ''}>${t('سبز', 'Green')}</option>
                <option value="rgb-cycle" ${profile.neon_color === 'rgb-cycle' ? 'selected' : ''}>${t('RGB متحرک', 'RGB cycle')}</option>
                <option value="vicecity" ${profile.neon_color === 'vicecity' ? 'selected' : ''}>Vice City (GTA)</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ${t('ذخیره تغییرات', 'Save changes')}</button>
            </form>

            <!-- تغییر رمز عبور — چون ایمیل واقعی وصل نیست، فقط از همین‌جا -->
            <form id="change-password-form" class="stack" style="border-top:1px solid var(--glass-border); padding-top:15px; margin-top:5px;">
              <label class="text-dim">${icon('key')} ${t('تغییر رمز عبور', 'Change password')}</label>
              <input name="new_password" type="password" placeholder="${t('رمز جدید (حداقل ۶ کاراکتر)', 'New password (min 6 chars)')}" minlength="6" autocomplete="new-password" required />
              <input name="confirm_password" type="password" placeholder="${t('تکرار رمز جدید', 'Repeat new password')}" minlength="6" autocomplete="new-password" required />
              <button type="submit">${icon('key')} ${t('تغییر رمز', 'Change password')}</button>
            </form>
          </div>
        </div>
      ` : ''}
    `

    return {
      html,
      mount: (app) => {
        // هندلرهای Report/Block روی پروفایل بقیه
        attachReportBlock(app, myProfile)

        // ابزارهای مدیریتی: دکمه اعمال محدودیت + رفع محدودیت
        const sanctionBtn = app.querySelector('#sanction-user-btn')
        sanctionBtn?.addEventListener('click', () => {
          openSanctionModal(myProfile, profile, () => window.location.reload())
        })
        app.querySelectorAll('.lift-sanction-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await liftSanction(btn.dataset.id, myProfile)
              toast(t('محدودیت رفع شد', 'Restriction lifted'))
              window.location.reload()
            } catch (err) { toast(err.message, { error: true }) }
          })
        })

        // ── مدیریت کامل حساب توسط ادمین (روی پروفایل بقیه) ──
        const adminModal = app.querySelector('#admin-user-modal')
        app.querySelector('#admin-edit-user-btn')?.addEventListener('click', () => { adminModal.style.display = 'flex' })
        app.querySelector('#close-admin-user-modal')?.addEventListener('click', () => { adminModal.style.display = 'none' })
        adminModal?.addEventListener('click', (e) => { if (e.target === adminModal) adminModal.style.display = 'none' })

        const adminForm = app.querySelector('#admin-user-form')
        adminForm?.addEventListener('submit', async (e) => {
          e.preventDefault()
          const fd = new FormData(adminForm)
          const btn = adminForm.querySelector('button[type="submit"]')
          btn.disabled = true
          try {
            // ۱) نیک‌نیم (با سینک ایمیل داخلی و متادیتا، وگرنه لاگین می‌شکنه)
            const newNick = fd.get('nickname')?.trim()
            if (newNick && newNick !== profile.nickname) {
              const { error } = await supabase.rpc('admin_update_nickname', { p_user_id: profile.id, p_new_nickname: newNick })
              if (error) throw error
            }
            // ۲) فیلدهای پروفایل و نقش
            const { error } = await supabase.from('users').update({
              role: fd.get('role'),
              avatar_url: fd.get('avatar_url')?.trim() || null,
              bio: fd.get('bio')?.trim() || null,
              status_text: fd.get('status_text')?.trim() || null
            }).eq('id', profile.id)
            if (error) throw error
            // ۳) ریست رمز (اختیاری)
            const newPass = fd.get('new_password')?.trim()
            if (newPass) {
              const { error } = await supabase.rpc('admin_reset_password', { p_user_id: profile.id, p_new_password: newPass })
              if (error) throw error
              toast(t('رمز کاربر ریست شد', 'Password reset'))
            }
            toast(t('پروفایل کاربر بروزرسانی شد', 'User profile updated'))
            window.location.reload()
          } catch (err) {
            toast(err.message, { error: true })
            btn.disabled = false
          }
        })

        if (isMe) {
          const modal = app.querySelector('#edit-profile-modal')
          const openBtn = app.querySelector('#go-edit-btn')
          const closeBtn = app.querySelector('#close-edit-modal')
          const form = app.querySelector('#edit-profile-form')

          // ── دکمه درخواست کد دعوت ──
          const reqInviteBtn = app.querySelector('#request-invite-btn')
          reqInviteBtn?.addEventListener('click', async () => {
            reqInviteBtn.disabled = true
            try {
              const { error } = await supabase.from('invite_requests').insert({
                requested_by: myProfile.id,
                status: 'pending'
              })
              if (error) throw error
              toast(t('کد دعوتت همون لحظه ساخته شد', 'Your invite code was created instantly'))
              window.location.reload()
            } catch (err) {
              // ایندکس یونیک pending سرور هم جلوی درخواست تکراری رو می‌گیره
              const msg = String(err.message || '')
              toast(msg.includes('duplicate') ? t('یک درخواست در انتظار تأیید داری', 'You already have a pending request') : msg, { error: true })
              reqInviteBtn.disabled = false
            }
          })

          // ── دکمه‌های قبول/رد درخواست فالو (کارت پروفایل) ──
          app.querySelectorAll('.follow-req-accept, .follow-req-decline').forEach(btn => {
            btn.addEventListener('click', async () => {
              const accept = btn.classList.contains('follow-req-accept')
              const rowId = btn.dataset.id
              const followerId = pendingFollowers.find(f => f.id === rowId)?.follower_id
              btn.disabled = true
              try {
                if (accept) {
                  const { error } = await supabase.from('follows').update({ status: 'accepted' }).eq('id', rowId)
                  if (error) throw error
                  if (followerId) {
                    await supabase.from('notifications').insert({
                      user_id: followerId,
                      sender_id: myProfile.id,
                      type: 'follow_accept',
                      message: t(`${myProfile.nickname} درخواست فالوت رو قبول کرد`, `${myProfile.nickname} accepted your follow request`)
                    })
                  }
                  toast(t('درخواست فالو قبول شد', 'Follow request accepted'))
                } else {
                  await supabase.from('follows').delete().eq('id', rowId)
                  toast(t('درخواست فالو رد شد', 'Follow request declined'))
                }
                window.location.reload()
              } catch (err) {
                toast(err.message, { error: true })
                btn.disabled = false
              }
            })
          })

          // ── دکمه‌های کپی کد دعوت ──
          app.querySelectorAll('.copy-invite-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(btn.dataset.code)
                toast(t('کد دعوت کپی شد! برای دوستت بفرست', 'Invite code copied! Send it to your friend'))
              } catch {
                // Fallback برای مرورگرهای قدیمی/بدون دسترسی کلیپ‌بورد
                prompt(t('کد را دستی کپی کن:', 'Copy the code manually:'), btn.dataset.code)
              }
            })
          })

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
              toast(t('پروفایل با موفقیت بروزرسانی شد', 'Profile updated successfully'))
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
            }
          })

          // ── تغییر رمز عبور (خود کاربر، بدون نیاز به ایمیل) ──
          const passForm = app.querySelector('#change-password-form')
          passForm?.addEventListener('submit', async (e) => {
            e.preventDefault()
            const fd = new FormData(passForm)
            const newPass = fd.get('new_password')
            const confirm = fd.get('confirm_password')
            if (newPass !== confirm) {
              toast(t('رمز جدید با تکرارش یکی نیست', 'New passwords do not match'), { error: true })
              return
            }
            const btn = passForm.querySelector('button')
            btn.disabled = true
            try {
              const { error } = await supabase.auth.updateUser({ password: newPass })
              if (error) throw error
              toast(t('رمز عبور عوض شد', 'Password changed'))
              passForm.reset()
            } catch (err) {
              toast(err.message, { error: true })
            } finally {
              btn.disabled = false
            }
          })
        } else {
          // دکمه فالو
          const followBtn = app.querySelector('#follow-action-btn')
          followBtn?.addEventListener('click', async () => {
            try {
              if (isFollowing || isPending) {
                await supabase.from('follows').delete().match({ follower_id: myProfile.id, following_id: profile.id })
                toast(t('رابطه فالو لغو شد', 'Unfollowed'))
              } else {
                // فالو فوری: بدون تأیید — اعلان new_follower خودش با تریگر دیتابیس ساخته می‌شه
                await supabase.from('follows').insert({ follower_id: myProfile.id, following_id: profile.id, status: 'accepted' })
                toast(t('حالا فالوش می‌کنی', 'Now following'))
              }
              window.location.reload()
            } catch (err) {
              toast(err.message, { error: true })
            }
          })

          // ── دکمه دعوت به بازی: مودال انتخاب لابی (Steam-like)
          // دعوت‌نامه با target_id = لابی واقعی ساخته می‌شه تا لینک اعلان درست کار کنه
          const inviteBtn = app.querySelector('#invite-lobby-btn')
          const inviteModal = app.querySelector('#invite-game-modal')
          const inviteList = app.querySelector('#invite-lobbies-list')

          async function loadMyLobbies() {
            try {
              const { data, error } = await supabase
                .from('lobby_members')
                .select('lobby_id, lobby:game_lobbies!lobby_members_lobby_id_fkey(id, game_name, status, capacity)')
                .eq('user_id', myProfile.id)
              if (error) throw error
              const lobbies = (data || []).map(r => r.lobby).filter(l => l && l.status !== 'closed')
              if (!lobbies.length) {
                inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">${t('عضو هیچ لابی بازی نیستی!<br>اول از صفحه‌ی «بازی‌ها» به یه لابی بپیوند، بعد از اینجا دوستت رو دعوت کن.', "You're not in any game lobby!<br>Join one from the Games page first, then invite friends here.")}</div>`
                return
              }
              inviteList.innerHTML = lobbies.map(l => `
                <div class="invite-user-row">
                  <b>${escapeHtml(l.game_name)}</b>
                  <button class="send-lobby-invite-btn primary" data-lobby-id="${l.id}" data-lobby-name="${escapeHtml(l.game_name)}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} ${t('دعوت', 'Invite')}</button>
                </div>
              `).join('')
              inviteList.querySelectorAll('.send-lobby-invite-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                  btn.disabled = true
                  try {
                    const { error } = await supabase.from('notifications').insert({
                      user_id: profile.id,
                      sender_id: myProfile.id,
                      type: 'lobby_invite',
                      target_id: btn.dataset.lobbyId,
                      message: t(`${myProfile.nickname} تورو به لابی «${btn.dataset.lobbyName}» دعوت کرد — بیا بازی کنیم!`, `${myProfile.nickname} invited you to the lobby "${btn.dataset.lobbyName}" — come play!`)
                    })
                    if (error) throw error
                    btn.innerHTML = `${icon('check')} ${t('دعوت شد', 'Invited')}`
                    toast(t('دعوت فرستاده شد!', 'Invite sent!'))
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

          inviteBtn?.addEventListener('click', () => {
            inviteModal.style.display = 'flex'
            loadMyLobbies()
          })
          app.querySelector('#close-invite-game-modal')?.addEventListener('click', () => { inviteModal.style.display = 'none' })
          inviteModal?.addEventListener('click', (e) => { if (e.target === inviteModal) inviteModal.style.display = 'none' })
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
