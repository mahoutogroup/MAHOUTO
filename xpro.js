/* =========================================================
   xpro.js — écran de bienvenue « MAHOUTO X-PRO », réservé aux téléphones revendus avec l'application préinstallée.

   - Adresse spéciale /pro (pro.html) ou /?pro=1 : enregistre l'indicateur local mahouto_xpro_pro = "1" puis ouvre l'accueil.
   - L'accueil affiche l'écran UNE SEULE FOIS : seulement si l'indicateur existe, si l'écran n'a pas déjà été vu (mahouto_xpro_vu)
     ET si l'application tourne en mode installé (standalone). Dans un onglet Chrome ordinaire, rien : la visite de /pro n'use donc
     pas l'écran avant l'installation.
   - Sans indicateur : aucun changement, aucun élément ajouté, aucune requête. Tout accès au stockage est protégé par try/catch :
     stockage bloqué = application normale, sans écran.
   - Texte via textContent uniquement, aucune ressource externe, aucune clé existante lue ou modifiée (lecture seule de
     « mahouto-theme » pour choisir le thème clair ou sombre).
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XPro = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var KEY_PRO = "mahouto_xpro_pro";   // « 1 » : téléphone revendu (posé par /pro)
  var KEY_VU = "mahouto_xpro_vu";     // « 1 » : écran déjà vu (posé par « Commencer »)
  var KEY_THEME = "mahouto-theme";    // clé EXISTANTE du thème : lecture seule
  var LOGO = "/assets/logo-mahouto-plus-128.png";   // dérivé léger déjà présent (≈ 21 Ko)
  var TEXTS = { title: "Bienvenue sur MAHOUTO X-PRO", tagline: "Apprendre • Créer • Entreprendre", signature: "Construire l'Afrique numérique de demain.", button: "Commencer" };

  function get(storage, key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } }
  function set(storage, key) { try { if (!storage) return false; storage.setItem(key, "1"); return true; } catch (e) { return false; } }

  /** Enregistre l'indicateur « téléphone revendu » ; false si le stockage est bloqué. */
  function markPro(storage) { return set(storage, KEY_PRO); }
  /** Enregistre que l'écran a été vu. */
  function markSeen(storage) { return set(storage, KEY_VU); }
  /** Afficher l'écran ? indicateur présent, pas déjà vu, application installée. Toute erreur de stockage → non. */
  function shouldShow(storage, standalone) {
    if (standalone !== true) return false;
    return get(storage, KEY_PRO) === "1" && get(storage, KEY_VU) !== "1";
  }
  /** Le paramètre ?pro=1 (repli : pose l'indicateur depuis l'accueil) est-il présent ? */
  function hasProParam(search) { return /(?:^|[?&])pro=1(?:&|$)/.test(String(search || "")); }
  function withoutProParam(search) {
    var q = String(search || "").replace(/^\?/, "").split("&").filter(function (p) { return p && p !== "pro=1"; }).join("&");
    return q ? "?" + q : "";
  }

  var CSS = "#xpro-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;" +
    "background:radial-gradient(120% 90% at 50% 0%,#3a2d0a 0%,#0A0A0A 62%);color:#fff;opacity:1;transition:opacity .2s ease}" +
    "#xpro-overlay.xpro-light{background:radial-gradient(120% 90% at 50% 0%,#F4DC8A 0%,#F7F7F7 62%);color:#111}" +
    "#xpro-overlay.xpro-out{opacity:0}" +
    "#xpro-overlay .xpro-box{width:100%;max-width:420px;margin:auto;text-align:center}" +
    "#xpro-overlay img{width:96px;height:96px;display:block;margin:0 auto 22px}" +
    "#xpro-overlay h2{font-size:clamp(26px,7vw,34px);line-height:1.2;letter-spacing:-.02em;font-weight:800;margin:0 0 14px;overflow-wrap:anywhere}" +
    "#xpro-overlay .xpro-tag{font-size:17px;line-height:1.5;font-weight:600;margin:0 0 10px;color:#FFD700}" +
    "#xpro-overlay.xpro-light .xpro-tag{color:#6B5000}" +
    "#xpro-overlay .xpro-sig{font-size:14px;line-height:1.5;margin:0 0 34px;color:#C9C9C9}" +
    "#xpro-overlay.xpro-light .xpro-sig{color:#555}" +
    "#xpro-overlay button{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:12px 20px;border:0;border-radius:14px;" +
    "background:linear-gradient(135deg,#FFD700,#D4AF37);color:#0A0A0A;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:17px;font-weight:700;cursor:pointer;" +
    "box-shadow:0 6px 16px rgba(212,175,55,.28);transition:transform .16s ease}" +
    "#xpro-overlay button:active{transform:scale(.98)}" +
    "#xpro-overlay button:focus-visible{outline:3px solid #fff;outline-offset:3px}" +
    "#xpro-overlay.xpro-light button:focus-visible{outline-color:#111}" +
    "@media (prefers-reduced-motion:reduce){#xpro-overlay,#xpro-overlay button{transition:none}}";

  /**
   * Affiche l'écran si nécessaire. env : { win, doc, storage }. Renvoie l'élément ajouté ou null.
   * Se superpose à l'accueil (position fixe) : aucune requête réseau, aucun décalage de mise en page.
   */
  function show(env) {
    var win = env.win, doc = env.doc, storage = env.storage;
    var standalone = false;
    try { standalone = !!(win.matchMedia && win.matchMedia("(display-mode: standalone)").matches) || win.navigator.standalone === true; } catch (e) { standalone = false; }
    if (!shouldShow(storage, standalone)) return null;
    if (!doc.body || doc.getElementById("xpro-overlay")) return null;

    var light = get(storage, KEY_THEME) === "light";
    var style = doc.createElement("style"); style.setAttribute("id", "xpro-style"); style.textContent = CSS;
    var overlay = doc.createElement("div"); overlay.setAttribute("id", "xpro-overlay"); if (light) overlay.setAttribute("class", "xpro-light");
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-labelledby", "xpro-titre");
    var box = doc.createElement("div"); box.setAttribute("class", "xpro-box");
    var img = doc.createElement("img"); img.setAttribute("src", LOGO); img.setAttribute("alt", ""); img.setAttribute("width", "96"); img.setAttribute("height", "96"); img.setAttribute("decoding", "async");
    var h = doc.createElement("h2"); h.setAttribute("id", "xpro-titre");
    // « MAHOUTO X-PRO » reste sur une seule ligne (jamais coupé au milieu du nom) ; le texte lu reste « Bienvenue sur MAHOUTO X-PRO »
    var cut = TEXTS.title.indexOf("MAHOUTO"), nom = doc.createElement("span");
    h.textContent = TEXTS.title.slice(0, cut); nom.setAttribute("style", "white-space:nowrap"); nom.textContent = TEXTS.title.slice(cut); h.appendChild(nom);
    var tag = doc.createElement("p"); tag.setAttribute("class", "xpro-tag"); tag.textContent = TEXTS.tagline;
    var sig = doc.createElement("p"); sig.setAttribute("class", "xpro-sig"); sig.textContent = TEXTS.signature;
    var btn = doc.createElement("button"); btn.setAttribute("type", "button"); btn.setAttribute("id", "xpro-commencer"); btn.textContent = TEXTS.button;
    [img, h, tag, sig, btn].forEach(function (n) { box.appendChild(n); });
    overlay.appendChild(box);
    doc.body.appendChild(style); doc.body.appendChild(overlay);

    var prevOverflow = null;
    try { prevOverflow = doc.documentElement.style.overflow; doc.documentElement.style.overflow = "hidden"; } catch (e) { /* sans effet */ }
    function finish() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (style.parentNode) style.parentNode.removeChild(style);
      try { doc.documentElement.style.overflow = prevOverflow || ""; } catch (e) { /* sans effet */ }
    }
    btn.addEventListener("click", function () {
      markSeen(storage);
      var reduce = false;
      try { reduce = !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { reduce = false; }
      if (reduce) { finish(); return; }
      overlay.setAttribute("class", (light ? "xpro-light " : "") + "xpro-out");
      win.setTimeout(finish, 220);
    });
    // Un seul élément interactif : Tab reste sur « Commencer » (le fond de l'accueil n'est pas atteignable au clavier)
    overlay.addEventListener("keydown", function (e) { if (e.key === "Tab") { e.preventDefault(); btn.focus(); } });
    btn.focus();
    return overlay;
  }

  /** Point d'entrée de l'accueil : repli ?pro=1, puis écran de bienvenue si les conditions sont réunies. */
  function init(win, doc) {
    var storage = null;
    try { storage = win.localStorage; } catch (e) { storage = null; }
    try {
      if (hasProParam(win.location.search)) {
        markPro(storage);
        if (win.history && win.history.replaceState) win.history.replaceState(null, "", win.location.pathname + withoutProParam(win.location.search) + (win.location.hash || ""));
      }
    } catch (e) { /* l'accueil s'ouvre normalement */ }
    try { return show({ win: win, doc: doc, storage: storage }); } catch (e) { return null; }
  }

  return { KEY_PRO: KEY_PRO, KEY_VU: KEY_VU, TEXTS: TEXTS, LOGO: LOGO, markPro: markPro, markSeen: markSeen, shouldShow: shouldShow, hasProParam: hasProParam, withoutProParam: withoutProParam, show: show, init: init };
});
