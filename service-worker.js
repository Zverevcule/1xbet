const CACHE_NAME = "video-app-cache-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return Promise.allSettled(
          ASSETS.map((asset) => cache.add(asset).catch(() => {
            console.warn(`فشل كاش: ${asset}`);
          }))
        );
      })
      .catch((err) => console.error("خطأ في التثبيت:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log(`حذف كاش قديم: ${k}`);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // تخطي الطلبات غير HTTP(S)
  if (!event.request.url.startsWith("http")) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) {
          return cached;
        }
        
        return fetch(event.request)
          .then((response) => {
            // تخزين مؤقت للاستجابات الناجحة فقط
            if (!response || response.status !== 200 || response.type !== "basic") {
              return response;
            }
            
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseClone);
              })
              .catch(() => {
                // تجاهل أخطاء الكاش
              });
            
            return response;
          })
          .catch((err) => {
            console.warn("خطأ في الجلب:", err);
            // عودة خطأ أو صفحة بديلة
            return caches.match("./index.html");
          });
      })
  );
});
