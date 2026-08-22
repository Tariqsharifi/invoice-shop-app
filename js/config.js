// =====================================================================
// تنظیمات اتصال به Supabase
// این مقادیر را از Supabase Dashboard → Project Settings → API بردار
// SUPABASE_ANON_KEY یک کلید عمومی (anon) است و قرار دادنش در کد سمت
// کاربر مشکلی ندارد؛ چیزی که هرگز نباید اینجا بیاید Service Role Key
// یا کلید سرویس OCR است (آن‌ها فقط داخل Edge Function می‌مانند).
// =====================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // اسم Edge Function که OCR واقعی را انجام می‌دهد (بخش js/ocr.js را ببین)
  OCR_FUNCTION_NAME: "ocr-invoice",

  // اگر هنوز Edge Function را deploy نکرده‌ای، این را true بگذار تا
  // برنامه به‌جای OCR خودکار، یک جدول خالی برای ورود دستی باز کند.
  OCR_MANUAL_FALLBACK: true,
};
