/**
 * MAHOUTO+ — Android Web Share Target
 *
 * Flux :
 *
 * WhatsApp / Galerie
 *       ↓
 * POST /api/share-target
 *       ↓
 * Upload Cloudinary
 *       ↓
 * Création d'un partage temporaire Supabase
 *       ↓
 * Redirect /share.html?id=...
 *       ↓
 * L'utilisateur choisit le salon
 *       ↓
 * POST /api/share-finalize
 *       ↓
 * Création du message
 */

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}`
    );
  }

  return value;
}

function json(res, status, data) {
  return res.status(status).json(data);
}

async function handler(req, res) {

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Méthode non autorisée. Utilisez POST.",
    });
  }

  try {

    // =========================================================
    // 1. ENVIRONNEMENT
    // =========================================================

    const SUPABASE_URL =
      getEnv("SUPABASE_URL");

    const SUPABASE_SERVICE_ROLE_KEY =
      getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const CLOUDINARY_CLOUD_NAME =
      getEnv("CLOUDINARY_CLOUD_NAME");

    const CLOUDINARY_UPLOAD_PRESET =
      getEnv("CLOUDINARY_UPLOAD_PRESET");

    const CLOUDINARY_FOLDER =
      process.env.CLOUDINARY_FOLDER ||
      "mahoutoplus/share-target";


    // =========================================================
    // 2. CONTENT TYPE
    // =========================================================

    const contentType =
      req.headers["content-type"] || "";

    if (
      !contentType
        .toLowerCase()
        .includes("multipart/form-data")
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Le partage doit être envoyé en multipart/form-data.",
        received_content_type:
          contentType,
      });
    }


    // =========================================================
    // 3. REQUEST NATIVE
    // =========================================================

    const host =
      req.headers.host || "localhost";

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const requestUrl =
      `${protocol}://${host}${req.url}`;

    const request =
      new Request(
        requestUrl,
        {
          method: "POST",
          headers: req.headers,
          body: req,
          duplex: "half",
        }
      );

    const formData =
      await request.formData();


    // =========================================================
    // 4. RÉCUPÉRATION DU PARTAGE
    // =========================================================

    const caption =
      formData.get("caption") ||
      formData.get("text") ||
      formData.get("content") ||
      "";

    const title =
      formData.get("title") ||
      "";

    const sharedUrl =
      formData.get("url") ||
      "";


    // =========================================================
    // 5. RECHERCHE DU FICHIER
    // =========================================================

    const possibleFileFields = [
      "file",
      "files",
      "attachment",
      "media",
      "image",
      "video",
      "document",
    ];

    let file = null;

    for (
      const fieldName of possibleFileFields
    ) {

      const value =
        formData.get(fieldName);

      if (
        value &&
        typeof value === "object" &&
        typeof value.arrayBuffer === "function"
      ) {
        file = value;
        break;
      }
    }


    // =========================================================
    // 6. VALIDATION FICHIER
    // =========================================================

    if (!file) {
      return json(res, 400, {
        success: false,
        error:
          "Aucun fichier n'a été reçu.",
      });
    }

    if (
      typeof file.size === "number" &&
      file.size > MAX_FILE_SIZE
    ) {
      return json(res, 413, {
        success: false,
        error:
          "Le fichier est trop volumineux.",
        max_size_mb: 50,
      });
    }


    // =========================================================
    // 7. BUFFER
    // =========================================================

    const arrayBuffer =
      await file.arrayBuffer();

    const fileBuffer =
      Buffer.from(arrayBuffer);

    if (!fileBuffer.length) {
      return json(res, 400, {
        success: false,
        error:
          "Le fichier reçu est vide.",
      });
    }


    // =========================================================
    // 8. CLOUDINARY
    // =========================================================

    const cloudinaryUrl =
      `https://api.cloudinary.com/v1_1/` +
      `${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}` +
      `/auto/upload`;

    const cloudinaryForm =
      new FormData();

    const blob =
      new Blob(
        [fileBuffer],
        {
          type:
            file.type ||
            "application/octet-stream",
        }
      );

    cloudinaryForm.append(
      "file",
      blob,
      file.name ||
      "mahouto-share-file"
    );

    cloudinaryForm.append(
      "upload_preset",
      CLOUDINARY_UPLOAD_PRESET
    );

    cloudinaryForm.append(
      "folder",
      CLOUDINARY_FOLDER
    );

    cloudinaryForm.append(
      "resource_type",
      "auto"
    );


    const cloudinaryResponse =
      await fetch(
        cloudinaryUrl,
        {
          method: "POST",
          body: cloudinaryForm,
        }
      );

    const cloudinaryText =
      await cloudinaryResponse.text();

    if (!cloudinaryResponse.ok) {

      console.error(
        "Cloudinary error:",
        cloudinaryText
      );

      return json(res, 500, {
        success: false,
        error:
          "L'envoi du fichier vers Cloudinary a échoué.",
        details:
          cloudinaryText,
      });
    }


    // =========================================================
    // 9. RÉPONSE CLOUDINARY
    // =========================================================

    let cloudinaryData;

    try {

      cloudinaryData =
        JSON.parse(
          cloudinaryText
        );

    } catch (error) {

      return json(res, 500, {
        success: false,
        error:
          "Réponse Cloudinary invalide.",
      });
    }


    const attachmentUrl =
      cloudinaryData.secure_url ||
      cloudinaryData.url ||
      null;

    if (!attachmentUrl) {

      return json(res, 500, {
        success: false,
        error:
          "Cloudinary n'a pas retourné l'URL du fichier.",
      });
    }


    // =========================================================
    // 10. CRÉATION DU PARTAGE TEMPORAIRE
    // =========================================================

    const pendingPayload = {

      filename:
        file.name ||
        "fichier",

      mime_type:
        file.type ||
        "application/octet-stream",

      file_size:
        typeof file.size === "number"
          ? file.size
          : fileBuffer.length,

      attachment_url:
        attachmentUrl,

      caption:
        String(caption || "").slice(0, 2000),

      title:
        String(title || "").slice(0, 500),

      shared_url:
        String(sharedUrl || "").slice(0, 2000),

      expires_at:
        new Date(
          Date.now() + 15 * 60 * 1000
        ).toISOString(),

      created_at:
        new Date().toISOString(),
    };


    const pendingResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/share_pending`,
        {
          method: "POST",

          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

            "Content-Type":
              "application/json",

            Prefer:
              "return=representation",
          },

          body:
            JSON.stringify(
              pendingPayload
            ),
        }
      );


    const pendingText =
      await pendingResponse.text();


    if (!pendingResponse.ok) {

      console.error(
        "Supabase share_pending error:",
        pendingText
      );

      return json(res, 500, {
        success: false,
        error:
          "Le partage temporaire n'a pas pu être créé.",
        details:
          pendingText,
      });
    }


    let pendingRows;

    try {

      pendingRows =
        JSON.parse(
          pendingText
        );

    } catch (error) {

      return json(res, 500, {
        success: false,
        error:
          "Réponse Supabase invalide.",
      });
    }


    const pending =
      Array.isArray(pendingRows)
        ? pendingRows[0]
        : pendingRows;


    if (
      !pending ||
      !pending.id
    ) {

      return json(res, 500, {
        success: false,
        error:
          "Le partage temporaire ne possède aucun identifiant.",
      });
    }


    // =========================================================
    // 11. REDIRECTION VERS L'ÉCRAN DE PARTAGE
    // =========================================================

    const sharePage =
      `/share.html?id=${encodeURIComponent(
        pending.id
      )}`;

    res.setHeader(
      "Location",
      sharePage
    );

    return res.status(303).end();


  } catch (error) {

    console.error(
      "SHARE TARGET ERROR:",
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Erreur interne lors du partage.",

      details:
        error?.message ||
        String(error),
    });
  }
}

module.exports = handler;
