// =========================================================
// /api/_serigraphie.js — logique serveur du Sérigraphe (PR 2)
//
// Helper NON exposé comme fonction Vercel (préfixe "_") : la limite de
// 12 Serverless Functions du plan Hobby est déjà atteinte. Il est appelé par :
//   - api/fedapay-checkout.js  quand body.productType === "serigraphie"
//   - api/fedapay-webhook.js   quand aucune ligne "purchases" ne correspond
//
// Principe de sécurité (argent) : le navigateur n'envoie JAMAIS de prix, de
// total, de commission ni de statut. Tout est recalculé ici depuis la base
// avec la clé service_role : produit, vendeur, taux de commission, zone de
// livraison. Le webhook ne lit jamais le statut ni le montant dans son corps
// (le fichier appelant les a déjà redemandés à l'API FedaPay).
//
// Variables d'environnement Vercel : les mêmes que fedapay-checkout.js
//   FEDAPAY_SECRET_KEY, FEDAPAY_ENVIRONMENT, SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY, PUBLIC_SITE_URL
// =========================================================

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\+?[0-9 ().-]{6,25}$/;           // même format que serigraphie_vendors.whatsapp
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_QTY = 1000;
const MAX_TOTAL = 100000000;                         // garde-fou : 100 M FCFA

// ---------------------------------------------------------
// Calcul des montants (entiers FCFA, arrondi au plus proche, 0,5 vers le haut) :
//   sous_total        = prix unitaire x quantité
//   commission_amount = round(sous_total x taux / 100)      (sous-total produits uniquement)
//   vendor_amount     = sous_total - commission_amount
//   total             = sous_total + frais de livraison      (la livraison revient à MAJESTÉ PRESSE)
// Arithmétique entière (BigInt, taux en centièmes de pour cent) : aucune erreur de virgule flottante.
// ---------------------------------------------------------
export function computeAmounts({ price, qty, deliveryFee, commissionRate }) {
  const rate = Number(commissionRate);
  if (!Number.isInteger(price) || price <= 0) throw new Error("Prix invalide");
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantité invalide");
  if (!Number.isInteger(deliveryFee) || deliveryFee < 0) throw new Error("Frais de livraison invalides");
  if (!Number.isFinite(rate) || rate < 0 || rate > 50) throw new Error("Taux de commission invalide");

  const subtotal = price * qty;
  const rateHundredths = Math.round(rate * 100);                      // 12,5 % -> 1250
  const commission = Number((BigInt(subtotal) * BigInt(rateHundredths) + 5000n) / 10000n);
  const vendorAmount = subtotal - commission;
  const total = subtotal + deliveryFee;
  return { subtotal, commissionAmount: commission, vendorAmount, deliveryFee, total };
}

// ---------------------------------------------------------
// Validation de l'entrée navigateur. Tout champ de prix / total / statut
// éventuellement envoyé est ignoré : il n'est même pas lu.
// ---------------------------------------------------------
function cleanText(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "").trim() : "";
}

export function validateOrderInput(body) {
  const b = body || {};

  if (typeof b.productId !== "string" || !UUID_RE.test(b.productId)) return { error: "Produit invalide." };
  if (typeof b.zoneId !== "string" || !UUID_RE.test(b.zoneId)) return { error: "Choisissez une zone de livraison." };
  if (typeof b.qty !== "number" || !Number.isInteger(b.qty) || b.qty < 1 || b.qty > MAX_QTY) {
    return { error: "Quantité invalide (entier entre 1 et " + MAX_QTY + ")." };
  }

  let color = null;
  if (b.color !== undefined && b.color !== null && b.color !== "") {
    if (typeof b.color !== "string") return { error: "Couleur invalide." };
    color = cleanText(b.color);
    if (!color || color.length > 30) return { error: "Couleur invalide." };
  }

  const name = cleanText(b.name);
  const phone = cleanText(b.phone);
  const address = cleanText(b.address);
  const notes = cleanText(b.notes);

  if (name.length < 2 || name.length > 80) return { error: "Indiquez votre nom (2 à 80 caractères)." };
  if (!PHONE_RE.test(phone)) return { error: "Numéro de téléphone invalide. Exemple : +229 01 02 03 04." };
  if (address.length < 5 || address.length > 300) return { error: "Indiquez votre adresse de livraison (5 à 300 caractères)." };
  if (notes.length > 500) return { error: "Les notes sont limitées à 500 caractères." };

  return {
    value: { productId: b.productId, zoneId: b.zoneId, qty: b.qty, color, name, phone, address, notes: notes || null }
  };
}

// Marque une commande « failed » (seulement si elle est encore « pending »).
async function markFailed(supabaseAdmin, orderId) {
  const { error } = await supabaseAdmin
    .from("serigraphie_orders")
    .update({ status: "failed" })
    .eq("id", orderId)
    .eq("status", "pending");
  if (error) console.error("Impossible de marquer la commande en échec :", orderId, error.message);
}

// =========================================================
// CHECKOUT — appelé par fedapay-checkout.js (productType "serigraphie")
// Renvoie { checkoutUrl, transactionId, orderId }
// =========================================================
export async function handleSerigraphieCheckout(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const secretKey = process.env.FEDAPAY_SECRET_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("Configuration Supabase manquante sur Vercel.");
      return res.status(500).json({ error: "Configuration serveur incomplète." });
    }
    if (!secretKey) {
      console.error("FEDAPAY_SECRET_KEY manquant sur Vercel.");
      return res.status(500).json({ error: "Configuration de paiement incomplète." });
    }

    // 1. Connexion obligatoire — jamais de client_id envoyé par le navigateur
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentification requise." });

    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return res.status(401).json({ error: "Session invalide ou expirée." });
    }
    const user = userData.user;

    // 2. Entrée validée (aucun prix / total lu)
    const parsed = validateOrderInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const input = parsed.value;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // 3. Produit actif ET vendeur approuvé
    const { data: product, error: productError } = await supabaseAdmin
      .from("serigraphie_products").select("*").eq("id", input.productId).maybeSingle();
    if (productError) {
      console.error("Erreur lecture serigraphie_products :", productError);
      return res.status(500).json({ error: "Impossible de vérifier ce produit." });
    }
    if (!product || product.status !== "active") {
      return res.status(404).json({ error: "Ce produit n'est plus disponible." });
    }

    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("serigraphie_vendors").select("id, status, commission_rate").eq("id", product.vendor_id).maybeSingle();
    if (vendorError) {
      console.error("Erreur lecture serigraphie_vendors :", vendorError);
      return res.status(500).json({ error: "Impossible de vérifier ce produit." });
    }
    if (!vendor || vendor.status !== "approved") {
      return res.status(404).json({ error: "Ce produit n'est plus disponible." });
    }

    // 4. Quantité et couleur d'après le produit
    const minQty = Math.max(1, parseInt(product.min_qty, 10) || 1);
    if (input.qty < minQty) {
      return res.status(400).json({ error: "Quantité minimale : " + minQty + " pièces." });
    }
    const colors = Array.isArray(product.colors) ? product.colors : [];
    let color = null;
    if (colors.length) {
      if (!input.color || !colors.includes(input.color)) {
        return res.status(400).json({ error: "Choisissez une couleur proposée pour ce produit." });
      }
      color = input.color;
    }

    // 5. Zone de livraison active
    const { data: zone, error: zoneError } = await supabaseAdmin
      .from("serigraphie_delivery_zones").select("*").eq("id", input.zoneId).maybeSingle();
    if (zoneError) {
      console.error("Erreur lecture serigraphie_delivery_zones :", zoneError);
      return res.status(500).json({ error: "Impossible de vérifier la zone de livraison." });
    }
    if (!zone || zone.active !== true) {
      return res.status(400).json({ error: "Cette zone de livraison n'est pas disponible." });
    }

    // 6. Montants : recalculés ici, taux de commission figé au moment de la commande
    let amounts;
    try {
      amounts = computeAmounts({
        price: Number(product.price), qty: input.qty,
        deliveryFee: Number(zone.fee), commissionRate: vendor.commission_rate
      });
    } catch (calcError) {
      console.error("Calcul de commande impossible :", product.id, calcError.message);
      return res.status(500).json({ error: "Le prix de cet article est invalide." });
    }
    if (amounts.total <= 0 || amounts.total > MAX_TOTAL) {
      return res.status(400).json({ error: "Montant de commande invalide." });
    }

    // 7. Commande « pending » puis sa ligne
    const { data: order, error: orderError } = await supabaseAdmin
      .from("serigraphie_orders")
      .insert({
        client_id: user.id,
        vendor_id: vendor.id,
        status: "pending",
        total: amounts.total,
        delivery_zone: zone.name,
        delivery_fee: amounts.deliveryFee,
        payment_method: "fedapay",
        commission_rate: Number(vendor.commission_rate),
        commission_amount: amounts.commissionAmount,
        vendor_amount: amounts.vendorAmount,
        payout_status: "pending",
        delivery_address: input.address,
        client_name: input.name,
        client_phone: input.phone,
        notes: input.notes
      })
      .select("id")
      .single();
    if (orderError || !order) {
      console.error("Création de la commande impossible :", orderError);
      return res.status(500).json({ error: "Impossible d'enregistrer la commande. Réessayez dans un instant." });
    }

    const { error: itemError } = await supabaseAdmin.from("serigraphie_order_items").insert({
      order_id: order.id,
      product_id: product.id,
      qty: input.qty,
      unit_price: Number(product.price),
      color,
      product_name: String(product.name || "").slice(0, 120)
    });
    if (itemError) {
      console.error("Création de la ligne de commande impossible :", order.id, itemError);
      await markFailed(supabaseAdmin, order.id);
      return res.status(500).json({ error: "Impossible d'enregistrer la commande. Réessayez dans un instant." });
    }

    // 8. Transaction FedaPay — même format de requête que fedapay-checkout.js
    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;

    const nameParts = input.name.split(/\s+/);
    const customerPayload = user.email
      ? { firstname: nameParts[0], lastname: nameParts.slice(1).join(" ") || nameParts[0], email: user.email }
      : null;

    let createData;
    try {
      const createResp = await fetch(`${baseUrl}/transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `Le Sérigraphe — ${String(product.name || "").slice(0, 120)}`,
          amount: amounts.total,
          currency: { iso: "XOF" },
          callback_url: `${siteUrl}/serigraphie-confirmation.html?order=${encodeURIComponent(order.id)}`,
          ...(customerPayload ? { customer: customerPayload } : {})
        })
      });
      createData = await createResp.json();
      if (!createResp.ok) {
        console.error("Erreur création transaction FedaPay (Sérigraphe) :", createData);
        await markFailed(supabaseAdmin, order.id);
        return res.status(502).json({ error: "Impossible de créer le paiement." });
      }
    } catch (fetchError) {
      console.error("FedaPay injoignable (Sérigraphe) :", fetchError);
      await markFailed(supabaseAdmin, order.id);
      return res.status(502).json({ error: "Impossible de créer le paiement." });
    }

    const txObj = createData["v1/transaction"] || createData.transaction || createData;
    const transactionId = txObj && txObj.id;
    if (!transactionId) {
      console.error("Réponse FedaPay inattendue (Sérigraphe) :", createData);
      await markFailed(supabaseAdmin, order.id);
      return res.status(502).json({ error: "Impossible de créer le paiement." });
    }

    let checkoutUrl = txObj && txObj.payment_url;
    if (!checkoutUrl) {
      const tokenResp = await fetch(`${baseUrl}/transactions/${transactionId}/token`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secretKey}`, "Content-Type": "application/json" }
      });
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("Erreur génération token FedaPay (Sérigraphe) :", tokenData);
        await markFailed(supabaseAdmin, order.id);
        return res.status(502).json({ error: "Impossible de générer le lien de paiement." });
      }
      const tokenObj = tokenData["v1/token"] || tokenData.token || tokenData;
      checkoutUrl = tokenData.url || (tokenObj && tokenObj.url);
      if (!checkoutUrl) {
        console.error("URL de paiement absente de la réponse FedaPay (Sérigraphe) :", tokenData);
        await markFailed(supabaseAdmin, order.id);
        return res.status(502).json({ error: "Impossible de générer le lien de paiement." });
      }
    }

    // 9. Enregistrer la transaction. Si l'écriture échoue, la transaction FedaPay est
    //    orpheline : on refuse d'envoyer le client payer (comme fedapay-checkout.js).
    const { data: updated, error: linkError } = await supabaseAdmin
      .from("serigraphie_orders")
      .update({ fedapay_transaction_id: String(transactionId) })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("id");
    if (linkError || !updated || !updated.length) {
      console.error("ÉCHEC enregistrement de la transaction — transaction FedaPay orpheline :", transactionId, order.id, linkError);
      await markFailed(supabaseAdmin, order.id);
      return res.status(500).json({ error: "Impossible d'enregistrer la commande. Réessayez dans un instant." });
    }

    return res.status(200).json({ checkoutUrl, transactionId, orderId: order.id });

  } catch (err) {
    console.error("Erreur serveur checkout Sérigraphe :", err);
    return res.status(500).json({ error: "Erreur serveur lors de la création du paiement." });
  }
}

// =========================================================
// WEBHOOK — appelé par fedapay-webhook.js APRÈS la vérification de signature
// et la relecture de la transaction auprès de FedaPay (statut et montant
// officiels passés en argument ; rien n'est lu dans le corps du webhook).
// Renvoie null si aucune commande ne correspond (le webhook répond alors 404
// comme avant), sinon { status, body }.
// =========================================================
export async function handleSerigraphieWebhook(supabaseAdmin, { transactionId, officialStatus, officialAmount, log }) {
  const { data: order, error } = await supabaseAdmin
    .from("serigraphie_orders")
    .select("id, status, total")
    .eq("fedapay_transaction_id", String(transactionId))
    .maybeSingle();

  if (error) {
    log("error", "Lecture de serigraphie_orders impossible", { transactionId, error: error.message });
    return null;
  }
  if (!order) return null;

  // Déjà traitée : jamais re-traitée (idempotent)
  if (["paid", "preparing", "shipped", "delivered"].includes(order.status)) {
    log("info", "Commande Sérigraphe déjà payée — aucune action supplémentaire", { transactionId, orderId: order.id });
    return { status: 200, body: { received: true, already_paid: true } };
  }

  // Le montant réellement payé doit correspondre EXACTEMENT au total de la commande
  if (officialAmount !== Number(order.total)) {
    log("error", "Montant FedaPay différent du total de la commande — paiement rejeté", {
      transactionId, orderId: order.id, expected: order.total, received: officialAmount
    });
    await supabaseAdmin.from("serigraphie_orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending");
    return { status: 400, body: { error: "Montant incohérent — paiement rejeté" } };
  }

  if (officialStatus === "approved" || officialStatus === "transferred") {
    // Atomique : une seule livraison de l'événement peut faire passer pending -> paid
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("serigraphie_orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("id");

    if (updateError) {
      log("error", "Échec de mise à jour de la commande Sérigraphe", { transactionId, orderId: order.id, error: updateError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };
    }
    if (!updated || !updated.length) {
      const { data: again } = await supabaseAdmin.from("serigraphie_orders").select("status").eq("id", order.id).maybeSingle();
      if (again && ["paid", "preparing", "shipped", "delivered"].includes(again.status)) {
        return { status: 200, body: { received: true, already_paid: true } };
      }
      log("error", "PAIEMENT REÇU SUR UNE COMMANDE NON EN ATTENTE — vérification manuelle (remboursement ?)", {
        transactionId, orderId: order.id, orderStatus: again && again.status
      });
      return { status: 200, body: { received: true, ignored: true } };
    }
    log("info", "Paiement Sérigraphe traité avec succès", { transactionId, orderId: order.id, status: "paid" });
    return { status: 200, body: { received: true, status: "paid" } };
  }

  if (officialStatus === "declined" || officialStatus === "canceled") {
    const { error: failError } = await supabaseAdmin
      .from("serigraphie_orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending");
    if (failError) {
      log("error", "Échec de mise à jour de la commande Sérigraphe", { transactionId, orderId: order.id, error: failError.message });
      return { status: 500, body: { error: "Mise à jour impossible" } };
    }
    log("info", "Paiement Sérigraphe refusé ou annulé", { transactionId, orderId: order.id, status: "failed" });
    return { status: 200, body: { received: true, status: "failed" } };
  }

  return { status: 200, body: { received: true, status: "pending" } };   // pending / waiting : rien à faire
}
