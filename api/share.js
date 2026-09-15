/**
 * MAHOUTO+ — Partage temporaire (share_pending) et finalisation
 *
 * Fusion de api/share-pending-create.js + api/share-pending.js +
 * api/share-finalize.js (consolidation pour rester sous la limite de
 * Serverless Functions du plan Vercel Hobby). Comportement et
 * sécurité inchangés pour chacun des trois cas — seul le point
 * d'entrée est désormais unique, avec dispatch par méthode HTTP et
 * par body.mode :
 *
 *   GET  /api/share?id=UUID                -> lecture d'un partage en attente
 *   POST /api/share  { mode: "create", ... }   -> création d'un partage en attente
 *   POST /api/share  { mode: "finalize", ... } -> publication du partage dans un salon
 *
 * Flux complet (upload direct depuis share.html vers Cloudinary,
 * indépendant du Service Worker) :
 *
 * Fichier choisi dans share.html
 *          ↓
 * Upload direct vers Cloudinary (signé)
 *          ↓
 * POST /api/share { mode: "create" }
 *          ↓
 * choix du salon
 *          ↓
 * POST /api/share { mode: "finalize" }
 *          ↓
 * messages
 */

import crypto from "crypto";

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

function json(res, status, data) {
  return res.status(status).json(data);
}

function cleanString(value, maxLength = 2000) {
  return String(value || "").trim().slice(0, maxLength);
}

// -------- GET : lecture d'un partage en attente --------
async function handleGet(req, res) {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return json(res, 400, { success: false, error: "Identifiant du partage manquant." });
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
      return json(res, 500, { success: false, error: "Impossible de récupérer le partage." });
    }

    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || !rows.length) {
      return json(res, 404, { success: false, error: "Partage introuvable ou déjà utilisé." });
    }

    const pending = rows[0];
    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return json(res, 410, { success: false, error: "Ce partage a expiré." });
    }

    return json(res, 200, {
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
    return json(res, 500, { success: false, error: "Erreur interne." });
  }
}

// -------- POST mode="create" : créer un partage en attente --------
async function handleCreate(req, res, body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) return json(res, 500, { success: false, error: "Variable SUPABASE_URL manquante." });
  if (!SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { success: false, error: "Variable SUPABASE_SERVICE_ROLE_KEY manquante." });

  const filename = String(body.filename || "").trim().slice(0, 255);
  const mimeType = String(body.mime_type || "application/octet-stream").trim().slice(0, 150);
  const fileSize = Number(body.file_size || 0);
  const attachmentUrl = String(body.attachment_url || "").trim();
  const caption = String(body.caption || "").trim().slice(0, 2000);
  const title = String(body.title || "").trim().slice(0, 500);
  const sharedUrl = String(body.shared_url || "").trim().slice(0, 2000);

  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return json(res, 400, { success: false, error: "La taille du fichier est invalide." });
  }
  if (fileSize > 0 && !attachmentUrl) {
    return json(res, 400, { success: false, error: "L'URL Cloudinary du fichier est manquante." });
  }

  const shareId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

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
        id: shareId, filename, mime_type: mimeType, file_size: fileSize,
        attachment_url: attachmentUrl, caption, title, shared_url: sharedUrl,
        expires_at: expiresAt, created_at: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error("Erreur réseau Supabase:", error);
    return json(res, 500, { success: false, error: "Impossible de contacter Supabase." });
  }

  if (!supabaseResponse.ok) {
    const errorText = await supabaseResponse.text();
    console.error("Erreur Supabase share_pending:", errorText);
    return json(res, 500, { success: false, error: "Impossible de créer le partage temporaire.", details: errorText });
  }

  return json(res, 201, { success: true, share_id: shareId, expires_at: expiresAt });
}

// -------- POST mode="finalize" : publier le partage dans un salon --------
async function handleFinalize(req, res, body) {
  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authorization = req.headers.authorization || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return json(res, 401, { success: false, error: "Utilisateur non authentifié." });
    }
    const accessToken = authorization.slice(7).trim();
    if (!accessToken) {
      return json(res, 401, { success: false, error: "Token d'authentification manquant." });
    }

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    const userText = await userResponse.text();
    if (!userResponse.ok) {
      console.error("Auth verification error:", userText);
      return json(res, 401, { success: false, error: "Session utilisateur invalide ou expirée." });
    }
    const user = JSON.parse(userText);
    if (!user || !user.id) {
      return json(res, 401, { success: false, error: "Utilisateur introuvable." });
    }

    const shareId = String(body.share_id || "").trim();
    const roomId = String(body.room_id || "").trim();
    const caption = String(body.caption || "").trim().slice(0, 2000);

    if (!shareId) return json(res, 400, { success: false, error: "Identifiant du partage manquant." });
    if (!roomId) return json(res, 400, { success: false, error: "Aucun salon sélectionné." });

    const pendingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/share_pending?id=eq.${encodeURIComponent(shareId)}&select=*`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const pendingText = await pendingResponse.text();
    if (!pendingResponse.ok) {
      return json(res, 500, { success: false, error: "Impossible de récupérer le partage temporaire." });
    }
    const pendingRows = JSON.parse(pendingText);
    if (!Array.isArray(pendingRows) || !pendingRows.length) {
      return json(res, 404, { success: false, error: "Partage introuvable." });
    }
    const pending = pendingRows[0];

    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return json(res, 410, { success: false, error: "Ce partage a expiré." });
    }

    const roomResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,name`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const roomText = await roomResponse.text();
    if (!roomResponse.ok) {
      return json(res, 500, { success: false, error: "Impossible de vérifier le salon." });
    }
    const rooms = JSON.parse(roomText);
    if (!Array.isArray(rooms) || !rooms.length) {
      return json(res, 404, { success: false, error: "Le salon sélectionné n'existe pas." });
    }
    const room = rooms[0];

    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=username`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const profileText = await profileResponse.text();
    let username = user.user_metadata?.full_name || user.user_metadata?.name
      || user.email?.split("@")[0] || "Utilisateur MAHOUTO+";
    if (profileResponse.ok) {
      try {
        const profiles = JSON.parse(profileText);
        if (Array.isArray(profiles) && profiles[0]?.username) username = profiles[0].username;
      } catch (_) { /* garde le nom par défaut */ }
    }

    let attachmentType = "raw";
    const mime = pending.mime_type || "";
    if (mime.startsWith("image/")) attachmentType = "image";
    else if (mime.startsWith("video/")) attachmentType = "video";
    else if (mime.startsWith("audio/")) attachmentType = "audio";

    const finalContent = caption || pending.caption || "";
    const messagePayload = {
      room_id: room.id, user_id: user.id, username, content: finalContent,
      attachment_url: pending.attachment_url, attachment_type: attachmentType,
      is_deleted: false, created_at: new Date().toISOString()
    };

    const messageResponse = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(messagePayload)
    });
    const messageText = await messageResponse.text();
    if (!messageResponse.ok) {
      console.error("Message insertion error:", messageText);
      return json(res, 500, { success: false, error: "Le message n'a pas pu être publié.", details: messageText });
    }

    const deleteResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/share_pending?id=eq.${encodeURIComponent(shareId)}`,
      { method: "DELETE", headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    if (!deleteResponse.ok) {
      console.warn("Le message est publié mais le partage temporaire n'a pas été supprimé.");
    }

    return json(res, 200, {
      success: true,
      message: "Fichier publié avec succès.",
      room: { id: room.id, name: room.name },
      user: { id: user.id, username },
      attachment: { url: pending.attachment_url, type: attachmentType, filename: pending.filename }
    });
  } catch (error) {
    console.error("SHARE FINALIZE ERROR:", error);
    return json(res, 500, { success: false, error: "Erreur interne lors de la publication.", details: error?.message || String(error) });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleGet(req, res);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { success: false, error: "Méthode non autorisée." });
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const mode = body.mode === "finalize" ? "finalize" : "create";

  if (mode === "finalize") {
    return handleFinalize(req, res, body);
  }
  return handleCreate(req, res, body);
}
