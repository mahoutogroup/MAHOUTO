const crypto = require("crypto");

module.exports = async function handler(req, res) {

  // ====================================================
  // METHOD
  // ====================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Méthode non autorisée."
    });
  }


  // ====================================================
  // ENV
  // ====================================================

  const SUPABASE_URL =
    process.env.SUPABASE_URL;

  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


  if (!SUPABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "SUPABASE_URL manquant."
    });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      success: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY manquant."
    });
  }


  // ====================================================
  // BODY
  // ====================================================

  let body;

  try {

    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

  } catch (error) {

    return res.status(400).json({
      success: false,
      error: "JSON invalide."
    });
  }


  // ====================================================
  // DONNÉES
  // ====================================================

  const filename =
    String(body.filename || "")
      .trim()
      .slice(0, 255);

  const mimeType =
    String(
      body.mime_type ||
      "application/octet-stream"
    )
      .trim()
      .slice(0, 150);

  const fileSize =
    Number(body.file_size || 0);

  const attachmentUrl =
    String(body.attachment_url || "")
      .trim();

  const caption =
    String(body.caption || "")
      .trim()
      .slice(0, 2000);

  const title =
    String(body.title || "")
      .trim()
      .slice(0, 500);

  const sharedUrl =
    String(body.shared_url || "")
      .trim()
      .slice(0, 2000);


  // ====================================================
  // VALIDATION
  // ====================================================

  if (!attachmentUrl && fileSize > 0) {

    return res.status(400).json({
      success: false,
      error:
        "URL Cloudinary manquante."
    });
  }

  if (!Number.isFinite(fileSize) || fileSize < 0) {

    return res.status(400).json({
      success: false,
      error:
        "Taille de fichier invalide."
    });
  }


  // ====================================================
  // ID
  // ====================================================

  const shareId =
    crypto.randomUUID();


  // ====================================================
  // EXPIRATION
  // ====================================================
  //
  // 15 minutes pour terminer le partage.
  //

  const expiresAt =
    new Date(
      Date.now() + 15 * 60 * 1000
    ).toISOString();


  // ====================================================
  // INSERT SUPABASE
  // ====================================================

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/share_pending`,
      {
        method: "POST",

        headers: {
          "apikey":
            SUPABASE_SERVICE_ROLE_KEY,

          "Authorization":
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },

        body: JSON.stringify({
          id: shareId,

          filename,

          mime_type: mimeType,

          file_size: fileSize,

          attachment_url:
            attachmentUrl,

          caption,

          title,

          shared_url:
            sharedUrl,

          expires_at:
            expiresAt,

          created_at:
            new Date().toISOString()
        })
      }
    );


  // ====================================================
  // ERREUR SUPABASE
  // ====================================================

  if (!response.ok) {

    const errorText =
      await response.text();

    console.error(
      "Supabase share_pending error:",
      errorText
    );

    return res.status(500).json({
      success: false,
      error:
        "Impossible de créer le partage temporaire.",
      details:
        errorText
    });
  }


  // ====================================================
  // SUCCÈS
  // ====================================================

  return res.status(201).json({
    success: true,
    share_id: shareId,
    expires_at: expiresAt
  });
};
