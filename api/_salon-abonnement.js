// =========================================================
// /api/_salon-abonnement.js — logique serveur de l'abonnement par forfaits des SALONS payants
//
// Helper NON exposé comme fonction Vercel (préfixe "_") : la limite de 12 fonctions du plan Hobby est
// atteinte. Appelé par :
//   - api/fedapay-checkout.js  quand productType === "salon" ET que le salon est en mode abonnement
//                              (rooms.abonnement = true). Les salons qui ne sont pas en mode abonnement
//                              suivent l'ancien chemin (achat à vie), strictement inchangé.
//   - api/fedapay-webhook.js   quand aucune ligne « purchases » ni commande Sérigraphe / vitrine ne correspond.
//
// Principe de sécurité (argent) :
//   - le navigateur n'envoie QUE { courseId (le salon), productType: "salon", forfaitCode } : le montant et
//     le nombre de jours sont relus ici dans salon_forfaits (clé service_role) ; un forfait inactif ou
//     inconnu est refusé ;
//   - un membre à VIE (achat « paid » existant), le créateur du salon et un administrateur ont déjà accès :
//     AUCUN paiement d'abonnement n'est créé pour eux (409) ;
//   - un paiement d'abonnement ne crée JAMAIS de ligne « purchases » (sinon il deviendrait un accès à vie) :
//     il est enregistré dans salon_paiements ;
//   - la prolongation dépend UNIQUEMENT du webhook : signature vérifiée et transaction relue chez FedaPay
//     par api/fedapay-webhook.js, puis montant comparé à l'instantané enregistré, puis fonction SQL
//     atomique et idempotente salon_confirmer_paiement.
//
// Variables d'environnement Vercel : les mêmes que fedapay-checkout.js (aucune nouvelle variable).
// =========================================================

export const FORFAIT_CODE_RE = /^[a-z0-9_-]{2,30}$/;
export const MAX_PENDING_PER_HOUR = 5;
const PRIVILEGED_ROLES = ["admin", "super_admin", "founder"];

/** Forfait achetable : actif, entiers strictement positifs. */
export function isPurchasable(f) {
  return !!f && f.actif === true && Number.isInteger(f.jours) && f.jours > 0 && Number.isInteger(f.montant) && f.montant > 0;
}

function fail(res, status, error) { return res.status(status).json({ error }); }

// ---------------------------------------------------------
// Checkout d'un abonnement. Appelé APRÈS l'authentification de l'utilisateur et la lecture du salon par
// fedapay-checkout.js. ctx : { supabaseAdmin, user, room, brandName, siteUrl, fetch?, now? }
// ---------------------------------------------------------
export async function handleSalonCheckout(req, res, ctx) {
  try {
    const { supabaseAdmin, user, room } = ctx;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const forfaitCode = typeof body.forfaitCode === "string" ? body.forfaitCode : "";
    if (!FORFAIT_CODE_RE.test(forfaitCode)) return fail(res, 400, "Choisissez un forfait.");

    // Déjà accès : créateur du salon, administrateur, membre à vie → aucun paiement d'abonnement.
    if (room.created_by === user.id) return fail(res, 409, "Vous avez déjà accès à ce salon.");

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("username, role").eq("id", user.id).maybeSingle();
    if (profile && PRIVILEGED_ROLES.includes(profile.role)) return fail(res, 409, "Vous avez déjà accès à ce salon.");

    const { data: lifetime, error: lifetimeError } = await supabaseAdmin
      .from("purchases").select("id")
      .eq("user_id", user.id).eq("course_id", room.id).eq("product_type", "salon").eq("status", "paid").maybeSingle();
    if (lifetimeError) { console.error("Lecture achat à vie impossible :", lifetimeError.message); return fail(res, 500, "Erreur serveur."); }
    if (lifetime) return fail(res, 409, "Vous avez déjà accès à vie à ce salon : aucun abonnement n'est nécessaire.");

    // Le montant et les jours viennent de la base. Forfait inconnu ou inactif : refusé.
    const { data: forfait, error: forfaitError } = await supabaseAdmin
      .from("salon_forfaits").select("code, libelle, jours, montant, actif").eq("code", forfaitCode).maybeSingle();
    if (forfaitError) { console.error("Lecture forfait impossible :", forfaitError.message); return fail(res, 500, "Erreur serveur."); }
    if (!isPurchasable(forfait)) return fail(res, 400, "Ce forfait n'est pas disponible.");

    // Plafond de paiements en attente récents pour ce membre et ce salon (anti-abus)
    const sinceIso = new Date((ctx.now || Date.now()) - 60 * 60 * 1000).toISOString();
    const { count: pendingCount, error: pendingError } = await supabaseAdmin
      .from("salon_paiements").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("room_id", room.id).eq("statut", "en_attente").gte("cree_le", sinceIso);
    if (pendingError) { console.error("Comptage des paiements en attente impossible :", pendingError.message); return fail(res, 500, "Erreur serveur."); }
    if ((pendingCount || 0) >= MAX_PENDING_PER_HOUR) {
      res.setHeader("Retry-After", "3600");
      return fail(res, 429, "Trop de tentatives de paiement en attente. Patiente environ une heure ou termine un paiement déjà commencé.");
    }

    const secretKey = process.env.FEDAPAY_SECRET_KEY;
    if (!secretKey) { console.error("FEDAPAY_SECRET_KEY manquant sur Vercel."); return fail(res, 500, "Configuration de paiement incomplète."); }
    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = String(ctx.siteUrl || process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`).replace(/\/+$/, "");
    const doFetch = ctx.fetch || fetch;

    const firstname = (profile && profile.username) || "Client";
    const customer = user.email ? { firstname, lastname: firstname, email: user.email } : undefined;

    let createData;
    try {
      const createResp = await doFetch(`${baseUrl}/transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `${ctx.brandName || "MAHOUTO+"} Communautés — ${String(room.name || "Salon").slice(0, 60)} (${String(forfait.libelle).slice(0, 40)})`,
          amount: forfait.montant,
          currency: { iso: "XOF" },
          // Retour DANS le salon ; le paramètre n'ouvre jamais l'accès (seul le webhook prolonge l'abonnement).
          callback_url: `${siteUrl}/chat.html?room=${encodeURIComponent(room.id)}&payment=return`,
          ...(customer ? { customer } : {})
        })
      });
      createData = await createResp.json();
      if (!createResp.ok) { console.error("Erreur création transaction FedaPay (salon) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }
    } catch (e) {
      console.error("FedaPay injoignable (salon) :", e);
      return fail(res, 502, "Impossible de créer le paiement.");
    }

    const txObj = createData["v1/transaction"] || createData.transaction || createData;
    const transactionId = txObj && txObj.id;
    if (!transactionId) { console.error("Réponse FedaPay inattendue (salon) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }

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
      if (!checkoutUrl) { console.error("URL de paiement FedaPay absente (salon)"); return fail(res, 502, "Impossible de générer le lien de paiement."); }
    }

    // Instantané serveur du forfait. Si l'écriture échoue, la transaction FedaPay est orpheline :
    // on refuse d'envoyer le membre payer.
    const { error: insertError } = await supabaseAdmin.from("salon_paiements").insert({
      user_id: user.id,
      room_id: room.id,
      forfait_code: forfait.code,
      jours: forfait.jours,
      montant: forfait.montant,
      fedapay_transaction_id: String(transactionId),
      statut: "en_attente"
    });
    if (insertError) {
      console.error("ÉCHEC enregistrement du paiement — transaction FedaPay orpheline :", transactionId, insertError.message);
      return fail(res, 500, "Impossible d'enregistrer le paiement. Réessayez dans un instant.");
    }

    return res.status(200).json({ checkoutUrl, transactionId });
  } catch (err) {
    console.error("Erreur serveur checkout salon (abonnement) :", err);
    return fail(res, 500, "Erreur serveur lors de la création du paiement.");
  }
}

// ---------------------------------------------------------
// Webhook — appelé par fedapay-webhook.js APRÈS la vérification de signature et la relecture de la
// transaction chez FedaPay (statut et montant officiels passés en argument ; rien n'est lu dans le corps
// du webhook). Renvoie null si aucun paiement d'abonnement de salon ne correspond, sinon { status, body }.
// ---------------------------------------------------------
export async function handleSalonWebhook(supabaseAdmin, { transactionId, officialStatus, officialAmount, log }) {
  const { data: paiement, error } = await supabaseAdmin
    .from("salon_paiements").select("id, statut, montant").eq("fedapay_transaction_id", String(transactionId)).maybeSingle();
  if (error) {
    log("error", "Lecture de salon_paiements impossible", { transactionId, error: error.message });
    return null;
  }
  if (!paiement) return null;

  if (paiement.statut === "confirme") {
    log("info", "Paiement d'abonnement de salon déjà confirmé — aucune action supplémentaire", { transactionId });
    return { status: 200, body: { received: true, already_confirmed: true } };
  }

  if (officialStatus === "approved" || officialStatus === "transferred") {
    // Le montant réellement payé doit correspondre EXACTEMENT à l'instantané enregistré au checkout
    if (!Number.isInteger(officialAmount) || officialAmount !== Number(paiement.montant)) {
      log("error", "Montant FedaPay différent du forfait enregistré — paiement rejeté", {
        transactionId, expected: paiement.montant, received: officialAmount
      });
      await supabaseAdmin.rpc("salon_echouer_paiement", { p_transaction_id: String(transactionId) });
      return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    }
    const { data, error: rpcError } = await supabaseAdmin.rpc("salon_confirmer_paiement", {
      p_transaction_id: String(transactionId), p_montant: officialAmount
    });
    if (rpcError) {
      log("error", "Confirmation du paiement d'abonnement impossible", { transactionId, error: rpcError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };   // 5xx : FedaPay réessaiera
    }
    const resultat = data && data.resultat;
    if (resultat === "confirme") {
      log("info", "Paiement d'abonnement de salon confirmé — abonnement prolongé", { transactionId });
      return { status: 200, body: { received: true, status: "confirme" } };
    }
    if (resultat === "deja_confirme") return { status: 200, body: { received: true, already_confirmed: true } };
    if (resultat === "montant_incoherent") return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    log("error", "Paiement d'abonnement de salon ignoré (état inattendu)", { transactionId, resultat });
    return { status: 200, body: { received: true, status: "ignore" } };
  }

  if (officialStatus === "declined" || officialStatus === "canceled") {
    const { error: failError } = await supabaseAdmin.rpc("salon_echouer_paiement", { p_transaction_id: String(transactionId) });
    if (failError) {
      log("error", "Mise à jour du paiement d'abonnement impossible", { transactionId, error: failError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };
    }
    return { status: 200, body: { received: true, status: "echoue" } };
  }

  return { status: 200, body: { received: true, status: "en_attente" } };   // pending / waiting : rien à faire
}
