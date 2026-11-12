/* =========================================================
   entreprise-utils.js — logique pure de la vitrine d'entreprise
   (entreprise.html, admin/vitrines.html, tests/entreprise.test.js)

   Aucun accès réseau, aucune base, aucun DOM : uniquement des fonctions testables.
   Règles :
   - slug : ^[a-z0-9-]{2,40}$ (même règle que la base) ;
   - numéros : normalisés avec l'indicatif ; les liens wa.me et tel: ne sont JAMAIS construits
     avec le texte brut, seulement avec les chiffres extraits ;
   - images : https://res.cloudinary.com/... uniquement ; affichage avec suppression des
     métadonnées (EXIF / GPS) : fl_strip_profile ;
   - prix : entier en FCFA, « Prix sur demande » s'il n'est pas renseigné.
   ========================================================= */
(function (root) {
  "use strict";

  var SLUG_RE = /^[a-z0-9-]{2,40}$/;
  var MAX_PHOTOS = 12;
  var CLOUDINARY_RE = /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]+$/i;   // même règle que la base
  var COUNTRY_CODE = "229";                                              // Bénin

  var PHONE_HELP = "Entrez le numéro à 10 chiffres, qui commence par 01 (exemple : 01 23 45 67 89), avec ou sans +229.";
  var PHONE_HELP_FOREIGN = "Numéro étranger : écrivez-le avec le signe + et l'indicatif du pays (exemple : +33 6 12 34 56 78).";

  function isValidSlug(s) { return typeof s === "string" && SLUG_RE.test(s); }

  /** Texte proposé comme adresse à partir d'un nom : minuscules, sans accents, tirets. */
  function slugify(name) {
    var s = String(name == null ? "" : name)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s.slice(0, 40).replace(/-+$/g, "");
  }

  /**
   * Normalise un numéro saisi.
   * Renvoie { ok:true, empty:true, e164:null, digits:null } pour une saisie vide,
   *         { ok:true, e164:"+229…", digits:"229…" } si valide,
   *         { ok:false, error:"message en français" } sinon.
   * Acceptés : numéro local à 10 chiffres commençant par 01 (Bénin) ; 229 + 10 chiffres ; +229… ; 00229… ;
   * numéro étranger écrit avec « + » (ou « 00 ») et son indicatif (8 à 15 chiffres, sans 0 initial).
   * Refusés : anciens numéros à 8 chiffres, lettres, longueurs inattendues.
   */
  function normalizePhone(input) {
    var raw = String(input == null ? "" : input).trim();
    if (raw === "") return { ok: true, empty: true, e164: null, digits: null };
    if (/[^0-9+\s().-]/.test(raw)) return { ok: false, error: "Le numéro ne doit contenir que des chiffres, des espaces, +, ( ) . ou -." };

    var international = /^\+/.test(raw) || /^00/.test(raw.replace(/[^0-9+]/g, ""));
    var digits = raw.replace(/\D/g, "");
    if (/^\+/.test(raw) === false && /^00/.test(digits)) digits = digits.slice(2);

    function beninNational(national) {
      return /^01[0-9]{8}$/.test(national) ? { ok: true, e164: "+" + COUNTRY_CODE + national, digits: COUNTRY_CODE + national } : null;
    }

    if (international) {
      if (digits.indexOf(COUNTRY_CODE) === 0) {
        return beninNational(digits.slice(3)) || { ok: false, error: PHONE_HELP };
      }
      if (/^[1-9][0-9]{7,14}$/.test(digits)) return { ok: true, e164: "+" + digits, digits: digits };
      return { ok: false, error: PHONE_HELP_FOREIGN };
    }

    if (digits.length === 10) return beninNational(digits) || { ok: false, error: PHONE_HELP };
    if (digits.length === 13 && digits.indexOf(COUNTRY_CODE) === 0) return beninNational(digits.slice(3)) || { ok: false, error: PHONE_HELP };
    return { ok: false, error: PHONE_HELP };
  }

  /** Lien WhatsApp (chiffres uniquement) avec message pré-rempli, ou null (numéro vide ou invalide). */
  function whatsappLink(phone, nomCommercial) {
    var n = normalizePhone(phone);
    if (!n.ok || n.empty) return null;
    var nom = String(nomCommercial == null ? "" : nomCommercial).replace(/\s+/g, " ").trim();
    var text = "Bonjour, je vous contacte depuis votre page " + nom + ".";
    return "https://wa.me/" + n.digits + "?text=" + encodeURIComponent(text);
  }

  /** Lien tel: (chiffres uniquement, avec +), ou null. */
  function telLink(phone) {
    var n = normalizePhone(phone);
    if (!n.ok || n.empty) return null;
    return "tel:+" + n.digits;
  }

  /** Prix affiché : « 12 500 FCFA », ou « Prix sur demande » si absent / non valide. */
  function priceLabel(prix) {
    if (prix === null || prix === undefined || prix === "") return "Prix sur demande";
    var n = Number(prix);
    if (!Number.isInteger(n) || n <= 0) return "Prix sur demande";
    return n.toLocaleString("fr-FR") + " FCFA";
  }

  function availabilityLabel(disponible) { return disponible === false ? "Indisponible" : "Disponible"; }

  /** Tri par position croissante (nulls à la fin), puis date de création, puis identifiant. Nouvelle liste. */
  function sortByPosition(list) {
    return (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
      var pa = Number.isFinite(Number(a && a.position)) && a.position !== null ? Number(a.position) : Infinity;
      var pb = Number.isFinite(Number(b && b.position)) && b.position !== null ? Number(b.position) : Infinity;
      if (pa !== pb) return pa < pb ? -1 : 1;
      var ca = String((a && a.created_at) || ""), cb = String((b && b.created_at) || "");
      if (ca !== cb) return ca < cb ? -1 : 1;
      var ia = String((a && a.id) || ""), ib = String((b && b.id) || "");
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
  }

  /**
   * Déplace l'élément d'index i de delta (-1 monter, +1 descendre) et renvoie la nouvelle liste
   * avec des positions 0..n-1 ; la liste d'origine n'est pas modifiée. Hors limites : même ordre.
   */
  function moveItem(list, index, delta) {
    var arr = sortByPosition(list).map(function (x) { return Object.assign({}, x); });
    var j = index + delta;
    if (index < 0 || index >= arr.length || j < 0 || j >= arr.length) {
      return arr.map(function (x, i) { x.position = i; return x; });
    }
    var tmp = arr[index]; arr[index] = arr[j]; arr[j] = tmp;
    return arr.map(function (x, i) { x.position = i; return x; });
  }

  function canAddPhoto(count) { return Number(count) < MAX_PHOTOS; }
  function photoCounter(count) { return Math.min(Number(count) || 0, MAX_PHOTOS) + " / " + MAX_PHOTOS + " photos"; }
  function photoAlt(photo, nomCommercial) {
    var l = photo && typeof photo.legende === "string" ? photo.legende.trim() : "";
    return l || "Photo de " + String(nomCommercial == null ? "" : nomCommercial).trim();
  }

  function isCloudinaryUrl(url) { return typeof url === "string" && url.length <= 500 && CLOUDINARY_RE.test(url); }

  /**
   * Adresse d'affichage : transformation « f_auto,q_auto,fl_strip_profile,w_<largeur>,c_limit » insérée
   * après /upload/ (fl_strip_profile retire les métadonnées EXIF/GPS de l'image livrée). Une adresse qui contient
   * déjà un segment de transformation n'est pas modifiée. Renvoie null si l'adresse n'est pas une image Cloudinary.
   */
  function imageDeliveryUrl(url, width) {
    if (!isCloudinaryUrl(url)) return null;
    var i = url.indexOf("/upload/");
    if (i === -1) return url;
    var after = url.slice(i + 8);
    var first = after.split("/")[0];
    if (!/^v\d+$/.test(first) && after.indexOf("/") !== -1 && /^[a-z]{1,4}_|,/.test(first)) return url;
    var w = Math.max(16, Math.min(4000, Math.round(Number(width) || 800)));
    return url.slice(0, i + 8) + "f_auto,q_auto,fl_strip_profile,w_" + w + ",c_limit/" + after;
  }

  /** Adresse partageable d'une vitrine (site fixe, comme les salons). */
  function shareUrl(slug) { return isValidSlug(slug) ? "https://mahouto.com/e/" + slug : null; }

  var api = {
    SLUG_RE: SLUG_RE, MAX_PHOTOS: MAX_PHOTOS, PHONE_HELP: PHONE_HELP, PHONE_HELP_FOREIGN: PHONE_HELP_FOREIGN,
    isValidSlug: isValidSlug, slugify: slugify, normalizePhone: normalizePhone,
    whatsappLink: whatsappLink, telLink: telLink, priceLabel: priceLabel, availabilityLabel: availabilityLabel,
    sortByPosition: sortByPosition, moveItem: moveItem, canAddPhoto: canAddPhoto, photoCounter: photoCounter,
    photoAlt: photoAlt, isCloudinaryUrl: isCloudinaryUrl, imageDeliveryUrl: imageDeliveryUrl, shareUrl: shareUrl
  };
  root.MahoutoEntreprise = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
