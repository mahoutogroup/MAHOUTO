/**
 * MAHOUTO+ — Finalisation du Share Target
 *
 * POST /api/share-finalize
 *
 * Body:
 * {
 *   share_id: "...",
 *   room_id: "general",
 *   caption: "..."
 * }
 */

function getEnv(name) {

  const value =
    process.env[name];

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

  if (req.method !== "POST") {

    return json(res, 405, {
      success: false,
      error:
        "Méthode non autorisée.",
    });
  }


  try {

    // =========================================================
    // 1. ENV
    // =========================================================

    const SUPABASE_URL =
      getEnv("SUPABASE_URL");

    const SUPABASE_SERVICE_ROLE_KEY =
      getEnv(
        "SUPABASE_SERVICE_ROLE_KEY"
      );


    // =========================================================
    // 2. AUTHENTIFICATION
    // =========================================================

    const authorization =
      req.headers.authorization || "";

    if (
      !authorization
        .toLowerCase()
        .startsWith("bearer ")
    ) {

      return json(res, 401, {
        success: false,
        error:
          "Utilisateur non authentifié.",
      });
    }


    const accessToken =
      authorization
        .slice(7)
        .trim();


    if (!accessToken) {

      return json(res, 401, {
        success: false,
        error:
          "Token d'authentification manquant.",
      });
    }


    // =========================================================
    // 3. VÉRIFICATION DU TOKEN SUPABASE
    // =========================================================

    const userResponse =
      await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        {
          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${accessToken}`,
          },
        }
      );


    const userText =
      await userResponse.text();


    if (!userResponse.ok) {

      console.error(
        "Auth verification error:",
        userText
      );

      return json(res, 401, {
        success: false,
        error:
          "Session utilisateur invalide ou expirée.",
      });
    }


    const user =
      JSON.parse(userText);


    if (!user || !user.id) {

      return json(res, 401, {
        success: false,
        error:
          "Utilisateur introuvable.",
      });
    }


    // =========================================================
    // 4. BODY
    // =========================================================

    const body =
      typeof req.body === "object"
        ? req.body
        : {};


    const shareId =
      String(
        body.share_id || ""
      ).trim();

    const roomId =
      String(
        body.room_id || ""
      ).trim();

    const caption =
      String(
        body.caption || ""
      ).trim()
      .slice(0, 2000);


    if (!shareId) {

      return json(res, 400, {
        success: false,
        error:
          "Identifiant du partage manquant.",
      });
    }


    if (!roomId) {

      return json(res, 400, {
        success: false,
        error:
          "Aucun salon sélectionné.",
      });
    }


    // =========================================================
    // 5. RÉCUPÉRATION DU PARTAGE TEMPORAIRE
    // =========================================================

    const pendingResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/share_pending` +
        `?id=eq.${encodeURIComponent(shareId)}` +
        `&select=*`,
        {
          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );


    const pendingText =
      await pendingResponse.text();


    if (!pendingResponse.ok) {

      return json(res, 500, {
        success: false,
        error:
          "Impossible de récupérer le partage temporaire.",
      });
    }


    const pendingRows =
      JSON.parse(pendingText);


    if (
      !Array.isArray(pendingRows) ||
      !pendingRows.length
    ) {

      return json(res, 404, {
        success: false,
        error:
          "Partage introuvable.",
      });
    }


    const pending =
      pendingRows[0];


    // =========================================================
    // 6. EXPIRATION
    // =========================================================

    if (
      pending.expires_at &&
      new Date(
        pending.expires_at
      ).getTime() < Date.now()
    ) {

      return json(res, 410, {
        success: false,
        error:
          "Ce partage a expiré.",
      });
    }


    // =========================================================
    // 7. VÉRIFICATION DU SALON
    // =========================================================

    const roomResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/rooms` +
        `?id=eq.${encodeURIComponent(roomId)}` +
        `&select=id,name`,
        {
          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );


    const roomText =
      await roomResponse.text();


    if (!roomResponse.ok) {

      return json(res, 500, {
        success: false,
        error:
          "Impossible de vérifier le salon.",
      });
    }


    const rooms =
      JSON.parse(roomText);


    if (
      !Array.isArray(rooms) ||
      !rooms.length
    ) {

      return json(res, 404, {
        success: false,
        error:
          "Le salon sélectionné n'existe pas.",
      });
    }


    const room =
      rooms[0];


    // =========================================================
    // 8. RÉCUPÉRER LE PROFIL
    // =========================================================

    const profileResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/profiles` +
        `?id=eq.${encodeURIComponent(user.id)}` +
        `&select=username`,
        {
          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );


    const profileText =
      await profileResponse.text();


    let username =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "Utilisateur MAHOUTO+";


    if (profileResponse.ok) {

      try {

        const profiles =
          JSON.parse(profileText);

        if (
          Array.isArray(profiles) &&
          profiles[0]?.username
        ) {
          username =
            profiles[0].username;
        }

      } catch (_) {}
    }


    // =========================================================
    // 9. TYPE DE PIÈCE JOINTE
    // =========================================================

    let attachmentType =
      "raw";

    const mime =
      pending.mime_type || "";

    if (
      mime.startsWith("image/")
    ) {
      attachmentType = "image";
    } else if (
      mime.startsWith("video/")
    ) {
      attachmentType = "video";
    } else if (
      mime.startsWith("audio/")
    ) {
      attachmentType = "audio";
    }


    // =========================================================
    // 10. MESSAGE
    // =========================================================

    const finalContent =
      caption ||
      pending.caption ||
      "";


    const messagePayload = {

      room_id:
        room.id,

      user_id:
        user.id,

      username:
        username,

      content:
        finalContent,

      attachment_url:
        pending.attachment_url,

      attachment_type:
        attachmentType,

      is_deleted:
        false,

      created_at:
        new Date().toISOString(),
    };


    // =========================================================
    // 11. INSERTION MESSAGE
    // =========================================================

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


    if (!messageResponse.ok) {

      console.error(
        "Message insertion error:",
        messageText
      );

      return json(res, 500, {
        success: false,
        error:
          "Le message n'a pas pu être publié.",
        details:
          messageText,
      });
    }


    // =========================================================
    // 12. SUPPRESSION DU PARTAGE TEMPORAIRE
    // =========================================================

    const deleteResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/share_pending` +
        `?id=eq.${encodeURIComponent(shareId)}`,
        {
          method: "DELETE",

          headers: {

            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );


    if (!deleteResponse.ok) {

      console.warn(
        "Le message est publié mais le partage temporaire n'a pas été supprimé."
      );
    }


    // =========================================================
    // 13. RÉPONSE
    // =========================================================

    return json(res, 200, {

      success: true,

      message:
        "Fichier publié avec succès.",

      room: {
        id:
          room.id,

        name:
          room.name,
      },

      user: {
        id:
          user.id,

        username:
          username,
      },

      attachment: {
        url:
          pending.attachment_url,

        type:
          attachmentType,

        filename:
          pending.filename,
      },
    });


  } catch (error) {

    console.error(
      "SHARE FINALIZE ERROR:",
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Erreur interne lors de la publication.",

      details:
        error?.message ||
        String(error),
    });
  }
}

module.exports = handler;
