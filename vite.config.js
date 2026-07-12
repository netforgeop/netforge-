import { defineConfig } from 'vite'

// نکته‌ی مهم برای GitHub Pages:
// اگه ریپو رو به آدرس username.github.io/REPO-NAME منتشر می‌کنید،
// باید base رو به '/REPO-NAME/' تغییر بدید (با اسلش اول و آخر).
// اگه ریپو خود username.github.io هست (user/organization page)، base رو '/' نگه دارید.
export default defineConfig({
  base: '/netforge-/',
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  server: {
    port: 5173
  }
})
