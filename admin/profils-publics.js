/* =========================================================
   admin/profils-publics.js — admin/profils-publics.html : interrupteur général et liste des pages publiques.

   - Accès : session + rôle administrateur (même garde que les autres pages admin) ; la base reste la vraie barrière
     (politique d'écriture de profils_publics_reglages et fonctions profils_publics_admin_* réservées aux administrateurs).
   - Interrupteur : lecture et écriture directes de profils_publics_reglages (clé « ouvert »). OUVRIR demande une confirmation
     claire ; FERMER se fait en un clic (la fermeture protège).
   - Liste : fonction profils_publics_admin_lister. On n'affiche JAMAIS l'identifiant du compte ni l'e-mail. « Voir » ouvre
     /m/<adresse> dans un nouvel onglet (aperçu administrateur, même interrupteur fermé). Suspendre / Réactiver : fonction
     profils_publics_admin_suspendre, avec confirmation.
   - Signalements (PR 2 sur 3) : pages signalées (profils_publics_signalements_admin_lister), badge « À examiner » dès 3 signaleurs
     distincts non traités (indicateur seulement, jamais de suspension automatique), motifs en compteurs, « Détails »
     (profils_publics_signalements_admin_detail : motif, précisions, date, sans identité), « Marquer comme traité »
     (profils_publics_signalements_admin_traiter) avec confirmation. Aucun identifiant de signaleur n'existe dans ces résultats.
   - Rappel (finitions) : tant que l'interrupteur est OUVERT, un bandeau rouge indique depuis combien de temps (calcul dans le
     navigateur à partir de maj_le, mise à jour chaque minute, plus insistant après 2 h) avec « Fermer maintenant », qui
     réutilise le même code que le bouton de fermeture (un clic, sans confirmation). Jamais de durée aberrante (PU.ouvertDepuis).
   - Tout texte dynamique passe par textContent : aucun innerHTML.
   ========================================================= */
(function () {
  "use strict";
  var PU = window.ProfilPublicUtils, cfg = window.MAHOUTO_CONFIG;
  var ADMIN_ROLES = ["admin", "super_admin", "founder"];
  var CONFIRM_OUVRIR = "Cette action rend publiques toutes les pages publiées. Vérifiez que vous avez testé le signalement. Continuer ?";
  var $ = function (id) { return document.getElementById(id); };
  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var ouvert = null, busy = false, majLe = null, tick = null;

  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function setStatus(id, msg, isError) {
    var s = $(id);
    s.textContent = msg || "";
    s.classList.toggle("error", !!isError);
  }

  // ---------- Interrupteur ----------
  // Bandeau rouge « OUVERTE depuis X h Y min » : visible seulement si l'interrupteur est ouvert.
  function renderBanner() {
    var box = $("bandeau-ouvert");
    if (ouvert !== true) { box.classList.add("hidden"); return; }
    var info = PU.ouvertDepuis(majLe, Date.now());
    $("bandeau-ouvert-texte").textContent = info.text;
    box.classList.toggle("insistant", info.level === "insistant");
    $("btn-fermer-bandeau").disabled = busy;
    box.classList.remove("hidden");
  }
  function renderSwitch() {
    renderBanner();
    var btn = $("btn-interrupteur");
    if (ouvert === null) { $("etat-interrupteur").textContent = "État inconnu (lecture impossible)."; btn.disabled = true; btn.textContent = "Indisponible"; return; }
    $("etat-interrupteur").textContent = ouvert ? "Fonction OUVERTE au public." : "Fonction FERMÉE au public.";
    btn.textContent = ouvert ? "Fermer au public" : "Ouvrir au public";
    btn.className = "btn " + (ouvert ? "btn-no" : "btn-gold");
    btn.disabled = busy;
  }
  async function loadSwitch() {
    var res = await supabase.from("profils_publics_reglages").select("valeur, maj_le").eq("cle", "ouvert").maybeSingle();
    if (res.error || !res.data) { ouvert = null; majLe = null; setStatus("msg-interrupteur", "Impossible de lire l'interrupteur (le SQL du profil public est-il exécuté ?).", true); }
    else { ouvert = res.data.valeur === "oui"; majLe = res.data.maj_le || null; setStatus("msg-interrupteur", "", false); }
    renderSwitch();
  }
  async function toggleSwitch() {
    if (busy || ouvert === null) return;
    var target = ouvert ? "non" : "oui";
    if (target === "oui" && !confirm(CONFIRM_OUVRIR)) return;
    busy = true; renderSwitch();
    setStatus("msg-interrupteur", "Enregistrement…", false);
    try {
      var res = await supabase.from("profils_publics_reglages").update({ valeur: target }).eq("cle", "ouvert").select("valeur, maj_le");
      if (res.error || !Array.isArray(res.data) || !res.data.length) { setStatus("msg-interrupteur", "Modification refusée ou impossible (droits administrateur requis).", true); }
      else { ouvert = res.data[0].valeur === "oui"; majLe = res.data[0].maj_le || null; setStatus("msg-interrupteur", ouvert ? "Fonction ouverte au public." : "Fonction fermée au public.", false); }
    } catch (e) {
      setStatus("msg-interrupteur", "Modification impossible pour le moment. Réessayez.", true);
    } finally { busy = false; renderSwitch(); }
  }

  // ---------- Liste des pages ----------
  function yesNo(v) { return v === true ? "oui" : "non"; }
  function renderList(rows) {
    var box = $("liste-pages");
    box.textContent = "";
    if (!rows.length) { box.appendChild(el("p", { class: "hint", text: "Aucune page pour le moment." })); return; }
    rows.forEach(function (r) {
      var adresse = typeof r.adresse === "string" ? r.adresse : "";
      var card = el("div", { class: "card item" }, [
        el("div", { class: "top" }, [
          el("span", { class: "who", text: String(r.nom_affiche || "") }),
          el("span", { class: "badge" + (r.suspendu === true ? " refusee" : r.publie === true ? " validee" : ""), text: r.suspendu === true ? "Suspendue" : r.publie === true ? "Publiée" : "Brouillon" })
        ]),
        el("div", { class: "meta", text: "/m/" + adresse }),
        el("div", { class: "meta", text: "Publiée : " + yesNo(r.publie) + " · Suspendue : " + yesNo(r.suspendu) + " · Date de publication : " + PU.formatDateFr(r.publie_le) })
      ]);
      var actions = el("div", { class: "actions" });
      if (PU.ADRESSE_RE.test(adresse)) {
        var see = el("button", { type: "button", class: "btn btn-view", text: "Voir" });
        see.addEventListener("click", function () { window.open("/m/" + encodeURIComponent(adresse), "_blank", "noopener"); });
        actions.appendChild(see);
      }
      var susp = r.suspendu === true;
      var b = el("button", { type: "button", class: "btn " + (susp ? "btn-ok" : "btn-no"), text: susp ? "Réactiver" : "Suspendre" });
      b.addEventListener("click", function () { setSuspendu(r.id, adresse, !susp); });
      actions.appendChild(b);
      card.appendChild(actions);
      box.appendChild(card);
    });
  }
  async function loadList() {
    setStatus("msg-liste", "Chargement…", false);
    var res = await supabase.rpc("profils_publics_admin_lister");
    if (res.error) { setStatus("msg-liste", "Impossible de charger la liste (le SQL du profil public est-il exécuté ?).", true); return; }
    setStatus("msg-liste", "", false);
    renderList(Array.isArray(res.data) ? res.data : []);
  }
  async function setSuspendu(id, adresse, suspendre) {
    var question = suspendre
      ? "Suspendre la page /m/" + adresse + " ? Elle affichera « Ce profil n'est pas disponible »."
      : "Réactiver la page /m/" + adresse + " ?";
    if (!confirm(question)) return;
    var res = await supabase.rpc("profils_publics_admin_suspendre", { p_id: id, p_suspendu: suspendre });
    if (res.error || res.data !== true) { setStatus("msg-liste", "Action impossible : " + (res.error ? res.error.message : "page introuvable") + ".", true); return; }
    await Promise.all([loadList(), loadSignalements()]);
    setStatus("msg-liste", suspendre ? "Page suspendue." : "Page réactivée.", false);
    setStatus("msg-signalements", suspendre ? "Page suspendue." : "Page réactivée.", false);
  }

  // ---------- Signalements ----------
  function renderSignalements(rows) {
    var box = $("liste-signalements");
    box.textContent = "";
    if (!rows.length) { box.appendChild(el("p", { class: "hint", text: "Aucune page signalée." })); return; }
    rows.forEach(function (r) {
      var adresse = typeof r.adresse === "string" ? r.adresse : "";
      var aExaminer = r.a_examiner === true;
      var card = el("div", { class: "card item" }, [
        el("div", { class: "top" }, [
          el("span", { class: "who", text: String(r.nom_affiche || "") }),
          el("span", { class: "badge" + (aExaminer ? " prio" : ""), text: aExaminer ? "À examiner" : (Number(r.nb_non_traites) > 0 ? "En attente" : "Traité") })
        ]),
        el("div", { class: "meta", text: "/m/" + adresse + " · Publiée : " + yesNo(r.publie) + " · Suspendue : " + yesNo(r.suspendu) }),
        el("div", { class: "meta", text: r.nb_signaleurs + " signaleur(s) distinct(s) · " + r.nb_non_traites + " non traité(s) · dernier signalement le " + PU.formatDateFr(r.dernier_le) }),
        el("div", { class: "meta", text: "Motifs : " + (PU.formatMotifs(r.motifs) || "—") })
      ]);
      var detailBox = el("div", { class: "text hidden" });
      var actions = el("div", { class: "actions" });
      if (PU.ADRESSE_RE.test(adresse)) {
        var see = el("button", { type: "button", class: "btn btn-view", text: "Voir la page" });
        see.addEventListener("click", function () { window.open("/m/" + encodeURIComponent(adresse), "_blank", "noopener"); });
        actions.appendChild(see);
      }
      var det = el("button", { type: "button", class: "btn btn-view", text: "Détails" });
      det.addEventListener("click", function () { toggleDetail(r.page_id, detailBox, det); });
      actions.appendChild(det);
      var susp = r.suspendu === true;
      var sb = el("button", { type: "button", class: "btn " + (susp ? "btn-ok" : "btn-no"), text: susp ? "Réactiver" : "Suspendre" });
      sb.addEventListener("click", function () { setSuspendu(r.page_id, adresse, !susp); });
      actions.appendChild(sb);
      if (Number(r.nb_non_traites) > 0) {
        var done = el("button", { type: "button", class: "btn btn-gold", text: "Marquer comme traité" });
        done.addEventListener("click", function () { markTreated(r.page_id, adresse); });
        actions.appendChild(done);
      }
      card.appendChild(actions);
      card.appendChild(detailBox);
      box.appendChild(card);
    });
  }
  async function loadSignalements() {
    setStatus("msg-signalements", "Chargement…", false);
    var res = await supabase.rpc("profils_publics_signalements_admin_lister");
    if (res.error) { setStatus("msg-signalements", "Impossible de charger les signalements (le SQL du signalement est-il exécuté ?).", true); return; }
    setStatus("msg-signalements", "", false);
    renderSignalements(Array.isArray(res.data) ? res.data : []);
  }
  async function toggleDetail(pageId, box, btn) {
    if (!box.classList.contains("hidden")) { box.classList.add("hidden"); btn.textContent = "Détails"; return; }
    var res = await supabase.rpc("profils_publics_signalements_admin_detail", { p_page_id: pageId });
    box.textContent = "";
    if (res.error) { box.appendChild(el("p", { text: "Impossible de charger les détails." })); }
    else (Array.isArray(res.data) ? res.data : []).forEach(function (d) {
      box.appendChild(el("p", { text: PU.formatDateFr(d.cree_le) + " · " + PU.motifLabel(d.motif) + (d.traite === true ? " (traité)" : "") + (d.detail ? " — " + d.detail : "") }));
    });
    box.classList.remove("hidden"); btn.textContent = "Masquer les détails";
  }
  async function markTreated(pageId, adresse) {
    if (!confirm("Marquer comme traités tous les signalements de la page /m/" + adresse + " ?")) return;
    var res = await supabase.rpc("profils_publics_signalements_admin_traiter", { p_page_id: pageId });
    if (res.error) { setStatus("msg-signalements", "Action impossible : " + res.error.message + ".", true); return; }
    await loadSignalements();
    setStatus("msg-signalements", "Signalements marqués comme traités.", false);
  }

  // ---------- Démarrage ----------
  async function init() {
    var sess = await supabase.auth.getSession();
    var session = sess && sess.data ? sess.data.session : null;
    if (!session || !session.user) {
      $("loading-state").classList.add("hidden");
      $("access-denied").classList.remove("hidden");
      $("access-denied").textContent = "🔒 Connecte-toi avec un compte administrateur pour accéder à cette page.";
      return;
    }
    var prof = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
    if (!prof.data || ADMIN_ROLES.indexOf(prof.data.role) === -1) {
      $("loading-state").classList.add("hidden");
      $("access-denied").classList.remove("hidden");
      return;
    }
    $("loading-state").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("btn-interrupteur").addEventListener("click", toggleSwitch);
    $("btn-fermer-bandeau").addEventListener("click", toggleSwitch);   // même code que la fermeture existante : un clic, sans confirmation
    if (!tick) tick = setInterval(renderBanner, 60000);                 // durée remise à jour chaque minute
    $("btn-recharger").addEventListener("click", function () { loadSwitch(); loadSignalements(); loadList(); });
    await loadSwitch();
    await loadSignalements();
    await loadList();
  }
  init();
})();
