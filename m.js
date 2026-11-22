/* =========================================================
   m.js — m.html : page publique d'un membre, adresse /m/<adresse> (PR 1 sur 3 du profil public). LECTURE SEULE.

   - Le visiteur ne lit JAMAIS la table : il appelle la fonction profil_public_lire(adresse), qui renvoie au plus UNE ligne
     (colonnes publiques : id, adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type,
     contact_valeur) si la page est publiée, non suspendue ET la fonction ouverte. Aucune liste, aucune recherche partielle ;
     jamais l'identifiant du compte, la déclaration de majorité ni la suspension.
   - Sans ligne : aperçu pour la personne propriétaire (profil_public_mien) ou un administrateur (profils_publics_admin_lire),
     par fonctions, toujours sans lire la table ; sinon l'état vient de profil_public_statut : introuvable / non disponible / non ouverte.
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

  function firstRow(data) { return Array.isArray(data) && data.length && data[0] && typeof data[0] === "object" ? data[0] : null; }

  // Aperçu : seulement si une session existe (les fonctions du propriétaire et des administrateurs refusent les visiteurs).
  // Propriétaire : profil_public_mien ; administrateur : profils_publics_admin_lire. Un échec ou un refus n'est pas une erreur.
  async function previewRow(supabase, adresse) {
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    if (!session) return null;
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
      if (v.view === "profil") renderProfil(row, v.banner); else showState(v.view);
    } catch (e) { showState("erreur"); }
  }
  init();
})();
