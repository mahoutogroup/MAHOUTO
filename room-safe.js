/* =========================================================
   room-safe.js — affichage SÛR des champs d'un salon (table rooms)

   Pourquoi : la politique « rooms_insert_own » laisse tout compte créer un
   salon avec n'importe quelle valeur dans color, emoji, photo_url. Ces
   champs ne doivent donc JAMAIS être insérés dans du HTML (innerHTML,
   attribut construit par concaténation). Règle de ce fichier :
     - la couleur n'est utilisée que si elle est hexadécimale (#RGB, #RGBA,
       #RRGGBB, #RRGGBBAA : toutes les valeurs que le code produit déjà
       sont de ce format), sinon couleur par défaut ;
     - l'émoji n'est utilisé que s'il est court (16 caractères au plus) et
       sans < > " ' & ni caractère de contrôle, sinon 💬 ;
     - photo_url n'est utilisée que si elle commence par https:// (même règle
       que l'avatar de profil) et ne contient ni espace, ni guillemet, ni
       < > ` \ , sinon pas de photo ;
     - tout est écrit avec les API DOM (textContent, style.x, img.src), jamais
       innerHTML.
   La base impose les mêmes formats (migration 009, contraintes CHECK) : ce
   fichier reste la défense à l'affichage, y compris pour des lignes déjà
   présentes avant la migration.
   ========================================================= */
(function (root) {
  "use strict";

  var DEFAULT_COLOR = "#22C55E";
  var DEFAULT_EMOJI = "💬";
  var MAX_EMOJI_CHARS = 16;
  var MAX_URL_LENGTH = 2048;

  var COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  var EMOJI_FORBIDDEN_RE = /[<>"'&\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
  var URL_RE = /^https:\/\/[^\s"'<>`\\]+$/i;

  function color(value, fallback) {
    var v = typeof value === "string" ? value.trim() : "";
    return COLOR_RE.test(v) ? v : (fallback || DEFAULT_COLOR);
  }

  function emoji(value) {
    var v = typeof value === "string" ? value.trim() : "";
    if (!v || EMOJI_FORBIDDEN_RE.test(v) || Array.from(v).length > MAX_EMOJI_CHARS) return DEFAULT_EMOJI;
    return v;
  }

  // Renvoie l'URL si elle est acceptable, sinon null.
  function photoUrl(value) {
    if (typeof value !== "string") return null;
    var v = value.trim();
    if (!v || v.length > MAX_URL_LENGTH || !URL_RE.test(v)) return null;
    return v;
  }

  /**
   * Pastille d'un salon (photo ou émoji sur fond de couleur), construite avec le DOM seulement.
   * options : { tag: "div" | "span" (défaut "div"), imgStyle: style CSS fixe de la photo (facultatif),
   *             noRoomColor: couleur de repli (facultatif) }
   */
  function buildAvatar(doc, room, options) {
    var opts = options || {};
    var node = doc.createElement(opts.tag || "div");
    node.className = "avatar";
    node.style.background = color(room && room.color, opts.fallbackColor);
    var url = photoUrl(room && room.photo_url);
    if (url) {
      var img = doc.createElement("img");
      img.src = url;
      img.alt = "";
      if (opts.imgStyle) img.style.cssText = opts.imgStyle;
      node.appendChild(img);
    } else {
      node.textContent = emoji(room && room.emoji);
    }
    return node;
  }

  var api = {
    DEFAULT_COLOR: DEFAULT_COLOR, DEFAULT_EMOJI: DEFAULT_EMOJI, MAX_EMOJI_CHARS: MAX_EMOJI_CHARS,
    COLOR_RE: COLOR_RE, EMOJI_FORBIDDEN_RE: EMOJI_FORBIDDEN_RE, URL_RE: URL_RE,
    color: color, emoji: emoji, photoUrl: photoUrl, buildAvatar: buildAvatar
  };
  root.MahoutoRoomSafe = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
