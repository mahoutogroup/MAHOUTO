const CACHE_NAME = "mahoutoplus-shell-v37";

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
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/upload.html") {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        let files = formData.getAll("files");
        if(files.length === 0 && formData.get("file")) files = [formData.get("file")];
        if(files.length === 0 && formData.get("files")) files = [formData.get("files")];

        const filesData = [];
        for(const f of files) {
          filesData.push({
            name: f.name || "fichier", type: f.type, size: f.size,
            buffer: await f.arrayBuffer()
          });
        }
        const cache = await caches.open("mahoutoplus-share-cache");
        await cache.put("shared-files", new Response(JSON.stringify(filesData)));
      } catch (err) {
        const cache = await caches.open("mahoutoplus-share-cache");
        await cache.put("shared-files", new Response(JSON.stringify({error: err.message})));
      }
      return Response.redirect("./upload.html", 303);
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
