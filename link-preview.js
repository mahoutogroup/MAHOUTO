/* =========================================================
   link-preview.js — carte d'aperçu sous un message contenant un lien vers NOTRE site

   Sont aperçus : https://(www.)mahouto.com ou https://(www.)majestepresse.com, routes
   /p/<id> (produit numérique) et /s/<id> (produit de sérigraphie) UNIQUEMENT.
   Toute autre adresse est ignorée : aucun aperçu, aucune requête.

   - La page appelle l'API de SON PROPRE domaine (/api/produit-og?...&format=json) : même
     code et même base sur les deux domaines, donc aucune requête entre domaines. Le serveur
     ne reçoit qu'un type et un identifiant (jamais une adresse à télécharger).
   - Chargement à l'affichage (pas à l'envoi), seulement quand le message devient visible
     (IntersectionObserver), avec cache localStorage de 24 h (clé = adresse du lien).
   - Échec ou hors ligne : on ne fait rien, le texte et le lien cliquable restent seuls.
   - Toutes les valeurs affichées passent par textContent ; l'image doit venir de Cloudinary.

   Utilisation (dans renderMessage) : MahoutoLinkPreview.attach(bubble, msg.content, messagesEl);
   ========================================================= */
window.MahoutoLinkPreview = (function () {
  "use strict";

  var TTL_MS = 24 * 60 * 60 * 1000;
  var CACHE_PREFIX = "mahouto_lp:";
  var MAX_CARDS = 2;

  var SITES = {
    "mahouto.com": "MAHOUTO+",
    "www.mahouto.com": "MAHOUTO+",
    "majestepresse.com": "MAJESTÉ PRESSE",
    "www.majestepresse.com": "MAJESTÉ PRESSE"
  };
  var PRODUCT_RE = /^\/p\/([A-Za-z0-9_-]{1,100})\/?$/;
  var SERIGRAPHIE_RE = /^\/s\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/?$/;

  var styleAdded = false;
  var inflight = {};     // adresse -> promesse (une seule requête par adresse)
  var failed = {};       // adresse -> true (pas de nouvelle tentative pendant la session)
  var observer = null;
  var slots = new WeakMap();

  function addStyle() {
    if (styleAdded) return;
    styleAdded = true;
    var css =
      ".mlp-slot{white-space:normal}" +
      ".mlp-card{display:block;box-sizing:border-box;width:260px;max-width:100%;margin-top:8px;overflow:hidden;border-radius:12px;" +
        "border:1px solid var(--border);background:var(--bg-card);color:var(--white);text-decoration:none;white-space:normal;text-align:left;cursor:pointer}" +
      ".mlp-card:active{opacity:.85}" +
      ".mlp-img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;object-position:center;background:var(--bg-elevated)}" +
      ".mlp-body{padding:8px 10px 10px}" +
      ".mlp-site{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted);margin-bottom:3px}" +
      ".mlp-title{font-size:14px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}" +
      ".mlp-desc{margin-top:3px;font-size:12px;line-height:1.4;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Liens du texte (même détection que linkify) -> liens de NOTRE site seulement, sans doublon.
  function findLinks(text) {
    var found = [];
    var seen = {};
    var matches = String(text || "").match(/\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+/gi) || [];
    for (var i = 0; i < matches.length && found.length < MAX_CARDS; i++) {
      var raw = matches[i].replace(/[.,;:!?)\]»”"'>]+$/, "");
      var url;
      try { url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch (e) { continue; }
      if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
      var host = url.hostname.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(SITES, host)) continue;

      var type = null, id = null, m;
      if ((m = PRODUCT_RE.exec(url.pathname))) { type = "produit"; id = m[1]; }
      else if ((m = SERIGRAPHIE_RE.exec(url.pathname))) { type = "serigraphie"; id = m[1]; }
      if (!type) continue;

      var href = "https://" + host + url.pathname.replace(/\/$/, "");   // adresse reconstruite, sans paramètres
      if (seen[href]) continue;
      seen[href] = true;
      found.push({ href: href, type: type, id: id, siteName: SITES[host] });
    }
    return found;
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.t !== "number" || Date.now() - entry.t > TTL_MS || !entry.d) return null;
      return entry.d;
    } catch (e) { return null; }
  }

  function writeCache(key, data) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* stockage plein ou indisponible */ }
  }

  function load(link) {
    var cached = readCache(link.href);
    if (cached) return Promise.resolve(cached);
    if (failed[link.href]) return Promise.reject(new Error("indisponible"));
    if (inflight[link.href]) return inflight[link.href];

    var api = "/api/produit-og?type=" + encodeURIComponent(link.type) + "&id=" + encodeURIComponent(link.id) + "&format=json";
    inflight[link.href] = fetch(api, { headers: { "Accept": "application/json" } })
      .then(function (resp) {
        if (!resp.ok) throw new Error("http " + resp.status);
        return resp.json();
      })
      .then(function (json) {
        if (!json || typeof json.title !== "string" || !json.title) throw new Error("réponse invalide");
        var data = {
          title: json.title.slice(0, 160),
          description: typeof json.description === "string" ? json.description.slice(0, 240) : "",
          image: typeof json.image === "string" && /^https:\/\/res\.cloudinary\.com\//.test(json.image) && json.image.length < 600 ? json.image : "",
          siteName: link.siteName
        };
        writeCache(link.href, data);
        delete inflight[link.href];
        return data;
      })
      .catch(function (err) {
        failed[link.href] = true;
        delete inflight[link.href];
        throw err;
      });
    return inflight[link.href];
  }

  function buildCard(link, data) {
    var a = document.createElement("a");
    a.className = "mlp-card";
    a.href = link.href;                       // adresse validée, jamais celle de la réponse
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", function (ev) { ev.stopPropagation(); });   // n'ouvre pas le menu du message

    if (data.image) {
      var img = document.createElement("img");
      img.className = "mlp-img";
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { img.remove(); });
      img.src = data.image;
      a.appendChild(img);
    }

    var body = document.createElement("div");
    body.className = "mlp-body";
    var site = document.createElement("div");
    site.className = "mlp-site";
    site.textContent = data.siteName;
    var title = document.createElement("div");
    title.className = "mlp-title";
    title.textContent = data.title;
    body.append(site, title);
    if (data.description) {
      var desc = document.createElement("div");
      desc.className = "mlp-desc";
      desc.textContent = data.description;
      body.appendChild(desc);
    }
    a.appendChild(body);
    return a;
  }

  function fill(entry) {
    load(entry.link).then(function (data) {
      var slot = entry.slot;
      if (!slot.isConnected) return;
      var scroller = entry.scroller;
      var nearBottom = scroller && (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140);
      slot.appendChild(buildCard(entry.link, data));
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;   // le chat reste en bas
    }).catch(function () {
      if (entry.slot.parentNode) entry.slot.remove();               // échec : le lien reste en texte, sans erreur visible
    });
  }

  function getObserver() {
    if (observer || !("IntersectionObserver" in window)) return observer;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        observer.unobserve(e.target);
        var entry = slots.get(e.target);
        if (entry) fill(entry);
      });
    }, { rootMargin: "200px" });
    return observer;
  }

  // container : la bulle du message ; text : contenu brut du message ; scroller : la liste des messages.
  function attach(container, text, scroller) {
    try {
      if (!container) return;
      var links = findLinks(text);
      if (!links.length) return;
      addStyle();
      var obs = getObserver();
      links.forEach(function (link) {
        var slot = document.createElement("div");
        slot.className = "mlp-slot";
        container.appendChild(slot);
        var entry = { link: link, slot: slot, scroller: scroller };
        if (obs) { slots.set(slot, entry); obs.observe(slot); }
        else fill(entry);
      });
    } catch (e) { /* jamais d'erreur visible */ }
  }

  return { attach: attach, findLinks: findLinks };
})();
