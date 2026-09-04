const CACHE_NAME = "mahoutoplus-shell-v42";
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

/* ---------------------------------------------------------
   INSTALLATION
--------------------------------------------------------- */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ---------------------------------------------------------
   ACTIVATION
--------------------------------------------------------- */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (
            key !== CACHE_NAME &&
            key !== SHARE_CACHE_NAME
          ) {
            return caches.delete(key);
          }
          return undefined;
        })
      );
    }).then(() => self.clients.claim())
  );
});

/* ---------------------------------------------------------
   NETTOYAGE DES PARTAGES TEMPORAIRES
--------------------------------------------------------- */

async function cleanupOldShares() {
  const cache = await caches.open(SHARE_CACHE_NAME);
  const requests = await cache.keys();

  const now = Date.now();
  const MAX_AGE = 60 * 60 * 1000; // 1 heure

  for (const request of requests) {
    try {
      const response = await cache.match(request);

      if (!response) continue;

      const createdAt = response.headers.get("X-MAHOUTO-CREATED-AT");

      if (createdAt) {
        const age = now - Number(createdAt);

        if (age > MAX_AGE) {
          await cache.delete(request);
        }
      }
    } catch (error) {
      console.warn("Nettoyage share impossible:", error);
    }
  }
}

/* ---------------------------------------------------------
   STOCKAGE LOCAL DU PARTAGE
--------------------------------------------------------- */

async function saveSharePayload(request) {
  const formData = await request.formData();

  const title = formData.get("title") || "";
  const text = formData.get("text") || "";
  const sharedUrl = formData.get("url") || "";

  /*
   * Le nom "files" correspond au manifest.json :
   *
   * "files": [{
   *   "name": "files",
   *   ...
   * }]
   */

  let files = formData.getAll("files");

  /*
   * Sécurité/fallback :
   * certains environnements peuvent utiliser "file".
   */

  if (!files.length) {
    const singleFile = formData.get("file");

    if (singleFile instanceof File) {
      files = [singleFile];
    }
  }

  /*
   * On garde uniquement les vrais fichiers.
   */

  files = files.filter(item => item instanceof File);

  if (!files.length) {
    /*
     * Même sans fichier, on peut recevoir
     * un texte ou un lien.
     */
    files = [];
  }

  const shareId = crypto.randomUUID();
  const createdAt = Date.now();

  const cache = await caches.open(SHARE_CACHE_NAME);

  /* -------------------------------------------------------
     MÉTADONNÉES
  ------------------------------------------------------- */

  const metadata = {
    id: shareId,
    title: title,
    text: text,
    url: sharedUrl,
    createdAt: createdAt,
    files: files.map((file, index) => ({
      index: index,
      name: file.name || `fichier-${index + 1}`,
      type: file.type || "application/octet-stream",
      size: file.size || 0
    }))
  };

  const metadataUrl =
    `/__mahouto-share-meta/${encodeURIComponent(shareId)}`;

  await cache.put(
    metadataUrl,
    new Response(
      JSON.stringify(metadata),
      {
        headers: {
          "Content-Type": "application/json",
          "X-MAHOUTO-CREATED-AT": String(createdAt)
        }
      }
    )
  );

  /* -------------------------------------------------------
     FICHIERS
  ------------------------------------------------------- */

  for (let index = 0; index < files.length; index++) {
    const file = files[index];

    const fileUrl =
      `/__mahouto-share-file/${encodeURIComponent(shareId)}/${index}`;

    await cache.put(
      fileUrl,
      new Response(file, {
        headers: {
          "Content-Type":
            file.type || "application/octet-stream",

          "X-MAHOUTO-CREATED-AT":
            String(createdAt),

          "X-MAHOUTO-FILENAME":
            encodeURIComponent(file.name || `fichier-${index + 1}`)
        }
      })
    );
  }

  /*
   * Nettoyage des anciens partages.
   */

  await cleanupOldShares();

  return shareId;
}

/* ---------------------------------------------------------
   SHARE TARGET
--------------------------------------------------------- */

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  /*
   * IMPORTANT :
   * On intercepte UNIQUEMENT le POST du Share Target.
   */

  if (
    event.request.method === "POST" &&
    url.pathname === "/share-target"
  ) {
    event.respondWith(
      (async () => {
        try {
          const shareId =
            await saveSharePayload(event.request);

          /*
           * 303 = POST → GET
           *
           * Le fichier reste sur le téléphone.
           * On ne l'envoie PAS à Vercel.
           */

          return Response.redirect(
            `/share.html?local_share_id=${encodeURIComponent(shareId)}`,
            303
          );

        } catch (error) {
          console.error(
            "Erreur Share Target :",
            error
          );

          return Response.redirect(
            "/share.html?share_error=1",
            303
          );
        }
      })()
    );

    return;
  }

  /*
   * Les API ne doivent jamais être mises en cache.
   */

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  /*
   * Les requêtes GET normales utilisent le cache
   * puis le réseau en secours.
   */

  if (event.request.method === "GET") {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request);
      })
    );
  }
});
