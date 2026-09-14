// =========================================================
// /api/admin/formations.js
// Gestion administrative du catalogue de formations
// (lecture complète, création, mise à jour, suppression).
//
// SÉCURITÉ :
// - Exige un jeton de session Supabase valide (Authorization: Bearer)
// - Vérifie que ce compte a le rôle admin/super_admin/founder dans
//   "profiles", AVANT toute lecture ou écriture — jamais fait confiance
//   au frontend, qui ne sert qu'à masquer/afficher le formulaire.
// - Utilise SUPABASE_SERVICE_ROLE_KEY uniquement côté serveur.
// - Le prix et la promotion sont toujours validés côté serveur
//   (entiers, 0 à 1 000 000 XOF) : le navigateur ne peut jamais
//   imposer un prix arbitraire pour une formation.
// - image_url est valable UNIQUEMENT si elle pointe vers le compte
//   Cloudinary attendu (https://res.cloudinary.com/<cloud>/...) —
//   empêche qu'un javascript:/data: URI ou un domaine arbitraire
//   soit stocké puis rendu tel quel par school.html/formation-detail.html.
// - Les champs texte (domaine, niveau, durée, formateur, objectifs,
//   compétences, programme, description longue) sont bornés en
//   longueur ; l'échappement HTML au moment de l'affichage reste la
//   responsabilité du frontend (déjà en place), cette validation
//   serveur est une défense supplémentaire, pas un remplacement.
//
// Remplace les écritures directes que admin/formations.html faisait
// auparavant sur Supabase avec la clé anonyme (voir historique du
// dépôt) — même modèle de sécurité que api/admin/user-action.js.
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME   (déjà utilisée par api/cloudinary-sign.js —
//                            sert ici uniquement à valider image_url)
// =========================================================

import { createClient } from "@supabase/supabase-js";

const ALLOWED_PROVIDERS = ["mahouto_school", "academie_majestepresse"];
const MAX_PRICE = 1000000;

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

// Champ texte optionnel simple (domaine, niveau, durée, formateur...).
// "" / null / undefined -> null (permet d'effacer un champ existant).
function validateOptionalText(value, fieldName, maxLength) {
  if (value === undefined) return undefined; // absent du body : ne pas toucher au champ
  if (value === null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new Error(`${fieldName} trop long (maximum ${maxLength} caractères).`);
  }
  return text;
}

// Zone de texte multi-lignes (objectifs/compétences/programme) : même
// validation qu'un champ texte, juste une limite plus généreuse.
function validateMultiline(value, fieldName, maxLength) {
  return validateOptionalText(value, fieldName, maxLength);
}

// N'accepte une image de couverture QUE si elle vient du compte
// Cloudinary configuré pour ce projet — jamais un javascript:/data:
// URI, jamais un domaine arbitraire.
function validateImageUrl(value) {
  if (value === undefined) return undefined; // absent du body : ne pas toucher au champ
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante sur Vercel." });
  }

  // -------- 1) Authentification obligatoire --------
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

  // -------- 2) Vérification du rôle admin (côté serveur uniquement) --------
  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const callerRole = callerProfile ? callerProfile.role : "user";
  if (!["admin", "super_admin", "founder"].includes(callerRole)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }

  // -------- 3) Lecture : toutes les formations (y compris indisponibles) --------
  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("formations")
      .select("*")
      .order("provider", { ascending: true })
      .order("nom", { ascending: true });

    if (error) {
      console.error("Erreur lecture formations (admin) :", error);
      return res.status(500).json({ error: "Impossible de charger les formations." });
    }
    return res.status(200).json({ formations: data || [] });
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

  // -------- 4) Suppression --------
  if (action === "delete") {
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Identifiant de formation manquant." });
    }
    const { error } = await supabaseAdmin.from("formations").delete().eq("id", id);
    if (error) {
      console.error("Erreur suppression formation :", error);
      return res.status(500).json({ error: "Suppression impossible." });
    }
    return res.status(200).json({ success: true });
  }

  try {
    // -------- 5) Mise à jour --------
    // Deux usages depuis le frontend : mise à jour rapide (prix/promo/
    // disponibilité) et "fiche complète" (tous les champs éditoriaux).
    // Chaque champ n'est inclus dans updatePayload que s'il est présent
    // dans le body — un update partiel n'écrase jamais les champs non
    // envoyés.
    if (action === "update") {
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "Identifiant de formation manquant." });
      }

      const updatePayload = {};

      if (body.prix !== undefined) updatePayload.prix = validatePrice(body.prix, "Le prix", true);
      if (body.promotion !== undefined) updatePayload.promotion = validatePrice(body.promotion, "La promotion", false);
      if (body.disponible !== undefined) updatePayload.disponible = Boolean(body.disponible);

      if (body.description !== undefined) {
        updatePayload.description = String(body.description || "").trim().slice(0, 2000);
      }

      const descriptionLongue = validateOptionalText(body.description_longue, "La description complète", 10000);
      if (descriptionLongue !== undefined) updatePayload.description_longue = descriptionLongue;

      const domaine = validateOptionalText(body.domaine, "Le domaine", 200);
      if (domaine !== undefined) updatePayload.domaine = domaine;

      const niveau = validateOptionalText(body.niveau, "Le niveau", 100);
      if (niveau !== undefined) updatePayload.niveau = niveau;

      const duree = validateOptionalText(body.duree, "La durée", 100);
      if (duree !== undefined) updatePayload.duree = duree;

      const formateur = validateOptionalText(body.formateur, "Le formateur", 200);
      if (formateur !== undefined) updatePayload.formateur = formateur;

      const objectifs = validateMultiline(body.objectifs, "Les objectifs", 5000);
      if (objectifs !== undefined) updatePayload.objectifs = objectifs;

      const competences = validateMultiline(body.competences, "Les compétences", 5000);
      if (competences !== undefined) updatePayload.competences = competences;

      const programme = validateMultiline(body.programme, "Le programme", 5000);
      if (programme !== undefined) updatePayload.programme = programme;

      const imageUrl = validateImageUrl(body.image_url);
      if (imageUrl !== undefined) updatePayload.image_url = imageUrl;

      if (body.emoji !== undefined) {
        updatePayload.emoji = String(body.emoji || "📘").trim().slice(0, 8) || "📘";
      }

      if (!Object.keys(updatePayload).length) {
        return res.status(400).json({ error: "Aucune donnée à mettre à jour." });
      }

      const { error } = await supabaseAdmin.from("formations").update(updatePayload).eq("id", id);
      if (error) {
        console.error("Erreur mise à jour formation :", error);
        return res.status(500).json({ error: "Mise à jour impossible." });
      }
      return res.status(200).json({ success: true });
    }

    // -------- 6) Création --------
    const provider = String(body.provider || "").trim();
    const nom = String(body.nom || "").trim().slice(0, 200);
    const description = String(body.description || "").trim().slice(0, 2000);
    const emoji = String(body.emoji || "📘").trim().slice(0, 8) || "📘";
    const prix = validatePrice(body.prix, "Le prix", true);

    const descriptionLongue = validateOptionalText(body.description_longue, "La description complète", 10000);
    const domaine = validateOptionalText(body.domaine, "Le domaine", 200);
    const niveau = validateOptionalText(body.niveau, "Le niveau", 100);
    const duree = validateOptionalText(body.duree, "La durée", 100);
    const formateur = validateOptionalText(body.formateur, "Le formateur", 200);
    const objectifs = validateMultiline(body.objectifs, "Les objectifs", 5000);
    const competences = validateMultiline(body.competences, "Les compétences", 5000);
    const programme = validateMultiline(body.programme, "Le programme", 5000);
    const imageUrl = validateImageUrl(body.image_url);

    if (!ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: "Plateforme (provider) invalide." });
    }
    if (!nom) {
      return res.status(400).json({ error: "Nom de formation invalide." });
    }

    const slug = nom.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const prefix = provider === "academie_majestepresse" ? "amp-" : "";
    const newId = prefix + slug + "-" + Date.now().toString(36);

    const { error } = await supabaseAdmin.from("formations").insert({
      id: newId, provider, nom, description, emoji, prix, disponible: true,
      description_longue: descriptionLongue ?? null,
      domaine: domaine ?? null,
      niveau: niveau ?? null,
      duree: duree ?? null,
      formateur: formateur ?? null,
      objectifs: objectifs ?? null,
      competences: competences ?? null,
      programme: programme ?? null,
      image_url: imageUrl ?? null
    });

    if (error) {
      console.error("Erreur création formation :", error);
      return res.status(500).json({ error: "Création impossible." });
    }
    return res.status(201).json({ success: true, id: newId });

  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }
}
