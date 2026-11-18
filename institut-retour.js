/* =========================================================
   institut-retour.js — institut-retour.html : page de retour après un paiement FedaPay de l'Institut (PR 4).

   - Affiche l'état de SON dernier paiement, lu dans institut_paiements (règle RLS : le payeur ne voit que les siens).
     Les paramètres de l'URL ne sont JAMAIS utilisés : seul le webhook confirme un paiement.
   - Message clair, aucune donnée sensible (ni nom d'enfant, ni montant exact, ni identifiant de transaction).
   - Paiement « en attente » : relecture automatique (6 fois, toutes les 5 s) et bouton « Actualiser ».
   - Aucun innerHTML : textContent seulement.
   ========================================================= */
(function () {
  "use strict";
  var PAY = window.InstitutPaiementUtils, cfg = window.MAHOUTO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  function setHidden(id, hidden) { $(id).classList.toggle("hidden", !!hidden); }

  if (!PAY || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") {
    $("chargement").textContent = "Cette page n'a pas pu se charger. Réessayez dans un instant.";
    return;
  }
  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var user = null, tries = 0, timer = null;

  function render(paiement) {
    var st = PAY.retourState(paiement);
    $("etat-titre").textContent = st.title;
    $("etat-texte").textContent = st.text;
    $("bloc-etat").className = st.key.indexOf("paye") === 0 ? "ok" : (st.key === "echoue" ? "ko" : "");
    setHidden("btn-actualiser", st.key !== "en_attente" && st.key !== "inconnu");
    var lien = $("lien-suite");
    if (st.key === "paye_petit_fils") { lien.setAttribute("href", "mes-achats.html"); lien.textContent = "Voir mes achats"; }
    else { lien.setAttribute("href", "institut-demande.html"); lien.textContent = st.key === "paye_parrain" ? "Voir mes demandes" : "Retour à l'Institut"; }
    setHidden("bloc-etat", false);
    return st;
  }

  async function load() {
    var res = await supabase.from("institut_paiements").select("type, statut, note")
      .eq("user_id", user.id).order("cree_le", { ascending: false }).limit(1);
    var row = !res.error && Array.isArray(res.data) && res.data.length ? res.data[0] : null;
    var st = render(row);
    if (st.key === "en_attente" && tries < 6) { tries++; timer = setTimeout(load, 5000); }
  }

  async function init() {
    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    user = session && session.user && session.user.is_anonymous !== true ? session.user : null;
    setHidden("chargement", true);
    if (!user) { setHidden("bloc-connexion", false); return; }
    $("btn-actualiser").addEventListener("click", function () { if (timer) clearTimeout(timer); tries = 0; load(); });
    await load();
  }
  init();
})();
