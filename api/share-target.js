/**
 * MAHOUTO+ — Share Target API
 *
 * Flux :
 *
 * Android / WhatsApp / Galerie
 *        ↓
 * MAHOUTO+ Share Target
 *        ↓
 * /api/share-target
 *        ↓
 * Cloudinary
 *        ↓
 * Supabase
 *        ↓
 * message dans le salon
 *
 * Variables Vercel nécessaires :
 *
 * SUPABASE_URL
 * SUPABASE_SERVICE_ROLE_KEY
 *
 * CLOUDINARY_CLOUD_NAME
 * CLOUDINARY_UPLOAD_PRESET
 *
 * Facultatif :
 * CLOUDINARY_FOLDER
 */

// ============================================================
// CONFIGURATION VERCEL
// ============================================================

module.exports.config = {
  api: {
    bodyParser: false,
  },
};


// ============================================================
// CONSTANTES
// ============================================================

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB


// ============================================================
// UTILITAIRES
// ============================================================

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
  res.status(status).json(data);
}


// ============================================================
// HANDLER PRINCIPAL
// ============================================================

async function handler(req, res) {

  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );


  // ----------------------------------------------------------
  // OPTIONS / PREFLIGHT
  // ----------------------------------------------------------

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }


  // ----------------------------------------------------------
  // POST UNIQUEMENT
  // ----------------------------------------------------------

  if (req.method !== "POST") {

    return json(res, 405, {
      success: false,
      error:
        "Méthode non autorisée. Utilisez POST.",
    });

  }


  try {

    // ========================================================
    // 1. VARIABLES D'ENVIRONNEMENT
    // ========================================================

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


    // ========================================================
    // 2. VÉRIFICATION CONTENT-TYPE
    // ========================================================

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


    // ========================================================
    // 3. CONVERSION DU STREAM HTTP EN REQUEST NATIVE
    // ========================================================

    /*
     * Node.js moderne fournit Request / FormData / Blob.
     *
     * Le bodyParser Vercel est désactivé afin de conserver
     * le flux multipart original.
     */

    const host =
      req.headers.host ||
      "localhost";

    const protocol =
      req.headers["x-forwarded-proto"] ||
      "https";

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


    // ========================================================
    // 4. RÉCUPÉRATION DES INFORMATIONS
    // ========================================================

    const roomId =
      formData.get("room_id") ||
      formData.get("roomId") ||
      formData.get("destination") ||
      formData.get("room");


    const userId =
      formData.get("user_id") ||
      formData.get("userId") ||
      null;


    const username =
      formData.get("username") ||
      formData.get("user_name") ||
      formData.get("display_name") ||
      "Utilisateur MAHOUTO+";


    const caption =
      formData.get("caption") ||
      formData.get("text") ||
      formData.get("content") ||
      "";


    // ========================================================
    // 5. VALIDATION DU SALON
    // ========================================================

    if (!roomId) {

      return json(res, 400, {
        success: false,

        error:
          "Aucun salon n'a été sélectionné.",
      });

    }


    // ========================================================
    // 6. RECHERCHE DU FICHIER
    // ========================================================

    let file = null;

    const possibleFileFields = [

      "file",

      "files",

      "attachment",

      "media",

      "image",

      "video",

      "document",

    ];


    for (
      const fieldName
      of possibleFileFields
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


    // ========================================================
    // 7. VALIDATION FICHIER
    // ========================================================

    if (!file) {

      return json(res, 400, {

        success: false,

        error:
          "Aucun fichier n'a été reçu.",

      });

    }


    if (
      !file.name &&
      !file.type
    ) {

      return json(res, 400, {

        success: false,

        error:
          "Le fichier reçu est invalide.",

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


    // ========================================================
    // 8. VÉRIFICATION DU SALON SUPABASE
    // ========================================================

    const roomResponse =
      await fetch(

        `${SUPABASE_URL}/rest/v1/rooms` +
        `?id=eq.${encodeURIComponent(roomId)}` +
        `&select=id,name`,

        {

          method: "GET",

          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

            "Content-Type":
              "application/json",

          },

        }

      );


    if (!roomResponse.ok) {

      const roomError =
        await roomResponse.text();


      console.error(
        "Erreur vérification salon :",
        roomError
      );


      return json(res, 500, {

        success: false,

        error:
          "Impossible de vérifier le salon.",

        details:
          roomError,

      });

    }


    const rooms =
      await roomResponse.json();


    if (
      !Array.isArray(rooms) ||
      rooms.length === 0
    ) {

      return json(res, 404, {

        success: false,

        error:
          "Le salon sélectionné n'existe pas.",

        room_id:
          String(roomId),

      });

    }


    const room =
      rooms[0];


    // ========================================================
    // 9. CONVERSION FICHIER → BUFFER
    // ========================================================

    const arrayBuffer =
      await file.arrayBuffer();


    const fileBuffer =
      Buffer.from(arrayBuffer);


    if (
      fileBuffer.length === 0
    ) {

      return json(res, 400, {

        success: false,

        error:
          "Le fichier reçu est vide.",

      });

    }


    // ========================================================
    // 10. UPLOAD CLOUDINARY
    // ========================================================

    const cloudinaryUrl =
      `https://api.cloudinary.com/v1_1/` +
      `${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}` +
      `/auto/upload`;


    const cloudinaryForm =
      new FormData();


    const blob =
      new Blob(

        [
          fileBuffer,
        ],

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


    // Cloudinary détecte automatiquement
    // image / vidéo / PDF / fichier.

    cloudinaryForm.append(

      "resource_type",

      "auto"

    );


    console.log(
      "MAHOUTO+ → Cloudinary",
      {

        name:
          file.name,

        type:
          file.type,

        size:
          fileBuffer.length,

        room_id:
          String(roomId),

      }
    );


    const cloudinaryResponse =
      await fetch(

        cloudinaryUrl,

        {

          method: "POST",

          body:
            cloudinaryForm,

        }

      );


    const cloudinaryText =
      await cloudinaryResponse.text();


    if (
      !cloudinaryResponse.ok
    ) {

      console.error(

        "Cloudinary upload failed :",

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


    // ========================================================
    // 11. LECTURE RÉPONSE CLOUDINARY
    // ========================================================

    let cloudinaryData;


    try {

      cloudinaryData =
        JSON.parse(
          cloudinaryText
        );

    } catch (error) {

      console.error(

        "Réponse Cloudinary invalide :",

        cloudinaryText

      );


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

      console.error(

        "Cloudinary n'a pas retourné d'URL :",

        cloudinaryData

      );


      return json(res, 500, {

        success: false,

        error:
          "Cloudinary n'a pas retourné l'URL du fichier.",

      });

    }


    // ========================================================
    // 12. CRÉATION DU MESSAGE SUPABASE
    // ========================================================

    const messagePayload = {

      room_id:
        String(roomId),

      user_id:
        userId
          ? String(userId)
          : null,

      username:
        String(username),

      content:
        String(caption || ""),

      attachment_url:
        String(attachmentUrl),

      is_deleted:
        false,

      created_at:
        new Date().toISOString(),

    };


    console.log(

      "MAHOUTO+ → Supabase",

      {

        room_id:
          messagePayload.room_id,

        user_id:
          messagePayload.user_id,

        username:
          messagePayload.username,

        content:
          messagePayload.content,

        attachment_url:
          messagePayload.attachment_url,

      }

    );


    // ========================================================
    // 13. INSERT SUPABASE
    // ========================================================

    const messageResponse =
      await fetch(

        `${SUPABASE_URL}/rest/v1/messages`,

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
              messagePayload
            ),

        }

      );


    const messageText =
      await messageResponse.text();


    // ========================================================
    // 14. ERREUR SUPABASE
    // ========================================================

    if (
      !messageResponse.ok
    ) {

      console.error(

        "Erreur Supabase messages :",

        messageText

      );


      return json(res, 500, {

        success: false,

        error:
          "Le fichier a été envoyé sur Cloudinary, mais le message n'a pas pu être enregistré dans MAHOUTO+.",

        cloudinary_url:
          attachmentUrl,

        supabase_error:
          messageText,

      });

    }


    // ========================================================
    // 15. RÉCUPÉRATION DU MESSAGE CRÉÉ
    // ========================================================

    let createdMessage = null;


    try {

      const parsed =
        JSON.parse(
          messageText
        );


      createdMessage =
        Array.isArray(parsed)
          ? parsed[0]
          : parsed;

    } catch (error) {

      console.warn(

        "Impossible de parser la réponse Supabase :",

        messageText

      );

    }


    // ========================================================
    // 16. RÉPONSE FINALE
    // ========================================================

    return json(res, 200, {

      success: true,

      message:
        "Fichier partagé avec succès.",

      room: {

        id:
          room.id,

        name:
          room.name,

      },

      file: {

        name:
          file.name || null,

        type:
          file.type || null,

        size:
          typeof file.size === "number"
            ? file.size
            : fileBuffer.length,

        url:
          attachmentUrl,

      },

      message_data:
        createdMessage,

    });


  } catch (error) {

    // ========================================================
    // ERREUR GÉNÉRALE
    // ========================================================

    console.error(

      "SHARE TARGET ERROR :",

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


// ============================================================
// EXPORT VERCEL
// ============================================================

module.exports = handler;
