/* =========================================================
   brand.js — marque choisie par le NOM D'HÔTE

   Une seule base de code, deux sites :
     mahouto.com, www.mahouto.com, localhost et tout hôte inconnu -> « mahouto » (défaut)
     majestepresse.com, www.majestepresse.com                     -> « majeste »

   À charger AVANT tous les autres scripts (juste après <link rel="manifest">).
   Fonctionne aussi dans le service worker (importScripts) : aucun accès à
   `document` hors de la section « DOM » ci-dessous.

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

  // Configuration complète (copie) pour un nom d'hôte donné.
  function brandForHost(hostname) {
    var id = brandIdFor(hostname);
    var b = {};
    Object.keys(BRANDS[id]).forEach(function (k) { b[k] = BRANDS[id][k]; });
    b.id = id;
    b.isDefault = id === DEFAULT_BRAND;
    return b;
  }

  var brand = brandForHost(root.location && root.location.hostname);
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
  var LOGO_FILE = "assets/logo-mahouto-plus.png";
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

  document.documentElement.style.visibility = "hidden";

  function swap(value) { return String(value).replace(TOKEN, brand.name); }

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
          if (v && v.indexOf("MAHOUTO+") !== -1) attrNodes[a].setAttribute(ATTRS[k], swap(v));
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
      var tag = document.querySelector(".hero .tagline");
      if (tag && brand.tagline) tag.textContent = brand.tagline;
      var sub = document.querySelector(".hero .subtagline");
      if (sub && brand.subtitle) sub.textContent = brand.subtitle;

      // Textes visibles
      var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          if (p && SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
          return n.nodeValue.indexOf("MAHOUTO+") !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
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
