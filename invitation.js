/* =========================================================
   invitation.js — lien d'invitation personnel (profil.html) et conservation du code d'un visiteur (creer-ma-carte.html).

   Ce que fait ce fichier, et rien de plus :
   - creer-ma-carte.html : lit ?inv=CODE, vérifie STRICTEMENT le format, le garde sur l'appareil au plus 7 jours, sans rien afficher.
   - profil.html, au chargement : si un code est en attente et que la connexion est celle d'un compte NON anonyme, appelle
     invitation_enregistrer UNE fois, sans attendre, sans afficher d'erreur. C'est la base qui décide (compte récent, pas le
     propriétaire, pas déjà compté) et sa réponse est toujours « vrai ». Le code est effacé dès que l'appel a abouti.
   - profil.html, section « Inviter des professionnels » : visible UNIQUEMENT quand la page publique est publiée (événement
     « pp-publication » émis par profil-public.js) ET que la base renvoie un code (invitation_mon_code : page publiée et non
     suspendue). Affiche le lien, Copier, Partager, et un seul nombre. Jamais de nom, d'identifiant, de date.

   Stockage local : UNE seule clé, « mahouto_inv » (même famille que mahouto_vid, mahouto_pv_seen, mahouto_xpro_pro…),
   valeur {"c":"CODE","e":<échéance en millisecondes>}. Durée de vie 7 jours, effacée dès qu'elle est utilisée ou périmée.
   Aucun cookie. Aucune requête externe. Aucun innerHTML.
   Vocabulaire : « invitation » et « inviter », jamais un autre mot.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.MahoutoInvitation = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  var KEY = "mahouto_inv";
  var TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 symboles : 5 bits chacun, 10 caractères = 50 bits
  var CODE_LENGTH = 10;
  var SITE = "https://mahouto.com";                    // le lien d'invitation vit sur mahouto.com UNIQUEMENT

  /** Format strict : 10 caractères, majuscules et chiffres de la liste (mêmes règles que la base). */
  function codeValide(c) {
    if (typeof c !== "string" || c.length !== CODE_LENGTH) return false;
    for (var i = 0; i < c.length; i++) if (ALPHABET.indexOf(c.charAt(i)) === -1) return false;
    return true;
  }

  /** Code lu dans « ?inv=… » (une seule valeur, format strict, aucune normalisation) ; sinon null. */
  function codeFromSearch(search) {
    var m = /(?:^|[?&])inv=([^&#]*)/.exec(String(search || ""));
    if (!m) return null;
    var v; try { v = decodeURIComponent(m[1]); } catch (e) { return null; }
    return codeValide(v) ? v : null;
  }

  /** Garde le code 7 jours. Renvoie true s'il a été gardé. Un code invalide ne remplace jamais un code gardé. */
  function remember(search, storage, now) {
    var code = codeFromSearch(search);
    if (!code) return false;
    try { storage.setItem(KEY, JSON.stringify({ c: code, e: (typeof now === "number" ? now : Date.now()) + TTL_MS })); return true; } catch (e) { return false; }
  }

  /** Code en attente (valide et non périmé) ou null. Un contenu périmé, illisible ou invalide est effacé. */
  function pending(storage, now) {
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var d = JSON.parse(raw), t = typeof now === "number" ? now : Date.now();
      if (d && typeof d === "object" && typeof d.e === "number" && d.e > t && d.e <= t + TTL_MS + 60000 && codeValide(d.c)) return d.c;
    } catch (e) { /* illisible : effacé ci-dessous */ }
    clear(storage);
    return null;
  }

  function clear(storage) { try { storage.removeItem(KEY); } catch (e) { /* sans effet */ } }

  function lien(code) { return codeValide(code) ? SITE + "/creer-ma-carte?inv=" + code + "&src=invitation" : ""; }
  function texteCompteur(n) {
    var v = Math.floor(Number(n));
    if (!isFinite(v) || v <= 0) return "Personne n'a encore rejoint grâce à votre lien.";
    return v === 1 ? "1 personne a rejoint grâce à votre lien." : v + " personnes ont rejoint grâce à votre lien.";
  }
  function texteMessage(l) { return "Créez votre carte de visite en ligne sur MAHOUTO+ : " + l; }
  function lienWhatsapp(l) { return "https://wa.me/?text=" + encodeURIComponent(texteMessage(l)); }

  /**
   * Enregistre le code en attente, UNE fois par chargement de page, sans attendre et sans rien afficher.
   * user : l'utilisateur de la session (ou null). Le code est effacé quand la base a répondu (sa réponse est toujours « vrai »,
   * elle ne dit pas si le code a compté) ; en cas d'erreur réseau il est gardé (au plus 7 jours) pour un prochain chargement.
   */
  var enCours = false;
  async function registerPending(supabase, user, storage, now) {
    try {
      if (enCours || !user) return false;
      var anon = user.is_anonymous === true || (user.app_metadata && user.app_metadata.provider === "anonymous");
      if (anon) return false;
      var code = pending(storage, now);
      if (!code) return false;
      enCours = true;
      var res = await supabase.rpc("invitation_enregistrer", { p_code: code });
      if (res && !res.error) clear(storage);
      enCours = false;
      return !!res && !res.error;
    } catch (e) { enCours = false; return false; }
  }

  var api = { KEY: KEY, TTL_MS: TTL_MS, ALPHABET: ALPHABET, CODE_LENGTH: CODE_LENGTH, SITE: SITE, codeValide: codeValide, codeFromSearch: codeFromSearch,
    remember: remember, pending: pending, clear: clear, lien: lien, texteCompteur: texteCompteur, texteMessage: texteMessage, lienWhatsapp: lienWhatsapp, registerPending: registerPending };

  // ---------- profil.html : enregistrement du code en attente + section « Inviter des professionnels » ----------
  var doc = typeof document !== "undefined" ? document : null;
  var section = doc ? doc.getElementById("inv-section") : null;
  var cfg = typeof window !== "undefined" ? window.MAHOUTO_CONFIG : null;
  var canClient = !!(cfg && typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function");
  if (!section || !canClient) return api;

  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var $ = function (id) { return doc.getElementById(id); };
  var currentLink = "", busy = false;

  function show(on) { section.classList.toggle("hidden", !on); }

  async function charger() {
    show(false);
    var res = await supabase.rpc("invitation_mon_code");
    var row = !res.error && Array.isArray(res.data) && res.data.length && res.data[0] && typeof res.data[0] === "object" ? res.data[0] : null;
    if (!row || !codeValide(row.code)) return;       // non éligible, ou fonction absente : la section reste masquée
    currentLink = lien(row.code);
    $("inv-lien").textContent = currentLink;
    $("inv-compteur").textContent = texteCompteur(row.nb_inscrits);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") $("inv-partager-systeme").classList.remove("hidden");
    show(true);
  }

  async function copier() {
    if (!currentLink || busy) return;
    busy = true;
    var ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(currentLink); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try {
        var tmp = doc.createElement("textarea");
        tmp.value = currentLink; tmp.setAttribute("readonly", ""); tmp.style.position = "fixed"; tmp.style.opacity = "0";
        doc.body.appendChild(tmp); tmp.select(); ok = doc.execCommand("copy"); doc.body.removeChild(tmp);
      } catch (e2) { ok = false; }
    }
    $("inv-copier").textContent = ok ? "Lien copié ✓" : "Copie impossible";
    setTimeout(function () { $("inv-copier").textContent = "Copier le lien"; busy = false; }, 2500);
  }

  function partagerWhatsapp() { if (currentLink) window.open(lienWhatsapp(currentLink), "_blank", "noopener"); }
  async function partagerSysteme() {
    if (!currentLink) return;
    try { await navigator.share({ text: texteMessage(currentLink) }); } catch (e) { /* annulé par la personne : rien à faire */ }
  }

  async function init() {
    $("inv-copier").addEventListener("click", copier);
    $("inv-whatsapp").addEventListener("click", partagerWhatsapp);
    $("inv-partager-systeme").addEventListener("click", partagerSysteme);
    var user = null;
    try { var s = await supabase.auth.getSession(); user = s && s.data && s.data.session ? s.data.session.user : null; } catch (e) { user = null; }
    var st = null;
    try { st = window.localStorage; } catch (e3) { st = null; }
    if (st) registerPending(supabase, user, st);   // sans attendre, sans rien afficher
  }
  doc.addEventListener("pp-publication", function (ev) {
    var publie = !!(ev && ev.detail && ev.detail.publie);
    if (!publie) { show(false); return; }
    charger().catch(function () { show(false); });
  });
  init();
  // Si la publication était déjà connue avant le chargement de ce fichier (posée par profil-public.js), on la relit.
  try { if (doc.body && doc.body.getAttribute("data-pp-publie") === "1") charger().catch(function () { show(false); }); } catch (e4) { /* sans effet */ }
  return api;
});
