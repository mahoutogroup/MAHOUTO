/* =========================================================
   profil-public-utils.js — logique PURE du profil public (PR 1 sur 3) : adresse /m/<adresse>, champs, un seul contact,
   état d'affichage de la page publique, messages d'erreur. Utilisée par m.html (page publique) et profil.html
   (« Mon profil public »), testée par tests/profils-publics-front.test.js. Aucun accès réseau, aucune base, aucun DOM.

   Mêmes règles que la base (profils-publics.sql) : la base reste la vraie barrière, ce module donne des messages clairs
   AVANT l'envoi. Jamais affiché ni demandé : nom légal complet, e-mail, rôle, identifiant du compte.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProfilPublicUtils = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var SITE = "https://www.mahouto.com";
  var ADRESSE_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  var LIMITS = { nom: 60, metier: 80, presentation: 280, localisation: 60, avatar: 500, lien: 300 };
  // Même liste fixe que la base (tirets ignorés) ; la base ajoute en plus la liste des pseudos réservés.
  var RESERVEES = ["admin", "administrateur", "administrator", "api", "support", "aide", "help", "contact", "mahouto", "mahoutoplus",
    "mahoutoschool", "majeste", "majestepresse", "majesteai", "institut", "sayelouis", "fondateur", "founder", "annonces",
    "moderation", "moderateur", "securite", "security", "officiel", "official", "equipe", "team", "www", "app", "static",
    "assets", "login", "logout", "signup", "profil", "profile", "profils", "settings", "parametres", "entreprise",
    "boutique", "school", "verify", "null", "undefined", "root", "system", "messages", "discussions", "paiement", "paiements"];

  /** Adresse saisie : espaces retirés aux extrémités, minuscules. */
  function normalizeAdresse(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  function isReserved(adresse) {
    var a = String(adresse == null ? "" : adresse);
    return RESERVEES.indexOf(a) !== -1 || RESERVEES.indexOf(a.replace(/-/g, "")) !== -1;
  }

  /** Valide une adresse. Renvoie { ok:true, value } ou { ok:false, code:'invalide'|'reservee', error }. */
  function validateAdresse(input) {
    var a = normalizeAdresse(input);
    if (!ADRESSE_RE.test(a)) return { ok: false, code: "invalide", error: "L'adresse compte de 3 à 30 caractères : lettres minuscules, chiffres et tirets, sans tiret au début ni à la fin." };
    if (isReserved(a)) return { ok: false, code: "reservee", error: "Cette adresse est réservée : choisissez-en une autre." };
    return { ok: true, value: a };
  }

  /** Adresse publique complète. */
  function publicUrl(adresse) { return SITE + "/m/" + adresse; }

  /** Texte d'une ligne : caractères de contrôle remplacés par un espace, espaces réduits, bornés (en caractères). */
  function cleanLine(s, max) {
    var t = String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(t).slice(0, max || 200).join("");
  }
  function countChars(s) { return Array.from(String(s == null ? "" : s)).length; }

  /** Numéro WhatsApp en format international : « +229… » ; espaces, points, tirets, parenthèses acceptés ; « 00 » devient « + ». */
  function normalizeWhatsapp(s) {
    var t = String(s == null ? "" : s).replace(/[\s.\-()]/g, "");
    if (t.indexOf("00") === 0) t = "+" + t.slice(2);
    return /^\+[1-9][0-9]{7,14}$/.test(t) ? t : null;
  }

  /** Lien https sûr (pas d'identifiants dans l'adresse, pas d'espace). Renvoie l'URL normalisée ou null. */
  function safeHttpsUrl(s, max) {
    var t = String(s == null ? "" : s).trim();
    if (!t || /[\s\u0000-\u001F\u007F-\u009F]/.test(t) || t.length > (max || LIMITS.lien)) return null;
    try {
      var u = new URL(t);
      if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
      return u.href.length > (max || LIMITS.lien) ? null : u.href;
    } catch (e) { return null; }
  }

  /** Lien d'ouverture de WhatsApp pour un numéro international valide ; null sinon. */
  function whatsappLink(numero) {
    var n = normalizeWhatsapp(numero);
    return n ? "https://wa.me/" + n.slice(1) : null;
  }

  /**
   * Valide la page en préparation.
   * input : { adresse, nom, avatar, metier, presentation, localisation, contactType ('' | 'whatsapp' | 'lien'), contactValeur, publier, majeur }
   * Renvoie { ok:true, value:{ adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie, majeur_declare } }
   * ou { ok:false, errors:{ champ: message } }. Un SEUL contact public au plus ; publier exige la certification des 18 ans.
   */
  function validateProfil(input) {
    var s = input && typeof input === "object" ? input : {};
    var errors = {}, v = {};

    var adr = validateAdresse(s.adresse);
    if (adr.ok) v.adresse = adr.value; else errors.adresse = adr.error;

    var nom = cleanLine(s.nom, LIMITS.nom + 20);
    if (!nom) errors.nom = "Indiquez le nom affiché.";
    else if (countChars(nom) > LIMITS.nom) errors.nom = "Le nom affiché est trop long (" + LIMITS.nom + " caractères au maximum).";
    else v.nom_affiche = nom;

    var avatarRaw = String(s.avatar == null ? "" : s.avatar).trim();
    if (!avatarRaw) v.avatar_url = null;
    else { var av = safeHttpsUrl(avatarRaw, LIMITS.avatar); if (av) v.avatar_url = av; else errors.avatar = "La photo doit être un lien https (commençant par https://)."; }

    [["metier", "Le métier ou titre", LIMITS.metier], ["presentation", "La présentation", LIMITS.presentation], ["localisation", "Le pays ou la ville", LIMITS.localisation]].forEach(function (f) {
      var t = cleanLine(s[f[0]], f[2] + 20);
      if (countChars(t) > f[2]) errors[f[0]] = f[1] + " est trop long (" + f[2] + " caractères au maximum).";
      else v[f[0]] = t || null;
    });

    var type = s.contactType == null ? "" : String(s.contactType);
    var val = String(s.contactValeur == null ? "" : s.contactValeur).trim();
    if (type === "" ) {
      if (val) errors.contact = "Choisissez le type de contact (WhatsApp ou lien), ou videz le champ.";
      else { v.contact_type = null; v.contact_valeur = null; }
    } else if (type === "whatsapp") {
      var w = normalizeWhatsapp(val);
      if (w) { v.contact_type = "whatsapp"; v.contact_valeur = w; }
      else errors.contact = "Numéro WhatsApp invalide : utilisez le format international, par exemple +22900000000.";
    } else if (type === "lien") {
      var l = safeHttpsUrl(val, LIMITS.lien);
      if (l) { v.contact_type = "lien"; v.contact_valeur = l; }
      else errors.contact = "Le lien doit commencer par https:// (300 caractères au maximum).";
    } else errors.contact = "Choisissez le type de contact (WhatsApp ou lien).";

    v.publie = s.publier === true;
    v.majeur_declare = s.majeur === true;
    if (v.publie && !v.majeur_declare) errors.majeur = "Pour publier votre page, certifiez avoir 18 ans ou plus.";

    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: v };
  }

  /** Message clair pour une erreur Supabase (enregistrement de la page). */
  function errorMessage(error) {
    var text = String((error && error.message) || ""), code = String((error && error.code) || "");
    if (!error) return "Une erreur est survenue. Réessayez dans un instant.";
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return "Pas de connexion internet. Vérifiez votre réseau puis réessayez.";
    if (code === "23505") return "Cette adresse est déjà prise : choisissez-en une autre.";
    if (/Une fois la page publi/i.test(text)) return "Une fois la page publiée, son adresse ne peut plus être modifiée. Contactez un administrateur si besoin.";
    if (/adresse est reserv/i.test(text)) return "Cette adresse est réservée : choisissez-en une autre.";
    if (/certifiez avoir 18 ans/i.test(text)) return "Pour publier votre page, certifiez avoir 18 ans ou plus.";
    if (code === "42501" || /row-level security|permission denied/i.test(text)) return "Action non autorisée. Reconnectez-vous puis réessayez.";
    if (code === "23514") return "Une information saisie n'est pas valide. Vérifiez le formulaire.";
    return "La page n'a pas pu être enregistrée. Réessayez dans un instant.";
  }

  /** Message pour la vérification de disponibilité (réponse de profil_public_adresse_disponible). */
  function disponibiliteMessage(res) {
    if (res === "libre") return { ok: true, text: "Adresse disponible." };
    if (res === "prise") return { ok: false, text: "Cette adresse est déjà prise." };
    if (res === "reservee") return { ok: false, text: "Cette adresse est réservée : choisissez-en une autre." };
    if (res === "invalide") return { ok: false, text: "Adresse invalide : 3 à 30 caractères, minuscules, chiffres et tirets." };
    return { ok: false, text: "Vérification impossible pour le moment." };
  }

  /**
   * Écran de la page publique. input : { row (ligne lue ou null), preview (true si la ligne vient de l'aperçu propriétaire ou administrateur),
   * ouvert (booléen), statut (réponse de profil_public_statut ou null), readFailed }
   * Renvoie { view: 'profil'|'introuvable'|'non_disponible'|'non_ouverte'|'erreur', banner: null|'non_publie'|'ferme' }.
   * Une ligne du public (profil_public_lire) est toujours une page publiée et ouverte : pas de bandeau. Une ligne d'aperçu (fonctions du
   * propriétaire ou des administrateurs) peut être non publiée ou la fonction fermée : bandeau d'aperçu.
   */
  function pageView(input) {
    var o = input || {};
    if (o.readFailed) return { view: "erreur", banner: null };
    if (o.row && o.preview !== true) return { view: "profil", banner: null };
    if (o.row) {
      if (!o.row.publie) return { view: "profil", banner: "non_publie" };
      if (o.ouvert !== true) return { view: "profil", banner: "ferme" };
      return { view: "profil", banner: null };
    }
    if (o.statut === "non_ouverte") return { view: "non_ouverte", banner: null };
    if (o.statut === "non_disponible") return { view: "non_disponible", banner: null };
    return { view: "introuvable", banner: null };
  }

  var MESSAGES = {
    non_ouverte: "Cette fonction n'est pas encore ouverte.",
    non_disponible: "Ce profil n'est pas disponible.",
    introuvable: "Ce profil est introuvable.",
    erreur: "Impossible de charger ce profil pour le moment. Réessayez dans un instant.",
    non_publie: "Aperçu : cette page n'est pas publiée, vous seul(e) la voyez.",
    ferme: "Aperçu : la fonction n'est pas encore ouverte au public, vous seul(e) voyez cette page."
  };

  /** Adresse lue dans le chemin /m/<adresse> (ou dans ?adresse=) ; null si invalide. */
  function addressFromLocation(pathname, search) {
    var m = /^\/m\/([^\/?#]+)\/?$/.exec(String(pathname || ""));
    var raw = m ? m[1] : null;
    if (!raw) { var q = /(?:^|[?&])adresse=([^&#]+)/.exec(String(search || "")); raw = q ? q[1] : null; }
    if (!raw) return null;
    try { raw = decodeURIComponent(raw); } catch (e) { return null; }
    var a = normalizeAdresse(raw);
    return ADRESSE_RE.test(a) ? a : null;
  }

  return {
    SITE: SITE, ADRESSE_RE: ADRESSE_RE, LIMITS: LIMITS, RESERVEES: RESERVEES, MESSAGES: MESSAGES,
    normalizeAdresse: normalizeAdresse, isReserved: isReserved, validateAdresse: validateAdresse, publicUrl: publicUrl,
    cleanLine: cleanLine, countChars: countChars, normalizeWhatsapp: normalizeWhatsapp, safeHttpsUrl: safeHttpsUrl, whatsappLink: whatsappLink,
    validateProfil: validateProfil, errorMessage: errorMessage, disponibiliteMessage: disponibiliteMessage,
    pageView: pageView, addressFromLocation: addressFromLocation
  };
});
