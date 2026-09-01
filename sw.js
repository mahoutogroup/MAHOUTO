const CACHE_NAME = "mahoutoplus-shell-v39";

const APP_SHELL = [
  "/",
  "/index.html",
  "/discussions.html",
  "/messages-prives.html",
  "/dm-chat.html",
  "/chat.html",
  "/ai.html",
  "/school.html",
  "/academie-majestepresse.html",
  "/profil.html",
  "/manifest.json",
  "/config.js",
  "/theme.css",
  "/theme-toggle.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];

// INSTALL
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE_NAME) return caches.delete(k);
    })))
  );
  self.clients.claim();
});

// FETCH
self.addEventListener("fetch", event => {
  // On ne touche JAMAIS à /api/ 
  if (event.request.url.includes("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
