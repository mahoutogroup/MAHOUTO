/* =========================================================
   purchase-list.js — quels achats afficher dans « Ma bibliothèque » (mes-achats.html)

   Règle d'AFFICHAGE seulement : rien n'est supprimé ni modifié en base.
   - « paid » : toujours affiché.
   - « pending » : affiché s'il a au plus 3 jours (le paiement peut encore arriver), masqué au-delà ;
     toujours masqué si un achat « paid » existe pour le même article (même course_id et même product_type).
   - « failed » et tout autre statut : jamais affichés.
   Un paiement tardif (webhook après plus de 3 jours) passe à « paid » et réapparaît donc normalement.
   ========================================================= */
(function (root) {
  "use strict";

  var MAX_PENDING_AGE_MS = 3 * 24 * 60 * 60 * 1000;   // exactement 3 jours : encore affiché

  function articleKey(p) { return String(p.product_type) + "\u0000" + String(p.course_id); }

  // Vrai si l'achat « pending » a strictement plus de 3 jours. Date absente ou illisible : pas de preuve d'ancienneté.
  function isOldPending(p, nowMs) {
    var created = Date.parse(p && p.created_at);
    if (isNaN(created)) return false;
    return nowMs - created > MAX_PENDING_AGE_MS;
  }

  // purchases : lignes de la table purchases. now : Date ou millisecondes (défaut : maintenant).
  // Renvoie les achats à afficher, dans le même ordre ; ne modifie pas la liste reçue.
  function visiblePurchases(purchases, now) {
    var list = Array.isArray(purchases) ? purchases : [];
    var nowMs = now instanceof Date ? now.getTime() : (typeof now === "number" ? now : Date.now());
    var paid = {};
    list.forEach(function (p) { if (p && p.status === "paid") paid[articleKey(p)] = true; });
    return list.filter(function (p) {
      if (!p) return false;
      if (p.status === "paid") return true;
      if (p.status === "pending") return !paid[articleKey(p)] && !isOldPending(p, nowMs);
      return false;
    });
  }

  var api = { MAX_PENDING_AGE_MS: MAX_PENDING_AGE_MS, visiblePurchases: visiblePurchases, isOldPending: isOldPending };
  root.MahoutoPurchaseList = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
