/* =========================================================
   serigraphie-share.js — bouton « Partager » des produits du Sérigraphe

   Actif UNIQUEMENT pour la marque MAJESTÉ PRESSE (brand.js : MAHOUTO_BRAND.id === "majeste").
   Pour toute autre marque (mahouto.com), ce fichier n'ajoute rien à la page :
   createButton() / wrapCard() renvoient null / la carte telle quelle.

   Le lien partagé est le lien court /s/<id> (réécrit vers /api/produit-og?type=serigraphie,
   qui sert l'aperçu riche WhatsApp / Facebook puis redirige vers serigraphie-produit.html).
   Aucun numéro de téléphone n'est partagé : seulement nom, prix, atelier et lien.
   ========================================================= */
(function () {
  "use strict";

  var brand = window.MAHOUTO_BRAND;
  var enabled = !!(brand && brand.id === "majeste");

  var styleAdded = false;
  var toastEl = null;
  var toastTimer = null;

  function addStyle() {
    if (styleAdded) return;
    styleAdded = true;
    var css =
      ".sg-share-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;min-height:44px;padding:0 14px;" +
        "border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-muted);font-size:13px;font-weight:700;" +
        "font-family:inherit;cursor:pointer}" +
      ".sg-share-btn:active{transform:scale(.96)}" +
      ".sg-share-btn.on-card{position:absolute;top:8px;left:8px;z-index:2;background:rgba(10,10,10,.72);color:#fff;border-color:rgba(255,255,255,.28)}" +
      ".sg-share-wrap{position:relative;display:flex}" +
      ".sg-share-wrap>.product-card{flex:1;min-width:0}" +
      ".sg-share-row{margin:10px 0 0}" +
      ".sg-toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:60;max-width:calc(100vw - 32px);padding:11px 18px;" +
        "border-radius:12px;background:#111;color:#fff;border:1px solid var(--gold,#D4AF37);font-size:13.5px;font-weight:600;text-align:center}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  function toast(message) {
    addStyle();
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "sg-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = "none"; }, 2500);
  }

  // Copie dans le presse-papiers ; repli « execCommand » si l'API moderne est indisponible (HTTP, vieux navigateurs).
  function copyLink(url) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      if (ok) toast("Lien copié");
      else window.prompt("Copiez ce lien :", url);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(function () { toast("Lien copié"); }, legacy);
    } else {
      legacy();
    }
  }

  function shareUrl(product) {
    return window.location.origin + "/s/" + encodeURIComponent(product.id);
  }

  // « <nom> – <prix> FCFA · <atelier> sur MAJESTÉ PRESSE » (sans numéro de téléphone).
  function shareText(product, shopName) {
    var price = Number(product.price);
    var text = product.name;
    if (isFinite(price)) text += " – " + price.toLocaleString("fr-FR") + " FCFA";
    if (shopName) text += " · " + shopName;
    return text + " sur MAJESTÉ PRESSE";
  }

  function share(product, shopName) {
    var url = shareUrl(product);
    var data = { title: product.name, text: shareText(product, shopName), url: url };
    if (navigator.share) {
      navigator.share(data).catch(function (err) {
        if (err && err.name === "AbortError") return;   // l'utilisateur a fermé la feuille de partage
        copyLink(url);
      });
    } else {
      copyLink(url);
    }
  }

  // product : { id, name, price } ; shopName : nom de l'atelier (peut être vide).
  // opts.onCard : bouton posé en haut à droite d'une carte ; opts.row : bouton dans sa propre ligne.
  function createButton(product, shopName, opts) {
    if (!enabled || !product || !product.id) return null;
    opts = opts || {};
    addStyle();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sg-share-btn" + (opts.onCard ? " on-card" : "");
    btn.setAttribute("aria-label", "Partager « " + (product.name || "ce produit") + " »");
    btn.textContent = "↗ Partager";
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      share(product, shopName);
    });
    if (opts.row) {
      var row = document.createElement("div");
      row.className = "sg-share-row";
      row.appendChild(btn);
      return row;
    }
    return btn;
  }

  // Carte du catalogue (un lien <a>) : enveloppée avec le bouton à côté du lien (pas dedans, HTML valide).
  // Hors marque MAJESTÉ : la carte est renvoyée telle quelle.
  function wrapCard(card, product, shopName) {
    var btn = createButton(product, shopName, { onCard: true });
    if (!btn) return card;
    var wrap = document.createElement("div");
    wrap.className = "sg-share-wrap";
    wrap.appendChild(card);
    wrap.appendChild(btn);
    return wrap;
  }

  window.MahoutoSerigraphieShare = { enabled: enabled, createButton: createButton, wrapCard: wrapCard };
})();
