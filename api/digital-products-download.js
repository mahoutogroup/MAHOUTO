// =========================================================
// /api/digital-products-download.js
//
// Génère une URL de téléchargement TEMPORAIRE et SIGNÉE pour un
// produit numérique, uniquement si l'utilisateur authentifié l'a
// réellement acheté (status = "paid" dans purchases).
//
// Le client ne reçoit JAMAIS file_path directement — seulement une
// URL signée à durée limitée générée par Supabase Storage, qui
// pointe vers un bucket privé ("digital-products", public: false).
//
// Variables d'environnement Vercel attendues (déjà utilisées par
// fedapay-checkout.js — aucune nouvelle variable nécessaire) :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";

const SIGNED_URL_TTL_SECONDS = 60 * 15; // 15 minutes

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { productId } = req.body || {};
    if (!productId || typeof productId !== "string" || productId.length > 200) {
      return res.status(400).json({ error: "Identifiant de produit invalide." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("Configuration Supabase manquante sur Vercel.");
      return res.status(500).json({ error: "Configuration serveur incomplète." });
    }

    // -----------------------------------------------------
    // 1. Authentification obligatoire
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
    // 2. Récupérer le produit réel
    // -----------------------------------------------------
    const { data: product, error: productError } = await supabaseAdmin
      .from("digital_products")
      .select("id, nom, disponible, file_path, file_name, mime_type")
      .eq("id", productId)
      .maybeSingle();

    if (productError) {
      console.error("Erreur lecture digital_products :", productError);
      return res.status(500).json({ error: "Impossible de vérifier ce produit." });
    }
    if (!product) {
      return res.status(404).json({ error: "Produit introuvable." });
    }
    if (!product.file_path) {
      console.error("Produit sans file_path :", productId);
      return res.status(500).json({ error: "Fichier indisponible pour ce produit." });
    }

    // -----------------------------------------------------
    // 3. Vérifier que l'utilisateur a payé CE produit précisément
    //    (jamais de confiance dans un productId arbitraire sans
    //    achat correspondant, même si le produit existe)
    // -----------------------------------------------------
    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", authenticatedUser.id)
      .eq("course_id", productId)
      .eq("product_type", "digital_product")
      .eq("status", "paid")
      .maybeSingle();

    if (purchaseError) {
      console.error("Erreur vérification achat :", purchaseError);
      return res.status(500).json({ error: "Impossible de vérifier votre achat." });
    }
    if (!purchase) {
      return res.status(403).json({ error: "Vous devez acheter ce produit pour y accéder." });
    }

    // -----------------------------------------------------
    // 4. Générer l'URL signée temporaire (jamais de file_path
    //    renvoyé au client, jamais d'URL publique permanente)
    // -----------------------------------------------------
    const { data: signed, error: signError } = await supabaseAdmin
      .storage
      .from("digital-products")
      .createSignedUrl(product.file_path, SIGNED_URL_TTL_SECONDS, {
        download: product.file_name || true
      });

    if (signError || !signed || !signed.signedUrl) {
      console.error("Erreur génération URL signée :", signError);
      return res.status(500).json({ error: "Impossible de préparer le téléchargement." });
    }

    return res.status(200).json({
      url: signed.signedUrl,
      fileName: product.file_name || null,
      mimeType: product.mime_type || null,
      expiresIn: SIGNED_URL_TTL_SECONDS
    });

  } catch (err) {
    console.error("Erreur serveur digital-products-download :", err);
    return res.status(500).json({ error: "Erreur serveur lors de la préparation du téléchargement." });
  }
}
