// =========================================================
// /api/fedapay-checkout.js — Version sécurisée (production)
//
// Gère les FORMATIONS, les PRODUITS NUMÉRIQUES et les SALONS PAYANTS,
// avec exactement la même logique de sécurité : le navigateur
// n'envoie que { courseId, productType? }. Le serveur :
//   - authentifie l'appelant via son jeton Supabase (Authorization: Bearer)
//   - récupère le vrai article (formations OU digital_products OU rooms)
//   - calcule le montant officiel lui-même
//   - crée la transaction FedaPay avec CE montant, jamais celui du client
//
// productType vaut "formation" (défaut, rétrocompatible avec
// l'existant), "digital_product" ou "salon". Toute la partie FedaPay
// (création de transaction, lecture de la réponse, génération
// du lien de paiement) est strictement identique dans tous les
// cas — seule la table lue pour trouver l'article change. L'accès
// réel au salon (lecture/écriture des messages) est ensuite imposé
// par les policies RLS sur "messages", pas par ce fichier : ce
// fichier ne fait qu'enregistrer l'achat une fois payé.
//
// Variables d'environnement Vercel attendues :
//   FEDAPAY_SECRET_KEY
//   FEDAPAY_ENVIRONMENT ("sandbox" ou "live", défaut "sandbox")
//   SUPABASE_URL
//   SUPABASE_ANON_KEY            (pour authentifier le jeton de l'appelant)
//   SUPABASE_SERVICE_ROLE_KEY    (pour lire les tables / écrire "purchases")
//   PUBLIC_SITE_URL              (ex: https://mahouto.com — recommandé ;
//                                 à défaut, req.headers.host est utilisé)
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
    // 1. Le navigateur ne fournit QUE courseId (+ productType
    //    facultatif) — tout le reste (montant, nom, identité)
    //    est ignoré même si envoyé.
    // -----------------------------------------------------
    const { courseId, productType: rawProductType } = req.body || {};
    const productType =
      rawProductType === "digital_product" ? "digital_product" :
      rawProductType === "salon" ? "salon" :
      "formation";

    if (!courseId || typeof courseId !== "string" || courseId.length > 200) {
      return res.status(400).json({ error: "Identifiant d'article invalide." });
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
    // 3. Récupérer le véritable article — le prix et le nom ne
    //    viennent QUE d'ici, jamais du navigateur. La table
    //    dépend de productType, tout le reste est identique.
    // -----------------------------------------------------
    const tableName =
      productType === "digital_product" ? "digital_products" :
      productType === "salon" ? "rooms" :
      "formations";

    const { data: article, error: articleError } = await supabaseAdmin
      .from(tableName)
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (articleError) {
      console.error(`Erreur lecture ${tableName} :`, articleError);
      return res.status(500).json({ error: "Impossible de vérifier cet article." });
    }
    if (!article) {
      return res.status(404).json({ error: "Article introuvable." });
    }
    if (Object.prototype.hasOwnProperty.call(article, "disponible") && article.disponible === false) {
      return res.status(404).json({ error: "Cet article n'est plus disponible." });
    }
    if (productType === "salon" && article.is_paid !== true) {
      // Défense en profondeur : on refuse de faire payer l'accès à un
      // salon que l'admin n'a pas explicitement marqué comme payant.
      return res.status(404).json({ error: "Ce salon n'est pas payant." });
    }

    const officialAmount = productType === "salon"
      ? Math.round(Number(article.price))
      : Math.round(Number(article.promotion ?? article.prix));
    if (!Number.isFinite(officialAmount) || officialAmount <= 0) {
      console.error("Prix invalide pour l'article :", courseId, article.promotion, article.prix, article.price);
      return res.status(500).json({ error: "Le prix de cet article est invalide." });
    }

    const articleName = productType === "salon"
      ? (article.name || "Salon MAHOUTO+")
      : (article.nom || (productType === "digital_product" ? "Produit MAHOUTO+" : "Formation MAHOUTO"));

    // -----------------------------------------------------
    // 4. Empêcher un paiement inutile si déjà acheté (défense
    //    en profondeur ; l'affichage le fait déjà côté client)
    // -----------------------------------------------------
    const { data: existingPurchase } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", authenticatedUser.id)
      .eq("course_id", courseId)
      .eq("product_type", productType)
      .eq("status", "paid")
      .maybeSingle();

    if (existingPurchase) {
      return res.status(409).json({ error: "Vous possédez déjà cet article." });
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

    // La page de retour et le libellé dépendent du type d'article
    // et, pour une formation, de sa plateforme d'origine.
    let returnPage;
    let platformLabel;
    if (productType === "digital_product") {
      returnPage = "produits.html";
      platformLabel = "MAHOUTO+ Boutique";
    } else if (productType === "salon") {
      returnPage = "discussions.html";
      platformLabel = "MAHOUTO+ Salons";
    } else {
      returnPage = article.provider === "academie_majestepresse" ? "academie-majestepresse.html" : "school.html";
      platformLabel = article.provider === "academie_majestepresse" ? "Académie Majesté Presse" : "MAHOUTO School";
    }

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
        description: `${platformLabel} — ${articleName}`,
        amount: officialAmount,
        currency: { iso: "XOF" },
        callback_url: `${siteUrl}/${returnPage}?payment=return&course=${encodeURIComponent(courseId)}&type=${productType}`,
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
    //    "orpheline" : on refuse alors d'envoyer l'utilisateur
    //    payer plutôt que de promettre un achat qu'on ne pourra
    //    pas confirmer.
    // -----------------------------------------------------
    const { error: insertError } = await supabaseAdmin.from("purchases").insert({
      user_id: authenticatedUser.id,
      course_id: courseId,
      course_name: articleName,
      product_type: productType,
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
