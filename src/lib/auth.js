import { t } from './i18n.js'
import { supabase } from './supabaseClient.js'

export async function checkInviteCode(code) {
  const { data, error } = await supabase.rpc('check_invite_code_valid', { p_code: code })
  if (error) throw error
  return !!data
}

export async function isNicknameTaken(nickname) {
  const { data, error } = await supabase.rpc('is_nickname_taken', { p_nickname: nickname })
  if (error) throw error
  return !!data
}

export async function signUp({ nickname, inviteCode, password }) {
  const valid = await checkInviteCode(inviteCode)
  if (!valid) throw new Error(t('کد دعوت نامعتبر یا منقضی‌شده است (به حروف بزرگ و کوچک حساس است — دقیقاً همان شکلی که گرفتی بنویس)', 'Invite code is invalid or expired (case-sensitive — type it exactly as given)'))

  const taken = await isNicknameTaken(nickname)
  if (taken) throw new Error(t('این نیک‌نیم قبلاً گرفته شده', 'This nickname is already taken'))

  const fakeEmail = `${nickname}-${crypto.randomUUID().slice(0, 8)}@internal.local`

  const { data: authData, error: signUpErr } = await supabase.auth.signUp({
    email: fakeEmail,
    password,
    options: { data: { nickname } }
  })
  if (signUpErr) throw signUpErr

  const { data: redeemed, error: redeemErr } = await supabase.rpc('redeem_invite_code', { p_code: inviteCode })
  if (redeemErr || !redeemed) {
    // کد بین چک اولیه و مصرف نهایی توسط شخص دیگه‌ای مصرف شده
    throw new Error(t('کد دعوت هم‌زمان توسط شخص دیگری استفاده شد. لطفاً یک کد جدید بگیرید.', 'The invite code was just used by someone else. Please get a new code.'))
  }

  return authData
}

export async function logIn({ nickname, password }) {
  const { data: email, error: emailErr } = await supabase.rpc('get_internal_email', { p_nickname: nickname })
  if (emailErr) throw emailErr
  if (!email) throw new Error(t('نیک‌نیمی با این مشخصات پیدا نشد', 'No account found with this nickname'))

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(t('نیک‌نیم یا رمز عبور اشتباه است', 'Wrong nickname or password'))
  return data
}

export async function logOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

let cachedProfile = null

export async function getMyProfile({ force = false } = {}) {
  if (cachedProfile && !force) return cachedProfile
  const session = await getSession()
  if (!session) return null
  const { data, error } = await supabase.from('users').select('*').eq('id', session.user.id).single()
  if (error) throw error
  cachedProfile = data
  return data
}

export function clearProfileCache() {
  cachedProfile = null
}

export async function requireAuth() {
  const session = await getSession()
  if (!session) {
    window.location.hash = '/login'
    return null
  }
  return session
}

export function neonClass(color) {
  switch (color) {
    case 'red': return 'neon-red'
    case 'green': return 'neon-green'
    case 'rgb-cycle': return 'neon-rgb'
    case 'vicecity': return 'neon-vicecity'
    default: return 'neon-blue'
  }
}
