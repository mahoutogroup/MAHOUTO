// =========================================================
// /api/_entreprise-abonnement.js — logique serveur de l'abonnement des vitrines d'entreprise
//
// Helper NON exposé comme fonction Vercel (préfixe "_") : la limite de 12 fonctions du plan
// Hobby est déjà atteinte. Il est appelé par :
//   - api/fedapay-checkout.js  quand body.productType === "entreprise"
//                              (actions : "info", "status", "checkout")
//   - api/fedapay-webhook.js   quand aucune ligne « purchases » ni commande Sérigraphe ne correspond
//
// Principe de sécurité (argent) :
//   - le navigateur n'envoie QUE { entrepriseId, forfaitCode } : le montant et le nombre de jours sont
//     relus ici dans entreprise_forfaits (clé service_role), jamais pris du navigateur ; un forfait
//     inactif ou inconnu est refusé ;
//   - la prolongation de l'abonnement dépend UNIQUEMENT du webhook : signature vérifiée et transaction
//     relue chez FedaPay par api/fedapay-webhook.js, puis montant comparé à l'instantané enregistré,
//     puis fonction SQL atomique et idempotente entreprise_confirmer_paiement ;
//   - « status » ne renvoie qu'un booléen ; le retour du navigateur sur la page n'ouvre jamais rien.
//
// Le paiement se fait SANS compte (le commerçant reçoit un lien) : pas d'authentification, mais une
// limite par adresse IP et un plafond de paiements en attente par vitrine.
//
// Variables d'environnement Vercel : les mêmes que fedapay-checkout.js
//   FEDAPAY_SECRET_KEY, FEDAPAY_ENVIRONMENT ("sandbox" ou "live"), SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, PUBLIC_SITE_URL
// =========================================================

import { createClient } from "@supabase/supabase-js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FORFAIT_CODE_RE = /^[a-z0-9_-]{2,30}$/;

// Limites (modifiables ici). En mémoire par instance Vercel : premier filet, complété par le plafond
// de paiements en attente par vitrine (persistant, en base).
export const RATE_LIMITS = { checkout: { max: 10, windowMs: 10 * 60 * 1000 }, read: { max: 60, windowMs: 10 * 60 * 1000 } };
export const MAX_PENDING_PER_HOUR = 5;

const buckets = new Map();

function clientIp(req) {
  const fwd = req.headers && req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return (req.headers && req.headers["x-real-ip"]) || "unknown";
}

/** Vrai si la limite est dépassée (et compte la demande sinon). Exporté pour les tests. */
export function rateLimited(ip, kind, now = Date.now()) {
  const rule = RATE_LIMITS[kind] || RATE_LIMITS.read;
  const key = kind + ":" + ip;
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) b = { count: 0, resetAt: now + rule.windowMs };
  if (b.count >= rule.max) return true;
  b.count += 1;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return false;
}
export function _resetRateLimitsForTests() { buckets.clear(); }

/** Forfait achetable : actif, entiers strictement positifs. */
export function isPurchasable(f) {
  return !!f && f.actif === true && Number.isInteger(f.jours) && f.jours > 0 && Number.isInteger(f.montant) && f.montant > 0;
}

/** Abonnement en cours (offerte, ou expire_le dans le futur). */
export function isSubscriptionActive(row, now = Date.now()) {
  if (!row) return false;
  if (row.offerte === true) return true;
  const t = row.expire_le ? Date.parse(row.expire_le) : NaN;
  return Number.isFinite(t) && t > now;
}

function fail(res, status, error) { return res.status(status).json({ error }); }

function adminClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ---------------------------------------------------------
// Checkout : actions « info », « status » et « checkout » (défaut)
// ---------------------------------------------------------
export async function handleEntrepriseCheckout(req, res, deps = {}) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = body.action === "info" || body.action === "status" ? body.action : "checkout";

    // Entrées validées AVANT toute requête
    const entrepriseId = typeof body.entrepriseId === "string" ? body.entrepriseId : "";
    if (!UUID_RE.test(entrepriseId)) return fail(res, 400, "Lien de paiement invalide.");
    let forfaitCode = "";
    if (action === "checkout") {
      forfaitCode = typeof body.forfaitCode === "string" ? body.forfaitCode : "";
      if (!FORFAIT_CODE_RE.test(forfaitCode)) return fail(res, 400, "Forfait invalide.");
    }

    if (rateLimited(clientIp(req), action === "checkout" ? "checkout" : "read", deps.now)) {
      res.setHeader("Retry-After", "600");
      return fail(res, 429, "Trop de demandes. Réessayez dans quelques minutes.");
    }

    const supabaseAdmin = deps.supabaseAdmin || adminClient();
    if (!supabaseAdmin) {
      console.error("Configuration Supabase manquante sur Vercel.");
      return fail(res, 500, "Configuration serveur incomplète.");
    }

    const { data: entreprise, error: entError } = await supabaseAdmin
      .from("entreprises").select("id, nom_commercial, offerte, expire_le").eq("id", entrepriseId).maybeSingle();
    if (entError) {
      console.error("Lecture entreprise impossible :", entError.message);
      return fail(res, 500, "Erreur serveur.");
    }
    if (!entreprise) return fail(res, 404, "Vitrine introuvable.");

    // « status » : UN SEUL booléen, aucune date
    if (action === "status") return res.status(200).json({ actif: isSubscriptionActive(entreprise, deps.now) });

    // Forfaits actifs seulement (la base ne renvoie que ceux-là ; on revérifie par prudence)
    if (action === "info") {
      const { data: forfaits, error: fError } = await supabaseAdmin
        .from("entreprise_forfaits").select("code, libelle, jours, montant, actif, ordre").eq("actif", true).order("ordre", { ascending: true });
      if (fError) { console.error("Lecture forfaits impossible :", fError.message); return fail(res, 500, "Erreur serveur."); }
      const list = (forfaits || []).filter(isPurchasable).map((f) => ({ code: f.code, libelle: f.libelle, jours: f.jours, montant: f.montant }));
      return res.status(200).json({ entreprise: { nom_commercial: entreprise.nom_commercial || "Votre vitrine" }, forfaits: list });
    }

    // ----- checkout -----
    const secretKey = process.env.FEDAPAY_SECRET_KEY;
    if (!secretKey) {
      console.error("FEDAPAY_SECRET_KEY manquant sur Vercel.");
      return fail(res, 500, "Configuration de paiement incomplète.");
    }

    // Le montant et les jours viennent de la base. Forfait inconnu ou inactif : refusé.
    const { data: forfait, error: forfaitError } = await supabaseAdmin
      .from("entreprise_forfaits").select("code, libelle, jours, montant, actif").eq("code", forfaitCode).maybeSingle();
    if (forfaitError) { console.error("Lecture forfait impossible :", forfaitError.message); return fail(res, 500, "Erreur serveur."); }
    if (!isPurchasable(forfait)) return fail(res, 400, "Ce forfait n'est pas disponible.");

    // Plafond de paiements en attente récents pour cette vitrine (anti-abus, sans compte)
    const sinceIso = new Date((deps.now || Date.now()) - 60 * 60 * 1000).toISOString();
    const { count: pendingCount, error: pendingError } = await supabaseAdmin
      .from("entreprise_paiements").select("id", { count: "exact", head: true })
      .eq("entreprise_id", entrepriseId).eq("statut", "en_attente").gte("cree_le", sinceIso);
    if (pendingError) { console.error("Comptage des paiements en attente impossible :", pendingError.message); return fail(res, 500, "Erreur serveur."); }
    if ((pendingCount || 0) >= MAX_PENDING_PER_HOUR) {
      return fail(res, 429, "Trop de tentatives de paiement en attente. Patientez environ une heure ou terminez un paiement déjà commencé.");
    }

    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = (process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`).replace(/\/+$/, "");
    const doFetch = deps.fetch || fetch;

    let createData;
    try {
      const createResp = await doFetch(`${baseUrl}/transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `MAHOUTO+ — Abonnement vitrine (${String(forfait.libelle).slice(0, 60)})`,
          amount: forfait.montant,
          currency: { iso: "XOF" },
          callback_url: `${siteUrl}/abonnement.html?v=${encodeURIComponent(entrepriseId)}&retour=1`
        })
      });
      createData = await createResp.json();
      if (!createResp.ok) { console.error("Erreur création transaction FedaPay (vitrine) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }
    } catch (e) {
      console.error("FedaPay injoignable (vitrine) :", e);
      return fail(res, 502, "Impossible de créer le paiement.");
    }

    const txObj = createData["v1/transaction"] || createData.transaction || createData;
    const transactionId = txObj && txObj.id;
    if (!transactionId) { console.error("Réponse FedaPay inattendue (vitrine) :", createData); return fail(res, 502, "Impossible de créer le paiement."); }

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
      if (!checkoutUrl) { console.error("URL de paiement FedaPay absente (vitrine)"); return fail(res, 502, "Impossible de générer le lien de paiement."); }
    }

    // Instantané serveur du forfait. Si l'écriture échoue, la transaction FedaPay est orpheline :
    // on refuse d'envoyer le commerçant payer.
    const { error: insertError } = await supabaseAdmin.from("entreprise_paiements").insert({
      entreprise_id: entrepriseId,
      forfait_code: forfait.code,
      jours: forfait.jours,
      montant: forfait.montant,
      fedapay_transaction_id: String(transactionId),
      statut: "en_attente",
      source: "fedapay"
    });
    if (insertError) {
      console.error("ÉCHEC enregistrement du paiement — transaction FedaPay orpheline :", transactionId, insertError.message);
      return fail(res, 500, "Impossible d'enregistrer le paiement. Réessayez dans un instant.");
    }

    return res.status(200).json({ checkoutUrl, transactionId });
  } catch (err) {
    console.error("Erreur serveur checkout vitrine :", err);
    return fail(res, 500, "Erreur serveur lors de la création du paiement.");
  }
}

// ---------------------------------------------------------
// Webhook — appelé par fedapay-webhook.js APRÈS la vérification de signature et la relecture de la
// transaction chez FedaPay (statut et montant officiels passés en argument ; rien n'est lu dans le
// corps du webhook). Renvoie null si aucun paiement de vitrine ne correspond (le webhook répond alors
// 404 comme avant), sinon { status, body }.
// ---------------------------------------------------------
export async function handleEntrepriseWebhook(supabaseAdmin, { transactionId, officialStatus, officialAmount, log }) {
  const { data: paiement, error } = await supabaseAdmin
    .from("entreprise_paiements").select("id, statut, montant, source").eq("fedapay_transaction_id", String(transactionId)).maybeSingle();
  if (error) {
    log("error", "Lecture de entreprise_paiements impossible", { transactionId, error: error.message });
    return null;
  }
  if (!paiement || paiement.source !== "fedapay") return null;

  // Déjà traité : jamais retraité (idempotent) — la fonction SQL le garantit aussi
  if (paiement.statut === "confirme") {
    log("info", "Paiement vitrine déjà confirmé — aucune action supplémentaire", { transactionId });
    return { status: 200, body: { received: true, already_confirmed: true } };
  }

  if (officialStatus === "approved" || officialStatus === "transferred") {
    // Le montant réellement payé doit correspondre EXACTEMENT à l'instantané enregistré au checkout
    if (!Number.isInteger(officialAmount) || officialAmount !== Number(paiement.montant)) {
      log("error", "Montant FedaPay différent du forfait enregistré — paiement rejeté", {
        transactionId, expected: paiement.montant, received: officialAmount
      });
      await supabaseAdmin.rpc("entreprise_echouer_paiement", { p_transaction_id: String(transactionId) });
      return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    }
    const { data, error: rpcError } = await supabaseAdmin.rpc("entreprise_confirmer_paiement", {
      p_transaction_id: String(transactionId), p_montant: officialAmount
    });
    if (rpcError) {
      log("error", "Confirmation du paiement vitrine impossible", { transactionId, error: rpcError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };   // 5xx : FedaPay réessaiera
    }
    const resultat = data && data.resultat;
    if (resultat === "confirme") {
      log("info", "Paiement vitrine confirmé — abonnement prolongé", { transactionId });
      return { status: 200, body: { received: true, status: "confirme" } };
    }
    if (resultat === "deja_confirme") return { status: 200, body: { received: true, already_confirmed: true } };
    if (resultat === "montant_incoherent") return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
    log("error", "Paiement vitrine ignoré (état inattendu)", { transactionId, resultat });
    return { status: 200, body: { received: true, ignored: true } };
  }

  if (officialStatus === "declined" || officialStatus === "canceled") {
    const { error: failError } = await supabaseAdmin.rpc("entreprise_echouer_paiement", { p_transaction_id: String(transactionId) });
    if (failError) {
      log("error", "Mise à jour du paiement vitrine impossible", { transactionId, error: failError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };
    }
    return { status: 200, body: { received: true, status: "echoue" } };
  }

  return { status: 200, body: { received: true, status: "en_attente" } };   // pending / waiting : rien à faire
}
