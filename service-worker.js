// =====================================================================
// Service Worker — کش کردن پوسته‌ی برنامه برای اجرای سریع و آفلاین.
// نکته: چون داده‌ها (کالاها/فاکتورها) روی Supabase هستند، این SW فقط
// فایل‌های ثابت برنامه را کش می‌کند، نه پاسخ‌های API را.
// =====================================================================

const CACHE_NAME = "daftar-kharid-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/search.js",
  "./js/db.js",
  "./js/ocr.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // درخواست‌های Supabase (دیتابیس/فایل/OCR) هرگز کش نشوند — همیشه شبکه
  if (url.hostname.endsWith("supabase.co")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (event.request.method === "GET" && response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
