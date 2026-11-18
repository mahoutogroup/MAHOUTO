/* =========================================================
   institut-page.js — institut.html : textes modifiables depuis l'administration (table institut_contenus).

   - « Notre histoire » : remplacée par la valeur 'histoire' (paragraphes séparés par une ligne vide), affichée avec
     createElement / textContent — JAMAIS innerHTML (le texte vient d'un champ de saisie).
   - Si la lecture échoue (hors ligne, erreur) ou si le texte est vide : la page GARDE son texte statique d'origine.
   - Cadre « Projet en préparation » et bouton : si 'ouvert' vaut 'oui', le cadre disparaît et le bouton devient un lien
     vers institut-demande.html. Sinon (ou si la lecture échoue) : bouton grisé « Bientôt disponible », comme avant.
   Lecture publique seulement (aucune connexion nécessaire). Aucun journal console.
   ========================================================= */
(function () {
  "use strict";
  var U = window.InstitutUtils, cfg = window.MAHOUTO_CONFIG;
  if (!U || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") return;   // page statique

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

  var client;
  try { client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); } catch (e) { return; }
  client.from("institut_contenus").select("cle, valeur").then(function (res) {
    if (!res || res.error || !Array.isArray(res.data)) return;
    applyHistoire(U.contentValue(res.data, "histoire"));
    applyOuvert(U.contentValue(res.data, "ouvert"));
  }, function () { /* hors ligne : contenu d'origine */ });
})();
