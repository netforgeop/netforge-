import { signUp, logIn, getSession } from '../lib/auth.js'
import { toast } from '../lib/utils.js'

export default async function loginPage() {
  const session = await getSession()
  if (session) {
    window.location.hash = '/feed'
    return { html: `<div class="spinner"></div>` }
  }

  const html = `
    <div class="container" style="max-width:420px; padding-top:60px;">
      <div class="glass" style="padding:32px;">
        <h1 style="text-align:center;">محفل</h1>
        <p class="text-dim" style="text-align:center; margin-bottom:24px;">
          یه فضای خصوصی، فقط با دعوت.
        </p>

        <div class="tabs" style="margin-bottom:20px; justify-content:center;">
          <button data-mode="login" class="active">ورود</button>
          <button data-mode="signup">ثبت‌نام با کد دعوت</button>
        </div>

        <form id="login-form" class="stack">
          <input name="nickname" placeholder="نیک‌نیم" required autocomplete="username" />
          <input name="password" type="password" placeholder="رمز عبور" required autocomplete="current-password" />
          <button class="primary" type="submit">ورود</button>
        </form>

        <form id="signup-form" class="stack" style="display:none;">
          <input name="inviteCode" placeholder="کد دعوت" required />
          <input name="nickname" placeholder="نیک‌نیم (یکتا)" required minlength="2" maxlength="24" />
          <input name="password" type="password" placeholder="رمز عبور (حداقل ۶ کاراکتر)" required minlength="6" />
          <button class="primary" type="submit">ساخت حساب</button>
        </form>
      </div>
    </div>
  `

  function mount(app) {
    const loginTab = app.querySelector('[data-mode="login"]')
    const signupTab = app.querySelector('[data-mode="signup"]')
    const loginForm = app.querySelector('#login-form')
    const signupForm = app.querySelector('#signup-form')

    loginTab.addEventListener('click', () => {
      loginTab.classList.add('active'); signupTab.classList.remove('active')
      loginForm.style.display = ''; signupForm.style.display = 'none'
    })
    signupTab.addEventListener('click', () => {
      signupTab.classList.add('active'); loginTab.classList.remove('active')
      signupForm.style.display = ''; loginForm.style.display = 'none'
    })

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = loginForm.querySelector('button')
      btn.disabled = true
      const fd = new FormData(loginForm)
      try {
        await logIn({ nickname: fd.get('nickname').trim(), password: fd.get('password') })
        window.location.hash = '/feed'
      } catch (err) {
        toast(err.message, { error: true })
      } finally {
        btn.disabled = false
      }
    })

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = signupForm.querySelector('button')
      btn.disabled = true
      const fd = new FormData(signupForm)
      try {
        await signUp({
          inviteCode: fd.get('inviteCode').trim(),
          nickname: fd.get('nickname').trim(),
          password: fd.get('password')
        })
        window.location.hash = '/feed'
      } catch (err) {
        toast(err.message, { error: true })
      } finally {
        btn.disabled = false
      }
    })
  }

  return { html, mount }
}
