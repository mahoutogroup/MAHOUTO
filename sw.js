const CACHE_NAME = "mahoutoplus-shell-v41";

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

/* =========================================================
   INSTALLATION
   ========================================================= */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    })
  );

  self.skipWaiting();
});


/* =========================================================
   ACTIVATION
   ========================================================= */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }

          return undefined;
        })
      );
    })
  );

  self.clients.claim();
});


/* =========================================================
   SHARE TARGET
   ========================================================= */

/*
 * Android envoie le fichier ici :
 *
 *      /share-target
 *
 * Le Service Worker intercepte cette requête POST.
 *
 * Il récupère le FormData puis le transmet à :
 *
 *      /api/share-target
 *
 * L'API s'occupe ensuite de :
 *
 *      1. récupérer le fichier
 *      2. l'envoyer vers Cloudinary
 *      3. créer share_pending
 *      4. rediriger vers /share.html?id=...
 */

async function handleShareTarget(request) {
  try {
    console.log("[MAHOUTO+] Share Target reçu");

    const formData = await request.formData();

    /*
     * Vérification simple :
     * Android devrait normalement envoyer le fichier
     * dans le champ "files".
     */

    let hasFile = false;

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        hasFile = true;

        console.log(
          "[MAHOUTO+] Fichier reçu :",
          key,
          value.name,
          value.type,
          value.size
        );
      }
    }

    if (!hasFile) {
      console.warn(
        "[MAHOUTO+] Aucun fichier détecté dans le partage."
      );
    }

    /*
     * Transfert vers notre API Vercel.
     *
     * On recrée une requête multipart/form-data.
     *
     * IMPORTANT :
     * Ne pas définir manuellement le header
     * Content-Type.
     *
     * Le navigateur ajoutera automatiquement
     * le boundary multipart.
     */

    const response = await fetch("/api/share-target", {
      method: "POST",
      body: formData,
      credentials: "include",
      redirect: "follow"
    });

    console.log(
      "[MAHOUTO+] Réponse API Share Target :",
      response.status,
      response.url
    );

    return response;

  } catch (error) {
    console.error(
      "[MAHOUTO+] Erreur Share Target :",
      error
    );

    /*
     * En cas d'erreur, on renvoie l'utilisateur
     * vers la page de partage avec un message.
     */

    return Response.redirect(
      "/share.html?error=share_failed",
      303
    );
  }
}


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);


  /* -------------------------------------------------------
     1. SHARE TARGET ANDROID
     ------------------------------------------------------- */

  if (
    url.pathname === "/share-target" &&
    request.method === "POST"
  ) {
    event.respondWith(
      handleShareTarget(request)
    );

    return;
  }


  /* -------------------------------------------------------
     2. API
     ------------------------------------------------------- */

  /*
   * Les API ne doivent jamais être servies depuis
   * le cache du Service Worker.
   */

  if (url.pathname.startsWith("/api/")) {
    return;
  }


  /* -------------------------------------------------------
     3. Seules les requêtes GET sont mises en cache
     ------------------------------------------------------- */

  if (request.method !== "GET") {
    return;
  }


  /* -------------------------------------------------------
     4. App Shell : cache-first
     ------------------------------------------------------- */

  event.respondWith(
    caches.match(request).then(cachedResponse => {

      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then(networkResponse => {

        /*
         * On ne met en cache que les réponses valides.
         */

        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === "basic"
        ) {
          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }

        return networkResponse;
      });

    })
  );
});
