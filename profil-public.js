/* =========================================================
   profil-public.js — profil.html : section « Mon profil public » (PR 1 sur 3 du profil public).

   - Activation VOLONTAIRE : rien n'est publié par défaut. Pour publier, le membre certifie avoir 18 ans ou plus (déclaration
     enregistrée en base ; la base l'exige pour toute page publiée).
   - Photo : choisie dans le téléphone (JPEG, PNG ou WebP, 5 Mo au maximum, contrôlé AVANT l'envoi), envoyée comme la photo de
     profil existante : GET /api/attachment?filename=…&context=avatar avec le jeton de session, puis envoi vers Cloudinary avec
     la signature reçue. L'URL https://res.cloudinary.com/… reçue remplit le champ en lecture seule ; elle n'est enregistrée
     qu'avec la page (même flux que les autres champs). Jamais reprise automatiquement de la photo du compte.
   - Champs publics : adresse, nom affiché, photo (lien https), métier, présentation, pays ou ville, et AU PLUS UN contact
     (WhatsApp au format international, ou lien https). Jamais demandé ni affiché : nom légal complet, e-mail, rôle.
   - Lecture de SA ligne par la fonction profil_public_mien() ; enregistrement par insertion / mise à jour de la table
     profils_publics (la base garde la forme, l'adresse figée après la première publication, la suspension réservée aux admins).
   - Aucun innerHTML : createElement / textContent. Aucun journal console de données saisies.
   ========================================================= */
(function () {
  "use strict";
  var PU = window.ProfilPublicUtils, cfg = window.MAHOUTO_CONFIG;
  var section = document.getElementById("pp-section");
  if (!section || !PU || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") return;
  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var $ = function (id) { return document.getElementById(id); };
  var row = null, busy = false, ouvert = false;

  function setStatus(msg, isError) {
    var s = $("pp-etat");
    s.textContent = msg || "";
    s.classList.toggle("hidden", !msg);
    s.classList.toggle("error", !!isError);
  }
  function showErrors(errors) {
    ["adresse", "nom", "avatar", "metier", "presentation", "localisation", "contact", "majeur"].forEach(function (k) {
      var e = $("pp-e-" + k);
      if (e) e.textContent = errors[k] || "";
    });
  }
  function readForm(publier) {
    return {
      adresse: $("pp-adresse").value, nom: $("pp-nom").value, avatar: $("pp-avatar").value, metier: $("pp-metier").value,
      presentation: $("pp-presentation").value, localisation: $("pp-localisation").value,
      contactType: $("pp-contact-type").value, contactValeur: $("pp-contact-valeur").value,
      publier: publier === true, majeur: $("pp-majeur").checked
    };
  }
  function fillForm() {
    var r = row || {};
    $("pp-adresse").value = r.adresse || "";
    $("pp-nom").value = r.nom_affiche || "";
    $("pp-avatar").value = r.avatar_url || "";
    renderPhoto();
    $("pp-metier").value = r.metier || "";
    $("pp-presentation").value = r.presentation || "";
    $("pp-localisation").value = r.localisation || "";
    $("pp-contact-type").value = r.contact_type || "";
    $("pp-contact-valeur").value = r.contact_valeur || "";
    $("pp-majeur").checked = r.majeur_declare === true;
    $("pp-avatar-etat").textContent = "";
    refreshView();
  }

  // Aperçu rond de la photo choisie (img créée par DOM, lien https contrôlé) ; repli sur la lettre initiale si l'image ne charge pas.
  function renderPhoto() {
    var box = $("pp-avatar-apercu"), url = PU.safeHttpsUrl($("pp-avatar").value, PU.LIMITS.avatar);
    box.textContent = "";
    if (url) {
      var img = document.createElement("img");
      img.setAttribute("alt", "");
      img.setAttribute("referrerpolicy", "no-referrer");
      img.addEventListener("error", function () { box.textContent = initial(); });
      img.setAttribute("src", url);
      box.appendChild(img);
    } else box.textContent = initial();
    $("pp-btn-photo-retirer").classList.toggle("hidden", !url);
    $("pp-btn-photo").textContent = url ? "Changer la photo" : "Choisir une photo";
  }
  function initial() { var c = Array.from(String($("pp-nom").value || "").trim())[0]; return c ? c.toUpperCase() : "?"; }
  function setPhotoStatus(msg, isError) {
    var s = $("pp-avatar-etat");
    s.textContent = msg || "";
    s.classList.toggle("ok", !!msg && !isError);
  }

  // Téléversement : même mécanisme que le changement de photo de profil (profil.html). Le nom d'origine du fichier n'est jamais envoyé.
  async function uploadPhoto(file) {
    var check = PU.validateAvatarFile(file);
    if (!check.ok) { setPhotoStatus(check.error, true); return; }
    if (busy) return;
    busy = true; setButtons(true);
    setPhotoStatus("Envoi de la photo…", false);
    try {
      var sessionData = (await supabase.auth.getSession()).data;
      var token = sessionData && sessionData.session ? sessionData.session.access_token : null;
      if (!token) throw new Error("Reconnectez-vous puis réessayez.");
      var query = new URLSearchParams({ filename: PU.avatarFilename(check.ext), context: "avatar" });
      var signResp = await fetch("/api/attachment?" + query.toString(), { headers: { "Authorization": "Bearer " + token } });
      var sign = await signResp.json();
      if (!signResp.ok) throw new Error(sign && sign.error ? sign.error : "Signature indisponible");
      var form = new FormData();
      form.append("file", file);
      form.append("api_key", sign.apiKey);
      form.append("timestamp", sign.timestamp);
      form.append("signature", sign.signature);
      form.append("folder", sign.folder);
      var upResp = await fetch(sign.uploadUrl, { method: "POST", body: form });
      var up = await upResp.json();
      if (!upResp.ok) throw new Error(up && up.error && up.error.message ? up.error.message : "Envoi échoué");
      var url = PU.cloudinaryImageUrl(up && up.secure_url);
      if (!url) throw new Error("Réponse inattendue de l'envoi.");
      $("pp-avatar").value = url;
      renderPhoto();
      setPhotoStatus("Photo prête : enregistrez votre page pour l'utiliser.", false);
    } catch (e) {
      // Le formulaire (y compris l'ancienne photo) reste intact.
      setPhotoStatus("L'envoi de la photo a échoué : " + (e && e.message ? e.message : "réessayez dans un instant."), true);
    } finally { busy = false; setButtons(false); }
  }
  // L'adresse ne se modifie plus une fois la page publiée ; la base l'impose aussi (même après une dépublication).
  function refreshView() {
    var published = !!(row && row.publie);
    $("pp-adresse").disabled = published;
    $("pp-btn-publier").classList.toggle("hidden", published);
    $("pp-btn-depublier").classList.toggle("hidden", !published);
    $("pp-btn-enregistrer").textContent = published ? "Enregistrer les modifications" : "Enregistrer le brouillon";
    $("pp-statut").textContent = published ? "Votre page est publiée." : (row ? "Brouillon : votre page n'est pas publiée." : "Aucune page pour le moment : rien n'est publié.");
    var has = !!(row && row.adresse);
    $("pp-liens").classList.toggle("hidden", !has);
    if (has) $("pp-lien-texte").textContent = PU.publicUrl(row.adresse);
    $("pp-compteur").textContent = PU.countChars($("pp-presentation").value) + " / " + PU.LIMITS.presentation;
    $("pp-note-ferme").classList.toggle("hidden", ouvert);
  }

  async function load() {
    var o = await supabase.rpc("profils_publics_ouvert");
    ouvert = !o.error && o.data === true;
    var res = await supabase.rpc("profil_public_mien");
    if (res.error) { setStatus("Impossible de charger votre page pour le moment (le SQL du profil public est-il exécuté ?).", true); row = null; fillForm(); return; }
    row = Array.isArray(res.data) && res.data.length ? res.data[0] : null;
    fillForm();
  }

  // Enregistre. publier : true = publier, false = brouillon / dépublier. Une page déjà publiée le reste (« Enregistrer »).
  async function save(publier) {
    if (busy) return;
    setStatus("", false);
    var check = PU.validateProfil(readForm(publier));
    showErrors(check.ok ? {} : check.errors);
    if (!check.ok) { setStatus("Corrigez les champs signalés en rouge.", true); return; }
    busy = true; setButtons(true);
    setStatus("Enregistrement…", false);
    try {
      var value = check.value;
      var q = row
        ? await supabase.from("profils_publics").update(value).eq("id", row.id)
        : await supabase.from("profils_publics").insert(value);
      if (q.error) { setStatus(PU.errorMessage(q.error), true); return; }
      await load();
      setStatus(publier ? "Votre page est publiée." : (row && row.publie ? "Modifications enregistrées." : "Brouillon enregistré. Votre page n'est pas publiée."), false);
    } catch (e) {
      setStatus(PU.errorMessage(e), true);
    } finally { busy = false; setButtons(false); }
  }
  function setButtons(disabled) {
    ["pp-btn-enregistrer", "pp-btn-publier", "pp-btn-depublier", "pp-btn-verifier", "pp-btn-photo", "pp-btn-photo-retirer"].forEach(function (id) { $(id).disabled = disabled; });
  }

  async function verifier() {
    var local = PU.validateAdresse($("pp-adresse").value);
    var msg = $("pp-adresse-etat");
    msg.classList.remove("ok");
    if (!local.ok) { msg.textContent = local.error; return; }
    msg.textContent = "Vérification…";
    var r = await supabase.rpc("profil_public_adresse_disponible", { p_adresse: local.value });
    var m = PU.disponibiliteMessage(r.error ? null : r.data);
    msg.textContent = m.text;
    msg.classList.toggle("ok", m.ok);
  }

  async function copier() {
    if (!row || !row.adresse) return;
    var text = PU.publicUrl(row.adresse), ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try {
        var tmp = document.createElement("textarea");
        tmp.value = text; tmp.setAttribute("readonly", ""); tmp.style.position = "fixed"; tmp.style.opacity = "0";
        document.body.appendChild(tmp); tmp.select(); ok = document.execCommand("copy"); document.body.removeChild(tmp);
      } catch (e2) { ok = false; }
    }
    $("pp-btn-copier").textContent = ok ? "Lien copié ✓" : "Copie impossible";
    setTimeout(function () { $("pp-btn-copier").textContent = "Copier le lien"; }, 2500);
  }

  async function init() {
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    var user = session && session.user && session.user.is_anonymous !== true && !(session.user.app_metadata && session.user.app_metadata.provider === "anonymous") ? session.user : null;
    if (!user) return;   // visiteur non connecté ou compte anonyme : la section reste masquée
    section.classList.remove("hidden");
    $("pp-btn-enregistrer").addEventListener("click", function () { save(row ? row.publie === true : false); });
    $("pp-btn-publier").addEventListener("click", function () { save(true); });
    $("pp-btn-depublier").addEventListener("click", function () { if (confirm("Dépublier votre page ? Elle ne sera plus visible, vous pourrez la republier à tout moment.")) save(false); });
    $("pp-btn-verifier").addEventListener("click", verifier);
    $("pp-btn-photo").addEventListener("click", function () { if (!busy) $("pp-avatar-fichier").click(); });
    $("pp-avatar-fichier").addEventListener("change", function () {
      var f = $("pp-avatar-fichier").files && $("pp-avatar-fichier").files[0] ? $("pp-avatar-fichier").files[0] : null;
      $("pp-avatar-fichier").value = "";
      if (f) uploadPhoto(f);
    });
    $("pp-btn-photo-retirer").addEventListener("click", function () {
      $("pp-avatar").value = "";
      renderPhoto();
      setPhotoStatus("Photo retirée : enregistrez votre page pour confirmer.", false);
    });
    $("pp-nom").addEventListener("input", function () { if (!$("pp-avatar").value) renderPhoto(); });
    $("pp-btn-copier").addEventListener("click", copier);
    $("pp-presentation").addEventListener("input", function () { $("pp-compteur").textContent = PU.countChars($("pp-presentation").value) + " / " + PU.LIMITS.presentation; });
    $("pp-apercu").addEventListener("click", function () { if (row && row.adresse) window.open("/m/" + encodeURIComponent(row.adresse), "_blank", "noopener"); });
    await load();
  }
  init();
})();
