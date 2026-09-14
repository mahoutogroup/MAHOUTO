// =========================================================
// /api/admin/digital-products.js
// Gestion administrative du catalogue de produits numériques
// (lecture complète, création, mise à jour rapide, suppression).
//
// SÉCURITÉ : même modèle que api/admin/formations.js.
// - Exige un jeton de session Supabase valide (Authorization: Bearer)
// - Vérifie le rôle admin/super_admin/founder côté serveur avec
//   service_role AVANT toute lecture/écriture.
// - Remplace les écritures directes que admin/produits.html faisait
//   auparavant sur Supabase avec la clé anonyme (même faille que
//   admin/formations.html avait avant sa sécurisation) — plus aucune
//   écriture directe insert/update/delete depuis le navigateur.
// - Le prix et la promotion sont toujours validés côté serveur.
// - image_url doit provenir du compte Cloudinary attendu.
// - file_path doit rester dans le dossier "products/" du bucket
//   Storage privé "digital-products" (jamais un chemin arbitraire).
// - La suppression est refusée si le produit a déjà été acheté
//   (même garde-fou que le code d'origine) : on désactive plutôt.
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME
// =========================================================

import { createClient } from "@supabase/supabase-js";

const MAX_PRICE = 1000000;
const ALLOWED_TYPES = ["pdf", "ebook", "video", "audio", "zip", "template", "document", "other"];

function validatePrice(value, fieldName, required) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${fieldName} est requis.`);
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > MAX_PRICE) {
    throw new Error(`${fieldName} invalide (entier entre 0 et ${MAX_PRICE}).`);
  }
  return num;
}

function validateOptionalText(value, fieldName, maxLength) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new Error(`${fieldName} trop long (maximum ${maxLength} caractères).`);
  }
  return text;
}

function validateImageUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  let parsed;
  try {
    parsed = new URL(String(value));
  } catch (_) {
    throw new Error("URL d'image invalide.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") {
    throw new Error("L'image de couverture doit provenir de Cloudinary (https://res.cloudinary.com/...).");
  }
  const expectedCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (expectedCloudName && !parsed.pathname.startsWith("/" + expectedCloudName + "/")) {
    throw new Error("L'image ne provient pas du compte Cloudinary attendu.");
  }
  return parsed.toString();
}

function validateFilePath(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const path = String(value).trim();
  if (!path.startsWith("products/") || path.includes("..")) {
    throw new Error("Chemin de fichier invalide.");
  }
  if (path.length > 500) {
    throw new Error("Chemin de fichier trop long.");
  }
  return path;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

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

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const callerRole = callerProfile ? callerProfile.role : "user";
  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("digital_products")
      .select("*")
      .order("nom", { ascending: true });

    if (error) {
      console.error("Erreur lecture digital_products (admin) :", error);
      return res.status(500).json({ error: "Impossible de charger les produits." });
    }
    return res.status(200).json({ products: data || [] });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const body = req.body || {};
  const { action, id } = body;

  if (!["create", "update", "delete"].includes(action)) {
    return res.status(400).json({ error: "Action inconnue." });
  }

  if (action === "delete") {
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Identifiant de produit manquant." });
    }

    const { data: sales } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("course_id", id)
      .eq("product_type", "digital_product")
      .limit(1);

    if (sales && sales.length) {
      return res.status(409).json({ error: "Ce produit a déjà été acheté au moins une fois. Désactive-le plutôt que de le supprimer." });
    }

    const { data: product } = await supabaseAdmin
      .from("digital_products")
      .select("file_path")
      .eq("id", id)
      .maybeSingle();

    if (product && product.file_path) {
      const { error: storageError } = await supabaseAdmin.storage.from("digital-products").remove([product.file_path]);
      if (storageError) console.error("Erreur suppression fichier Storage :", storageError);
    }

    const { error } = await supabaseAdmin.from("digital_products").delete().eq("id", id);
    if (error) {
      console.error("Erreur suppression produit :", error);
      return res.status(500).json({ error: "Suppression impossible." });
    }
    return res.status(200).json({ success: true });
  }

  try {
    if (action === "update") {
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "Identifiant de produit manquant." });
      }

      const updatePayload = { updated_at: new Date().toISOString() };

      if (body.prix !== undefined) updatePayload.prix = validatePrice(body.prix, "Le prix", true);
      if (body.promotion !== undefined) updatePayload.promotion = validatePrice(body.promotion, "La promotion", false);
      if (body.disponible !== undefined) updatePayload.disponible = Boolean(body.disponible);

      if (body.nom !== undefined) updatePayload.nom = String(body.nom || "").trim().slice(0, 200);
      if (body.description !== undefined) updatePayload.description = String(body.description || "").trim().slice(0, 2000);

      const descriptionLongue = validateOptionalText(body.description_longue, "La description complète", 10000);
      if (descriptionLongue !== undefined) updatePayload.description_longue = descriptionLongue;

      const domaine = validateOptionalText(body.domaine, "Le domaine", 200);
      if (domaine !== undefined) updatePayload.domaine = domaine;

      if (body.type !== undefined) {
        if (!ALLOWED_TYPES.includes(body.type)) return res.status(400).json({ error: "Type de produit invalide." });
        updatePayload.type = body.type;
      }

      const imageUrl = validateImageUrl(body.image_url);
      if (imageUrl !== undefined) updatePayload.image_url = imageUrl;

      if (!Object.keys(updatePayload).length) {
        return res.status(400).json({ error: "Aucune donnée à mettre à jour." });
      }

      const { error } = await supabaseAdmin.from("digital_products").update(updatePayload).eq("id", id);
      if (error) {
        console.error("Erreur mise à jour produit :", error);
        return res.status(500).json({ error: "Mise à jour impossible." });
      }
      return res.status(200).json({ success: true });
    }

    // -------- Création --------
    const nom = String(body.nom || "").trim().slice(0, 200);
    const description = String(body.description || "").trim().slice(0, 2000);
    const prix = validatePrice(body.prix, "Le prix", true);
    const promotion = validatePrice(body.promotion, "La promotion", false);
    const descriptionLongue = validateOptionalText(body.description_longue, "La description complète", 10000);
    const domaine = validateOptionalText(body.domaine, "Le domaine", 200);
    const imageUrl = validateImageUrl(body.image_url);
    const filePath = validateFilePath(body.file_path);
    const fileName = validateOptionalText(body.file_name, "Le nom du fichier", 300);
    const mimeType = validateOptionalText(body.mime_type, "Le type de fichier", 150);
    const fileSize = body.file_size !== undefined && body.file_size !== null && body.file_size !== ""
      ? Math.max(0, Math.trunc(Number(body.file_size)) || 0)
      : null;

    if (!nom) return res.status(400).json({ error: "Nom de produit invalide." });
    if (!ALLOWED_TYPES.includes(body.type)) return res.status(400).json({ error: "Type de produit invalide." });
    if (!filePath) return res.status(400).json({ error: "Fichier du produit manquant." });

    const slug = nom.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const newId = slug + "-" + Date.now().toString(36);

    const { error } = await supabaseAdmin.from("digital_products").insert({
      id: newId,
      nom,
      description,
      description_longue: descriptionLongue ?? null,
      type: body.type,
      domaine: domaine ?? null,
      prix,
      promotion: promotion ?? null,
      disponible: true,
      image_url: imageUrl ?? null,
      file_path: filePath,
      file_name: fileName ?? null,
      mime_type: mimeType ?? null,
      file_size: fileSize
    });

    if (error) {
      console.error("Erreur création produit :", error);
      return res.status(500).json({ error: "Création impossible." });
    }
    return res.status(201).json({ success: true, id: newId });

  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }
}
