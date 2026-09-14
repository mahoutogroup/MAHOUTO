// =========================================================
// /api/admin/formations.js
// Gestion administrative du catalogue de formations
// (lecture complète, création, mise à jour, suppression).
//
// SÉCURITÉ :
// - Exige un jeton de session Supabase valide (Authorization: Bearer)
// - Vérifie que ce compte a le rôle admin/super_admin/founder dans
//   "profiles", AVANT toute lecture ou écriture — jamais fait confiance
//   au frontend, qui ne sert qu'à masquer/afficher le formulaire.
// - Utilise SUPABASE_SERVICE_ROLE_KEY uniquement côté serveur.
// - Le prix et la promotion sont toujours validés côté serveur
//   (entiers, 0 à 1 000 000 XOF) : le navigateur ne peut jamais
//   imposer un prix arbitraire pour une formation.
//
// Remplace les écritures directes que admin/formations.html faisait
// auparavant sur Supabase avec la clé anonyme (voir historique du
// dépôt) — même modèle de sécurité que api/admin/user-action.js.
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";

const ALLOWED_PROVIDERS = ["mahouto_school", "academie_majestepresse"];
const MAX_PRICE = 1000000;

function validatePrice(value, fieldName, required) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${fieldName} est requis.`);
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > MAX_PRICE) {
    throw new Error(`${fieldName} invalide (entier entre 0 et ${MAX_PRICE}).`);
  }
  return num;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

  // -------- 1) Authentification obligatoire --------
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

  // -------- 2) Vérification du rôle admin (côté serveur uniquement) --------
  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const callerRole = callerProfile ? callerProfile.role : "user";
  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }

  // -------- 3) Lecture : toutes les formations (y compris indisponibles) --------
  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("formations")
      .select("*")
      .order("provider", { ascending: true })
      .order("nom", { ascending: true });

    if (error) {
      console.error("Erreur lecture formations (admin) :", error);
      return res.status(500).json({ error: "Impossible de charger les formations." });
    }
    return res.status(200).json({ formations: data || [] });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const body = req.body || {};
  const { action, id } = body;

  if (!["create", "update", "delete"].includes(action)) {
    return res.status(400).json({ error: "Action inconnue." });
  }

  // -------- 4) Suppression --------
  if (action === "delete") {
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Identifiant de formation manquant." });
    }
    const { error } = await supabaseAdmin.from("formations").delete().eq("id", id);
    if (error) {
      console.error("Erreur suppression formation :", error);
      return res.status(500).json({ error: "Suppression impossible." });
    }
    return res.status(200).json({ success: true });
  }

  try {
    // -------- 5) Mise à jour (prix, promotion, disponibilité) --------
    if (action === "update") {
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "Identifiant de formation manquant." });
      }

      const updatePayload = {};
      if (body.prix !== undefined) updatePayload.prix = validatePrice(body.prix, "Le prix", true);
      if (body.promotion !== undefined) updatePayload.promotion = validatePrice(body.promotion, "La promotion", false);
      if (body.disponible !== undefined) updatePayload.disponible = Boolean(body.disponible);

      if (!Object.keys(updatePayload).length) {
        return res.status(400).json({ error: "Aucune donnée à mettre à jour." });
      }

      const { error } = await supabaseAdmin.from("formations").update(updatePayload).eq("id", id);
      if (error) {
        console.error("Erreur mise à jour formation :", error);
        return res.status(500).json({ error: "Mise à jour impossible." });
      }
      return res.status(200).json({ success: true });
    }

    // -------- 6) Création --------
    const provider = String(body.provider || "").trim();
    const nom = String(body.nom || "").trim().slice(0, 200);
    const description = String(body.description || "").trim().slice(0, 2000);
    const emoji = String(body.emoji || "📘").trim().slice(0, 8) || "📘";
    const prix = validatePrice(body.prix, "Le prix", true);

    if (!ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: "Plateforme (provider) invalide." });
    }
    if (!nom) {
      return res.status(400).json({ error: "Nom de formation invalide." });
    }

    const slug = nom.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const prefix = provider === "academie_majestepresse" ? "amp-" : "";
    const newId = prefix + slug + "-" + Date.now().toString(36);

    const { error } = await supabaseAdmin.from("formations").insert({
      id: newId, provider, nom, description, emoji, prix, disponible: true
    });

    if (error) {
      console.error("Erreur création formation :", error);
      return res.status(500).json({ error: "Création impossible." });
    }
    return res.status(201).json({ success: true, id: newId });

  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }
}
