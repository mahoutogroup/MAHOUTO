/* =========================================================
   analytics.js — compteur de visites ANONYME (MAHOUTO+ et MAJESTÉ PRESSE)

   Envoie UNE ligne par page vue dans la table Supabase page_views (voir page-views-setup.sql).
   Aucun cookie, aucune donnée personnelle :
   - identifiant visiteur = UUID aléatoire dans localStorage (aucun lien avec un compte) ;
   - jamais l'identité d'un utilisateur connecté, ni IP, ni user-agent (le user-agent sert seulement
     ICI, dans le navigateur, à déduire « mobile / tablette / ordinateur » et à écarter les robots) ;
   - chemin de la page SANS paramètres d'adresse.

   Ce que le script NE fait PAS :
   - rien si « Ne pas me suivre » est activé (navigator.doNotTrack === "1"), si le navigateur est
     automatisé (navigator.webdriver) ou est un robot connu, si localStorage est indisponible,
     ou si le site n'est pas l'un de nos 4 domaines de production (aperçus Vercel, localhost : rien) ;
   - pas de comptage d'un administrateur connecté : si une session existe déjà dans ce navigateur,
     is_admin() est interrogé (résultat gardé 6 h) ; si on ne peut pas le vérifier, la visite n'est
     pas comptée. Un visiteur anonyme (aucune session) ne déclenche AUCUN appel réseau de vérification ;
   - une même page + même article n'est comptée qu'une fois par visiteur toutes les 30 minutes ;
   - jamais de .select() sur l'insertion (la lecture de la table est refusée) : insertion seule,
     erreurs ignorées en silence, envoi après le chargement de la page (temps libre du navigateur).
   ========================================================= */
(function () {
  "use strict";

  var HOSTS = {
    "mahouto.com": "mahouto",
    "www.mahouto.com": "mahouto",
    "majestepresse.com": "majeste",
    "www.majestepresse.com": "majeste"
  };
  var DEDUPE_MS = 30 * 60 * 1000;
  var ADMIN_TTL_MS = 6 * 60 * 60 * 1000;
  var K_VISITOR = "mahouto_vid";
  var K_SEEN = "mahouto_pv_seen";
  var K_ADMIN = "mahouto_pv_admin";
  var K_SOURCE = "mahouto_pv_src";   // sessionStorage : première source de la visite

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ITEM_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var SOURCE_RE = /^[a-z0-9_-]{1,40}$/;
  var BOT_RE = /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|facebookexternalhit|facebot|twitterbot|linkedinbot|telegrambot|applebot|petalbot|semrush|ahrefs|mj12bot|headlesschrome|lighthouse|pagespeed|gtmetrix|prerender|phantomjs|\b(?:bot|crawler|spider)\b|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client/i;

  // ---------- Décisions « ne rien faire » ----------
  function trackingRefused() {
    try {
      if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1") return true;
      if (navigator.webdriver === true) return true;
      if (BOT_RE.test(navigator.userAgent || "")) return true;
    } catch (e) { return true; }
    return false;
  }

  // ---------- Identifiant visiteur ----------
  function randomUuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (e) { /* repli ci-dessous */ }
    var bytes = new Array(16), i;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint8Array(16);
        window.crypto.getRandomValues(a);
        for (i = 0; i < 16; i++) bytes[i] = a[i];
      } else { throw new Error("pas de crypto"); }
    } catch (e) {
      for (i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variante
    var hex = bytes.map(function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  // Renvoie l'identifiant, ou null si localStorage est indisponible (alors on n'enregistre rien).
  function visitorId() {
    try {
      var id = localStorage.getItem(K_VISITOR);
      if (id && UUID_RE.test(id)) return id;
      id = randomUuid();
      localStorage.setItem(K_VISITOR, id);
      return localStorage.getItem(K_VISITOR) === id ? id : null;
    } catch (e) { return null; }
  }

  // ---------- Page, type, article ----------
  function describePage() {
    var path = location.pathname || "/";
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
    var type = "other", item = null, v;

    if (path === "/" || path === "/index.html") type = "home";
    else if (path === "/serigraphie.html") type = "serigraphie_list";
    else if (path === "/serigraphie-produit.html") {
      v = q.get("id");
      if (v && UUID_RE.test(v)) { type = "serigraphie_product"; item = v.toLowerCase(); }
    } else if (path === "/produit-detail.html") {
      v = q.get("id");
      if (v && ITEM_RE.test(v)) { type = "product"; item = v; }
    } else if (path === "/formation-detail.html") {
      v = q.get("course");
      if (v && ITEM_RE.test(v)) { type = "formation"; item = v; }
    }
    return { path: path, type: type, item: item };
  }

  // ---------- Appareil ----------
  function deviceType() {
    var ua = "";
    try { ua = navigator.userAgent || ""; } catch (e) { /* rien */ }
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
    if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return "tablet";          // iPadOS
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
    return "desktop";
  }

  // ---------- Source : ?src=, sinon page de provenance, sinon source de la visite ----------
  function ownHost(host) {
    return host === location.hostname.toLowerCase() || HOSTS[host] ||
           /\.(?:mahouto\.com|majestepresse\.com)$/.test(host);
  }

  function classifyReferrer(host) {
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) return "facebook";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
    if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return "whatsapp";
    if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|qwant\.com|yandex\.[a-z]+)$/.test(host)) return "search";
    return "autre";
  }

  function rememberSource(value) {
    try { sessionStorage.setItem(K_SOURCE, value); } catch (e) { /* sans effet */ }
    return value;
  }

  function resolveSource() {
    var fromParam = null;
    try { fromParam = new URLSearchParams(location.search).get("src"); } catch (e) { /* rien */ }
    if (fromParam) {
      fromParam = String(fromParam).toLowerCase();
      if (SOURCE_RE.test(fromParam)) return rememberSource(fromParam);
    }
    try {
      if (document.referrer) {
        var host = new URL(document.referrer).hostname.toLowerCase();
        if (!ownHost(host)) return rememberSource(classifyReferrer(host));
      }
    } catch (e) { /* rien */ }
    try {
      var stored = sessionStorage.getItem(K_SOURCE);
      if (stored && SOURCE_RE.test(stored)) return stored;
    } catch (e) { /* rien */ }
    return "direct";
  }

  // ---------- Anti-doublon (30 minutes) ----------
  // Renvoie true si la page vient d'être marquée comme vue ; false si elle l'était déjà (ou si le stockage échoue).
  function markSeen(key) {
    try {
      var now = Date.now(), map = {}, raw = localStorage.getItem(K_SEEN);
      if (raw) { try { map = JSON.parse(raw) || {}; } catch (e) { map = {}; } }
      Object.keys(map).forEach(function (k) { if (typeof map[k] !== "number" || now - map[k] > DEDUPE_MS) delete map[k]; });
      if (map[key] && now - map[key] < DEDUPE_MS) return false;
      map[key] = now;
      localStorage.setItem(K_SEEN, JSON.stringify(map));
      return true;
    } catch (e) { return false; }
  }

  // ---------- Administrateur connecté ? (seulement si une session existe déjà) ----------
  // Promesse : "anonymous" (aucune session : aucun appel réseau), "user", "admin" ou "unknown".
  function checkAdmin(cfg) {
    var session = null;
    try {
      var ref = new URL(cfg.SUPABASE_URL).hostname.split(".")[0];
      var raw = localStorage.getItem("sb-" + ref + "-auth-token");
      if (!raw) return Promise.resolve("anonymous");
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.access_token !== "string") return Promise.resolve("unknown");
      session = { token: parsed.access_token, uid: parsed.user && parsed.user.id ? String(parsed.user.id) : "" };
    } catch (e) { return Promise.resolve("unknown"); }

    try {
      var cached = JSON.parse(localStorage.getItem(K_ADMIN) || "null");
      if (cached && cached.uid === session.uid && session.uid && Date.now() - cached.t < ADMIN_TTL_MS) {
        return Promise.resolve(cached.admin ? "admin" : "user");
      }
    } catch (e) { /* pas de cache */ }

    return fetch(cfg.SUPABASE_URL + "/rest/v1/rpc/is_admin", {
      method: "POST",
      headers: { "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + session.token, "Content-Type": "application/json" },
      body: "{}"
    }).then(function (resp) {
      if (!resp.ok) return "unknown";
      return resp.json().then(function (value) {
        var isAdmin = value === true;
        try { localStorage.setItem(K_ADMIN, JSON.stringify({ uid: session.uid, admin: isAdmin, t: Date.now() })); } catch (e) { /* rien */ }
        return isAdmin ? "admin" : "user";
      });
    }).catch(function () { return "unknown"; });
  }

  // ---------- Envoi (insertion seule, silencieuse) ----------
  function send(cfg, row) {
    try {
      fetch(cfg.SUPABASE_URL + "/rest/v1/page_views", {
        method: "POST",
        headers: {
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY,   // clé publique : jamais l'identité de l'utilisateur
          "Content-Type": "application/json",
          "Prefer": "return=minimal"                            // pas de lecture de la ligne créée
        },
        body: JSON.stringify(row),
        keepalive: true
      }).catch(function () { /* silencieux */ });
    } catch (e) { /* silencieux */ }
  }

  function run() {
    if (trackingRefused()) return;
    if (typeof fetch !== "function") return;

    var cfg = window.MAHOUTO_CONFIG;
    if (!cfg || typeof cfg.SUPABASE_URL !== "string" || typeof cfg.SUPABASE_ANON_KEY !== "string") return;

    var brand = HOSTS[String(location.hostname || "").toLowerCase()];   // uniquement nos 4 domaines
    if (!brand) return;
    if (window.MAHOUTO_BRAND && window.MAHOUTO_BRAND.id && window.MAHOUTO_BRAND.id !== brand) return;

    var page = describePage();
    if (page.path.length > 200) return;

    var vid = visitorId();
    if (!vid) return;   // localStorage indisponible : on n'enregistre rien

    checkAdmin(cfg).then(function (who) {
      if (who === "admin" || who === "unknown") return;   // administrateur, ou impossible à vérifier : non compté
      if (!markSeen(page.path + "|" + (page.item || ""))) return;

      send(cfg, {
        brand: brand,
        visitor_id: vid,
        path: page.path,
        page_type: page.type,
        item_id: page.item,
        source: resolveSource(),
        device: deviceType()
      });
    });
  }

  // Après le chargement, quand le navigateur est disponible : jamais de ralentissement de la page.
  function schedule() {
    var go = function () { try { run(); } catch (e) { /* silencieux */ } };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 1500);
  }

  try {
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  } catch (e) { /* silencieux */ }
})();
