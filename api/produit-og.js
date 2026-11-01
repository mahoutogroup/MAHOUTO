// =========================================================
// /api/produit-og.js
//
// Sert un lien de partage "riche" pour un produit numérique
// OU pour une formation (MAHOUTO School / Académie Majesté
// Presse), selon le paramètre ?type=.
// Utilisé via les réécritures (voir vercel.json) :
//   /p/:id -> /api/produit-og?type=produit&id=:id   (défaut)
//   /f/:id -> /api/produit-og?type=formation&id=:id
//
// Troisième cas : les produits du Sérigraphe (type=serigraphie, lien court
//   /s/:id -> /api/produit-og?type=serigraphie&id=:id), voir handleSerigraphie.
//
// Une seule fonction gère les deux cas exprès : le plan Vercel
// Hobby est limité à 12 fonctions serverless, déjà toutes
// utilisées. Ajouter "formation-og.js" séparément aurait
// dépassé cette limite et cassé le déploiement.
//
// Pourquoi cette fonction existe :
// produit-detail.html / formation-detail.html sont des pages
// 100% JavaScript (le contenu est rempli après coup via
// Supabase). Les robots d'aperçu de WhatsApp, Facebook,
// Telegram, etc. ne exécutent PAS ce JavaScript : ils lisent
// uniquement les balises <meta> déjà présentes dans le HTML
// brut. Sans cette fonction, un lien partagé affiche un aperçu
// vide (pas d'image, pas de titre, pas de prix).
//
// Cette fonction :
// 1. Récupère le produit ou la formation dans Supabase (lecture
//    publique, déjà autorisée par les policies existantes —
//    aucune clé secrète nécessaire).
// 2. Renvoie une petite page HTML avec les balises Open Graph
//    / Twitter Card correctement remplies (titre, description,
//    image, prix).
// 3. Redirige automatiquement (humain = JS + meta refresh)
//    vers la vraie fiche (produit-detail.html?id=... ou
//    formation-detail.html?course=...) pour que l'utilisateur
//    atterrisse sur l'app normale.
//
// Variables d'environnement Vercel attendues (déjà utilisées
// ailleurs dans /api) :
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";
import { brandForRequest } from "./_brand.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function optimizedImageUrl(url, width) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width},c_limit/`);
}

function money(xof) {
  return Number(xof || 0).toLocaleString("fr-FR") + " FCFA";
}

// Redirection avec « ?src= » (comptage anonyme des visites, analytics.js) : le navigateur intégré
// (Facebook, Instagram, TikTok) est reconnu DANS le navigateur du visiteur, au moment de la redirection :
// rien n'est lu ni enregistré côté serveur (la page reste identique pour tous et mise en cache).
// Valeurs : facebook, instagram, tiktok, sinon « partage ». La redirection « meta » (sans JavaScript)
// attend 1 seconde pour laisser le script passer en premier.
function redirectWithSource(targetUrl) {
  const joiner = targetUrl.includes("?") ? "&" : "?";
  return `<meta http-equiv="refresh" content="1;url=${escapeHtml(`${targetUrl}${joiner}src=partage`)}">
<script>(function(){var t=${JSON.stringify(targetUrl)},u=navigator.userAgent||"",s="partage";if(/Instagram/i.test(u))s="instagram";else if(/FBAN|FBAV|FB_IAB|FBIOS/.test(u))s="facebook";else if(/musical_ly|BytedanceWebview|TikTok|trill/i.test(u))s="tiktok";window.location.replace(t+(t.indexOf("?")<0?"?":"&")+"src="+s);})();</script>`;
}

function renderRedirectPage({ title, description, image, imageWidth, imageHeight, canonicalUrl, targetUrl, siteName, withSource }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>

<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}${image && imageWidth && imageHeight ? `
<meta property="og:image:width" content="${escapeHtml(imageWidth)}">
<meta property="og:image:height" content="${escapeHtml(imageHeight)}">` : ""}
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:site_name" content="${escapeHtml(siteName)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}

${withSource ? redirectWithSource(targetUrl) : `<meta http-equiv="refresh" content="0;url=${escapeHtml(targetUrl)}">
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>`}
</head>
<body style="background:#0A0A0A;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;">
  <p>Redirection vers la boutique ${escapeHtml(siteName)}…</p>
  <p><a href="${escapeHtml(targetUrl)}" style="color:#FFC107;">Cliquez ici si rien ne se passe</a></p>
</body>
</html>`;
}

async function handleProduit(req, res, base) {
  const brandName = brandForRequest(req).name;
  const productId = (req.query && req.query.id) || "";

  if (!productId) {
    return res.status(302).setHeader("Location", `${base}/produits.html`).end();
  }

  const targetUrl = `${base}/produit-detail.html?id=${encodeURIComponent(productId)}`;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, anonKey);

    const { data: product, error } = await supabase
      .from("digital_products_public")
      .select("nom, description, image_url, prix, promotion, disponible")
      .eq("id", productId)
      .maybeSingle();

    if (error || !product || !product.disponible) {
      return res.status(200).send(
        renderRedirectPage({
          siteName: brandName,
          title: `${brandName} — Boutique`,
          description: "Découvrez nos produits numériques.",
          image: "",
          canonicalUrl: `${base}/produits.html`,
          targetUrl: `${base}/produits.html`,
        })
      );
    }

    const amount = product.promotion ?? product.prix;
    const title = product.nom;
    const description = `${money(amount)} — ${product.description || `Produit numérique ${brandName}`}`;
    const image = product.image_url ? optimizedImageUrl(product.image_url, 1200) : "";

    return res.status(200).send(
      renderRedirectPage({ title, description, image, canonicalUrl: targetUrl, targetUrl, siteName: brandName, withSource: true })
    );
  } catch (err) {
    console.error(err);
    return res.status(200).send(
      renderRedirectPage({
        siteName: brandName,
        title: `${brandName} — Boutique`,
        description: "Découvrez nos produits numériques.",
        image: "",
        canonicalUrl: `${base}/produits.html`,
        targetUrl,
      })
    );
  }
}

async function handleFormation(req, res, base) {
  const brandName = brandForRequest(req).name;
  const formationId = (req.query && req.query.id) || "";
  const fallbackUrl = `${base}/school.html`;

  if (!formationId) {
    return res.status(302).setHeader("Location", fallbackUrl).end();
  }

  const targetUrl = `${base}/formation-detail.html?course=${encodeURIComponent(formationId)}`;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, anonKey);

    const { data: formation, error } = await supabase
      .from("formations")
      .select("nom, description, image_url, prix, promotion, disponible, provider")
      .eq("id", formationId)
      .maybeSingle();

    if (error || !formation || !formation.disponible) {
      const catalogUrl = formation && formation.provider === "academie_majestepresse"
        ? `${base}/academie-majestepresse.html`
        : fallbackUrl;
      return res.status(200).send(
        renderRedirectPage({
          siteName: brandName,
          title: `${brandName} — Formations`,
          description: "Découvrez nos formations professionnelles.",
          image: "",
          canonicalUrl: catalogUrl,
          targetUrl: catalogUrl,
        })
      );
    }

    const amount = formation.promotion ?? formation.prix;
    const title = formation.nom;
    const description = `${money(amount)} — ${formation.description || `Formation ${brandName}`}`;
    const image = formation.image_url ? optimizedImageUrl(formation.image_url, 1200) : "";

    return res.status(200).send(
      renderRedirectPage({ title, description, image, canonicalUrl: targetUrl, targetUrl, siteName: brandName })
    );
  } catch (err) {
    console.error(err);
    return res.status(200).send(
      renderRedirectPage({
        siteName: brandName,
        title: `${brandName} — Formations`,
        description: "Découvrez nos formations professionnelles.",
        image: "",
        canonicalUrl: fallbackUrl,
        targetUrl,
      })
    );
  }
}

// ---------------------------------------------------------
// Produits du Sérigraphe (marketplace des sérigraphes)
// Lecture avec la clé publique (anon) : la RLS ne renvoie que les produits
// « active » dont le vendeur est approuvé, et la vue serigraphie_vendors_public
// n'expose que le nom de l'atelier et la ville (jamais le WhatsApp ni la commission).
// Tout cas « introuvable / masqué / invalide » aboutit à la même redirection
// vers le catalogue, sans révéler lequel.
// ---------------------------------------------------------
const SERIGRAPHIE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Nom du « cloud » Cloudinary du projet (public) : variable Vercel si définie, sinon la valeur de config.js.
const CLOUDINARY_CLOUD = (process.env.CLOUDINARY_CLOUD_NAME || "hefa5gqf").trim();

// Image d'aperçu 1200x630. Seule une image du compte Cloudinary du projet est utilisée ;
// toute autre origine (ou image absente) -> image par défaut MAJESTÉ (URL absolue).
// « c_pad » + « b_auto:predominant » : l'image entière est conservée (pas de rognage), qu'elle soit
// carrée, verticale ou un collage de plusieurs vues ; l'espace restant est comblé avec la couleur
// dominante de l'image. (« b_blurred » est refusé par le compte Cloudinary : erreur HTTP 400.)
// f_auto / q_auto : format et qualité automatiques (poids réduit).
//
// Une adresse enregistrée peut déjà contenir UN segment de transformation, par exemple
//   .../image/upload/f_auto,q_auto,w_1000,c_limit/v1793189115/dossier/image.png
// Il est alors REMPLACÉ par le nôtre (jamais empilé). Segment reconnu = uniquement des
// paramètres connus (f, q, w, h, c, dpr, ar, g), suivi d'un segment de version « v<chiffres> ».
// Tout segment de transformation inconnu ou multiple -> image par défaut (on ne devine pas).
const KNOWN_TRANSFORM_TOKEN = /^(?:f|q|w|h|c|dpr|ar|g)_[A-Za-z0-9:._-]+$/;

// Adresse d'image Cloudinary du projet, sans transformation : { prefix, rest } ou null.
// (validation du domaine, de /image/upload/, de « .. », des caractères interdits, et
// retrait d'UN segment de transformation connu — voir le commentaire ci-dessus.)
function cloudinaryImageParts(first) {
  if (typeof first !== "string") return null;

  const prefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/`;
  if (!first.startsWith(prefix) || first.length > 500 || /[\s"'<>]/.test(first)) return null;

  let rest = first.slice(prefix.length);
  if (!rest || rest.includes("..")) return null;

  const slash = rest.indexOf("/");
  if (slash > 0) {
    const firstSegment = rest.slice(0, slash);
    if (!/^v\d+$/.test(firstSegment)) {
      // Segment qui ressemble à une transformation (virgule, ou « xx_valeur ») ?
      if (firstSegment.includes(",") || /^[a-z]{1,4}_/.test(firstSegment)) {
        const known = firstSegment.split(",").every((t) => KNOWN_TRANSFORM_TOKEN.test(t));
        const afterSegment = rest.slice(slash + 1);
        const next = afterSegment.split("/")[0];
        if (!known || !/^v\d+$/.test(next) || !afterSegment.includes("/")) return null;
        rest = afterSegment;   // transformation existante retirée
      }
      // sinon : simple dossier (public_id sans version) -> conservé tel quel
    }
  }
  return { prefix, rest };
}

function serigraphieOgImage(images, base) {
  const fallback = { url: `${base}/assets/og-majeste.png`, width: "1200", height: "630" };
  const parts = cloudinaryImageParts(Array.isArray(images) ? images[0] : null);
  if (!parts) return fallback;
  return {
    url: `${parts.prefix}f_auto,q_auto,w_1200,h_630,c_pad,b_auto:predominant/${parts.rest}`,
    width: "1200",
    height: "630"
  };
}

async function handleSerigraphie(req, res, base) {
  const catalogUrl = `${base}/serigraphie.html`;
  const toCatalog = () => {
    res.setHeader("Cache-Control", "public, s-maxage=60");
    return res.status(302).setHeader("Location", catalogUrl).end();
  };

  const productId = String((req.query && req.query.id) || "").trim();
  if (!SERIGRAPHIE_ID_RE.test(productId)) return toCatalog();

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, anonKey);

    const { data: product, error } = await supabase
      .from("serigraphie_products")
      .select("id, name, price, min_qty, images, vendor_id")
      .eq("id", productId)
      .eq("status", "active")
      .maybeSingle();
    if (error || !product) return toCatalog();

    const { data: shop, error: shopError } = await supabase
      .from("serigraphie_vendors_public")
      .select("shop_name, city")
      .eq("id", product.vendor_id)
      .maybeSingle();
    if (shopError || !shop) return toCatalog();   // vendeur non approuvé : même réponse qu'un produit absent

    const minQty = Math.max(1, parseInt(product.min_qty, 10) || 1);
    const description = [
      money(product.price),
      minQty > 1 ? `Minimum ${minQty} pièces` : "Dès 1 pièce",
      shop.city ? `${shop.shop_name}, ${shop.city}` : shop.shop_name
    ].join(" · ");

    const image = serigraphieOgImage(product.images, base);

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).send(
      renderRedirectPage({
        title: product.name,
        description,
        image: image.url,
        imageWidth: image.width,
        imageHeight: image.height,
        canonicalUrl: `${base}/s/${productId}`,
        targetUrl: `${base}/serigraphie-produit.html?id=${encodeURIComponent(productId)}`,
        siteName: "MAJESTÉ PRESSE",
        withSource: true,
      })
    );
  } catch (err) {
    console.error(err);
    return toCatalog();
  }
}

// ---------------------------------------------------------
// Mode ?format=json : aperçu de lien pour le chat (carte sous un message).
// Uniquement les routes /p/<id> (produit numérique) et /s/<id> (sérigraphie) :
// le serveur ne reçoit qu'un type et un identifiant validé, jamais une adresse à
// télécharger (pas de SSRF). Image : miniature Cloudinary du projet, sinon vide.
// Le mode HTML (WhatsApp, Facebook) n'est pas concerné.
// ---------------------------------------------------------
const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const ALLOWED_ORIGIN_RE = /^https:\/\/(?:www\.)?(?:mahouto\.com|majestepresse\.com)$/;

function cardImage(url) {
  const parts = cloudinaryImageParts(url);
  return parts ? `${parts.prefix}f_auto,q_auto,w_480,c_limit/${parts.rest}` : "";
}

function cut(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

async function handleJson(req, res, base, type) {
  // CORS : seulement nos deux sites (jamais « * »)
  const origin = String(req.headers.origin || "");
  res.setHeader("Vary", "Origin");
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "method_not_allowed" });

  const notFound = () => {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.status(404).json({ error: "not_found" });
  };

  const id = String((req.query && req.query.id) || "").trim();

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    if (type === "serigraphie") {
      if (!SERIGRAPHIE_ID_RE.test(id)) return notFound();

      const { data: product, error } = await supabase
        .from("serigraphie_products")
        .select("id, name, price, min_qty, images, vendor_id")
        .eq("id", id)
        .eq("status", "active")
        .maybeSingle();
      if (error || !product) return notFound();

      const { data: shop, error: shopError } = await supabase
        .from("serigraphie_vendors_public")
        .select("shop_name, city")
        .eq("id", product.vendor_id)
        .maybeSingle();
      if (shopError || !shop) return notFound();

      const minQty = Math.max(1, parseInt(product.min_qty, 10) || 1);
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({
        title: cut(product.name, 120),
        description: cut([
          money(product.price),
          minQty > 1 ? `Minimum ${minQty} pièces` : "Dès 1 pièce",
          shop.city ? `${shop.shop_name}, ${shop.city}` : shop.shop_name
        ].join(" · "), 200),
        image: cardImage(Array.isArray(product.images) ? product.images[0] : null),
        url: `${base}/s/${id}`,
        siteName: "MAJESTÉ PRESSE"
      });
    }

    if (type === "produit") {
      if (!PRODUCT_ID_RE.test(id)) return notFound();

      const { data: product, error } = await supabase
        .from("digital_products_public")
        .select("nom, description, image_url, prix, promotion, disponible")
        .eq("id", id)
        .maybeSingle();
      if (error || !product || !product.disponible) return notFound();

      const brandName = brandForRequest(req).name;
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({
        title: cut(product.nom, 120),
        description: cut(`${money(product.promotion ?? product.prix)} — ${product.description || `Produit numérique ${brandName}`}`, 200),
        image: cardImage(product.image_url),
        url: `${base}/p/${id}`,
        siteName: brandName
      });
    }
  } catch (err) {
    console.error(err);
    return notFound();
  }

  return notFound();   // type non pris en charge en mode JSON
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  // URL de base : PUBLIC_SITE_URL en priorité (l'en-tête Host est contrôlable
  // par le client) ; repli sur l'en-tête Host seulement si la variable est absente.
  const configuredSite = (process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const base = configuredSite || `${proto}://${req.headers.host}`;

  const type = (req.query && req.query.type) || "produit";

  if (req.query && req.query.format === "json") {
    return handleJson(req, res, base, type);
  }

  if (type === "formation") {
    return handleFormation(req, res, base);
  }
  if (type === "serigraphie") {
    return handleSerigraphie(req, res, base);
  }
  return handleProduit(req, res, base);
}
