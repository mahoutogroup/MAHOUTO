/* =========================================================
   MAHOUTO+ — Service Worker
   Version : v40
   Architecture Share Target :
   
   Android / Galerie
        ↓
   /share-target
        ↓
   Service Worker
        ↓
   Cloudinary
        ↓
   /api/share-pending-create
        ↓
   /share.html?id=UUID
        ↓
   Choix du salon
        ↓
   /api/share-finalize
        ↓
   messages
   ========================================================= */

const CACHE_NAME = "mahoutoplus-shell-v40";

/* =========================================================
   CLOUDINARY
   ========================================================= */

const CLOUDINARY_CLOUD_NAME = "hefa5gqf";
const CLOUDINARY_UPLOAD_PRESET = "mahouto_share";

/*
 * Limite locale de sécurité.
 * 90 Mo permet d'éviter les très gros fichiers qui pourraient
 * provoquer une consommation excessive de mémoire sur Android.
 */
const MAX_SHARE_FILE_SIZE = 90 * 1024 * 1024;


/* =========================================================
   APPLICATION SHELL
   ========================================================= */

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

  /* Page intermédiaire du partage */
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
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => {
        console.error(
          "[MAHOUTO+ SW] Erreur installation cache :",
          error
        );
      })
  );

  /*
   * Active immédiatement cette nouvelle version.
   */
  self.skipWaiting();
});


/* =========================================================
   ACTIVATION
   ========================================================= */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith("mahoutoplus-shell-"))
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});


/* =========================================================
   UTILITAIRES
   ========================================================= */

/**
 * Détermine le type de fichier envoyé à Cloudinary.
 */
function getAttachmentType(mimeType = "") {
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) {
    return "image";
  }

  if (mime.startsWith("video/")) {
    return "video";
  }

  if (mime.startsWith("audio/")) {
    return "audio";
  }

  return "raw";
}


/**
 * Retourne le premier fichier présent dans FormData.
 */
function getSharedFile(formData) {
  /*
   * Le manifest utilise :
   *
   * "files": [{
   *   "name": "files",
   *   ...
   * }]
   */

  const file = formData.get("files");

  if (file instanceof File) {
    return file;
  }

  /*
   * Sécurité supplémentaire :
   * certains navigateurs peuvent exposer plusieurs fichiers.
   */
  for (const value of formData.values()) {
    if (value instanceof File) {
      return value;
    }
  }

  return null;
}


/**
 * Nettoie une chaîne avant de l'envoyer.
 */
function cleanText(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}


/**
 * Génère un identifiant UUID.
 */
function generateShareId() {
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  /*
   * Fallback très improbable sur les navigateurs modernes.
   */
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    character => {
      const random = (Math.random() * 16) | 0;
      const value =
        character === "x"
          ? random
          : (random & 0x3) | 0x8;

      return value.toString(16);
    }
  );
}


/**
 * Construit l'URL finale de la page de partage.
 */
function buildSharePageUrl(shareId) {
  return new URL(
    `/share.html?id=${encodeURIComponent(shareId)}`,
    self.location.origin
  ).toString();
}


/**
 * Retourne une réponse HTML minimale en cas d'erreur.
 */
function errorResponse(message, status = 500) {
  const safeMessage = String(message || "Erreur inconnue.");

  return new Response(
    `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport"
        content="width=device-width,initial-scale=1">
  <title>MAHOUTO+ — Erreur</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: Arial, sans-serif;
      background: #0A0A0A;
      color: #fff;
    }

    .box {
      max-width: 520px;
      margin: 60px auto;
      padding: 24px;
      border-radius: 18px;
      background: #171717;
    }

    h1 {
      color: #FFC107;
    }

    p {
      line-height: 1.6;
    }

    a {
      color: #FFC107;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>MAHOUTO+</h1>
    <p>${safeMessage}</p>
    <p>
      <a href="/index.html">
        Retour à MAHOUTO+
      </a>
    </p>
  </div>
</body>
</html>
    `,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      }
    }
  );
}


/* =========================================================
   UPLOAD CLOUDINARY
   ========================================================= */

async function uploadToCloudinary(file) {
  if (!CLOUDINARY_CLOUD_NAME) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME n'est pas configuré."
    );
  }

  if (!CLOUDINARY_UPLOAD_PRESET) {
    throw new Error(
      "CLOUDINARY_UPLOAD_PRESET n'est pas configuré."
    );
  }

  if (!file) {
    throw new Error(
      "Aucun fichier n'a été reçu."
    );
  }

  if (file.size <= 0) {
    throw new Error(
      "Le fichier reçu est vide."
    );
  }

  if (file.size > MAX_SHARE_FILE_SIZE) {
    throw new Error(
      "Le fichier est trop volumineux. " +
      "La limite de partage est de 90 Mo."
    );
  }

  const cloudinaryUrl =
    `https://api.cloudinary.com/v1_1/` +
    `${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}` +
    `/auto/upload`;

  const uploadForm = new FormData();

  uploadForm.append(
    "file",
    file,
    file.name || "mahouto-share-file"
  );

  uploadForm.append(
    "upload_preset",
    CLOUDINARY_UPLOAD_PRESET
  );

  /*
   * Dossier séparé pour les fichiers provenant
   * du Share Target.
   */
  uploadForm.append(
    "folder",
    "mahouto_plus/share_pending"
  );

  const response = await fetch(cloudinaryUrl, {
    method: "POST",
    body: uploadForm
  });

  if (!response.ok) {
    let details = "";

    try {
      const data = await response.json();

      details =
        data?.error?.message ||
        data?.message ||
        "";
    } catch {
      details = "";
    }

    throw new Error(
      "Échec de l'envoi vers Cloudinary." +
      (details ? ` ${details}` : "")
    );
  }

  const data = await response.json();

  if (!data.secure_url) {
    throw new Error(
      "Cloudinary n'a pas retourné d'URL sécurisée."
    );
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id || "",
    resourceType: data.resource_type || "raw",
    format: data.format || "",
    bytes: data.bytes || file.size
  };
}


/* =========================================================
   CRÉATION DU SHARE_PENDING
   ========================================================= */

async function createPendingShare({
  shareId,
  file,
  attachmentUrl,
  title,
  caption,
  sharedUrl
}) {
  const endpoint =
    new URL(
      "/api/share-pending-create",
      self.location.origin
    ).toString();

  const attachmentType =
    getAttachmentType(file.type);

  const payload = {
    id: shareId,

    filename: cleanText(
      file.name || "fichier",
      255
    ),

    mime_type: cleanText(
      file.type || "application/octet-stream",
      255
    ),

    file_size: Number(file.size || 0),

    attachment_url: attachmentUrl,

    attachment_type: attachmentType,

    caption: cleanText(caption, 2000),

    title: cleanText(title, 500),

    shared_url: cleanText(sharedUrl, 2000),

    expires_at:
      new Date(
        Date.now() + 15 * 60 * 1000
      ).toISOString()
  };

  const response = await fetch(endpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let details = "";

    try {
      const data = await response.json();

      details =
        data?.error ||
        data?.message ||
        data?.details ||
        "";
    } catch {
      details = "";
    }

    throw new Error(
      "Impossible d'enregistrer le partage." +
      (details ? ` ${details}` : "")
    );
  }

  const data = await response.json();

  if (data && data.success === false) {
    throw new Error(
      data.error ||
      "La création du partage temporaire a échoué."
    );
  }

  return data;
}


/* =========================================================
   TRAITEMENT DU SHARE TARGET
   ========================================================= */

async function handleShareTarget(request) {
  console.log(
    "[MAHOUTO+ SW] Nouveau partage reçu."
  );

  /*
   * Le navigateur Android nous transmet un
   * multipart/form-data.
   */
  const formData = await request.formData();

  const file = getSharedFile(formData);

  if (!file) {
    throw new Error(
      "Aucun fichier n'a été reçu par MAHOUTO+."
    );
  }

  /*
   * Informations éventuellement fournies
   * par Android / Galerie / navigateur.
   */
  const title = cleanText(
    formData.get("title") || "",
    500
  );

  const text = cleanText(
    formData.get("text") || "",
    2000
  );

  const sharedUrl = cleanText(
    formData.get("url") || "",
    2000
  );

  /*
   * Si Android fournit du texte, nous le conservons
   * comme légende initiale.
   */
  const caption = text;

  /*
   * UUID du partage temporaire.
   */
  const shareId = generateShareId();

  console.log(
    "[MAHOUTO+ SW] Share ID :",
    shareId
  );

  /*
   * ÉTAPE 1
   * Upload direct vers Cloudinary.
   *
   * Le fichier ne passe PAS par Vercel.
   * Cela évite le 413 FUNCTION_PAYLOAD_TOO_LARGE.
   */
  const cloudinary = await uploadToCloudinary(file);

  console.log(
    "[MAHOUTO+ SW] Upload Cloudinary réussi."
  );

  /*
   * ÉTAPE 2
   * Création de la ligne share_pending.
   *
   * Seules les métadonnées et l'URL Cloudinary
   * passent maintenant par Vercel.
   */
  await createPendingShare({
    shareId,
    file,
    attachmentUrl: cloudinary.secureUrl,
    title,
    caption,
    sharedUrl
  });

  console.log(
    "[MAHOUTO+ SW] Share pending créé."
  );

  /*
   * ÉTAPE 3
   * Redirection vers l'interface de choix du salon.
   */
  return Response.redirect(
    buildSharePageUrl(shareId),
    303
  );
}


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  /*
   * =======================================================
   * SHARE TARGET
   * =======================================================
   *
   * Android appelle :
   *
   * POST /share-target
   *
   * Le Service Worker intercepte cette requête AVANT
   * qu'elle atteigne une Serverless Function.
   */

  if (
    url.pathname === "/share-target" &&
    request.method === "POST"
  ) {
    event.respondWith(
      handleShareTarget(request)
        .catch(error => {
          console.error(
            "[MAHOUTO+ SW] Erreur Share Target :",
            error
          );

          return errorResponse(
            error?.message ||
            "Une erreur est survenue pendant le partage.",
            500
          );
        })
    );

    return;
  }


  /*
   * =======================================================
   * API
   * =======================================================
   *
   * Les API ne doivent JAMAIS être mises en cache.
   */

  if (
    url.pathname.startsWith("/api/")
  ) {
    return;
  }


  /*
   * =======================================================
   * REQUÊTES NON GET
   * =======================================================
   */

  if (request.method !== "GET") {
    return;
  }


  /*
   * =======================================================
   * NAVIGATION
   * =======================================================
   *
   * Pour les pages HTML :
   *
   * 1. essayer le réseau
   * 2. si réseau indisponible, utiliser le cache
   */

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          /*
           * On ne met en cache que les réponses valides.
           */
          if (
            response &&
            response.ok &&
            response.type === "basic"
          ) {
            const responseClone =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then(cache => {
                cache.put(
                  request,
                  responseClone
                );
              })
              .catch(() => {});
          }

          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then(cached => {
              return (
                cached ||
                caches.match("/index.html")
              );
            });
        })
    );

    return;
  }


  /*
   * =======================================================
   * RESSOURCES STATIQUES
   * =======================================================
   *
   * Cache-first :
   * - CSS
   * - JS
   * - images
   * - manifest
   * - pages déjà présentes
   *
   * Puis réseau si absent du cache.
   */

  event.respondWith(
    caches
      .match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then(response => {
            if (
              response &&
              response.ok &&
              response.type === "basic"
            ) {
              const responseClone =
                response.clone();

              caches
                .open(CACHE_NAME)
                .then(cache => {
                  cache.put(
                    request,
                    responseClone
                  );
                })
                .catch(() => {});
            }

            return response;
          });
      })
  );
});


/* =========================================================
   MESSAGE
   ========================================================= */

self.addEventListener("message", event => {
  if (!event.data) {
    return;
  }

  /*
   * Permet à la page de demander une activation
   * immédiate du nouveau Service Worker.
   */
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  /*
   * Permet de vider manuellement le cache si nécessaire.
   */
  if (event.data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches.delete(CACHE_NAME)
    );
  }
});
