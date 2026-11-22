/* =========================================================
   m.js — m.html : page publique d'un membre, adresse /m/<adresse> (PR 1 sur 3 du profil public). LECTURE SEULE.

   - Le visiteur ne lit JAMAIS la table : il appelle la fonction profil_public_lire(adresse), qui renvoie au plus UNE ligne
     (colonnes publiques : id, adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type,
     contact_valeur) si la page est publiée, non suspendue ET la fonction ouverte. Aucune liste, aucune recherche partielle ;
     jamais l'identifiant du compte, la déclaration de majorité ni la suspension.
   - Sans ligne : aperçu pour la personne propriétaire (profil_public_mien) ou un administrateur (profils_publics_admin_lire),
     par fonctions, toujours sans lire la table ; sinon l'état vient de profil_public_statut : introuvable / non disponible / non ouverte.
   - Signalement (PR 2 sur 3) : bouton « Signaler cette page » pour un membre connecté qui n'est PAS le propriétaire (reconnu par
     profil_public_mien) et seulement sur une page réellement publique (jamais dans l'aperçu) ; visiteur non connecté : texte
     « Connectez-vous pour signaler cette page » (fenêtre de connexion). Envoi par la fonction profil_public_signaler (aucun
     accès direct à la table, aucun select après l'appel, aucun journal console).
   - Tout est affiché en TEXTE BRUT (createElement / textContent) : aucun innerHTML. Seuls liens autorisés : https (photo,
     lien de contact) et wa.me (WhatsApp), ouverts avec rel noopener noreferrer nofollow.
   ========================================================= */
(function () {
  "use strict";
  var PU = window.ProfilPublicUtils, cfg = window.MAHOUTO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  function show(id, on) { $(id).classList.toggle("hidden", !on); }

  function showState(key) {
    show("chargement", false); show("profil", false);
    $("etat-titre").textContent = PU.MESSAGES[key] || PU.MESSAGES.introuvable;
    show("etat", true);
  }

  function setText(id, text) {
    var n = $(id);
    if (text) { n.textContent = text; n.classList.remove("hidden"); } else { n.textContent = ""; n.classList.add("hidden"); }
  }

  function renderAvatar(row) {
    var box = $("avatar");
    box.textContent = "";
    var url = row.avatar_url ? PU.safeHttpsUrl(row.avatar_url, PU.LIMITS.avatar) : null;
    if (url) {
      var img = document.createElement("img");
      img.setAttribute("alt", "");
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", function () { box.textContent = initial(row.nom_affiche); });
      img.src = url;
      box.appendChild(img);
    } else box.textContent = initial(row.nom_affiche);
  }
  function initial(nom) { var c = Array.from(String(nom || "?").trim())[0]; return c ? c.toUpperCase() : "?"; }

  function renderContact(row) {
    var zone = $("contact-zone");
    zone.textContent = "";
    var href = null, label = "";
    if (row.contact_type === "whatsapp") { href = PU.whatsappLink(row.contact_valeur); label = "Écrire sur WhatsApp"; }
    else if (row.contact_type === "lien") { href = PU.safeHttpsUrl(row.contact_valeur, PU.LIMITS.lien); label = "Ouvrir le lien"; }
    if (!href) return;
    var a = document.createElement("a");
    a.className = "contact";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    a.textContent = label;
    zone.appendChild(a);
    var note = document.createElement("div");
    note.className = "contact-note";
    note.textContent = row.contact_type === "whatsapp" ? row.contact_valeur : href;
    zone.appendChild(note);
  }

  function renderProfil(row, banner) {
    show("chargement", false); show("etat", false);
    $("nom").textContent = row.nom_affiche || "";
    document.title = (row.nom_affiche || "Profil") + " — MAHOUTO+";
    renderAvatar(row);
    setText("metier", row.metier);
    setText("lieu", row.localisation);
    setText("presentation", row.presentation);
    renderContact(row);
    show("profil", true);
    if (banner) { $("bandeau").textContent = PU.MESSAGES[banner]; show("bandeau", true); }
  }

  // ---------- Compteur de visites (analytics.js existant : une ligne par visiteur et par 30 minutes, sans cookie ni identité) ----------
  // Chargé seulement pour une page publique affichée ; « Ne pas me suivre », robots et administrateurs sont écartés par analytics.js.
  function countVisit() {
    try {
      var s = document.createElement("script");
      s.setAttribute("src", "/analytics.js");
      s.setAttribute("async", "");
      document.body.appendChild(s);
    } catch (e) { /* le comptage est facultatif */ }
  }

  // ---------- Signalement ----------
  var sessionUser;   // undefined = pas encore lu ; null = non connecté (comptes anonymes comptés comme non connectés)
  async function currentUser(supabase) {
    if (sessionUser !== undefined) return sessionUser;
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    var u = session && session.user ? session.user : null;
    var anon = !!u && (u.is_anonymous === true || (u.app_metadata && u.app_metadata.provider === "anonymous"));
    sessionUser = u && !anon ? u : null;
    return sessionUser;
  }

  function mk(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function openReportSheet(supabase, adresse) {
    if ($("sg-overlay")) return;
    var chosen = null, busy = false, closeTimer = null;
    var status = mk("p", { class: "sg-status", role: "status" });
    var count = mk("div", { class: "sg-count", text: "0 / " + PU.SIGNALEMENT_DETAIL_MAX });
    var detail = mk("textarea", { id: "sg-detail", maxlength: String(PU.SIGNALEMENT_DETAIL_MAX), "aria-label": "Précisions (facultatif)" });
    var send = mk("button", { type: "button", class: "sg-send", text: "Envoyer" });
    var cancel = mk("button", { type: "button", text: "Annuler" });
    var overlay = mk("div", { id: "sg-overlay" });
    var sheet = mk("div", { class: "sg-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Signaler cette page" });
    sheet.appendChild(mk("h2", { text: "Signaler cette page" }));
    sheet.appendChild(mk("p", { class: "sg-help", text: "Pourquoi signalez-vous cette page ?" }));
    sheet.appendChild(mk("p", { class: "sg-warning", role: "note", text: PU.SIGNALEMENT_AVERTISSEMENT }));
    PU.MOTIFS_SIGNALEMENT.forEach(function (m) {
      var input = mk("input", { type: "radio", name: "sg-motif", value: m.value });
      input.addEventListener("change", function () { chosen = m.value; status.textContent = ""; status.className = "sg-status"; });
      sheet.appendChild(mk("label", { class: "sg-option" }, [input, mk("span", { text: m.label })]));
    });
    sheet.appendChild(mk("label", { for: "sg-detail", class: "sg-help", text: "Précisions (facultatif, " + PU.SIGNALEMENT_DETAIL_MAX + " caractères au maximum)" }));
    sheet.appendChild(detail);
    sheet.appendChild(count);
    sheet.appendChild(status);
    sheet.appendChild(mk("div", { class: "sg-actions" }, [cancel, send]));
    overlay.appendChild(sheet);

    function close() {
      if (closeTimer) clearTimeout(closeTimer);
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(e) { if (e.key === "Escape" && !busy) close(); }
    detail.addEventListener("input", function () { count.textContent = PU.countChars(detail.value) + " / " + PU.SIGNALEMENT_DETAIL_MAX; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && !busy) close(); });
    cancel.addEventListener("click", function () { if (!busy) close(); });
    document.addEventListener("keydown", onKey);

    send.addEventListener("click", async function () {
      if (busy) return;
      var check = PU.validateSignalement({ motif: chosen, detail: detail.value });
      if (!check.ok) { status.textContent = check.errors.motif || check.errors.detail; status.className = "sg-status sg-error"; return; }
      busy = true; send.disabled = true;
      status.className = "sg-status"; status.textContent = "Envoi…";
      var code = null;
      try {
        var res = await supabase.rpc("profil_public_signaler", { p_adresse: adresse, p_motif: check.value.motif, p_detail: check.value.detail });
        code = res.error ? null : res.data;
      } catch (e) { code = null; }
      var msg = PU.signalementMessage(typeof code === "string" ? code : null);
      status.textContent = msg.text;
      status.className = "sg-status" + (msg.ok ? "" : " sg-error");
      busy = false;
      if (msg.ok) closeTimer = setTimeout(close, 2000);
      else send.disabled = (code === "deja" || code === "propre_page" || code === "introuvable" || code === "limite" || code === "ferme");
    });

    document.body.appendChild(overlay);
  }

  function openLoginSheet(supabase, adresse) {
    if (!window.MahoutoLogin) return;
    window.MahoutoLogin.open({
      doc: document, win: window, supabase: supabase,
      redirectPath: "m/" + adresse,
      title: "Se connecter pour signaler une page",
      onSignedIn: async function (u) {
        if (u && window.MahoutoPseudo) { try { await window.MahoutoPseudo.ensureProfileForUser(supabase, u); } catch (e) { /* profil créé plus tard */ } }
        window.location.reload();
      }
    });
  }

  async function setupReport(supabase, row, adresse, view) {
    var user = await currentUser(supabase), isOwner = false;
    if (user) {
      try { var mien = firstRow((await supabase.rpc("profil_public_mien")).data); isOwner = !!mien && mien.id === row.id; } catch (e) { isOwner = false; }
    }
    var ui = PU.reportUi({ view: view.view, banner: view.banner, preview: false, connected: !!user, isOwner: isOwner });
    if (ui === "aucun") return;
    show("signalement-zone", true);
    var btn = ui === "bouton" ? $("btn-signaler") : $("btn-connexion-signaler");
    show(btn.id, true);
    btn.addEventListener("click", function () { if (ui === "bouton") openReportSheet(supabase, adresse); else openLoginSheet(supabase, adresse); });
  }

  function firstRow(data) { return Array.isArray(data) && data.length && data[0] && typeof data[0] === "object" ? data[0] : null; }

  // Aperçu : seulement si une session existe (les fonctions du propriétaire et des administrateurs refusent les visiteurs).
  // Propriétaire : profil_public_mien ; administrateur : profils_publics_admin_lire. Un échec ou un refus n'est pas une erreur.
  async function previewRow(supabase, adresse) {
    if (!(await currentUser(supabase))) return null;
    try {
      var mien = firstRow((await supabase.rpc("profil_public_mien")).data);
      if (mien && mien.adresse === adresse) return mien;
    } catch (e) { /* pas d'aperçu */ }
    try {
      var adm = await supabase.rpc("profils_publics_admin_lire", { p_adresse: adresse });
      if (!adm.error) return firstRow(adm.data);
    } catch (e) { /* pas d'aperçu */ }
    return null;
  }

  async function init() {
    if (!PU || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") { showState("erreur"); return; }
    var adresse = PU.addressFromLocation(window.location.pathname, window.location.search);
    if (!adresse) { showState("introuvable"); return; }
    var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    try {
      var read = await supabase.rpc("profil_public_lire", { p_adresse: adresse });
      if (read.error) { showState("erreur"); return; }
      var row = firstRow(read.data), preview = false, ouvert = true, statut = null;
      if (!row) {
        row = await previewRow(supabase, adresse);
        if (row) {
          preview = true;
          var o = await supabase.rpc("profils_publics_ouvert");
          ouvert = !o.error && o.data === true;
        } else {
          var s = await supabase.rpc("profil_public_statut", { p_adresse: adresse });
          if (s.error) { showState("erreur"); return; }
          statut = typeof s.data === "string" ? s.data : null;
        }
      }
      var v = PU.pageView({ row: row, preview: preview, ouvert: ouvert, statut: statut, readFailed: false });
      if (v.view === "profil") {
        renderProfil(row, v.banner);
        // Comptage anonyme : seulement pour une page réellement publique (ni aperçu propriétaire ou administrateur, ni bandeau).
        if (!preview && !v.banner) countVisit();
        // Le signalement est facultatif : un échec ici ne doit jamais masquer la page.
        if (!preview) { try { await setupReport(supabase, row, adresse, v); } catch (e) { /* page affichée sans signalement */ } }
      } else showState(v.view);
    } catch (e) { showState("erreur"); }
  }
  init();
})();
