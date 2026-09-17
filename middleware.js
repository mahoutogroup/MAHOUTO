/*
 * middleware.js — MAHOUTO+
 * -------------------------------------------------------
 * Edge Middleware, exécuté par Vercel avant toute mise en cache.
 *
 * CONTEXTE : les pages /admin/*.html sont des fichiers statiques.
 * Sur Vercel, les fichiers statiques sont traités comme des artefacts
 * immuables mis en cache globalement par le réseau Edge — les headers
 * définis dans vercel.json (Cache-Control: no-store) ne s'appliquent
 * qu'aux clients en aval (navigateurs), jamais au cache Edge lui-même
 * pour ce type de fichier (confirmé par le support Vercel).
 *
 * CORRECTIF : les fichiers admin réels vivent maintenant sous
 * /_internal/admin/ (jamais interceptés par ce middleware — cible de
 * l'appel fetch() interne ci-dessous, pas de son propre matcher). Ce
 * middleware intercepte uniquement les URLs publiques /admin/*.html,
 * va chercher le contenu réel via un fetch interne, puis renvoie une
 * réponse fraîche générée par du compute (pas par le pipeline de
 * fichiers statiques) : le cache Edge respecte alors bien no-store,
 * comme l'explique Vercel pour les réponses émises dynamiquement.
 *
 * Les liens internes (../config.js, produits.html, ../api/admin/...)
 * dans ces pages restent corrects car ils sont résolus par le
 * navigateur par rapport à l'URL publique /admin/... affichée dans la
 * barre d'adresse, jamais par rapport à l'emplacement réel du fichier
 * sur le serveur.
 * -------------------------------------------------------
 */

export const config = {
  matcher: ["/admin/:path*"],
};

const ADMIN_FILES = new Set(["formations.html", "produits.html", "users.html"]);

export default async function middleware(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return; // laisse passer normalement (aucune autre méthode utilisée sous /admin/)
  }

  const url = new URL(request.url);
  const filename = url.pathname.replace(/^\/admin\//, "");

  if (!ADMIN_FILES.has(filename)) {
    return; // chemin non prévu sous /admin/ : comportement par défaut inchangé
  }

  const originUrl = new URL(`/_internal/admin/${filename}`, url.origin);
  const originResponse = await fetch(originUrl);

  if (!originResponse.ok) {
    return originResponse;
  }

  const headers = new Headers(originResponse.headers);
  headers.set("Cache-Control", "no-store, must-revalidate");

  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}
