/* =========================================================
   m.js — m.html : page publique d'un membre, adresse /m/<adresse> (PR 1 sur 3 du profil public). LECTURE SEULE.

   - Le visiteur ne lit JAMAIS la table : il appelle la fonction profil_public_lire(adresse), qui renvoie au plus UNE ligne
     (colonnes publiques : id, adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type,
     contact_valeur) si la page est publiée, non suspendue ET la fonction ouverte. Aucune liste, aucune recherche partielle ;
     jamais l'identifiant du compte, la déclaration de majorité ni la suspension.
   - Sans ligne : aperçu pour la personne propriétaire (profil_public_mien) ou un administrateur (profils_publics_admin_lire),
     par fonctions, toujours sans lire la table ; sinon l'état vient de profil_public_statut : introuvable / non disponible / non ouverte.
   - Écrire un message : seulement si le propriétaire l'a autorisé (profil_public_messages_ouverts) et sur une page réellement
     publique. Membre connecté non propriétaire : bouton « Écrire un message » (profil_public_ecrire renvoie un code et
     l'identifiant de la CONVERSATION, jamais l'identifiant du compte) puis dm-chat.html?conv=…&name=… SANS « with » ;
     visiteur non connecté : « Connectez-vous pour écrire à cette personne ». Aucun select, aucun journal console.
   - Signalement (PR 2 sur 3) : bouton « Signaler cette page » pour un membre connecté qui n'est PAS le propriétaire (reconnu par
     profil_public_mien) et seulement sur une page réellement publique (jamais dans l'aperçu) ; visiteur non connecté : texte
     « Connectez-vous pour signaler cette page » (fenêtre de connexion). Envoi par la fonction profil_public_signaler (aucun
     accès direct à la table, aucun select après l'appel, aucun journal console).
   - Carte de visite (refonte du design) : en-tête de marque, bandeau de couverture en CSS pur, avatar rond, action principale
     (WhatsApp : le numéro n'est JAMAIS affiché, le lien wa.me suffit ; lien https : seulement le domaine), « Écrire un message »
     (règles inchangées), « Partager » (feuille basse : QR avec ?src=qr, lien copié SANS ?src=, partage natif, QR en PNG 1024 px ;
     qrcode-generator.js n'est chargé qu'à son ouverture), pied « Une plateforme MAHOUTO+, par MAJESTÉ PRESSE » (texte fixe, identique sur les deux sites : data-brand-fixed, jamais fonction de la marque). Aucune requête réseau nouvelle.
   - Tout est affiché en TEXTE BRUT (createElement / textContent) : aucun innerHTML. Seuls liens autorisés : https (photo,
     lien de contact) et wa.me (WhatsApp), ouverts avec rel noopener noreferrer nofollow.
   ========================================================= */
(function () {
  "use strict";
  var PU = window.ProfilPublicUtils, cfg = window.MAHOUTO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  function show(id, on) { $(id).classList.toggle("hidden", !on); }

  var brand = window.MAHOUTO_BRAND || {};
  var BRAND_NAME = typeof brand.name === "string" && brand.name ? brand.name : "MAHOUTO+";

  // Logo de la marque en petit format (128 px, environ 20 Ko) : jamais le grand fichier (300 Ko) sur une page vue en 4G lente.
  function smallLogo() {
    var f = typeof brand.logo === "string" && /^assets\/[a-z0-9-]+\.png$/.test(brand.logo) ? brand.logo : "assets/logo-mahouto-plus.png";
    return "/" + f.replace(/\.png$/, "-128.png");
  }

  var ICONS = { whatsapp: "i-chat", lien: "i-lien" };
  // Icône SVG en ligne du lot de symboles de m.html (trait de 1,75 px) ; sans createElementNS, pas d'icône (le texte suffit).
  function icon(name) {
    if (!document.createElementNS) return null;
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use");
    svg.setAttribute("class", "ic"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    use.setAttribute("href", "#" + name);
    svg.appendChild(use);
    return svg;
  }

  function showState(key) {
    var k = PU.MESSAGES[key] ? key : "introuvable";
    show("chargement", false); show("profil", false);
    $("etat-titre").textContent = PU.MESSAGES[k];
    $("etat").setAttribute("data-etat", k);
    var retry = $("btn-reessayer");
    show("btn-reessayer", k === "erreur");
    if (k === "erreur" && !retry.getAttribute("data-pret")) {
      retry.setAttribute("data-pret", "1");
      retry.addEventListener("click", function () { window.location.reload(); });
    }
    show("etat", true);
  }

  function setText(id, text, wrapId) {
    var n = $(id), w = $(wrapId || id);
    if (text) { n.textContent = text; w.classList.remove("hidden"); } else { n.textContent = ""; w.classList.add("hidden"); }
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
      img.setAttribute("decoding", "async");
      img.addEventListener("error", function () { box.textContent = PU.initialOf(row.nom_affiche); });
      img.src = url;
      box.appendChild(img);
    } else box.textContent = PU.initialOf(row.nom_affiche);
  }

  // Action principale : bouton plein or. WhatsApp : seul le lien wa.me porte le numéro (jamais affiché) ; lien : seulement le domaine.
  function renderContact(row) {
    var zone = $("contact-zone");
    zone.textContent = "";
    var act = PU.contactAction(row);
    if (!act) return;
    var a = document.createElement("a");
    a.className = "btn btn-or";
    a.href = act.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    a.setAttribute("aria-label", act.kind === "whatsapp" ? act.label + " (s'ouvre dans un nouvel onglet)" : act.label + " : " + act.domain + " (s'ouvre dans un nouvel onglet)");
    var ic = icon(ICONS[act.kind]);
    if (ic) a.appendChild(ic);
    var txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = act.label;
    if (act.domain) {
      var sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = act.domain;
      txt.appendChild(sub);
    }
    a.appendChild(txt);
    zone.appendChild(a);
  }

  function renderProfil(row, banner) {
    show("chargement", false); show("etat", false);
    $("nom").textContent = row.nom_affiche || "";
    document.title = (row.nom_affiche || "Profil") + " — " + BRAND_NAME;
    renderAvatar(row);
    setText("metier", row.metier);
    setText("lieu", row.localisation, "lieu-ligne");
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
    function onKey(e) { if (e.key === "Escape" && !busy) close(); else trapTab(sheet, e); }
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
    if (cancel.focus) cancel.focus();
  }

  // ---------- Partager cette page (feuille basse : QR code, copier, partager, enregistrer) ----------
  // qrcode-generator.js n'est chargé qu'à l'ouverture de la feuille (jamais au chargement de la page) ; aucun service externe.
  var qrLibPromise = null;
  function loadQrLib() {
    if (typeof window.qrcode === "function") return Promise.resolve();
    if (!qrLibPromise) qrLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.setAttribute("src", "/qrcode-generator.js");
      s.onload = function () { typeof window.qrcode === "function" ? resolve() : reject(new Error("qr")); };
      s.onerror = function () { qrLibPromise = null; reject(new Error("qr")); };
      document.body.appendChild(s);
    });
    return qrLibPromise;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var t = document.createElement("textarea");
        t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.focus(); t.setSelectionRange(0, text.length);
        var ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(t);
        ok ? resolve() : reject(new Error("copie"));
      } catch (e) { reject(e); }
    });
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.setAttribute("href", url); a.setAttribute("download", filename);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // Garde le focus clavier dans la feuille (Tab et Maj+Tab bouclent) ; sans effet si le navigateur ne sait pas lister les boutons.
  function trapTab(sheet, e) {
    if (e.key !== "Tab" || !sheet.querySelectorAll) return;
    var items = Array.prototype.filter.call(sheet.querySelectorAll("button, textarea, input, a[href]"), function (n) { return !n.disabled; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openShareSheet(row, adresse, opener) {
    if ($("sh-overlay")) return;
    var qr = null, qrReady = false, flashTimer = null;
    var title = PU.shareTitle(row.nom_affiche);
    var link = PU.shareLink(adresse);
    var status = mk("p", { class: "sh-etat", role: "status", "aria-live": "polite" });
    var tuile = mk("div", { class: "sh-tuile" }, [mk("span", { class: "sh-attente", text: "Préparation du QR code…" })]);
    var btnCopy = mk("button", { type: "button", class: "btn btn-or", id: "sh-copier" }, [mk("span", { text: "Copier le lien" })]);
    var btnShare = mk("button", { type: "button", class: "btn btn-neutre", id: "sh-partager" }, [mk("span", { text: "Partager" })]);
    var btnSave = mk("button", { type: "button", class: "btn btn-neutre", id: "sh-enregistrer", disabled: "" }, [mk("span", { text: "Enregistrer le QR" })]);
    var btnClose = mk("button", { type: "button", class: "sh-fermer", id: "sh-fermer", "aria-label": "Fermer" });
    var ci = icon("i-fermer"); if (ci) btnClose.appendChild(ci);
    [[btnCopy, "i-copier"], [btnShare, "i-partager"], [btnSave, "i-telecharger"]].forEach(function (p) { var i = icon(p[1]); if (i) p[0].insertBefore(i, p[0].firstChild); });
    if (!(navigator.share && typeof navigator.share === "function")) btnShare.classList.add("hidden");
    var overlay = mk("div", { id: "sh-overlay" });
    var heading = mk("h2", { id: "sh-titre", text: title });
    var sheet = mk("div", { class: "sh-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "sh-titre" });
    sheet.appendChild(mk("div", { class: "sh-tete" }, [heading, btnClose]));
    sheet.appendChild(tuile);
    sheet.appendChild(mk("p", { class: "sh-scan", text: "Scannez pour ouvrir la page" }));
    sheet.appendChild(mk("p", { class: "sh-lien", id: "sh-lien", text: link ? link.replace(/^https:\/\//, "") : "" }));
    sheet.appendChild(mk("div", { class: "sh-actions" }, [btnCopy, btnShare, btnSave]));
    sheet.appendChild(status);
    overlay.appendChild(sheet);

    function say(text, isError) { status.textContent = text; status.className = "sh-etat" + (isError ? " sh-erreur" : ""); }
    function close() {
      if (flashTimer) clearTimeout(flashTimer);
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opener && opener.focus) opener.focus();
    }
    function onKey(e) { if (e.key === "Escape") close(); else trapTab(sheet, e); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    btnClose.addEventListener("click", close);
    document.addEventListener("keydown", onKey);

    btnCopy.addEventListener("click", async function () {
      if (!link) return;
      var label = btnCopy.querySelector ? btnCopy.querySelector("span") : null;
      try {
        await copyText(link);
        say("Lien copié", false);
        if (label) { label.textContent = "Lien copié"; if (flashTimer) clearTimeout(flashTimer); flashTimer = setTimeout(function () { label.textContent = "Copier le lien"; }, 2200); }
      } catch (e) { say("Copie impossible : touchez le lien ci-dessus pour le sélectionner.", true); }
    });
    btnShare.addEventListener("click", async function () {
      var payload = PU.sharePayload(row.nom_affiche, adresse, BRAND_NAME);
      if (!payload) return;
      try { await navigator.share(payload); } catch (e) { /* partage annulé par la personne : ce n'est pas une erreur */ }
    });
    btnSave.addEventListener("click", function () {
      var name = PU.qrFilename(adresse, "png");
      if (!qrReady || !qr || !name) return;
      try {
        var L = PU.qrLayout(qr.getModuleCount(), PU.QR_MIN_PX), canvas = document.createElement("canvas");
        canvas.width = L.px; canvas.height = L.px;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, L.px, L.px);
        PU.paintQr(ctx, qr, L, 0, 0);
        canvas.toBlob(function (blob) {
          if (!blob) { say("L'enregistrement a échoué. Réessayez.", true); return; }
          downloadBlob(blob, name);
          say("QR code enregistré (" + L.px + " × " + L.px + " px).", false);
        }, "image/png");
      } catch (e) { say("L'enregistrement a échoué. Réessayez.", true); }
    });

    document.body.appendChild(overlay);
    if (btnClose.focus) btnClose.focus();

    loadQrLib().then(function () {
      qr = PU.makeQr(window.qrcode, adresse);
      if (!qr) throw new Error("qr");
      tuile.textContent = "";
      tuile.appendChild(PU.qrSvgNode(document, qr, "QR code de la page de " + (PU.cleanLine(row.nom_affiche, 60) || "ce membre")));
      qrReady = true;
      btnSave.disabled = false;
      if (btnSave.removeAttribute) btnSave.removeAttribute("disabled");
    }).catch(function () {
      tuile.textContent = "";
      tuile.appendChild(mk("span", { class: "sh-attente", text: "Le QR code n'a pas pu être préparé." }));
      say("Le QR code n'a pas pu être préparé. Le lien reste disponible.", true);
    });
  }

  function setupShare(row, adresse) {
    var btn = $("btn-partager");
    btn.addEventListener("click", function () { openShareSheet(row, adresse, btn); });
  }

  function openLoginSheet(supabase, adresse, title) {
    if (!window.MahoutoLogin) return;
    window.MahoutoLogin.open({
      doc: document, win: window, supabase: supabase,
      redirectPath: "m/" + adresse,
      title: title || "Se connecter pour signaler une page",
      onSignedIn: async function (u) {
        if (u && window.MahoutoPseudo) { try { await window.MahoutoPseudo.ensureProfileForUser(supabase, u); } catch (e) { /* profil créé plus tard */ } }
        window.location.reload();
      }
    });
  }

  // Propriétaire de la page ? (reconnu par sa propre page, jamais par un identifiant) ; résultat gardé pour les deux blocs.
  var ownerCache;
  async function isOwnerOf(supabase, row, user) {
    if (!user) return false;
    if (ownerCache !== undefined) return ownerCache;
    try { var mien = firstRow((await supabase.rpc("profil_public_mien")).data); ownerCache = !!mien && mien.id === row.id; } catch (e) { ownerCache = false; }
    return ownerCache;
  }

  async function setupReport(supabase, row, adresse, view) {
    var user = await currentUser(supabase), isOwner = await isOwnerOf(supabase, row, user);
    var ui = PU.reportUi({ view: view.view, banner: view.banner, preview: false, connected: !!user, isOwner: isOwner });
    if (ui === "aucun") return;
    show("signalement-zone", true);
    var btn = ui === "bouton" ? $("btn-signaler") : $("btn-connexion-signaler");
    show(btn.id, true);
    btn.addEventListener("click", function () { if (ui === "bouton") openReportSheet(supabase, adresse); else openLoginSheet(supabase, adresse); });
  }

  // ---------- Écrire un message ----------
  async function setupMessages(supabase, row, adresse, view) {
    var res = await supabase.rpc("profil_public_messages_ouverts", { p_adresse: adresse });
    if (res.error || res.data !== true) return;
    var user = await currentUser(supabase), isOwner = await isOwnerOf(supabase, row, user);
    var ui = PU.messagesUi({ view: view.view, banner: view.banner, preview: false, connected: !!user, isOwner: isOwner, messagesOuverts: true });
    if (ui === "aucun") return;
    show("ecrire-zone", true);
    if (ui === "connexion") {
      show("btn-connexion-ecrire", true);
      $("btn-connexion-ecrire").addEventListener("click", function () { openLoginSheet(supabase, adresse, "Se connecter pour écrire à cette personne"); });
      return;
    }
    show("btn-ecrire", true); show("ecrire-aide", true);
    var btn = $("btn-ecrire"), busy = false;
    function say(text, isError) { var e = $("ecrire-etat"); e.textContent = text; e.classList.toggle("erreur", !!isError); show("ecrire-etat", !!text); }
    btn.addEventListener("click", async function () {
      if (busy) return;
      busy = true; btn.disabled = true; say("Ouverture de la conversation…", false);
      var out = null;
      try {
        var r = await supabase.rpc("profil_public_ecrire", { p_adresse: adresse });
        out = r.error ? null : firstRow(r.data);
      } catch (e) { out = null; }
      var code = out && typeof out.code === "string" ? out.code : null, msg = PU.ecrireMessage(code);
      var url = code === "ok" ? PU.dmUrl(out.conversation_id, row.nom_affiche) : null;
      if (url) { say(msg.text, false); window.location.href = url; return; }
      say(code === "ok" ? PU.ecrireMessage(null).text : msg.text, true);
      busy = false;
      // codes définitifs : inutile de réessayer tout de suite
      btn.disabled = code === "desactive" || code === "limite" || code === "propre_page" || code === "introuvable" || code === "ferme" || code === "invalide";
    });
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

  function setupBrand() {
    ["marque-logo", "cree-logo"].forEach(function (id) { var n = $(id); if (n) n.setAttribute("src", smallLogo()); });
  }

  async function init() {
    setupBrand();
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
        // « Partager » : toute page affichée (page publique, aperçu propriétaire ou administrateur : il montre ce qui sera partagé).
        setupShare(row, adresse);
        // Comptage anonyme : seulement pour une page réellement publique (ni aperçu propriétaire ou administrateur, ni bandeau).
        if (!preview && !v.banner) countVisit();
        // Le signalement est facultatif : un échec ici ne doit jamais masquer la page.
        if (!preview) { try { await setupReport(supabase, row, adresse, v); } catch (e) { /* page affichée sans signalement */ } }
        // « Écrire un message » est facultatif lui aussi : un échec ici ne masque jamais la page.
        if (!preview && !v.banner) { try { await setupMessages(supabase, row, adresse, v); } catch (e) { /* page affichée sans bouton d'écriture */ } }
      } else showState(v.view);
    } catch (e) { showState("erreur"); }
  }
  init();
})();
