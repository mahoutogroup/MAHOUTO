/* =========================================================
   profil-visiteurs.js — profil.html : réglage « Montrer mon nom quand je consulte la carte d'un membre » et liste « Qui a vu ma carte ».

   - OPT-IN : l'interrupteur est désactivé par défaut. L'état vient de profil_public_visiteur_reglage_lire() ; il s'écrit par
     profil_public_visiteur_reglage_ecrire(actif). Désactiver EFFACE l'historique du membre côté base (rien à faire ici).
   - Liste : profil_public_visiteurs_lister() (nom, adresse publique si publiée, nombre de visites, jour du dernier passage).
     Aucun identifiant de compte, aucune heure, aucun e-mail n'arrive jamais jusqu'ici. Si l'interrupteur est désactivé,
     la liste n'est PAS demandée : seule l'invitation à l'activer s'affiche (aucun nombre de visiteurs).
   - Membre non connecté ou compte anonyme : la section reste masquée. Fonction absente (SQL pas encore exécuté) : message neutre.
   - Aucun innerHTML : createElement / textContent. Aucun journal console de données.
   - Module UMD : les fonctions pures sont testées sans navigateur (tests/profils-publics-visiteurs.test.js).
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProfilVisiteurs = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var MAX_LIGNES = 100;

  /** Adresse de page publique valide (mêmes règles que la base) ; sinon null. */
  function adresseValide(a) { return typeof a === "string" && /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(a) ? a : null; }

  /** « 12 novembre 2026 » depuis « 2026-11-12 » ; « — » si invalide. */
  function formatJour(jour) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jour || ""));
    if (!m) return "—";
    var mois = Number(m[2]), jr = Number(m[3]);
    if (mois < 1 || mois > 12 || jr < 1 || jr > 31) return "—";
    return jr + (jr === 1 ? "er " : " ") + MOIS[mois - 1] + " " + m[1];
  }

  function libelleVisites(n) { return n + (n > 1 ? " visites" : " visite"); }

  /**
   * Lignes de profil_public_visiteurs_lister() nettoyées : { nom, adresse (ou null), visites, jour }.
   * Une ligne sans nom lisible est écartée ; tout champ inattendu est ignoré (jamais recopié).
   */
  function nettoyerLignes(data) {
    var out = [];
    (Array.isArray(data) ? data : []).forEach(function (r) {
      if (!r || typeof r !== "object" || out.length >= MAX_LIGNES) return;
      var nom = typeof r.nom === "string" ? Array.from(r.nom.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 60).join("") : "";
      if (!nom) return;
      var n = Math.floor(Number(r.nb_visites));
      out.push({ nom: nom, adresse: adresseValide(r.adresse), visites: isFinite(n) && n > 0 ? Math.min(n, 9999) : 1, jour: String(r.dernier_jour || "").slice(0, 10) });
    });
    return out;
  }

  /** Quelle partie de la section afficher : masque | indisponible | invitation | liste. */
  function etatSection(o) {
    if (!o || !o.connecte) return "masque";
    if (o.indisponible) return "indisponible";
    return o.actif === true ? "liste" : "invitation";
  }

  var api = { adresseValide: adresseValide, formatJour: formatJour, libelleVisites: libelleVisites, nettoyerLignes: nettoyerLignes, etatSection: etatSection, MAX_LIGNES: MAX_LIGNES };

  // ---------- Page profil.html ----------
  var doc = typeof document !== "undefined" ? document : null;
  var section = doc ? doc.getElementById("pv-section") : null;
  var cfg = typeof window !== "undefined" ? window.MAHOUTO_CONFIG : null;
  if (!section || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") return api;

  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var $ = function (id) { return doc.getElementById(id); };
  var busy = false;

  function show(id, on) { $(id).classList.toggle("hidden", !on); }
  function say(text, isError) { var e = $("pv-etat"); e.textContent = text || ""; e.classList.toggle("erreur", !!isError); show("pv-etat", !!text); }

  function renderListe(rows) {
    var list = $("pv-liste");
    list.textContent = "";
    rows.forEach(function (r) {
      var li = doc.createElement("li"), nom;
      if (r.adresse) {
        nom = doc.createElement("a");
        nom.className = "pv-nom";
        nom.setAttribute("href", "/m/" + encodeURIComponent(r.adresse));
        nom.setAttribute("rel", "noopener");
      } else { nom = doc.createElement("span"); nom.className = "pv-nom"; }
      nom.textContent = r.nom;
      var info = doc.createElement("span");
      info.className = "pv-info";
      info.textContent = libelleVisites(r.visites) + " · dernier passage le " + formatJour(r.jour);
      li.appendChild(nom); li.appendChild(info); list.appendChild(li);
    });
    show("pv-vide", rows.length === 0);
    show("pv-liste", rows.length > 0);
  }

  async function chargerListe() {
    var res = await supabase.rpc("profil_public_visiteurs_lister");
    if (res.error || !Array.isArray(res.data)) { renderListe([]); say("La liste n'a pas pu être chargée. Réessayez dans un instant.", true); return; }
    renderListe(nettoyerLignes(res.data));
  }

  function appliquer(actif) {
    var etat = etatSection({ connecte: true, actif: actif });
    $("pv-switch").checked = actif === true;
    show("pv-invitation", etat === "invitation");
    show("pv-liste-zone", etat === "liste");
  }

  function indisponible() {
    $("pv-switch").disabled = true;
    show("pv-invitation", false); show("pv-liste-zone", false);
    say("Cette fonction n'est pas encore disponible. Revenez plus tard.", true);
  }

  async function basculer() {
    if (busy) return;
    busy = true;
    var wanted = $("pv-switch").checked;
    $("pv-switch").disabled = true;
    say("", false);
    var stored = null;
    try { var r = await supabase.rpc("profil_public_visiteur_reglage_ecrire", { p_actif: wanted }); stored = r.error ? null : r.data; } catch (e) { stored = null; }
    if (stored === wanted) {
      appliquer(wanted);
      if (wanted) { try { await chargerListe(); } catch (e) { renderListe([]); } }
      else say("Réglage désactivé : votre historique de visites a été effacé.", false);
    } else {
      $("pv-switch").checked = !wanted;
      say("Le réglage n'a pas pu être enregistré. Réessayez dans un instant.", true);
    }
    $("pv-switch").disabled = false;
    busy = false;
  }

  async function init() {
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    var u = session && session.user ? session.user : null;
    var anon = !!u && (u.is_anonymous === true || (u.app_metadata && u.app_metadata.provider === "anonymous"));
    if (etatSection({ connecte: !!u && !anon }) === "masque") return;
    section.classList.remove("hidden");
    $("pv-switch").addEventListener("change", basculer);
    var actif = null;
    try { var r = await supabase.rpc("profil_public_visiteur_reglage_lire"); actif = r.error || typeof r.data !== "boolean" ? null : r.data; } catch (e) { actif = null; }
    if (actif === null) { indisponible(); return; }
    appliquer(actif);
    if (actif) { try { await chargerListe(); } catch (e) { renderListe([]); } }
  }
  init();
  return api;
});
