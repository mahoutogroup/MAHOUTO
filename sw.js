const CACHE_NAME = "mahoutoplus-shell-v43";
const SHARE_CACHE_NAME = "mahoutoplus-share-v1";

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
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


/* =========================================================
   ACTIVATION
========================================================= */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys.map(key => {

            /*
             * On conserve :
             * - le nouveau cache de l'application
             * - le cache temporaire des partages
             */

            if (
              key !== CACHE_NAME &&
              key !== SHARE_CACHE_NAME
            ) {
              return caches.delete(key);
            }

            return undefined;
          })
        );
      })
      .then(() => self.clients.claim())
  );
});


/* =========================================================
   NETTOYAGE DES PARTAGES TEMPORAIRES
========================================================= */

async function cleanupOldShares() {

  try {

    const cache =
      await caches.open(SHARE_CACHE_NAME);

    const requests =
      await cache.keys();

    const now =
      Date.now();

    /*
     * Les fichiers partagés restent maximum
     * 1 heure dans le téléphone.
     */

    const MAX_AGE =
      60 * 60 * 1000;

    for (const request of requests) {

      try {

        const response =
          await cache.match(request);

        if (!response) {
          continue;
        }

        const createdAt =
          response.headers.get(
            "X-MAHOUTO-CREATED-AT"
          );

        if (!createdAt) {
          continue;
        }

        const timestamp =
          Number(createdAt);

        if (
          Number.isFinite(timestamp) &&
          now - timestamp > MAX_AGE
        ) {

          await cache.delete(request);
        }

      } catch (error) {

        console.warn(
          "Erreur nettoyage partage:",
          error
        );
      }
    }

  } catch (error) {

    console.warn(
      "Impossible d'ouvrir le cache des partages:",
      error
    );
  }
}


/* =========================================================
   STOCKAGE LOCAL DU PARTAGE
========================================================= */

async function saveSharePayload(request) {

  /*
   * Le Share Target Android envoie un formulaire
   * multipart/form-data.
   */

  const formData =
    await request.formData();


  /* -------------------------------------------------------
     INFORMATIONS DU PARTAGE
  ------------------------------------------------------- */

  const title =
    formData.get("title") || "";

  const text =
    formData.get("text") || "";

  const sharedUrl =
    formData.get("url") || "";


  /* -------------------------------------------------------
     RÉCUPÉRATION DES FICHIERS
  ------------------------------------------------------- */

  /*
   * Le manifest utilise :
   *
   * "files": [{
   *   "name": "files"
   * }]
   */

  let files =
    formData.getAll("files");


  /*
   * FALLBACK
   *
   * Certains téléphones/applications peuvent utiliser
   * "file" au lieu de "files".
   */

  if (!files.length) {

    const singleFile =
      formData.get("file");

    if (
      singleFile instanceof File
    ) {

      files = [
        singleFile
      ];
    }
  }


  /*
   * On garde uniquement les objets File.
   */

  files =
    files.filter(
      item => item instanceof File
    );


  /*
   * Il faut au moins un fichier pour
   * effectuer un partage de fichier.
   */

  if (!files.length) {

    throw new Error(
      "Aucun fichier reçu par le Share Target."
    );
  }


  /* -------------------------------------------------------
     IDENTIFIANT UNIQUE
  ------------------------------------------------------- */

  const shareId =
    crypto.randomUUID();

  const createdAt =
    Date.now();


  /* -------------------------------------------------------
     CACHE
  ------------------------------------------------------- */

  const cache =
    await caches.open(
      SHARE_CACHE_NAME
    );


  /* -------------------------------------------------------
     MÉTADONNÉES
  ------------------------------------------------------- */

  const metadata = {

    id:
      shareId,

    title:
      String(title),

    text:
      String(text),

    url:
      String(sharedUrl),

    createdAt:
      createdAt,

    files:
      files.map(
        (file, index) => ({

          index:
            index,

          name:
            file.name ||
            `fichier-${index + 1}`,

          type:
            file.type ||
            "application/octet-stream",

          size:
            file.size ||
            0
        })
      )
  };


  const metadataUrl =
    `/__mahouto-share-meta/${encodeURIComponent(
      shareId
    )}`;


  await cache.put(
    metadataUrl,

    new Response(
      JSON.stringify(metadata),

      {
        headers: {
          "Content-Type":
            "application/json",

          "X-MAHOUTO-CREATED-AT":
            String(createdAt)
        }
      }
    )
  );


  /* -------------------------------------------------------
     STOCKAGE DES FICHIERS
  ------------------------------------------------------- */

  for (
    let index = 0;
    index < files.length;
    index++
  ) {

    const file =
      files[index];


    const fileUrl =
      `/__mahouto-share-file/${encodeURIComponent(
        shareId
      )}/${index}`;


    await cache.put(
      fileUrl,

      new Response(
        file,

        {
          headers: {

            "Content-Type":
              file.type ||
              "application/octet-stream",

            "X-MAHOUTO-CREATED-AT":
              String(createdAt),

            "X-MAHOUTO-FILENAME":
              encodeURIComponent(
                file.name ||
                `fichier-${index + 1}`
              )
          }
        }
      )
    );
  }


  /* -------------------------------------------------------
     NETTOYAGE
  ------------------------------------------------------- */

  await cleanupOldShares();


  return shareId;
}


/* =========================================================
   SHARE TARGET
========================================================= */

self.addEventListener(
  "fetch",
  event => {

    const url =
      new URL(
        event.request.url
      );


    /* =====================================================
       SHARE TARGET ANDROID
    ===================================================== */

    /*
     * IMPORTANT :
     *
     * Le manifest.json utilise :
     *
     * "action": "/api/share-target"
     *
     * Nous interceptons donc exactement
     * /api/share-target.
     */

    if (
      event.request.method === "POST" &&
      url.pathname === "/api/share-target"
    ) {

      event.respondWith(

        (async () => {

          try {

            /*
             * 1. Récupérer le fichier
             *    depuis le POST Android.
             */

            const shareId =
              await saveSharePayload(
                event.request
              );


            /*
             * 2. Rediriger vers share.html.
             *
             * Le fichier reste localement
             * dans le Cache Storage du téléphone.
             */

            return Response.redirect(
              `/share.html?local_share_id=${encodeURIComponent(
                shareId
              )}`,
              303
            );

          } catch (error) {

            console.error(
              "Erreur Share Target MAHOUTO+:",
              error
            );


            /*
             * En cas d'erreur, afficher
             * une page d'erreur compréhensible.
             */

            return Response.redirect(
              "/share.html?share_error=1",
              303
            );
          }

        })()
      );

      return;
    }


    /* =====================================================
       API
    ===================================================== */

    /*
     * Les requêtes API ne doivent jamais
     * être interceptées par le cache.
     */

    if (
      url.pathname.startsWith("/api/")
    ) {

      return;
    }


    /* =====================================================
       REQUÊTES GET NORMALES
    ===================================================== */

    if (
      event.request.method === "GET"
    ) {

      event.respondWith(

        caches.match(
          event.request
        )
        .then(cached => {

          /*
           * Cache d'abord.
           */

          if (cached) {
            return cached;
          }


          /*
           * Sinon réseau.
           */

          return fetch(
            event.request
          );

        })

      );
    }

  }
);
