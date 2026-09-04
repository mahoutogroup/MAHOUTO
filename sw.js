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

/* =========================================================
   INSTALLATION
   ========================================================= */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => {
        console.error("Erreur installation cache :", error);
      })
  );

  self.skipWaiting();
});


/* =========================================================
   ACTIVATION
   ========================================================= */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      );
    })
  );

  self.clients.claim();
});


/* =========================================================
   SHARE TARGET
   =========================================================
   
   Android envoie normalement le fichier vers :
   
       /api/share-target
   
   MAIS nous interceptons cette requête ici, AVANT Vercel.

   Le gros fichier reste donc dans le navigateur.
   Il ne traverse plus la Serverless Function Vercel.

   Ensuite nous redirigeons vers :

       /share.html?id=XXXX

   ========================================================= */

self.addEventListener("fetch", event => {

  const request = event.request;

  /*
   * -------------------------------------------------------
   * 1. INTERCEPTION DU SHARE TARGET
   * -------------------------------------------------------
   */

  if (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/share-target"
  ) {
    event.respondWith(handleShareTarget(request));
    return;
  }


  /*
   * -------------------------------------------------------
   * 2. NE JAMAIS METTRE LES API EN CACHE
   * -------------------------------------------------------
   */

  if (new URL(request.url).pathname.startsWith("/api/")) {
    return;
  }


  /*
   * -------------------------------------------------------
   * 3. UNIQUEMENT LES REQUÊTES GET
   * -------------------------------------------------------
   */

  if (request.method !== "GET") {
    return;
  }


  /*
   * -------------------------------------------------------
   * 4. CACHE FIRST POUR L'APPLICATION
   * -------------------------------------------------------
   */

  event.respondWith(
    caches.match(request).then(cachedResponse => {

      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(networkResponse => {

          /*
           * Ne mettre en cache que les réponses valides.
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
        })
        .catch(() => {
          return caches.match("/index.html");
        });
    })
  );
});


/* =========================================================
   GESTION DU SHARE TARGET
   ========================================================= */

async function handleShareTarget(request) {

  try {

    /*
     * Récupération du multipart/form-data envoyé
     * par Android.
     */

    const formData = await request.formData();


    /*
     * Données textuelles éventuellement envoyées
     * par Android.
     */

    const title =
      getFormValue(formData, "title") || "";

    const text =
      getFormValue(formData, "text") || "";

    const sharedUrl =
      getFormValue(formData, "url") || "";


    /*
     * Récupération du fichier.
     *
     * Le manifest utilise :
     *
     * files: [{
     *   name: "files",
     *   accept: [...]
     * }]
     */

    let file = formData.get("files");


    /*
     * Certaines versions Android peuvent envoyer
     * plusieurs fichiers.
     */

    if (!file || typeof file !== "object" || !file.name) {

      const possibleFiles = [];

      for (const [key, value] of formData.entries()) {

        if (
          value &&
          typeof value === "object" &&
          typeof value.name === "string" &&
          value.size !== undefined
        ) {
          possibleFiles.push(value);
        }
      }

      if (possibleFiles.length > 0) {
        file = possibleFiles[0];
      }
    }


    /*
     * Aucun fichier.
     */

    if (!file || typeof file !== "object" || !file.name) {

      return new Response(
        createErrorHTML(
          "Aucun fichier n'a été reçu.",
          "Veuillez réessayer depuis la Galerie ou WhatsApp."
        ),
        {
          status: 400,
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        }
      );
    }


    /*
     * Création d'un identifiant unique.
     */

    const shareId = crypto.randomUUID();


    /*
     * Sauvegarde temporaire dans IndexedDB.
     *
     * IMPORTANT :
     * Le fichier est conservé localement dans le navigateur.
     * Il n'est PAS envoyé à Vercel.
     */

    await savePendingShare({
      id: shareId,

      file: file,

      title: title,

      text: text,

      sharedUrl: sharedUrl,

      createdAt: Date.now()
    });


    /*
     * Redirection vers l'interface MAHOUTO+.
     */

    const redirectUrl =
      `/share.html?id=${encodeURIComponent(shareId)}`;


    return Response.redirect(
      redirectUrl,
      303
    );

  } catch (error) {

    console.error(
      "Erreur Share Target Service Worker :",
      error
    );


    return new Response(
      createErrorHTML(
        "Impossible de préparer le partage.",
        "Veuillez réessayer."
      ),
      {
        status: 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      }
    );
  }
}


/* =========================================================
   RÉCUPÉRATION D'UNE VALEUR FORM DATA
   ========================================================= */

function getFormValue(formData, key) {

  const value = formData.get(key);

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}


/* =========================================================
   INDEXEDDB
   ========================================================= */

const DB_NAME = "mahoutoplus-share";

const DB_VERSION = 1;

const STORE_NAME = "pending";


/*
 * Ouvre la base.
 */

function openShareDB() {

  return new Promise((resolve, reject) => {

    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION
    );


    /*
     * Création du magasin lors de la première ouverture.
     */

    request.onupgradeneeded = event => {

      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {

        db.createObjectStore(
          STORE_NAME,
          {
            keyPath: "id"
          }
        );
      }
    };


    request.onsuccess = () => {

      resolve(request.result);
    };


    request.onerror = () => {

      reject(request.error);
    };
  });
}


/* =========================================================
   SAUVEGARDE DU PARTAGE
   ========================================================= */

async function savePendingShare(data) {

  const db = await openShareDB();


  return new Promise((resolve, reject) => {

    const transaction =
      db.transaction(
        STORE_NAME,
        "readwrite"
      );


    const store =
      transaction.objectStore(
        STORE_NAME
      );


    store.put(data);


    transaction.oncomplete = () => {

      db.close();

      resolve();
    };


    transaction.onerror = () => {

      db.close();

      reject(transaction.error);
    };


    transaction.onabort = () => {

      db.close();

      reject(
        transaction.error ||
        new Error(
          "Transaction IndexedDB interrompue."
        )
      );
    };
  });
}


/* =========================================================
   PAGE D'ERREUR MINIMALE
   ========================================================= */

function createErrorHTML(title, message) {

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>MAHOUTO+ — Partage</title>

  <style>

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 24px;

      font-family:
        Arial,
        Helvetica,
        sans-serif;

      background: #0A0A0A;

      color: #FFFFFF;
    }

    .card {
      width: 100%;
      max-width: 420px;

      padding: 30px;

      border-radius: 20px;

      background: #171717;

      text-align: center;
    }

    h1 {
      margin-top: 0;

      font-size: 24px;
    }

    p {
      line-height: 1.6;

      color: #CCCCCC;
    }

    .logo {
      font-size: 42px;

      margin-bottom: 15px;
    }

    button {
      margin-top: 20px;

      width: 100%;

      padding: 14px;

      border: 0;

      border-radius: 12px;

      background: #FFC107;

      color: #000000;

      font-weight: 700;

      font-size: 16px;
    }

  </style>
</head>

<body>

  <div class="card">

    <div class="logo">
      M+
    </div>

    <h1>${escapeHTML(title)}</h1>

    <p>
      ${escapeHTML(message)}
    </p>

    <button
      onclick="location.href='/share.html'"
    >
      Ouvrir MAHOUTO+
    </button>

  </div>

</body>
</html>
`;
}


/* =========================================================
   PROTECTION HTML
   ========================================================= */

function escapeHTML(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
