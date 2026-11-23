/* =========================================================
   messagerie-blocage.js — bloquer / débloquer un membre dans la messagerie privée (dm-chat.html, messages-prives.html).
   Tout passe par les fonctions Supabase dm_bloquer, dm_debloquer et dm_mes_blocages (jamais d'écriture directe dans la table).
   Le membre bloqué ne sait JAMAIS qu'il l'est : il reçoit seulement l'erreur neutre à l'envoi. Cette interface ne montre que
   les blocages posés PAR la personne connectée.
   Tout texte dynamique est écrit avec textContent (aucun innerHTML) ; aucune requête en dehors de ces appels Supabase.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MessagerieBlocage = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var TEXTS = {
    menuBloquer: "Bloquer ce membre",
    menuDebloquer: "Débloquer ce membre",
    confirmTitre: "Bloquer ce membre ?",
    confirm: "Vous ne recevrez plus de messages de cette personne et elle ne pourra plus vous en envoyer. Vous pourrez la débloquer à tout moment.",
    confirmOui: "Bloquer",
    confirmNon: "Annuler",
    avis: "Vous avez bloqué ce membre. Débloquez-le pour pouvoir lui écrire à nouveau.",
    envoiNeutre: "Impossible d'envoyer ce message.",
    listeTitre: "Membres bloqués",
    listeIntro: "Ces membres ne peuvent plus vous écrire, et vous ne pouvez plus leur écrire. Vos anciens échanges restent lisibles.",
    listeVide: "Vous n'avez bloqué personne.",
    listeChargement: "Chargement…",
    listeErreur: "Impossible de charger la liste. Réessayez dans un instant.",
    debloquer: "Débloquer"
  };
  var ERR_CODE = "MB001";   // code d'erreur du déclencheur : message neutre, identique dans les deux sens

  /** Message pour le code renvoyé par dm_bloquer : ok, deja, soi_meme, inconnu, non_connecte. */
  function blocageMessage(code) {
    switch (code) {
      case "ok": return { ok: true, text: "Ce membre est bloqué." };
      case "deja": return { ok: true, text: "Ce membre est déjà bloqué." };
      case "soi_meme": return { ok: false, text: "Vous ne pouvez pas vous bloquer vous-même." };
      case "inconnu": return { ok: false, text: "Ce membre est introuvable." };
      case "non_connecte": return { ok: false, text: "Connectez-vous pour bloquer un membre." };
      default: return { ok: false, text: "Le blocage n'a pas pu être enregistré. Réessayez dans un instant." };
    }
  }

  /** Message pour le code renvoyé par dm_debloquer : ok, absent, non_connecte. */
  function deblocageMessage(code) {
    switch (code) {
      case "ok": return { ok: true, text: "Ce membre est débloqué." };
      case "absent": return { ok: true, text: "Ce membre n'était pas bloqué." };
      case "non_connecte": return { ok: false, text: "Connectez-vous pour débloquer un membre." };
      default: return { ok: false, text: "Le déblocage n'a pas pu être enregistré. Réessayez dans un instant." };
    }
  }

  /** Une erreur d'envoi est-elle celle du blocage ? (le message affiché reste le même qu'une erreur ordinaire) */
  function isBlockError(err) { return !!err && (err.code === ERR_CODE || /Impossible d.envoyer ce message/.test(String(err.message || ""))); }

  /** Date « jj/mm/aaaa » ; chaîne vide si invalide. */
  function formatDate(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  /** Nom affiché d'une ligne de dm_mes_blocages (nom public, sinon « Membre »). */
  function displayName(row) { var n = row && typeof row.nom === "string" ? row.nom.trim() : ""; return n || "Membre"; }

  function el(doc, tag, props, children) {
    var n = doc.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.setAttribute("class", props[k]); else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function setHidden(n, hidden) { if (n && n.classList) n.classList.toggle("hidden", !!hidden); }

  /**
   * Fenêtre de confirmation (rôle alertdialog) : renvoie une promesse « true » (Bloquer) ou « false » (Annuler, Échap, fond).
   * Le focus va sur « Annuler » (choix prudent) et revient sur l'élément d'origine à la fermeture.
   */
  function confirmBlock(doc, opener) {
    return new Promise(function (resolve) {
      var overlay = el(doc, "div", { id: "bl-overlay", class: "bl-overlay" });
      var no = el(doc, "button", { type: "button", class: "bl-btn", id: "bl-non", text: TEXTS.confirmNon });
      var yes = el(doc, "button", { type: "button", class: "bl-btn bl-danger", id: "bl-oui", text: TEXTS.confirmOui });
      var box = el(doc, "div", { class: "bl-box", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "bl-titre", "aria-describedby": "bl-texte" }, [
        el(doc, "h2", { id: "bl-titre", text: TEXTS.confirmTitre }), el(doc, "p", { id: "bl-texte", text: TEXTS.confirm }),
        el(doc, "div", { class: "bl-actions" }, [no, yes])]);
      overlay.appendChild(box);
      var done = false;
      function finish(v) {
        if (done) return; done = true;
        doc.removeEventListener("keydown", onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (opener && opener.focus) opener.focus();
        resolve(v);
      }
      function onKey(e) {
        if (e.key === "Escape") { finish(false); return; }
        if (e.key === "Tab" && box.querySelectorAll) {
          var items = [no, yes];
          if (e.shiftKey && doc.activeElement === items[0]) { e.preventDefault(); yes.focus(); }
          else if (!e.shiftKey && doc.activeElement === items[1]) { e.preventDefault(); no.focus(); }
        }
      }
      no.addEventListener("click", function () { finish(false); });
      yes.addEventListener("click", function () { finish(true); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) finish(false); });
      doc.addEventListener("keydown", onKey);
      doc.body.appendChild(overlay);
      if (no.focus) no.focus();
    });
  }

  /**
   * Conversation (dm-chat.html). env : { doc, supabase, peerId, els:{ menuBtn, menu, blockBtn, unblockBtn, notice, status, composer, controls:[…] } }
   * Renvoie { refresh(), isBlocked() }. Aucune requête n'est faite sans peerId.
   */
  function mountChat(env) {
    var doc = env.doc, sb = env.supabase, els = env.els, blocked = false, busy = false;

    function say(text) { if (els.status) els.status.textContent = text || ""; }
    function apply() {
      (els.controls || []).forEach(function (c) { if (c) c.disabled = blocked; });
      if (els.composerInput) els.composerInput.setAttribute("placeholder", blocked ? "Envoi impossible" : "Écrire un message...");
      if (els.notice) { els.notice.textContent = blocked ? TEXTS.avis : ""; setHidden(els.notice, !blocked); }
      setHidden(els.blockBtn, blocked); setHidden(els.unblockBtn, !blocked);
    }
    function menuOpen(open) {
      setHidden(els.menu, !open);
      if (els.menuBtn) els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function onKey(e) { if (e.key === "Escape") { menuOpen(false); if (els.menuBtn && els.menuBtn.focus) els.menuBtn.focus(); } }

    async function refresh() {
      if (!env.peerId) return false;
      try {
        var r = await sb.from("dm_blocages").select("bloque_id").eq("bloque_id", env.peerId).limit(1);
        blocked = !r.error && Array.isArray(r.data) && r.data.length > 0;
      } catch (e) { blocked = false; }
      apply();
      return blocked;
    }

    async function block() {
      menuOpen(false);
      if (busy || !env.peerId) return;
      var yes = await confirmBlock(doc, els.menuBtn);
      if (!yes) return;
      busy = true; say("");
      var code = null;
      try { var r = await sb.rpc("dm_bloquer", { p_membre: env.peerId }); code = r.error ? null : r.data; } catch (e) { code = null; }
      var m = blocageMessage(typeof code === "string" ? code : null);
      if (code === "ok" || code === "deja") { blocked = true; apply(); say(m.text); } else say(m.text);
      busy = false;
    }
    async function unblock() {
      menuOpen(false);
      if (busy || !env.peerId) return;
      busy = true; say("");
      var code = null;
      try { var r = await sb.rpc("dm_debloquer", { p_membre: env.peerId }); code = r.error ? null : r.data; } catch (e) { code = null; }
      var m = deblocageMessage(typeof code === "string" ? code : null);
      if (code === "ok" || code === "absent") { blocked = false; apply(); say(m.text); } else say(m.text);
      busy = false;
    }

    if (els.menuBtn) els.menuBtn.addEventListener("click", function () { var open = els.menu && els.menu.classList && els.menu.classList.contains("hidden"); menuOpen(open); if (open && els.blockBtn && els.unblockBtn) (blocked ? els.unblockBtn : els.blockBtn).focus(); });
    if (els.blockBtn) els.blockBtn.addEventListener("click", block);
    if (els.unblockBtn) els.unblockBtn.addEventListener("click", unblock);
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("click", function (e) { if (els.menu && !els.menu.classList.contains("hidden") && e.target !== els.menuBtn && !(els.menuBtn && els.menuBtn.contains && els.menuBtn.contains(e.target)) && !(els.menu.contains && els.menu.contains(e.target))) menuOpen(false); });
    apply();
    return { refresh: refresh, isBlocked: function () { return blocked; }, block: block, unblock: unblock };
  }

  /**
   * Liste « Membres bloqués » (messages-prives.html). env : { doc, supabase, els:{ openBtn, panel, closeBtn, list, empty, status } }
   * Une ligne par membre que J'AI bloqué : nom public, date, bouton « Débloquer ».
   */
  function mountBlockedList(env) {
    var doc = env.doc, sb = env.supabase, els = env.els, busy = false;
    function say(t) { els.status.textContent = t || ""; }

    function render(rows) {
      els.list.textContent = "";
      setHidden(els.empty, rows.length > 0);
      rows.forEach(function (row) {
        var nom = displayName(row), date = formatDate(row.cree_le);
        var btn = el(doc, "button", { type: "button", class: "bl-unblock", text: TEXTS.debloquer, "aria-label": TEXTS.debloquer + " " + nom });
        var li = el(doc, "li", { class: "bl-row" }, [
          el(doc, "div", { class: "bl-info" }, [el(doc, "div", { class: "bl-nom", text: nom }), date ? el(doc, "div", { class: "bl-date", text: "Bloqué le " + date }) : null]), btn]);
        btn.addEventListener("click", async function () {
          if (busy) return; busy = true; btn.disabled = true; say("");
          var code = null;
          try { var r = await sb.rpc("dm_debloquer", { p_membre: row.membre_id }); code = r.error ? null : r.data; } catch (e) { code = null; }
          var m = deblocageMessage(typeof code === "string" ? code : null);
          if (code === "ok" || code === "absent") {
            if (li.parentNode) li.parentNode.removeChild(li);
            rows = rows.filter(function (x) { return x !== row; });
            setHidden(els.empty, rows.length > 0);
          } else btn.disabled = false;
          say(m.text); busy = false;
        });
        els.list.appendChild(li);
      });
    }

    async function load() {
      say(TEXTS.listeChargement); els.list.textContent = ""; setHidden(els.empty, true);
      var rows = null;
      try { var r = await sb.rpc("dm_mes_blocages"); rows = r.error || !Array.isArray(r.data) ? null : r.data; } catch (e) { rows = null; }
      if (!rows) { say(TEXTS.listeErreur); return false; }
      say(""); render(rows); return true;
    }

    function open() { setHidden(els.panel, false); if (els.openBtn) els.openBtn.setAttribute("aria-expanded", "true"); if (els.closeBtn && els.closeBtn.focus) els.closeBtn.focus(); return load(); }
    function close() { setHidden(els.panel, true); if (els.openBtn) { els.openBtn.setAttribute("aria-expanded", "false"); if (els.openBtn.focus) els.openBtn.focus(); } }
    els.openBtn.addEventListener("click", open);
    els.closeBtn.addEventListener("click", close);
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && els.panel.classList && !els.panel.classList.contains("hidden")) close(); });
    return { open: open, close: close, load: load };
  }

  return { TEXTS: TEXTS, ERR_CODE: ERR_CODE, blocageMessage: blocageMessage, deblocageMessage: deblocageMessage, isBlockError: isBlockError, formatDate: formatDate,
    displayName: displayName, confirmBlock: confirmBlock, mountChat: mountChat, mountBlockedList: mountBlockedList };
});
