import crypto from "crypto";

/**
 * MAHOUTO+ — Partage temporaire (Web Share Target)
 *
 * Fusionné le 24/09/2026 (chantier notifications push, pour libérer une
 * place dans les 12 fonctions Vercel du plan Hobby) : ce fichier gère
 * désormais les deux étapes du même flux, avant seulement séparées en
 * deux fichiers (share-pending-create.js + share-pending.js) :
 *   - POST /api/share-pending  : créer un partage temporaire (ex-create.js)
 *   - GET  /api/share-pending?id=UUID : lire un partage temporaire (inchangé)
 * Comportement strictement identique à avant pour les deux, seul le
 * découpage en fichiers a changé.
 */

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export default async function handler(req, res) {
  if (req.method === "POST") return handleCreate(req, res);
  if (req.method === "GET") return handleRead(req, res);
  return res.status(405).json({ success: false, error: "Méthode non autorisée." });
}

// ==================================================
// POST — création d'un partage temporaire
// (ex api/share-pending-create.js, inchangé)
// ==================================================
async function handleCreate(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) {
    return res.status(500).json({ success: false, error: "Variable SUPABASE_URL manquante." });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: "Variable SUPABASE_SERVICE_ROLE_KEY manquante." });
  }

  const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  if (!CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ success: false, error: "Variable CLOUDINARY_CLOUD_NAME manquante." });
  }

  // Authentification obligatoire — empêche n'importe qui sur Internet
  // d'appeler cette route pour créer des partages arbitraires.
  const authorization = String(req.headers.authorization || "");
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ success: false, error: "Utilisateur non authentifié." });
  }
  const accessToken = authorization.slice(7).trim();
  if (!accessToken) {
    return res.status(401).json({ success: false, error: "Token d'authentification manquant." });
  }

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!userResponse.ok) {
    return res.status(401).json({ success: false, error: "Session utilisateur invalide ou expirée." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (error) {
    return res.status(400).json({ success: false, error: "Le JSON envoyé est invalide." });
  }

  const filename = String(body.filename || "").trim().slice(0, 255);
  const mimeType = String(body.mime_type || "application/octet-stream").trim().slice(0, 150);
  const fileSize = Number(body.file_size || 0);
  const attachmentUrl = String(body.attachment_url || "").trim();
  const caption = String(body.caption || "").trim().slice(0, 2000);
  const title = String(body.title || "").trim().slice(0, 500);
  const sharedUrl = String(body.shared_url || "").trim().slice(0, 2000);

  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return res.status(400).json({ success: false, error: "La taille du fichier est invalide." });
  }
  if (fileSize > 0 && !attachmentUrl) {
    return res.status(400).json({ success: false, error: "L'URL Cloudinary du fichier est manquante." });
  }

  // L'URL doit provenir de VOTRE compte Cloudinary — jamais d'un lien
  // externe arbitraire fourni par le client.
  const expectedCloudinaryPrefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`;
  if (attachmentUrl && !attachmentUrl.startsWith(expectedCloudinaryPrefix)) {
    return res.status(400).json({ success: false, error: "URL de fichier invalide." });
  }

  const shareId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // valide 15 minutes

  let supabaseResponse;
  try {
    supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/share_pending`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        id: shareId,
        filename,
        mime_type: mimeType,
        file_size: fileSize,
        attachment_url: attachmentUrl,
        caption,
        title,
        shared_url: sharedUrl,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error("Erreur réseau Supabase:", error);
    return res.status(500).json({ success: false, error: "Impossible de contacter Supabase." });
  }

  if (!supabaseResponse.ok) {
    const errorText = await supabaseResponse.text();
    console.error("Erreur Supabase share_pending:", errorText);
    return res.status(500).json({ success: false, error: "Impossible de créer le partage temporaire.", details: errorText });
  }

  return res.status(201).json({ success: true, share_id: shareId, expires_at: expiresAt });
}

// ==================================================
// GET — lecture d'un partage temporaire
// (ex api/share-pending.js, inchangé)
// ==================================================
async function handleRead(req, res) {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, error: "Identifiant du partage manquant." });
    }

    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/share_pending?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );

    const text = await response.text();
    if (!response.ok) {
      console.error("share_pending GET:", text);
      return res.status(500).json({ success: false, error: "Impossible de récupérer le partage." });
    }

    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(404).json({ success: false, error: "Partage introuvable ou déjà utilisé." });
    }

    const pending = rows[0];
    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ success: false, error: "Ce partage a expiré." });
    }

    return res.status(200).json({
      success: true,
      share: {
        id: pending.id,
        filename: pending.filename,
        mime_type: pending.mime_type,
        file_size: pending.file_size,
        attachment_url: pending.attachment_url,
        caption: pending.caption || "",
        title: pending.title || "",
        shared_url: pending.shared_url || "",
        expires_at: pending.expires_at
      }
    });
  } catch (error) {
    console.error("SHARE PENDING ERROR:", error);
    return res.status(500).json({ success: false, error: "Erreur interne." });
  }
}
