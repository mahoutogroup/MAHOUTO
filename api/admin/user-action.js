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
// =========================================================

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  const { action, userId } = req.body || {};
  if (!action || !userId) {
    return res.status(400).json({ error: "Paramètres manquants." });
  }
  if (!["disable", "reactivate", "delete"].includes(action)) {
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
