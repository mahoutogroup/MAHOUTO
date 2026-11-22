/* =========================================================
   institut-utils.js — logique pure de l'Institut SAYÉ LOUIS (institut.html, institut-demande.html,
   admin/institut.html, tests/institut-demande.test.js).

   Aucun accès réseau, aucune base, aucun DOM : uniquement des fonctions testables.
   Les textes qui viennent d'un champ de saisie (histoire, motif, raison de refus) ne sont JAMAIS insérés
   dans du HTML : les pages les affichent avec createElement / textContent.
   ========================================================= */
(function (root) {
  "use strict";

  var HISTOIRE_MAX = 5000;   // même limite que la base (institut_contenus.valeur)
  var MOTIF_MAX = 500;
  var REFUS_MAX = 300;
  var PRENOM_MAX = 40;
  var AGE_MIN = 14, AGE_MAX = 25, AGE_MAJEUR = 18;   // règlement : orphelins de 14 à 25 ans (même fourchette que la base)

  // Situation de l'orphelin (obligatoire) : sert à donner la priorité aux orphelins des deux parents quand les places manquent.
  var SITUATIONS = [["pere", "A perdu son père"], ["mere", "A perdu sa mère"], ["deux_parents", "A perdu ses deux parents"]];

  var STATUTS = [["en_attente", "En attente"], ["validee", "Validée"], ["refusee", "Refusée"]];
  var LIENS = [
    ["parent", "Parent"], ["proche", "Proche de la famille"], ["tuteur", "Tuteur ou tutrice"],
    ["enseignant", "Enseignant ou enseignante"], ["lui_meme", "L'orphelin lui-même (majeur)"], ["autre", "Autre"]
  ];
  // Formations proposées pour l'instant : une seule. Pour en ajouter, ajouter une ligne [code, libellé] ici
  // (le code : 1 à 40 caractères, il est enregistré tel quel dans la demande).
  var FORMATIONS = [["serigraphie", "Sérigraphie"]];

  function labelOf(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1];
    return "";
  }
  function statutLabel(code) { return labelOf(STATUTS, code) || "Statut inconnu"; }
  function situationLabel(code) { return labelOf(SITUATIONS, code) || "Non précisée"; }
  function lienLabel(code) { return labelOf(LIENS, code) || "—"; }
  function formationLabel(code) { return labelOf(FORMATIONS, code) || String(code == null ? "" : code).slice(0, 40); }

  /** Longueur en caractères (points de code), comme char_length() en base. */
  function countChars(s) { return Array.from(String(s == null ? "" : s)).length; }

  /** Texte d'une ligne : caractères de contrôle remplacés par un espace, espaces réduits, bornes. */
  function cleanLine(s, max) {
    var t = String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(t).slice(0, max || 200).join("");
  }
  /** Texte multi-lignes : retours à la ligne conservés, autres caractères de contrôle retirés. */
  function cleanMultiline(s) {
    return String(s == null ? "" : s).replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, "").trim();
  }

  /** Paragraphes d'un texte (séparés par une ligne vide), sans paragraphe vide. */
  function paragraphs(text) {
    return cleanMultiline(text).split(/\n[ \t]*\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  /** Texte « Notre histoire » : vide accepté (la page garde alors son texte d'origine). */
  function validateHistoire(text) {
    if (typeof text !== "string") return { ok: false, error: "Texte invalide." };
    var value = cleanMultiline(text);
    var n = countChars(value);
    if (n > HISTOIRE_MAX) return { ok: false, error: "Le texte est trop long : " + n + " caractères pour " + HISTOIRE_MAX + " au maximum." };
    return { ok: true, value: value, count: n };
  }

  /** Raison d'un refus : 1 à 300 caractères. */
  function validateRefus(text) {
    var value = cleanLine(text, REFUS_MAX + 50);
    if (!value) return { ok: false, error: "Indiquez une raison courte pour le refus." };
    if (countChars(value) > REFUS_MAX) return { ok: false, error: "La raison est trop longue (" + REFUS_MAX + " caractères au maximum)." };
    return { ok: true, value: value };
  }

  /** L'interrupteur « ouvert » : seule la valeur 'oui' ouvre l'Institut. */
  function isOpenValue(v) { return v === "oui"; }
  function openValue(flag) { return flag ? "oui" : "non"; }

  /** Valeur d'une clé dans les lignes de institut_contenus (ou undefined). */
  function contentValue(rows, key) {
    if (!Array.isArray(rows)) return undefined;
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].cle === key) return typeof rows[i].valeur === "string" ? rows[i].valeur : undefined;
    return undefined;
  }

  function filterByStatut(list, statut) {
    var arr = Array.isArray(list) ? list : [];
    return statut ? arr.filter(function (d) { return d && d.statut === statut; }) : arr.slice();
  }
  /**
   * Ordre d'affichage des demandes. mode "deux_parents" : orphelins des deux parents d'abord (priorité du règlement quand les
   * places manquent), puis les autres ; l'ordre d'origine (déjà du plus récent au plus ancien) est conservé dans chaque groupe.
   * Tout autre mode : ordre d'origine. Ne modifie jamais la liste reçue.
   */
  function sortDemandes(list, mode) {
    var arr = (Array.isArray(list) ? list : []).map(function (d, i) { return { d: d, i: i }; });
    if (mode === "deux_parents") {
      arr.sort(function (a, b) {
        var ra = a.d && a.d.situation === "deux_parents" ? 0 : 1, rb = b.d && b.d.situation === "deux_parents" ? 0 : 1;
        return ra - rb || a.i - b.i;
      });
    }
    return arr.map(function (x) { return x.d; });
  }
  function countByStatut(list) {
    var out = { en_attente: 0, validee: 0, refusee: 0 };
    (Array.isArray(list) ? list : []).forEach(function (d) { if (d && out[d.statut] !== undefined) out[d.statut]++; });
    return out;
  }

  /** Recherche d'un utilisateur par nom : 2 à 40 caractères ; les jokers LIKE (% _ \) sont échappés. */
  function searchTerm(q) {
    var t = cleanLine(q, 60);
    if (countChars(t) < 2) return { ok: false, error: "Tapez au moins 2 lettres." };
    if (countChars(t) > 40) return { ok: false, error: "40 caractères au maximum." };
    return { ok: true, value: t, pattern: "%" + t.replace(/[\\%_]/g, "\\$&") + "%" };
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  /** Montant en FCFA avec espaces insécables : « 50 000 FCFA » (le montant n'est jamais coupé en fin de ligne). */
  function formatFcfa(n) {
    var v = Number(n);
    if (!isFinite(v)) return "—";
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0") + "\u00A0FCFA";
  }

  var api = {
    HISTOIRE_MAX: HISTOIRE_MAX, MOTIF_MAX: MOTIF_MAX, REFUS_MAX: REFUS_MAX, PRENOM_MAX: PRENOM_MAX,
    AGE_MIN: AGE_MIN, AGE_MAX: AGE_MAX, AGE_MAJEUR: AGE_MAJEUR,
    STATUTS: STATUTS, SITUATIONS: SITUATIONS, LIENS: LIENS, FORMATIONS: FORMATIONS,
    statutLabel: statutLabel, situationLabel: situationLabel, lienLabel: lienLabel, formationLabel: formationLabel,
    countChars: countChars, cleanLine: cleanLine, cleanMultiline: cleanMultiline, paragraphs: paragraphs,
    validateHistoire: validateHistoire, validateRefus: validateRefus,
    isOpenValue: isOpenValue, openValue: openValue, contentValue: contentValue,
    formatFcfa: formatFcfa, filterByStatut: filterByStatut, sortDemandes: sortDemandes, countByStatut: countByStatut, searchTerm: searchTerm, formatDate: formatDate
  };
  root.InstitutUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
