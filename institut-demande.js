/* =========================================================
   institut-demande.js — institut-demande.html : demande de parrainage (PR 2 de l'Institut).

   - Réservé aux comptes connectés (connexion : login-sheet.js, comme chat.html). Comptes anonymes refusés.
   - Si 'ouvert' ≠ 'oui' et que l'utilisateur n'est pas admin : « L'Institut n'est pas encore ouvert aux demandes ».
   - Le justificatif est envoyé AVANT la ligne de demande (bucket privé « institut-justificatifs », chemin
     <uid>/<id>/<nom aléatoire>.<ext>) ; si l'insertion échoue, on tente de supprimer le fichier (sans bruit si refusé).
   - Données minimales (mineurs) : prénom, âge, lien, formation, motif, justificatif. Rien de public.
   - Aucun innerHTML : createElement / textContent. Aucun journal console de données saisies. Rien de payant ici.
   La vraie barrière est la base de données (RLS) ; ce script donne des messages clairs.
   ========================================================= */
(function () {
  "use strict";
  var U = window.InstitutUtils, D = window.InstitutDemandeUtils, cfg = window.MAHOUTO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  function setHidden(id, hidden) { $(id).classList.toggle("hidden", !!hidden); }
  function setStatus(id, msg, isError) {
    var s = $(id);
    s.textContent = msg || "";
    s.classList.toggle("hidden", !msg);
    s.classList.toggle("error", !!isError);
  }
  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  if (!U || !D || !cfg || !window.supabase || typeof window.supabase.createClient !== "function") {
    setHidden("bloc-chargement", true);
    setStatus("etat", "Cette page n'a pas pu se charger. Réessayez dans un instant.", true);
    return;
  }
  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var ADMIN_ROLES = ["admin", "super_admin", "founder"];
  var user = null, busy = false;

  function fillSelect(select, list, placeholder) {
    select.textContent = "";
    select.appendChild(el("option", { value: "", text: placeholder }));
    list.forEach(function (pair) { select.appendChild(el("option", { value: pair[0], text: pair[1] })); });
  }

  // ---------- Mes demandes ----------
  async function loadRequests() {
    var box = $("liste-demandes");
    var res = await supabase.from("institut_demandes")
      .select("id, prenom, age, formation, statut, raison_refus, cree_le")
      .eq("parrain_id", user.id).order("cree_le", { ascending: false });
    box.textContent = "";
    if (res.error) { box.appendChild(el("p", { text: "Impossible de charger vos demandes pour le moment." })); return; }
    if (!res.data.length) { box.appendChild(el("p", { text: "Vous n'avez pas encore déposé de demande." })); return; }
    res.data.forEach(function (d) {
      var top = el("div", { class: "top" }, [
        el("span", { class: "who", text: d.prenom + " (" + d.age + " ans)" }),
        el("span", { class: "badge " + d.statut, text: U.statutLabel(d.statut) })
      ]);
      var card = el("div", { class: "req" }, [top, el("div", { class: "meta", text: U.formationLabel(d.formation) + " · déposée le " + U.formatDate(d.cree_le) })]);
      if (d.statut === "refusee" && d.raison_refus) card.appendChild(el("div", { class: "why", text: "Raison du refus : " + d.raison_refus }));
      box.appendChild(card);
    });
  }

  // ---------- Envoi ----------
  function showFieldErrors(errors) {
    ["prenom", "age", "lien", "formation", "motif", "fichier"].forEach(function (k) {
      $("e-" + k).textContent = errors[k] || "";
      var input = $("f-" + k);
      if (input) input.classList.toggle("invalid", !!errors[k]);
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setStatus("etat-formulaire", "", false);
    var file = $("f-fichier").files && $("f-fichier").files[0] ? $("f-fichier").files[0] : null;
    var check = D.validateDemande({
      prenom: $("f-prenom").value, age: $("f-age").value, lien: $("f-lien").value,
      formation: $("f-formation").value, motif: $("f-motif").value
    });
    var fileCheck = D.validateFile(file);
    var errors = check.ok ? {} : check.errors;
    if (!fileCheck.ok) errors.fichier = fileCheck.error;
    showFieldErrors(errors);
    if (!check.ok || !fileCheck.ok) { setStatus("etat-formulaire", "Corrigez les champs signalés en rouge.", true); return; }

    var id = D.newId(window.crypto);
    if (!id) { setStatus("etat-formulaire", "Ce navigateur ne permet pas d'envoyer la demande en sécurité. Utilisez un navigateur plus récent.", true); return; }

    busy = true;
    $("btn-envoyer").disabled = true;
    setStatus("etat-formulaire", "Envoi en cours…", false);
    var path = null;
    try {
      if (file && !fileCheck.none) {
        path = D.storagePath(user.id, id, fileCheck.ext, D.randomName(window.crypto));
        if (!path) throw { message: "chemin invalide" };
        var up = await supabase.storage.from(D.BUCKET).upload(path, file, { contentType: fileCheck.type, upsert: false });
        if (up.error) { path = null; setStatus("etat-formulaire", D.errorMessage(up.error, "upload"), true); return; }
      }
      var row = Object.assign({ id: id, parrain_id: user.id, justificatif_path: path, statut: "en_attente" }, check.value);
      var ins = await supabase.from("institut_demandes").insert(row);
      if (ins.error) {
        if (path) { try { await supabase.storage.from(D.BUCKET).remove([path]); } catch (e2) { /* sans bruit : suppression réservée aux admins */ } }
        setStatus("etat-formulaire", D.errorMessage(ins.error, "insert"), true);
        return;
      }
      $("formulaire").reset();
      showFieldErrors({});
      setStatus("etat-formulaire", "Demande envoyée. Elle sera examinée : son état s'affiche dans « Mes demandes ».", false);
      await loadRequests();
    } catch (err) {
      setStatus("etat-formulaire", D.errorMessage(err, "insert"), true);
    } finally {
      busy = false;
      $("btn-envoyer").disabled = false;
    }
  }

  // ---------- Démarrage ----------
  function openLogin() {
    if (!window.MahoutoLogin) { setStatus("etat", "La connexion n'est pas disponible pour le moment.", true); return; }
    window.MahoutoLogin.open({
      doc: document, win: window, supabase: supabase,
      redirectPath: "institut-demande.html",
      title: "Se connecter pour demander un parrainage",
      onSignedIn: async function (u) {
        if (u && window.MahoutoPseudo) { try { await window.MahoutoPseudo.ensureProfileForUser(supabase, u); } catch (e) { /* le profil sera créé plus tard */ } }
        window.location.reload();
      }
    });
  }

  async function init() {
    fillSelect($("f-lien"), U.LIENS, "Choisir…");
    fillSelect($("f-formation"), U.FORMATIONS, "Choisir…");
    $("formulaire").addEventListener("submit", submit);
    $("btn-connexion").addEventListener("click", openLogin);
    if (window.MahoutoLogin && window.MahoutoLogin.oauthErrorFromUrl) {
      var oauthError = window.MahoutoLogin.oauthErrorFromUrl(window.location);
      if (oauthError) setStatus("etat", oauthError, true);
    }

    var session = null;
    try { session = (await supabase.auth.getSession()).data.session; } catch (e) { session = null; }
    user = session && session.user && session.user.is_anonymous !== true ? session.user : null;

    var open = false, readFailed = false;
    var content = await supabase.from("institut_contenus").select("valeur").eq("cle", "ouvert").maybeSingle();
    if (content.error) readFailed = true; else open = !!content.data && U.isOpenValue(content.data.valeur);

    var isAdmin = false, petitFils = false;
    if (user) {
      var prof = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      isAdmin = !!(prof.data && ADMIN_ROLES.indexOf(prof.data.role) !== -1);
      var pf = await supabase.from("institut_petits_fils").select("user_id").eq("user_id", user.id).maybeSingle();
      petitFils = !pf.error && !!pf.data;
    }

    setHidden("bloc-chargement", true);
    var view = D.viewState({ signedIn: !!user, open: open, isAdmin: isAdmin });
    setHidden("bloc-connexion", view !== "login");
    setHidden("bloc-ferme", view !== "closed");
    setHidden("bloc-formulaire", view !== "form");
    setHidden("bloc-demandes", view === "login");
    setHidden("note-admin", !(view === "form" && isAdmin && !open));
    setHidden("note-petit-fils", !(user && petitFils));
    if (readFailed && view === "closed") setStatus("etat", "Impossible de vérifier l'ouverture de l'Institut pour le moment. Réessayez dans un instant.", true);
    if (user) await loadRequests();
  }

  init();
})();
