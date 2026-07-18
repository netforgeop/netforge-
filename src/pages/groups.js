import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { escapeHtml, timeAgo, toast } from '../lib/utils.js'

export default async function groupsPage() {
  return withShell('groups', async (profile) => {
    const [{ data: groups, error }, { data: myMemberships }] = await Promise.all([
      supabase.from('groups').select('*, group_members(count)').order('created_at', { ascending: false }),
      supabase.from('group_members').select('group_id').eq('user_id', profile.id)
    ])
    if (error) throw error

    const memberGroupIds = new Set((myMemberships || []).map(m => m.group_id))

    const html = `
      <div class="glass card">
        <h3>ساخت گروه جدید</h3>
        <form id="new-group-form" class="stack">
          <input name="name" placeholder="اسم گروه" required maxlength="60" />
          <textarea name="description" placeholder="توضیح کوتاه" rows="2"></textarea>
          <button class="primary" type="submit">ساخت گروه</button>
        </form>
      </div>

      <div id="groups-list">
        ${groups.length ? groups.map(g => renderGroup(g, memberGroupIds)).join('') : `<div class="empty-state">هنوز گروهی ساخته نشده.</div>`}
      </div>
    `

    return { html, mount: (app) => mountGroups(app, profile) }
  })
}

function renderGroup(g, memberIds) {
  const count = g.group_members?.[0]?.count ?? 0
  const isMember = memberIds.has(g.id)

  let actionBtn
  if (isMember) {
    actionBtn = `<a href="#/groups/${g.id}"><button class="primary">ورود به گروه</button></a>`
  } else {
    // عضویت فوری: بدون تأیید، کلیک کنی همون لحظه عضو می‌شی
    actionBtn = `<button class="join-group-btn" data-group-id="${g.id}">پیوستن</button>`
  }

  return `
    <div class="glass card row between">
      <div>
        <div class="row"><b>${escapeHtml(g.name)}</b> <span class="text-dim">· ${count} عضو</span></div>
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
          created_by: me.id
        })
        if (error) throw error
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  }

  app.querySelectorAll('.join-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        // عضویت مستقیم و فوری — دیگر مرحله‌ی تأیید وجود ندارد
        const { error } = await supabase.from('group_members').insert({
          group_id: btn.dataset.groupId, user_id: me.id
        })
        if (error && error.code === '23505') {
          window.location.reload() // از قبل عضو بود
          return
        }
        if (error) throw error
        toast('به گروه پیوستی')
        window.location.reload()
      } catch (err) {
        toast(err.message, { error: true })
        btn.disabled = false
      }
    })
  })
}
