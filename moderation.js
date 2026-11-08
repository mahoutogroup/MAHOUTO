/* =========================================================
   moderation.js — Modération des signalements (page admin/signalements.html
   et pastille du tableau de bord admin)

   Rien de sensible ici : la vraie protection est la RLS de la base
   (migrations 003 et 006). Ce fichier ne fait que regrouper, libeller et
   afficher.

   Sécurité de l'affichage : le texte des messages et les pseudos viennent
   d'utilisateurs. Tout est écrit avec textContent ; ce fichier n'utilise
   JAMAIS innerHTML, ni liens, ni images tirés d'un contenu de message.
   Une pièce jointe n'est mentionnée que par un libellé fixe.

   Aucun journal console du contenu d'un message (privé ou non).
   ========================================================= */
(function (root) {
  "use strict";

  var REASON_LABELS = {
    spam: "Spam ou publicité",
    harcelement: "Harcèlement ou insultes",
    inapproprie: "Contenu inapproprié",
    usurpation: "Usurpation d'identité",
    arnaque: "Arnaque ou fraude",
    autre: "Autre"
  };

  var STATUS_LABELS = { open: "Ouvert", dismissed: "Classé sans suite", actioned: "Traité" };

  var MAX_NOTE = 1000;

  var MSG_UNAVAILABLE = "La modération n'est pas encore activée (la migration 006 n'a pas été exécutée). Rien n'est cassé : reviens ici après son exécution.";
  var MSG_DENIED = "Action refusée : réservé aux administrateurs.";
  var MSG_OTHER = "Impossible de charger les signalements pour le moment.";

  function reasonLabel(reason) { return REASON_LABELS[reason] || "Autre"; }
  function statusLabel(status) { return STATUS_LABELS[status] || STATUS_LABELS.open; }
  function isAdminRole(role) { return role === "admin" || role === "super_admin" || role === "founder"; }

  // 'unavailable' : migration 003 ou 006 pas encore exécutée (table, colonne ou fonction absente)
  // 'denied'      : refus de la base (pas admin)
  // 'other'       : tout le reste
  function errorKind(error) {
    if (!error) return null;
    var code = String(error.code || "");
    var text = String(error.message || "");
    if (code === "42703" || code === "42P01" || code === "42883" ||
        code === "PGRST200" || code === "PGRST202" || code === "PGRST204" || code === "PGRST205") return "unavailable";
    if (/does not exist|schema cache|could not find/i.test(text) &&
        /message_reports|admin_hide_room_message|status|handled_/i.test(text)) return "unavailable";
    if (code === "42501" || /ADMIN_REQUIRED|permission denied|row-level security/i.test(text)) return "denied";
    return "other";
  }

  function errorMessage(error) {
    var kind = errorKind(error);
    if (kind === "unavailable") return MSG_UNAVAILABLE;
    if (kind === "denied") return MSG_DENIED;
    return MSG_OTHER;
  }

  // Regroupe les lignes de message_reports par message (type + identifiant).
  // Ouverts d'abord, puis du plus récent au plus ancien.
  function groupReports(rows) {
    var map = {};
    var order = [];
    (rows || []).forEach(function (r) {
      var key = r.kind + ":" + r.message_id;
      var g = map[key];
      if (!g) {
        g = map[key] = {
          key: key, kind: r.kind, message_id: r.message_id, reported_user_id: r.reported_user_id || null,
          reports: [], reporters: [], reasons: {}, openIds: [], lastDate: r.created_at,
          message_text: null, hasOpen: false, notes: []
        };
        order.push(key);
      }
      g.reports.push(r);
      if (g.reporters.indexOf(r.reporter_id) === -1) g.reporters.push(r.reporter_id);
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      if (!g.reported_user_id && r.reported_user_id) g.reported_user_id = r.reported_user_id;
      if (!g.message_text && r.message_text) g.message_text = r.message_text;
      if (String(r.created_at) > String(g.lastDate)) g.lastDate = r.created_at;
      if ((r.status || "open") === "open") { g.hasOpen = true; g.openIds.push(r.id); }
      if (r.admin_note) g.notes.push(r.admin_note);
    });
    var groups = order.map(function (k) { return map[k]; });
    groups.forEach(function (g) {
      g.count = g.reporters.length;
      var statuses = g.reports.map(function (r) { return r.status || "open"; });
      g.status = g.hasOpen ? "open" : (statuses.indexOf("actioned") !== -1 ? "actioned" : "dismissed");
    });
    groups.sort(function (a, b) {
      if (a.hasOpen !== b.hasOpen) return a.hasOpen ? -1 : 1;
      return String(b.lastDate).localeCompare(String(a.lastDate));
    });
    return groups;
  }

  function filterGroups(groups, mode) {
    return groups.filter(function (g) { return mode === "closed" ? !g.hasOpen : g.hasOpen; });
  }

  function countOpenReports(rows) {
    return (rows || []).filter(function (r) { return (r.status || "open") === "open"; }).length;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return d.toISOString(); }
  }

  // Texte du message à afficher : salon (lu dans messages, par un admin) ou copie du signalement (message privé).
  function describeMessage(group, roomMessage) {
    if (group.kind === "dm") {
      if (group.message_text) return { text: group.message_text, note: "Copie du message prise au moment du signalement" };
      return { text: "", note: "Aucune copie de texte (message sans texte ou copie absente)" };
    }
    if (roomMessage && !roomMessage.is_deleted && roomMessage.content) {
      return { text: roomMessage.content, note: "Message du salon", attachment: roomMessage.attachment_type || (roomMessage.attachment_url ? "fichier" : null) };
    }
    if (group.message_text) return { text: group.message_text, note: "Message masqué : copie gardée au masquage" };
    if (roomMessage && roomMessage.is_deleted) return { text: "", note: "Message déjà supprimé" };
    return { text: "", note: "Message introuvable" };
  }

  // Nombre de signalements ouverts pour la pastille. null si indisponible (migration 006 absente,
  // pas admin, hors ligne…) : la pastille reste alors simplement cachée, sans erreur ni journal.
  async function fetchOpenCount(supabase) {
    try {
      var res = await supabase.from("message_reports").select("id", { count: "exact", head: true }).eq("status", "open");
      if (res.error || typeof res.count !== "number") return null;
      return res.count;
    } catch (e) { return null; }
  }

  // ---------- Affichage (DOM, textContent uniquement) ----------
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

  function reasonsSummary(group) {
    return Object.keys(group.reasons).map(function (r) {
      return reasonLabel(r) + (group.reasons[r] > 1 ? " ×" + group.reasons[r] : "");
    }).join(", ");
  }

  /**
   * ctx : { names: {id: pseudo}, roomMessages: {id: row}, doc, onHide(group, note), onDismiss(group, note), onAction(group, note) }
   * Renvoie l'élément de la carte d'un message signalé.
   */
  function buildCard(group, ctx) {
    var doc = ctx.doc || root.document;
    var names = ctx.names || {};
    var info = describeMessage(group, (ctx.roomMessages || {})[group.message_id]);
    var reportedName = group.reported_user_id ? (names[group.reported_user_id] || "Compte inconnu") : "Compte inconnu";
    var reporters = group.reporters.map(function (id) { return names[id] || "Compte inconnu"; }).join(", ");

    var head = el(doc, "div", { class: "rp-head" }, [
      el(doc, "span", { class: "rp-kind", text: group.kind === "dm" ? "💬 Message privé" : "🏠 Salon" }),
      el(doc, "span", { class: "rp-count", text: group.count + (group.count > 1 ? " signalements" : " signalement") }),
      el(doc, "span", { class: "rp-status rp-status-" + group.status, text: statusLabel(group.status) })
    ]);

    var body = el(doc, "div", { class: "rp-message", text: info.text || "—" });
    var kids = [
      head,
      el(doc, "p", { class: "rp-line", text: "Signalé : " + reportedName }),
      el(doc, "p", { class: "rp-line", text: "Signalé par : " + reporters }),
      el(doc, "p", { class: "rp-line", text: "Raison : " + reasonsSummary(group) }),
      el(doc, "p", { class: "rp-line rp-muted", text: "Dernier signalement : " + formatDate(group.lastDate) }),
      el(doc, "p", { class: "rp-note-label", text: info.note }),
      body
    ];
    if (info.attachment) kids.push(el(doc, "p", { class: "rp-line rp-muted", text: "📎 Contient une pièce jointe (non affichée ici)" }));
    group.notes.forEach(function (n) { kids.push(el(doc, "p", { class: "rp-line rp-admin-note", text: "Note : " + n })); });

    if (group.hasOpen) {
      var note = el(doc, "textarea", { class: "rp-note", maxlength: String(MAX_NOTE), rows: "2", placeholder: "Note (facultative)" });
      var buttons = [];
      if (group.kind === "room") {
        buttons.push(button(doc, "Masquer le message", "rp-btn rp-btn-hide", function () { ctx.onHide(group, note.value); }));
      }
      buttons.push(button(doc, "Classer sans suite", "rp-btn rp-btn-dismiss", function () { ctx.onDismiss(group, note.value); }));
      buttons.push(button(doc, "Marquer traité", "rp-btn rp-btn-action", function () { ctx.onAction(group, note.value); }));
      kids.push(note);
      kids.push(el(doc, "div", { class: "rp-actions" }, buttons));
    }
    return el(doc, "div", { class: "card rp-card", "data-key": group.key }, kids);
  }

  function button(doc, label, cls, onClick) {
    var b = el(doc, "button", { type: "button", class: cls, text: label });
    b.addEventListener("click", onClick);
    return b;
  }

  var api = {
    REASON_LABELS: REASON_LABELS, STATUS_LABELS: STATUS_LABELS, MAX_NOTE: MAX_NOTE,
    MSG_UNAVAILABLE: MSG_UNAVAILABLE, MSG_DENIED: MSG_DENIED, MSG_OTHER: MSG_OTHER,
    reasonLabel: reasonLabel, statusLabel: statusLabel, isAdminRole: isAdminRole,
    errorKind: errorKind, errorMessage: errorMessage,
    groupReports: groupReports, filterGroups: filterGroups, countOpenReports: countOpenReports,
    describeMessage: describeMessage, formatDate: formatDate, fetchOpenCount: fetchOpenCount,
    buildCard: buildCard
  };
  root.MahoutoModeration = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
