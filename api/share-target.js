// api/share-target.js

/**
 * MAHOUTO+ — Share Target API
 *
 * Fonctionnement :
 * 1. Reçoit un fichier partagé depuis Android / Galerie.
 * 2. Reçoit le salon sélectionné.
 * 3. Reçoit éventuellement une légende.
 * 4. Upload le fichier sur Cloudinary.
 * 5. Enregistre le message dans Supabase.
 * 6. Retourne les informations du message créé.
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

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB


// ============================================================
// UTILITAIRES
// ============================================================

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }

  return value;
}


function json(res, status, data) {
  res.status(status).json(data);
}


// ============================================================
// HANDLER PRINCIPAL
// ============================================================

export default async function handler(req, res) {

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
  // OPTIONS
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
      error: "Méthode non autorisée. Utilisez POST.",
    });
  }


  try {

    // ========================================================
    // 1. VARIABLES D'ENVIRONNEMENT
    // ========================================================

    const SUPABASE_URL = getEnv("SUPABASE_URL");

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
    // 2. LECTURE DU MULTIPART/FORM-DATA
    // ========================================================

    const contentType =
      req.headers["content-type"] || "";

    if (
      !contentType.toLowerCase().includes(
        "multipart/form-data"
      )
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Le partage doit être envoyé en multipart/form-data.",
        received_content_type: contentType,
      });
    }


    /*
     * Node/Vercel fournit le flux HTTP.
     *
     * On utilise l'API Request native de Node afin de
     * pouvoir utiliser request.formData() sans dépendance
     * supplémentaire.
     */

    const requestUrl =
      `https://${req.headers.host || "localhost"}${req.url}`;

    const request = new Request(requestUrl, {
      method: "POST",

      headers: req.headers,

      body: req,

      duplex: "half",
    });


    const formData =
      await request.formData();


    // ========================================================
    // 3. RÉCUPÉRATION DES CHAMPS
    // ========================================================

    /*
     * On accepte plusieurs noms afin de rester compatible
     * avec différentes versions de l'interface Share Target.
     */

    const roomId =
      formData.get("room_id") ||
      formData.get("roomId") ||
      formData.get("destination") ||
      formData.get("room");

    const userId =
      formData.get("user_id") ||
      formData.get("userId");

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
    // 4. RÉCUPÉRATION DU FICHIER
    // ========================================================

    let file = null;

    /*
     * Les téléphones Android peuvent envoyer le fichier
     * sous différents noms de champ.
     */

    const possibleFileFields = [
      "file",
      "files",
      "attachment",
      "media",
      "image",
      "video",
      "document",
    ];


    for (const fieldName of possibleFileFields) {

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
    // 6. VALIDATION DU FICHIER
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
    // 7. VÉRIFICATION DU SALON DANS SUPABASE
    // ========================================================

    const roomResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,name`,
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
        room_id: roomId,
      });

    }


    const room =
      rooms[0];


    // ========================================================
    // 8. CONVERSION DU FICHIER
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
    // 9. UPLOAD CLOUDINARY
    // ========================================================

    const cloudinaryUrl =
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        CLOUDINARY_CLOUD_NAME
      )}/auto/upload`;


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


    // Important :
    // resource_type=auto permet de gérer
    // image, vidéo, PDF et autres fichiers.

    cloudinaryForm.append(
      "resource_type",
      "auto"
    );


    console.log(
      "Upload Cloudinary :",
      {
        name: file.name,
        type: file.type,
        size: fileBuffer.length,
        room_id: roomId,
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
      cloudinaryData.url;


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
    // 10. CRÉATION DU MESSAGE SUPABASE
    // ========================================================

    /*
     * IMPORTANT :
     *
     * Votre table messages possède notamment :
     *
     * room_id
     * user_id
     * username
     * content
     * created_at
     * attachment_url
     * edited_at
     * is_deleted
     *
     * On enregistre donc explicitement attachment_url.
     */


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
      "Création message MAHOUTO+ :",
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


    const messageResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/messages`,
        {
          method: "POST",

          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY`,

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

      createdMessage =
        null;

    }


    // ========================================================
    // 11. RÉPONSE FINALE
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
          file.size || fileBuffer.length,

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
