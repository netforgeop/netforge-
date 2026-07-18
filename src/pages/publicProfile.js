import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { isStaff, openSanctionModal, getActiveSanctionFor, liftSanction } from '../lib/moderation.js'
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
            <h3>${icon('scale-balanced')} ابزارهای مدیریت</h3>
            ${activeSanction ? `
              <div class="row between">
                <span>وضعیت فعلی: <span class="badge danger-badge">${activeSanction.type}</span>
                  ${activeSanction.expires_at ? `تا ${new Date(activeSanction.expires_at).toLocaleString('fa-IR')}` : '(دائم)'}
                </span>
                <button class="lift-sanction-btn" data-id="${activeSanction.id}">رفع محدودیت</button>
              </div>
            ` : '<p class="text-dim">این کاربر الان محدودیتی ندارد.</p>'}
            <button class="danger" id="sanction-user-btn" style="margin-top:8px;">${icon('scale-balanced')} اعمال محدودیت جدید</button>
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
          <h3>${icon('user-gear')} مدیریت حساب ${escapeHtml(profile.nickname)}</h3>
          <p class="text-dim" style="font-size:13px;">ویرایش پروفایل، نقش، و ریست رمز عبور (چون ایمیل واقعی به حساب‌ها وصل نیست، از این‌جا می‌تونی حساب گمشده رو برگردونی).</p>
          <div class="row" style="gap:8px; margin-top:10px;">
            <button id="admin-edit-user-btn" class="primary">${icon('pen-to-square')} ویرایش پروفایل کاربر</button>
          </div>
        </div>

        <div class="modal-backdrop" id="admin-user-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>ویرایش ${escapeHtml(profile.nickname)} (ادمین)</h3>
              <button class="danger" id="close-admin-user-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="admin-user-form" class="stack">
              <label class="text-dim">نیک‌نیم (لاگین با همین انجام می‌شه)</label>
              <input name="nickname" value="${escapeHtml(profile.nickname)}" minlength="2" maxlength="24" required />

              <label class="text-dim">نقش</label>
              <select name="role">
                <option value="member" ${profile.role === 'member' ? 'selected' : ''}>عضو معمولی</option>
                <option value="moderator" ${profile.role === 'moderator' ? 'selected' : ''}>ناظم (Moderator)</option>
              </select>

              <label class="text-dim">لینک آواتار</label>
              <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" />

              <label class="text-dim">بیو</label>
              <textarea name="bio" rows="2">${escapeHtml(profile.bio || '')}</textarea>

              <label class="text-dim">استاتوس</label>
              <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

              <label class="text-dim">رمز جدید (خالی بذاری دست نمی‌خوره)</label>
              <input name="new_password" type="password" minlength="6" placeholder="حداقل ۶ کاراکتر" autocomplete="new-password" />

              <button class="primary" type="submit">${icon('floppy-disk')} ذخیره همه تغییرات</button>
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
            <h3>${icon('envelope')} دعوت دوستان</h3>
            <p class="text-dim" style="font-size:13px;">می‌خوای یکی از دوستات به نت‌فورج بیاد؟ درخواست کد دعوت بده؛ همون لحظه کد برات ساخته می‌شه (روزی یک کد).</p>
            ${hasPending
              ? '<p class="text-dim">درخواست در حال پردازش است...</p>'
              : `<button class="primary" id="request-invite-btn">${icon('ticket')} درخواست کد دعوت جدید</button>`}
            ${(myInviteReqs || []).filter(r => r.status !== 'pending').length ? `
              <div class="stack" style="margin-top:12px; gap:8px;">
                ${(myInviteReqs || []).filter(r => r.status !== 'pending').map(r => `
                  <div class="row between" style="font-size:13px; border-top:1px solid var(--glass-border); padding-top:8px;">
                    ${r.status === 'approved' && r.resulting_code ? `
                      <span>کد شما: <b class="invite-code-text" style="color:var(--neon); font-size:15px; letter-spacing:1px;">${escapeHtml(r.resulting_code.code)}</b>
                        <span class="text-dim">(${r.resulting_code.used_count}/${r.resulting_code.max_uses} استفاده)</span>
                      </span>
                      <button class="copy-invite-btn" data-code="${escapeHtml(r.resulting_code.code)}">${icon('copy')} کپی</button>
                    ` : r.status === 'rejected' ? `
                      <span class="text-dim">${icon('xmark')} درخواست ${timeAgo(r.requested_at)} رد شد</span>
                    ` : `
                      <span class="text-dim">در انتظار...</span>
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
            <h3>${icon('user-plus')} درخواست‌های فالو (${pendingFollowers.length})</h3>
            <div class="stack" style="gap:10px;">
              ${pendingFollowers.map(f => `
                <div class="row between">
                  <a href="#/profile/${f.follower_id}" class="row" style="color:inherit; text-decoration:none;">
                    <img class="avatar sm ${neonClass(f.follower?.neon_color)}" src="${escapeHtml(f.follower?.avatar_url || defaultAvatar(f.follower?.nickname))}">
                    <b>${escapeHtml(f.follower?.nickname || '')}</b>
                  </a>
                  <div class="row" style="gap:6px;">
                    <button class="follow-req-accept primary" data-id="${f.id}" style="padding:4px 14px; font-size:12px;">${icon('check')} قبول</button>
                    <button class="follow-req-decline danger" data-id="${f.id}" style="padding:4px 14px; font-size:12px;">${icon('xmark')} رد</button>
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
                <button class="edit-profile-btn" id="go-edit-btn">${icon('pen-to-square')} ویرایش پروفایل</button>
              ` : `
                <div class="row" style="gap: 8px;">
                  <button class="follow-btn ${isFollowing ? 'active' : ''}" id="follow-action-btn">
                    ${isFollowing ? 'فالو می‌کنی' : isPending ? 'درخواست داده‌ای' : 'فالو'}
                  </button>
                  <button class="invite-lobby-btn" id="invite-lobby-btn">${icon('gamepad')} دعوت به بازی</button>
                  ${reportBlockMarkup(profile.id, { targetType: 'user', targetId: profile.id })}
                </div>
              `}
            </div>
            
            <div class="profile-stats">
              <span><b>${userPosts?.length || 0}</b> پست</span>
              <span><b>${followersCount}</b> دنبال‌کننده</span>
              <span><b>${followingCount}</b> دنبال‌شونده</span>
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

        ${profile.profile_music_url ? `
          <div class="glass card music-card" style="margin-top: 20px;">
            <div class="row" style="gap:10px;">
              <span style="font-size:20px;">${icon('music')}</span>
              <div style="flex:1;">
                <div class="text-dim" style="font-size:11px;">موزیکِ پروفایل</div>
                <div style="font-weight:700;">آهنگ شخصی ${escapeHtml(profile.nickname)}</div>
              </div>
            </div>
            <audio controls src="${escapeHtml(profile.profile_music_url)}" style="width:100%; margin-top:10px;"></audio>
          </div>
        ` : ''}

        <div class="profile-posts-grid-container">
          <div class="grid-tabs">
            <button class="active">پست‌ها</button>
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
                <p>هنوز پستی نیست</p>
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
              <h3>${icon('gamepad')} دعوت ${escapeHtml(profile.nickname)} به بازی</h3>
              <button class="danger" id="close-invite-game-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <div id="invite-lobbies-list" class="stack" style="gap:4px;">
              <div class="text-dim" style="text-align:center;">در حال بارگذاری لابی‌هات...</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- مودال ویرایش فقط برای خود کاربر -->
      ${isMe ? `
        <div class="modal-backdrop" id="edit-profile-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>ویرایش پروفایل</h3>
              <button class="danger" id="close-edit-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <form id="edit-profile-form" class="stack">
              <label class="text-dim">لینک آواتار</label>
              <input name="avatar_url" value="${escapeHtml(profile.avatar_url || '')}" placeholder="لینک عکس پروفایل" />

              <label class="text-dim">بیو</label>
              <textarea name="bio" rows="3" placeholder="چند خط درباره‌ی خودت">${escapeHtml(profile.bio || '')}</textarea>

              <label class="text-dim">آهنگ پروفایل (لینک مستقیم MP3)</label>
              <input name="profile_music_url" value="${escapeHtml(profile.profile_music_url || '')}" placeholder="لینک مستقیم فایل صوتی" />

              <label class="text-dim">استاتوس / جمله‌ی کوتاه</label>
              <input name="status_text" value="${escapeHtml(profile.status_text || '')}" maxlength="80" />

              <label class="text-dim">رنگ تم (نئون)</label>
              <select name="neon_color">
                <option value="blue" ${profile.neon_color === 'blue' ? 'selected' : ''}>آبی</option>
                <option value="red" ${profile.neon_color === 'red' ? 'selected' : ''}>قرمز</option>
                <option value="green" ${profile.neon_color === 'green' ? 'selected' : ''}>سبز</option>
                <option value="rgb-cycle" ${profile.neon_color === 'rgb-cycle' ? 'selected' : ''}>RGB متحرک</option>
                <option value="vicecity" ${profile.neon_color === 'vicecity' ? 'selected' : ''}>Vice City (GTA)</option>
              </select>

              <button class="primary" type="submit">${icon('floppy-disk')} ذخیره تغییرات</button>
            </form>

            <!-- تغییر رمز عبور — چون ایمیل واقعی وصل نیست، فقط از همین‌جا -->
            <form id="change-password-form" class="stack" style="border-top:1px solid var(--glass-border); padding-top:15px; margin-top:5px;">
              <label class="text-dim">${icon('key')} تغییر رمز عبور</label>
              <input name="new_password" type="password" placeholder="رمز جدید (حداقل ۶ کاراکتر)" minlength="6" autocomplete="new-password" required />
              <input name="confirm_password" type="password" placeholder="تکرار رمز جدید" minlength="6" autocomplete="new-password" required />
              <button type="submit">${icon('key')} تغییر رمز</button>
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
              toast('محدودیت رفع شد')
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
              toast('رمز کاربر ریست شد')
            }
            toast('پروفایل کاربر بروزرسانی شد')
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
              toast('کد دعوتت همون لحظه ساخته شد')
              window.location.reload()
            } catch (err) {
              // ایندکس یونیک pending سرور هم جلوی درخواست تکراری رو می‌گیره
              const msg = String(err.message || '')
              toast(msg.includes('duplicate') ? 'یک درخواست در انتظار تأیید داری ⏳' : msg, { error: true })
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
                      message: `${myProfile.nickname} درخواست فالوت رو قبول کرد`
                    })
                  }
                  toast('درخواست فالو قبول شد')
                } else {
                  await supabase.from('follows').delete().eq('id', rowId)
                  toast('درخواست فالو رد شد')
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
                toast('کد دعوت کپی شد! برای دوستت بفرست')
              } catch {
                // Fallback برای مرورگرهای قدیمی/بدون دسترسی کلیپ‌بورد
                prompt('کد را دستی کپی کن:', btn.dataset.code)
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
              toast('پروفایل با موفقیت بروزرسانی شد')
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
              toast('رمز جدید با تکرارش یکی نیست', { error: true })
              return
            }
            const btn = passForm.querySelector('button')
            btn.disabled = true
            try {
              const { error } = await supabase.auth.updateUser({ password: newPass })
              if (error) throw error
              toast('رمز عبور عوض شد')
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
                toast('رابطه فالو لغو شد')
              } else {
                // فالو فوری: بدون تأیید — اعلان new_follower خودش با تریگر دیتابیس ساخته می‌شه
                await supabase.from('follows').insert({ follower_id: myProfile.id, following_id: profile.id, status: 'accepted' })
                toast('حالا فالوش می‌کنی')
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
                inviteList.innerHTML = `<div class="text-dim" style="text-align:center; padding:14px;">عضو هیچ لابی بازی نیستی!<br>اول از صفحه‌ی «بازی‌ها» به یه لابی بپیوند، بعد از اینجا دوستت رو دعوت کن.</div>`
                return
              }
              inviteList.innerHTML = lobbies.map(l => `
                <div class="invite-user-row">
                  <b>${escapeHtml(l.game_name)}</b>
                  <button class="send-lobby-invite-btn primary" data-lobby-id="${l.id}" data-lobby-name="${escapeHtml(l.game_name)}" style="padding:4px 14px; font-size:12px;">${icon('paper-plane')} دعوت</button>
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
                      message: `${myProfile.nickname} تورو به لابی «${btn.dataset.lobbyName}» دعوت کرد — بیا بازی کنیم!`
                    })
                    if (error) throw error
                    btn.innerHTML = `${icon('check')} دعوت شد`
                    toast('دعوت فرستاده شد!')
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
