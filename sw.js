const CACHE_NAME = "mahoutoplus-shell-v35";

const APP_SHELL = [
  "./","./index.html","./upload.html","./discussions.html","./messages-prives.html",
  "./dm-chat.html","./chat.html","./ai.html","./school.html","./academie-majestepresse.html",
  "./profil.html","./manifest.json","./config.js","./theme.css","./theme-toggle.js",
  "./assets/icon-192.png","./assets/icon-512.png","./assets/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k!== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // RÉCEPTION PARTAGE : 1 FICHIER OU MULTI
  if (event.request.method === "POST" && url.pathname === "/upload.html") {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        let files = [];

        if(formData.getAll("files").length > 0) {
          files = formData.getAll("files"); // Cas multi
        } else if(formData.get("file")) {
          files = [formData.get("file")]; // Cas 1 fichier WhatsApp
        } else if(formData.get("files")) {
          files = [formData.get("files")]; // Cas 1 fichier Galerie
        }

        if(files.length === 0) throw new Error("Aucun fichier reçu du système");

        const filesData = [];
        for(const f of files) {
          filesData.push({
            name: f.name || "fichier",
            type: f.type || "application/octet-stream",
            size: f.size,
            buffer: await f.arrayBuffer()
          });
        }

        const cache = await caches.open("mahoutoplus-share-cache");
        await cache.put("shared-files", new Response(JSON.stringify(filesData)));

      } catch (err) {
        console.error("Réception partage:", err);
        const cache = await caches.open("mahoutoplus-share-cache");
        await cache.put("shared-files", new Response(JSON.stringify({error: err.message})));
      }
      return Response.redirect("/upload.html", 303);
    })());
    return;
  }

  // Le reste du fetch normal
  if (event.request.method!== "GET") return;
  if (url.hostname.includes("supabase.co") || url.hostname.includes("cloudinary.com") || url.pathname.startsWith("/api/")) return fetch(event.request);

  if (APP_SHELL.some(p => url.pathname.endsWith(p.replace("./","")))) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    return;
  }

  event.respondWith(fetch(event.request).then(r => {
    caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
    return r;
  }).catch(() => caches.match(event.request)));
});
