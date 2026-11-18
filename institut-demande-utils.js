/* =========================================================
   institut-demande-utils.js — validation PURE de la demande de parrainage (institut-demande.html,
   tests/institut-demande.test.js). Dépend de institut-utils.js (InstitutUtils).

   Aucun accès réseau, aucune base, aucun DOM. Les mêmes règles sont imposées par la base (contraintes de
   institut_demandes) : ce module sert à donner des messages clairs AVANT l'envoi.
   Données minimales (mineurs) : prénom seulement, jamais de nom de famille, d'adresse, de téléphone ni de photo.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./institut-utils"));
  else root.InstitutDemandeUtils = factory(root.InstitutUtils);
})(typeof window !== "undefined" ? window : globalThis, function (U) {
  "use strict";

  var BUCKET = "institut-justificatifs";
  var MAX_FILE_BYTES = 5 * 1024 * 1024;   // 5 Mo, comme le bucket
  var FILE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  var PENDING_LIMIT = 5;                  // demandes en attente au plus par parrain (garde en base)
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var RANDOM_RE = /^[0-9a-f]{16,64}$/;
  var EXT_RE = /^(jpg|png|webp|pdf)$/;
  // Prénom : lettres (accents compris), espaces, apostrophes et tirets ; commence par une lettre. Refuse chiffres, @, /, etc.
  var PRENOM_RE = /^[\p{L}][\p{L}\p{M}'’ -]*$/u;

  function isUuid(s) { return typeof s === "string" && UUID_RE.test(s); }
  function listHas(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return true; return false; }

  /**
   * Valide la saisie du formulaire.
   * input : { prenom, age, lien, formation, motif } (textes tels que saisis). formations : liste [id, libellé] facultative
   * (lue dans institut_formations) ; à défaut, la liste constante U.FORMATIONS.
   * Renvoie { ok:true, value:{ prenom, age, lien, formation, motif } } ou { ok:false, errors:{ champ: message } }.
   */
  function validateDemande(input, formations) {
    var formationList = Array.isArray(formations) && formations.length ? formations : U.FORMATIONS;
    var s = input && typeof input === "object" ? input : {};
    var errors = {}, value = {};

    var prenom = U.cleanLine(s.prenom, U.PRENOM_MAX + 20);
    if (!prenom) errors.prenom = "Indiquez le prénom de l'enfant.";
    else if (U.countChars(prenom) > U.PRENOM_MAX) errors.prenom = "Le prénom est trop long (" + U.PRENOM_MAX + " caractères au maximum).";
    else if (!PRENOM_RE.test(prenom)) errors.prenom = "Ne saisissez que le prénom, avec des lettres : ni chiffres, ni adresse, ni numéro de téléphone.";
    else value.prenom = prenom;

    var ageText = String(s.age == null ? "" : s.age).trim();
    if (!/^\d{1,3}$/.test(ageText)) errors.age = "Indiquez l'âge en années (nombre entier entre " + U.AGE_MIN + " et " + U.AGE_MAX + ").";
    else {
      var age = parseInt(ageText, 10);
      if (age < U.AGE_MIN || age > U.AGE_MAX) errors.age = "L'âge doit être compris entre " + U.AGE_MIN + " et " + U.AGE_MAX + " ans.";
      else value.age = age;
    }

    if (typeof s.lien !== "string" || !listHas(U.LIENS, s.lien)) errors.lien = "Choisissez votre lien avec l'enfant.";
    else value.lien = s.lien;
    if (value.lien === "lui_meme" && value.age !== undefined && value.age < U.AGE_MAJEUR) {
      errors.lien = "L'orphelin ne peut déposer la demande lui-même que s'il est majeur (" + U.AGE_MAJEUR + " ans ou plus).";
      delete value.lien;
    }

    if (typeof s.formation !== "string" || !listHas(formationList, s.formation)) errors.formation = "Choisissez une formation.";
    else value.formation = s.formation;

    var motif = U.cleanMultiline(s.motif);
    if (U.countChars(motif) > U.MOTIF_MAX) errors.motif = "Le motif est trop long (" + U.MOTIF_MAX + " caractères au maximum).";
    else value.motif = motif;

    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  /** Valide le justificatif (facultatif) : type contrôlé, 5 Mo au plus. Renvoie { ok, ext } ou { ok:false, error }. */
  function validateFile(file) {
    if (!file) return { ok: true, none: true };
    var type = String(file.type || "").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(FILE_TYPES, type)) return { ok: false, error: "Format non accepté : envoyez une photo (JPEG, PNG, WebP) ou un PDF." };
    var size = Number(file.size);
    if (!isFinite(size) || size <= 0) return { ok: false, error: "Le fichier est vide." };
    if (size > MAX_FILE_BYTES) return { ok: false, error: "Le fichier est trop volumineux (5 Mo au maximum)." };
    return { ok: true, ext: FILE_TYPES[type], type: type };
  }

  /** Identifiant de demande : crypto.randomUUID() si disponible, sinon construit avec getRandomValues. Jamais Math.random. */
  function newId(cryptoObj) {
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") return null;
    var b = cryptoObj.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /** Nom de fichier aléatoire (32 caractères hexadécimaux) : le nom d'origine du fichier n'est jamais conservé. */
  function randomName(cryptoObj) {
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") return null;
    var b = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  /** Chemin de stockage : <uid>/<id_demande>/<nom aléatoire>.<ext> ; null si un élément est invalide. */
  function storagePath(uid, demandeId, ext, random) {
    if (!isUuid(uid) || !isUuid(demandeId) || !EXT_RE.test(String(ext)) || !RANDOM_RE.test(String(random))) return null;
    return uid + "/" + demandeId + "/" + random + "." + ext;
  }

  /**
   * Message clair en français pour une erreur Supabase (insertion ou envoi de fichier).
   * Les messages de la base écrits en français (limite de 5 demandes) sont repris tels quels.
   */
  function errorMessage(error, context) {
    var text = String((error && error.message) || "");
    var code = String((error && (error.code || error.statusCode)) || "");
    if (!error) return "Une erreur est survenue. Réessayez dans un instant.";
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return "Pas de connexion internet. Vérifiez votre réseau puis réessayez.";
    if (/5 demandes en attente/.test(text)) return "Vous avez déjà " + PENDING_LIMIT + " demandes en attente. Patientez jusqu'à leur examen avant d'en déposer une nouvelle.";
    if (context === "upload") {
      if (/too large|payload|exceeded|taille/i.test(text) || code === "413") return "Le fichier est trop volumineux (5 Mo au maximum).";
      if (/mime|type/i.test(text)) return "Format de fichier non accepté : envoyez une photo (JPEG, PNG, WebP) ou un PDF.";
      return "L'envoi du justificatif a échoué. Réessayez, ou déposez la demande sans justificatif.";
    }
    if (code === "42501" || /row-level security|permission denied/i.test(text)) return "L'Institut n'est pas ouvert aux demandes pour le moment.";
    if (/Les informations d'une demande/.test(text)) return "Une demande déjà déposée ne peut plus être modifiée.";
    if (code === "23514") return "Une information saisie n'est pas valide. Vérifiez le formulaire.";
    return "La demande n'a pas pu être enregistrée. Réessayez dans un instant.";
  }

  /** Écran à afficher : 'login' (pas connecté), 'closed' (fermé aux demandes), 'form'. Un admin peut déposer avant l'ouverture. */
  function viewState(o) {
    if (!o || !o.signedIn) return "login";
    if (o.open === true || o.isAdmin === true) return "form";
    return "closed";
  }

  return {
    BUCKET: BUCKET, MAX_FILE_BYTES: MAX_FILE_BYTES, FILE_TYPES: FILE_TYPES, PENDING_LIMIT: PENDING_LIMIT,
    isUuid: isUuid, validateDemande: validateDemande, validateFile: validateFile,
    newId: newId, randomName: randomName, storagePath: storagePath, errorMessage: errorMessage, viewState: viewState
  };
});
