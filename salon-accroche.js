/* =========================================================
   salon-accroche.js — phrase d'accroche d'un salon payant (chat.html : écran verrouillé ; admin/rooms.html : réglages).

   - Au plus 120 caractères (la base impose la même limite : salon-accroche.sql), une seule ligne.
   - Texte BRUT : les pages l'affichent avec textContent, jamais en HTML. Retours à la ligne et tabulations retirés, espaces
     multiples réduits, bords rognés. Aucun lien cliquable.
   - Refus à l'enregistrement si la phrase contient un lien ou une adresse web (http://, www., domaine.com…) : une accroche est
     une phrase, pas une publicité ; elle s'affiche à des visiteurs non connectés et ne doit pas servir à les rediriger.
   - À l'affichage, une phrase qui contiendrait quand même un lien (écrite hors de l'application) est ignorée : texte par défaut.
   Module UMD : testé sans navigateur (tests/salon-accroche.test.js).
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MahoutoSalonAccroche = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MAX = 120;
  var DEFAULT_TEXT = "Rejoignez cette communauté pour lire et écrire les messages.";
  var MSG_LIEN = "L'accroche ne peut pas contenir de lien ni d'adresse web. Retirez-le, puis réessayez.";
  var MSG_LONG = "L'accroche ne doit pas dépasser " + MAX + " caractères.";

  // Extensions courantes : « vente.com », « wa.me », « bit.ly »… (une ponctuation sans espace comme « fin.Merci » n'en fait pas partie)
  var TLD = "com|net|org|info|biz|fr|bj|tg|ci|sn|ng|gh|ca|uk|us|de|be|ch|eu|io|co|me|ly|tv|ai|app|dev|page|link|site|online|store|shop|xyz|top|club|tk|cc|ws|gl";
  var LIEN_RE = new RegExp("(https?:|ftp:|mailto:|www\\.|//)|[a-z0-9-]\\.(" + TLD + ")(?![a-z0-9])", "i");

  /** Texte propre : une seule ligne, espaces réduits, bords rognés (jamais de HTML interprété : la page utilise textContent). */
  function clean(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function length(text) { return Array.from(clean(text)).length; }

  /** Vrai si la phrase contient un lien ou une adresse web. */
  function hasLink(text) { return LIEN_RE.test(clean(text)); }

  /** Validation avant enregistrement : { ok, value (texte propre ou null si vide), error }. */
  function validate(text) {
    var v = clean(text);
    if (!v) return { ok: true, value: null, error: null };
    if (Array.from(v).length > MAX) return { ok: false, value: null, error: MSG_LONG };
    if (LIEN_RE.test(v)) return { ok: false, value: null, error: MSG_LIEN };
    return { ok: true, value: v, error: null };
  }

  /** Texte à afficher sur l'écran verrouillé : l'accroche propre, sinon le texte par défaut (jamais de lien, jamais plus de 120). */
  function display(raw) {
    var v = clean(raw);
    if (!v || LIEN_RE.test(v)) return DEFAULT_TEXT;
    return Array.from(v).slice(0, MAX).join("");
  }

  function counterText(text) { return length(text) + " / " + MAX; }

  return { MAX: MAX, DEFAULT_TEXT: DEFAULT_TEXT, MSG_LIEN: MSG_LIEN, MSG_LONG: MSG_LONG, clean: clean, length: length, hasLink: hasLink, validate: validate, display: display, counterText: counterText };
});
