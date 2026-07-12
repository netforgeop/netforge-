const routes = new Map()
let notFoundHandler = () => `<div class="container empty-state">صفحه پیدا نشد.</div>`

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
  const app = document.getElementById('app')
  const { path, parts } = parseHash()
  const handler = routes.get(path) || notFoundHandler
  app.innerHTML = `<div class="spinner"></div>`
  try {
    const result = await handler(parts)
    // a page can return either a plain HTML string, or { html, mount }
    // where mount(appEl) runs after the HTML is in the DOM (for event
    // listeners, realtime subscriptions, etc.)
    if (typeof result === 'string') {
      app.innerHTML = result
    } else if (result && typeof result === 'object') {
      app.innerHTML = result.html
      if (typeof result.mount === 'function') await result.mount(app)
    }
  } catch (err) {
    console.error(err)
    app.innerHTML = `<div class="container empty-state">یه چیزی خراب شد: ${err.message || err}</div>`
  }
}

export function initRouter() {
  window.addEventListener('hashchange', render)
  window.addEventListener('DOMContentLoaded', render)
  render()
}
