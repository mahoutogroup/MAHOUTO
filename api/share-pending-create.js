const crypto = require("crypto");

module.exports = async function handler(req, res) {
  // ==================================================
  // 1. Vérification de la méthode
  // ==================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Méthode non autorisée."
    });
  }

  // ==================================================
  // 2. Variables d'environnement
  // ==================================================

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "Variable SUPABASE_URL manquante."
    });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      success: false,
      error:
        "Variable SUPABASE_SERVICE_ROLE_KEY manquante."
    });
  }

  // ==================================================
  // 3. Lecture du body JSON
  // ==================================================

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: "Le JSON envoyé est invalide."
    });
  }

  // ==================================================
  // 4. Récupération et nettoyage des données
  // ==================================================

  const filename = String(body.filename || "")
    .trim()
    .slice(0, 255);

  const mimeType = String(
    body.mime_type || "application/octet-stream"
  )
    .trim()
    .slice(0, 150);

  const fileSize = Number(body.file_size || 0);

  const attachmentUrl = String(
    body.attachment_url || ""
  ).trim();

  const caption = String(body.caption || "")
    .trim()
    .slice(0, 2000);

  const title = String(body.title || "")
    .trim()
    .slice(0, 500);

  const sharedUrl = String(body.shared_url || "")
    .trim()
    .slice(0, 2000);

  // ==================================================
  // 5. Validation
  // ==================================================

  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return res.status(400).json({
      success: false,
      error: "La taille du fichier est invalide."
    });
  }

  /*
   * Si un fichier a été envoyé, Cloudinary doit avoir
   * fourni une URL.
   */
  if (fileSize > 0 && !attachmentUrl) {
    return res.status(400).json({
      success: false,
      error:
        "L'URL Cloudinary du fichier est manquante."
    });
  }

  // ==================================================
  // 6. Génération d'un identifiant unique
  // ==================================================

  const shareId = crypto.randomUUID();

  // ==================================================
  // 7. Expiration du partage
  // ==================================================
  //
  // Le partage temporaire reste valide 15 minutes.
  //

  const expiresAt = new Date(
    Date.now() + 15 * 60 * 1000
  ).toISOString();

  // ==================================================
  // 8. Insertion dans Supabase
  // ==================================================

  let supabaseResponse;

  try {
    supabaseResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/share_pending`,
      {
        method: "POST",

        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Prefer: "return=minimal"
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
  } catch (error) {
    console.error(
      "Erreur réseau Supabase:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Impossible de contacter Supabase."
    });
  }

  // ==================================================
  // 9. Gestion des erreurs Supabase
  // ==================================================

  if (!supabaseResponse.ok) {
    const errorText =
      await supabaseResponse.text();

    console.error(
      "Erreur Supabase share_pending:",
      errorText
    );

    return res.status(500).json({
      success: false,
      error:
        "Impossible de créer le partage temporaire.",
      details: errorText
    });
  }

  // ==================================================
  // 10. Réponse
  // ==================================================

  return res.status(201).json({
    success: true,

    share_id: shareId,

    expires_at: expiresAt
  });
};
