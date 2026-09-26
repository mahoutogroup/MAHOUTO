const CACHE_NAME = "mahoutoplus-shell-v60";
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
  "/formation-detail.html",
  "/produits.html",
  "/produit-detail.html",
  "/mes-achats.html",
  "/academie-majestepresse.html",
  "/profil.html",
  "/share.html",
  "/manifest.json",
  "/config.js",
  "/theme.css",
  "/theme-toggle.js",
  "/pwa-install.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];

/* ---------------------------------------------------------
   INSTALLATION
--------------------------------------------------------- */

/* ---------------------------------------------------------
   NOTIFICATIONS PUSH (24/09/2026)
   N'interfère avec rien de ce qui précède : deux nouveaux
   écouteurs, indépendants du cache/partage déjà en place.
--------------------------------------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload non-JSON, ignoré */ }

  const title = data.title || "MAHOUTO+";
  const options = {
    body: data.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    data: { url: data.url || "/" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Réutilise un onglet déjà ouvert sur cette page plutôt que
        // d'en ouvrir un nouveau, si possible.
        if (client.url.includes(targetUrl) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

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
   * Documents HTML (navigations : index.html, profil.html, chat.html,
   * dm-chat.html, etc.) → NETWORK FIRST.
   *
   * On veut toujours la dernière version déployée du HTML/JS d'une
   * page, pour éviter qu'un ancien script (ex. profil.html sans son
   * dernier correctif) reste servi depuis le cache après un déploiement.
   * Le cache ne sert plus que de secours hors-ligne, jamais de
   * première réponse.
   */

  const isHtmlDocument =
    event.request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/";

  if (event.request.method === "GET" && isHtmlDocument) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Le fetch réseau met à jour le cache dans tous les cas, même
        // si on finit par répondre depuis le cache faute de temps —
        // ainsi la PROCHAINE visite profite de la version fraîche.
        // .catch(() => null) : si ce fetch échoue APRÈS que le délai
        // ci-dessous a déjà fait gagner le cache, on ne veut surtout
        // pas une erreur non gérée qui traîne en arrière-plan.
        const networkFetch = fetch(event.request, { cache: "reload" })
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        try {
          // Sur un réseau lent, attendre le réseau indéfiniment rendait
          // CHAQUE clic sur un onglet très lent, même quand une version
          // parfaitement utilisable existait déjà en cache. On borne
          // donc l'attente réseau à 2,5s : au-delà, on sert le cache
          // immédiatement (s'il existe) et le fetch réseau continue en
          // arrière-plan pour rafraîchir le cache en vue de la
          // prochaine visite.
          const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
          const winner = await Promise.race([networkFetch, timeout]);

          if (winner) return winner; // le réseau a répondu à temps

          const cached = await cache.match(event.request);
          if (cached) return cached;

          // Rien en cache : ça vaut le coup d'attendre le réseau
          // jusqu'au bout plutôt que d'échouer pour rien.
          const finalResponse = await networkFetch;
          if (finalResponse) return finalResponse;
          throw new Error("Réseau indisponible et rien en cache pour cette page.");
        } catch (err) {
          // Réseau indisponible : on retombe sur la dernière version
          // connue en cache, si elle existe.
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  /*
   * Stale-while-revalidate :
   * on sert immédiatement la version en cache si elle existe
   * (rapide, fonctionne hors ligne), ET on relance en parallèle
   * une requête réseau pour mettre à jour le cache en vue
   * de la prochaine visite. Plus besoin de changer CACHE_NAME
   * à chaque contenu modifié — seuls les fichiers de l'App Shell
   * eux-mêmes (structure/icônes) nécessitent encore un bump.
   *
   * S'applique désormais uniquement aux assets statiques
   * (CSS, JS, images, icônes, polices, manifest, etc.) — plus aux
   * documents HTML, gérés ci-dessus en Network First.
   */

  if (event.request.method === "GET") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        // Même raison qu'au-dessus (Network First) : on force le
        // contournement du cache HTTP du navigateur pour que cette
        // revalidation en arrière-plan aille vraiment chercher la
        // dernière version déployée, pas une copie déjà en cache.
        const networkUpdate = fetch(event.request, { cache: "reload" })
          .then((response) => {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          // On répond tout de suite avec le cache, et on laisse
          // la mise à jour se terminer en arrière-plan.
          event.waitUntil(networkUpdate);
          return cached;
        }

        // Rien en cache (première visite, ou fichier non listé
        // dans l'App Shell) : on attend le réseau.
        const networkResponse = await networkUpdate;
        return networkResponse || Response.error();
      })
    );
  }
});
