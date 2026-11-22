/* =========================================================
   m.js — m.html : page publique d'un membre, adresse /m/<adresse> (PR 1 sur 3 du profil public). LECTURE SEULE.

   - Lecture de la ligne par ses colonnes PUBLIQUES seulement (id, adresse, nom_affiche, avatar_url, metier, presentation,
     localisation, contact_type, contact_valeur, publie) : la base n'expose jamais l'identifiant du compte, la déclaration de
     majorité ni la suspension. Un visiteur ne reçoit une ligne que si la page est publiée, non suspendue ET la fonction ouverte.
   - Sinon, l'état est donné par la fonction publique profil_public_statut : introuvable / non disponible / non ouverte.
   - La personne propriétaire et les administrateurs voient la page même non publiée ou fonction fermée (aperçu avec bandeau).
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
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.loading = "lazy";
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

  async function init() {
    if (!PU || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") { showState("erreur"); return; }
    var adresse = PU.addressFromLocation(window.location.pathname, window.location.search);
    if (!adresse) { showState("introuvable"); return; }
    var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    try {
      var read = await supabase.from("profils_publics")
        .select("id, adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie")
        .eq("adresse", adresse).maybeSingle();
      if (read.error) { showState("erreur"); return; }
      var row = read.data || null, ouvert = false, statut = null;
      if (row) {
        var o = await supabase.rpc("profils_publics_ouvert");
        ouvert = !o.error && o.data === true;
      } else {
        var s = await supabase.rpc("profil_public_statut", { p_adresse: adresse });
        if (s.error) { showState("erreur"); return; }
        statut = typeof s.data === "string" ? s.data : null;
      }
      var v = PU.pageView({ row: row, ouvert: ouvert, statut: statut, readFailed: false });
      if (v.view === "profil") renderProfil(row, v.banner); else showState(v.view);
    } catch (e) { showState("erreur"); }
  }
  init();
})();
