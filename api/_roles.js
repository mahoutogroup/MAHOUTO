// =========================================================
// /api/_roles.js — règles du changement de rôle (logique pure, sans réseau)
//
// Le préfixe « _ » en fait un module partagé, pas une fonction Vercel :
// le plafond de 12 fonctions n'est pas touché. Utilisé par
// /api/admin/user-action.js (action « set_role »).
//
// Rôles attribuables : « user », « moderateur », « admin ».
// « moderateur » n'est PAS une valeur de profiles.role : c'est la colonne
// séparée profiles.is_moderator (migration 008), pour ne jamais faire perdre
// à un membre un statut commercial (premium, business…) porté par role.
//   - admin      → role = 'admin', is_moderator = false (l'admin inclut la modération)
//   - moderateur → role conservé (sauf 'admin' qui redevient 'user'), is_moderator = true
//   - user       → role conservé (sauf 'admin' qui redevient 'user'), is_moderator = false
// =========================================================

export const ASSIGNABLE_ROLES = ["user", "moderateur", "admin"];
export const PROTECTED_TARGET_ROLES = ["founder", "super_admin"];
export const MAX_REASON_LENGTH = 500;

/**
 * @param {{callerId: string, callerRole: string, target: {id: string, role: string, is_moderator?: boolean} | null, newRole: string}} input
 * @returns {{ok: false, status: number, error: string} | {ok: true, role: string, moderator: boolean}}
 */
export function planRoleChange({ callerId, callerRole, target, newRole }) {
  if (callerRole !== "founder") {
    return { ok: false, status: 403, error: "Seul le fondateur peut changer le rôle d'un membre." };
  }
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { ok: false, status: 400, error: "Rôle non attribuable : choisis user, moderateur ou admin." };
  }
  if (!target || !target.id) {
    return { ok: false, status: 404, error: "Ce membre n'existe pas." };
  }
  if (target.id === callerId) {
    return { ok: false, status: 403, error: "Tu ne peux pas changer ton propre rôle." };
  }
  if (PROTECTED_TARGET_ROLES.includes(target.role)) {
    return { ok: false, status: 403, error: "Le rôle d'un fondateur ou d'un super administrateur ne se change pas ici." };
  }

  const current = target.role || "user";
  let role;
  let moderator;
  if (newRole === "admin") {
    role = "admin";
    moderator = false;
  } else {
    role = current === "admin" ? "user" : current;
    moderator = newRole === "moderateur";
  }

  if (role === current && moderator === !!target.is_moderator) {
    return { ok: false, status: 409, error: "Ce membre a déjà ce rôle." };
  }
  return { ok: true, role, moderator };
}

// Erreurs de apply_role_change (migration 008) → réponse HTTP claire.
export function mapRoleChangeError(error) {
  const text = String((error && error.message) || "");
  const code = String((error && error.code) || "");
  if (code === "42883" || code === "PGRST202" || /apply_role_change/.test(text) && /not find|does not exist/i.test(text)) {
    return { status: 503, error: "Le changement de rôle n'est pas encore activé (la migration 008 n'a pas été exécutée)." };
  }
  if (/ROLE_FOUNDER_REQUIS/.test(text)) return { status: 403, error: "Seul le fondateur peut changer le rôle d'un membre." };
  if (/ROLE_SOI_MEME/.test(text)) return { status: 403, error: "Tu ne peux pas changer ton propre rôle." };
  if (/ROLE_CIBLE_PROTEGEE/.test(text)) return { status: 403, error: "Le rôle d'un fondateur ou d'un super administrateur ne se change pas ici." };
  if (/ROLE_CIBLE_INTROUVABLE/.test(text)) return { status: 404, error: "Ce membre n'existe pas." };
  if (/ROLE_AUCUN_CHANGEMENT/.test(text)) return { status: 409, error: "Ce membre a déjà ce rôle." };
  if (/ROLE_MOTIF_TROP_LONG/.test(text)) return { status: 400, error: "Le motif est trop long (500 caractères au plus)." };
  if (/ROLE_VALEUR_INVALIDE/.test(text)) return { status: 400, error: "Rôle non attribuable." };
  return { status: 500, error: "Impossible de changer le rôle pour le moment." };
}
