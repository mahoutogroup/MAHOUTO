// =========================================================
// /api/formation-content.js
//
// Sert le curriculum (modules + leçons) d'une formation, et le
// contenu réel (vidéo/PDF) d'une leçon donnée — jamais l'inverse.
//
// SÉCURITÉ :
// - Le curriculum (titres, ordre, type, is_preview) est public : il
//   ne contient aucune information payante.
// - Le contenu réel d'une leçon (formation_lesson_media) n'est
//   JAMAIS lu directement par le navigateur (RLS l'interdit). Cette
//   route le lit avec service_role et ne le renvoie QUE si :
//     a) la leçon est is_preview = true, OU
//     b) l'appelant est authentifié ET a un achat "paid" pour cette
//        formation (purchases.status='paid' AND product_type='formation'
//        AND course_id = formation_id).
// - Le client ne peut jamais imposer lui-même l'accès : aucun flag
//   envoyé par le navigateur (isPaid, hasAccess...) n'est utilisé.
// - Les URLs vidéo Cloudinary sont revalidées à l'affichage exactement
//   comme image_url (même compte Cloudinary attendu) ; un pdf_path
//   n'est jamais renvoyé tel quel : une URL signée à durée limitée est
//   générée à la demande, sur le même modèle que
//   api/digital-products-download.js.
//
// Actions (POST, body.action) :
//   "curriculum" : { formationId } -> modules + leçons (métadonnées
//                  publiques uniquement, jamais de vidéo/pdf).
//   "lesson"     : { lessonId }    -> contenu réel d'UNE leçon,
//                  seulement si autorisé (preview ou achat validé).
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME (validation d'origine des URLs vidéo)
// =========================================================

import { createClient } from "@supabase/supabase-js";

const SIGNED_PDF_TTL_SECONDS = 60 * 15; // 15 minutes

function isSafeCloudinaryUrl(value) {
  if (!value) return false;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return false;
  const expectedCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (expectedCloudName && !parsed.pathname.startsWith("/" + expectedCloudName + "/")) return false;
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("Configuration Supabase manquante sur Vercel.");
    return res.status(500).json({ error: "Configuration serveur incomplète." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // Authentification optionnelle : nécessaire uniquement pour accéder
  // à une leçon non-preview. Le curriculum (métadonnées) reste public.
  let authenticatedUser = null;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const { data: userData } = await supabaseAuth.auth.getUser(token);
    if (userData && userData.user) authenticatedUser = userData.user;
  }

  const body = req.body || {};
  const { action } = body;

  // -------- Curriculum : modules + leçons, métadonnées publiques --------
  if (action === "curriculum") {
    const formationId = String(body.formationId || "").trim();
    if (!formationId || formationId.length > 200) {
      return res.status(400).json({ error: "Identifiant de formation invalide." });
    }

    const { data: modules, error: modulesError } = await supabaseAdmin
      .from("formation_modules")
      .select("id, titre, ordre")
      .eq("formation_id", formationId)
      .order("ordre", { ascending: true });

    if (modulesError) {
      console.error("Erreur lecture formation_modules :", modulesError);
      return res.status(500).json({ error: "Impossible de charger le programme." });
    }

    const moduleIds = (modules || []).map((m) => m.id);
    let lessons = [];
    if (moduleIds.length) {
      const { data: lessonsData, error: lessonsError } = await supabaseAdmin
        .from("formation_lessons")
        .select("id, module_id, titre, type, ordre, is_preview")
        .in("module_id", moduleIds)
        .order("ordre", { ascending: true });

      if (lessonsError) {
        console.error("Erreur lecture formation_lessons :", lessonsError);
        return res.status(500).json({ error: "Impossible de charger les leçons." });
      }
      lessons = lessonsData || [];
    }

    // Si l'appelant a déjà payé cette formation, on l'indique pour que
    // le frontend n'affiche pas des cadenas inutiles — calculé ici,
    // JAMAIS transmis par le client.
    let hasAccess = false;
    if (authenticatedUser) {
      const { data: purchase } = await supabaseAdmin
        .from("purchases")
        .select("id")
        .eq("user_id", authenticatedUser.id)
        .eq("course_id", formationId)
        .eq("product_type", "formation")
        .eq("status", "paid")
        .maybeSingle();
      hasAccess = Boolean(purchase);
    }

    let progress = [];
    if (authenticatedUser && lessons.length) {
      const { data: progressData } = await supabaseAdmin
        .from("course_progress")
        .select("lesson_id, completed")
        .eq("user_id", authenticatedUser.id)
        .in("lesson_id", lessons.map((l) => l.id));
      progress = progressData || [];
    }

    return res.status(200).json({
      modules: modules || [],
      lessons,
      hasAccess,
      progress
    });
  }

  // -------- Contenu réel d'une leçon (vidéo/pdf) --------
  if (action === "lesson") {
    const lessonId = Number(body.lessonId);
    if (!Number.isFinite(lessonId) || !Number.isInteger(lessonId) || lessonId <= 0) {
      return res.status(400).json({ error: "Identifiant de leçon invalide." });
    }

    const { data: lesson, error: lessonError } = await supabaseAdmin
      .from("formation_lessons")
      .select("id, titre, type, is_preview, module_id, formation_modules(formation_id)")
      .eq("id", lessonId)
      .maybeSingle();

    if (lessonError) {
      console.error("Erreur lecture leçon :", lessonError);
      return res.status(500).json({ error: "Impossible de charger cette leçon." });
    }
    if (!lesson) {
      return res.status(404).json({ error: "Leçon introuvable." });
    }

    const formationId = lesson.formation_modules && lesson.formation_modules.formation_id;

    // -------- Vérification d'accès côté serveur uniquement --------
    let authorized = Boolean(lesson.is_preview);
    if (!authorized) {
      if (!authenticatedUser) {
        return res.status(401).json({ error: "Authentification requise pour accéder à cette leçon." });
      }
      const { data: purchase, error: purchaseError } = await supabaseAdmin
        .from("purchases")
        .select("id")
        .eq("user_id", authenticatedUser.id)
        .eq("course_id", formationId)
        .eq("product_type", "formation")
        .eq("status", "paid")
        .maybeSingle();

      if (purchaseError) {
        console.error("Erreur vérification achat formation :", purchaseError);
        return res.status(500).json({ error: "Impossible de vérifier votre achat." });
      }
      if (!purchase) {
        return res.status(403).json({ error: "Vous devez acheter cette formation pour accéder à cette leçon." });
      }
      authorized = true;
    }

    const { data: media, error: mediaError } = await supabaseAdmin
      .from("formation_lesson_media")
      .select("video_url, video_public_id, pdf_path, duree_secondes")
      .eq("lesson_id", lessonId)
      .maybeSingle();

    if (mediaError) {
      console.error("Erreur lecture formation_lesson_media :", mediaError);
      return res.status(500).json({ error: "Impossible de charger le contenu de cette leçon." });
    }

    const responsePayload = {
      id: lesson.id,
      titre: lesson.titre,
      type: lesson.type,
      isPreview: Boolean(lesson.is_preview),
      dureeSecondes: media ? media.duree_secondes : null,
      videoUrl: null,
      pdfUrl: null
    };

    if (media && media.video_url && isSafeCloudinaryUrl(media.video_url)) {
      responsePayload.videoUrl = media.video_url;
    }

    if (media && media.pdf_path) {
      const { data: signed, error: signError } = await supabaseAdmin
        .storage
        .from("formation-media")
        .createSignedUrl(media.pdf_path, SIGNED_PDF_TTL_SECONDS);
      if (signError) {
        console.error("Erreur génération URL signée PDF leçon :", signError);
      } else if (signed && signed.signedUrl) {
        responsePayload.pdfUrl = signed.signedUrl;
      }
    }

    return res.status(200).json(responsePayload);
  }

  return res.status(400).json({ error: "Action inconnue." });
}
