/* =========================================================
   serigraphie-share.js — bouton « Partager » des produits du Sérigraphe

   Actif sur les deux marques (mahouto.com et majestepresse.com, avec ou sans « www ») : la
   sérigraphie est une prestation de MAJESTÉ PRESSE proposée sur les deux domaines. Le lien
   partagé utilise l'adresse du site où l'on se trouve (window.location.origin).

   Le lien partagé est le lien court /s/<id> (réécrit vers /api/produit-og?type=serigraphie,
   qui sert l'aperçu riche WhatsApp / Facebook puis redirige vers serigraphie-produit.html).
   Aucun numéro de téléphone n'est partagé : seulement nom, prix, atelier et lien.
   ========================================================= */
(function () {
  "use strict";

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
      ".sg-share-btn{flex:none}" +
      ".sg-cover-link{display:block}" +
      ".sg-badge-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}" +
      ".sg-badge-link{flex:1;min-width:0;display:flex;align-items:center;align-self:stretch}" +
      ".sg-badge-link .product-badge{align-self:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".sg-body-link{display:flex;flex-direction:column;gap:6px;color:inherit;text-decoration:none}" +
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
  // opts.row : bouton dans sa propre ligne (fiche produit).
  function createButton(product, shopName, opts) {
    if (!product || !product.id) return null;
    opts = opts || {};
    addStyle();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sg-share-btn";
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

  // Carte du catalogue : le bouton est HORS de l'image, sur la ligne de la pastille de catégorie
  // (pastille à gauche, bouton à droite). Comme un bouton ne peut pas se trouver dans un lien <a>,
  // la carte (un <a>) est reconstruite en <div> avec trois liens : image, pastille, texte.
  // Si la structure de la carte est inattendue : carte renvoyée telle quelle.
  function wrapCard(card, product, shopName) {
    var cover = card.firstElementChild;
    var body = card.querySelector(".product-body");
    if (!cover || !body || cover === body) return card;
    var btn = createButton(product, shopName);
    if (!btn) return card;

    var href = card.getAttribute("href") || "#";
    function link(cls, hidden) {
      var a = document.createElement("a");
      a.className = cls;
      a.href = href;
      if (hidden) { a.setAttribute("tabindex", "-1"); a.setAttribute("aria-hidden", "true"); }  // un seul lien annoncé par carte : le texte
      return a;
    }

    var box = document.createElement("div");
    box.className = card.className + " sg-share-card";

    var coverLink = link("sg-cover-link", true);
    coverLink.appendChild(cover);
    box.appendChild(coverLink);

    var badge = body.querySelector(".product-badge");
    var badgeLink = link("sg-badge-link", true);
    if (badge) badgeLink.appendChild(badge);
    var row = document.createElement("div");
    row.className = "sg-badge-row";
    row.appendChild(badgeLink);
    row.appendChild(btn);

    var textLink = link("sg-body-link", false);
    while (body.firstChild) textLink.appendChild(body.firstChild);
    body.appendChild(row);
    body.appendChild(textLink);

    box.appendChild(body);
    return box;
  }

  window.MahoutoSerigraphieShare = { enabled: true, createButton: createButton, wrapCard: wrapCard };
})();
