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

  // ---------- Champ de saisie (textarea qui grandit avec le texte, une seule ligne logique) ----------
  var BREAKS = /[\r\n\t\u2028\u2029]+/g;
  var bound = [];   // champs reliés : on les réajuste quand la largeur de l'écran change

  /**
   * Hauteur = hauteur du contenu (aucune barre de défilement) : on repart de « auto », puis on prend scrollHeight + bordures.
   * Champ vide : une seule ligne (rows="1") ; on ne mesure pas, car l'exemple grisé (placeholder) peut passer sur deux lignes.
   */
  function fit(el) {
    if (!el || !el.style) return;
    el.style.height = "auto";
    if (!el.value) return;
    var extra = (el.offsetHeight - el.clientHeight) || 0;
    el.style.height = (el.scrollHeight + extra) + "px";
  }

  function cut(value) {
    var chars = Array.from(value);
    return chars.length > MAX ? chars.slice(0, MAX).join("") : value;
  }

  /**
   * Relie un <textarea> : Entrée n'insère aucun retour à la ligne ; un texte collé est nettoyé par clean() (une ligne, espaces réduits)
   * et coupé à 120 caractères ; tout retour à la ligne arrivé autrement (clavier mobile) est remplacé par une espace ; le compteur
   * (counter, facultatif) et la hauteur sont recalculés à chaque saisie et au chargement.
   */
  function bindField(el, counter) {
    function refresh() { if (counter) counter.textContent = counterText(el.value); fit(el); }
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
    el.addEventListener("beforeinput", function (e) { if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") e.preventDefault(); });
    el.addEventListener("paste", function (e) {
      var data = e.clipboardData && typeof e.clipboardData.getData === "function" ? e.clipboardData.getData("text") : null;
      if (data === null || data === undefined) return;   // sans accès au presse-papiers : le gestionnaire « input » nettoie
      e.preventDefault();
      el.setRangeText(clean(data), el.selectionStart, el.selectionEnd, "end");
      el.value = cut(el.value);
      refresh();
    });
    el.addEventListener("input", function () {
      if (BREAKS.test(el.value)) { BREAKS.lastIndex = 0; el.value = el.value.replace(BREAKS, " "); }
      BREAKS.lastIndex = 0;
      el.value = cut(el.value);
      refresh();
    });
    bound.push(el);
    refresh();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(function () { fit(el); });   // une fois le champ dans la page
    return { refresh: refresh };
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", function () {
      bound = bound.filter(function (el) { return el.isConnected !== false; });
      bound.forEach(fit);
    });
  }

  return { fit: fit, bindField: bindField, MAX: MAX, DEFAULT_TEXT: DEFAULT_TEXT, MSG_LIEN: MSG_LIEN, MSG_LONG: MSG_LONG, clean: clean, length: length, hasLink: hasLink, validate: validate, display: display, counterText: counterText };
});
