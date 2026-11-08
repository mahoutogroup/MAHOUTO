// =========================================================
// api/_room-og.js — aperçu d'un lien de salon (WhatsApp, Telegram, Facebook, Twitter…)
//
// Lien partagé : https://mahouto.com/r/<salon>  (réécriture dans vercel.json, servie par
// api/produit-og.js, type « salon » : aucune nouvelle fonction Vercel, plafond de 12).
//
// Ce module est pur (aucun accès réseau) : il valide l'identifiant, construit les balises Open Graph
// et Twitter à partir de la ligne `rooms` (name, is_paid, price, photo_url, emoji : rien d'autre),
// et gère la réponse. Le préfixe « _ » évite qu'il soit compté comme fonction serverless.
//
// Règles :
//  - le site et la marque sont fixes : https://mahouto.com et « MAHOUTO+ », quel que soit le domaine ;
//  - l'identifiant est validé ([A-Za-z0-9_-]{1,64}) AVANT toute requête ;
//  - tout ce qui vient de la base (nom, prix, émoji) est échappé pour le HTML ; aucun innerHTML ;
//  - la photo n'est utilisée que si elle passe MahoutoRoomSafe.photoUrl (https, sans caractère
//    dangereux) ET vient du compte Cloudinary du projet, dans un format lu par WhatsApp ;
//    sinon : logo M+ ;
//  - un salon payant montre son nom, sa photo et son prix : jamais un message ni une donnée privée ;
//  - robots : balises Open Graph / Twitter ; humains : redirection vers la page du salon.
// =========================================================

import "../room-safe.js";
import { cloudinaryImageParts } from "./_cloudinary-og.js";

export const ROOM_SITE = "https://mahouto.com";
export const ROOM_BRAND = "MAHOUTO+";
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ROOM_FIELDS = "name, is_paid, price, photo_url, emoji";

// Logo M+ par défaut (PNG 512x512 du site).
const DEFAULT_IMAGE = { url: `${ROOM_SITE}/assets/icon-512.png`, width: "512", height: "512", card: "summary" };
// Formats d'image source acceptés (WhatsApp ne lit ni SVG, ni PDF, ni PSD, ni HEIC…).
const READABLE_EXTENSION = /^(?:jpe?g|png|webp|gif)$/i;

export function isValidRoomId(id) {
  return typeof id === "string" && ROOM_ID_RE.test(id);
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(xof) {
  return Number(xof).toLocaleString("fr-FR") + " FCFA";
}

function cut(text, max) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Image d'aperçu 1200x630 (photo du salon) ou logo M+.
export function roomOgImage(photoUrl) {
  const safe = globalThis.MahoutoRoomSafe.photoUrl(photoUrl);    // https, sans espace ni guillemet…
  if (!safe || /[?#]/.test(safe)) return DEFAULT_IMAGE;
  const ext = (safe.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
  if (ext && !READABLE_EXTENSION.test(ext)) return DEFAULT_IMAGE;  // format non lu par WhatsApp
  const parts = cloudinaryImageParts(safe);                         // domaine de stockage attendu
  if (!parts) return DEFAULT_IMAGE;
  return {
    url: `${parts.prefix}f_jpg,q_auto,w_1200,h_630,c_pad,b_auto:predominant/${parts.rest}`,
    width: "1200", height: "630", card: "summary_large_image"
  };
}

/**
 * Aperçu d'un salon à partir de sa ligne (null = introuvable) ; id déjà validé ou null si invalide.
 * Renvoie { status, cache, title, description, image, canonicalUrl, targetUrl, redirectLabel }.
 */
export function buildRoomPreview(row, id) {
  if (!row || !isValidRoomId(id)) {
    return {
      status: 404,
      cache: "public, max-age=60, s-maxage=60",
      title: `Salon introuvable — ${ROOM_BRAND}`,
      description: "Ce salon n'existe pas ou n'existe plus.",
      image: DEFAULT_IMAGE,
      canonicalUrl: `${ROOM_SITE}/discussions.html`,
      targetUrl: `${ROOM_SITE}/discussions.html`,
      redirectLabel: "Salon introuvable. Redirection vers les discussions…"
    };
  }
  const image = roomOgImage(row.photo_url);
  const hasPhoto = image !== DEFAULT_IMAGE;
  const name = cut(row.name, 80) || "Salon";
  // Sans photo, l'émoji (validé) accompagne le nom, comme la pastille dans l'application.
  const title = hasPhoto ? name : `${globalThis.MahoutoRoomSafe.emoji(row.emoji)} ${name}`;
  const price = Number(row.price);
  const description = row.is_paid === true
    ? `Salon payant${price > 0 ? ` : ${money(price)}` : ""} — Rejoins ce salon sur ${ROOM_BRAND}`
    : `Rejoins ce salon sur ${ROOM_BRAND}`;
  const targetUrl = `${ROOM_SITE}/chat.html?room=${encodeURIComponent(id)}`;
  return {
    status: 200,
    // Courte durée : un changement de photo ou de nom apparaît vite (WhatsApp garde son propre cache).
    cache: "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
    title, description, image,
    canonicalUrl: `${ROOM_SITE}/r/${encodeURIComponent(id)}`,
    targetUrl,
    redirectLabel: "Ouverture du salon…"
  };
}

// Page d'aperçu : balises Open Graph et Twitter pour les robots, redirection pour les humains.
export function renderRoomPreviewPage(p) {
  const image = p.image || DEFAULT_IMAGE;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(ROOM_BRAND)}">
<meta property="og:title" content="${escapeHtml(p.title)}">
<meta property="og:description" content="${escapeHtml(p.description)}">
<meta property="og:url" content="${escapeHtml(p.canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(image.url)}">
<meta property="og:image:width" content="${escapeHtml(image.width)}">
<meta property="og:image:height" content="${escapeHtml(image.height)}">

<meta name="twitter:card" content="${escapeHtml(image.card || "summary_large_image")}">
<meta name="twitter:title" content="${escapeHtml(p.title)}">
<meta name="twitter:description" content="${escapeHtml(p.description)}">
<meta name="twitter:image" content="${escapeHtml(image.url)}">

<meta http-equiv="refresh" content="1;url=${escapeHtml(p.targetUrl)}">
<script>window.location.replace(${JSON.stringify(p.targetUrl)});</script>
</head>
<body style="background:#0A0A0A;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;">
  <p>${escapeHtml(p.redirectLabel || "Ouverture du salon…")}</p>
  <p><a href="${escapeHtml(p.targetUrl)}" style="color:#FFC107;">Cliquez ici si rien ne se passe</a></p>
</body>
</html>`;
}

function send(res, preview) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", preview.cache);
  return res.status(preview.status).send(renderRoomPreviewPage(preview));
}

/**
 * Réponse à GET /r/:id. deps.fetchRoom(id) → { row, error } (lecture avec la clé publique, champs ROOM_FIELDS).
 *  - identifiant invalide : 404 générique, AUCUNE requête ;
 *  - salon inexistant : 404 générique ;
 *  - erreur de lecture : 503 sans cache, mais l'humain est quand même redirigé vers le salon.
 */
export async function handleRoomPreview(req, res, deps) {
  const raw = req && req.query ? req.query.id : "";
  const id = typeof raw === "string" ? raw : "";
  if (!isValidRoomId(id)) return send(res, buildRoomPreview(null, null));

  let result;
  try {
    result = await deps.fetchRoom(id);
  } catch (err) {
    result = { row: null, error: err || new Error("lecture impossible") };
  }
  if (result && result.error) {
    return send(res, {
      status: 503,
      cache: "no-store",
      title: ROOM_BRAND,
      description: `Rejoins ce salon sur ${ROOM_BRAND}`,
      image: DEFAULT_IMAGE,
      canonicalUrl: `${ROOM_SITE}/r/${encodeURIComponent(id)}`,
      targetUrl: `${ROOM_SITE}/chat.html?room=${encodeURIComponent(id)}`,
      redirectLabel: "Ouverture du salon…"
    });
  }
  return send(res, buildRoomPreview(result && result.row ? result.row : null, id));
}
