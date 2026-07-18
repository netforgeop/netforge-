import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { escapeHtml, timeAgo, toast, icon } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

export default async function groupsPage() {
  return withShell('groups', async (profile) => {
    const [{ data: groups, error }, { data: myMemberships }, { data: myPendingReqs }] = await Promise.all([
      supabase.from('groups').select('*, group_members(count)').order('created_at', { ascending: false }),
      supabase.from('group_members').select('group_id').eq('user_id', profile.id),
      supabase.from('group_join_requests').select('group_id').eq('user_id', profile.id).eq('status', 'pending')
    ])
    if (error) throw error

    const memberGroupIds = new Set((myMemberships || []).map(m => m.group_id))
    const pendingGroupIds = new Set((myPendingReqs || []).map(r => r.group_id))

    const html = `
      <div class="glass card">
        <h3>${t('ساخت گروه جدید', 'Create a new group')}</h3>
        <form id="new-group-form" class="stack">
          <input name="name" placeholder="${t('اسم گروه', 'Group name')}" required maxlength="60" />
          <textarea name="description" placeholder="${t('توضیح کوتاه', 'Short description')}" rows="2"></textarea>
          <select name="is_public">
            <option value="public">${t('گروه عمومی — هرکس مستقیم عضو می‌شه', 'Public group — anyone joins instantly')}</option>
            <option value="private">${t('گروه خصوصی — عضویت فقط با تأیید مدیر', 'Private group — join needs admin approval')}</option>
          </select>
          <button class="primary" type="submit">${t('ساخت گروه', 'Create group')}</button>
        </form>
      </div>

      <div id="groups-list">
        ${groups.length ? groups.map(g => renderGroup(g, memberGroupIds, pendingGroupIds)).join('') : `<div class="empty-state">${t('هنوز گروهی ساخته نشده.', 'No groups yet.')}</div>`}
      </div>
    `

    return { html, mount: (app) => mountGroups(app, profile) }
  })
}

function renderGroup(g, memberIds, pendingIds) {
  const count = g.group_members?.[0]?.count ?? 0
  const isMember = memberIds.has(g.id)
  const isPending = pendingIds.has(g.id)
  const isPrivate = g.is_public === false

  const privacyBadge = isPrivate
    ? `<span class="privacy-badge private">${icon('lock')} ${t('خصوصی', 'Private')}</span>`
    : `<span class="privacy-badge">${icon('globe')} ${t('عمومی', 'Public')}</span>`

  let actionBtn
  if (isMember) {
    actionBtn = `<a href="#/groups/${g.id}"><button class="primary">${t('ورود به گروه', 'Enter group')}</button></a>`
  } else if (isPending) {
    actionBtn = `<button disabled>${icon('clock')} ${t('در انتظار تأیید مدیر', 'Awaiting approval')}</button>`
  } else if (isPrivate) {
    // گروه خصوصی: درخواست عضویت می‌ره برای سازنده و اون تأیید می‌کنه
    actionBtn = `<button class="request-join-btn" data-group-id="${g.id}">${icon('paper-plane')} ${t('درخواست عضویت', 'Request to join')}</button>`
  } else {
    // گروه عمومی: عضویت فوری
    actionBtn = `<button class="join-group-btn" data-group-id="${g.id}">${t('پیوستن', 'Join')}</button>`
  }

  return `
    <div class="glass card row between">
      <div>
        <div class="row"><b>${escapeHtml(g.name)}</b> ${privacyBadge} <span class="text-dim">· ${count} ${t('عضو', 'members')}</span></div>
        <p class="text-dim" style="margin:6px 0 0;">${escapeHtml(g.description || '')}</p>
        <span class="text-dim" style="font-size:11px;">${timeAgo(g.created_at)}</span>
      </div>
      <div>${actionBtn}</div>
    </div>
  `
}

function mountGroups(app, me) {
  const form = app.querySelector('#new-group-form')
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(form)
      const btn = form.querySelector('button')
      btn.disabled = true
      try {
        const { error } = await supabase.from('groups').insert({
          name: fd.get('name').trim(),
          description: fd.get('description')?.trim() || null,
          is_public: fd.get('is_public') === 'public',
          created_by: me.id
        })
        if (error) throw error
        toast(t('گروه ساخته شد', 'Group created'))
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  }

  // عضویت فوری (گروه عمومی)
  app.querySelectorAll('.join-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        const { error } = await supabase.from('group_members').insert({
          group_id: btn.dataset.groupId, user_id: me.id
        })
        if (error && error.code === '23505') {
          window.location.reload() // از قبل عضو بود
          return
        }
        if (error) throw error
        toast(t('به گروه پیوستی', 'You joined the group'))
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  })

  // درخواست عضویت (گروه خصوصی) — سازنده گروه تأیید می‌کنه
  app.querySelectorAll('.request-join-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        const { error } = await supabase.from('group_join_requests').insert({
          group_id: btn.dataset.groupId, user_id: me.id, status: 'pending'
        })
        if (error) {
          // ایندکس pendingِ یکتا جلوی تکراری‌ها رو می‌گیره
          if (String(error.code) === '23505') {
            toast(t('درخواستت از قبل ثبت شده — منتظر تأیید مدیر باش', 'Already requested — please wait for approval'), { error: true })
            return
          }
          throw error
        }
        toast(t('درخواستت برای مدیر گروه فرستاده شد', 'Request sent to the group admin'))
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  })
}
