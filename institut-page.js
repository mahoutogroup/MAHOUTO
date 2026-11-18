/* =========================================================
   institut-page.js — institut.html : textes modifiables depuis l'administration (table institut_contenus).

   - « Notre histoire » : remplacée par la valeur 'histoire' (paragraphes séparés par une ligne vide), affichée avec
     createElement / textContent — JAMAIS innerHTML (le texte vient d'un champ de saisie).
   - Si la lecture échoue (hors ligne, erreur) ou si le texte est vide : la page GARDE son texte statique d'origine.
   - Cadre « Projet en préparation » et bouton : si 'ouvert' vaut 'oui', le cadre disparaît et le bouton devient un lien
     vers institut-demande.html. Sinon (ou si la lecture échoue) : bouton grisé « Bientôt disponible », comme avant.
   - « En chiffres » : deux compteurs publics (institut_stats : places financées par des dons, élèves formés), SANS aucun nom.
     Si la lecture échoue, la section reste masquée.
   - « Un exemple de tarif » : quand la lecture réussit, le tableau statique est remplacé par la liste des formations
     actives (nom, prix Académie, prix Institut) ; sinon le tableau statique reste.
   Lecture publique seulement (aucune connexion nécessaire). Aucun journal console.
   ========================================================= */
(function () {
  "use strict";
  var U = window.InstitutUtils, P = window.InstitutPlaceUtils, cfg = window.MAHOUTO_CONFIG;
  if (!U || !P || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") return;   // page statique

  function applyHistoire(text) {
    var section = document.getElementById("histoire");
    var list = U.paragraphs(text);
    if (!section || !list.length) return;   // vide : on garde le texte d'origine
    Array.prototype.slice.call(section.querySelectorAll("p")).forEach(function (p) { p.remove(); });
    list.forEach(function (para) {
      var p = document.createElement("p");
      p.textContent = para;
      section.appendChild(p);
    });
  }

  function applyOuvert(value) {
    if (!U.isOpenValue(value)) return;      // 'non', absent ou lecture impossible : comportement d'origine
    var notice = document.getElementById("notice-prepa");
    if (notice) notice.remove();
    var zone = document.getElementById("cta-zone");
    if (!zone) return;
    zone.textContent = "";
    var link = document.createElement("a");
    link.className = "cta";
    link.href = "institut-demande.html";
    link.textContent = "Demander un parrainage";
    zone.appendChild(link);
  }

  function applyStats(row) {
    var section = document.getElementById("chiffres");
    if (!section || !row || !Number.isInteger(row.places_financees) || !Number.isInteger(row.eleves_formes)) return;
    document.getElementById("stat-places").textContent = String(row.places_financees);
    document.getElementById("stat-eleves").textContent = String(row.eleves_formes);
    section.hidden = false;
  }

  // Liste des formations actives à la place du tableau d'exemple (nom, prix Académie, prix Institut).
  function applyFormations(rows) {
    var choices = P.formationChoices(rows);
    var body = document.querySelector("#tarif-table tbody");
    if (!body || !choices.length) return;   // lecture vide ou impossible : tableau statique conservé
    body.textContent = "";
    choices.forEach(function (c) {
      var tr = document.createElement("tr");
      [[c.nom, ""], [c.prixAcademie ? U.formatFcfa(c.prixAcademie) : "—", "price"], [U.formatFcfa(c.prixInstitut), "price"]].forEach(function (cell) {
        var td = document.createElement("td");
        if (cell[1]) td.className = cell[1];
        td.textContent = cell[0];
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    var note = document.getElementById("note-exemple");
    if (note) note.remove();   // ce sont les vrais prix : ce n'est plus un exemple
  }

  var client;
  try { client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); } catch (e) { return; }
  client.from("institut_contenus").select("cle, valeur").then(function (res) {
    if (!res || res.error || !Array.isArray(res.data)) return;
    applyHistoire(U.contentValue(res.data, "histoire"));
    applyOuvert(U.contentValue(res.data, "ouvert"));
  }, function () { /* hors ligne : contenu d'origine */ });

  // Compteurs publics et formations : chaque lecture est indépendante et échoue en silence (la page reste complète).
  try {
    client.rpc("institut_stats").then(function (res) {
      if (!res || res.error || !Array.isArray(res.data)) return;
      applyStats(res.data[0]);
    }, function () { /* section masquée */ });
  } catch (e) { /* section masquée */ }
  try {
    client.from("institut_formations")
      .select("formation_id, prix_institut, ordre, formations(nom, prix, promotion)")
      .eq("actif", true).order("ordre", { ascending: true })
      .then(function (res) {
        if (!res || res.error || !Array.isArray(res.data)) return;
        applyFormations(res.data);
      }, function () { /* tableau statique conservé */ });
  } catch (e2) { /* tableau statique conservé */ }
})();
