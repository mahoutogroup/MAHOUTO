/* =========================================================
   report.js — Signalement d'un message (salon ou message privé)
   Utilisé par chat.html (salons) et dm-chat.html (messages privés).

   Ce qui est enregistré (table public.message_reports, migration
   003) : le type (salon ou message privé), l'identifiant du message
   et la raison choisie. L'auteur du signalement et la date sont
   ajoutés par la base ; le CONTENU du message n'est jamais copié.

   Important : l'insertion ne demande PAS la ligne en retour (pas de
   .select()) : seuls les admins peuvent lire les signalements, donc
   un retour de ligne ferait échouer l'insertion pour les autres.
   ========================================================= */
(function (root) {
  "use strict";

  var REASONS = [
    { value: "spam", label: "Spam ou publicité" },
    { value: "harcelement", label: "Harcèlement ou insultes" },
    { value: "inapproprie", label: "Contenu inapproprié" },
    { value: "usurpation", label: "Usurpation d'identité" },
    { value: "arnaque", label: "Arnaque ou fraude" },
    { value: "autre", label: "Autre" }
  ];

  var KINDS = ["room", "dm"];

  function isValidRequest(kind, messageId, reason) {
    var id = Number(messageId);
    return (
      KINDS.indexOf(kind) !== -1 &&
      Number.isInteger(id) && id > 0 &&
      REASONS.some(function (r) { return r.value === reason; })
    );
  }

  // Message affiché à la personne (tutoiement, comme le reste de la messagerie).
  function errorMessage(error) {
    if (!error) return "";
    if (error.code === "23505") return "Tu as déjà signalé ce message.";
    return "Impossible d'envoyer le signalement pour le moment.";
  }

  async function submit(supabase, kind, messageId, reason) {
    if (!isValidRequest(kind, messageId, reason)) {
      return { ok: false, message: "Choisis une raison pour signaler ce message." };
    }
    try {
      var result = await supabase
        .from("message_reports")
        .insert({ kind: kind, message_id: Number(messageId), reason: reason });
      if (result.error) {
        return { ok: false, message: errorMessage(result.error), error: result.error };
      }
      return { ok: true, message: "Merci, ton signalement a été envoyé à l'équipe." };
    } catch (err) {
      return { ok: false, message: errorMessage(err), error: err };
    }
  }

  // ---------- Fenêtre de choix de la raison (DOM, jamais innerHTML) ----------
  function injectStyle() {
    if (document.getElementById("rp-style")) return;
    var style = document.createElement("style");
    style.id = "rp-style";
    style.textContent =
      "#rp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:90;display:flex;align-items:flex-end;justify-content:center}" +
      "#rp-overlay .rp-sheet{width:100%;max-width:480px;background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:16px 20px max(16px,env(safe-area-inset-bottom));max-height:85vh;overflow-y:auto}" +
      "#rp-overlay h2{font-size:16px;margin:0 0 4px}" +
      "#rp-overlay .rp-help{font-size:13px;color:var(--text-muted);margin:0 0 12px}" +
      "#rp-overlay label.rp-option{display:flex;align-items:center;gap:10px;padding:11px 4px;font-size:15px;cursor:pointer}" +
      "#rp-overlay .rp-status{min-height:18px;font-size:13px;margin:8px 0;color:var(--text-muted)}" +
      "#rp-overlay .rp-status.rp-error{color:#F87171}" +
      "#rp-overlay .rp-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}" +
      "#rp-overlay .rp-actions button{padding:10px 16px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;cursor:pointer}" +
      "#rp-overlay .rp-actions button.rp-send{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}" +
      "#rp-overlay .rp-actions button:disabled{opacity:.5;cursor:not-allowed}";
    document.head.appendChild(style);
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k === "class") node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  /**
   * options : { supabase, kind: "room" | "dm", messageId }
   * Ouvre la fenêtre ; ne fait rien si une fenêtre est déjà ouverte.
   */
  function open(options) {
    if (typeof document === "undefined" || document.getElementById("rp-overlay")) return;
    injectStyle();

    var chosen = null;
    var busy = false;
    var closeTimer = null;

    var status = el("p", { class: "rp-status", role: "status", "aria-live": "polite" });
    var sendBtn = el("button", { type: "button", class: "rp-send", text: "Signaler", disabled: "disabled" });
    var cancelBtn = el("button", { type: "button", text: "Annuler" });

    var overlay = el("div", { id: "rp-overlay" });
    var sheet = el("div", { class: "rp-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Signaler un message" });
    sheet.appendChild(el("h2", { text: "Signaler ce message" }));
    sheet.appendChild(el("p", { class: "rp-help", text: "Pourquoi signales-tu ce message ?" }));

    REASONS.forEach(function (r) {
      var input = el("input", { type: "radio", name: "rp-reason", value: r.value });
      input.addEventListener("change", function () {
        chosen = r.value;
        sendBtn.removeAttribute("disabled");
        status.textContent = "";
        status.className = "rp-status";
      });
      sheet.appendChild(el("label", { class: "rp-option" }, [input, el("span", { text: r.label })]));
    });

    sheet.appendChild(status);
    sheet.appendChild(el("div", { class: "rp-actions" }, [cancelBtn, sendBtn]));
    overlay.appendChild(sheet);

    function close() {
      if (closeTimer) clearTimeout(closeTimer);
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(e) { if (e.key === "Escape" && !busy) close(); }

    overlay.addEventListener("click", function (e) { if (e.target === overlay && !busy) close(); });
    cancelBtn.addEventListener("click", function () { if (!busy) close(); });
    document.addEventListener("keydown", onKey);

    sendBtn.addEventListener("click", async function () {
      if (busy || !chosen) return;
      busy = true;
      sendBtn.disabled = true;
      status.className = "rp-status";
      status.textContent = "Envoi...";
      var result = await submit(options.supabase, options.kind, options.messageId, chosen);
      busy = false;
      status.textContent = result.message;
      if (result.ok) {
        closeTimer = setTimeout(close, 1500);
      } else {
        status.className = "rp-status rp-error";
        // Doublon : inutile de réessayer ; autre erreur : on peut retenter.
        sendBtn.disabled = !!(result.error && result.error.code === "23505");
      }
    });

    document.body.appendChild(overlay);
    var first = sheet.querySelector("input");
    if (first) first.focus();
  }

  var api = { REASONS: REASONS, KINDS: KINDS, isValidRequest: isValidRequest, errorMessage: errorMessage, submit: submit, open: open };
  root.MahoutoReport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
