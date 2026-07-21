// =========================================================
// /api/fedapay-webhook.js — Version sécurisée (production)
//
// Principe de sécurité central : le corps du webhook n'est JAMAIS
// utilisé comme source de vérité pour le statut ou le montant.
// Une fois la signature validée, seul l'identifiant de transaction
// est retenu ; le statut et le montant réels sont ensuite
// redemandés directement à l'API FedaPay (Transaction.retrieve).
//
// Variables d'environnement Vercel attendues :
//   FEDAPAY_SECRET_KEY       (clé secrète API — déjà utilisée par fedapay-checkout.js)
//   FEDAPAY_WEBHOOK_SECRET   (clé secrète de l'endpoint webhook — Workbench > Webhooks > Click to reveal)
//   FEDAPAY_ENVIRONMENT      ("sandbox" ou "live")
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// À configurer dans le tableau de bord FedaPay comme URL de webhook :
//   https://TON-SITE.vercel.app/api/fedapay-webhook
// =========================================================

import fedapayPkg from "fedapay";
const { FedaPay, Transaction, Webhook } = fedapayPkg;

// Empêche Vercel de parser le corps automatiquement : la vérification
// de signature FedaPay exige le corps BRUT, octet pour octet.
export const config = {
  api: { bodyParser: false }
};

function log(level, message, extra = {}) {
  const entry = { level, message, time: new Date().toISOString(), ...extra };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    log("error", "Méthode non autorisée sur le webhook", { method: req.method });
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const secretKey = process.env.FEDAPAY_SECRET_KEY;
  const endpointSecret = process.env.FEDAPAY_WEBHOOK_SECRET;
  const environment = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";

  if (!secretKey || !endpointSecret) {
    log("error", "FEDAPAY_SECRET_KEY ou FEDAPAY_WEBHOOK_SECRET manquant sur Vercel");
    return res.status(500).json({ error: "Configuration serveur incomplète" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log("error", "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant sur Vercel");
    return res.status(500).json({ error: "Configuration serveur incomplète" });
  }

  // ---------------------------------------------------------
  // 1. Lire le corps BRUT (indispensable pour la signature)
  // ---------------------------------------------------------
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    log("error", "Corps de requête illisible", { error: err.message });
    return res.status(400).json({ error: "Corps de requête illisible" });
  }

  const signatureHeader = req.headers["x-fedapay-signature"];
  if (!signatureHeader) {
    log("error", "En-tête X-FEDAPAY-SIGNATURE absent — requête rejetée d'office");
    return res.status(400).json({ error: "Signature manquante" });
  }

  // ---------------------------------------------------------
  // 2. Vérifier la signature (rejette tout appel forgé) —
  //    la librairie officielle FedaPay vérifie aussi l'horodatage
  //    inclus dans la signature pour bloquer les attaques par rejeu.
  // ---------------------------------------------------------
  let event;
  try {
    event = Webhook.constructEvent(rawBody, signatureHeader, endpointSecret);
  } catch (err) {
    log("error", "Signature de webhook invalide — requête rejetée", { error: err.message });
    return res.status(400).json({ error: "Signature invalide" });
  }

  const eventType = event.name || event.type;
  let entity = event.entity;
  if (typeof entity === "string") {
    try { entity = JSON.parse(entity); } catch { entity = null; }
  }
  const transactionId = entity && entity.id;

  if (!transactionId) {
    log("error", "Webhook signé valide mais sans identifiant de transaction exploitable", { eventType });
    return res.status(400).json({ error: "Transaction introuvable dans l'événement" });
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ---------------------------------------------------------
  // 3. Protection contre le rejeu / traitement en double :
  //    chaque événement FedaPay (event.id) n'est traité qu'une fois.
  //    La contrainte d'unicité de webhook_events fait le travail.
  // ---------------------------------------------------------
  const eventId = String(event.id || `${eventType}:${transactionId}`);
  const { error: dedupError } = await supabaseAdmin
    .from("webhook_events")
    .insert({ id: eventId, event_type: eventType });

  if (dedupError) {
    if (dedupError.code === "23505") {
      log("info", "Événement déjà traité — ignoré (idempotence)", { eventId, eventType });
      return res.status(200).json({ received: true, duplicate: true });
    }
    log("error", "Impossible d'enregistrer l'événement (dédoublonnage)", { eventId, error: dedupError.message });
    // On continue : le contrôle de statut plus bas (étape 6) empêche
    // de toute façon un double crédit du paiement.
  }

  // ---------------------------------------------------------
  // 4. Ne jamais faire confiance au corps du webhook pour le statut
  //    ou le montant : on les redemande à l'API officielle FedaPay,
  //    à partir du seul identifiant de transaction (déjà authentifié
  //    par la signature ci-dessus).
  // ---------------------------------------------------------
  FedaPay.setApiKey(secretKey);
  FedaPay.setEnvironment(environment);

  let officialTransaction;
  try {
    officialTransaction = await Transaction.retrieve(transactionId);
  } catch (err) {
    log("error", "Échec de vérification de la transaction auprès de FedaPay", { transactionId, error: err.message });
    return res.status(502).json({ error: "Vérification FedaPay impossible" });
  }

  const officialStatus = officialTransaction.status;
  const officialAmount = Number(officialTransaction.amount);

  // ---------------------------------------------------------
  // 5. Retrouver l'achat correspondant, créé par notre propre
  //    fonction fedapay-checkout.js au moment de la demande de paiement.
  // ---------------------------------------------------------
  const { data: purchase, error: purchaseError } = await supabaseAdmin
    .from("purchases")
    .select("*")
    .eq("fedapay_transaction_id", String(transactionId))
    .maybeSingle();

  if (purchaseError || !purchase) {
    log("error", "Transaction FedaPay valide mais introuvable dans purchases — rejetée", {
      transactionId, error: purchaseError && purchaseError.message
    });
    return res.status(404).json({ error: "Achat correspondant introuvable" });
  }

  // ---------------------------------------------------------
  // 6. Un paiement déjà validé ne doit jamais être re-traité
  //    (protection anti double-crédit, indépendante du dédoublonnage d'événement)
  // ---------------------------------------------------------
  if (purchase.status === "paid") {
    log("info", "Achat déjà marqué payé — aucune action supplémentaire", { transactionId, purchaseId: purchase.id });
    return res.status(200).json({ received: true, already_paid: true });
  }

  // ---------------------------------------------------------
  // 7. Le montant réellement payé doit correspondre EXACTEMENT
  //    au montant attendu enregistré lors de la création du paiement.
  // ---------------------------------------------------------
  if (officialAmount !== Number(purchase.amount)) {
    log("error", "Montant FedaPay différent du montant attendu — paiement rejeté", {
      transactionId, purchaseId: purchase.id, expected: purchase.amount, received: officialAmount
    });
    await supabaseAdmin
      .from("purchases")
      .update({ status: "failed", fedapay_status: officialStatus })
      .eq("id", purchase.id);
    return res.status(400).json({ error: "Montant incohérent — paiement rejeté" });
  }

  // ---------------------------------------------------------
  // 8. Mise à jour du statut réel — uniquement à partir de la
  //    réponse de l'API FedaPay, jamais du corps du webhook.
  //    La clause .eq("user_id", ...) garantit qu'on ne modifie que
  //    la ligne appartenant réellement à l'utilisateur concerné.
  // ---------------------------------------------------------
  let newStatus = "pending";
  if (officialStatus === "approved") newStatus = "paid";
  else if (officialStatus === "declined" || officialStatus === "canceled") newStatus = "failed";

  const updatePayload = { status: newStatus, fedapay_status: officialStatus };
  if (newStatus === "paid") updatePayload.paid_at = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("purchases")
    .update(updatePayload)
    .eq("id", purchase.id)
    .eq("user_id", purchase.user_id);

  if (updateError) {
    log("error", "Échec de mise à jour de l'achat", { transactionId, purchaseId: purchase.id, error: updateError.message });
    return res.status(500).json({ error: "Mise à jour impossible" });
  }

  log("info", "Paiement traité avec succès", {
    transactionId, purchaseId: purchase.id, userId: purchase.user_id, status: newStatus
  });

  // FedaPay attend une réponse 2xx rapide.
  return res.status(200).json({ received: true, status: newStatus });
}
