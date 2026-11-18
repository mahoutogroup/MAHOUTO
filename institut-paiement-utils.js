/* =========================================================
   institut-paiement-utils.js — logique PURE du paiement du prix social de l'Institut SAYÉ LOUIS (PR 4).
   Utilisée par institut-demande.html (boutons de paiement) et institut-retour.html (page de retour), testée par
   tests/institut-paiement-front.test.js. Aucun accès réseau, aucune base, aucun DOM.

   RÈGLE D'OR : le navigateur n'envoie JAMAIS de montant. Le corps de la requête ne contient que le type de paiement,
   la formation choisie (et la demande pour le cas « parrain ») : le serveur relit le prix en base.
   Le prix affiché ici vient de la lecture du catalogue : il est purement indicatif.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.InstitutPaiementUtils = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Prix affiché : « 50 000 FCFA » (espace insécable fine remplacée par une espace simple), ou chaîne vide si invalide. */
  function formatPrice(n) {
    if (!Number.isInteger(n) || n <= 0) return "";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " FCFA";
  }

  /** Une demande peut être payée : validée ET sans place (la place est cherchée par l'appelant). */
  function canPayDemande(demande, hasPlace) {
    return !!demande && demande.statut === "validee" && !hasPlace;
  }

  /** Formations payables par un petit-fils : catalogue actif (déjà filtré) moins celles qu'il possède déjà. */
  function payableForPetitFils(choices, ownedIds) {
    var owned = {};
    (Array.isArray(ownedIds) ? ownedIds : []).forEach(function (id) { owned[id] = true; });
    return (Array.isArray(choices) ? choices : []).filter(function (c) { return c && !owned[c.id] && Number.isInteger(c.prixInstitut) && c.prixInstitut > 0; });
  }

  /** Corps de la requête de checkout. Aucun montant, jamais. Retourne null si les identifiants sont invalides. */
  function checkoutBody(cas, formationId, demandeId) {
    if (typeof formationId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(formationId)) return null;
    if (cas === "parrain") {
      if (typeof demandeId !== "string" || !UUID_RE.test(demandeId)) return null;
      return { productType: "institut", cas: "parrain", demandeId: demandeId, formationId: formationId };
    }
    if (cas === "petit_fils") return { productType: "institut", cas: "petit_fils", formationId: formationId };
    return null;
  }

  /** URL de paiement acceptée : https uniquement (sinon on n'envoie pas la personne payer). */
  function safeCheckoutUrl(url) {
    if (typeof url !== "string") return null;
    try { var u = new URL(url); return u.protocol === "https:" ? u.href : null; } catch (e) { return null; }
  }

  /** Message d'erreur du serveur à afficher (les messages du serveur sont déjà rédigés pour l'utilisateur). */
  function checkoutErrorMessage(status, serverError) {
    if (typeof serverError === "string" && serverError && serverError.length <= 200) return serverError;
    if (status === 401) return "Reconnectez-vous puis réessayez.";
    return "Le paiement n'a pas pu être lancé. Réessayez dans un instant.";
  }

  /** État affiché sur la page de retour, à partir de SA ligne institut_paiements (jamais des paramètres d'URL). */
  function retourState(paiement) {
    if (!paiement) return { key: "inconnu", title: "Paiement introuvable", text: "Nous ne retrouvons pas de paiement récent sur votre compte. Si vous avez payé, patientez quelques minutes puis rouvrez cette page." };
    if (paiement.statut === "paye") {
      if (paiement.note) return { key: "a_verifier", title: "Paiement reçu", text: "Votre paiement est bien reçu. Un point reste à vérifier : l'équipe vous contactera. Ne payez pas une seconde fois." };
      if (paiement.type === "parrain") return { key: "paye_parrain", title: "Paiement confirmé", text: "La place est créée. Retrouvez son code d'invitation dans « Mes demandes »." };
      return { key: "paye_petit_fils", title: "Paiement confirmé", text: "Votre formation est débloquée. Retrouvez-la dans « Mes achats »." };
    }
    if (paiement.statut === "echoue") return { key: "echoue", title: "Paiement non abouti", text: "Le paiement n'a pas abouti. Aucun montant n'est retenu pour cette tentative. Vous pouvez réessayer." };
    return { key: "en_attente", title: "Paiement en cours de confirmation", text: "Nous attendons la confirmation de votre paiement. Cela peut prendre quelques instants." };
  }

  return { formatPrice: formatPrice, canPayDemande: canPayDemande, payableForPetitFils: payableForPetitFils, checkoutBody: checkoutBody, safeCheckoutUrl: safeCheckoutUrl, checkoutErrorMessage: checkoutErrorMessage, retourState: retourState };
});
