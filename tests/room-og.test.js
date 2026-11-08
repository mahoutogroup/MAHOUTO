/* Aperçu d'un lien de salon (/r/<salon>) : balises Open Graph et Twitter, échappement, photo, 404, robots et humains.
   Exécution : node tests/room-og.test.js — aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

const meta = (html, key) => {
  const m = html.match(new RegExp('<meta (?:property|name)="' + key.replace(/[:]/g, ":") + '" content="([^"]*)"'));
  return m ? m[1] : null;
};
const fakeRes = () => {
  const r = { headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; } };
  return r;
};
const CLOUD = "hefa5gqf";
const PHOTO = `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/mahoutoplus/rooms/photo.jpg`;

(async () => {
  const Og = await import(pathToFileURL(path.join(root, "api", "_room-og.js")).href);

  await test("identifiant : [A-Za-z0-9_-]{1,64} seulement", () => {
    ["general", "salon-170", "a_b-C9", "x".repeat(64)].forEach((id) => assert.strictEqual(Og.isValidRoomId(id), true, id));
    ["", "a b", "a&b", "../x", "x".repeat(65), "é", "a#b", "<b>", "a/b", null, undefined, 5, ["a"]].forEach((id) => assert.strictEqual(Og.isValidRoomId(id), false, String(id)));
  });

  await test("salon gratuit avec photo : nom, photo (1200x630), description, balises Open Graph et Twitter complètes", () => {
    const p = Og.buildRoomPreview({ name: "Les Sérigraphes", is_paid: false, price: null, photo_url: PHOTO, emoji: "💬" }, "serigraphes");
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.title, "Les Sérigraphes");
    assert.strictEqual(p.description, "Rejoins ce salon sur MAHOUTO+");
    assert.strictEqual(p.targetUrl, "https://mahouto.com/chat.html?room=serigraphes");
    assert.strictEqual(p.canonicalUrl, "https://mahouto.com/r/serigraphes");
    const html = Og.renderRoomPreviewPage(p);
    assert.strictEqual(meta(html, "og:title"), "Les Sérigraphes");
    assert.strictEqual(meta(html, "og:description"), "Rejoins ce salon sur MAHOUTO+");
    assert.strictEqual(meta(html, "og:image"), `https://res.cloudinary.com/${CLOUD}/image/upload/f_jpg,q_auto,w_1200,h_630,c_pad,b_auto:predominant/v1700000000/mahoutoplus/rooms/photo.jpg`);
    assert.strictEqual(meta(html, "og:image:width"), "1200");
    assert.strictEqual(meta(html, "og:image:height"), "630");
    assert.strictEqual(meta(html, "og:url"), "https://mahouto.com/r/serigraphes");
    assert.strictEqual(meta(html, "og:type"), "website");
    assert.strictEqual(meta(html, "og:site_name"), "MAHOUTO+");
    assert.strictEqual(meta(html, "twitter:card"), "summary_large_image");
    assert.strictEqual(meta(html, "twitter:title"), "Les Sérigraphes");
    assert.strictEqual(meta(html, "twitter:image"), meta(html, "og:image"));
    assert.match(html, /<title>Les Sérigraphes<\/title>/);
  });

  await test("salon sans photo : logo M+ (512x512, carte « summary »), émoji devant le nom", () => {
    const p = Og.buildRoomPreview({ name: "Général", is_paid: false, photo_url: null, emoji: "📣" }, "general");
    assert.strictEqual(p.title, "📣 Général");
    const html = Og.renderRoomPreviewPage(p);
    assert.strictEqual(meta(html, "og:image"), "https://mahouto.com/assets/icon-512.png");
    assert.strictEqual(meta(html, "og:image:width"), "512");
    assert.strictEqual(meta(html, "twitter:card"), "summary");
    assert.ok(fs.existsSync(path.join(root, "assets", "icon-512.png")), "le logo existe dans le dépôt");
  });

  await test("salon payant : « Salon payant : X FCFA » dans la description, avec nom et photo ; aucune autre donnée", () => {
    const price = Number(2000).toLocaleString("fr-FR") + " FCFA";
    const p = Og.buildRoomPreview({ name: "Salon VIP", is_paid: true, price: 2000, photo_url: PHOTO, emoji: "⭐" }, "vip");
    assert.strictEqual(p.description, "Salon payant : " + price + " — Rejoins ce salon sur MAHOUTO+");
    assert.strictEqual(p.title, "Salon VIP");
    const html = Og.renderRoomPreviewPage(p);
    assert.ok(!/user_id|created_by|username|messages?\b|conversation|profile/i.test(html), "rien de privé dans la page");
    assert.strictEqual(Og.buildRoomPreview({ name: "X", is_paid: true, price: null }, "x").description, "Salon payant — Rejoins ce salon sur MAHOUTO+");
    assert.strictEqual(Og.buildRoomPreview({ name: "X", is_paid: false, price: 500 }, "x").description, "Rejoins ce salon sur MAHOUTO+", "le prix d'un salon gratuit n'est jamais affiché");
  });

  await test("nom de salon hostile : échappé pour HTML dans toutes les balises, aucune injection possible", () => {
    const evil = `</title><script>alert(1)</script><img src=x onerror="alert(2)"> "'&`;
    const html = Og.renderRoomPreviewPage(Og.buildRoomPreview({ name: evil, is_paid: true, price: 2000, photo_url: PHOTO, emoji: "💬" }, "x"));
    assert.ok(!/<script>alert|<img src=x|<\/title><script/.test(html), "aucune balise injectée");
    assert.ok(!/onerror="alert/.test(html));
    assert.strictEqual((html.match(/<script>/g) || []).length, 1, "un seul script : la redirection");
    assert.match(meta(html, "og:title"), /^&lt;\/title&gt;&lt;script&gt;alert\(1\)/);
    assert.ok(!/"'/.test(meta(html, "og:title")), "guillemets échappés");
    assert.match(meta(html, "og:title"), /&quot;&#39;&amp;/);
    const tags = html.match(/<meta [^>]*>/g) || [];
    tags.forEach((t) => assert.ok((t.match(/"/g) || []).length % 2 === 0, "attributs bien fermés : " + t.slice(0, 80)));
  });

  await test("émoji hostile ou trop long : remplacé par 💬 ; prix non numérique : ignoré", () => {
    const p = Og.buildRoomPreview({ name: "N", is_paid: true, price: "<b>", emoji: "<img onerror=x>" }, "n");
    assert.strictEqual(p.title, "💬 N");
    assert.strictEqual(p.description, "Salon payant — Rejoins ce salon sur MAHOUTO+");
    assert.strictEqual(Og.buildRoomPreview({ name: "N", emoji: "x".repeat(40) }, "n").title, "💬 N");
    assert.ok(Og.buildRoomPreview({ name: "n".repeat(500) }, "n").title.length < 90, "nom tronqué");
  });

  await test("photo invalide ou format non lu par WhatsApp → logo M+", () => {
    const logo = "https://mahouto.com/assets/icon-512.png";
    [
      "http://res.cloudinary.com/" + CLOUD + "/image/upload/v1/a.jpg",                    // pas https
      "https://evil.test/a.jpg",                                                          // mauvais domaine
      `https://res.cloudinary.com/autre-compte/image/upload/v1/a.jpg`,                   // autre compte Cloudinary
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.svg`,                       // SVG
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.pdf`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.heic`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.psd`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.jpg?x=1`,                   // paramètres
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a b.jpg`,                     // espace
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a".jpg`,                      // guillemet
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/<b>.jpg`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/../x.jpg`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/${"a/".repeat(300)}x.jpg`,        // trop longue
      "javascript:alert(1)", "data:image/png;base64,AAAA", "", null, undefined, 12
    ].forEach((u) => assert.strictEqual(Og.roomOgImage(u).url, logo, String(u).slice(0, 70)));
    ["jpg", "jpeg", "png", "webp", "gif", "JPG"].forEach((ext) =>
      assert.ok(Og.roomOgImage(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.${ext}`).url.includes("f_jpg,q_auto,w_1200,h_630,c_pad"), ext));
    assert.ok(Og.roomOgImage(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/sans-extension`).url.includes("f_jpg"), "sans extension : accepté");
  });

  await test("la photo vient de la validation MahoutoRoomSafe.photoUrl (même fonction que l'application)", () => {
    const code = strip(read("api/_room-og.js"));
    assert.match(code, /import "\.\.\/room-safe\.js";/);
    assert.match(code, /globalThis\.MahoutoRoomSafe\.photoUrl\(photoUrl\)/);
    assert.match(code, /cloudinaryImageParts\(safe\)/, "domaine de stockage attendu");
  });

  await test("réponse : salon trouvé → 200, cache de courte durée ; identifiant invalide → 404 générique SANS requête", async () => {
    const res = fakeRes(); const seen = [];
    await Og.handleRoomPreview({ query: { id: "vip" } }, res, { fetchRoom: async (id) => { seen.push(id); return { row: { name: "Salon VIP", is_paid: true, price: 2000, photo_url: PHOTO, emoji: "⭐" }, error: null }; } });
    assert.deepStrictEqual(seen, ["vip"]);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["content-type"], "text/html; charset=utf-8");
    assert.match(res.headers["cache-control"], /^public, max-age=60, s-maxage=120/);
    assert.ok(parseInt(res.headers["cache-control"].match(/s-maxage=(\d+)/)[1], 10) <= 300, "durée courte");
    for (const bad of ["a b", "../x", "<script>", "x".repeat(65), "", undefined, ["a", "b"]]) {
      const r = fakeRes(); let called = 0;
      await Og.handleRoomPreview({ query: { id: bad } }, r, { fetchRoom: async () => { called++; return { row: null, error: null }; } });
      assert.strictEqual(called, 0, "aucune requête pour : " + String(bad));
      assert.strictEqual(r.statusCode, 404);
      assert.strictEqual(meta(r.body, "og:title"), "Salon introuvable — MAHOUTO+");
    }
  });

  await test("salon inexistant : 404, aperçu générique « Salon introuvable — MAHOUTO+ », humain renvoyé vers discussions.html", async () => {
    const res = fakeRes();
    await Og.handleRoomPreview({ query: { id: "inexistant" } }, res, { fetchRoom: async () => ({ row: null, error: null }) });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(meta(res.body, "og:title"), "Salon introuvable — MAHOUTO+");
    assert.strictEqual(meta(res.body, "og:image"), "https://mahouto.com/assets/icon-512.png");
    assert.match(res.body, /http-equiv="refresh" content="1;url=https:\/\/mahouto\.com\/discussions\.html"/);
    assert.match(res.body, /window\.location\.replace\("https:\/\/mahouto\.com\/discussions\.html"\)/);
    assert.ok(!/inexistant/.test(res.body), "l'identifiant demandé n'est pas renvoyé dans la page");
    assert.match(res.headers["cache-control"], /max-age=60/);
  });

  await test("erreur de lecture : 503 sans cache, mais l'humain est quand même renvoyé vers le salon", async () => {
    for (const fetchRoom of [async () => ({ row: null, error: { message: "boom" } }), async () => { throw new Error("réseau"); }]) {
      const res = fakeRes();
      await Og.handleRoomPreview({ query: { id: "general" } }, res, { fetchRoom });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.headers["cache-control"], "no-store");
      assert.match(res.body, /window\.location\.replace\("https:\/\/mahouto\.com\/chat\.html\?room=general"\)/);
      assert.ok(!/boom|réseau/.test(res.body), "aucun détail technique");
    }
  });

  await test("robot ou humain : la même page ; les robots lisent les balises, les humains sont redirigés vers chat.html?room=<salon>", async () => {
    const row = { name: "Général", is_paid: false, photo_url: null, emoji: "💬" };
    const pages = [];
    for (const ua of ["WhatsApp/2.23.20.0 A", "TelegramBot (like TwitterBot)", "facebookexternalhit/1.1", "Twitterbot/1.0", "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36"]) {
      const res = fakeRes();
      await Og.handleRoomPreview({ query: { id: "general" }, headers: { "user-agent": ua } }, res, { fetchRoom: async () => ({ row, error: null }) });
      pages.push(res.body);
    }
    assert.ok(pages.every((p) => p === pages[0]), "contenu identique pour tous (pas de détection par agent : un robot inconnu garde l'aperçu)");
    const html = pages[0];
    ["og:title", "og:description", "og:image", "og:url", "og:type", "og:site_name", "twitter:card"].forEach((k) => assert.ok(meta(html, k), k));
    assert.match(html, /<meta http-equiv="refresh" content="1;url=https:\/\/mahouto\.com\/chat\.html\?room=general">/, "redirection sans JavaScript, avec 1 s pour laisser lire les balises");
    assert.match(html, /<script>window\.location\.replace\("https:\/\/mahouto\.com\/chat\.html\?room=general"\);<\/script>/, "redirection immédiate pour un navigateur");
    assert.ok(html.indexOf('property="og:title"') < html.indexOf("window.location.replace"), "balises avant la redirection");
  });

  await test("le site et la marque sont fixes : même domaine d'appel, même résultat (mahouto.com, MAHOUTO+)", async () => {
    const outs = [];
    for (const host of ["mahouto.com", "majestepresse.com", "localhost:3000", "evil.test"]) {
      const res = fakeRes();
      await Og.handleRoomPreview({ query: { id: "general" }, headers: { host, "x-forwarded-host": host } }, res, { fetchRoom: async () => ({ row: { name: "G", is_paid: false }, error: null }) });
      outs.push(res.body);
    }
    assert.ok(outs.every((o) => o === outs[0]));
    assert.ok(!/majeste|evil\.test|localhost/i.test(outs[0]));
  });

  // ---------- branchement ----------
  const og = strip(read("api/produit-og.js"));
  await test("api/produit-og.js : branche « salon », clé publique (anon) jamais service_role, champs name/is_paid/price/photo_url/emoji seulement", () => {
    assert.match(og, /import \{ handleRoomPreview, ROOM_FIELDS \} from "\.\/_room-og\.js";/);
    assert.match(og, /req\.query\.type === "salon" && req\.query\.format !== "json"/);
    const fn = og.slice(og.indexOf("async function fetchRoomForPreview"), og.indexOf("export default async function handler"));
    assert.match(fn, /createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_ANON_KEY\)/);
    assert.ok(!/SERVICE_ROLE|service_role/i.test(fn));
    assert.match(fn, /\.from\("rooms"\)\.select\(ROOM_FIELDS\)\.eq\("id", id\)\.maybeSingle\(\)/);
    assert.strictEqual(Og.ROOM_FIELDS, "name, is_paid, price, photo_url, emoji");
    assert.ok(!/created_by|user_id/.test(Og.ROOM_FIELDS));
  });

  await test("pas de nouvelle fonction Vercel : 12 fichiers de routes dans api/ (les modules « _ » ne comptent pas)", () => {
    const fns = [];
    (function scan(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return scan(p);
        if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(path.relative(path.join(root, "api"), p));
      });
    })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12, fns.join(", "));
    assert.ok(fs.existsSync(path.join(root, "api", "_room-og.js")) && fs.existsSync(path.join(root, "api", "_cloudinary-og.js")));
  });

  await test("vercel.json : réécriture /r/:id → /api/produit-og?type=salon&id=:id ; /p, /f, /s inchangées", () => {
    const cfg = JSON.parse(read("vercel.json"));
    const rw = Object.fromEntries(cfg.rewrites.map((r) => [r.source, r.destination]));
    assert.strictEqual(rw["/r/:id"], "/api/produit-og?type=salon&id=:id");
    assert.strictEqual(rw["/p/:id"], "/api/produit-og?type=produit&id=:id");
    assert.strictEqual(rw["/f/:id"], "/api/produit-og?type=formation&id=:id");
    assert.strictEqual(rw["/s/:id"], "/api/produit-og?type=serigraphie&id=:id");
  });

  await test("les anciens liens chat.html?room=<id> continuent de marcher (page et paramètre inchangés)", () => {
    const chat = strip(read("chat.html"));
    assert.match(chat, /params\.get\("room"\) \|\| "general"/);
    assert.ok(fs.existsSync(path.join(root, "chat.html")));
  });

  await test("le code d'aperçu : aucun innerHTML, aucun journal console, aucune adresse e-mail", () => {
    const code = strip(read("api/_room-og.js"));
    assert.ok(!/innerHTML|document\.write|console\.|email|e-mail/i.test(code));
  });

  await test("cache hors ligne : version ≥ v94 (room-share.js a changé)", () => {
    assert.ok(Number((read("sw.js").match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 94);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
