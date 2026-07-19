import { supabase } from './supabaseClient.js'

// ────────────────────────────────────────────────────────────────────
//  آپلود رسانه روی باکت عمومی 'media' (ساخته‌شده با netforge_v6.sql)
//  خروجی: { url, mediaType('image'|'video') }
// ────────────────────────────────────────────────────────────────────

export function isVideoUrl(url) {
  return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(url || '')
}

export async function uploadMediaFile(file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const path = `uploads/${id}.${ext}`
  const { error } = await supabase.storage.from('media').upload(path, file, { cacheControl: '3600' })
  if (error) {
    if (/bucket/i.test(error.message || '')) {
      throw new Error('باکت media هنوز ساخته نشده — فایل netforge_v6.sql رو توی Supabase اجرا کن')
    }
    throw error
  }
  const { data } = supabase.storage.from('media').getPublicUrl(path)
  return { url: data.publicUrl, mediaType: file.type.startsWith('video') ? 'video' : 'image' }
}
