/* =========================================================
   admin-roles.js — bouton « Changer le rôle » (page admin/users.html)

   Rien ici ne protège quoi que ce soit : le founder est vérifié par la
   route serveur (/api/admin/user-action, action « set_role ») puis par la
   base (fonction apply_role_change, migration 008). Ce fichier n'affiche
   que le bouton et la fenêtre de choix.

   Sécurité de l'affichage : pseudos et motifs viennent d'utilisateurs ;
   tout est écrit avec textContent, jamais innerHTML. Aucun journal console.
   ========================================================= */
(function (root) {
  "use strict";

  var PROTECTED = ["founder", "super_admin"];
  var MAX_REASON = 500;

  var OPTIONS = [
    { value: "user", label: "Membre", desc: "Aucun droit de modération ni d'administration." },
    { value: "moderateur", label: "Modérateur", desc: "Lit et traite les signalements de messages de salon. Rien d'autre : ni profils, ni messages privés, ni autres pages d'administration." },
    { value: "admin", label: "Administrateur", desc: "Accès à toute l'administration.", warning: "⚠️ Attention : un administrateur a accès à toute l'administration (utilisateurs, formations, produits, salons, signalements, statistiques)." }
  ];

  var MSG_UNAVAILABLE = "Le changement de rôle n'est pas encore activé (la migration 008 n'a pas été exécutée). Rien n'est cassé : réessaie après son exécution.";

  // Rôle affiché d'un membre : « moderateur » si le drapeau est vrai et que le rôle n'est pas déjà administrateur.
  function displayRole(user) {
    var role = (user && user.role) || "user";
    if (PROTECTED.indexOf(role) !== -1 || role === "admin") return role;
    return user && user.is_moderator ? "moderateur" : role;
  }

  // Bouton visible seulement pour le founder, jamais sur soi-même, jamais sur un founder ou un super_admin.
  function canChangeRole(callerRole, callerId, target) {
    if (callerRole !== "founder" || !target || !target.id) return false;
    if (target.id === callerId) return false;
    return PROTECTED.indexOf(target.role) === -1;
  }

  // Options proposées : toutes sauf celle que le membre a déjà.
  function optionsFor(target) {
    var current = displayRole(target);
    var currentValue = current === "admin" ? "admin" : (current === "moderateur" ? "moderateur" : "user");
    return OPTIONS.filter(function (o) { return o.value !== currentValue; });
  }

  function errorMessage(status, payload) {
    var text = payload && payload.error ? String(payload.error) : "";
    if (status === 503) return MSG_UNAVAILABLE;
    if (status === 401) return "Session expirée : reconnecte-toi.";
    if (status === 403) return text || "Action refusée : réservé au fondateur.";
    if (text && status >= 400 && status < 500) return text;
    return "Impossible de changer le rôle pour le moment.";
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

  /**
   * options : { doc, target: {id, name, role, is_moderator}, send(newRole, reason) → Promise<{ok, message}>,
   *             confirmFn(text) → boolean, onDone(newRole) }
   * Renvoie { overlay, close } ; l'appelant l'ajoute au document.
   */
  function buildDialog(options) {
    var doc = options.doc;
    var target = options.target;
    var confirmFn = options.confirmFn || function () { return true; };
    var chosen = null;
    var busy = false;

    var status = el(doc, "p", { class: "ar-status", role: "status", "aria-live": "polite" });
    var warning = el(doc, "p", { class: "ar-warning" });
    var sendBtn = el(doc, "button", { type: "button", class: "ar-send", text: "Confirmer", disabled: "disabled" });
    var cancelBtn = el(doc, "button", { type: "button", class: "ar-cancel", text: "Annuler" });
    var reason = el(doc, "textarea", { class: "ar-reason", maxlength: String(MAX_REASON), rows: "2", placeholder: "Motif (facultatif)" });

    var sheet = el(doc, "div", { class: "ar-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Changer le rôle" });
    sheet.appendChild(el(doc, "h3", { text: "Changer le rôle" }));
    sheet.appendChild(el(doc, "p", { class: "ar-target", text: (target.name || "Membre") }));
    sheet.appendChild(el(doc, "p", { class: "ar-current", text: "Rôle actuel : " + roleLabel(displayRole(target)) }));

    optionsFor(target).forEach(function (o) {
      var input = el(doc, "input", { type: "radio", name: "ar-role", value: o.value });
      input.addEventListener("change", function () {
        chosen = o.value;
        warning.textContent = o.warning || "";
        sendBtn.removeAttribute("disabled");
        status.textContent = "";
        status.className = "ar-status";
      });
      sheet.appendChild(el(doc, "label", { class: "ar-option" }, [
        input,
        el(doc, "span", { class: "ar-option-text" }, [
          el(doc, "strong", { text: o.label }),
          el(doc, "span", { class: "ar-desc", text: o.desc })
        ])
      ]));
    });

    sheet.appendChild(warning);
    sheet.appendChild(reason);
    sheet.appendChild(status);
    sheet.appendChild(el(doc, "div", { class: "ar-actions" }, [cancelBtn, sendBtn]));
    var overlay = el(doc, "div", { class: "ar-overlay" }, [sheet]);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    cancelBtn.addEventListener("click", function () { if (!busy) close(); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && !busy) close(); });

    sendBtn.addEventListener("click", function () {
      if (busy || !chosen) return;
      var label = roleLabel(chosen);
      var text = "Confirmer : donner le rôle « " + label + " » à " + (target.name || "ce membre") + " ?" +
        (chosen === "admin" ? "\n\nIl aura accès à toute l'administration." : "");
      if (!confirmFn(text)) return;
      busy = true;
      sendBtn.setAttribute("disabled", "disabled");
      status.className = "ar-status";
      status.textContent = "Enregistrement…";
      Promise.resolve(options.send(chosen, String(reason.value || "").trim().slice(0, MAX_REASON))).then(function (result) {
        busy = false;
        status.textContent = result.message || "";
        if (result.ok) {
          if (options.onDone) options.onDone(chosen);
          setTimeout(close, 900);
        } else {
          status.className = "ar-status ar-error";
          sendBtn.removeAttribute("disabled");
        }
      }, function () {
        busy = false;
        status.className = "ar-status ar-error";
        status.textContent = "Impossible de changer le rôle pour le moment.";
        sendBtn.removeAttribute("disabled");
      });
    });

    return { overlay: overlay, close: close, reason: reason, sendBtn: sendBtn };
  }

  function roleLabel(value) {
    if (value === "moderateur") return "Modérateur";
    if (value === "admin") return "Administrateur";
    if (value === "user") return "Membre";
    if (value === "super_admin") return "Super administrateur";
    if (value === "founder") return "Fondateur";
    return String(value || "Membre");
  }

  function injectStyle(doc) {
    if (doc.getElementById("ar-style")) return;
    var style = doc.createElement("style");
    style.id = "ar-style";
    style.textContent =
      ".ar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70;display:flex;align-items:flex-end;justify-content:center}" +
      ".ar-sheet{width:100%;max-width:480px;background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:18px 20px max(18px,env(safe-area-inset-bottom));max-height:88vh;overflow-y:auto}" +
      ".ar-sheet h3{color:var(--gold);margin:0 0 6px}" +
      ".ar-target{font-weight:bold;font-size:15px;margin:0;overflow-wrap:anywhere}" +
      ".ar-current{font-size:12.5px;color:var(--text-muted);margin:2px 0 12px}" +
      ".ar-option{display:flex;align-items:flex-start;gap:12px;padding:12px 4px;font-size:15px;cursor:pointer;min-height:44px}" +
      ".ar-option-text{display:flex;flex-direction:column;gap:2px}" +
      ".ar-desc{font-size:12.5px;color:var(--text-muted)}" +
      ".ar-warning{font-size:13px;font-weight:600;color:#F87171;margin:8px 0;min-height:0}" +
      ".ar-reason{width:100%;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;font-family:inherit;resize:vertical}" +
      ".ar-status{min-height:18px;font-size:13px;margin:8px 0;color:var(--text-muted)}" +
      ".ar-status.ar-error{color:#F87171}" +
      ".ar-actions{display:flex;gap:10px;justify-content:flex-end}" +
      ".ar-actions button{min-height:44px;padding:10px 18px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;cursor:pointer}" +
      ".ar-actions button.ar-send{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}" +
      ".ar-actions button:disabled{opacity:.5;cursor:not-allowed}";
    doc.head.appendChild(style);
  }

  var api = {
    OPTIONS: OPTIONS, MAX_REASON: MAX_REASON, MSG_UNAVAILABLE: MSG_UNAVAILABLE,
    displayRole: displayRole, canChangeRole: canChangeRole, optionsFor: optionsFor,
    errorMessage: errorMessage, roleLabel: roleLabel, buildDialog: buildDialog, injectStyle: injectStyle
  };
  root.MahoutoAdminRoles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
