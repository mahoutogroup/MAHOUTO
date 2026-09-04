/**
 * MAHOUTO+ — Web Share Target
 *
 * Flux :
 *
 * Android / WhatsApp / Galerie
 *          ↓
 * POST /api/share-target
 *          ↓
 * Cloudinary
 *          ↓
 * share_pending
 *          ↓
 * /share.html?id=UUID
 *          ↓
 * choix du salon
 *          ↓
 * /api/share-finalize
 *          ↓
 * messages
 */

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const PENDING_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}`
    );
  }

  return value;
}

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function cleanString(value, maxLength = 2000) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function getFileFromFormData(formData) {
  const possibleFields = [
    "file",
    "files",
    "attachment",
    "media",
    "image",
    "video",
    "document",
  ];

  for (const field of possibleFields) {
    const value = formData.get(field);

    if (
      value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function"
    ) {
      return value;
    }
  }

  return null;
}

async function handler(req, res) {
  // ============================================================
  // METHOD
  // ============================================================

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      error: "Méthode non autorisée. Utilisez POST.",
    });
  }

  try {
    // ============================================================
    // ENVIRONMENT
    // ============================================================

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
      "mahoutoplus/messages";

    // ============================================================
    // CONTENT TYPE
    // ============================================================

    const contentType =
      req.headers["content-type"] || "";

    if (
      !contentType
        .toLowerCase()
        .includes("multipart/form-data")
    ) {
      return sendJson(res, 400, {
        success: false,
        error:
          "Le partage doit être envoyé en multipart/form-data.",
      });
    }

    // ============================================================
    // REQUEST NATIVE
    // ============================================================

    const host =
      req.headers.host || "localhost";

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const requestUrl =
      `${protocol}://${host}${req.url}`;

    const request =
      new Request(requestUrl, {
        method: "POST",
        headers: req.headers,
        body: req,
        duplex: "half",
      });

    const formData =
      await request.formData();

    // ============================================================
    // SHARE INFORMATION
    // ============================================================

    const title = cleanString(
      formData.get("title"),
      300
    );

    const caption =
      cleanString(
        formData.get("caption") ||
        formData.get("text") ||
        formData.get("content"),
        2000
      );

    const sharedUrl =
      cleanString(
        formData.get("url"),
        2000
      );

    // ============================================================
    // FILE
    // ============================================================

    const file =
      getFileFromFormData(formData);

    if (!file) {
      return sendJson(res, 400, {
        success: false,
        error:
          "Aucun fichier n'a été reçu.",
      });
    }

    if (
      typeof file.size === "number" &&
      file.size > MAX_FILE_SIZE
    ) {
      return sendJson(res, 413, {
        success: false,
        error:
          "Le fichier est trop volumineux.",
        max_size_mb: 50,
      });
    }

    // ============================================================
    // FILE BUFFER
    // ============================================================

    const arrayBuffer =
      await file.arrayBuffer();

    const fileBuffer =
      Buffer.from(arrayBuffer);

    if (!fileBuffer.length) {
      return sendJson(res, 400, {
        success: false,
        error:
          "Le fichier reçu est vide.",
      });
    }

    // ============================================================
    // CLOUDINARY
    // ============================================================

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

    console.log(
      "MAHOUTO+ Share Target → Cloudinary",
      {
        filename: file.name,
        mime_type: file.type,
        size: fileBuffer.length,
      }
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

      return sendJson(res, 500, {
        success: false,
        error:
          "L'envoi du fichier vers Cloudinary a échoué.",
        details:
          cloudinaryText,
      });
    }

    let cloudinaryData;

    try {
      cloudinaryData =
        JSON.parse(
          cloudinaryText
        );
    } catch {
      return sendJson(res, 500, {
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
      return sendJson(res, 500, {
        success: false,
        error:
          "Cloudinary n'a pas retourné l'URL du fichier.",
      });
    }

    // ============================================================
    // CREATE TEMPORARY SHARE
    // ============================================================

    const shareId =
      crypto.randomUUID();

    const now =
      new Date();

    const expiresAt =
      new Date(
        now.getTime() +
        PENDING_DURATION_MS
      );

    const pendingPayload = {
      id: shareId,

      filename:
        cleanString(
          file.name ||
          "Fichier partagé",
          500
        ),

      mime_type:
        cleanString(
          file.type ||
          "application/octet-stream",
          200
        ),

      file_size:
        fileBuffer.length,

      attachment_url:
        attachmentUrl,

      caption:
        caption,

      title:
        title,

      shared_url:
        sharedUrl,

      expires_at:
        expiresAt.toISOString(),

      created_at:
        now.toISOString(),
    };

    console.log(
      "MAHOUTO+ → share_pending",
      {
        id: shareId,
        filename: pendingPayload.filename,
        size: pendingPayload.file_size,
      }
    );

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
        "share_pending INSERT error:",
        pendingText
      );

      return sendJson(res, 500, {
        success: false,
        error:
          "Le partage temporaire n'a pas pu être créé.",
        details:
          pendingText,
      });
    }

    // ============================================================
    // REDIRECT TO SHARE UI
    // ============================================================

    const origin =
      `${protocol}://${host}`;

    const sharePage =
      `${origin}/share.html?id=` +
      encodeURIComponent(shareId);

    console.log(
      "MAHOUTO+ Share Target →",
      sharePage
    );

    /*
     * 303 See Other :
     * le navigateur Android quitte le POST
     * et ouvre share.html en GET.
     */

    res.setHeader(
      "Location",
      sharePage
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    return res.status(303).end();

  } catch (error) {
    console.error(
      "SHARE TARGET ERROR:",
      error
    );

    return sendJson(res, 500, {
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
