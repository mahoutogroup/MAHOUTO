// =========================================================
// /api/course.js
//
// Point d'entrée UNIQUE pour toute la logique serveur de
// MAHOUTO SCHOOL — conçu pour rester sous la limite de 12
// fonctions serverless du plan Vercel Hobby. Chaque besoin
// serveur futur (quiz, certificat) sera ajouté ici comme une
// nouvelle valeur de "action", jamais comme un nouveau fichier.
//
// Phase 1 — actions implémentées :
//   - "lesson-video-url"  : l'apprenant demande l'URL sécurisée
//                            d'une leçon vidéo (vérifie session +
//                            achat payé avant de la délivrer)
//   - "admin-upload-sign" : l'admin demande une signature pour
//                            uploader une vidéo de leçon vers
//                            Cloudinary en delivery type "authenticated"
//                            (jamais publique)
//
// Phase 2 / 3 (PAS implémentées ici, juste réservées) :
//   - "quiz-submit"
//   - "generate-certificate"
//
// Sécurité :
//   - Authentification Supabase obligatoire pour toute action
//   - Aucune donnée sensible (prix, achat, autorisation) n'est
//     jamais déterminée à partir de ce que le navigateur envoie :
//     tout est revérifié ici, côté serveur, à chaque appel
//   - Le secret Cloudinary ne quitte jamais cette fonction
//
// Variables d'environnement Vercel attendues (déjà utilisées
// ailleurs dans /api — aucune nouvelle variable à créer) :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
// =========================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";

const ADMIN_ROLES = ["admin", "super_admin", "founder"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("Configuration Supabase manquante sur Vercel.");
    return res.status(500).json({ error: "Configuration serveur incomplète." });
  }

  // -----------------------------------------------------
  // Authentification obligatoire pour TOUTE action de cette
  // fonction — aucune branche ne doit pouvoir être atteinte
  // par un appel anonyme.
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
  const user = userData.user;

  // Client service_role : contourne volontairement RLS, car
  // formation_lesson_media n'a AUCUNE policy de lecture publique
  // (même pour un utilisateur connecté) — cette fonction est le
  // SEUL chemin autorisé à lire un video_public_id, après avoir
  // vérifié elle-même l'achat.
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const body = req.body || {};
  const action = body.action;

  switch (action) {
    case "lesson-video-url":
      return handleLessonVideoUrl(body, res, supabaseAdmin, user);
    case "admin-upload-sign":
      return handleAdminUploadSign(body, res, supabaseAdmin, user);
    default:
      return res.status(400).json({ error: "Action inconnue ou non implémentée." });
  }
}

// =========================================================
// action = "lesson-video-url"
// =========================================================
async function handleLessonVideoUrl(body, res, supabaseAdmin, user) {
  const lessonIdNum = Number(body.lessonId);
  if (!body.lessonId || !Number.isInteger(lessonIdNum) || lessonIdNum <= 0) {
    return res.status(400).json({ error: "Identifiant de leçon invalide." });
  }

  // 1. La leçon existe-t-elle vraiment ?
  const { data: lesson, error: lessonError } = await supabaseAdmin
    .from("formation_lessons")
    .select("id, module_id, is_preview")
    .eq("id", lessonIdNum)
    .maybeSingle();

  if (lessonError) {
    console.error("Erreur lecture formation_lessons :", lessonError);
    return res.status(500).json({ error: "Impossible de vérifier cette leçon." });
  }
  if (!lesson) {
    return res.status(404).json({ error: "Leçon introuvable." });
  }

  // 2. À quelle formation appartient-elle réellement ? (jamais
  //    déduit d'une valeur envoyée par le navigateur)
  const { data: courseModule, error: moduleError } = await supabaseAdmin
    .from("formation_modules")
    .select("id, formation_id")
    .eq("id", lesson.module_id)
    .maybeSingle();

  if (moduleError) {
    console.error("Erreur lecture formation_modules :", moduleError);
    return res.status(500).json({ error: "Impossible de vérifier cette leçon." });
  }
  if (!courseModule) {
    // Cas normalement impossible (contrainte FK), mais on ne
    // fait confiance à aucune hypothèse implicite.
    return res.status(404).json({ error: "Formation associée introuvable." });
  }

  // 3. Autorisation : aperçu gratuit OU achat payé de CETTE
  //    formation précisément.
  let authorized = !!lesson.is_preview;

  if (!authorized) {
    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", courseModule.formation_id)
      .eq("product_type", "formation")
      .eq("status", "paid")
      .maybeSingle();

    if (purchaseError) {
      console.error("Erreur vérification achat :", purchaseError);
      return res.status(500).json({ error: "Impossible de vérifier votre achat." });
    }
    authorized = !!purchase;
  }

  if (!authorized) {
    return res.status(403).json({ error: "Vous devez avoir acheté cette formation pour accéder à cette leçon." });
  }

  // 4. Récupération du média — jamais transmis tel quel au
  //    navigateur, seulement l'URL signée générée ci-dessous.
  const { data: media, error: mediaError } = await supabaseAdmin
    .from("formation_lesson_media")
    .select("video_public_id, duree_secondes")
    .eq("lesson_id", lessonIdNum)
    .maybeSingle();

  if (mediaError) {
    console.error("Erreur lecture formation_lesson_media :", mediaError);
    return res.status(500).json({ error: "Impossible de récupérer la vidéo." });
  }
  if (!media || !media.video_public_id) {
    return res.status(404).json({ error: "Aucune vidéo n'est encore disponible pour cette leçon." });
  }

  // 5. Génération de l'URL Cloudinary signée (type authenticated).
  //    IMPORTANT : sur le plan gratuit, cette URL n'expire PAS
  //    automatiquement (le token-based auth à expiration est
  //    réservé au plan Advanced). La protection réelle est le
  //    contrôle ci-dessus, exécuté à chaque demande.
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    console.error("Configuration Cloudinary manquante sur Vercel.");
    return res.status(500).json({ error: "Configuration vidéo indisponible." });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  const url = cloudinary.url(media.video_public_id, {
    resource_type: "video",
    type: "authenticated",
    sign_url: true
  });

  return res.status(200).json({
    url,
    dureeSecondes: media.duree_secondes || null
  });
}

// =========================================================
// action = "admin-upload-sign"
// =========================================================
async function handleAdminUploadSign(body, res, supabaseAdmin, user) {
  // 1. Vérification du rôle admin — jamais déduite du
  //    navigateur, toujours relue dans profiles.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Erreur lecture profil :", profileError);
    return res.status(500).json({ error: "Impossible de vérifier vos droits." });
  }
  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return res.status(403).json({ error: "Action réservée aux administrateurs." });
  }

  // 2. La leçon cible existe-t-elle vraiment ?
  const lessonIdNum = Number(body.lessonId);
  if (!body.lessonId || !Number.isInteger(lessonIdNum) || lessonIdNum <= 0) {
    return res.status(400).json({ error: "Identifiant de leçon invalide." });
  }

  const { data: lesson, error: lessonError } = await supabaseAdmin
    .from("formation_lessons")
    .select("id")
    .eq("id", lessonIdNum)
    .maybeSingle();

  if (lessonError) {
    console.error("Erreur vérification leçon :", lessonError);
    return res.status(500).json({ error: "Impossible de vérifier cette leçon." });
  }
  if (!lesson) {
    return res.status(404).json({ error: "Leçon introuvable." });
  }

  // 3. Génération de la signature d'upload — même algorithme
  //    que /api/cloudinary-sign.js (déjà validé en prod), avec
  //    en plus "type=authenticated" pour que la vidéo ne soit
  //    JAMAIS publique dès son arrivée sur Cloudinary.
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Configuration Cloudinary manquante sur Vercel" });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = "mahoutoplus/lessons";
  const type = "authenticated";

  // Paramètres signés triés par ordre alphabétique : folder, timestamp, type.
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}&type=${type}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

  return res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    folder,
    type,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
    lessonId: lessonIdNum
  });
}
