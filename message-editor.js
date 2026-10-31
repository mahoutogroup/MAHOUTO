/* =========================================================
   message-editor.js — fenêtre de modification d'un message (salons et discussions privées)

   Remplace window.prompt() (une seule ligne) par une fenêtre intégrée :
   - grand <textarea> (au moins 40 % de l'écran), qui grandit avec le contenu puis défile ;
   - retours à la ligne conservés, texte actuel pré-rempli, curseur à la fin ;
   - « Annuler » / « Enregistrer » (désactivé si vide ou inchangé) ;
   - reste au-dessus du clavier (visualViewport) ;
   - se ferme avec le bouton Retour d'Android (entrée d'historique dédiée) ou Échap.

   Ce fichier ne sait PAS enregistrer : la page appelante passe sa propre fonction
   d'enregistrement (même mise à jour Supabase qu'avant, mêmes droits, mêmes règles).
   Le texte est placé via .value : jamais interprété comme du HTML.

   Utilisation : MahoutoMessageEditor.open(texteActuel, function (texteModifie) { ... });
   ========================================================= */
window.MahoutoMessageEditor = (function () {
  "use strict";

  var MAX_LENGTH = 20000;   // identique au champ de saisie des chats et à la contrainte de la base
  var styleAdded = false;
  var current = null;       // fenêtre ouverte (une seule à la fois)

  function addStyle() {
    if (styleAdded) return;
    styleAdded = true;
    var css =
      ".mme-overlay{position:fixed;left:0;right:0;top:0;height:100vh;z-index:90;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;overscroll-behavior:contain}" +
      ".mme-sheet{box-sizing:border-box;width:100%;max-width:560px;max-height:100%;display:flex;flex-direction:column;gap:10px;" +
        "background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:14px 16px max(14px,env(safe-area-inset-bottom))}" +
      ".mme-title{font-size:15px;font-weight:700;margin:0}" +
      ".mme-text{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:0;resize:none;overflow-y:auto;padding:12px;border-radius:12px;" +
        "border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-family:inherit;font-size:16px;line-height:1.5;white-space:pre-wrap}" +
      ".mme-actions{display:flex;gap:10px;justify-content:flex-end;flex:none}" +
      ".mme-btn{min-height:44px;padding:0 20px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer}" +
      ".mme-btn.primary{background:var(--gold-bright);color:#0A0A0A;border-color:var(--gold-bright)}" +
      ".mme-btn:disabled{opacity:.4;cursor:not-allowed}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  function open(initialText, onSave) {
    if (current) current.close(false);
    addStyle();

    var original = String(initialText == null ? "" : initialText);

    var overlay = document.createElement("div");
    overlay.className = "mme-overlay";

    var sheet = document.createElement("div");
    sheet.className = "mme-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Modifier le message");

    var title = document.createElement("h2");
    title.className = "mme-title";
    title.textContent = "Modifier le message";

    var ta = document.createElement("textarea");
    ta.className = "mme-text";
    ta.maxLength = MAX_LENGTH;
    ta.setAttribute("aria-label", "Texte du message");
    ta.value = original;

    var actions = document.createElement("div");
    actions.className = "mme-actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "mme-btn";
    cancelBtn.textContent = "Annuler";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "mme-btn primary";
    saveBtn.textContent = "Enregistrer";
    actions.append(cancelBtn, saveBtn);

    sheet.append(title, ta, actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    var vv = window.visualViewport;

    // Reste dans la zone visible (au-dessus du clavier) : la fenêtre suit visualViewport.
    function fit() {
      var top = vv ? vv.offsetTop : 0;
      var height = vv ? vv.height : window.innerHeight;
      overlay.style.top = top + "px";
      overlay.style.height = height + "px";
      grow(height);
    }

    // Hauteur du champ : au moins 40 % de l'écran (dans la limite de la place disponible),
    // puis il grandit avec le contenu ; au-delà de la place disponible, il défile à l'intérieur.
    function grow(viewHeight) {
      viewHeight = viewHeight || (vv ? vv.height : window.innerHeight);
      ta.style.height = "auto";
      var chrome = sheet.offsetHeight - ta.offsetHeight;                 // titre + boutons + marges
      var available = Math.max(80, viewHeight - chrome);
      var minHeight = Math.min(Math.round(window.screen.height * 0.4 || viewHeight * 0.4), available);
      ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, minHeight), available) + "px";
    }

    function refreshSave() {
      var value = ta.value.trim();
      saveBtn.disabled = !value || value === original.trim();
    }

    function onInput() { refreshSave(); grow(); }

    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(true); }
    }

    var closed = false;
    var historyPushed = false;

    // Bouton Retour d'Android : une entrée d'historique dédiée, retirée à la fermeture.
    function onPop() { close(false); }

    function close(fromUi) {
      if (closed) return;
      closed = true;
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
      overlay.remove();
      if (current && current.overlay === overlay) current = null;
      if (fromUi && historyPushed && history.state && history.state.mmeEditor) {
        history.back();   // retire l'entrée d'historique ajoutée à l'ouverture
      }
    }

    cancelBtn.addEventListener("click", function () { close(true); });
    saveBtn.addEventListener("click", function () {
      var value = ta.value.trim();
      if (!value || value === original.trim()) return;
      close(true);
      if (typeof onSave === "function") onSave(value);
    });
    ta.addEventListener("input", onInput);
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    if (vv) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }

    try {
      history.pushState({ mmeEditor: 1 }, "");
      historyPushed = true;
    } catch (e) { /* historique indisponible : la fenêtre se ferme par les boutons */ }

    refreshSave();
    fit();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);   // curseur à la fin
    ta.scrollTop = ta.scrollHeight;

    current = { overlay: overlay, close: close };
  }

  return { open: open };
})();
