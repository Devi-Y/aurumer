const CACHE_NAME = "aurum-shell-v14";
const BASE = new URL(self.registration.scope).pathname;
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}daily.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icons/aurum-192.png`,
  `${BASE}icons/aurum-512.png`,
  `${BASE}icons/aurum.svg`,
  `${BASE}assets/aurum-share.png`,
  `${BASE}assets/smart-money.js`,
  `${BASE}assets/dashboard.css`,
  `${BASE}assets/dashboard.js`,
  `${BASE}assets/action-freshness.js`,
  `${BASE}assets/us-event-facts.js`,
  `${BASE}assets/hk-date-state.js`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  // 数据快照：网络优先，3.5 秒超时即回退缓存，弱网不白屏。
  if (url.pathname.endsWith("/data/live-snapshot.json") || url.pathname.endsWith("/data/daily-digest.json")) {
    event.respondWith(
      fetchWithTimeout(event.request, 3500)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // 静态壳层资源：Stale-While-Revalidate，缓存命中即瞬开，后台静默更新。
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match(`${BASE}index.html`));
      return cached || network;
    }),
  );
});
