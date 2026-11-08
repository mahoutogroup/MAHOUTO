/* =========================================================
   certificate-name.js — nom imprimé sur un certificat ou une attestation
   Utilisé par certificates.html.

   Règle : une adresse e-mail ne doit JAMAIS être imprimée sur un document.
   Le nom vient, dans l'ordre :
     1. du nom légal du profil (full_name, renseigné dans « Mon profil »),
     2. d'un pseudo « propre » : ni vide, ni en forme d'adresse e-mail,
        ni le pseudo neutre par défaut (« Membre xxxxxx »),
     3. sinon on DEMANDE le nom à la personne avant de générer le document
        (fenêtre ci-dessous). Ce nom n'est pas enregistré : il sert à ce
        document seulement.
   Tout est écrit avec textContent ; aucun innerHTML.
   ========================================================= */
(function (root) {
  "use strict";

  var MAX_LENGTH = 100;

  function looksLikeEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
  }

  function isNeutral(value) {
    return /^Membre [0-9a-f]{6,8}$/i.test(String(value || "").trim());
  }

  // Un nom imprimable : non vide, sans « @ » (donc jamais une adresse), pas le pseudo neutre.
  function clean(value) {
    var v = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (!v || v.indexOf("@") !== -1 || looksLikeEmail(v) || isNeutral(v)) return null;
    return v;
  }

  // profile = { full_name, username } (ou null). Renvoie un nom imprimable, ou null s'il faut le demander.
  function resolve(profile) {
    if (!profile) return null;
    return clean(profile.full_name) || clean(profile.username);
  }

  // Nom saisi par la personne : { ok: true, name } ou { ok: false, message }.
  function validateTyped(value) {
    var v = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (v.length < 2) return { ok: false, message: "Indique ton nom (2 caractères au moins)." };
    if (v.length > MAX_LENGTH) return { ok: false, message: "Ce nom est trop long (" + MAX_LENGTH + " caractères au plus)." };
    if (v.indexOf("@") !== -1 || looksLikeEmail(v)) return { ok: false, message: "Indique ton nom, pas une adresse e-mail." };
    if (!/[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏͰ-ϿЀ-ӿ]{1}.*[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏͰ-ϿЀ-ӿ]/.test(v)) {
      return { ok: false, message: "Indique ton nom avec des lettres." };
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(v)) return { ok: false, message: "Ce nom contient des caractères non valides." };
    return { ok: true, name: v };
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
    if (doc.getElementById("cn-style")) return;
    var style = doc.createElement("style");
    style.id = "cn-style";
    style.textContent =
      ".cn-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:80;display:flex;align-items:flex-end;justify-content:center}" +
      ".cn-sheet{width:100%;max-width:480px;background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:18px 20px max(18px,env(safe-area-inset-bottom))}" +
      ".cn-sheet h3{color:var(--gold);margin:0 0 6px}" +
      ".cn-help{font-size:13px;color:var(--text-muted);margin:0 0 12px;line-height:1.45}" +
      ".cn-input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:16px;font-family:inherit}" +
      ".cn-error{min-height:18px;font-size:13px;color:#F87171;margin:8px 0}" +
      ".cn-actions{display:flex;gap:10px;justify-content:flex-end}" +
      ".cn-actions button{min-height:44px;padding:10px 18px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;cursor:pointer}" +
      ".cn-actions button.cn-ok{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}";
    doc.head.appendChild(style);
  }

  /**
   * Fenêtre qui demande le nom à imprimer. Renvoie une promesse : le nom validé, ou null si la
   * personne annule. Ne fait rien d'autre : le nom n'est ni enregistré ni envoyé.
   */
  function ask(doc) {
    doc = doc || root.document;
    injectStyle(doc);
    return new Promise(function (resolvePromise) {
      var input = el(doc, "input", { type: "text", class: "cn-input", maxlength: String(MAX_LENGTH), autocomplete: "name", placeholder: "Prénom et nom" });
      var error = el(doc, "p", { class: "cn-error", role: "alert" });
      var cancel = el(doc, "button", { type: "button", text: "Annuler" });
      var ok = el(doc, "button", { type: "button", class: "cn-ok", text: "Générer le document" });
      var sheet = el(doc, "div", { class: "cn-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Nom à imprimer" }, [
        el(doc, "h3", { text: "Nom à imprimer" }),
        el(doc, "p", { class: "cn-help", text: "Ton profil n'a pas de nom complet. Indique le nom qui doit apparaître sur ce document. Il ne sera pas enregistré ; tu peux aussi le renseigner dans « Mon profil »." }),
        input, error,
        el(doc, "div", { class: "cn-actions" }, [cancel, ok])
      ]);
      var overlay = el(doc, "div", { class: "cn-overlay" }, [sheet]);

      function done(value) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolvePromise(value);
      }
      function submit() {
        var res = validateTyped(input.value);
        if (!res.ok) { error.textContent = res.message; return; }
        done(res.name);
      }
      cancel.addEventListener("click", function () { done(null); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) done(null); });
      ok.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

      doc.body.appendChild(overlay);
      if (input.focus) input.focus();
    });
  }

  var api = { clean: clean, resolve: resolve, validateTyped: validateTyped, ask: ask, looksLikeEmail: looksLikeEmail, isNeutral: isNeutral, MAX_LENGTH: MAX_LENGTH };
  root.MahoutoCertificateName = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
