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

function renderRedirectPage({ title, description, image, imageWidth, imageHeight, canonicalUrl, targetUrl, siteName }) {
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

<meta http-equiv="refresh" content="0;url=${escapeHtml(targetUrl)}">
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>
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
      renderRedirectPage({ title, description, image, canonicalUrl: targetUrl, targetUrl, siteName: brandName })
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

function serigraphieOgImage(images, base) {
  const fallback = { url: `${base}/assets/og-majeste.png`, width: "1200", height: "630" };
  const first = Array.isArray(images) ? images[0] : null;
  if (typeof first !== "string") return fallback;

  const prefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/`;
  if (!first.startsWith(prefix) || first.length > 500 || /[\s"'<>]/.test(first)) return fallback;

  let rest = first.slice(prefix.length);
  if (!rest || rest.includes("..")) return fallback;

  const slash = rest.indexOf("/");
  if (slash > 0) {
    const firstSegment = rest.slice(0, slash);
    if (!/^v\d+$/.test(firstSegment)) {
      // Segment qui ressemble à une transformation (virgule, ou « xx_valeur ») ?
      if (firstSegment.includes(",") || /^[a-z]{1,4}_/.test(firstSegment)) {
        const known = firstSegment.split(",").every((t) => KNOWN_TRANSFORM_TOKEN.test(t));
        const afterSegment = rest.slice(slash + 1);
        const next = afterSegment.split("/")[0];
        if (!known || !/^v\d+$/.test(next) || !afterSegment.includes("/")) return fallback;
        rest = afterSegment;   // transformation existante retirée
      }
      // sinon : simple dossier (public_id sans version) -> conservé tel quel
    }
  }
  return {
    url: `${prefix}f_auto,q_auto,w_1200,h_630,c_pad,b_auto:predominant/${rest}`,
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
      })
    );
  } catch (err) {
    console.error(err);
    return toCatalog();
  }
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

  if (type === "formation") {
    return handleFormation(req, res, base);
  }
  if (type === "serigraphie") {
    return handleSerigraphie(req, res, base);
  }
  return handleProduit(req, res, base);
}
