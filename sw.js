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

  "/share.html",

  "/manifest.json",
  "/config.js",
  "/theme.css",
  "/theme-toggle.js",

  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];


// =========================================================
// INSTALL
// =========================================================

self.addEventListener(
  "install",
  event => {

    event.waitUntil(

      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(APP_SHELL)
        )

    );

    self.skipWaiting();
  }
);


// =========================================================
// ACTIVATE
// =========================================================

self.addEventListener(
  "activate",
  event => {

    event.waitUntil(

      caches
        .keys()
        .then(keys =>

          Promise.all(

            keys.map(key => {

              if (
                key !== CACHE_NAME
              ) {

                return caches.delete(
                  key
                );

              }

            })

          )

        )

    );

    self.clients.claim();
  }
);


// =========================================================
// FETCH
// =========================================================

self.addEventListener(
  "fetch",
  event => {

    // Ne jamais mettre les API en cache
    if (
      event.request.url.includes(
        "/api/"
      )
    ) {
      return;
    }

    if (
      event.request.method !== "GET"
    ) {
      return;
    }


    event.respondWith(

      caches
        .match(event.request)
        .then(
          cached =>
            cached ||
            fetch(event.request)
        )

    );

  }
);
