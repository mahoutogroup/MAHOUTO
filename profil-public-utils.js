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

  var SITE = "https://mahouto.com";   // adresse fixe : jamais window.location, jamais un autre domaine
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
   * input : { adresse, nom, avatar, metier, presentation, localisation, contactType ('' | 'whatsapp' | 'lien'), contactValeur, messagesOuverts, publier, majeur }
   * Renvoie { ok:true, value:{ adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, messages_ouverts, publie, majeur_declare } }
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

    v.messages_ouverts = s.messagesOuverts === true;
    v.publie = s.publier === true;
    v.majeur_declare = s.majeur === true;
    if (v.publie && !v.majeur_declare) errors.majeur = "Pour publier votre page, certifiez avoir 18 ans ou plus.";

    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: v };
  }

  // Photo téléversée (même mécanisme que la photo de profil) : types et taille contrôlés AVANT l'envoi.
  var AVATAR_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var AVATAR_MAX_BYTES = 5 * 1024 * 1024;   // 5 Mo

  /** Contrôle le fichier choisi. Renvoie { ok:true, type, ext } ou { ok:false, error } (message en français). */
  function validateAvatarFile(file) {
    if (!file) return { ok: false, error: "Aucune photo choisie." };
    var type = String(file.type || "").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(AVATAR_TYPES, type)) return { ok: false, error: "Format non accepté : choisissez une photo JPEG, PNG ou WebP." };
    var size = Number(file.size);
    if (!isFinite(size) || size <= 0) return { ok: false, error: "Ce fichier est vide." };
    if (size > AVATAR_MAX_BYTES) return { ok: false, error: "Cette photo est trop lourde (5 Mo au maximum)." };
    return { ok: true, type: type, ext: AVATAR_TYPES[type] };
  }

  /** Nom envoyé à la signature : jamais le nom d'origine du fichier (il peut contenir des informations personnelles). */
  function avatarFilename(ext) { return "photo-profil." + (ext === "png" || ext === "webp" ? ext : "jpg"); }

  /** URL reçue de Cloudinary : https://res.cloudinary.com/… obligatoire, 500 caractères au plus (contrainte de la base). Sinon null. */
  function cloudinaryImageUrl(url) {
    var safe = safeHttpsUrl(url, LIMITS.avatar);
    if (!safe) return null;
    try { return new URL(safe).hostname === "res.cloudinary.com" ? safe : null; } catch (e) { return null; }
  }

  // ---------- Signalement d'une page (PR 2 sur 3) ----------
  var MOTIFS_SIGNALEMENT = [
    { value: "spam", label: "Spam ou publicité" },
    { value: "usurpation", label: "Usurpation d'identité" },
    { value: "arnaque", label: "Arnaque ou fraude" },
    { value: "inapproprie", label: "Contenu inapproprié" },
    { value: "donnees_personnelles", label: "Données personnelles exposées" },
    { value: "autre", label: "Autre" }
  ];
  var SIGNALEMENT_DETAIL_MAX = 300;
  var SEUIL_A_EXAMINER = 3;   // signaleurs distincts non traités : simple indicateur, jamais de suspension automatique
  var SIGNALEMENT_AVERTISSEMENT = "Votre signalement est envoyé à l'équipe de modération. Il n'est jamais montré à la personne signalée.";

  function motifLabel(code) {
    for (var i = 0; i < MOTIFS_SIGNALEMENT.length; i++) if (MOTIFS_SIGNALEMENT[i].value === code) return MOTIFS_SIGNALEMENT[i].label;
    return "Motif inconnu";
  }

  /** Valide la saisie du signalement. Renvoie { ok:true, value:{ motif, detail } } ou { ok:false, errors:{ motif, detail } }. */
  function validateSignalement(input) {
    var s = input && typeof input === "object" ? input : {};
    var errors = {}, v = {};
    if (typeof s.motif !== "string" || !MOTIFS_SIGNALEMENT.some(function (m) { return m.value === s.motif; })) errors.motif = "Choisissez un motif.";
    else v.motif = s.motif;
    var detail = cleanLine(s.detail, SIGNALEMENT_DETAIL_MAX + 50);
    if (countChars(detail) > SIGNALEMENT_DETAIL_MAX) errors.detail = "Les précisions sont trop longues (" + SIGNALEMENT_DETAIL_MAX + " caractères au maximum).";
    else v.detail = detail || null;
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: v };
  }

  /** Message pour le code renvoyé par profil_public_signaler : ok, deja, propre_page, introuvable, limite, invalide, ferme. */
  function signalementMessage(code) {
    switch (code) {
      case "ok": return { ok: true, text: "Merci, votre signalement a été envoyé à l'équipe de modération." };
      case "deja": return { ok: false, text: "Vous avez déjà signalé cette page." };
      case "propre_page": return { ok: false, text: "Vous ne pouvez pas signaler votre propre page." };
      case "introuvable": return { ok: false, text: "Cette page n'est plus disponible : elle ne peut pas être signalée." };
      case "limite": return { ok: false, text: "Vous avez atteint la limite de signalements pour aujourd'hui. Réessayez demain." };
      case "invalide": return { ok: false, text: "Le signalement n'est pas valide. Vérifiez le motif et les précisions." };
      case "ferme": return { ok: false, text: "Cette fonction n'est pas encore ouverte." };
      default: return { ok: false, text: "Le signalement n'a pas pu être envoyé. Réessayez dans un instant." };
    }
  }

  /**
   * Que montrer sous la page publique ? 'bouton' (membre connecté qui n'est pas le propriétaire), 'connexion' (visiteur non connecté),
   * 'aucun' (aperçu, bandeau, page non affichée, propriétaire). input : { view, banner, preview, connected, isOwner }
   */
  function reportUi(input) {
    var o = input || {};
    if (o.view !== "profil" || o.preview === true || o.banner) return "aucun";
    if (o.connected !== true) return "connexion";
    return o.isOwner === true ? "aucun" : "bouton";
  }

  /** Comptage par motif lisible : « Spam ou publicité : 2 · Arnaque ou fraude : 1 » (ordre de la liste des motifs). */
  function formatMotifs(counts) {
    var c = counts && typeof counts === "object" ? counts : {};
    return MOTIFS_SIGNALEMENT.filter(function (m) { return Number(c[m.value]) > 0; })
      .map(function (m) { return m.label + " : " + Number(c[m.value]); }).join(" · ");
  }

  // ---------- Écrire un message depuis la page publique ----------
  var ECRIRE_AIDE = "Votre message sera lu par cette personne. Restez respectueux.";
  var ECRIRE_CONNEXION = "Connectez-vous pour écrire à cette personne";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Message pour le code renvoyé par profil_public_ecrire : ok, non_connecte, invalide, ferme, introuvable, propre_page, desactive, limite. */
  function ecrireMessage(code) {
    switch (code) {
      case "ok": return { ok: true, text: "Ouverture de la conversation…" };
      case "desactive": return { ok: false, text: "Cette personne n'accepte pas les messages pour le moment." };
      case "limite": return { ok: false, text: "Vous avez atteint la limite de nouvelles conversations pour aujourd'hui. Réessayez demain." };
      case "propre_page": return { ok: false, text: "Vous ne pouvez pas vous écrire à vous-même." };
      case "introuvable": return { ok: false, text: "Cette page n'est plus disponible : vous ne pouvez pas écrire à cette personne." };
      case "ferme": return { ok: false, text: "Cette fonction n'est pas encore ouverte." };
      case "non_connecte": return { ok: false, text: "Connectez-vous pour écrire à cette personne." };
      case "invalide": return { ok: false, text: "Cette adresse n'est pas valide." };
      default: return { ok: false, text: "La conversation n'a pas pu être ouverte. Réessayez dans un instant." };
    }
  }

  /** Adresse de la conversation : conversation et nom seulement, JAMAIS le paramètre « with » (aucun identifiant de compte). Null si invalide. */
  function dmUrl(conversationId, nom) {
    if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return null;
    return "/dm-chat.html?conv=" + encodeURIComponent(conversationId) + "&name=" + encodeURIComponent(cleanLine(nom, 60) || "Utilisateur");
  }

  /**
   * Que montrer pour « Écrire un message » ? 'bouton' (membre connecté non propriétaire), 'connexion' (visiteur non connecté),
   * 'aucun' (page qui n'accepte pas les messages, propriétaire, aperçu, bandeau, page non affichée).
   * input : { view, banner, preview, connected, isOwner, messagesOuverts }
   */
  function messagesUi(input) {
    var o = input || {};
    if (o.view !== "profil" || o.preview === true || o.banner || o.messagesOuverts !== true) return "aucun";
    if (o.connected !== true) return "connexion";
    return o.isOwner === true ? "aucun" : "bouton";
  }

  // ---------- QR code et visites (PR 3 sur 3) ----------
  var QR_SOURCE = "qr";   // valeur de ?src= reconnue par analytics.js (SOURCE_RE : minuscules, chiffres, _ et -)
  var QR_QUIET_MODULES = 4;
  var QR_MIN_PX = 1024;
  var QR_TEXTE = "Ce QR code ouvre votre page. L'adresse de la page ne change plus après la première publication : vous pouvez l'imprimer sans risque.";
  var VISITES_TEXTE = "Nous comptons des visites, pas des personnes : aucun nom, aucune identité de visiteur n'est enregistré.";

  /** Adresse encodée dans le QR : https://mahouto.com/m/<adresse>?src=qr ; null si l'adresse est invalide. */
  function qrUrl(adresse) { return typeof adresse === "string" && ADRESSE_RE.test(adresse) ? SITE + "/m/" + adresse + "?src=" + QR_SOURCE : null; }

  /** Nom du fichier téléchargé : mahouto-<adresse>-qr.png / .svg ; null si l'adresse ou l'extension est invalide. */
  function qrFilename(adresse, ext) {
    return typeof adresse === "string" && ADRESSE_RE.test(adresse) && (ext === "png" || ext === "svg") ? "mahouto-" + adresse + "-qr." + ext : null;
  }

  /** Mise en page : marge blanche de 4 modules, échelle entière pour une taille d'au moins minPx (1024 par défaut). */
  function qrLayout(moduleCount, minPx) {
    var n = Math.floor(Number(moduleCount));
    if (!isFinite(n) || n < 1) return null;
    var size = n + QR_QUIET_MODULES * 2;
    var scale = Math.max(1, Math.ceil((minPx || QR_MIN_PX) / size));
    return { quiet: QR_QUIET_MODULES, modules: n, size: size, scale: scale, px: size * scale };
  }

  /** SVG du QR : fond blanc, modules noirs, marge de 4 modules. Uniquement des nombres : aucun texte venant de l'utilisateur. */
  function qrSvgString(moduleCount, isDark) {
    var L = qrLayout(moduleCount, 1);
    if (!L || typeof isDark !== "function") return null;
    var d = "";
    for (var r = 0; r < L.modules; r++) for (var c = 0; c < L.modules; c++) if (isDark(r, c)) d += "M" + (c + L.quiet) + " " + (r + L.quiet) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.size + " " + L.size + '" width="' + (L.size * 10) + '" height="' + (L.size * 10) +
      '" shape-rendering="crispEdges"><rect width="' + L.size + '" height="' + L.size + '" fill="#ffffff"/><path d="' + d + '" fill="#000000"/></svg>';
  }

  /** Date courte « jj/mm » d'un jour « aaaa-mm-jj » ; « — » si invalide. */
  function formatJourCourt(jour) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jour || ""));
    return m ? m[3] + "/" + m[2] : "—";
  }

  /**
   * Résumé des visites. rows : lignes de profil_public_visites_mien(30) { jour, visites, qr, lien, autre }, du plus ancien au plus récent.
   * Renvoie { total7, total30, qr, lien, autre, days7:[{ jour, visites }] } (répartition sur la période reçue). Valeurs invalides = 0.
   */
  function summarizeVisites(rows) {
    var list = Array.isArray(rows) ? rows.filter(function (r) { return r && typeof r === "object"; }) : [];
    function n(x) { var v = Number(x); return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
    var out = { total7: 0, total30: 0, qr: 0, lien: 0, autre: 0, days7: [] };
    list.forEach(function (r) { out.total30 += n(r.visites); out.qr += n(r.qr); out.lien += n(r.lien); out.autre += n(r.autre); });
    list.slice(-7).forEach(function (r) { out.total7 += n(r.visites); out.days7.push({ jour: String(r.jour || ""), visites: n(r.visites) }); });
    return out;
  }

  // ---------- Carte de visite : action de contact, partage, dessin du QR ----------
  var CONTACT_LIBELLES = { whatsapp: "Contacter sur WhatsApp", lien: "Visiter le lien" };

  /** Domaine seul d'un lien https (sans « www. », sans chemin ni paramètres) ; null si le lien n'est pas un https sûr. */
  function domainOf(url) {
    var safe = safeHttpsUrl(url, LIMITS.lien);
    if (!safe) return null;
    try { return new URL(safe).hostname.replace(/^www\./, "") || null; } catch (e) { return null; }
  }

  /**
   * Action principale de la carte. Renvoie { kind:'whatsapp'|'lien', href, label, domain } ou null (aucun contact valide).
   * WhatsApp : lien wa.me, jamais le numéro affiché. Lien : seulement le domaine est affiché (jamais l'adresse entière).
   */
  function contactAction(row) {
    var r = row && typeof row === "object" ? row : {};
    if (r.contact_type === "whatsapp") {
      var w = whatsappLink(r.contact_valeur);
      return w ? { kind: "whatsapp", href: w, label: CONTACT_LIBELLES.whatsapp, domain: null } : null;
    }
    if (r.contact_type === "lien") {
      var l = safeHttpsUrl(r.contact_valeur, LIMITS.lien), d = l ? domainOf(l) : null;
      return l && d ? { kind: "lien", href: l, label: CONTACT_LIBELLES.lien, domain: d } : null;
    }
    return null;
  }

  /** Initiale affichée sans photo (première lettre du nom, en majuscule) ; « ? » si le nom est vide. */
  function initialOf(nom) { var c = Array.from(String(nom == null ? "" : nom).trim())[0]; return c ? c.toUpperCase() : "?"; }

  /** Titre de la feuille de partage. */
  function shareTitle(nom) { return "Partager la page de " + (cleanLine(nom, LIMITS.nom) || "ce membre"); }

  /**
   * Lien copié ou envoyé par « Partager » : https://mahouto.com/m/<adresse> SANS ?src=. Choix volontaire : l'aperçu de partage
   * (api/_profil-og.js) ajoute lui-même src=partage (ou facebook, instagram, tiktok) à l'ouverture par un humain ; un ?src= écrit
   * ici fausserait la répartition. Seul le QR porte ?src=qr. Null si l'adresse est invalide.
   */
  function shareLink(adresse) { return typeof adresse === "string" && ADRESSE_RE.test(adresse) ? publicUrl(adresse) : null; }

  /** Données pour navigator.share : titre et lien seulement. Null si l'adresse est invalide. */
  function sharePayload(nom, adresse, brandName) {
    var url = shareLink(adresse);
    if (!url) return null;
    var n = cleanLine(nom, LIMITS.nom) || "Profil";
    return { title: n + " — " + (cleanLine(brandName, 30) || "MAHOUTO+"), url: url };
  }

  /** Fabrique le QR (niveau Q) de l'adresse du QR ; null si l'adresse ou la bibliothèque est invalide. qrcodeFn = window.qrcode. */
  function makeQr(qrcodeFn, adresse) {
    var url = qrUrl(adresse);
    if (!url || typeof qrcodeFn !== "function") return null;
    try { var qr = qrcodeFn(0, "Q"); qr.addData(url); qr.make(); return qr; } catch (e) { return null; }
  }

  /** Peint les modules noirs du QR sur un contexte 2D, à partir de (ox, oy), avec la mise en page L (qrLayout), marge blanche non peinte. */
  function paintQr(ctx, qr, L, ox, oy) {
    ctx.fillStyle = "#000000";
    for (var r = 0; r < L.modules; r++) for (var c = 0; c < L.modules; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((ox || 0) + (c + L.quiet) * L.scale, (oy || 0) + (r + L.quiet) * L.scale, L.scale, L.scale);
    }
  }

  /** Élément SVG du QR (fond blanc, modules noirs, marge de 4 modules) construit avec doc.createElementNS : aucun texte venant de l'utilisateur. */
  function qrSvgNode(doc, qr, label) {
    var n = qr.getModuleCount(), L = qrLayout(n, 1), NS = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + L.size + " " + L.size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    svg.setAttribute("shape-rendering", "crispEdges");
    var bg = doc.createElementNS(NS, "rect");
    bg.setAttribute("width", String(L.size)); bg.setAttribute("height", String(L.size)); bg.setAttribute("fill", "#ffffff");
    var path = doc.createElementNS(NS, "path"), d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + (c + L.quiet) + " " + (r + L.quiet) + "h1v1h-1z";
    path.setAttribute("d", d); path.setAttribute("fill", "#000000");
    svg.appendChild(bg); svg.appendChild(path);
    return svg;
  }

  // ---------- Rappel « fonction OUVERTE » (admin) ----------
  var OUVERT_INSISTANT_MIN = 120;       // à partir de 2 h : message plus insistant
  var OUVERT_MAX_MIN = 7 * 24 * 60;     // au-delà de 7 jours : plus de durée précise

  function formatDuree(minutes) {
    if (minutes < 1) return "moins d'1 min";
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h > 0 ? h + " h " + m + " min" : m + " min";
  }

  /**
   * Texte du bandeau « fonction OUVERTE » à partir de maj_le (date de la dernière modification de l'interrupteur) et de l'heure
   * du navigateur (nowMs). Renvoie { known, minutes, level: 'normal'|'insistant', text }.
   * maj_le absent, invalide ou dans le futur (horloge du téléphone en retard sur la base) : « La fonction est OUVERTE » sans durée.
   */
  function ouvertDepuis(majLe, nowMs) {
    var t = typeof majLe === "string" ? Date.parse(majLe) : NaN, now = Number(nowMs);
    if (!isFinite(t) || !isFinite(now) || now < t) return { known: false, minutes: null, level: "normal", text: "La fonction est OUVERTE" };
    var minutes = Math.floor((now - t) / 60000);
    if (minutes > OUVERT_MAX_MIN) return { known: true, minutes: minutes, level: "insistant", text: "La fonction est OUVERTE depuis plus de 7 jours : si ce n'est pas voulu, fermez-la maintenant." };
    if (minutes >= OUVERT_INSISTANT_MIN) return { known: true, minutes: minutes, level: "insistant", text: "La fonction est OUVERTE depuis plus de 2 h (" + formatDuree(minutes) + ") : si ce n'est pas voulu, fermez-la maintenant." };
    return { known: true, minutes: minutes, level: "normal", text: "La fonction est OUVERTE depuis " + formatDuree(minutes) + ". Pensez à la refermer après vos tests." };
  }

  /** Date « jj/mm/aaaa » (heure locale) ; « — » si absente ou invalide. */
  function formatDateFr(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
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
    pageView: pageView, addressFromLocation: addressFromLocation,
    ECRIRE_AIDE: ECRIRE_AIDE, ECRIRE_CONNEXION: ECRIRE_CONNEXION, ecrireMessage: ecrireMessage, dmUrl: dmUrl, messagesUi: messagesUi,
    QR_SOURCE: QR_SOURCE, QR_QUIET_MODULES: QR_QUIET_MODULES, QR_MIN_PX: QR_MIN_PX, QR_TEXTE: QR_TEXTE, VISITES_TEXTE: VISITES_TEXTE,
    OUVERT_INSISTANT_MIN: OUVERT_INSISTANT_MIN, ouvertDepuis: ouvertDepuis,
    domainOf: domainOf, contactAction: contactAction, initialOf: initialOf, shareTitle: shareTitle, shareLink: shareLink, sharePayload: sharePayload,
    makeQr: makeQr, paintQr: paintQr, qrSvgNode: qrSvgNode,
    qrUrl: qrUrl, qrFilename: qrFilename, qrLayout: qrLayout, qrSvgString: qrSvgString, formatJourCourt: formatJourCourt, summarizeVisites: summarizeVisites,
    AVATAR_TYPES: AVATAR_TYPES, AVATAR_MAX_BYTES: AVATAR_MAX_BYTES, validateAvatarFile: validateAvatarFile, avatarFilename: avatarFilename,
    cloudinaryImageUrl: cloudinaryImageUrl, formatDateFr: formatDateFr,
    MOTIFS_SIGNALEMENT: MOTIFS_SIGNALEMENT, SIGNALEMENT_DETAIL_MAX: SIGNALEMENT_DETAIL_MAX, SEUIL_A_EXAMINER: SEUIL_A_EXAMINER,
    SIGNALEMENT_AVERTISSEMENT: SIGNALEMENT_AVERTISSEMENT, motifLabel: motifLabel, validateSignalement: validateSignalement,
    signalementMessage: signalementMessage, reportUi: reportUi, formatMotifs: formatMotifs
  };
});
