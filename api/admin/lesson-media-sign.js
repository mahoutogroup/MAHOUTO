// =========================================================
// /api/admin/lesson-media-sign.js
// Autorise un envoi direct (vidéo Cloudinary ou PDF Supabase Storage)
// pour une leçon de formation — réservé aux administrateurs.
//
// SÉCURITÉ :
// - Jeton Supabase + rôle admin/super_admin/founder vérifiés côté
//   serveur, exactement comme api/admin/formation-curriculum.js.
// - Le dossier/chemin de destination est TOUJOURS choisi par le
//   serveur (jamais fourni par le client) : "mahoutoplus/lessons"
//   pour Cloudinary, "lessons/<horodatage>-<nom>" pour Supabase
//   Storage. Un administrateur malveillant ne peut pas écraser un
//   fichier arbitraire ni sortir de ces dossiers.
// - Pour le PDF, on ne renvoie jamais une clé permanente : une URL
//   d'upload signée à durée très courte (createSignedUploadUrl) est
//   générée à la demande, sur le bucket privé "formation-media".
//
// Actions (POST, body.action) :
//   "video" : { }                 -> signature Cloudinary (resource_type=video)
//   "pdf"   : { fileName }        -> URL d'upload signée + chemin final
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// =========================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function safeStorageName(name) {
  return String(name || "fichier")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-150);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const callerRole = callerProfile ? callerProfile.role : "user";
  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }

  const body = req.body || {};

  if (body.action === "video") {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ error: "Variables Cloudinary manquantes sur Vercel." });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "mahoutoplus/lessons";
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

    return res.status(200).json({
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`
    });
  }

  if (body.action === "pdf") {
    const fileName = safeStorageName(body.fileName);
    const path = "lessons/" + Date.now() + "-" + fileName;

    const { data, error } = await supabaseAdmin
      .storage
      .from("formation-media")
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error("Erreur génération URL d'upload signée (leçon) :", error);
      return res.status(500).json({ error: "Impossible de préparer l'envoi du document." });
    }

    return res.status(200).json({
      path,
      token: data.token,
      signedUrl: data.signedUrl
    });
  }

  return res.status(400).json({ error: "Action inconnue." });
}
