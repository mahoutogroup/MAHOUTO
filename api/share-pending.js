/**
 * MAHOUTO+ — Lecture d'un partage temporaire
 *
 * GET /api/share-pending?id=UUID
 */

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}`
    );
  }

  return value;
}

async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Méthode non autorisée.",
    });
  }

  try {

    const id =
      String(req.query.id || "").trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        error:
          "Identifiant du partage manquant.",
      });
    }

    const SUPABASE_URL =
      getEnv("SUPABASE_URL");

    const SUPABASE_SERVICE_ROLE_KEY =
      getEnv(
        "SUPABASE_SERVICE_ROLE_KEY"
      );


    const response =
      await fetch(
        `${SUPABASE_URL}/rest/v1/share_pending` +
        `?id=eq.${encodeURIComponent(id)}` +
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


    const text =
      await response.text();


    if (!response.ok) {

      console.error(
        "share_pending GET:",
        text
      );

      return res.status(500).json({
        success: false,
        error:
          "Impossible de récupérer le partage.",
      });
    }


    const rows =
      JSON.parse(text);


    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {

      return res.status(404).json({
        success: false,
        error:
          "Partage introuvable ou déjà utilisé.",
      });
    }


    const pending =
      rows[0];


    if (
      pending.expires_at &&
      new Date(
        pending.expires_at
      ).getTime() < Date.now()
    ) {

      return res.status(410).json({
        success: false,
        error:
          "Ce partage a expiré.",
      });
    }


    return res.status(200).json({
      success: true,
      share: {
        id: pending.id,
        filename: pending.filename,
        mime_type: pending.mime_type,
        file_size: pending.file_size,
        attachment_url:
          pending.attachment_url,
        caption: pending.caption || "",
        title: pending.title || "",
        shared_url:
          pending.shared_url || "",
        expires_at:
          pending.expires_at,
      },
    });


  } catch (error) {

    console.error(
      "SHARE PENDING ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Erreur interne.",
    });
  }
}

module.exports = handler;
