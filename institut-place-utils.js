/* =========================================================
   institut-place-utils.js — logique PURE des places de l'Institut SAYÉ LOUIS (PR 3) : code d'invitation,
   prix Institut, dons, messages. Utilisée par institut-place.html, institut-demande.html, admin/institut.html
   et testée par tests/institut-places.test.js. Dépend de institut-utils.js (InstitutUtils).

   Aucun accès réseau, aucune base, aucun DOM. Les messages ne révèlent jamais quels codes existent : côté serveur,
   un code inconnu ou déjà utilisé donne la MÊME réponse (MSG_CODE_INVALIDE). Un code dont le FORMAT est refusé
   dans le navigateur reçoit un message plus utile (MSG_CODE_FORMAT) : aucun appel serveur, donc aucune information.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./institut-utils"));
  else root.InstitutPlaceUtils = factory(root.InstitutUtils);
})(typeof window !== "undefined" ? window : globalThis, function (U) {
  "use strict";

  // 32 symboles sans ambiguïté (ni I, ni O, ni 0, ni 1) : même alphabet que la base (contrainte institut_places_code_check)
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var CODE_LENGTH = 8;
  var CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  var ERR_PREFIX = "ERREUR:";
  var DON_MONTANT_MAX = 1000000000;
  var DON_PLACES_MAX = 1000;
  var DONATEUR_MAX = 80, NOTE_MAX = 300;

  // Réponse du SERVEUR pour un code inexistant ou déjà utilisé : neutre, aucun indice sur les codes qui existent.
  var MSG_CODE_INVALIDE = "Ce code n'est pas valide ou a déjà été utilisé. Vérifiez-le puis réessayez.";
  // Refus LOCAL (avant tout appel serveur) : seul le format est en cause, on peut donc aider à corriger la saisie.
  var MSG_CODE_FORMAT = "Ce code ne ressemble pas à un code valide. Il compte 8 caractères (lettres et chiffres). Les lettres O, I et les chiffres 0, 1 ne sont jamais utilisés : vérifiez votre saisie.";

  /** Code normalisé : majuscules, sans espaces, tirets ni autres séparateurs. */
  function normalizeCode(raw) {
    return String(raw == null ? "" : raw).toUpperCase().replace(/[\s\u00A0\u2010-\u2015\u2212_.-]+/g, "");
  }

  /** Affichage et saisie : « ABCD-EFGH ». N'ajoute rien tant qu'il n'y a pas plus de 4 caractères. */
  function formatCode(raw) {
    var c = normalizeCode(raw).replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
    return c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
  }

  /** Validation locale avant l'appel : { ok:true, code } ou { ok:false, error } (message neutre, sans indice). */
  function validateCode(raw) {
    var c = normalizeCode(raw);
    if (!c) return { ok: false, error: "Saisissez le code d'invitation." };
    if (!CODE_RE.test(c)) return { ok: false, error: MSG_CODE_FORMAT };
    return { ok: true, code: c };
  }

  /**
   * Interprète la réponse de institut_reclamer_place : le succès renvoie l'identifiant de la formation ; un échec de
   * saisie renvoie « ERREUR:<CODE> » (la base ne lève pas d'exception pour pouvoir compter les échecs).
   */
  function claimOutcome(result) {
    if (typeof result !== "string" || !result) return { ok: false, message: "Une erreur est survenue. Réessayez dans un instant." };
    if (result.indexOf(ERR_PREFIX) !== 0) return { ok: true, formationId: result };
    switch (result.slice(ERR_PREFIX.length)) {
      case "CODE_INVALIDE": return { ok: false, message: MSG_CODE_INVALIDE };
      case "TROP_DE_TENTATIVES": return { ok: false, message: "Trop de tentatives échouées. Patientez environ une heure avant de réessayer." };
      case "DEJA_POSSEDEE": return { ok: false, message: "Ce compte a déjà accès à cette formation. Votre code n'a pas été utilisé : il reste valable." };
      case "PARRAIN": return { ok: false, message: "Ce code doit être saisi sur le compte de l'élève, pas sur celui du parrain." };
      case "ACHAT_EXISTANT": return { ok: false, message: "Un achat de cette formation existe déjà sur ce compte. Votre code n'a pas été utilisé. Contactez l'Institut." };
      default: return { ok: false, message: "Une erreur est survenue. Réessayez dans un instant." };
    }
  }

  /** Message pour une erreur technique de l'appel (réseau, session). Jamais le texte brut de la base. */
  function rpcErrorMessage(error) {
    var text = String((error && error.message) || "");
    var code = String((error && error.code) || "");
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return "Pas de connexion internet. Vérifiez votre réseau puis réessayez.";
    if (code === "42501" || /permission denied|jwt|not authenticated/i.test(text)) return "Votre session a expiré. Reconnectez-vous puis réessayez.";
    if (/Connectez-vous/.test(text)) return "Connectez-vous pour utiliser un code d'invitation.";
    return "Une erreur est survenue. Réessayez dans un instant.";
  }

  /** Adresse de la formation (même page que « Ouvrir » dans mes-achats.html). */
  function formationUrl(formationId) { return "formation-detail.html?course=" + encodeURIComponent(String(formationId)); }

  /** Prix de l'Académie réellement payé : le prix promotionnel s'il existe, sinon le prix. */
  function academyPrice(f) {
    if (!f) return null;
    var promo = Number(f.promotion);
    if (f.promotion !== null && f.promotion !== undefined && Number.isInteger(promo) && promo > 0) return promo;
    var p = Number(f.prix);
    return Number.isInteger(p) && p > 0 ? p : null;
  }

  /**
   * Prix Institut saisi : entier > 0. Supérieur au prix de l'Académie : AVERTISSEMENT sans blocage.
   * Renvoie { ok, value, warning? } ou { ok:false, error }.
   */
  function validatePrixInstitut(raw, prixAcademie) {
    var t = String(raw == null ? "" : raw).replace(/[\s\u00A0]/g, "");
    if (!t) return { ok: false, error: "Indiquez le prix Institut en FCFA." };
    if (!/^\d{1,9}$/.test(t)) return { ok: false, error: "Le prix Institut doit être un nombre entier de FCFA, supérieur à 0." };
    var v = parseInt(t, 10);
    if (v <= 0) return { ok: false, error: "Le prix Institut doit être supérieur à 0." };
    var out = { ok: true, value: v };
    if (Number.isInteger(prixAcademie) && prixAcademie > 0 && v > prixAcademie) {
      out.warning = "Attention : ce prix Institut (" + U.formatFcfa(v) + ") est supérieur au prix de l'Académie (" + U.formatFcfa(prixAcademie) + ").";
    }
    return out;
  }

  /** Don saisi : montant > 0, 1 à 1000 places, donateur ≤ 80, note ≤ 300 (facultatifs : null si vides). */
  function validateDon(input) {
    var s = input && typeof input === "object" ? input : {};
    var errors = {}, value = {};
    var m = String(s.montant == null ? "" : s.montant).replace(/[\s\u00A0]/g, "");
    if (!/^\d{1,10}$/.test(m) || parseInt(m, 10) <= 0 || parseInt(m, 10) > DON_MONTANT_MAX) errors.montant = "Indiquez le montant en FCFA (nombre entier supérieur à 0).";
    else value.montant = parseInt(m, 10);
    var p = String(s.places == null ? "" : s.places).trim();
    if (!/^\d{1,4}$/.test(p) || parseInt(p, 10) < 1 || parseInt(p, 10) > DON_PLACES_MAX) errors.places = "Indiquez le nombre de places financées (de 1 à " + DON_PLACES_MAX + ").";
    else value.places = parseInt(p, 10);
    var donateur = U.cleanLine(s.donateur, DONATEUR_MAX + 20);
    if (U.countChars(donateur) > DONATEUR_MAX) errors.donateur = "Le nom du donateur est trop long (" + DONATEUR_MAX + " caractères au maximum).";
    else value.donateur = donateur || null;
    var note = U.cleanMultiline(s.note);
    if (U.countChars(note) > NOTE_MAX) errors.note = "La note est trop longue (" + NOTE_MAX + " caractères au maximum).";
    else value.note = note || null;
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  /** Places restantes d'un don (jamais négatif). */
  function placesRestantes(don, utilisees) {
    var total = Number(don && don.places), used = Number(utilisees);
    if (!Number.isInteger(total) || !Number.isInteger(used)) return 0;
    return Math.max(0, total - used);
  }

  /** Nombre de places attribuées par don, à partir des lignes de institut_places. */
  function usedByDon(places) {
    var out = {};
    (Array.isArray(places) ? places : []).forEach(function (p) { if (p && p.don_id) out[p.don_id] = (out[p.don_id] || 0) + 1; });
    return out;
  }

  /** État d'une place pour l'affichage : { key, label }. place = ligne de institut_places ou null. */
  function placeState(place) {
    if (!place) return { key: "aucune", label: "Aucune place attribuée" };
    if (place.reclamee_le) return { key: "reclamee", label: "Place utilisée" };
    return { key: "non_reclamee", label: "Place non réclamée" };
  }

  /** Formations proposables dans la liste de demande : actives, id de 1 à 40 caractères (limite de la base), nom connu. */
  function formationChoices(rows) {
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || typeof r.formation_id !== "string" || !r.formation_id || r.formation_id.length > 40) return;
      var f = r.formations && typeof r.formations === "object" ? r.formations : null;
      var nom = U.cleanLine(f && f.nom, 80);
      if (!nom) return;
      out.push({ id: r.formation_id, nom: nom, prixInstitut: r.prix_institut, prixAcademie: academyPrice(f), ordre: Number(r.ordre) || 0 });
    });
    return out.sort(function (a, b) { return a.ordre - b.ordre || (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0); });
  }

  /** Aide de la formation d'une demande : nom si connu (table formations), sinon l'ancien libellé constant, sinon l'identifiant. */
  function formationName(id, names) {
    if (names && typeof names[id] === "string" && names[id]) return names[id];
    return U.formationLabel(id);
  }

  return {
    CODE_ALPHABET: CODE_ALPHABET, CODE_LENGTH: CODE_LENGTH, CODE_RE: CODE_RE, ERR_PREFIX: ERR_PREFIX, MSG_CODE_INVALIDE: MSG_CODE_INVALIDE, MSG_CODE_FORMAT: MSG_CODE_FORMAT,
    normalizeCode: normalizeCode, formatCode: formatCode, validateCode: validateCode, claimOutcome: claimOutcome, rpcErrorMessage: rpcErrorMessage,
    formationUrl: formationUrl, academyPrice: academyPrice, validatePrixInstitut: validatePrixInstitut, validateDon: validateDon,
    placesRestantes: placesRestantes, usedByDon: usedByDon, placeState: placeState, formationChoices: formationChoices, formationName: formationName
  };
});
