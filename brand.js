/* =========================================================
   brand.js — marque choisie par le NOM D'HÔTE

   Une seule base de code, deux sites :
     mahouto.com, www.mahouto.com, localhost et tout hôte inconnu -> « mahouto » (défaut)
     majestepresse.com, www.majestepresse.com                     -> « majeste »

   À charger AVANT tous les autres scripts (juste après <link rel="manifest">).
   Fonctionne aussi dans le service worker (importScripts) : aucun accès à
   `document` hors de la section « DOM » ci-dessous.

   Aperçus (localhost et *.vercel.app uniquement) : ?brand=majeste / ?brand=mahouto force la
   marque pour tester avant de brancher le vrai domaine (voir « MODE DE TEST » plus bas).

   Pour la marque « mahouto » (défaut), ce fichier n'a AUCUN effet sur la page :
   il expose seulement window.MAHOUTO_BRAND. Rien n'est réécrit, rien n'est masqué.

   ⚠️ Valeurs de repli à confirmer pour « majeste » (voir DEPLOIEMENT.md) :
   themeColor (même valeur que « mahouto »), tagline / subtitle (propositions),
   logo (assets/logo-majeste-presse.png, déjà présent dans le dépôt).
   ========================================================= */
(function () {
  "use strict";

  var root = typeof globalThis !== "undefined" ? globalThis : self;

  var DEFAULT_BRAND = "mahouto";

  var BRANDS = {
    mahouto: {
      name: "MAHOUTO+",
      shortName: "MAHOUTO+",
      tagline: "Apprendre • Créer • Entreprendre",
      subtitle: "Construire l'Afrique numérique de demain.",
      schoolName: "MAHOUTO School",        // nom affiché du produit formation
      schoolNavLabel: "School",            // libellé court (barre de navigation du bas)
      domain: "mahouto.com",
      logo: "assets/logo-mahouto-plus.png",
      themeColor: "#FFC107",
      aiOrigin: "https://ai.majestepresse.com",
      manifest: null                       // manifest.json inchangé
    },
    majeste: {
      name: "MAJESTÉ PRESSE",
      shortName: "MAJESTÉ",
      tagline: "Informer • Former • Inspirer",                       // PROPOSITION à valider
      subtitle: "La presse qui éclaire, le savoir qui élève.",       // PROPOSITION à valider
      schoolName: "Académie MAJESTÉ",
      schoolNavLabel: "Académie",
      domain: "majestepresse.com",
      logo: "assets/logo-majeste-presse.png",                        // fichier existant, à confirmer comme logo officiel
      themeColor: "#FFC107",                                         // REPLI = valeur de « mahouto » (couleur à fournir)
      aiOrigin: "https://ai.majestepresse.com",
      manifest: "manifest-majeste.json"
    }
  };

  var HOSTS = {
    "mahouto.com": "mahouto",
    "www.mahouto.com": "mahouto",
    "majestepresse.com": "majeste",
    "www.majestepresse.com": "majeste"
  };

  // Hôte -> identifiant de marque. Tout hôte inconnu (localhost, aperçus Vercel...) -> défaut.
  function brandIdFor(hostname) {
    var h = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return Object.prototype.hasOwnProperty.call(HOSTS, h) ? HOSTS[h] : DEFAULT_BRAND;
  }

  // Configuration complète (copie) pour un identifiant de marque.
  function buildBrand(id) {
    var b = {};
    Object.keys(BRANDS[id]).forEach(function (k) { b[k] = BRANDS[id][k]; });
    b.id = id;
    b.isDefault = id === DEFAULT_BRAND;
    return b;
  }

  // Configuration complète (copie) pour un nom d'hôte donné. Le serveur (api/_brand.js)
  // n'utilise QUE ceci : le mode de test ci-dessous n'a aucun effet côté serveur.
  function brandForHost(hostname) {
    return buildBrand(brandIdFor(hostname));
  }

  /* ---------------------------------------------------------
     MODE DE TEST (aperçus uniquement) : ?brand=majeste / ?brand=mahouto

     Actif UNIQUEMENT sur « localhost » et sur les hôtes qui se terminent exactement par
     « .vercel.app » (aperçus Vercel). Jamais sur mahouto.com, majestepresse.com ni aucun
     autre hôte. Le paramètre n'est comparé qu'à deux valeurs fixes (rien n'est injecté
     dans la page) ; toute autre valeur est ignorée. Le choix est mémorisé dans
     sessionStorage (onglet courant) pour survivre aux changements de page ; sans stockage,
     il n'est simplement pas mémorisé.
     --------------------------------------------------------- */
  var PREVIEW_PARAM = "brand";
  var PREVIEW_KEY = "mahouto_brand_preview";
  var PREVIEW_SUFFIX = ".vercel.app";

  function isPreviewHost(hostname) {
    var h = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (h === "localhost") return true;
    if (h.length <= PREVIEW_SUFFIX.length || h.slice(-PREVIEW_SUFFIX.length) !== PREVIEW_SUFFIX) return false;
    // partie avant « .vercel.app » : étiquettes DNS valides, sans point en tête ni en queue
    return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h.slice(0, -PREVIEW_SUFFIX.length));
  }

  // Valeur du paramètre ?brand= : « majeste », « mahouto » ou null (valeur inconnue, absente, illisible).
  function previewParam(search) {
    var m = /(?:^|[?&])brand=([^&#]*)/.exec(String(search || ""));
    if (!m) return null;
    var v;
    try { v = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { return null; }
    return v === "majeste" || v === "mahouto" ? v : null;
  }

  // Identifiant imposé par le mode de test, ou null (aucun effet).
  function previewBrandId(loc) {
    if (!loc || !isPreviewHost(loc.hostname)) return null;

    var fromUrl = previewParam(loc.search);
    if (fromUrl) {
      try {
        if (fromUrl === DEFAULT_BRAND) root.sessionStorage.removeItem(PREVIEW_KEY); // remise à zéro
        else root.sessionStorage.setItem(PREVIEW_KEY, fromUrl);
      } catch (e) { /* pas de stockage : le choix n'est pas mémorisé */ }
      return fromUrl;
    }

    try {
      var saved = root.sessionStorage.getItem(PREVIEW_KEY);
      if (saved === "majeste") return saved;   // seule une valeur connue est relue
    } catch (e) { /* pas de stockage */ }
    return null;
  }

  var pageHost = root.location && root.location.hostname;
  var override = previewBrandId(root.location);
  var brand = override ? buildBrand(override) : brandForHost(pageHost);
  var id = brand.id;

  root.MAHOUTO_BRAND = brand;
  root.MAHOUTO_BRAND_FOR = brandIdFor;       // hôte -> identifiant (tests)
  root.MAHOUTO_BRAND_BY_HOST = brandForHost; // hôte -> configuration (api/_brand.js)

  /* ---------------------------------------------------------
     DOM (pages uniquement, jamais dans le service worker)
     --------------------------------------------------------- */
  if (typeof document === "undefined" || !document.documentElement) return;

  // 1) Manifest : pointe <link rel="manifest"> vers le bon fichier (marque non par défaut).
  if (brand.manifest) {
    var link = document.querySelector('link[rel="manifest"]');
    if (link) {
      link.setAttribute("href", (link.getAttribute("href") || "manifest.json").replace(/manifest\.json(\?.*)?$/, brand.manifest));
    }
  }

  // Marque par défaut : on s'arrête ici, la page reste strictement identique.
  if (brand.isDefault) return;

  // 2) Marque secondaire : remplace le texte de marque du HTML STATIQUE (une seule passe).
  //    Le HTML garde la marque par défaut comme texte source ; la page est masquée
  //    jusqu'à la fin de la passe pour éviter tout clignotement.
  var TOKEN = /MAHOUTO\+/g;
  var SCHOOL_TOKEN = /MAHOUTO School/g;     // texte source du produit formation
  var LOGO_FILE = "assets/logo-mahouto-plus.png";
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

  document.documentElement.style.visibility = "hidden";

  function swap(value) {
    return String(value).replace(TOKEN, brand.name).replace(SCHOOL_TOKEN, brand.schoolName);
  }
  function hasToken(value) { return value.indexOf("MAHOUTO+") !== -1 || value.indexOf("MAHOUTO School") !== -1; }

  function applyBrand() {
    try {
      if (document.title) document.title = swap(document.title);

      var metas = document.querySelectorAll('meta[name="description"], meta[name="apple-mobile-web-app-title"]');
      for (var i = 0; i < metas.length; i++) metas[i].content = swap(metas[i].content);

      var ATTRS = ["alt", "title", "placeholder", "aria-label"];
      var attrNodes = document.querySelectorAll("[alt], [title], [placeholder], [aria-label]");
      for (var a = 0; a < attrNodes.length; a++) {
        for (var k = 0; k < ATTRS.length; k++) {
          var v = attrNodes[a].getAttribute(ATTRS[k]);
          if (v && hasToken(v)) attrNodes[a].setAttribute(ATTRS[k], swap(v));
        }
      }

      // Logo (le chemin peut être préfixé : « ../assets/... » dans admin/)
      var logos = document.querySelectorAll('img[src*="logo-mahouto-plus.png"], link[href*="logo-mahouto-plus.png"]');
      for (var l = 0; l < logos.length; l++) {
        var attr = logos[l].tagName === "LINK" ? "href" : "src";
        logos[l].setAttribute(attr, logos[l].getAttribute(attr).replace(LOGO_FILE, brand.logo));
      }

      // Titres « MAHOUTO<span>+</span> » : le « + » est dans un <span>, donc invisible pour la passe texte.
      // On repère le nœud texte « MAHOUTO » suivi d'un élément dont le texte est « + ».
      var split = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      var splitNodes = [];
      while (split.nextNode()) {
        var sn = split.currentNode;
        var nx = sn.nextSibling;
        if (sn.nodeValue.trim() === "MAHOUTO" && nx && nx.nodeType === 1 && nx.textContent === "+") splitNodes.push(sn);
      }
      for (var sp = 0; sp < splitNodes.length; sp++) {
        splitNodes[sp].nextSibling.remove();
        splitNodes[sp].nodeValue = splitNodes[sp].nodeValue.replace("MAHOUTO", brand.name);
      }

      // « MAHOUTO School » coupé en deux nœuds : « MAHOUTO » + <balise>School</balise>,
      // <balise>MAHOUTO</balise> + « School », ou deux nœuds texte voisins.
      var sw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      var schoolSplits = [];
      while (sw.nextNode()) {
        var cn = sw.currentNode, cp = cn.parentNode, cnx = cn.nextSibling;
        if (!cnx || (cp && SKIP_TAGS[cp.nodeName])) continue;
        if (/MAHOUTO\s*$/.test(cn.nodeValue) &&
            ((cnx.nodeType === 1 && cnx.textContent.trim() === "School") ||
             (cnx.nodeType === 3 && /^\s*School\b/.test(cnx.nodeValue)))) schoolSplits.push({ a: cn, b: cnx, kind: "left" });
        else if (cn.nodeValue.trim() === "MAHOUTO" && cnx.nodeType === 3 && /^\s*School\b/.test(cnx.nodeValue)) schoolSplits.push({ a: cn, b: cnx, kind: "right" });
      }
      for (var ss = 0; ss < schoolSplits.length; ss++) {
        var sp2 = schoolSplits[ss];
        sp2.a.nodeValue = sp2.a.nodeValue.replace(/MAHOUTO\s*$/, brand.schoolName);
        if (sp2.b.nodeType === 1) sp2.b.remove();
        else sp2.b.nodeValue = sp2.b.nodeValue.replace(/^\s*School\b/, "");
      }
      var elSplit = document.querySelectorAll("body *");
      for (var es = 0; es < elSplit.length; es++) {
        var el = elSplit[es], en = el.nextSibling;
        if (!el.parentNode || SKIP_TAGS[el.nodeName] || el.children.length || el.textContent.trim() !== "MAHOUTO") continue;
        if (en && en.nodeType === 3 && /^\s*School\b/.test(en.nodeValue)) {
          el.textContent = brand.schoolName;
          en.nodeValue = en.nodeValue.replace(/^\s*School\b/, "");
          continue;
        }
        while (en && en.nodeType === 3 && !en.nodeValue.trim()) en = en.nextSibling;   // espaces entre deux balises
        if (en && en.nodeType === 1 && !en.children.length && en.textContent.trim() === "School") {
          el.textContent = brand.schoolName;
          en.remove();
        }
      }

      // Libellé court de l'onglet formation (barre du bas) : « School » -> « Académie »
      var schoolNav = document.querySelectorAll('.nav-item[href="school.html"]');
      for (var sn2 = 0; sn2 < schoolNav.length; sn2++) {
        for (var c = schoolNav[sn2].firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3 && c.nodeValue.trim() === "School") c.nodeValue = c.nodeValue.replace("School", brand.schoolNavLabel);
        }
      }
      var tag = document.querySelector(".hero .tagline");
      if (tag && brand.tagline) tag.textContent = brand.tagline;
      var sub = document.querySelector(".hero .subtagline");
      if (sub && brand.subtitle) sub.textContent = brand.subtitle;

      // Textes visibles
      var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          if (p && SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
          return hasToken(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (var t = 0; t < nodes.length; t++) nodes[t].nodeValue = swap(nodes[t].nodeValue);
    } catch (err) {
      if (root.console) root.console.error("brand.js :", err);
    } finally {
      document.documentElement.style.visibility = "";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBrand);
    setTimeout(function () { document.documentElement.style.visibility = ""; }, 3000); // filet de sécurité
  } else {
    applyBrand();
  }
})();
