// =========================================================
// /api/admin/user-action.js
// Exécute une action administrative sur un compte utilisateur :
// désactiver, réactiver, ou supprimer définitivement.
//
// SÉCURITÉ :
// - Exige un jeton de session Supabase valide
// - Vérifie le rôle admin/super_admin/founder de l'appelant
// - Protège absolument le compte "founder" : jamais désactivable,
//   jamais supprimable, même par un super_admin
// - Un simple "admin" ne peut pas agir sur un autre admin/super_admin
//   (seul un super_admin/founder le peut)
//
// ACTION « set_role » (changement de rôle, migration 008) :
// - RÉSERVÉE AU FOUNDER (vérifié ici sur le jeton de session, puis
//   revérifié en base par la fonction apply_role_change) ;
// - jamais soi-même, jamais un founder ou un super_admin ; rôles
//   attribuables : user, moderateur, admin (voir api/_roles.js) ;
// - écrit avec la clé service_role : les déclencheurs de protection du rôle
//   (trg_prevent_profile_role_change, trg_protect_role) restent intacts ;
// - chaque changement est tracé dans role_changes (même transaction).
// Fusionnée ici pour ne pas dépasser le plafond de 12 fonctions Vercel.
// =========================================================

import { createClient } from "@supabase/supabase-js";
import { planRoleChange, mapRoleChangeError, MAX_REASON_LENGTH } from "../_roles.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  const { action, userId, newRole, reason } = req.body || {};
  if (!action || !userId) {
    return res.status(400).json({ error: "Paramètres manquants." });
  }
  if (!["disable", "reactivate", "delete", "set_role"].includes(action)) {
    return res.status(400).json({ error: "Action inconnue." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const { data: callerProfile } = await supabaseAdmin
    .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  const callerRole = callerProfile ? callerProfile.role : "user";

  // ---- Changement de rôle : founder seulement, avant toute autre règle ----
  if (action === "set_role") {
    return handleSetRole(res, supabaseAdmin, userData.user.id, callerRole, userId, newRole, reason);
  }

  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
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

async function handleSetRole(res, supabaseAdmin, callerId, callerRole, userId, newRole, reason) {
  // Refus immédiat si l'appelant n'est pas founder (même message que la règle, sans lire la cible).
  if (callerRole !== "founder") {
    return res.status(403).json({ error: "Seul le fondateur peut changer le rôle d'un membre." });
  }
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({ error: "Membre invalide." });
  }
  const motif = typeof reason === "string" ? reason.trim() : "";
  if (motif.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ error: "Le motif est trop long (500 caractères au plus)." });
  }

  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles").select("id, role, is_moderator").eq("id", userId).maybeSingle();
  if (targetError) {
    if (targetError.code === "42703") {
      return res.status(503).json({ error: "Le changement de rôle n'est pas encore activé (la migration 008 n'a pas été exécutée)." });
    }
    return res.status(500).json({ error: "Impossible de lire ce membre pour le moment." });
  }

  const plan = planRoleChange({ callerId, callerRole, target, newRole });
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });

  const { data, error } = await supabaseAdmin.rpc("apply_role_change", {
    p_caller: callerId,
    p_target: userId,
    p_new_role: plan.role,
    p_new_moderator: plan.moderator,
    p_reason: motif || null
  });
  if (error) {
    const mapped = mapRoleChangeError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
  return res.status(200).json({ success: true, role: plan.role, moderator: plan.moderator, change: data });
}
