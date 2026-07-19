import { escapeHtml, icon } from '../lib/utils.js'

// ════════════════════════════════════════════════════════════════════
//  موزیک‌پلیر سفارشی — با رنگ اکسنت کاربر (var(--gradient)/--neon) کار می‌کنه
//  و دیسک چرخنده‌ی کاور موقع پخش می‌چرخه
// ════════════════════════════════════════════════════════════════════

export function musicPlayerHtml(url, coverUrl, title) {
  return `
    <div class="nf-player" data-src="${escapeHtml(url)}">
      <audio preload="metadata" src="${escapeHtml(url)}"></audio>
      <div class="nf-player-disc">
        <div class="nf-disc-label">
          ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" onerror="this.parentElement.innerHTML='${icon('music')}'">` : icon('music')}
        </div>
      </div>
      <div class="nf-player-main">
        <div class="nf-player-title">${escapeHtml(title)}</div>
        <div class="nf-player-controls">
          <button class="nf-play-btn" type="button">${icon('play')}</button>
          <div class="nf-seek"><div class="nf-seek-fill"></div></div>
          <span class="nf-time">0:00</span>
        </div>
      </div>
    </div>
  `
}

// همه‌ی پلیرهای داخل root رو بایند می‌کنه؛ با پخش یکی، بقیه پاز می‌شن
export function bindMusicPlayers(root = document) {
  root.querySelectorAll('.nf-player').forEach(p => {
    if (p.dataset.bound) return
    p.dataset.bound = '1'
    const audio = p.querySelector('audio')
    const btn = p.querySelector('.nf-play-btn')
    const fill = p.querySelector('.nf-seek-fill')
    const seek = p.querySelector('.nf-seek')
    const timeEl = p.querySelector('.nf-time')
    const fmt = (s) => !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

    btn.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
    })
    audio.addEventListener('play', () => {
      // فقط یه پلیر همزمان
      document.querySelectorAll('.nf-player audio').forEach(o => { if (o !== audio && !o.paused) o.pause() })
      p.classList.add('playing')
      btn.innerHTML = icon('pause')
    })
    audio.addEventListener('pause', () => {
      p.classList.remove('playing')
      btn.innerHTML = icon('play')
    })
    audio.addEventListener('ended', () => {
      p.classList.remove('playing')
      btn.innerHTML = icon('play')
      audio.currentTime = 0
    })
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`
      timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`
    })
    audio.addEventListener('loadedmetadata', () => {
      timeEl.textContent = `0:00 / ${fmt(audio.duration)}`
    })
    seek.addEventListener('click', (e) => {
      const r = seek.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      if (audio.duration) audio.currentTime = ratio * audio.duration
    })
  })
}
