// =========================================================
// /api/cloudinary-sign.js
// Génère les paramètres signés pour un envoi direct depuis le
// navigateur vers Cloudinary, sans jamais exposer la clé secrète.
//
// SÉCURITÉ : cette route exige désormais un jeton de session
// Supabase valide (envoyé par le client dans l'en-tête
// Authorization: Bearer <token>). Sans session valide, aucune
// signature n'est délivrée — empêche n'importe qui sur Internet
// d'appeler cette route directement pour abuser du stockage
// Cloudinary sans jamais passer par l'app.
//
// Variables d'environnement Vercel attendues :
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
//   SUPABASE_URL           (même valeur que dans config.js)
//   SUPABASE_ANON_KEY      (même valeur que dans config.js —
//                           publique par design, protégée par RLS)
// =========================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // -------- Vérification de la session Supabase --------
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel" });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData || !userData.user) {
    return res.status(401).json({ error: "Session invalide ou expirée." });
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

  // La signature Cloudinary est un SHA-1 des paramètres triés + la clé secrète
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

  return res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    folder,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`
  });
}
