// =========================================================
// /api/admin/formation-curriculum.js
// Gestion administrative des modules, leçons et contenu (vidéo/PDF)
// d'une formation MAHOUTO School.
//
// SÉCURITÉ : même modèle que api/admin/formations.js — jeton Supabase
// obligatoire, rôle admin/super_admin/founder vérifié côté serveur
// via service_role AVANT toute lecture/écriture. Le navigateur ne
// peut jamais écrire directement dans formation_modules /
// formation_lessons / formation_lesson_media (RLS ne prévoit aucune
// policy insert/update/delete pour anon/authenticated).
//
// Actions (POST, body.action) :
//   "list"           : { formationId } -> modules + leçons + média (admin uniquement)
//   "save-module"    : { id?, formationId, titre, ordre }
//   "delete-module"  : { id }
//   "save-lesson"    : { id?, moduleId, titre, type, ordre, isPreview }
//   "delete-lesson"  : { id }
//   "save-media"     : { lessonId, videoUrl?, pdfPath?, dureeSecondes? }
//
// Variables d'environnement Vercel attendues :
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   CLOUDINARY_CLOUD_NAME (validation d'origine de videoUrl)
// =========================================================

import { createClient } from "@supabase/supabase-js";

const MAX_TITLE_LENGTH = 300;

function validateVideoUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  let parsed;
  try {
    parsed = new URL(String(value));
  } catch (_) {
    throw new Error("URL vidéo invalide.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") {
    throw new Error("La vidéo doit provenir de Cloudinary (https://res.cloudinary.com/...).");
  }
  const expectedCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (expectedCloudName && !parsed.pathname.startsWith("/" + expectedCloudName + "/")) {
    throw new Error("La vidéo ne provient pas du compte Cloudinary attendu.");
  }
  return parsed.toString();
}

function validatePdfPath(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const path = String(value).trim();
  // Doit rester dans le dossier réservé aux leçons, jamais un chemin arbitraire.
  if (!path.startsWith("lessons/") || path.includes("..")) {
    throw new Error("Chemin de document invalide.");
  }
  if (path.length > 500) {
    throw new Error("Chemin de document trop long.");
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

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
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

  const body = req.body || {};
  const { action } = body;

  try {
    // -------- Lecture complète (admin) --------
    if (action === "list") {
      const formationId = String(body.formationId || "").trim();
      if (!formationId) return res.status(400).json({ error: "Identifiant de formation manquant." });

      const { data: modules, error: modulesError } = await supabaseAdmin
        .from("formation_modules")
        .select("id, titre, ordre")
        .eq("formation_id", formationId)
        .order("ordre", { ascending: true });
      if (modulesError) throw modulesError;

      const moduleIds = (modules || []).map((m) => m.id);
      let lessons = [];
      let media = [];
      if (moduleIds.length) {
        const { data: lessonsData, error: lessonsError } = await supabaseAdmin
          .from("formation_lessons")
          .select("id, module_id, titre, type, ordre, is_preview")
          .in("module_id", moduleIds)
          .order("ordre", { ascending: true });
        if (lessonsError) throw lessonsError;
        lessons = lessonsData || [];

        const lessonIds = lessons.map((l) => l.id);
        if (lessonIds.length) {
          const { data: mediaData, error: mediaError } = await supabaseAdmin
            .from("formation_lesson_media")
            .select("lesson_id, video_url, pdf_path, duree_secondes")
            .in("lesson_id", lessonIds);
          if (mediaError) throw mediaError;
          media = mediaData || [];
        }
      }

      return res.status(200).json({ modules: modules || [], lessons, media });
    }

    // -------- Modules --------
    if (action === "save-module") {
      const titre = String(body.titre || "").trim().slice(0, MAX_TITLE_LENGTH);
      if (!titre) return res.status(400).json({ error: "Titre de module requis." });
      const ordre = Number.isFinite(Number(body.ordre)) ? Math.trunc(Number(body.ordre)) : 0;

      if (body.id) {
        const { error } = await supabaseAdmin
          .from("formation_modules")
          .update({ titre, ordre })
          .eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ success: true, id: body.id });
      }

      const formationId = String(body.formationId || "").trim();
      if (!formationId) return res.status(400).json({ error: "Identifiant de formation manquant." });

      const { data, error } = await supabaseAdmin
        .from("formation_modules")
        .insert({ formation_id: formationId, titre, ordre })
        .select("id")
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, id: data.id });
    }

    if (action === "delete-module") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Identifiant de module invalide." });
      const { error } = await supabaseAdmin.from("formation_modules").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // -------- Leçons --------
    if (action === "save-lesson") {
      const titre = String(body.titre || "").trim().slice(0, MAX_TITLE_LENGTH);
      if (!titre) return res.status(400).json({ error: "Titre de leçon requis." });
      const type = ["video", "pdf", "text"].includes(body.type) ? body.type : "video";
      const ordre = Number.isFinite(Number(body.ordre)) ? Math.trunc(Number(body.ordre)) : 0;
      const isPreview = Boolean(body.isPreview);

      if (body.id) {
        const { error } = await supabaseAdmin
          .from("formation_lessons")
          .update({ titre, type, ordre, is_preview: isPreview })
          .eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ success: true, id: body.id });
      }

      const moduleId = Number(body.moduleId);
      if (!Number.isFinite(moduleId)) return res.status(400).json({ error: "Identifiant de module manquant." });

      const { data, error } = await supabaseAdmin
        .from("formation_lessons")
        .insert({ module_id: moduleId, titre, type, ordre, is_preview: isPreview })
        .select("id")
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, id: data.id });
    }

    if (action === "delete-lesson") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Identifiant de leçon invalide." });
      const { error } = await supabaseAdmin.from("formation_lessons").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // -------- Média (vidéo / pdf) d'une leçon --------
    if (action === "save-media") {
      const lessonId = Number(body.lessonId);
      if (!Number.isFinite(lessonId)) return res.status(400).json({ error: "Identifiant de leçon manquant." });

      const videoUrl = validateVideoUrl(body.videoUrl);
      const pdfPath = validatePdfPath(body.pdfPath);
      const dureeSecondes = body.dureeSecondes === undefined || body.dureeSecondes === null || body.dureeSecondes === ""
        ? undefined
        : Math.max(0, Math.trunc(Number(body.dureeSecondes)) || 0);

      const payload = { lesson_id: lessonId, updated_at: new Date().toISOString() };
      if (videoUrl !== undefined) payload.video_url = videoUrl;
      if (pdfPath !== undefined) payload.pdf_path = pdfPath;
      if (dureeSecondes !== undefined) payload.duree_secondes = dureeSecondes;

      const { error } = await supabaseAdmin
        .from("formation_lesson_media")
        .upsert(payload, { onConflict: "lesson_id" });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Action inconnue." });
  } catch (err) {
    console.error("Erreur formation-curriculum :", err);
    const message = err && err.message ? err.message : "Erreur serveur.";
    return res.status(err && err.message ? 400 : 500).json({ error: message });
  }
}
