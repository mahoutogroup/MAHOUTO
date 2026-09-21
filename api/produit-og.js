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

function renderRedirectPage({ title, description, image, canonicalUrl, targetUrl }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>

<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:site_name" content="MAHOUTO+">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}

<meta http-equiv="refresh" content="0;url=${escapeHtml(targetUrl)}">
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>
</head>
<body style="background:#0A0A0A;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;">
  <p>Redirection vers la boutique MAHOUTO+…</p>
  <p><a href="${escapeHtml(targetUrl)}" style="color:#FFC107;">Cliquez ici si rien ne se passe</a></p>
</body>
</html>`;
}

async function handleProduit(req, res, base) {
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
      .from("digital_products")
      .select("nom, description, image_url, prix, promotion, disponible")
      .eq("id", productId)
      .maybeSingle();

    if (error || !product || !product.disponible) {
      return res.status(200).send(
        renderRedirectPage({
          title: "MAHOUTO+ — Boutique",
          description: "Découvrez nos produits numériques.",
          image: "",
          canonicalUrl: `${base}/produits.html`,
          targetUrl: `${base}/produits.html`,
        })
      );
    }

    const amount = product.promotion ?? product.prix;
    const title = product.nom;
    const description = `${money(amount)} — ${product.description || "Produit numérique MAHOUTO+"}`;
    const image = product.image_url ? optimizedImageUrl(product.image_url, 1200) : "";

    return res.status(200).send(
      renderRedirectPage({ title, description, image, canonicalUrl: targetUrl, targetUrl })
    );
  } catch (err) {
    console.error(err);
    return res.status(200).send(
      renderRedirectPage({
        title: "MAHOUTO+ — Boutique",
        description: "Découvrez nos produits numériques.",
        image: "",
        canonicalUrl: `${base}/produits.html`,
        targetUrl,
      })
    );
  }
}

async function handleFormation(req, res, base) {
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
          title: "MAHOUTO+ — Formations",
          description: "Découvrez nos formations professionnelles.",
          image: "",
          canonicalUrl: catalogUrl,
          targetUrl: catalogUrl,
        })
      );
    }

    const amount = formation.promotion ?? formation.prix;
    const title = formation.nom;
    const description = `${money(amount)} — ${formation.description || "Formation MAHOUTO+"}`;
    const image = formation.image_url ? optimizedImageUrl(formation.image_url, 1200) : "";

    return res.status(200).send(
      renderRedirectPage({ title, description, image, canonicalUrl: targetUrl, targetUrl })
    );
  } catch (err) {
    console.error(err);
    return res.status(200).send(
      renderRedirectPage({
        title: "MAHOUTO+ — Formations",
        description: "Découvrez nos formations professionnelles.",
        image: "",
        canonicalUrl: fallbackUrl,
        targetUrl,
      })
    );
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const base = `${proto}://${host}`;

  const type = (req.query && req.query.type) || "produit";

  if (type === "formation") {
    return handleFormation(req, res, base);
  }
  return handleProduit(req, res, base);
}
