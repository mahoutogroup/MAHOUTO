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

  // Page de finalisation du partage
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
// CONFIGURATION CLOUDINARY
// ======================================================
//
// IMPORTANT :
// Ces deux valeurs peuvent être publiques lorsqu'on
// utilise un upload preset UNSIGNED.
//
// Ne mettez JAMAIS CLOUDINARY_API_SECRET ici.
//

const CLOUDINARY_CLOUD_NAME = "VOTRE_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "VOTRE_UPLOAD_PRESET";


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
// UTILITAIRE : PAGE HTML D'ERREUR
// ======================================================

function errorResponse(message) {
  return new Response(
    `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport"
            content="width=device-width,initial-scale=1">
      <title>MAHOUTO+ — Erreur</title>

      <style>
        body {
          margin: 0;
          padding: 24px;
          background: #0A0A0A;
          color: white;
          font-family: Arial, sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .box {
          width: 100%;
          max-width: 500px;
          background: #171717;
          border-radius: 18px;
          padding: 28px;
          box-sizing: border-box;
          text-align: center;
        }

        h1 {
          color: #FFC107;
          margin-top: 0;
        }

        p {
          color: #ddd;
          line-height: 1.6;
        }

        button {
          margin-top: 20px;
          padding: 14px 22px;
          border: 0;
          border-radius: 10px;
          background: #FFC107;
          color: #111;
          font-weight: bold;
        }
      </style>
    </head>

    <body>
      <div class="box">
        <h1>MAHOUTO+</h1>

        <p>
          Impossible de traiter le fichier partagé.
        </p>

        <p>
          ${String(message)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}
        </p>

        <button onclick="location.href='/'">
          Retour à MAHOUTO+
        </button>
      </div>
    </body>
    </html>
    `,
    {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      }
    }
  );
}


// ======================================================
// UPLOAD CLOUDINARY
// ======================================================

async function uploadToCloudinary(file) {

  if (
    !CLOUDINARY_CLOUD_NAME ||
    CLOUDINARY_CLOUD_NAME === "VOTRE_CLOUD_NAME"
  ) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME n'est pas configuré dans sw.js."
    );
  }

  if (
    !CLOUDINARY_UPLOAD_PRESET ||
    CLOUDINARY_UPLOAD_PRESET === "VOTRE_UPLOAD_PRESET"
  ) {
    throw new Error(
      "CLOUDINARY_UPLOAD_PRESET n'est pas configuré dans sw.js."
    );
  }

  const endpoint =
    `https://api.cloudinary.com/v1_1/` +
    `${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/auto/upload`;

  const formData = new FormData();

  formData.append(
    "file",
    file,
    file.name || "mahouto-share"
  );

  formData.append(
    "upload_preset",
    CLOUDINARY_UPLOAD_PRESET
  );

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Cloudinary a refusé le fichier (${response.status}). ${text}`
    );
  }

  const data = await response.json();

  if (!data.secure_url) {
    throw new Error(
      "Cloudinary n'a pas retourné d'URL sécurisée."
    );
  }

  return data;
}


// ======================================================
// CRÉATION DU SHARE_PENDING
// ======================================================
//
// IMPORTANT :
// Seules les MÉTADONNÉES passent par Vercel.
// Le fichier lui-même est déjà chez Cloudinary.
//

async function createPendingShare({
  filename,
  mimeType,
  fileSize,
  attachmentUrl,
  caption,
  title,
  sharedUrl
}) {

  const response = await fetch(
    "/api/share-pending-create",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        filename,
        mime_type: mimeType,
        file_size: fileSize,
        attachment_url: attachmentUrl,
        caption,
        title,
        shared_url: sharedUrl
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Création du partage impossible (${response.status}). ${text}`
    );
  }

  const data = await response.json();

  if (!data.success || !data.share_id) {
    throw new Error(
      data.error ||
      "Le serveur n'a pas retourné de share_id."
    );
  }

  return data.share_id;
}


// ======================================================
// SHARE TARGET
// ======================================================

async function handleShareTarget(request) {

  // ----------------------------------------------
  // Lire le formulaire multipart
  // ----------------------------------------------

  const formData = await request.formData();

  // ----------------------------------------------
  // Informations texte
  // ----------------------------------------------

  const title =
    String(formData.get("title") || "").trim();

  const text =
    String(formData.get("text") || "").trim();

  const sharedUrl =
    String(formData.get("url") || "").trim();

  // ----------------------------------------------
  // Caption initiale
  // ----------------------------------------------

  const caption = text;

  // ----------------------------------------------
  // Récupérer les fichiers
  // ----------------------------------------------

  const files = formData.getAll("files");

  const file = files.find(
    (item) => item instanceof File && item.size > 0
  );

  // ----------------------------------------------
  // Aucun fichier
  // ----------------------------------------------

  if (!file) {

    // Cas partage de texte/lien sans fichier
    const shareId = await createPendingShare({
      filename: "",
      mimeType: "text/plain",
      fileSize: 0,
      attachmentUrl: "",
      caption,
      title,
      sharedUrl
    });

    const redirectUrl =
      new URL(
        "/share.html",
        self.location.origin
      );

    redirectUrl.searchParams.set(
      "id",
      shareId
    );

    return Response.redirect(
      redirectUrl.toString(),
      303
    );
  }

  // ----------------------------------------------
  // Vérification taille minimale
  // ----------------------------------------------

  if (file.size <= 0) {
    throw new Error(
      "Le fichier partagé est vide."
    );
  }

  // ----------------------------------------------
  // Upload DIRECT vers Cloudinary
  // ----------------------------------------------

  const cloudinary =
    await uploadToCloudinary(file);

  // ----------------------------------------------
  // Création du partage temporaire
  // ----------------------------------------------

  const shareId =
    await createPendingShare({
      filename:
        file.name || "fichier-partage",

      mimeType:
        file.type ||
        "application/octet-stream",

      fileSize:
        file.size,

      attachmentUrl:
        cloudinary.secure_url,

      caption,

      title,

      sharedUrl
    });

  // ----------------------------------------------
  // Redirection vers l'interface MAHOUTO+
  // ----------------------------------------------

  const redirectUrl =
    new URL(
      "/share.html",
      self.location.origin
    );

  redirectUrl.searchParams.set(
    "id",
    shareId
  );

  return Response.redirect(
    redirectUrl.toString(),
    303
  );
}


// ======================================================
// FETCH
// ======================================================

self.addEventListener("fetch", (event) => {

  const request = event.request;
  const url = new URL(request.url);


  // ====================================================
  // 1. SHARE TARGET
  // ====================================================

  if (
    request.method === "POST" &&
    url.pathname === "/share-target"
  ) {

    event.respondWith(
      handleShareTarget(request)
        .catch((error) => {

          console.error(
            "MAHOUTO+ Share Target:",
            error
          );

          return errorResponse(
            error.message ||
            "Erreur inconnue."
          );
        })
    );

    return;
  }


  // ====================================================
  // 2. API : laisser Vercel gérer
  // ====================================================

  if (url.pathname.startsWith("/api/")) {
    return;
  }


  // ====================================================
  // 3. Seulement GET pour le cache
  // ====================================================

  if (request.method !== "GET") {
    return;
  }


  // ====================================================
  // 4. Navigation HTML
  // ====================================================

  if (request.mode === "navigate") {

    event.respondWith(

      fetch(request)
        .then((response) => {

          const clone =
            response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, clone);
            });

          return response;
        })

        .catch(() => {

          return caches.match(request)
            .then((cached) => {

              return (
                cached ||
                caches.match("/index.html")
              );

            });

        })

    );

    return;
  }


  // ====================================================
  // 5. Assets : cache puis réseau
  // ====================================================

  event.respondWith(

    caches.match(request)
      .then((cachedResponse) => {

        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {

            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type === "basic"
            ) {

              const clone =
                networkResponse.clone();

              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(
                    request,
                    clone
                  );
                });
            }

            return networkResponse;
          });

      })

  );

});
