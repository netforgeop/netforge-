import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, timeAgo, toast, icon, isOnlineNow } from '../lib/utils.js'
import { liftSanction, openSanctionModal, moderatedDeletePost, askModReason, logModAction } from '../lib/moderation.js'
import { previewTheme } from '../lib/appearance.js'
import { uploadMediaFile } from '../lib/mediaUpload.js'
import { t, dateLocale } from '../lib/i18n.js'

// برچسب اکشن‌های لاگ سایت (بایلینگوال)
function actionLabel(a) {
  const map = {
    delete_post: t('پست پاک کرد', 'deleted a post'),
    delete_comment: t('کامنت پاک کرد', 'deleted a comment'),
    delete_lobby_comment: t('کامنت لابی پاک کرد', 'deleted a lobby comment'),
    delete_message: t('پیام پاک کرد', 'deleted a message'),
    delete_group: t('گروه پاک کرد', 'deleted a group'),
    delete_lobby: t('لابی پاک کرد', 'deleted a lobby'),
    ban: t('بن کرد', 'banned'),
    mute: t('میوت کرد', 'muted'),
    timeout: t('تایم‌اوت داد', 'timed out'),
    warn: t('اخطار داد به', 'warned')
  }
  return map[a] || a
}

export default async function adminPage() {
  return withShell('admin', async (profile) => {
    if (profile.role !== 'admin') {
      return { html: `<div class="empty-state">${t('این بخش فقط برای ادمین قابل مشاهده‌ست.', 'This section is admins-only.')}</div>` }
    }

    const [
      { data: codes },
      { data: requests },
      { data: reports },
      { data: users },
      { data: sanctions },
      { data: modLog },
      { data: groups },
      { data: lobbies },
      { data: posts },
      { data: themes },
      { data: themeGrants }
    ] = await Promise.all([
      supabase.from('invite_codes').select('*').order('created_at', { ascending: false }),
      supabase.from('invite_requests').select('*, requester:users!invite_requests_requested_by_fkey(nickname)').eq('status', 'pending').order('requested_at'),
      supabase.from('reports').select('*, reporter:users!reports_reporter_id_fkey(nickname)').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('users').select('id, nickname, role, created_at, avatar_url, neon_color, is_online, last_seen_at, bio, status_text').order('created_at'),
      supabase.from('user_sanctions').select('*, target:users!user_sanctions_user_id_fkey(nickname)').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('mod_actions').select('*, actor:users!mod_actions_actor_id_fkey(nickname), target:users!mod_actions_target_user_id_fkey(nickname)').order('created_at', { ascending: false }).limit(50),
      supabase.from('groups').select('*, creator:users!groups_created_by_fkey(nickname), group_members(count)').order('created_at', { ascending: false }),
      supabase.from('game_lobbies').select('*, host:users!game_lobbies_host_id_fkey(nickname), lobby_members(count)').order('created_at', { ascending: false }),
      supabase.from('posts').select('*, author:users!posts_author_id_fkey(nickname)').order('created_at', { ascending: false }).limit(50),
      supabase.from('themes').select('*').order('created_at', { ascending: false }),
      supabase.from('theme_access').select('theme_id, user_id')
    ])

    const grantsByTheme = {}
    ;(themeGrants || []).forEach(g => {
      if (!grantsByTheme[g.theme_id]) grantsByTheme[g.theme_id] = []
      grantsByTheme[g.theme_id].push(g.user_id)
    })

    const html = `
      <h2>${icon('shield-halved')} ${t('پنل ادمین', 'Admin Panel')}</h2>

      <div class="admin-tabs" id="admin-tabs">
        <button data-atab="general" class="active">${icon('sliders')} ${t('مدیریت', 'General')}</button>
        <button data-atab="users">${icon('users')} ${t('کاربران', 'Users')}</button>
        <button data-atab="groups">${icon('users-rectangle')} ${t('گروه‌ها', 'Groups')}</button>
        <button data-atab="lobbies">${icon('gamepad')} ${t('بازی‌ها', 'Games')}</button>
        <button data-atab="posts">${icon('image')} ${t('پست‌ها', 'Posts')}</button>
        <button data-atab="themes">${icon('palette')} ${t('تم‌ها', 'Themes')}</button>
      </div>

      <!-- ══════ تب مدیریت روزمره ══════ -->
      <div class="admin-tab-page active" data-page="general">
        <div class="glass card">
          <h3>${t('ساخت کد دعوت', 'Create invite code')}</h3>
          <form id="new-code-form" class="row">
            <input name="code" placeholder="${t('کد (مثلاً REZA-2026)', 'Code (e.g. REZA-2026)')}" required style="flex:1;" />
            <input name="max_uses" type="number" min="1" value="1" style="width:90px;" />
            <button class="primary" type="submit">${t('بساز', 'Create')}</button>
          </form>
        </div>

        <div class="glass card">
          <h3>${t('کدهای دعوت', 'Invite codes')}</h3>
          ${codes?.length ? codes.map(c => `
            <div class="row between" style="margin-bottom:6px;">
              <span>${escapeHtml(c.code)} <span class="text-dim">(${c.used_count}/${c.max_uses})</span> ${c.is_active ? '' : `<span class="badge">${t('غیرفعال', 'inactive')}</span>`}</span>
              ${c.is_active ? `<button class="deactivate-code-btn" data-id="${c.id}">${t('غیرفعال کن', 'Deactivate')}</button>` : ''}
            </div>
          `).join('') : `<p class="text-dim">${t('هنوز کدی ساخته نشده.', 'No codes yet.')}</p>`}
        </div>

        <div class="glass card">
          <h3>${t('درخواست‌های دعوت در انتظار', 'Pending invite requests')}</h3>
          ${requests?.length ? requests.map(r => `
            <div class="row between" style="margin-bottom:6px;">
              <span>${escapeHtml(r.requester?.nickname)}</span>
              <div class="row">
                <button class="approve-invite-req-btn" data-id="${r.id}" data-user="${escapeHtml(r.requester?.nickname)}">${t('تأیید و ساخت کد', 'Approve & create code')}</button>
                <button class="reject-invite-req-btn danger" data-id="${r.id}">${t('رد', 'Reject')}</button>
              </div>
            </div>
          `).join('') : `<p class="text-dim">${t('درخواستی در انتظار نیست.', 'No pending requests.')}</p>`}
        </div>

        <div class="glass card">
          <h3>${t('گزارش‌های در انتظار بررسی', 'Pending reports')}</h3>
          ${reports?.length ? reports.map(r => `
            <div style="margin-bottom:10px;border-bottom:1px solid var(--glass-border);padding-bottom:8px;">
              <div>${t('گزارش‌دهنده:', 'Reporter:')} ${escapeHtml(r.reporter?.nickname)} · ${t('نوع:', 'Type:')} ${r.target_type} · ${timeAgo(r.created_at)}</div>
              ${r.reason ? `<div class="text-dim">${t('دلیل:', 'Reason:')} ${escapeHtml(r.reason)}</div>` : ''}
              <div class="row" style="margin-top:6px;">
                ${r.target_type === 'user' && r.target_id ? `<a href="#/profile/${r.target_id}"><button style="font-size:12px;">${t('پروفایل کاربر', 'User profile')}</button></a>` : ''}
                <button class="dismiss-report-btn" data-id="${r.id}">${t('بررسی شد', 'Dismiss')}</button>
              </div>
            </div>
          `).join('') : `<p class="text-dim">${t('گزارشی در انتظار نیست.', 'No pending reports.')}</p>`}
        </div>

        <div class="glass card">
          <h3>${icon('ban')} ${t('محدودیت‌های فعال (Ban/Mute/Timeout)', 'Active restrictions (Ban/Mute/Timeout)')}</h3>
          ${sanctions ? (sanctions.length ? sanctions.map(s => `
            <div class="row between" style="margin-bottom:8px; border-bottom:1px solid var(--glass-border); padding-bottom:8px;">
              <span>
                <b>${escapeHtml(s.target?.nickname || t('کاربر', 'User'))}</b>
                <span class="badge danger-badge">${s.type}</span>
                <span class="text-dim" style="font-size:12px;">
                  ${s.expires_at ? `${t('تا', 'until')} ${new Date(s.expires_at).toLocaleString(dateLocale())}` : t('دائم', 'permanent')}
                  ${s.reason ? ` · ${escapeHtml(s.reason)}` : ''}
                </span>
              </span>
              <button class="lift-sanction-btn" data-id="${s.id}">${t('رفع محدودیت', 'Lift')}</button>
            </div>
          `).join('') : `<p class="text-dim">${t('هیچ محدودیت فعالی نیست.', 'No active restrictions.')}</p>`)
          : `<p class="text-dim">${icon('triangle-exclamation')} ${t('جدول user_sanctions هنوز ساخته نشده؛ فایل moderation_setup.sql را در Supabase اجرا کنید.', 'user_sanctions table missing — run moderation_setup.sql in Supabase.')}</p>`}
        </div>

        <div class="glass card">
          <h3>${icon('clipboard-list')} ${t('لاگ سایت — اقدامات مدیریتی', 'Site log — moderation actions')}</h3>
          <p class="text-dim" style="font-size:12px;">${t('هر حذف/محدودیت/اخطار این‌جا ثبت می‌شه: کی، روی کی، چرا و چه زمانی.', 'Every deletion/restriction/warning is recorded: who, on whom, why, and when.')}</p>
          ${modLog === null || modLog === undefined
            ? `<p class="text-dim">${t('جدول mod_actions هنوز ساخته نشده؛ فایل netforge_v5.sql را اجرا کنید.', 'mod_actions table missing — run netforge_v5.sql.')}</p>`
            : (modLog.length ? modLog.map(m => `
              <div style="margin-bottom:10px; border-bottom:1px solid var(--glass-border); padding-bottom:8px; font-size:13px;">
                <div>
                  <b>${escapeHtml(m.actor?.nickname || '—')}</b>
                  <span>${actionLabel(m.action)}</span>
                  ${m.target?.nickname ? `<b>${escapeHtml(m.target.nickname)}</b>` : ''}
                  <span class="text-dim" style="font-size:11px;"> · ${new Date(m.created_at).toLocaleString(dateLocale())}</span>
                </div>
                ${m.reason ? `<div class="text-dim">${t('دلیل:', 'Reason:')} ${escapeHtml(m.reason)}</div>` : ''}
                ${m.snapshot ? `<div class="text-dim" style="font-size:11px; opacity:.8;">${escapeHtml(m.snapshot)}</div>` : ''}
              </div>
            `).join('') : `<p class="text-dim">${t('هنوز اقدامی ثبت نشده.', 'No actions logged yet.')}</p>`)}
        </div>
      </div>

      <!-- ══════ تب کاربران ══════ -->
      <div class="admin-tab-page" data-page="users">
        <div class="glass card">
          <h3>${icon('users')} ${t('مدیریت کاربران', 'User management')}</h3>
          <input id="admin-user-search" placeholder="${t('جستجو بین کاربران...', 'Search users...')}" style="margin-bottom:12px;" />
          <div id="admin-users-list" class="stack" style="gap:8px;">
            ${(users || []).map(u => `
              <div class="admin-user-row glass-sub" data-nick="${escapeHtml((u.nickname || '').toLowerCase())}">
                <a href="#/profile/${u.id}" class="row" style="color:inherit; text-decoration:none; gap:10px; flex:1; min-width:0;">
                  <span class="avatar-wrap" style="position:relative;">
                    <img class="avatar sm ${neonClass(u.neon_color)}" src="${escapeHtml(u.avatar_url || defaultAvatar(u.nickname))}">
                    <span class="presence-dot ${isOnlineNow(u) ? 'online' : ''}" style="position:absolute; bottom:0; left:0;"></span>
                  </span>
                  <span style="min-width:0;">
                    <b style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${escapeHtml(u.nickname)}</b>
                    <span class="text-dim" style="font-size:11px;">
                      ${isOnlineNow(u)
                        ? `<span style="color:var(--success);">${t('آنلاین', 'online')}</span>`
                        : `${t('آخرین بازدید: ', 'last seen: ')}${u.last_seen_at ? timeAgo(u.last_seen_at) : t('نامشخص', 'unknown')}`}
                    </span>
                  </span>
                  <span class="badge ${u.role === 'admin' ? 'admin' : u.role === 'moderator' ? 'mod' : ''}">${u.role}</span>
                </a>
                <div class="row admin-user-actions">
                  ${u.role !== 'admin' ? `<button class="manage-user-btn primary" data-id="${u.id}" title="${t('ویرایش کامل حساب', 'Full account edit')}">${icon('user-gear')} ${t('مدیریت', 'Manage')}</button>` : ''}
                  <button class="warn-user-btn" data-id="${u.id}" data-nick="${escapeHtml(u.nickname)}" title="${t('اخطار (پاپ‌آپ realtime)', 'Warning (realtime popup)')}">${icon('triangle-exclamation')} ${t('اخطار', 'Warn')}</button>
                  ${u.role !== 'admin' ? `<button class="restrict-user-btn danger" data-id="${u.id}" data-nick="${escapeHtml(u.nickname)}" title="${t('محدودیت', 'Restrict')}">${icon('scale-balanced')} ${t('محدودیت', 'Restrict')}</button>` : ''}
                  ${u.role === 'member' ? `<button class="promote-btn" data-id="${u.id}">${icon('arrow-up')} ${t('ناظم', 'Mod')}</button>` : ''}
                  ${u.role === 'moderator' ? `<button class="demote-btn danger" data-id="${u.id}">${icon('arrow-down')} ${t('برداشتن ناظم', 'Unmod')}</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- مودال ویرایش کامل حساب (در تب کاربران) — 닉/نقش/آواتار/بیو/استاتوس/ریست رمز -->
      <div class="modal-backdrop" id="admin-manage-modal" style="display:none;">
        <div class="glass modal">
          <div class="row between" style="margin-bottom:15px;">
            <h3 id="am-title">${icon('user-gear')} ${t('ویرایش کاربر (ادمین)', 'Edit user (admin)')}</h3>
            <button class="danger" id="close-admin-manage-modal" style="padding:4px 8px;">${icon('xmark')}</button>
          </div>
          <form id="admin-manage-form" class="stack">
            <label class="text-dim">${t('نیک‌نیم (لاگین با همین انجام می‌شه)', 'Nickname (used for login)')}</label>
            <input name="nickname" minlength="2" maxlength="24" required />

            <label class="text-dim">${t('نقش', 'Role')}</label>
            <select name="role">
              <option value="member">${t('عضو معمولی', 'Member')}</option>
              <option value="moderator">${t('ناظم (Moderator)', 'Moderator')}</option>
            </select>

            <label class="text-dim">${t('لینک آواتار', 'Avatar URL')}</label>
            <input name="avatar_url" />

            <label class="text-dim">${t('بیو', 'Bio')}</label>
            <textarea name="bio" rows="2"></textarea>

            <label class="text-dim">${t('استاتوس', 'Status')}</label>
            <input name="status_text" maxlength="80" />

            <label class="text-dim">${t('رمز جدید (خالی بذاری دست نمی‌خوره)', 'New password (leave empty to keep)')}</label>
            <input name="new_password" type="password" minlength="6" placeholder="${t('حداقل ۶ کاراکتر', 'min 6 characters')}" autocomplete="new-password" />

            <button class="primary" type="submit">${icon('floppy-disk')} ${t('ذخیره همه تغییرات', 'Save all changes')}</button>
          </form>
        </div>
      </div>

      <!-- ══════ تب گروه‌ها ══════ -->
      <div class="admin-tab-page" data-page="groups">
        <div class="glass card">
          <h3>${icon('users-rectangle')} ${t('همه‌ی گروه‌ها', 'All groups')}</h3>
          ${(groups || []).length ? groups.map(g => `
            <div class="row between" style="margin-bottom:8px; border-bottom:1px solid var(--glass-border); padding-bottom:8px;">
              <div>
                <div class="row" style="gap:6px;">
                  <b>${escapeHtml(g.name)}</b>
                  ${g.is_public === false ? `<span class="privacy-badge private">${icon('lock')} ${t('خصوصی', 'Private')}</span>` : `<span class="privacy-badge">${icon('globe')} ${t('عمومی', 'Public')}</span>`}
                </div>
                <span class="text-dim" style="font-size:12px;">
                  ${g.group_members?.[0]?.count ?? 0} ${t('عضو', 'members')} · ${t('سازنده:', 'by')} ${escapeHtml(g.creator?.nickname || '—')} · ${timeAgo(g.created_at)}
                </span>
              </div>
              <div class="row" style="gap:6px;">
                <a href="#/groups/${g.id}"><button style="font-size:12px;">${t('مشاهده', 'Open')}</button></a>
                <button class="admin-del-group-btn danger" data-id="${g.id}" data-name="${escapeHtml(g.name)}" data-creator="${g.created_by || ''}">${icon('trash')}</button>
              </div>
            </div>
          `).join('') : `<p class="text-dim">${t('گروهی نیست.', 'No groups.')}</p>`}
        </div>
      </div>

      <!-- ══════ تب بازی‌ها ══════ -->
      <div class="admin-tab-page" data-page="lobbies">
        <div class="glass card">
          <h3>${icon('gamepad')} ${t('لابی‌های بازی (عمومی)', 'Game lobbies (public)')}</h3>
          <p class="text-dim" style="font-size:12px;">${t('طبق قانون خودت، لابی‌های خصوصی برای هیچ‌کس — حتی ادمین — قابل دیدن نیست؛ فقط هاست و اعضا.', 'Per your rule, private lobbies are invisible to everyone — even admins; only host and members.')}</p>
          ${(lobbies || []).length ? lobbies.map(l => `
            <div class="row between" style="margin-bottom:8px; border-bottom:1px solid var(--glass-border); padding-bottom:8px;">
              <div>
                <div class="row" style="gap:6px;">
                  <b>${escapeHtml(l.game_name)}</b>
                  ${l.category ? `<span class="badge">${escapeHtml(l.category)}</span>` : ''}
                </div>
                <span class="text-dim" style="font-size:12px;">
                  ${l.lobby_members?.[0]?.count ?? 0}/${l.capacity} · ${t('هاست:', 'host:')} ${escapeHtml(l.host?.nickname || '—')} · ${timeAgo(l.created_at)}
                </span>
              </div>
              <div class="row" style="gap:6px;">
                <a href="#/lobbies/${l.id}"><button style="font-size:12px;">${t('مشاهده', 'Open')}</button></a>
                <button class="admin-del-lobby-btn danger" data-id="${l.id}" data-name="${escapeHtml(l.game_name)}" data-host="${l.host_id || ''}">${icon('trash')}</button>
              </div>
            </div>
          `).join('') : `<p class="text-dim">${t('لابی عمومی‌ای نیست.', 'No public lobbies.')}</p>`}
        </div>
      </div>

      <!-- ══════ تب پست‌ها ══════ -->
      <div class="admin-tab-page" data-page="posts">
        <div class="glass card">
          <h3>${icon('image')} ${t('آخرین پست‌ها', 'Latest posts')}</h3>
          <div class="stack" style="gap:10px;">
            ${(posts || []).length ? posts.map(p => `
              <div class="row between admin-post-row" data-post-id="${p.id}" data-author-id="${p.author_id}">
                <div class="row" style="gap:10px; flex:1; min-width:0;">
                  ${p.media_url
                    ? (p.media_type === 'video'
                        ? `<span class="admin-post-thumb">${icon('video')}</span>`
                        : `<img class="admin-post-thumb" src="${escapeHtml(p.media_url)}" onerror="this.outerHTML='<span class=&quot;admin-post-thumb&quot;>${icon('image')}</span>'">`)
                    : `<span class="admin-post-thumb">${icon('align-left')}</span>`}
                  <div style="min-width:0;">
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      <b>${escapeHtml(p.author?.nickname || '—')}</b>
                      ${p.is_reel ? `<span class="badge">${icon('clapperboard')} Reel</span>` : ''}
                      <span class="text-dim" style="font-size:11px;"> · ${timeAgo(p.created_at)}</span>
                    </div>
                    <div class="text-dim" style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml((p.caption || '').slice(0, 80)) || t('(بدون کپشن)', '(no caption)')}</div>
                  </div>
                </div>
                <button class="admin-del-post-btn danger" data-id="${p.id}" data-caption="${escapeHtml((p.caption || '').slice(0, 100).replace(/"/g, '&quot;'))}">${icon('trash')}</button>
              </div>
            `).join('') : `<p class="text-dim">${t('پستی نیست.', 'No posts.')}</p>`}
          </div>
        </div>
      </div>

      <!-- ══════ تب تم‌ها ══════ -->
      <div class="admin-tab-page" data-page="themes">
        <div class="glass card">
          <h3>${icon('palette')} ${t('ساخت تم جدید', 'Create a new theme')}</h3>
          <form id="new-theme-form" class="stack">
            <div class="theme-grid">
              <label class="text-dim">${t('اسم تم', 'Theme name')}</label>
              <input name="name" required maxlength="40" placeholder="${t('مثلاً شب بنفش، غروب نارنجی...', 'e.g. Purple Night, Sunset...')}" />

              <label class="text-dim">${t('رنگ اصلی (شروع گرادیان)', 'Main color (gradient start)')}</label>
              <input name="accent" type="color" value="#9333ea" />

              <label class="text-dim">${t('رنگ دوم (پایان گرادیان)', 'Second color (gradient end)')}</label>
              <input name="accent2" type="color" value="#ec4899" />

              <label class="text-dim">${t('استایل کارت‌ها', 'Card style')}</label>
              <select name="card_style">
                <option value="glass">${t('شیشه‌ای (پیش‌فرض سایت)', 'Glass (site default)')}</option>
                <option value="solid">${t('سولید (مات و یک‌دست)', 'Solid (flat, opaque)')}</option>
                <option value="transparent">${t('شفاف (پس‌زمینه دیده می‌شه)', 'Transparent (shows background)')}</option>
              </select>

              <label class="text-dim">${t('نوع پس‌زمینه', 'Background type')}</label>
              <select name="bg_type" id="theme-bg-type">
                <option value="none">${t('بدون پس‌زمینه سفارشی', 'No custom background')}</option>
                <option value="color">${t('رنگ یک‌دست', 'Solid color')}</option>
                <option value="image">${t('عکس', 'Image')}</option>
                <option value="video">${t('ویدیو', 'Video')}</option>
              </select>

              <div id="theme-bg-color-row" style="display:none;" class="stack">
                <label class="text-dim">${t('رنگ پس‌زمینه', 'Background color')}</label>
                <input name="bg_color" type="color" value="#0f0f1e" />
              </div>
              <div id="theme-bg-url-row" style="display:none;" class="stack">
                <label class="text-dim">${t('فایل یا لینک پس‌زمینه', 'Background file or URL')}</label>
                <input name="bg_file" type="file" accept="image/*,video/*" />
                <input name="bg_url" placeholder="${t('یا لینک مستقیم عکس/ویدیو...', 'or a direct image/video URL...')}" />
              </div>

              <label class="text-dim">${t('دسترسی', 'Access')}</label>
              <select name="access" id="theme-access-select">
                <option value="public">${t('همه‌ی کاربران', 'Everyone')}</option>
                <option value="selected">${t('کاربران منتخب', 'Selected users')}</option>
              </select>
            </div>
            <div id="theme-users-picker" class="theme-users-picker" style="display:none;">
              ${(users || []).map(u => `
                <label class="theme-user-chip"><input type="checkbox" name="grant_user" value="${u.id}" /> ${escapeHtml(u.nickname)}</label>
              `).join('')}
            </div>
            <div class="row" style="gap:8px;">
              <button type="button" id="theme-preview-btn">${icon('eye')} ${t('پیش‌نمایش', 'Preview')}</button>
              <button type="button" id="theme-preview-revert-btn">${icon('rotate-left')} ${t('برگردان', 'Revert')}</button>
              <button type="submit" class="primary" style="flex:1;">${icon('floppy-disk')} ${t('ساخت تم', 'Create theme')}</button>
            </div>
          </form>
        </div>

        <div class="glass card">
          <h3>${icon('swatchbook')} ${t('تم‌های ساخته‌شده', 'Created themes')}</h3>
          ${(themes || []).length ? themes.map(th => `
            <div class="glass-sub admin-theme-row" data-theme-id="${th.id}">
              <div class="row" style="gap:8px; flex:1; min-width:0; flex-wrap:wrap;">
                <span class="theme-swatch" style="background:linear-gradient(135deg, ${escapeHtml(th.accent)}, ${escapeHtml(th.accent2)});"></span>
                <b>${escapeHtml(th.name)}</b>
                <span class="badge">${({ glass: t('شیشه‌ای', 'glass'), solid: t('سولید', 'solid'), transparent: t('شفاف', 'transparent') })[th.card_style] || th.card_style}</span>
                ${th.bg_type !== 'none' ? `<span class="badge">${({ color: t('بک رنگی', 'color bg'), image: t('بک عکس', 'image bg'), video: t('بک ویدیو', 'video bg') })[th.bg_type] || ''}</span>` : ''}
                <span class="badge ${th.is_public ? '' : 'private'}">${th.is_public ? t('دسترسی: همه', 'access: everyone') : t(`دسترسی: ${(grantsByTheme[th.id] || []).length} نفر`, `access: ${(grantsByTheme[th.id] || []).length} users`)}</span>
              </div>
              <div class="row" style="gap:6px;">
                <button class="theme-row-preview-btn" data-theme='${escapeHtml(JSON.stringify({ accent: th.accent, accent2: th.accent2, card_style: th.card_style, bg_type: th.bg_type, bg_value: th.bg_value }))}'>${icon('eye')}</button>
                <button class="theme-row-access-btn" data-id="${th.id}">${icon('user-lock')} ${t('دسترسی', 'Access')}</button>
                <button class="theme-row-delete-btn danger" data-id="${th.id}">${icon('trash')}</button>
              </div>
            </div>
          `).join('') : `<p class="text-dim">${t('هنوز تمی ساخته نشده.', 'No themes yet.')}</p>`}
        </div>

        <!-- مودال ویرایش دسترسی تم -->
        <div class="modal-backdrop" id="theme-access-modal" style="display:none;">
          <div class="glass modal">
            <div class="row between" style="margin-bottom:15px;">
              <h3>${icon('user-lock')} ${t('دسترسی به تم', 'Theme access')}</h3>
              <button class="danger" id="close-theme-access-modal" style="padding:4px 8px;">${icon('xmark')}</button>
            </div>
            <select id="access-modal-mode" style="margin-bottom:10px;">
              <option value="public">${t('همه‌ی کاربران', 'Everyone')}</option>
              <option value="selected">${t('کاربران منتخب', 'Selected users')}</option>
            </select>
            <div id="access-modal-users" class="theme-users-picker">
              ${(users || []).map(u => `
                <label class="theme-user-chip"><input type="checkbox" value="${u.id}" /> ${escapeHtml(u.nickname)}</label>
              `).join('')}
            </div>
            <button class="primary" id="access-modal-save" style="width:100%; margin-top:12px;">${icon('floppy-disk')} ${t('ذخیره دسترسی', 'Save access')}</button>
          </div>
        </div>
      </div>
    `

    return { html, mount: (app) => mountAdmin(app, profile, users || [], grantsByTheme) }
  })
}

function mountAdmin(app, profile, users, grantsByTheme) {
  // ── ورقه‌بندی تب‌ها ──
  const tabsWrap = app.querySelector('#admin-tabs')
  tabsWrap?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-atab]')
    if (!btn) return
    tabsWrap.querySelectorAll('[data-atab]').forEach(b => b.classList.toggle('active', b === btn))
    app.querySelectorAll('.admin-tab-page').forEach(p => p.classList.toggle('active', p.dataset.page === btn.dataset.atab))
  })

  // ── تب مدیریت: کد دعوت ──
  const newCodeForm = app.querySelector('#new-code-form')
  if (newCodeForm) {
    newCodeForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      try {
        const { data: session } = await supabase.auth.getSession()
        const { error } = await supabase.from('invite_codes').insert({
          code: fd.get('code').trim(),
          max_uses: Number(fd.get('max_uses')) || 1,
          created_by: session.session.user.id
        })
        if (error) throw error
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  }

  app.querySelectorAll('.deactivate-code-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('invite_codes').update({ is_active: false }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.approve-invite-req-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const newCode = `${btn.dataset.user.replace(/\s+/g, '').slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        const { data: codeRow, error: codeErr } = await supabase.from('invite_codes').insert({
          code: newCode, max_uses: 1, created_by: session.session.user.id
        }).select().single()
        if (codeErr) throw codeErr
        const { error } = await supabase.from('invite_requests').update({
          status: 'approved', resulting_invite_code_id: codeRow.id, reviewed_by: session.session.user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id)
        if (error) throw error
        toast(t(`کد ساخته شد: ${newCode}`, `Code created: ${newCode}`))
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.reject-invite-req-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('invite_requests').update({ status: 'rejected' }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.dismiss-report-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await supabase.from('reports').update({ status: 'reviewed' }).eq('id', btn.dataset.id)
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.lift-sanction-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await liftSanction(btn.dataset.id, profile)
        toast(t('محدودیت رفع شد', 'Restriction lifted'))
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ── تب کاربران: جستجو + اخطار + محدودیت + نقش ──
  const search = app.querySelector('#admin-user-search')
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase()
    app.querySelectorAll('.admin-user-row').forEach(row => {
      row.style.display = !q || row.dataset.nick.includes(q) ? '' : 'none'
    })
  })

  // اخطار: پاپ‌آپ realtime روی صفحه‌ی کاربر (+ لاگ سایت)
  app.querySelectorAll('.warn-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = document.createElement('div')
      wrap.className = 'modal-backdrop'
      wrap.innerHTML = `
        <div class="glass modal">
          <h3>${icon('triangle-exclamation')} ${t(`اخطار به ${btn.dataset.nick}`, `Warn ${btn.dataset.nick}`)}</h3>
          <p class="text-dim" style="font-size:12px;">${t('اگه آنلاین باشه همون لحظه روش پاپ‌آپ می‌شه؛ اگه نباشه اولین باری که بیاد تو می‌بینه. توی لاگ سایت هم ثبت می‌شه.', 'If online, it pops up instantly; otherwise they see it on next visit. Logged in the site log.')}</p>
          <textarea id="warn-text" rows="3" placeholder="${t('متن اخطار...', 'Warning message...')}" style="width:100%;"></textarea>
          <button class="primary" id="warn-send" style="width:100%; margin-top:10px;">${icon('paper-plane')} ${t('ارسال اخطار', 'Send warning')}</button>
        </div>
      `
      document.body.appendChild(wrap)
      wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove() })
      wrap.querySelector('#warn-send').addEventListener('click', async () => {
        const text = wrap.querySelector('#warn-text').value.trim()
        if (!text) { toast(t('متن اخطار رو بنویس', 'Write the warning text'), { error: true }); return }
        const sendBtn = wrap.querySelector('#warn-send')
        sendBtn.disabled = true
        try {
          const { error } = await supabase.from('notifications').insert({
            user_id: btn.dataset.id,
            sender_id: profile.id,
            type: 'warning',
            message: text
          })
          if (error) throw error
          await logModAction(profile, {
            action: 'warn', targetType: 'user', targetId: btn.dataset.id,
            targetUserId: btn.dataset.id, reason: text, snapshot: null
          })
          toast(t(`اخطار برای ${btn.dataset.nick} فرستاده شد`, `Warning sent to ${btn.dataset.nick}`))
          wrap.remove()
        } catch (err) {
          toast(err.message, { error: true })
          sendBtn.disabled = false
        }
      })
    })
  })

  // محدودیت (با همان مودال استاندارد — دلیل اجباری)
  app.querySelectorAll('.restrict-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openSanctionModal(profile, { id: btn.dataset.id, nickname: btn.dataset.nick }, () => window.location.reload())
    })
  })

  // ── مدیریت کامل حساب از داخل تب کاربران ──
  const usersById = new Map(users.map(u => [u.id, u]))
  const manageModal = app.querySelector('#admin-manage-modal')
  const manageForm = app.querySelector('#admin-manage-form')
  let manageTarget = null

  app.querySelectorAll('.manage-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = usersById.get(btn.dataset.id)
      if (!u) return
      manageTarget = u
      manageModal.querySelector('#am-title').innerHTML = `${icon('user-gear')} ${t(`ویرایش ${escapeHtml(u.nickname)} (ادمین)`, `Edit ${escapeHtml(u.nickname)} (admin)`)}`
      manageForm.elements.nickname.value = u.nickname || ''
      manageForm.elements.role.value = u.role === 'moderator' ? 'moderator' : 'member'
      manageForm.elements.avatar_url.value = u.avatar_url || ''
      manageForm.elements.bio.value = u.bio || ''
      manageForm.elements.status_text.value = u.status_text || ''
      manageForm.elements.new_password.value = ''
      manageModal.style.display = 'flex'
    })
  })
  app.querySelector('#close-admin-manage-modal')?.addEventListener('click', () => { manageModal.style.display = 'none' })
  manageModal?.addEventListener('click', (e) => { if (e.target === manageModal) manageModal.style.display = 'none' })

  manageForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!manageTarget) return
    const fd = new FormData(manageForm)
    const btn = manageForm.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      // ۱) نیک‌نیم (با سینک لاگین)
      const newNick = fd.get('nickname')?.trim()
      if (newNick && newNick !== manageTarget.nickname) {
        const { error } = await supabase.rpc('admin_update_nickname', { p_user_id: manageTarget.id, p_new_nickname: newNick })
        if (error) throw error
      }
      // ۲) فیلدهای پروفایل و نقش
      const { error } = await supabase.from('users').update({
        role: fd.get('role'),
        avatar_url: fd.get('avatar_url')?.trim() || null,
        bio: fd.get('bio')?.trim() || null,
        status_text: fd.get('status_text')?.trim() || null
      }).eq('id', manageTarget.id)
      if (error) throw error
      // ۳) ریست رمز (اختیاری)
      const newPass = fd.get('new_password')?.trim()
      if (newPass) {
        const { error } = await supabase.rpc('admin_reset_password', { p_user_id: manageTarget.id, p_new_password: newPass })
        if (error) throw error
        toast(t('رمز کاربر ریست شد', 'Password reset'))
      }
      toast(t('حساب کاربر بروزرسانی شد', 'User account updated'))
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })

  app.querySelectorAll('.promote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const { error } = await supabase.rpc('promote_to_moderator', { p_user_id: btn.dataset.id })
        if (error) throw error
        toast(t('ناظم شد', 'Promoted to Moderator'))
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  app.querySelectorAll('.demote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('نقش ناظم این کاربر گرفته بشه؟', "Remove this user's Moderator role?"))) return
      try {
        const { error } = await supabase.rpc('demote_from_moderator', { p_user_id: btn.dataset.id })
        if (error) throw error
        toast(t('ناظمی گرفته شد', 'Moderator role removed'))
        window.location.reload()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ── تب گروه‌ها: حذف با دلیل ──
  app.querySelectorAll('.admin-del-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = askModReason(t(`حذف گروه «${btn.dataset.name}»`, `deleting group "${btn.dataset.name}"`))
      if (!reason) return
      try {
        const { error } = await supabase.rpc('delete_group', { p_group_id: btn.dataset.id })
        if (error) throw error
        await logModAction(profile, {
          action: 'delete_group', targetType: 'group', targetId: btn.dataset.id,
          targetUserId: btn.dataset.creator || null, reason, snapshot: btn.dataset.name
        })
        toast(t('گروه حذف شد', 'Group deleted'))
        btn.closest('.row.between')?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ── تب بازی‌ها: حذف با دلیل ──
  app.querySelectorAll('.admin-del-lobby-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = askModReason(t(`حذف لابی «${btn.dataset.name}»`, `deleting lobby "${btn.dataset.name}"`))
      if (!reason) return
      try {
        const { error } = await supabase.rpc('delete_lobby', { p_lobby_id: btn.dataset.id })
        if (error) throw error
        await logModAction(profile, {
          action: 'delete_lobby', targetType: 'lobby', targetId: btn.dataset.id,
          targetUserId: btn.dataset.host || null, reason, snapshot: btn.dataset.name
        })
        toast(t('لابی حذف شد', 'Lobby deleted'))
        btn.closest('.row.between')?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ── تب پست‌ها: حذف با دلیل ──
  app.querySelectorAll('.admin-del-post-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.admin-post-row')
      const mine = row?.dataset.authorId === profile.id
      try {
        if (mine) {
          if (!confirm(t('پست خودت حذف بشه؟', 'Delete your own post?'))) return
          await supabase.from('posts').delete().eq('id', btn.dataset.id)
        } else {
          const reason = askModReason(t('حذف این پست', 'deleting this post'))
          if (!reason) return
          await moderatedDeletePost(profile, { id: btn.dataset.id, author_id: row?.dataset.authorId, caption: btn.dataset.caption || '' }, reason)
        }
        toast(t('پست حذف شد', 'Post deleted'))
        row?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ── تب تم‌ها ──
  const bgType = app.querySelector('#theme-bg-type')
  const bgColorRow = app.querySelector('#theme-bg-color-row')
  const bgUrlRow = app.querySelector('#theme-bg-url-row')
  const accessSelect = app.querySelector('#theme-access-select')
  const usersPicker = app.querySelector('#theme-users-picker')

  bgType?.addEventListener('change', () => {
    bgColorRow.style.display = bgType.value === 'color' ? '' : 'none'
    bgUrlRow.style.display = (bgType.value === 'image' || bgType.value === 'video') ? '' : 'none'
  })
  accessSelect?.addEventListener('change', () => {
    usersPicker.style.display = accessSelect.value === 'selected' ? '' : 'none'
  })

  const themeForm = app.querySelector('#new-theme-form')
  const draftTheme = () => {
    const fd = new FormData(themeForm)
    return {
      name: fd.get('name')?.trim(),
      accent: fd.get('accent'),
      accent2: fd.get('accent2'),
      card_style: fd.get('card_style'),
      bg_type: fd.get('bg_type'),
      bg_value: fd.get('bg_type') === 'color' ? fd.get('bg_color') : (fd.get('bg_url')?.trim() || null)
    }
  }

  app.querySelector('#theme-preview-btn')?.addEventListener('click', () => {
    previewTheme(draftTheme())
    toast(t('پیش‌نمایش اعمال شد — برگشت: رفرش یا دکمه‌ی «برگردان»', 'Preview applied — revert with refresh or the Revert button'))
  })
  app.querySelector('#theme-preview-revert-btn')?.addEventListener('click', () => window.location.reload())

  themeForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(themeForm)
    const draft = draftTheme()
    const access = fd.get('access')
    const file = fd.get('bg_file')
    const btn = themeForm.querySelector('button[type="submit"]')
    btn.disabled = true
    try {
      if ((draft.bg_type === 'image' || draft.bg_type === 'video') && file && file.size) {
        toast(t('در حال آپلود پس‌زمینه...', 'Uploading background...'))
        draft.bg_value = (await uploadMediaFile(file)).url
      }
      const { data: themeRow, error } = await supabase.from('themes').insert({
        name: draft.name,
        created_by: profile.id,
        accent: draft.accent,
        accent2: draft.accent2,
        card_style: draft.card_style,
        bg_type: draft.bg_type,
        bg_value: draft.bg_value,
        is_public: access === 'public'
      }).select().single()
      if (error) throw error

      if (access === 'selected') {
        const ids = fd.getAll('grant_user')
        if (ids.length) {
          const { error: gErr } = await supabase.from('theme_access').insert(ids.map(uid => ({ theme_id: themeRow.id, user_id: uid })))
          if (gErr) throw gErr
        }
      }
      toast(t('تم ساخته شد', 'Theme created'))
      window.location.reload()
    } catch (err) {
      toast(err.message, { error: true })
      btn.disabled = false
    }
  })

  // پیش‌نمایش تم‌های موجود
  app.querySelectorAll('.theme-row-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        previewTheme(JSON.parse(btn.dataset.theme))
        toast(t('پیش‌نمایش اعمال شد — برگشت با رفرش صفحه', 'Preview applied — refresh to revert'))
      } catch { /* ignore */ }
    })
  })

  // حذف تم
  app.querySelectorAll('.theme-row-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('این تم برای همیشه حذف بشه؟', 'Delete this theme permanently?'))) return
      try {
        await supabase.from('theme_access').delete().eq('theme_id', btn.dataset.id)
        const { error } = await supabase.from('themes').delete().eq('id', btn.dataset.id)
        if (error) throw error
        toast(t('تم حذف شد', 'Theme deleted'))
        btn.closest('.admin-theme-row')?.remove()
      } catch (err) { toast(err.message, { error: true }) }
    })
  })

  // ویرایش دسترسی
  const accessModal = app.querySelector('#theme-access-modal')
  let accessThemeId = null
  app.querySelectorAll('.theme-row-access-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      accessThemeId = btn.dataset.id
      const row = btn.closest('.admin-theme-row')
      const isPublic = !row.querySelector('.badge.private')
      accessModal.querySelector('#access-modal-mode').value = isPublic ? 'public' : 'selected'
      const granted = new Set(grantsByTheme[accessThemeId] || [])
      accessModal.querySelectorAll('#access-modal-users input[type="checkbox"]').forEach(cb => { cb.checked = granted.has(cb.value) })
      accessModal.style.display = 'flex'
    })
  })
  app.querySelector('#close-theme-access-modal')?.addEventListener('click', () => { accessModal.style.display = 'none' })
  accessModal?.addEventListener('click', (e) => { if (e.target === accessModal) accessModal.style.display = 'none' })
  app.querySelector('#access-modal-save')?.addEventListener('click', async () => {
    if (!accessThemeId) return
    const mode = accessModal.querySelector('#access-modal-mode').value
    try {
      await supabase.from('themes').update({ is_public: mode === 'public' }).eq('id', accessThemeId)
      await supabase.from('theme_access').delete().eq('theme_id', accessThemeId)
      if (mode === 'selected') {
        const ids = [...accessModal.querySelectorAll('#access-modal-users input[type="checkbox"]:checked')].map(cb => cb.value)
        if (ids.length) {
          const { error } = await supabase.from('theme_access').insert(ids.map(uid => ({ theme_id: accessThemeId, user_id: uid })))
          if (error) throw error
        }
      }
      toast(t('دسترسی ذخیره شد', 'Access saved'))
      window.location.reload()
    } catch (err) { toast(err.message, { error: true }) }
  })
}
