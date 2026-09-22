// =========================================================
// /api/cloudinary-sign.js
// Génère les paramètres signés pour un envoi direct depuis le
// navigateur vers Cloudinary, sans jamais exposer la clé secrète.
//
// SÉCURITÉ :
// - exige une session Supabase valide (Authorization: Bearer) ;
// - valide désormais l'EXTENSION du fichier contre une liste
//   blanche côté serveur (jamais l'attribut "accept" du client,
//   qui n'est qu'un confort d'UI) ;
// - décide, selon la destination (salon gratuit / salon payant /
//   message privé), si le fichier doit être uploadé en mode
//   Cloudinary "authenticated" (livraison protégée, voir
//   /api/attachment-url.js) ou "upload" (public, comme avant —
//   uniquement pour les salons gratuits, où la fuite d'une URL
//   n'expose rien qu'un visiteur ne pourrait déjà lire en
//   rejoignant gratuitement le salon) ;
// - pour un salon payant, vérifie ici aussi (en plus des RLS sur
//   la table "messages") que l'utilisateur a bien payé — évite
//   qu'un non-payeur obtienne même une signature d'upload.
//
// Variables d'environnement Vercel attendues :
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY   (nouveau — déjà utilisé ailleurs
//                                 dans l'app, ex. digital-products-
//                                 download.js. Nécessaire ici pour
//                                 lire rooms/purchases/dm_conversations
//                                 indépendamment des RLS afin de
//                                 décider public/authenticated.)
// =========================================================

import crypto from "crypto";
import {
  getAuthenticatedUser,
  getAdminClient,
  isExtensionAllowed,
  canAccessRoom,
  canAccessDm,
  getUserRole
} from "./_attachment-rules.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { user, error: authError, status: authStatus } = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(authStatus || 401).json({ error: authError });
  }

  // -------- Fichier annoncé --------
  const filename = String(req.query.filename || "");
  if (!filename || !isExtensionAllowed(filename)) {
    return res.status(415).json({ error: "Type de fichier non autorisé." });
  }

  // -------- Contexte (salon ou message privé) --------
  const context = req.query.context === "dm" ? "dm" : "room";
  const contextId = String(req.query.contextId || "");
  if (!contextId) {
    return res.status(400).json({ error: "Contexte manquant." });
  }

  const admin = getAdminClient();
  if (!admin) {
    return res.status(500).json({ error: "Configuration Supabase (service role) manquante sur Vercel" });
  }

  let accessType = "upload"; // "upload" = public (Cloudinary par défaut), "authenticated" = livraison protégée

  if (context === "dm") {
    const allowed = await canAccessDm(admin, user.id, contextId);
    if (!allowed) return res.status(403).json({ error: "Conversation non autorisée." });
    accessType = "authenticated"; // un DM est toujours privé
  } else {
    const role = await getUserRole(admin, user.id);
    const { allowed, room } = await canAccessRoom(admin, user.id, contextId, role);
    if (!allowed) return res.status(403).json({ error: "Salon non autorisé." });
    accessType = room && room.is_paid ? "authenticated" : "upload";
  }

  // -------- Génération de la signature Cloudinary --------
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Variables Cloudinary manquantes sur Vercel" });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = "mahoutoplus";

  // La signature Cloudinary est un SHA-1 des paramètres triés
  // alphabétiquement + la clé secrète. "type" ne doit être inclus
  // que lorsqu'il diffère de la valeur par défaut ("upload"), pour
  // rester compatible avec les uploads publics déjà en place.
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
