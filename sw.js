// =========================================================
// MAHOUTO+ — Service Worker
// Stratégie : cache-first pour les fichiers de l'app (coquille),
// network-first pour tout le reste (données dynamiques).
// =========================================================

const CACHE_NAME = "mahoutoplus-shell-v32";

const APP_SHELL = [
  "./",
  "./index.html",
  "./discussions.html",
  "./messages-prives.html",
  "./dm-chat.html",
  "./chat.html",
  "./ai.html",
  "./school.html",
  "./academie-majestepresse.html",
  "./profil.html",
  "./manifest.json",
  "./config.js",
  "./theme.css",
  "./theme-toggle.js",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./assets/logo-mahouto-plus.png",
  "./assets/splash-screen.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png"
];

// Installation : met en cache la coquille de l'application
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activation : nettoie les anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Récupération des requêtes
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Réception d'un fichier partagé depuis une autre app (WhatsApp, etc.)
  // — voir manifest.json > share_target. Le fichier est stocké
  // temporairement via l'API Cache (seul moyen de faire transiter un
  // blob binaire d'un Service Worker vers une page), puis on redirige
  // vers share-target.html qui le récupère et laisse choisir où l'envoyer.
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get("sharedFile");
        const cache = await caches.open("mahoutoplus-share-cache");
        if (file) {
          await cache.put(
            "shared-file",
            new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } })
          );
        }
      } catch (err) {
        console.error("Réception du partage impossible :", err);
      }
      return Response.redirect("/share-target.html", 303);
    })());
    return;
  }

  // Jamais toucher aux requêtes non-GET (POST vers /api/... par ex.)
  if (event.request.method !== "GET") return;

  // Ne jamais mettre en cache les appels à Supabase, Cloudinary, OpenRouter
  // ou nos fonctions serverless /api — toujours frais depuis le réseau.
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("cloudinary.com") ||
    url.hostname.includes("openrouter.ai") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Coquille de l'app : cache-first
  if (APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")))) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Reste : network-first avec repli sur le cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
