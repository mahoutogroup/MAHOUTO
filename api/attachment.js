// =========================================================
// /api/attachment.js
//
// Fusion de deux routes en UNE SEULE fonction Vercel, pour rester
// sous la limite de 12 Serverless Functions du plan Hobby :
//   - GET  -> signature d'upload (ex api/cloudinary-sign.js)
//   - POST -> livraison protégée / résolution d'URL signée
//             (ex api/attachment-url.js)
// Choisi précisément parce que ces deux routes appartiennent au
// même système (pièces jointes) et n'ont AUCUNE logique commune
// avec FedaPay/School/admin — aucune autre fonction n'a été
// touchée pour libérer ce slot. Le comportement de chaque branche
// est inchangé à l'identique, seul le fichier qui les héberge a
// changé.
//
// Variables d'environnement Vercel (inchangées) :
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =========================================================

import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import {
  getAuthenticatedUser,
  getAdminClient,
  isExtensionAllowed,
  canAccessRoom,
  canAccessDm,
  getUserRole
} from "./_attachment-rules.js";

const DOWNLOAD_TTL_SECONDS = 15 * 60; // 15 minutes — aligné sur digital-products-download.js

export default async function handler(req, res) {
  if (req.method === "GET") return handleSign(req, res);
  if (req.method === "POST") return handleResolve(req, res);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Méthode non autorisée" });
}

// =========================================================
// GET — signature d'upload (identique à l'ancien cloudinary-sign.js)
// =========================================================
async function handleSign(req, res) {
  const { user, error: authError, status: authStatus } = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(authStatus || 401).json({ error: authError });
  }

  const filename = String(req.query.filename || "");
  if (!filename || !isExtensionAllowed(filename)) {
    return res.status(415).json({ error: "Type de fichier non autorisé." });
  }

  const context = req.query.context === "dm" ? "dm" : "room";
  const contextId = String(req.query.contextId || "");
  if (!contextId) {
    return res.status(400).json({ error: "Contexte manquant." });
  }

  const admin = getAdminClient();
  if (!admin) {
    return res.status(500).json({ error: "Configuration Supabase (service role) manquante sur Vercel" });
  }

  let accessType = "upload";

  if (context === "dm") {
    const allowed = await canAccessDm(admin, user.id, contextId);
    if (!allowed) return res.status(403).json({ error: "Conversation non autorisée." });
    accessType = "authenticated";
  } else {
    const role = await getUserRole(admin, user.id);
    const { allowed, room } = await canAccessRoom(admin, user.id, contextId, role);
    if (!allowed) return res.status(403).json({ error: "Salon non autorisé." });
    accessType = room && room.is_paid ? "authenticated" : "upload";
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Variables Cloudinary manquantes sur Vercel" });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = "mahoutoplus";

  const paramsToSign =
    accessType === "authenticated"
      ? `folder=${folder}&timestamp=${timestamp}&type=authenticated${apiSecret}`
      : `folder=${folder}&timestamp=${timestamp}${apiSecret}`;

  const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

  return res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    folder,
    signature,
    type: accessType === "authenticated" ? "authenticated" : undefined,
    accessType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`
  });
}

// =========================================================
// POST — livraison protégée (identique à l'ancien attachment-url.js)
// =========================================================
async function handleResolve(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const { user, error: authError, status: authStatus } = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(authStatus || 401).json({ error: authError });
  }

  const { context, contextId, messageIds } = req.body || {};
  if (!contextId || !Array.isArray(messageIds) || !messageIds.length || messageIds.length > 100) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  const ctx = context === "dm" ? "dm" : "room";

  const admin = getAdminClient();
  if (!admin) {
    return res.status(500).json({ error: "Configuration Supabase (service role) manquante sur Vercel" });
  }

  if (ctx === "dm") {
    const allowed = await canAccessDm(admin, user.id, contextId);
    if (!allowed) return res.status(403).json({ error: "Conversation non autorisée." });
  } else {
    const role = await getUserRole(admin, user.id);
    const { allowed } = await canAccessRoom(admin, user.id, contextId, role);
    if (!allowed) return res.status(403).json({ error: "Salon non autorisé." });
  }

  const table = ctx === "dm" ? "dm_messages" : "messages";
  const contextColumn = ctx === "dm" ? "conversation_id" : "room_id";

  const { data: rows, error: rowsError } = await admin
    .from(table)
    .select("id, attachment_public_id, attachment_resource_type, attachment_name, attachment_access, " + contextColumn)
    .in("id", messageIds)
    .eq(contextColumn, contextId)
    .eq("attachment_access", "authenticated");

  if (rowsError) {
    console.error("attachment (resolve) rows error:", rowsError);
    return res.status(500).json({ error: "Impossible de vérifier ces pièces jointes." });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Variables Cloudinary manquantes sur Vercel" });
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

  const expiresAt = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const urls = {};

  for (const row of rows || []) {
    if (!row.attachment_public_id) continue;
    const resourceType = row.attachment_resource_type || "raw";
    const ext = (String(row.attachment_name || "").split(".").pop() || "").toLowerCase();
    const isPdf = ext === "pdf";

    try {
      const viewUrl = cloudinary.url(row.attachment_public_id, {
        resource_type: resourceType,
        type: "authenticated",
        sign_url: true,
        secure: true
      });

      let previewUrl = null;
      if (resourceType === "image") {
        previewUrl = cloudinary.url(row.attachment_public_id, {
          resource_type: "image",
          type: "authenticated",
          sign_url: true,
          secure: true,
          transformation: isPdf
            ? [{ page: 1, format: "jpg", width: 500, crop: "limit", quality: "auto" }]
            : [{ width: 900, crop: "limit", quality: "auto" }]
        });
      }

      const downloadUrl = cloudinary.utils.private_download_url(row.attachment_public_id, ext || undefined, {
        resource_type: resourceType,
        type: "authenticated",
        expires_at: expiresAt,
        attachment: true
      });

      urls[row.id] = { url: viewUrl, previewUrl: previewUrl, downloadUrl: downloadUrl };
    } catch (err) {
      console.error("Signature Cloudinary impossible pour", row.id, err);
    }
  }

  return res.status(200).json({ urls, expiresIn: DOWNLOAD_TTL_SECONDS });
}
