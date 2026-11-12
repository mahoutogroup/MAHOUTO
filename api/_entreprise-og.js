// =========================================================
// api/_entreprise-og.js — aperçu d'un lien de vitrine d'entreprise (WhatsApp, Telegram, Facebook, Twitter…)
//
// Lien partagé : https://mahouto.com/e/<slug>  (réécriture dans vercel.json, servie par
// api/produit-og.js, type « entreprise » : aucune nouvelle fonction Vercel, plafond de 12).
//
// Ce module est pur (aucun accès réseau) : il valide le slug, construit les balises Open Graph et
// Twitter à partir de la ligne `entreprises` (slug, nom_commercial, description, ville, logo_url,
// banner_url, published : rien d'autre), et gère la réponse. Le préfixe « _ » évite qu'il soit
// compté comme fonction serverless.
//
// Règles :
//  - le site et la marque sont fixes : https://mahouto.com et « MAHOUTO+ », quel que soit le domaine ;
//  - le slug est validé (^[a-z0-9-]{2,40}$) AVANT toute lecture ;
//  - tout ce qui vient de la base (nom, description, ville) est échappé pour le HTML ; aucun innerHTML ;
//  - image 1200x630 : photo principale (banner_url) si elle est utilisable, sinon le logo, sinon l'image
//    par défaut de la marque ; seule une image du compte Cloudinary du projet est utilisée
//    (api/_cloudinary-og.js), avec suppression des métadonnées EXIF/GPS (fl_strip_profile) ;
//  - introuvable ou non publié : 404 générique ; lecture en échec : 503 sans cache ;
//    robots : balises ; humains : redirection vers la page de la vitrine.
// =========================================================

import { cloudinaryImageParts } from "./_cloudinary-og.js";

export const ENTREPRISE_SITE = "https://mahouto.com";
export const ENTREPRISE_BRAND = "MAHOUTO+";
export const ENTREPRISE_SLUG_RE = /^[a-z0-9-]{2,40}$/;
export const ENTREPRISE_FIELDS = "slug, nom_commercial, description, ville, logo_url, banner_url, published";

// Image de marque par défaut (PNG 512x512 du site).
const DEFAULT_IMAGE = { url: `${ENTREPRISE_SITE}/assets/icon-512.png`, width: "512", height: "512", card: "summary" };
// Formats d'image source acceptés (WhatsApp ne lit ni SVG, ni PDF, ni PSD, ni HEIC…).
const READABLE_EXTENSION = /^(?:jpe?g|png|webp|gif)$/i;

export function isValidEntrepriseSlug(slug) {
  return typeof slug === "string" && ENTREPRISE_SLUG_RE.test(slug);
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cut(text, max) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Image d'aperçu 1200x630 à partir d'une adresse, ou null si elle n'est pas utilisable.
function ogImageFrom(url) {
  if (typeof url !== "string" || /[?#]/.test(url)) return null;
  const ext = (url.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
  if (ext && !READABLE_EXTENSION.test(ext)) return null;          // format non lu par WhatsApp
  const parts = cloudinaryImageParts(url);                         // domaine de stockage attendu
  if (!parts) return null;
  return {
    url: `${parts.prefix}f_jpg,q_auto,fl_strip_profile,w_1200,h_630,c_pad,b_auto:predominant/${parts.rest}`,
    width: "1200", height: "630", card: "summary_large_image"
  };
}

// Photo principale (bannière), sinon logo, sinon image par défaut.
export function entrepriseOgImage(row) {
  return ogImageFrom(row && row.banner_url) || ogImageFrom(row && row.logo_url) || DEFAULT_IMAGE;
}

function notFoundPreview() {
  return {
    status: 404,
    cache: "public, max-age=60, s-maxage=60",
    title: `Vitrine introuvable — ${ENTREPRISE_BRAND}`,
    description: "Cette vitrine n'existe pas ou n'est plus publiée.",
    image: DEFAULT_IMAGE,
    canonicalUrl: `${ENTREPRISE_SITE}/`,
    targetUrl: `${ENTREPRISE_SITE}/`,
    redirectLabel: "Vitrine introuvable. Redirection vers l'accueil…"
  };
}

/**
 * Aperçu d'une vitrine à partir de sa ligne (null = introuvable) ; slug déjà validé ou null si invalide.
 * Une ligne non publiée (published !== true) ou sans nom commercial est traitée comme introuvable.
 */
export function buildEntreprisePreview(row, slug) {
  if (!row || !isValidEntrepriseSlug(slug) || row.published !== true) return notFoundPreview();
  const name = cut(row.nom_commercial, 80);
  if (!name) return notFoundPreview();
  const place = cut(row.ville, 60);
  const description = cut(row.description, 160) || (place ? `${name} — ${place}. Découvrez cette vitrine sur ${ENTREPRISE_BRAND}` : `Découvrez ${name} sur ${ENTREPRISE_BRAND}`);
  return {
    status: 200,
    // Courte durée : un changement de photo ou de nom apparaît vite (WhatsApp garde son propre cache).
    cache: "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
    title: name,
    description,
    image: entrepriseOgImage(row),
    canonicalUrl: `${ENTREPRISE_SITE}/e/${encodeURIComponent(slug)}`,
    targetUrl: `${ENTREPRISE_SITE}/entreprise.html?slug=${encodeURIComponent(slug)}`,
    redirectLabel: "Ouverture de la vitrine…"
  };
}

// Page d'aperçu : balises Open Graph et Twitter pour les robots, redirection pour les humains.
export function renderEntreprisePreviewPage(p) {
  const image = p.image || DEFAULT_IMAGE;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(ENTREPRISE_BRAND)}">
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
  <p>${escapeHtml(p.redirectLabel || "Ouverture de la vitrine…")}</p>
  <p><a href="${escapeHtml(p.targetUrl)}" style="color:#FFC107;">Cliquez ici si rien ne se passe</a></p>
</body>
</html>`;
}

function send(res, preview) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", preview.cache);
  return res.status(preview.status).send(renderEntreprisePreviewPage(preview));
}

/**
 * Réponse à GET /e/:slug. deps.fetchEntreprise(slug) → { row, error } (lecture avec la clé publique, champs ENTREPRISE_FIELDS).
 *  - slug invalide : 404 générique, AUCUNE lecture ;
 *  - vitrine inexistante ou non publiée : 404 générique ;
 *  - erreur de lecture : 503 sans cache, mais l'humain est quand même redirigé vers la page.
 */
export async function handleEntreprisePreview(req, res, deps) {
  const raw = req && req.query ? req.query.slug : "";
  const slug = typeof raw === "string" ? raw : "";
  if (!isValidEntrepriseSlug(slug)) return send(res, notFoundPreview());

  let result;
  try {
    result = await deps.fetchEntreprise(slug);
  } catch (err) {
    result = { row: null, error: err || new Error("lecture impossible") };
  }
  if (result && result.error) {
    return send(res, {
      status: 503,
      cache: "no-store",
      title: ENTREPRISE_BRAND,
      description: `Découvrez cette vitrine sur ${ENTREPRISE_BRAND}`,
      image: DEFAULT_IMAGE,
      canonicalUrl: `${ENTREPRISE_SITE}/e/${encodeURIComponent(slug)}`,
      targetUrl: `${ENTREPRISE_SITE}/entreprise.html?slug=${encodeURIComponent(slug)}`,
      redirectLabel: "Ouverture de la vitrine…"
    });
  }
  return send(res, buildEntreprisePreview(result && result.row ? result.row : null, slug));
}
