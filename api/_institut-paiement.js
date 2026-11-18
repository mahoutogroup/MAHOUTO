// =========================================================
// /api/_institut-paiement.js — paiement FedaPay du prix social de l'Institut SAYÉ LOUIS (PR 4)
//
// Helper NON exposé comme fonction Vercel (préfixe "_") : la limite de 12 fonctions du plan Hobby est atteinte.
// Appelé par :
//   - api/fedapay-checkout.js  quand productType === "institut" (branche placée avant la validation courseId) ;
//   - api/fedapay-webhook.js   quand aucune ligne « purchases » ni commande / abonnement ne correspond.
//
// Deux cas (champ « cas » du corps) :
//   - "parrain"    : { cas, demandeId, formationId } — le parrain paie la place d'un élève dont SA demande est
//                    validée et sans place. La confirmation crée la place (source « payee ») et son code.
//   - "petit_fils" : { cas, formationId } — un petit-fils marqué par un admin paie sa formation. La confirmation
//                    crée l'accès (ligne purchases « paid », montant = prix), sans code.
//
// Principe de sécurité (argent), calqué sur api/_salon-abonnement.js :
//   - le navigateur n'envoie JAMAIS de montant : le prix (institut_formations.prix_institut) est relu ici
//     (clé service_role) ; une formation inactive, un prix absent ou non entier > 0 : refusé ;
//   - droits vérifiés côté serveur (demande du parrain connecté, validée, sans place ; petit-fils marqué ;
//     formation pas déjà possédée) ; si l'Institut n'est pas ouvert ('ouvert' ≠ 'oui'), seul un administrateur
//     peut payer (test) ;
//   - le paiement est enregistré dans institut_paiements (instantané du montant) ; l'accès dépend UNIQUEMENT du
//     webhook : signature vérifiée et transaction relue chez FedaPay par api/fedapay-webhook.js, montant comparé,
//     puis fonction SQL atomique et idempotente institut_confirmer_paiement ;
//   - aucune donnée d'enfant (prénom, etc.) n'est envoyée à FedaPay.
//
// Variables d'environnement Vercel : les mêmes que fedapay-checkout.js (aucune nouvelle variable).
// =========================================================
import { createClient } from "@supabase/supabase-js";

export const MAX_PENDING_PER_HOUR = 5;
const ADMIN_ROLES = ["admin", "super_admin", "founder"];
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FORMATION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CASES = ["parrain", "petit_fils"];

/** Prix valide : entier strictement positif. */
export function isValidPrice(n) { return Number.isInteger(n) && n > 0; }

function fail(res, status, error, extra) { return res.status(status).json(Object.assign({ error }, extra || {})); }

/** Interrupteur « ouvert » : seule la valeur 'oui' ouvre l'Institut (même règle que institut_ouvert()). */
function isOpen(valeur) { return String(valeur == null ? "" : valeur).trim().toLowerCase() === "oui"; }

// ---------------------------------------------------------
// Checkout. Dépendances injectables pour les tests : { supabaseAuth, supabaseAdmin, fetch, now }.
// ---------------------------------------------------------
export async function handleInstitutCheckout(req, res, deps) {
  try {
    deps = deps || {};
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const cas = typeof body.cas === "string" ? body.cas : "";
    if (CASES.indexOf(cas) === -1) return fail(res, 400, "Type de paiement invalide.");
    const formationId = typeof body.formationId === "string" ? body.formationId : "";
    if (!FORMATION_RE.test(formationId)) return fail(res, 400, "Choisis une formation.");
    const demandeId = typeof body.demandeId === "string" ? body.demandeId : "";
    if (cas === "parrain" && !UUID_RE.test(demandeId)) return fail(res, 400, "Demande invalide.");

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const secretKey = process.env.FEDAPAY_SECRET_KEY;
    if (!supabaseUrl || !anonKey || !serviceKey) { console.error("Configuration Supabase manquante sur Vercel."); return fail(res, 500, "Configuration serveur incomplète."); }
    if (!secretKey) { console.error("FEDAPAY_SECRET_KEY manquant sur Vercel."); return fail(res, 500, "Configuration de paiement incomplète."); }

    // Authentification obligatoire — jamais de userId envoyé par le navigateur
    const authHeader = (req.headers && req.headers.authorization) || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return fail(res, 401, "Authentification requise.");
    const supabaseAuth = deps.supabaseAuth || createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData || !userData.user) return fail(res, 401, "Session invalide ou expirée.");
    const user = userData.user;
    if (user.is_anonymous === true || (user.app_metadata && user.app_metadata.provider === "anonymous")) {
      return fail(res, 403, "Connecte-toi avec Google ou ton e-mail pour payer.", { code: "ANONYMOUS_NOT_ALLOWED" });
    }
    const supabaseAdmin = deps.supabaseAdmin || createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabaseAdmin.from("profiles").select("username, role").eq("id", user.id).maybeSingle();
    const isAdmin = !!profile && ADMIN_ROLES.indexOf(profile.role) !== -1;

    // Institut fermé : paiements publics refusés (l'administrateur reste testeur)
    const { data: ouvert, error: ouvertError } = await supabaseAdmin.from("institut_contenus").select("valeur").eq("cle", "ouvert").maybeSingle();
    if (ouvertError) { console.error("Lecture de l'ouverture impossible :", ouvertError.message); return fail(res, 500, "Erreur serveur."); }
    if (!isAdmin && !(ouvert && isOpen(ouvert.valeur))) return fail(res, 403, "L'Institut n'est pas encore ouvert aux paiements.");

    // Prix : relu en base. Formation absente du catalogue ou inactive : refusée.
    const { data: catalogue, error: catError } = await supabaseAdmin
      .from("institut_formations").select("formation_id, prix_institut, actif").eq("formation_id", formationId).maybeSingle();
    if (catError) { console.error("Lecture du catalogue impossible :", catError.message); return fail(res, 500, "Erreur serveur."); }
    if (!catalogue || catalogue.actif !== true || !isValidPrice(catalogue.prix_institut)) return fail(res, 400, "Cette formation n'est pas disponible à tarif Institut.");
    const montant = catalogue.prix_institut;

    let formationNom = "Formation";
    const { data: formation } = await supabaseAdmin.from("formations").select("nom").eq("id", formationId).maybeSingle();
    if (formation && formation.nom) formationNom = String(formation.nom).slice(0, 60);

    if (cas === "parrain") {
      const { data: demande, error: demandeError } = await supabaseAdmin
        .from("institut_demandes").select("id, parrain_id, statut").eq("id", demandeId).maybeSingle();
      if (demandeError) { console.error("Lecture de la demande impossible :", demandeError.message); return fail(res, 500, "Erreur serveur."); }
      // Même réponse pour « inconnue » et « pas la tienne » : on ne révèle rien sur les demandes des autres.
      if (!demande || demande.parrain_id !== user.id) return fail(res, 404, "Demande introuvable.");
      if (demande.statut !== "validee") return fail(res, 409, "Cette demande n'est pas validée.");
      const { data: place, error: placeError } = await supabaseAdmin.from("institut_places").select("id").eq("demande_id", demandeId).maybeSingle();
      if (placeError) { console.error("Lecture de la place impossible :", placeError.message); return fail(res, 500, "Erreur serveur."); }
      if (place) return fail(res, 409, "Une place existe déjà pour cette demande.");
    } else {
      const { data: pf, error: pfError } = await supabaseAdmin.from("institut_petits_fils").select("user_id").eq("user_id", user.id).maybeSingle();
      if (pfError) { console.error("Lecture petits-fils impossible :", pfError.message); return fail(res, 500, "Erreur serveur."); }
      if (!pf) return fail(res, 403, "Ce paiement est réservé aux petits-fils de Sayé Louis enregistrés.");
      // Pas de doublon d'accès : refus AVANT le paiement si la formation est déjà possédée.
      const { data: owned, error: ownedError } = await supabaseAdmin.from("purchases").select("id")
        .eq("user_id", user.id).eq("course_id", formationId).eq("product_type", "formation").eq("status", "paid").maybeSingle();
      if (ownedError) { console.error("Lecture des achats impossible :", ownedError.message); return fail(res, 500, "Erreur serveur."); }
      if (owned) return fail(res, 409, "Tu possèdes déjà cette formation.");
    }

    // Plafond de paiements en attente récents (anti-abus)
    const sinceIso = new Date((deps.now || Date.now()) - 60 * 60 * 1000).toISOString();
    const { count: pendingCount, error: pendingError } = await supabaseAdmin
      .from("institut_paiements").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("statut", "en_attente").gte("cree_le", sinceIso);
    if (pendingError) { console.error("Comptage des paiements en attente impossible :", pendingError.message); return fail(res, 500, "Erreur serveur."); }
    if ((pendingCount || 0) >= MAX_PENDING_PER_HOUR) {
      res.setHeader("Retry-After", "3600");
      return fail(res, 429, "Trop de tentatives de paiement en attente. Patiente environ une heure ou termine un paiement déjà commencé.");
    }

    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = String(process.env.PUBLIC_SITE_URL || `https://${req.headers && req.headers.host}`).replace(/\/+$/, "");
    const doFetch = deps.fetch || fetch;
    const firstname = (profile && profile.username) || "Client";
    const customer = user.email ? { firstname, lastname: firstname, email: user.email } : undefined;

    let createData;
    try {
      const createResp = await doFetch(`${baseUrl}/transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Aucun nom d'enfant dans la description envoyée à FedaPay.
          description: `Institut SAYÉ LOUIS — ${formationNom}`,
          amount: montant,
          currency: { iso: "XOF" },
          // Retour sur une page dédiée ; elle lit SON propre paiement en base, jamais les paramètres de l'URL.
          callback_url: `${siteUrl}/institut-retour.html`,
          ...(customer ? { customer } : {})
        })
      });
      createData = await createResp.json();
      if (!createResp.ok) { console.error("Erreur création transaction FedaPay (institut) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }
    } catch (e) {
      console.error("FedaPay injoignable (institut) :", e);
      return fail(res, 502, "Impossible de créer le paiement.");
    }

    const txObj = createData["v1/transaction"] || createData.transaction || createData;
    const transactionId = txObj && txObj.id;
    if (!transactionId) { console.error("Réponse FedaPay inattendue (institut) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }

    let checkoutUrl = txObj && txObj.payment_url;
    if (!checkoutUrl) {
      try {
        const tokenResp = await doFetch(`${baseUrl}/transactions/${transactionId}/token`, {
          method: "POST", headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" }
        });
        const tokenData = await tokenResp.json();
        if (!tokenResp.ok) throw new Error("token refusé");
        const tokenObj = tokenData["v1/token"] || tokenData.token || tokenData;
        checkoutUrl = tokenData.url || (tokenObj && tokenObj.url);
      } catch (e) { checkoutUrl = null; }
      if (!checkoutUrl) { console.error("URL de paiement FedaPay absente (institut)"); return fail(res, 502, "Impossible de générer le lien de paiement."); }
    }

    // Instantané serveur. Si l'écriture échoue, la transaction est orpheline : on n'envoie pas payer.
    const { error: insertError } = await supabaseAdmin.from("institut_paiements").insert({
      type: cas,
      user_id: user.id,
      demande_id: cas === "parrain" ? demandeId : null,
      formation_id: formationId,
      montant,
      fedapay_transaction_id: String(transactionId),
      statut: "en_attente"
    });
    if (insertError) {
      console.error("ÉCHEC enregistrement du paiement — transaction FedaPay orpheline :", transactionId, insertError.message);
      return fail(res, 500, "Impossible d'enregistrer le paiement. Réessaie dans un instant.");
    }

    return res.status(200).json({ checkoutUrl, transactionId });
  } catch (err) {
    console.error("Erreur serveur checkout Institut :", err);
    return fail(res, 500, "Erreur serveur lors de la création du paiement.");
  }
}

// ---------------------------------------------------------
// Webhook — appelé par fedapay-webhook.js APRÈS la vérification de signature et la relecture de la transaction
// chez FedaPay. Renvoie null si aucun paiement de l'Institut ne correspond, sinon { status, body }.
// ---------------------------------------------------------
export async function handleInstitutWebhook(supabaseAdmin, { transactionId, officialStatus, officialAmount, log }) {
  const { data: paiement, error } = await supabaseAdmin
    .from("institut_paiements").select("id, statut, montant").eq("fedapay_transaction_id", String(transactionId)).maybeSingle();
  if (error) {
    log("error", "Lecture de institut_paiements impossible", { transactionId, error: error.message });
    return null;
  }
  if (!paiement) return null;

  if (paiement.statut === "paye") {
    log("info", "Paiement Institut déjà confirmé — aucune action supplémentaire", { transactionId });
    return { status: 200, body: { received: true, already_confirmed: true } };
  }

  if (officialStatus === "approved" || officialStatus === "transferred") {
    // Le montant réellement payé doit être EXACTEMENT l'instantané du prix relu en base au checkout
    if (!Number.isInteger(officialAmount) || officialAmount !== Number(paiement.montant)) {
      log("error", "Montant FedaPay différent du prix Institut enregistré — paiement rejeté", {
        transactionId, expected: paiement.montant, received: officialAmount
      });
      await supabaseAdmin.rpc("institut_echouer_paiement", { p_transaction_id: String(transactionId) });
      return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    }
    const { data, error: rpcError } = await supabaseAdmin.rpc("institut_confirmer_paiement", {
      p_transaction_id: String(transactionId), p_montant: officialAmount
    });
    if (rpcError) {
      log("error", "Confirmation du paiement Institut impossible", { transactionId, error: rpcError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };   // 5xx : FedaPay réessaiera
    }
    const resultat = data && data.resultat;
    if (resultat === "confirme") {
      if (data.anomalie) log("error", "Paiement Institut encaissé mais rien créé — à traiter à la main", { transactionId, anomalie: data.anomalie });
      else log("info", "Paiement Institut confirmé", { transactionId, type: data.type });
      return { status: 200, body: { received: true, status: "confirme" } };
    }
    if (resultat === "deja_confirme") return { status: 200, body: { received: true, already_confirmed: true } };
    if (resultat === "montant_incoherent") return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    log("error", "Paiement Institut ignoré (état inattendu)", { transactionId, resultat });
    return { status: 200, body: { received: true, status: "ignore" } };
  }

  if (officialStatus === "declined" || officialStatus === "canceled") {
    const { error: failError } = await supabaseAdmin.rpc("institut_echouer_paiement", { p_transaction_id: String(transactionId) });
    if (failError) {
      log("error", "Mise à jour du paiement Institut impossible", { transactionId, error: failError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };
    }
    return { status: 200, body: { received: true, status: "echoue" } };
  }

  return { status: 200, body: { received: true, status: "en_attente" } };
}
