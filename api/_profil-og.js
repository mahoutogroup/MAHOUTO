// =========================================================
// api/_profil-og.js — aperçu d'un lien de page publique /m/<adresse> (WhatsApp, Telegram, Facebook, Twitter…)
//
// Lien partagé : https://mahouto.com/m/<adresse>  (réécriture dans vercel.json, servie par api/produit-og.js,
// type « profil » : aucune nouvelle fonction Vercel, plafond de 12). Le préfixe « _ » évite qu'il soit compté
// comme fonction serverless. Ce module est PUR : aucun accès réseau, aucune dépendance autre que _cloudinary-og.js.
//
// Règles :
//  - site et marque FIXES : https://mahouto.com et « MAHOUTO+ » (jamais l'en-tête Host) ;
//  - l'adresse est validée AVANT toute lecture (même règle que la base : 3 à 30 caractères, minuscules, chiffres,
//    tirets, pas de tiret au début ni à la fin) ;
//  - la page est lue UNIQUEMENT par la fonction profil_public_lire(p_adresse) avec la clé anonyme (voir
//    api/produit-og.js) : interrupteur fermé, page non publiée, suspendue ou inexistante donnent la MÊME réponse,
//    l'aperçu GÉNÉRIQUE de la marque, qui ne révèle jamais si l'adresse existe ;
//  - page publique : titre « <nom affiché> — MAHOUTO+ », description = métier et localisation (puis un début de
//    présentation, coupé proprement, 200 caractères au plus), JAMAIS le contact public ; image = photo de la page
//    si c'est une image du compte Cloudinary du projet (métadonnées EXIF/GPS retirées), sinon l'image de la marque ;
//  - tout ce qui vient de la base est échappé pour le HTML ; aucun innerHTML ;
//  - noindex, nofollow : balise meta ET en-tête X-Robots-Tag, l'aperçu de partage ne rend pas les pages indexables ;
//  - cache court (5 minutes côté CDN) ; lecture en échec : 503 SANS cache (aperçu générique pour les robots), et les
//    humains sont quand même redirigés vers /m.html pour que la page reste utilisable ;
//  - alias : si l'adresse n'est pas une page, profil_public_alias_resoudre(p_alias) (clé anonyme) peut renvoyer l'adresse
//    PRINCIPALE d'une page réellement publique : aperçu et redirection se font alors sur la page principale (lien canonique
//    https://mahouto.com/m/<principale>) ; sinon comportement inchangé. Aucune requête en plus quand l'adresse est une page ;
//  - humains : redirection vers /m.html?adresse=<adresse>&src=<source> ; la source (ex. « qr ») est reprise de la chaîne
//    de requête d'origine, sinon déduite dans le navigateur (Facebook, Instagram, TikTok), sinon « partage ».
// =========================================================

import { cloudinaryImageParts } from "./_cloudinary-og.js";

export const PROFIL_SITE = "https://mahouto.com";
export const PROFIL_BRAND = "MAHOUTO+";
export const PROFIL_ADRESSE_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
export const PROFIL_SOURCE_RE = /^[a-z0-9_-]{1,40}$/;   // même règle que analytics.js
export const PROFIL_DESCRIPTION_MAX = 200;

// Image de marque par défaut (PNG 512x512 du site).
const DEFAULT_IMAGE = { url: `${PROFIL_SITE}/assets/icon-512.png`, width: "512", height: "512", card: "summary" };
const READABLE_EXTENSION = /^(?:jpe?g|png|webp|gif)$/i;
const GENERIC_DESCRIPTION = "Découvrez MAHOUTO+ — Construire l'Afrique numérique de demain.";

export function isValidProfilAdresse(adresse) {
  return typeof adresse === "string" && PROFIL_ADRESSE_RE.test(adresse);
}

/** Source déjà présente dans la chaîne de requête d'origine (?src=qr) : valeur valide ou chaîne vide. */
export function profilSourceFrom(value) {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return PROFIL_SOURCE_RE.test(v) ? v : "";
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Coupe proprement : aux espaces, jamais au milieu d'un mot si possible, avec « … ».
function cut(text, max) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return base.replace(/[\s,;:.\-–—]+$/, "") + "…";
}

// Image d'aperçu 1200x630 à partir de la photo de la page, ou null si elle n'est pas utilisable.
function ogImageFrom(url) {
  if (typeof url !== "string" || /[?#]/.test(url)) return null;
  const ext = (url.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
  if (ext && !READABLE_EXTENSION.test(ext)) return null;
  const parts = cloudinaryImageParts(url);                       // uniquement le compte Cloudinary du projet
  if (!parts) return null;
  return {
    url: `${parts.prefix}f_jpg,q_auto,fl_strip_profile,w_1200,h_630,c_pad,b_auto:predominant/${parts.rest}`,
    width: "1200", height: "630", card: "summary_large_image"
  };
}

export function profilOgImage(row) {
  return ogImageFrom(row && row.avatar_url) || DEFAULT_IMAGE;
}

/** Description : « métier · localisation », puis un début de présentation si la place le permet ; 200 caractères au plus. */
export function profilDescription(row) {
  const parts = [cut(row && row.metier, 80), cut(row && row.localisation, 60)].filter(Boolean);
  const base = parts.join(" · ");
  const presentation = cut(row && row.presentation, 1000);
  if (!base) return presentation ? cut(presentation, PROFIL_DESCRIPTION_MAX) : GENERIC_DESCRIPTION;
  const room = PROFIL_DESCRIPTION_MAX - base.length - 3;
  return presentation && room >= 40 ? `${base} — ${cut(presentation, room)}` : base;
}

function humanTarget(adresseForTarget, source) {
  const base = `${PROFIL_SITE}/m.html`;
  const params = [];
  if (adresseForTarget) params.push("adresse=" + adresseForTarget);
  if (source) params.push("src=" + source);
  return params.length ? `${base}?${params.join("&")}` : base;
}

// Aperçu générique de la marque : même contenu pour TOUT état non public (aucune information sur l'adresse).
function genericPreview(targetUrl, status, cache) {
  return {
    status, cache, generic: true,
    title: PROFIL_BRAND,
    description: GENERIC_DESCRIPTION,
    image: DEFAULT_IMAGE,
    canonicalUrl: `${PROFIL_SITE}/`,
    targetUrl
  };
}

/**
 * Aperçu à partir de la ligne renvoyée par profil_public_lire (null = rien : page non publique, suspendue, fermée ou inexistante).
 * adresse : adresse déjà validée ou null ; source : valeur de ?src= déjà validée (ou chaîne vide).
 * Une ligne dont l'adresse ne correspond pas, ou sans nom affiché, est traitée comme « rien ».
 */
export function buildProfilPreview(row, adresse, source, rawAdresse) {
  const target = humanTarget(isValidProfilAdresse(adresse) ? adresse : encodeURIComponent(String(rawAdresse == null ? "" : rawAdresse).slice(0, 64)), source || "");
  const cache = "public, max-age=60, s-maxage=300";
  if (!isValidProfilAdresse(adresse) || !row || row.adresse !== adresse) return genericPreview(target, 200, cache);
  const nom = cut(row.nom_affiche, 60);
  if (!nom) return genericPreview(target, 200, cache);
  return {
    status: 200, cache, generic: false,
    title: `${nom} — ${PROFIL_BRAND}`,
    description: profilDescription(row),
    image: profilOgImage(row),
    canonicalUrl: `${PROFIL_SITE}/m/${adresse}`,
    targetUrl: target
  };
}

// Redirection des humains : source de la chaîne de requête si elle existe, sinon déduite dans le navigateur
// (Facebook, Instagram, TikTok), sinon « partage ». Valeurs limitées à [a-z0-9_-]{1,40} comme analytics.js.
function redirectScript(p) {
  const hasSrc = /[?&]src=/.test(p.targetUrl);
  if (hasSrc) {
    return `<meta http-equiv="refresh" content="1;url=${escapeHtml(p.targetUrl)}">
<script>window.location.replace(${JSON.stringify(p.targetUrl)});</script>`;
  }
  const noSrc = p.targetUrl;
  return `<meta http-equiv="refresh" content="1;url=${escapeHtml(`${noSrc}${noSrc.includes("?") ? "&" : "?"}src=partage`)}">
<script>(function(){var t=${JSON.stringify(noSrc)},u=navigator.userAgent||"",s="partage";try{var q=new URLSearchParams(location.search).get("src");if(q&&/^[a-z0-9_-]{1,40}$/.test(q.toLowerCase()))s=q.toLowerCase();else if(/Instagram/i.test(u))s="instagram";else if(/FBAN|FBAV|FB_IAB|FBIOS/.test(u))s="facebook";else if(/musical_ly|BytedanceWebview|TikTok|trill/i.test(u))s="tiktok";}catch(e){}window.location.replace(t+(t.indexOf("?")<0?"?":"&")+"src="+s);})();</script>`;
}

// Page d'aperçu : balises Open Graph et Twitter pour les robots, noindex, redirection pour les humains.
export function renderProfilPreviewPage(p) {
  const image = p.image || DEFAULT_IMAGE;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(PROFIL_BRAND)}">
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

${redirectScript(p)}
</head>
<body style="background:#0A0A0A;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;">
  <p>Ouverture de la page…</p>
  <p><a href="${escapeHtml(p.targetUrl)}" style="color:#FFC107;">Cliquez ici si rien ne se passe</a></p>
</body>
</html>`;
}

function send(res, preview) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", preview.cache);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(preview.status).send(renderProfilPreviewPage(preview));
}

/**
 * Réponse à GET /m/:adresse. deps.fetchProfil(adresse) → { row, error } (appel RPC profil_public_lire, clé anonyme).
 *  - adresse invalide : aperçu générique, AUCUNE lecture ;
 *  - rien de public (inexistante, non publiée, suspendue, fonction fermée) : aperçu générique, même réponse ;
 *  - erreur de lecture : 503 sans cache (aperçu générique pour les robots), mais l'humain est redirigé vers /m.html.
 */
export async function handleProfilPreview(req, res, deps) {
  const query = req && req.query ? req.query : {};
  const raw = typeof query.adresse === "string" ? query.adresse : "";
  const source = profilSourceFrom(query.src);
  const adresse = isValidProfilAdresse(raw) ? raw : null;
  if (!adresse) return send(res, buildProfilPreview(null, null, source, raw));

  let result;
  try {
    result = await deps.fetchProfil(adresse);
  } catch (err) {
    result = { row: null, error: err || new Error("lecture impossible") };
  }
  if (result && result.error) {
    return send(res, genericPreview(humanTarget(adresse, source), 503, "no-store"));
  }
  // Alias (adresse supplémentaire gérée par les administrateurs) : seulement quand l'adresse n'est PAS une page publique.
  // profil_public_alias_resoudre ne renvoie que l'adresse principale (jamais autre chose) et seulement si la page est réellement
  // publique. On sert alors l'aperçu de la page principale (lien canonique = adresse principale) et les humains sont redirigés vers
  // /m.html?adresse=<principale>. Aucun appel supplémentaire quand l'adresse est déjà une page.
  if (!(result && result.row) && deps.fetchAlias) {
    let alias;
    try {
      alias = await deps.fetchAlias(adresse);
    } catch (err) {
      alias = { adresse: null, error: err || new Error("lecture impossible") };
    }
    if (alias && alias.error) {
      return send(res, genericPreview(humanTarget(adresse, source), 503, "no-store"));
    }
    const principale = alias && isValidProfilAdresse(alias.adresse) && alias.adresse !== adresse ? alias.adresse : null;
    if (principale) {
      let page;
      try {
        page = await deps.fetchProfil(principale);
      } catch (err) {
        page = { row: null, error: err || new Error("lecture impossible") };
      }
      if (page && page.error) {
        return send(res, genericPreview(humanTarget(principale, source), 503, "no-store"));
      }
      return send(res, buildProfilPreview(page && page.row ? page.row : null, principale, source, principale));
    }
  }
  return send(res, buildProfilPreview(result && result.row ? result.row : null, adresse, source, raw));
}
