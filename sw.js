// =========================================================
// MAHOUTO+ — Service Worker v33
// Stratégie : cache-first pour la coquille, network-first pour les données
// =========================================================

const CACHE_NAME = "mahoutoplus-shell-v33";

const APP_SHELL = [
  "./",
  "./index.html",
  "./upload.html",
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
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png"
];

// Installation
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Activation : nettoyage anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key!== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Interception des requêtes
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. RÉCEPTION DU PARTAGE DEPUIS WHATSAPP / GALERIE
  if (event.request.method === "POST" && url.pathname === "/upload.html") {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get("file");
        const cache = await caches.open("mahoutoplus-share-cache");
        if (file) {
          await cache.put("shared-file", new Response(file));
        }
      } catch (err) {
        console.error("Réception du partage impossible :", err);
      }
      return Response.redirect("/upload.html", 303);
    })());
    return;
  }

  // 2. Laisser passer les requêtes non-GET et les API
  if (event.request.method!== "GET") return;
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("cloudinary.com") ||
    url.hostname.includes("openrouter.ai") ||
    url.pathname.startsWith("/api/")
  ) {
    return fetch(event.request);
  }

  // 3. Cache-first pour la coquille de l'app
  if (APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")))) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }

  // 4. Network-first pour le reste avec fallback cache
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
