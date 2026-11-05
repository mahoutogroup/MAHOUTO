/* =========================================================
   pseudo.js — Pseudo neutre et messages d'erreur sur le pseudo
   Utilisé par index.html (auth.js), chat.html, discussions.html,
   profil.html et share.html.

   Règle : l'adresse e-mail (ou son préfixe) ne doit JAMAIS servir
   de pseudo. Quand aucun nom n'est disponible, le pseudo est
   « Membre » suivi des premiers caractères de l'identifiant.

   Les refus viennent de la base (migrations 002 et 004) :
     - PSEUDO_RESERVE : nom réservé (MAJESTÉ AI, Admin, Support…)
     - PSEUDO_EMAIL   : pseudo qui a la forme d'une adresse e-mail
     - 23505 sur profiles_username_unique_idx : pseudo déjà pris
   ========================================================= */
(function (root) {
  "use strict";

  var UNIQUE_INDEX = "profiles_username_unique_idx";

  // « Membre » + les `length` premiers caractères de l'identifiant (6 par défaut).
  function neutralName(userId, length) {
    return "Membre " + String(userId || "").slice(0, length || 6);
  }

  // Ressemble à une adresse e-mail (même test que le déclencheur de la migration 002).
  function looksLikeEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
  }

  // Renvoie { kind, message } si l'erreur est un refus de pseudo, sinon null.
  function refusal(error) {
    if (!error) return null;
    var text = String(error.message || "") + " " + String(error.details || "");
    if (text.indexOf("PSEUDO_RESERVE") !== -1) {
      return { kind: "reserved", message: "Ce pseudo est réservé. Choisis-en un autre." };
    }
    if (text.indexOf("PSEUDO_EMAIL") !== -1) {
      return { kind: "email", message: "Le pseudo ne peut pas être une adresse e-mail. Choisis-en un autre." };
    }
    if (error.code === "23505" && text.indexOf(UNIQUE_INDEX) !== -1) {
      return { kind: "taken", message: "Ce pseudo est déjà pris. Choisis-en un autre." };
    }
    return null;
  }

  var api = { neutralName: neutralName, looksLikeEmail: looksLikeEmail, refusal: refusal, UNIQUE_INDEX: UNIQUE_INDEX };
  root.MahoutoPseudo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
