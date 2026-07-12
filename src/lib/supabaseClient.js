import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://udmxivzvsapuxzhtjoyy.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_6FNV3rZaMrIaL9L-aX3bRg_KxCPyZmn'

// نکته: sb_publishable_* دقیقاً جایگزین anon key قدیمیه و امنیتش هم
// دقیقاً همونه -- امن برای قرار گرفتن توی باندل استاتیک کلاینته.
// امنیت واقعی داده‌ها رو RLS روی خود Supabase تأمین می‌کنه، نه این کلید.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
})
