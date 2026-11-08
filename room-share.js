/* =========================================================
   room-share.js — partager le lien d'un salon (WhatsApp, statut, copie)
   Utilisé par chat.html (en-tête et écran d'un salon payant) et
   discussions.html (bouton 🔗 de chaque salon).

   - Mobile : feuille de partage native (navigator.share) : WhatsApp,
     statut, Telegram, SMS… Annuler n'affiche aucune erreur.
   - Sinon (ordinateur, navigateur sans partage natif, ou échec) : petite
     fenêtre avec le lien, « Copier le lien » et « WhatsApp ».
   - Le lien partagé est l'adresse du salon : <site>/chat.html?room=<id>.
     Si un lien court avec aperçu existe un jour, seule buildUrl() change.
   - Un identifiant de salon qui n'est pas de la forme [A-Za-z0-9_-]{1,64}
     n'est jamais partagé (même règle que la destination de retour de
     connexion).
   Tout est écrit avec textContent ; aucun innerHTML ; aucun journal console.
   ========================================================= */
(function (root) {
  "use strict";

  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var MAX_NAME = 80;

  function isValidRoomId(id) { return typeof id === "string" && ID_RE.test(id); }

  // Adresse du salon, ou null si l'identifiant n'est pas partageable.
  function buildUrl(origin, roomId) {
    if (!isValidRoomId(roomId)) return null;
    return String(origin || "").replace(/\/+$/, "") + "/chat.html?room=" + encodeURIComponent(roomId);
  }

  function money(xof) { return Number(xof).toLocaleString("fr-FR") + " FCFA"; }

  // Texte d'accompagnement (le lien est transmis à part).
  function buildMessage(room, brandName) {
    var name = String((room && room.name) || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME) || "ce salon";
    var brand = String(brandName || "MAHOUTO+");
    var text = "Rejoins « " + name + " » sur " + brand;
    if (room && room.is_paid && Number(room.price) > 0) text += " (salon payant : " + money(room.price) + ")";
    return text + ".";
  }

  function whatsappUrl(text, url) {
    return "https://wa.me/?text=" + encodeURIComponent(text + "\n" + url);
  }

  function el(doc, tag, props, children) {
    var node = doc.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k === "class") node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function injectStyle(doc) {
    if (doc.getElementById("rs-style")) return;
    var style = doc.createElement("style");
    style.id = "rs-style";
    style.textContent =
      ".rs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:90;display:flex;align-items:flex-end;justify-content:center}" +
      ".rs-sheet{width:100%;max-width:480px;background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:18px 20px max(18px,env(safe-area-inset-bottom))}" +
      ".rs-sheet h3{color:var(--gold);margin:0 0 6px;font-size:18px}" +
      ".rs-text{font-size:13px;color:var(--text-muted);margin:0 0 12px;line-height:1.45;overflow-wrap:anywhere}" +
      ".rs-url{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;font-family:inherit}" +
      ".rs-status{min-height:18px;font-size:13px;color:var(--text-muted);margin:8px 0}" +
      ".rs-actions{display:flex;gap:10px;flex-wrap:wrap}" +
      ".rs-actions button{flex:1;min-height:46px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;cursor:pointer}" +
      ".rs-actions button.rs-primary{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}";
    doc.head.appendChild(style);
  }

  // Fenêtre de repli : lien, copie, WhatsApp.
  function openSheet(doc, win, text, url) {
    injectStyle(doc);
    var input = el(doc, "input", { type: "text", class: "rs-url", "aria-label": "Lien du salon" });
    input.value = url;
    input.readOnly = true;
    var status = el(doc, "p", { class: "rs-status", role: "status", "aria-live": "polite" });
    var copyBtn = el(doc, "button", { type: "button", class: "rs-primary", text: "Copier le lien" });
    var waBtn = el(doc, "button", { type: "button", text: "WhatsApp" });
    var closeBtn = el(doc, "button", { type: "button", text: "Fermer" });
    var sheet = el(doc, "div", { class: "rs-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Partager ce salon" }, [
      el(doc, "h3", { text: "Partager ce salon" }),
      el(doc, "p", { class: "rs-text", text: text }),
      input, status,
      el(doc, "div", { class: "rs-actions" }, [copyBtn, waBtn, closeBtn])
    ]);
    var overlay = el(doc, "div", { class: "rs-overlay" }, [sheet]);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    copyBtn.addEventListener("click", async function () {
      var nav = win.navigator || {};
      try {
        if (!nav.clipboard || !nav.clipboard.writeText) throw new Error("presse-papiers indisponible");
        await nav.clipboard.writeText(url);
        status.textContent = "Lien copié ✅";
      } catch (e) {
        // Dernier recours : sélectionner le lien pour que la personne le copie à la main.
        if (input.select) input.select();
        status.textContent = "Copie automatique impossible : le lien est sélectionné, copie-le à la main.";
      }
    });
    waBtn.addEventListener("click", function () {
      if (win.open) win.open(whatsappUrl(text, url), "_blank", "noopener");
    });
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    doc.body.appendChild(overlay);
    return { overlay: overlay, close: close, elements: { input: input, status: status, copyBtn: copyBtn, waBtn: waBtn, closeBtn: closeBtn } };
  }

  /**
   * options : { room: { id, name, is_paid, price }, brandName, win, doc }
   * Renvoie 'native' (feuille de partage ouverte et validée), 'cancelled' (la personne a annulé),
   * 'sheet' (fenêtre de repli affichée) ou 'invalid' (identifiant de salon non partageable).
   */
  async function share(options) {
    var win = options.win || root;
    var doc = options.doc || win.document;
    var room = options.room || {};
    var url = buildUrl(win.location && win.location.origin, room.id);
    if (!url) return "invalid";
    var text = buildMessage(room, options.brandName);
    var nav = win.navigator || {};

    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: String(room.name || "").slice(0, MAX_NAME) || "Salon", text: text, url: url });
        return "native";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancelled";   // annulé : aucune erreur à afficher
        // autre échec : repli sur la fenêtre
      }
    }
    openSheet(doc, win, text, url);
    return "sheet";
  }

  var api = {
    isValidRoomId: isValidRoomId, buildUrl: buildUrl, buildMessage: buildMessage, whatsappUrl: whatsappUrl,
    share: share, openSheet: openSheet
  };
  root.MahoutoRoomShare = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
