// ریدایرکتور پروفایل: هم پروفایل خودم و هم پروفایل بقیه از
// src/pages/publicProfile.js سرو می‌شوند (اینستاگرام-استایل).
// این فایل فقط برای حفظ ساختار مسیرها /profile -> publicProfile باقی مانده.
import publicProfilePage from './publicProfile.js'

export default async function profilePage(parts = []) {
  return publicProfilePage(parts)
}
