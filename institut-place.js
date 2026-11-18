/* =========================================================
   institut-place.js — institut-place.html : l'orphelin saisit son code d'invitation sur SON compte.

   - Réservé aux comptes connectés (connexion : login-sheet.js, comme institut-demande.html). Comptes anonymes refusés.
   - Appelle institut_reclamer_place (base de données) : la base décide de tout (limite de 5 échecs par heure, code unique,
     place non consommée si le compte possède déjà la formation). Ce script n'a aucun pouvoir d'accès.
   - Messages d'erreur en français, jamais d'indice sur les codes qui existent : inconnu, mal formé et déjà utilisé
     donnent la même réponse. Le code n'est jamais écrit dans la console ni dans l'adresse de la page.
   - Aucun innerHTML : createElement / textContent.
   ========================================================= */
(function () {
  "use strict";
  var U = window.InstitutUtils, P = window.InstitutPlaceUtils, cfg = window.MAHOUTO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  function setHidden(id, hidden) { $(id).classList.toggle("hidden", !!hidden); }
  function setStatus(id, msg, isError) {
    var s = $(id);
    s.textContent = msg || "";
    s.classList.toggle("hidden", !msg);
    s.classList.toggle("error", !!isError);
  }

  if (!U || !P || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") {
    setHidden("bloc-chargement", true);
    setStatus("etat", "Cette page n'a pas pu se charger. Réessayez dans un instant.", true);
    return;
  }
  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var busy = false;

  function openLogin() {
    if (!window.MahoutoLogin) { setStatus("etat", "La connexion n'est pas disponible pour le moment.", true); return; }
    window.MahoutoLogin.open({
      doc: document, win: window, supabase: supabase,
      redirectPath: "institut-place.html",
      title: "Se connecter avec le compte de l'élève",
      onSignedIn: async function (u) {
        if (u && window.MahoutoPseudo) { try { await window.MahoutoPseudo.ensureProfileForUser(supabase, u); } catch (e) { /* profil créé plus tard */ } }
        window.location.reload();
      }
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setStatus("e-code", "", false);
    $("f-code").classList.remove("invalid");
    var check = P.validateCode($("f-code").value);
    if (!check.ok) { setStatus("e-code", check.error, true); $("f-code").classList.add("invalid"); return; }

    busy = true;
    $("btn-valider").disabled = true;
    $("btn-valider").textContent = "Vérification…";
    try {
      var res = await supabase.rpc("institut_reclamer_place", { p_code: check.code });
      if (res.error) { setStatus("e-code", P.rpcErrorMessage(res.error), true); return; }
      var outcome = P.claimOutcome(res.data);
      if (!outcome.ok) { setStatus("e-code", outcome.message, true); $("f-code").classList.add("invalid"); return; }
      var name = "la formation";
      try {
        var f = await supabase.from("formations").select("nom").eq("id", outcome.formationId).maybeSingle();
        if (!f.error && f.data && f.data.nom) name = "la formation « " + U.cleanLine(f.data.nom, 80) + " »";
      } catch (e2) { /* nom facultatif */ }
      $("msg-succes").textContent = "Votre place est activée : ce compte a maintenant accès à " + name + ".";
      $("lien-formation").setAttribute("href", P.formationUrl(outcome.formationId));
      setHidden("bloc-code", true);
      setHidden("bloc-succes", false);
    } catch (err) {
      setStatus("e-code", P.rpcErrorMessage(err), true);
    } finally {
      busy = false;
      $("btn-valider").disabled = false;
      $("btn-valider").textContent = "Valider le code";
    }
  }

  async function init() {
    $("btn-connexion").addEventListener("click", openLogin);
    $("formulaire").addEventListener("submit", submit);
    // Saisie : majuscules automatiques, tirets et espaces acceptés, mise en forme « ABCD-EFGH ».
    $("f-code").addEventListener("input", function () {
      var el = $("f-code");
      el.value = P.formatCode(el.value);
      el.classList.remove("invalid");
      setStatus("e-code", "", false);
    });
    if (window.MahoutoLogin && window.MahoutoLogin.oauthErrorFromUrl) {
      var oauthError = window.MahoutoLogin.oauthErrorFromUrl(window.location);
      if (oauthError) setStatus("etat", oauthError, true);
    }
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    var user = session && session.user && session.user.is_anonymous !== true ? session.user : null;
    setHidden("bloc-chargement", true);
    setHidden("bloc-connexion", !!user);
    setHidden("bloc-code", !user);
  }

  init();
})();
