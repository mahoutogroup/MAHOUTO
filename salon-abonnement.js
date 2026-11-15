/* =========================================================
   salon-abonnement.js — règles d'affichage de l'abonnement par forfaits des salons payants (module partagé)

   Utilisé par chat.html, discussions.html et testé par tests/salon-abonnement.test.js.
   La VRAIE barrière est côté base de données (règles RLS sur « messages ») et côté serveur
   (api/_salon-abonnement.js, api/_attachment-rules.js) : ce module ne sert qu'à choisir quoi AFFICHER.

   - Un membre à VIE (achat « paid » existant), le créateur et un admin entrent directement : ils ne voient
     JAMAIS de forfaits et ne peuvent pas payer un abonnement.
   - Un salon en mode abonnement affiche les forfaits ACTIFS (lus directement : la base ne renvoie que les
     actifs). Le filtre d'affichage ne regarde que la validité des champs reçus, jamais un champ « actif ».
   Aucun rendu HTML ici (le DOM est construit par les pages avec textContent).
   ========================================================= */
(function (root) {
  "use strict";

  var PRIVILEGED_ROLES = ["admin", "super_admin", "founder"];
  var FORFAIT_CODE_RE = /^[a-z0-9_-]{2,30}$/;
  // Colonnes demandées par les pages. Le contrat (tests) vérifie que le filtre fonctionne sur CES colonnes.
  var FORFAIT_COLUMNS = "code, libelle, jours, montant, ordre";
  var DAY_MS = 24 * 3600 * 1000;

  function toMs(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isFinite(t) ? t : NaN;
  }

  /** Abonnement en cours : expire_le dans le futur. row = ligne de salon_abonnements (ou null). */
  function subscriptionActive(row, now) {
    var t = toMs(row && row.expire_le);
    return isFinite(t) && t > (now === undefined ? Date.now() : now);
  }

  /** Abonnement expiré : une ligne existe mais sa date est passée. */
  function subscriptionExpired(row, now) {
    var t = toMs(row && row.expire_le);
    return isFinite(t) && t <= (now === undefined ? Date.now() : now);
  }

  /**
   * Décision d'accès (affichage). input : { room, userId, role, lifetime, subscription, now }.
   *   room : ligne rooms { is_paid, abonnement, created_by } ; lifetime : true s'il existe un achat « paid » du salon.
   * Renvoie { allowed, reason, mode, expired }.
   *   reason : 'libre' | 'createur' | 'admin' | 'vie' | 'abonne' | 'verrouille'
   *   mode (si verrouillé) : 'achat' (salon à vie) | 'abonnement' (forfaits)
   */
  function accessDecision(input) {
    var room = input && input.room;
    if (!room || !room.is_paid) return { allowed: true, reason: "libre", mode: null, expired: false };
    if (input.userId && room.created_by === input.userId) return { allowed: true, reason: "createur", mode: null, expired: false };
    if (PRIVILEGED_ROLES.indexOf(input.role) !== -1) return { allowed: true, reason: "admin", mode: null, expired: false };
    if (input.lifetime === true) return { allowed: true, reason: "vie", mode: null, expired: false };
    if (subscriptionActive(input.subscription, input.now)) return { allowed: true, reason: "abonne", mode: null, expired: false };
    return {
      allowed: false,
      reason: "verrouille",
      mode: room.abonnement === true ? "abonnement" : "achat",
      expired: subscriptionExpired(input.subscription, input.now)
    };
  }

  /** Forfait affichable : seulement la validité des champs reçus (la base ne renvoie que les actifs). */
  function isDisplayableForfait(f) {
    return !!f && typeof f.code === "string" && FORFAIT_CODE_RE.test(f.code) &&
      typeof f.libelle === "string" && f.libelle.length > 0 &&
      Number.isInteger(f.jours) && f.jours > 0 && Number.isInteger(f.montant) && f.montant > 0;
  }

  /** Forfaits à proposer, triés par « ordre » puis par durée. rows = lignes de salon_forfaits. */
  function plansFromRows(rows) {
    var list = Array.isArray(rows) ? rows.filter(isDisplayableForfait) : [];
    return list.slice().sort(function (a, b) {
      return (Number(a.ordre) || 0) - (Number(b.ordre) || 0) || a.jours - b.jours;
    });
  }

  /** Durée restante lisible : « il reste 3 jours », « il reste moins d'un jour », « expiré ». */
  function remainingLabel(expireLe, now) {
    var t = toMs(expireLe);
    var n = now === undefined ? Date.now() : now;
    if (!isFinite(t) || t <= n) return "expiré";
    var days = Math.ceil((t - n) / DAY_MS);
    if (t - n < DAY_MS) return "il reste moins d'un jour";
    return "il reste " + days + " jour" + (days > 1 ? "s" : "");
  }

  /** Millisecondes avant l'expiration (pour revérifier l'accès à l'échéance), plafonné ; null si rien à attendre. */
  function msUntilExpiry(row, now) {
    var t = toMs(row && row.expire_le);
    var n = now === undefined ? Date.now() : now;
    if (!isFinite(t) || t <= n) return null;
    return Math.min(t - n + 1000, 2147000000);   // setTimeout est limité à ~24,8 jours
  }

  /** Libellé d'un forfait : « 1 mois — 1 111 FCFA ». */
  function planLabel(f) {
    return f.libelle + " — " + Number(f.montant).toLocaleString("fr-FR") + " FCFA";
  }

  var api = {
    PRIVILEGED_ROLES: PRIVILEGED_ROLES, FORFAIT_COLUMNS: FORFAIT_COLUMNS,
    subscriptionActive: subscriptionActive, subscriptionExpired: subscriptionExpired,
    accessDecision: accessDecision, isDisplayableForfait: isDisplayableForfait, plansFromRows: plansFromRows,
    remainingLabel: remainingLabel, msUntilExpiry: msUntilExpiry, planLabel: planLabel
  };
  root.MahoutoSalonAbonnement = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
