const routes = new Map()
let notFoundHandler = () => `<div class="container empty-state">صفحه پیدا نشد.</div>`
let renderToken = 0

export function route(path, handler) {
  routes.set(path, handler)
}

export function setNotFound(handler) {
  notFoundHandler = handler
}

export function navigate(path) {
  window.location.hash = path
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, '') || '/login'
  const [path, ...rest] = hash.split('/').filter(Boolean)
  return { path: '/' + (path || ''), parts: rest }
}

async function render() {
  // هر رندر یه توکن یکتا می‌گیره؛ اگه تا وقتی handler برگرده ناوبری
  // دیگه‌ای اتفاق افتاده باشه (توکن عوض شده)، این نتیجه دور ریخته می‌شه
  // تا رندرهای قدیمی‌تر DOM/سابسکریپشن‌های جدیدتر رو خراب نکنن.
  const myToken = ++renderToken
  const app = document.getElementById('app')
  const { path, parts } = parseHash()
  const handler = routes.get(path) || notFoundHandler
  app.innerHTML = `<div class="spinner"></div>`
  try {
    const result = await handler(parts)
    if (myToken !== renderToken) return
    if (typeof result === 'string') {
      app.innerHTML = result
    } else if (result && typeof result === 'object') {
      app.innerHTML = result.html
      if (typeof result.mount === 'function') {
        // اگه چیزی توی مرحله‌ی mount (وصل کردن event listener ها) خطا بده،
        // نباید کل صفحه‌ای که با موفقیت رندر شده رو با صفحه‌ی خطا پاک کنیم.
        // فقط لاگ می‌کنیم؛ محتوا سر جاش می‌مونه، فقط شاید یه دکمه کار نکنه.
        try {
          await result.mount(app)
        } catch (mountErr) {
          console.error('mount error (content stays visible):', mountErr)
        }
      }
    }
  } catch (err) {
    if (myToken !== renderToken) return
    console.error(err)
    app.innerHTML = `<div class="container empty-state">یه چیزی خراب شد: ${err.message || err}</div>`
  }
}

export function initRouter() {
  window.addEventListener('hashchange', render)
  render()
}
