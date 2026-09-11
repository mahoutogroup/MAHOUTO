// =========================================================
// /api/fedapay-checkout.js — Version sécurisée (production)
//
// PRINCIPE CENTRAL : le navigateur ne décide plus RIEN de financier.
// Il envoie uniquement { courseId }. Le serveur :
//   - authentifie l'appelant via son jeton Supabase (Authorization: Bearer)
//   - récupère la formation réelle dans "formations" (nom, prix, dispo)
//   - calcule le montant officiel lui-même
//   - crée la transaction FedaPay avec CE montant, jamais celui du client
//
// Variables d'environnement Vercel attendues :
//   FEDAPAY_SECRET_KEY
//   FEDAPAY_ENVIRONMENT ("sandbox" ou "live", défaut "sandbox")
//   SUPABASE_URL
//   SUPABASE_ANON_KEY            (pour authentifier le jeton de l'appelant)
//   SUPABASE_SERVICE_ROLE_KEY    (pour lire "formations" / écrire "purchases")
//   PUBLIC_SITE_URL              (ex: https://mahouto.com — recommandé ;
//                                 à défaut, req.headers.host est utilisé,
//                                 ce qui reste fiable sur Vercel mais est
//                                 moins explicite)
// =========================================================

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    // -----------------------------------------------------
    // 1. Le navigateur ne fournit QUE courseId — tout le reste
    //    (montant, nom, identité) est ignoré même si envoyé.
    // -----------------------------------------------------
    const { courseId } = req.body || {};

    if (!courseId || typeof courseId !== "string" || courseId.length > 200) {
      return res.status(400).json({ error: "Identifiant de formation invalide." });
    }

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

    // -----------------------------------------------------
    // 2. Authentification obligatoire — jamais de userId client
    // -----------------------------------------------------
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return res.status(401).json({ error: "Session invalide ou expirée." });
    }
    const authenticatedUser = userData.user;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // -----------------------------------------------------
    // 3. Récupérer la formation réelle — le prix et le nom ne
    //    viennent QUE d'ici, jamais du navigateur.
    // -----------------------------------------------------
    const { data: formation, error: formationError } = await supabaseAdmin
      .from("formations")
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (formationError) {
      console.error("Erreur lecture formation :", formationError);
      return res.status(500).json({ error: "Impossible de vérifier cette formation." });
    }
    if (!formation) {
      return res.status(404).json({ error: "Formation introuvable." });
    }
    if (Object.prototype.hasOwnProperty.call(formation, "disponible") && formation.disponible === false) {
      return res.status(404).json({ error: "Cette formation n'est plus disponible." });
    }

    const officialAmount = Math.round(Number(formation.promotion ?? formation.prix));
    if (!Number.isFinite(officialAmount) || officialAmount <= 0) {
      console.error("Prix invalide pour la formation :", courseId, formation.promotion, formation.prix);
      return res.status(500).json({ error: "Le prix de cette formation est invalide." });
    }

    const courseName = formation.nom || "Formation MAHOUTO";

    // -----------------------------------------------------
    // 4. Empêcher un paiement inutile si déjà acheté (défense
    //    en profondeur ; school.html le fait déjà côté affichage)
    // -----------------------------------------------------
    const { data: existingPurchase } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", authenticatedUser.id)
      .eq("course_id", courseId)
      .eq("status", "paid")
      .maybeSingle();

    if (existingPurchase) {
      return res.status(409).json({ error: "Vous possédez déjà cette formation." });
    }

    // -----------------------------------------------------
    // 5. Identité du client FedaPay — depuis Supabase, jamais
    //    depuis un champ libre envoyé par le navigateur.
    // -----------------------------------------------------
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", authenticatedUser.id)
      .maybeSingle();

    const customerFirstname = (profile && profile.username) || "Client";
    const customerEmail = authenticatedUser.email || null;

    const customerPayload = customerEmail
      ? { firstname: customerFirstname, lastname: customerFirstname, email: customerEmail }
      : undefined;

    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;

    // -----------------------------------------------------
    // 6. Créer la transaction — montant officiel uniquement.
    //    Les champs sont à la RACINE de la requête (format réel
    //    de l'API REST FedaPay, sans wrapper "transaction").
    // -----------------------------------------------------
    const createResp = await fetch(`${baseUrl}/transactions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        description: `MAHOUTO School — ${courseName}`,
        amount: officialAmount,
        currency: { iso: "XOF" },
        callback_url: `${siteUrl}/school.html?payment=return&course=${encodeURIComponent(courseId)}`,
        ...(customerPayload ? { customer: customerPayload } : {})
      })
    });

    const createData = await createResp.json();
    if (!createResp.ok) {
      console.error("Erreur création transaction FedaPay :", createData);
      return res.status(502).json({ error: "Impossible de créer le paiement." });
    }

    // La forme réelle observée de la réponse FedaPay imbrique les données
    // sous la clé "v1/transaction" (confirmé par les logs de production).
    // On reste tolérant à d'autres formes possibles selon les comptes/versions.
    const txObj = createData["v1/transaction"] || createData.transaction || createData;
    const transactionId = txObj && txObj.id;
    if (!transactionId) {
      console.error("Réponse FedaPay inattendue (création) :", createData);
      return res.status(502).json({ error: "Impossible de créer le paiement." });
    }

    // -----------------------------------------------------
    // 7. Récupérer le lien de paiement — déjà présent dans la
    //    réponse de création (payment_url). On ne rappelle
    //    l'étape séparée de génération de token qu'en secours,
    //    si jamais ce champ venait à manquer.
    // -----------------------------------------------------
    let checkoutUrl = txObj && txObj.payment_url;

    if (!checkoutUrl) {
      const tokenResp = await fetch(`${baseUrl}/transactions/${transactionId}/token`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        }
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("Erreur génération token FedaPay :", tokenData);
        return res.status(502).json({ error: "Impossible de générer le lien de paiement." });
      }

      const tokenObj = tokenData["v1/token"] || tokenData.token || tokenData;
      checkoutUrl = tokenData.url || (tokenObj && tokenObj.url);

      if (!checkoutUrl) {
        console.error("URL de paiement absente de la réponse FedaPay :", tokenData);
        return res.status(502).json({ error: "Impossible de générer le lien de paiement." });
      }
    }

    // -----------------------------------------------------
    // 8. Enregistrer l'achat en attente — données serveur
    //    uniquement. Si cette écriture échoue, la transaction
    //    FedaPay existe déjà côté FedaPay mais resterait
    //    "orpheline" (le webhook ne la retrouverait jamais,
    //    donc l'achat ne pourrait jamais être crédité) : on
    //    refuse alors d'envoyer l'utilisateur payer plutôt que
    //    de promettre un achat qu'on ne pourra pas confirmer.
    // -----------------------------------------------------
    const { error: insertError } = await supabaseAdmin.from("purchases").insert({
      user_id: authenticatedUser.id,
      course_id: courseId,
      course_name: courseName,
      amount: officialAmount,
      fedapay_transaction_id: String(transactionId),
      status: "pending"
    });

    if (insertError) {
      console.error(
        "ÉCHEC enregistrement purchases — transaction FedaPay orpheline :",
        transactionId, insertError
      );
      return res.status(500).json({ error: "Impossible d'enregistrer l'achat. Réessayez dans un instant." });
    }

    return res.status(200).json({ checkoutUrl, transactionId });

  } catch (err) {
    console.error("Erreur serveur fedapay-checkout :", err);
    return res.status(500).json({ error: "Erreur serveur lors de la création du paiement." });
  }
}
