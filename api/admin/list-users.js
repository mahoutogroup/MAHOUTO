// =========================================================
// /api/admin/list-users.js
// Retourne la liste complète des utilisateurs (email, rôle,
// date d'inscription, statut) + les statistiques d'inscription.
//
// SÉCURITÉ :
// - Exige un jeton de session Supabase valide (Authorization: Bearer)
// - Vérifie ensuite que ce compte a bien le rôle admin/super_admin/
//   founder dans "profiles", AVANT toute lecture des données.
// - Utilise SUPABASE_SERVICE_ROLE_KEY uniquement côté serveur, pour
//   accéder à auth.users via l'API Admin — cette clé ne doit JAMAIS
//   être exposée au navigateur.
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY   (NOUVELLE — Project Settings > API >
//                                 service_role. Garder strictement
//                                 secrète, jamais dans config.js)
// =========================================================

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

  // -------- 1) Vérifier l'identité de l'appelant --------
  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // -------- 2) Vérifier le rôle admin (côté serveur, jamais fait confiance au client) --------
  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const callerRole = callerProfile ? callerProfile.role : "user";
  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }

  // -------- 3) Récupérer tous les utilisateurs via l'API Admin --------
  let allUsers = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) return res.status(500).json({ error: error.message });
    allUsers = allUsers.concat(data.users);
    if (data.users.length < perPage || page > 20) break;
    page++;
  }

  // -------- 4) Enrichir avec les profils (rôle, pseudo) --------
  const ids = allUsers.map((u) => u.id);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, username, role")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });

  const users = allUsers.map((u) => {
    const p = profileMap[u.id] || {};
    const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
    return {
      id: u.id,
      email: u.email || null,
      name: p.username
        || (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name))
        || (u.email ? u.email.split("@")[0] : "Utilisateur"),
      role: p.role || "user",
      created_at: u.created_at,
      status: isBanned ? "désactivé" : "actif"
    };
  });

  return res.status(200).json({ users });
}
