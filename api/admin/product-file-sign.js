// =========================================================
// /api/admin/product-file-sign.js
// Autorise l'envoi direct d'un fichier de produit numérique vers le
// bucket Storage privé "digital-products" — réservé aux administrateurs.
//
// SÉCURITÉ : même modèle que api/admin/lesson-media-sign.js. Le chemin
// de destination est TOUJOURS "products/<horodatage>-<nom>", choisi
// par le serveur — jamais un chemin arbitraire fourni par le client.
// Une URL d'upload signée à durée courte (createSignedUploadUrl) est
// générée à la demande ; aucune clé permanente n'est exposée.
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =========================================================

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
  const fileName = safeStorageName(body.fileName);
  const path = "products/" + Date.now() + "-" + fileName;

  const { data, error } = await supabaseAdmin
    .storage
    .from("digital-products")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("Erreur génération URL d'upload signée (produit) :", error);
    return res.status(500).json({ error: "Impossible de préparer l'envoi du fichier." });
  }

  return res.status(200).json({ path, token: data.token, signedUrl: data.signedUrl });
}
