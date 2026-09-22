// =========================================================
// /api/attachment-url.js
//
// Livraison protégée des pièces jointes "authenticated" (messages
// privés + salons payants). Le client n'appelle CETTE route QUE
// pour les messages dont attachment_access = "authenticated" —
// les pièces jointes publiques (salons gratuits) continuent
// d'utiliser directement attachment_url, sans appel réseau
// supplémentaire.
//
// Pour chaque message demandé, la route vérifie, dans cet ordre :
//   1. authentification (session Supabase valide) ;
//   2. contexte (salon ou conversation privée) existant ;
//   3. autorisation exacte : mêmes règles que les RLS déjà en
//      place sur "messages" / "dm_messages" (achat validé pour un
//      salon payant, ou participant pour un DM) ;
//   4. le message demandé appartient bien à ce contexte.
// Seulement alors une URL Cloudinary SIGNÉE est générée côté
// serveur (jamais la clé secrète elle-même n'est envoyée au
// client). Sans session valide ou sans autorisation, aucune URL
// n'est renvoyée — connaître l'URL publique Cloudinary d'origine
// ne suffit plus à accéder au fichier.
//
// Deux liens sont renvoyés par pièce jointe :
//   - "url"        : lien de TÉLÉCHARGEMENT/OUVERTURE, limité dans
//                     le temps (private_download_url, ~15 min),
//                     même principe que /api/digital-products-download.js ;
//   - "previewUrl"  : lien d'AFFICHAGE en ligne (miniature image/
//                     vidéo/audio/PDF page 1), signé (impossible à
//                     deviner sans la clé secrète) mais non limité
//                     dans le temps — Cloudinary ne permet pas de
//                     limiter dans le temps une transformation à la
//                     volée sans l'option payante "Token
//                     Authentication". Uniquement pour les images/
//                     vidéos/audio/PDF ; absent pour les fichiers
//                     génériques (docx, zip...), qui n'ont pas
//                     d'aperçu.
//
// Variables d'environnement Vercel attendues : les mêmes que
// cloudinary-sign.js, plus SUPABASE_SERVICE_ROLE_KEY.
// =========================================================

import { v2 as cloudinary } from "cloudinary";
import {
  getAuthenticatedUser,
  getAdminClient,
  canAccessRoom,
  canAccessDm,
  getUserRole
} from "./_attachment-rules.js";

const DOWNLOAD_TTL_SECONDS = 15 * 60; // 15 minutes — aligné sur digital-products-download.js

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

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

  // -------- Autorisation sur le contexte (identique aux RLS) --------
  if (ctx === "dm") {
    const allowed = await canAccessDm(admin, user.id, contextId);
    if (!allowed) return res.status(403).json({ error: "Conversation non autorisée." });
  } else {
    const role = await getUserRole(admin, user.id);
    const { allowed } = await canAccessRoom(admin, user.id, contextId, role);
    if (!allowed) return res.status(403).json({ error: "Salon non autorisé." });
  }

  // -------- Récupération des messages demandés, dans CE contexte uniquement --------
  const table = ctx === "dm" ? "dm_messages" : "messages";
  const contextColumn = ctx === "dm" ? "conversation_id" : "room_id";

  const { data: rows, error: rowsError } = await admin
    .from(table)
    .select("id, attachment_public_id, attachment_resource_type, attachment_name, attachment_access, " + contextColumn)
    .in("id", messageIds)
    .eq(contextColumn, contextId)
    .eq("attachment_access", "authenticated");

  if (rowsError) {
    console.error("attachment-url rows error:", rowsError);
    return res.status(500).json({ error: "Impossible de vérifier ces pièces jointes." });
  }

  // -------- Configuration Cloudinary (clé secrète UNIQUEMENT côté serveur) --------
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
      // Lien d'AFFICHAGE en ligne de l'original (signé, non deviné,
      // mais non limité dans le temps) — utilisé comme src <video>/
      // <audio>, ou comme lien "Ouvrir" pour un PDF (pas de
      // Content-Disposition:attachment, pour laisser le navigateur
      // afficher le PDF au lieu de forcer un téléchargement).
      const viewUrl = cloudinary.url(row.attachment_public_id, {
        resource_type: resourceType,
        type: "authenticated",
        sign_url: true,
        secure: true
      });

      // Miniature légère (image redimensionnée, ou page 1 pour un
      // PDF) — c'est CETTE url qui doit servir de src pour l'aperçu
      // dans la bulle de message, jamais le fichier original en
      // pleine résolution.
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

      // Lien de TÉLÉCHARGEMENT forcé, limité dans le temps —
      // uniquement utile pour le bouton "Télécharger" des cartes
      // génériques (docx, zip, psd...) et comme repli de secours.
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
