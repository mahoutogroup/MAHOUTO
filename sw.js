const CACHE_NAME = "mahoutoplus-shell-v40";

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

  // Partage Android / Share Target
  "/share.html",

  "/manifest.json",
  "/config.js",
  "/theme.css",
  "/theme-toggle.js",

  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];


// ======================================================
// INSTALLATION
// ======================================================

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


// ======================================================
// ACTIVATION
// ======================================================

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});


// ======================================================
// FETCH
// ======================================================

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // ----------------------------------------------------
  // 1. Ne jamais intercepter les API
  // ----------------------------------------------------

  if (url.pathname.startsWith("/api/")) {
    return;
  }


  // ----------------------------------------------------
  // 2. Seulement les requêtes GET
  // ----------------------------------------------------

  if (request.method !== "GET") {
    return;
  }


  // ----------------------------------------------------
  // 3. Navigation vers une page HTML
  // ----------------------------------------------------

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {

          // Mettre à jour le cache avec la nouvelle version
          const responseClone = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cachedResponse) => {
              return cachedResponse || caches.match("/index.html");
            });
        })
    );

    return;
  }


  // ----------------------------------------------------
  // 4. Assets : cache puis réseau
  // ----------------------------------------------------

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {

        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {

            // Ne mettre en cache que les réponses valides
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type === "basic"
            ) {
              const responseClone = networkResponse.clone();

              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }

            return networkResponse;
          });
      })
  );
});
