// =========================================================
// /api/admin/users.js
// Gestion administrative des comptes utilisateurs : liste complète
// (GET) et actions (désactiver / réactiver / supprimer) (POST).
//
// Fusion de api/admin/list-users.js + api/admin/user-action.js
// (consolidation pour rester sous la limite de Serverless Functions
// du plan Vercel Hobby) — même dispatch GET/POST déjà utilisé par
// api/admin/formations.js. Comportement et sécurité inchangés.
//
// SÉCURITÉ :
// - Exige un jeton de session Supabase valide (Authorization: Bearer)
// - Vérifie que ce compte a le rôle admin/super_admin/founder dans
//   "profiles", AVANT toute lecture ou action.
// - Utilise SUPABASE_SERVICE_ROLE_KEY uniquement côté serveur, pour
//   accéder à auth.users via l'API Admin — cette clé ne doit JAMAIS
//   être exposée au navigateur.
// - Protège absolument le compte "founder" : jamais désactivable,
//   jamais supprimable, même par un super_admin.
// - Un simple "admin" ne peut pas agir sur un autre admin/super_admin
//   (seul un super_admin/founder le peut).
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
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

  // -------- 3) GET : liste complète des utilisateurs --------
  if (req.method === "GET") {
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

  // -------- 4) POST : action sur un compte (disable / reactivate / delete) --------
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const { action, userId } = req.body || {};
  if (!action || !userId) {
    return res.status(400).json({ error: "Paramètres manquants." });
  }
  if (!["disable", "reactivate", "delete"].includes(action)) {
    return res.status(400).json({ error: "Action inconnue." });
  }

  const { data: targetProfile } = await supabaseAdmin
    .from("profiles").select("role").eq("id", userId).maybeSingle();
  const targetRole = targetProfile ? targetProfile.role : "user";

  // Le compte Founder ne peut JAMAIS être modifié ni supprimé, par personne.
  if (targetRole === "founder") {
    return res.status(403).json({ error: "Le compte Founder ne peut jamais être modifié ni supprimé." });
  }

  // Un simple admin ne peut pas agir sur un autre admin/super_admin.
  if (callerRole === "admin" && ["admin", "super_admin"].includes(targetRole)) {
    return res.status(403).json({ error: "Un administrateur ne peut pas agir sur un autre administrateur." });
  }

  try {
    if (action === "disable") {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876000h" }); // ~100 ans
    } else if (action === "reactivate") {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    } else if (action === "delete") {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
