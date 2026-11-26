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
//    SEULE EXCEPTION : une page que l'administrateur a rendue indexable (colonne indexable, profil_public_indexable) ET
//    servie depuis mahouto.com : voir « Indexation » plus bas (aucun noindex, canonical, contenu dans le HTML) ;
//  - cache court (5 minutes côté CDN) ; lecture en échec : 503 SANS cache (aperçu générique pour les robots), et les
//    humains sont quand même redirigés vers /m.html pour que la page reste utilisable ;
//  - alias : si l'adresse n'est pas une page, profil_public_alias_resoudre(p_alias) (clé anonyme) peut renvoyer l'adresse
//    PRINCIPALE d'une page réellement publique : aperçu et redirection se font alors sur la page principale (lien canonique
//    https://mahouto.com/m/<principale>) ; sinon comportement inchangé. Aucune requête en plus quand l'adresse est une page ;
//  - carte d'aperçu dans les messages : handleProfilJson (type=profil&format=json), mêmes lectures, mêmes règles : voir plus bas ;
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
 * Lecture d'une page par son adresse, avec résolution d'un alias — commune à l'aperçu HTML et à l'aperçu JSON (mêmes requêtes).
 * Renvoie { error, row, adresse } : adresse = l'adresse PRINCIPALE si l'adresse demandée est un alias (sinon l'adresse demandée) ;
 * row = la ligne renvoyée par profil_public_lire (null = rien de public) ; error = une lecture a échoué.
 * Alias (adresse supplémentaire gérée par les administrateurs) : seulement quand l'adresse n'est PAS une page publique ;
 * profil_public_alias_resoudre ne renvoie que l'adresse principale d'une page réellement publique. Aucun appel supplémentaire
 * quand l'adresse est déjà une page.
 */
export async function readProfilPage(adresse, deps) {
  let result;
  try {
    result = await deps.fetchProfil(adresse);
  } catch (err) {
    result = { row: null, error: err || new Error("lecture impossible") };
  }
  if (result && result.error) return { error: true, row: null, adresse };
  if (!(result && result.row) && deps.fetchAlias) {
    let alias;
    try {
      alias = await deps.fetchAlias(adresse);
    } catch (err) {
      alias = { adresse: null, error: err || new Error("lecture impossible") };
    }
    if (alias && alias.error) return { error: true, row: null, adresse };
    const principale = alias && isValidProfilAdresse(alias.adresse) && alias.adresse !== adresse ? alias.adresse : null;
    if (principale) {
      let page;
      try {
        page = await deps.fetchProfil(principale);
      } catch (err) {
        page = { row: null, error: err || new Error("lecture impossible") };
      }
      if (page && page.error) return { error: true, row: null, adresse: principale };
      return { error: false, row: page && page.row ? page.row : null, adresse: principale };
    }
  }
  return { error: false, row: result && result.row ? result.row : null, adresse };
}

/**
 * Réponse à GET /m/:adresse. deps.fetchProfil(adresse) → { row, error } (appel RPC profil_public_lire, clé anonyme) ;
 * deps.fetchAlias(adresse) → { adresse, error } (appel RPC profil_public_alias_resoudre), optionnel.
 *  - adresse invalide : aperçu générique, AUCUNE lecture ;
 *  - rien de public (inexistante, non publiée, suspendue, fonction fermée) : aperçu générique, même réponse ;
 *  - alias : aperçu de la page principale (lien canonique = adresse principale), redirection des humains vers la principale ;
 *  - erreur de lecture : 503 sans cache (aperçu générique pour les robots), mais l'humain est redirigé vers /m.html.
 */
export async function handleProfilPreview(req, res, deps) {
  const query = req && req.query ? req.query : {};
  const raw = typeof query.adresse === "string" ? query.adresse : "";
  const source = profilSourceFrom(query.src);
  const adresse = isValidProfilAdresse(raw) ? raw : null;
  if (!adresse) return send(res, buildProfilPreview(null, null, source, raw));

  const page = await readProfilPage(adresse, deps);
  if (page.error) return send(res, genericPreview(humanTarget(page.adresse, source), 503, "no-store"));
  const preview = buildProfilPreview(page.row, page.adresse, source, page.adresse === adresse ? raw : page.adresse);
  // Indexation : seulement une page réelle (pas un alias), sur mahouto.com, décidée par un administrateur. Toute erreur ou doute = noindex.
  if (!preview.generic && page.adresse === adresse && deps.fetchIndexable && isIndexableHost(req)) {
    let verdict = null;
    try { verdict = await deps.fetchIndexable(adresse); } catch (err) { verdict = null; }
    if (verdict && !verdict.error && verdict.indexable === true) {
      return sendIndexable(res, buildProfilIndexable(page.row, adresse), source);
    }
  }
  return send(res, preview);
}

// ---------------------------------------------------------
// Indexation par les moteurs de recherche (page par page, décidée par un administrateur).
//  - la base décide : profil_public_indexable(adresse) = publiée, non suspendue, interrupteur ouvert ET indexable ;
//  - jamais depuis majestepresse.com ni un domaine de test (*.vercel.app) : l'hôte doit être mahouto.com (repli : noindex) ;
//  - jamais un alias : seule la page principale est indexable ; canonical TOUJOURS https://mahouto.com/m/<adresse> ;
//  - titre « Nom, métier à Ville », description et JSON-LD : seulement des champs déjà publics (jamais le contact) ;
//  - le contenu utile est DANS le HTML initial (nom, métier, ville, présentation, liens) ; pas de redirection automatique
//    sans ?src= (les robots lisent l'adresse propre ; les liens de QR code et de partage portent ?src= et vont à la carte) ;
//  - cache court (60 s) : une page dépubliée, suspendue ou retirée redevient noindex aussitôt.
// ---------------------------------------------------------
export const PROFIL_INDEX_HOSTS = ["mahouto.com", "www.mahouto.com"];
export const PROFIL_INDEXABLE_CACHE = "public, max-age=0, s-maxage=60";

/** Hôte de la requête (x-forwarded-host puis host), sans port, en minuscules : vrai seulement pour mahouto.com. */
export function isIndexableHost(req) {
  // L'hôte ne sert QU'À RESTREINDRE (repli = noindex) : le site et la marque affichés restent fixes (PROFIL_SITE).
  const hdr = req && req.headers ? req.headers : {};
  const host = String(hdr["x-forwarded-host"] || hdr["host"] || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  return PROFIL_INDEX_HOSTS.includes(host);
}

/** Titre « Nom, métier à Ville » (les parties absentes sont omises). */
export function profilIndexableTitle(row) {
  const nom = cut(row && row.nom_affiche, 60), metier = cut(row && row.metier, 80), ville = cut(row && row.localisation, 60);
  if (nom && metier && ville) return `${nom}, ${metier} à ${ville}`;
  if (nom && metier) return `${nom}, ${metier}`;
  if (nom && ville) return `${nom} à ${ville}`;
  return nom;
}

// JSON sûr dans une balise script : « < », « > », « & » et les séparateurs de ligne Unicode sont échappés.
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Lien de contact PUBLIC de la carte (déjà visible sur la page) : https://wa.me/<numéro> ou lien https ; sinon null. */
export function profilContactHref(row) {
  const t = row && row.contact_type, v = row && row.contact_valeur;
  if (t === "whatsapp" && typeof v === "string" && /^\+[1-9][0-9]{7,14}$/.test(v)) return { href: `https://wa.me/${v.slice(1)}`, label: "Contacter sur WhatsApp" };
  if (t === "lien" && typeof v === "string" && /^https:\/\/[^\s\u0000-\u001f]{4,300}$/.test(v)) return { href: v, label: "Ouvrir le lien de contact" };
  return null;
}

/** Tout ce qu'il faut pour la page indexable, à partir de la ligne publique : champs déjà publics seulement. */
export function buildProfilIndexable(row, adresse) {
  const nom = cut(row && row.nom_affiche, 60);
  const metier = cut(row && row.metier, 80), ville = cut(row && row.localisation, 60);
  const presentation = cut(row && row.presentation, 280);
  const canonicalUrl = `${PROFIL_SITE}/m/${adresse}`;
  const title = profilIndexableTitle(row);
  const description = profilDescription(row);
  const photo = profilCardImage(row);
  const ld = { "@context": "https://schema.org", "@type": "Person", name: nom, url: canonicalUrl };
  if (metier) ld.jobTitle = metier;
  if (presentation) ld.description = presentation;
  if (ville) ld.workLocation = { "@type": "Place", name: ville };
  if (photo) ld.image = photo;
  return { adresse, canonicalUrl, title, description, nom, metier, ville, presentation, photo, contact: profilContactHref(row), jsonLd: safeJsonLd(ld),
    image: profilOgImage(row), cardUrl: `${PROFIL_SITE}/m.html?adresse=${adresse}&src=recherche` };
}

/** Page HTML d'une carte indexable : contenu dans le HTML initial, canonical mahouto.com, JSON-LD, aucune balise noindex. */
export function renderProfilIndexablePage(p, source) {
  const image = p.image || DEFAULT_IMAGE;
  const redirect = source ? `<script>window.location.replace(${safeJsonLd(humanTarget(p.adresse, source))});</script>\n` : "";
  const contact = p.contact ? `<p><a class="btn" href="${escapeHtml(p.contact.href)}" rel="nofollow noopener">${escapeHtml(p.contact.label)}</a></p>` : "";
  const ligne = [p.metier, p.ville].filter(Boolean).join(" · ");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<link rel="canonical" href="${escapeHtml(p.canonicalUrl)}">

<meta property="og:type" content="profile">
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

<script type="application/ld+json">${p.jsonLd}</script>
<style>
:root{color-scheme:dark light}
body{margin:0;background:#0A0A0A;color:#fff;font-family:system-ui,sans-serif;line-height:1.6}
main{max-width:640px;margin:0 auto;padding:40px 20px;text-align:center}
img{width:120px;height:120px;border-radius:50%;object-fit:cover}
h1{font-size:1.6rem;margin:16px 0 4px}
.ligne{color:#FFC107;margin:0 0 16px}
.btn{display:inline-block;margin:6px;padding:12px 20px;border-radius:12px;background:#FFC107;color:#000;font-weight:700;text-decoration:none}
.sec{background:transparent;color:inherit;border:1px solid #888}
footer{margin-top:32px;font-size:.9rem}
a{color:#FFC107}
@media (prefers-color-scheme:light){body{background:#F7F7F7;color:#111}.ligne,a{color:#856500}.btn{color:#000}.sec{border-color:#555}}
</style>
${redirect}</head>
<body>
<main>
${p.photo ? `<img src="${escapeHtml(p.photo)}" alt="" width="120" height="120">` : ""}
<h1>${escapeHtml(p.nom)}</h1>
${ligne ? `<p class="ligne">${escapeHtml(ligne)}</p>` : ""}
${p.presentation ? `<p>${escapeHtml(p.presentation)}</p>` : ""}
${contact}
<p><a class="btn sec" href="${escapeHtml(p.cardUrl)}">Ouvrir la carte complète</a></p>
<footer><a href="${escapeHtml(PROFIL_SITE)}/">${escapeHtml(PROFIL_BRAND)}</a> · <a href="${escapeHtml(PROFIL_SITE)}/regles-pages-publiques">Règles des pages publiques</a></footer>
</main>
</body>
</html>`;
}

function sendIndexable(res, p, source) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", PROFIL_INDEXABLE_CACHE);
  return res.status(200).send(renderProfilIndexablePage(p, source));
}

// ---------------------------------------------------------
// Plan du site des cartes indexables : GET /sitemap-cartes.xml (réécriture vers api/produit-og.js?type=sitemap-cartes).
// deps.fetchSitemap() → { rows: [{adresse, modifie_le}], error } (fonction profil_public_sitemap, clé publique). Seules les adresses
// valides sont écrites, toujours en https://mahouto.com/m/<adresse> ; vide s'il n'y a aucune page indexable ; erreur : 503 sans cache.
// ---------------------------------------------------------
export function renderProfilSitemap(rows) {
  const urls = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && isValidProfilAdresse(r.adresse))
    .map((r) => {
      const t = r.modifie_le ? Date.parse(r.modifie_le) : NaN;
      const lastmod = isFinite(t) ? `<lastmod>${new Date(t).toISOString()}</lastmod>` : "";
      return `  <url><loc>${escapeHtml(`${PROFIL_SITE}/m/${r.adresse}`)}</loc>${lastmod}</url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.length ? "\n" + urls.join("\n") + "\n" : "\n"}</urlset>\n`;
}

export async function handleProfilSitemap(req, res, deps) {
  let result;
  try { result = await deps.fetchSitemap(); } catch (err) { result = { rows: [], error: err || new Error("lecture impossible") }; }
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  if (result && result.error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).send(renderProfilSitemap([]));
  }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  return res.status(200).send(renderProfilSitemap(result && result.rows));
}

// ---------------------------------------------------------
// Carte d'aperçu dans les messages (chat.html, dm-chat.html) : GET /api/produit-og?type=profil&adresse=<adresse>&format=json
// Même lecture et même résolution d'alias que l'aperçu HTML (readProfilPage). Réponse {title, description, image, adresse} :
// nom affiché, « métier · ville — début de la présentation » (même construction que l'aperçu de partage), photo de la page
// seulement si elle vient du compte Cloudinary du projet (carré 160 px, métadonnées retirées) sinon chaîne vide, adresse
// PRINCIPALE. JAMAIS le contact, jamais d'identifiant de compte, jamais un champ absent de l'aperçu de partage public.
// Page non publique (inexistante, non publiée, suspendue, fonction fermée) : 404 sans aucun contenu de page.
// Erreur de lecture : 503 sans cache. Cache court (5 minutes), noindex.
// ---------------------------------------------------------
export const PROFIL_JSON_CACHE = "public, max-age=60, s-maxage=300";

/** Photo de la carte : carré 160 px recadré, seulement pour une image du compte Cloudinary du projet ; sinon chaîne vide. */
export function profilCardImage(row) {
  const url = row && row.avatar_url;
  if (typeof url !== "string" || /[?#]/.test(url)) return "";
  const ext = (url.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
  if (ext && !READABLE_EXTENSION.test(ext)) return "";
  const parts = cloudinaryImageParts(url);
  return parts ? `${parts.prefix}f_jpg,q_auto,fl_strip_profile,w_160,h_160,c_fill,g_auto/${parts.rest}` : "";
}

/** Corps JSON de la carte pour une ligne publique, ou null si la ligne ne correspond pas à l'adresse ou n'a pas de nom. */
export function buildProfilCard(row, adresse) {
  if (!isValidProfilAdresse(adresse) || !row || row.adresse !== adresse) return null;
  const nom = cut(row.nom_affiche, 60);
  if (!nom) return null;
  return { title: nom, description: profilDescription(row), image: profilCardImage(row), adresse };
}

function sendJson(res, status, cache, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(status).json(body);
}

export async function handleProfilJson(req, res, deps) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, "no-store", { error: "method_not_allowed" });
  const query = req && req.query ? req.query : {};
  const adresse = isValidProfilAdresse(query.adresse) ? query.adresse : null;
  if (!adresse) return sendJson(res, 404, PROFIL_JSON_CACHE, { error: "not_found" });   // AVANT toute lecture

  const page = await readProfilPage(adresse, deps);
  if (page.error) return sendJson(res, 503, "no-store", { error: "unavailable" });
  const card = buildProfilCard(page.row, page.adresse);
  if (!card) return sendJson(res, 404, PROFIL_JSON_CACHE, { error: "not_found" });
  return sendJson(res, 200, PROFIL_JSON_CACHE, card);
}
