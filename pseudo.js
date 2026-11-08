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

  // Pseudo par défaut (« Membre » + début de l'identifiant) : pas un nom de personne.
  function isNeutralName(value) {
    return /^Membre [0-9a-f]{6,8}$/i.test(String(value || "").trim());
  }

  /**
   * Enregistre le pseudo SEULEMENT si le compte n'en a pas déjà un. Ne réécrit JAMAIS le pseudo
   * d'un compte qui en a un (Google, e-mail ou anonyme déjà inscrit) : le pseudo se change
   * uniquement dans « Mon profil ». Sert au formulaire de pseudo des salons.
   *
   * Renvoie { error, username, kept } :
   *   - kept = true  : le profil avait déjà un pseudo, rien n'a été écrit ; username = ce pseudo ;
   *   - kept = false : le pseudo demandé a été enregistré (ou refusé : voir error, cf. refusal()) ;
   *   - si la lecture du profil échoue (réseau…), RIEN n'est écrit et error est renvoyée.
   */
  async function saveIfMissing(supabase, userId, username) {
    var existing = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
    if (existing.error) return { error: existing.error, username: null, kept: false };

    var row = existing.data;
    if (row && String(row.username || "").trim()) {
      return { error: null, username: row.username, kept: true };
    }

    var res;
    if (row) {
      // Ligne existante sans pseudo (vide) : on le renseigne, sans toucher aux autres colonnes.
      res = await supabase.from("profiles").update({ username: username }).eq("id", userId);
    } else {
      // Pas de ligne : insertion, jamais d'écrasement si une ligne apparaît entre-temps.
      res = await supabase.from("profiles").upsert({ id: userId, username: username }, { onConflict: "id", ignoreDuplicates: true });
    }
    return { error: res.error || null, username: username, kept: false };
  }

  var api = {
    neutralName: neutralName, looksLikeEmail: looksLikeEmail, refusal: refusal, isNeutralName: isNeutralName,
    saveIfMissing: saveIfMissing, UNIQUE_INDEX: UNIQUE_INDEX
  };
  root.MahoutoPseudo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
