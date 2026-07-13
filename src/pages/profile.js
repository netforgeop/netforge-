import { withShell } from '../lib/shell.js'
import { supabase } from '../lib/supabaseClient.js'
import { clearProfileCache, neonClass } from '../lib/auth.js'
import { defaultAvatar } from '../components/navbar.js'
import { escapeHtml, toast } from '../lib/utils.js'

export default async function profilePage() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { html: `<div class="empty-state">Please login first</div>` }

  // ریدایرکت مستقیم به مسیر پروفایل اختصاصی با آی‌دی کاربر
  window.location.hash = `#/profile/${user.id}`
  return { html: `<div class="spinner"></div>` }
}
