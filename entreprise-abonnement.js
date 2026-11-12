/* =========================================================
   entreprise-abonnement.js — logique pure de l'abonnement des vitrines d'entreprise
   (abonnement.html, admin/vitrines.html, tests/entreprise-abonnement.test.js)

   Aucun accès réseau, aucune base, aucun DOM. Règles (identiques à entreprises-abonnement.sql) :
   - visible publiquement : published = true ET (offerte = true OU expire_le > maintenant) ;
   - chaque paiement confirmé ajoute les jours à la plus grande valeur entre « maintenant » et
     l'ancien expire_le (les paiements se cumulent) ;
   - le navigateur n'est qu'un AFFICHAGE : la visibilité et la prolongation sont décidées par la base
     (RLS, fonctions SQL) et par le webhook serveur, jamais par ce fichier.
   ========================================================= */
(function (root) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var CODE_RE = /^[a-z0-9_-]{2,30}$/;
  var MAX_JOURS = 3650;
  var MAX_MONTANT = 10000000;

  var STATUS_LABELS = { active: "Active", expiree: "Expirée", offerte: "Offerte", jamais_payee: "Jamais payée" };
  var PAYMENT_STATUS_LABELS = { en_attente: "En attente", confirme: "Confirmé", echoue: "Échoué" };
  var SOURCE_LABELS = { fedapay: "FedaPay", manuel: "Manuel" };

  function isValidUuid(s) { return typeof s === "string" && UUID_RE.test(s); }

  function toMs(x) {
    if (x instanceof Date) return x.getTime();
    if (typeof x === "number") return x;
    if (typeof x === "string") return Date.parse(x);
    return NaN;
  }

  /** Règle de visibilité publique (même règle que public.entreprise_est_visible). */
  function isVisible(row, now) {
    if (!row || row.published !== true) return false;
    if (row.offerte === true) return true;
    var t = toMs(row.expire_le);
    var n = now === undefined ? Date.now() : toMs(now);
    return Number.isFinite(t) && t > n;
  }

  /** Statut d'abonnement affiché dans l'administration : offerte, active, expiree ou jamais_payee. */
  function subscriptionStatus(row, now) {
    if (!row) return "jamais_payee";
    if (row.offerte === true) return "offerte";
    var t = toMs(row.expire_le);
    if (!Number.isFinite(t)) return "jamais_payee";
    var n = now === undefined ? Date.now() : toMs(now);
    return t > n ? "active" : "expiree";
  }

  /** Nouvelle date d'expiration (ISO) après un paiement : max(maintenant, ancien expire_le) + jours. */
  function extendExpiry(expireLe, jours, now) {
    var n = now === undefined ? Date.now() : toMs(now);
    var j = Number(jours);
    if (!Number.isInteger(j) || j < 1 || j > MAX_JOURS) throw new Error("Nombre de jours invalide");
    var old = toMs(expireLe);
    var base = Number.isFinite(old) && old > n ? old : n;
    return new Date(base + j * DAY_MS).toISOString();
  }

  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }

  /** Temps restant / écoulé, en français. */
  function remainingLabel(row, now) {
    var st = subscriptionStatus(row, now);
    if (st === "offerte") return "Gratuite (offerte) : sans date d'expiration";
    if (st === "jamais_payee") return "Jamais payée";
    var n = now === undefined ? Date.now() : toMs(now);
    var diff = toMs(row.expire_le) - n;
    var abs = Math.abs(diff);
    var days = Math.floor(abs / DAY_MS);
    var hours = Math.floor((abs % DAY_MS) / 3600000);
    var minutes = Math.floor((abs % 3600000) / 60000);
    var txt = days >= 1 ? plural(days, "jour", "jours") + (hours ? " " + plural(hours, "heure", "heures") : "")
      : hours >= 1 ? plural(hours, "heure", "heures") + (minutes ? " " + plural(minutes, "minute", "minutes") : "")
      : plural(Math.max(minutes, 0), "minute", "minutes");
    return diff > 0 ? "Il reste " + txt : "Expirée depuis " + txt;
  }

  function formatDate(iso) {
    var t = toMs(iso);
    if (!Number.isFinite(t)) return "";
    try { return new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return new Date(t).toISOString(); }
  }

  function formatFcfa(n) {
    var v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString("fr-FR") + " FCFA" : "";
  }

  /** Problème d'un forfait saisi dans l'administration (message en français) ou null. */
  function forfaitProblem(f) {
    if (!f) return "Forfait manquant.";
    if (typeof f.code !== "string" || !CODE_RE.test(f.code)) return "Code invalide : 2 à 30 caractères (lettres minuscules, chiffres, - et _).";
    var lib = typeof f.libelle === "string" ? f.libelle.trim() : "";
    if (lib.length < 2 || lib.length > 60) return "Le libellé doit faire entre 2 et 60 caractères.";
    if (!Number.isInteger(f.jours) || f.jours < 1 || f.jours > MAX_JOURS) return "Le nombre de jours doit être un entier entre 1 et " + MAX_JOURS + ".";
    if (!Number.isInteger(f.montant) || f.montant < 1 || f.montant > MAX_MONTANT) return "Le montant doit être un entier de FCFA supérieur à 0.";
    if (f.ordre !== undefined && !Number.isInteger(f.ordre)) return "L'ordre doit être un nombre entier.";
    return null;
  }

  /** Forfait proposable à la vente : actif, jours et montant entiers > 0. */
  function isPurchasable(f) {
    return !!f && f.actif === true && Number.isInteger(f.jours) && f.jours > 0 && Number.isInteger(f.montant) && f.montant > 0;
  }

  /** Lien de paiement à envoyer au commerçant : <site>/abonnement.html?v=<id>[&f=<code>]. */
  function paymentLink(baseHref, entrepriseId, forfaitCode) {
    if (!isValidUuid(entrepriseId)) return null;
    var url = new URL("abonnement.html", baseHref);
    url.search = "";
    url.searchParams.set("v", entrepriseId);
    if (typeof forfaitCode === "string" && CODE_RE.test(forfaitCode)) url.searchParams.set("f", forfaitCode);
    return url.toString();
  }

  /** Message WhatsApp à envoyer au propriétaire (le lien est ajouté tel quel). */
  function shareMessage(nom, link) {
    var n = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
    return "Bonjour, voici le lien pour payer l'abonnement de votre vitrine" + (n ? " « " + n + " »" : "") + " : " + link;
  }
  function whatsappShareLink(text) { return "https://wa.me/?text=" + encodeURIComponent(text); }

  var api = {
    DAY_MS: DAY_MS, MAX_JOURS: MAX_JOURS, MAX_MONTANT: MAX_MONTANT, UUID_RE: UUID_RE, CODE_RE: CODE_RE,
    STATUS_LABELS: STATUS_LABELS, PAYMENT_STATUS_LABELS: PAYMENT_STATUS_LABELS, SOURCE_LABELS: SOURCE_LABELS,
    isValidUuid: isValidUuid, isVisible: isVisible, subscriptionStatus: subscriptionStatus, extendExpiry: extendExpiry,
    remainingLabel: remainingLabel, formatDate: formatDate, formatFcfa: formatFcfa, forfaitProblem: forfaitProblem,
    isPurchasable: isPurchasable, paymentLink: paymentLink, shareMessage: shareMessage, whatsappShareLink: whatsappShareLink
  };
  root.MahoutoAbonnement = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
