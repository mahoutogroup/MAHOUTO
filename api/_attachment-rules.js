// =========================================================
// /api/_attachment-rules.js
// Règles PARTAGÉES entre cloudinary-sign.js (upload) et
// attachment-url.js (livraison). Source de vérité unique pour
// la liste d'extensions autorisées — l'attribut "accept" côté
// client n'est qu'un confort d'UI, jamais une sécurité.
// =========================================================

import { createClient } from "@supabase/supabase-js";

// Liste validée avec l'utilisateur (chantier pièces jointes
// professionnelles). Tout ce qui n'y figure pas est refusé,
// y compris les extensions dangereuses (exe, bat, apk, dll...).
export const ALLOWED_EXTENSIONS = new Set([
  // images
  "jpg", "jpeg", "png", "webp", "gif", "tiff", "tif",
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "md",
  // graphisme / impression
  "svg", "ai", "eps", "psd", "cdr",
  // photo RAW
  "dng", "cr2", "cr3", "nef", "arw", "raf",
  // audio
  "mp3", "wav", "m4a", "ogg",
  // vidéo
  "mp4", "webm", "mov", "mkv",
  // archives
  "zip", "rar", "7z", "tar", "gz",
  // développement
  "html", "css", "js", "ts", "json", "xml", "sql",
  "php", "py", "java", "c", "cpp", "h", "go", "rs"
]);

export function getExtension(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(filename || "").trim());
  return m ? m[1].toLowerCase() : "";
}

export function isExtensionAllowed(filename) {
  const ext = getExtension(filename);
  return !!ext && ALLOWED_EXTENSIONS.has(ext);
}

// -------- Session Supabase (même vérification que le reste de l'app) --------
export async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: "Authentification requise.", status: 401 };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: "Configuration Supabase manquante sur Vercel", status: 500 };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    return { error: "Session invalide ou expirée.", status: 401 };
  }
  return { user: data.user };
}

// -------- Client Supabase "admin" (service role) --------
// Nécessaire pour lire les tables (rooms, purchases, dm_conversations)
// indépendamment des RLS, PUIS appliquer nous-mêmes exactement les
// mêmes règles d'autorisation que les policies existantes — jamais
// pour les contourner côté écriture (on ne fait ici que de la lecture
// pour décider d'un accès).
export function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

// Reproduit exactement la règle des policies "messages_public_read" /
// "messages_insert_own" : salon gratuit, créateur du salon, admin, ou
// achat validé (purchases.status = 'paid', product_type = 'salon').
export async function canAccessRoom(admin, userId, roomId, userRole) {
  const { data: room } = await admin
    .from("rooms")
    .select("id, is_paid, created_by")
    .eq("id", roomId)
    .maybeSingle();

  if (!room) return { allowed: false };
  if (!room.is_paid) return { allowed: true, room };
  if (room.created_by === userId) return { allowed: true, room };
  if (["admin", "super_admin", "founder"].includes(userRole)) return { allowed: true, room };

  const { data: purchase } = await admin
    .from("purchases")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", roomId)
    .eq("product_type", "salon")
    .eq("status", "paid")
    .maybeSingle();

  return { allowed: !!purchase, room };
}

// Reproduit la policy "dm_messages_select_participants" : l'utilisateur
// doit être l'un des deux participants de la conversation.
export async function canAccessDm(admin, userId, conversationId) {
  const { data: conv } = await admin
    .from("dm_conversations")
    .select("id, user_one, user_two")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) return false;
  return conv.user_one === userId || conv.user_two === userId;
}

export async function getUserRole(admin, userId) {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data && data.role ? data.role : "user";
}
