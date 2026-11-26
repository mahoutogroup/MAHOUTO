/* Salons en abonnement : écran verrouillé sans prix à vie (forfaits actifs à la place), texte de partage identique depuis
   discussions.html, photo du salon dans l'aperçu du lien (Cloudinary seulement) et photo de salon publique à l'envoi (api/attachment.js).
   Exécution réelle des fonctions dans des faux DOM / faux clients. Aucun réseau, aucune base. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const Abo = require("../salon-abonnement");
const Share = require("../room-share");
const Safe = require("../room-safe");
const A = require("../salon-accroche");
const Og = require("../api/_room-og.js");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const CHAT = read("chat.html"), DISC = read("discussions.html");
const FCFA = (n) => Number(n).toLocaleString("fr-FR") + " FCFA";
const P = (code, libelle, jours, montant, ordre) => ({ code, libelle, jours, montant, ordre, actif: true });
const JOUR = P("jour", "Jour", 1, 500, 1), SEM = P("semaine", "Semaine", 7, 2000, 2), MOIS = P("mois", "Mois", 30, 5000, 3);
const L = "\\p{L}";
const TUT = new RegExp(`(?<![${L}])(ton|ta|tes|toi|tu|t'[${L}]+|[${L}]+-toi|connecte|rejoins|choisis|réessaie)(?![${L}])`, "iu");

// ====================== salon-abonnement.js : offre à montrer ======================
test("offre : UN forfait actif → « Jour : 500 FCFA pour 1 jour »", () => {
  assert.deepStrictEqual(Abo.offerSummary([JOUR]), { kind: "unique", title: "Jour : " + FCFA(500) + " pour 1 jour", lines: [] });
  assert.strictEqual(Abo.offerSummary([P("sem", "Semaine", 7, 2000, 1)]).title, "Semaine : " + FCFA(2000) + " pour 7 jours");
  assert.strictEqual(Abo.durationLabel(1), "1 jour"); assert.strictEqual(Abo.durationLabel(30), "30 jours");
});

test("offre : PLUSIEURS forfaits → « à partir de » le plus petit PRIX + courte liste dans l'ordre d'affichage (5 au plus)", () => {
  const s = Abo.offerSummary([MOIS, JOUR, SEM]);
  assert.strictEqual(s.kind, "multiple"); assert.strictEqual(s.title, "Abonnement à partir de " + FCFA(500));
  assert.deepStrictEqual(s.lines, ["Jour : " + FCFA(500) + " pour 1 jour", "Semaine : " + FCFA(2000) + " pour 7 jours", "Mois : " + FCFA(5000) + " pour 30 jours"], "classés par ordre d'affichage, pas par prix");
  assert.strictEqual(Abo.offerSummary([P("aa", "Cher", 1, 900, 1), P("bb", "Pas cher", 7, 300, 2)]).title, "Abonnement à partir de " + FCFA(300), "le plus petit prix, pas le premier forfait");
  const six = Abo.offerSummary(Array.from({ length: 7 }, (_, i) => P("f" + i, "F" + i, i + 1, 100 * (i + 1), i)));
  assert.strictEqual(six.lines.length, 6); assert.strictEqual(six.lines[5], "et d'autres forfaits"); assert.strictEqual(six.lines[0], "F0 : " + FCFA(100) + " pour 1 jour");
  assert.strictEqual(Abo.minPrice([MOIS, JOUR, SEM]), 500); assert.strictEqual(Abo.minPrice([]), null); assert.strictEqual(Abo.minPrice(null), null);
});

test("offre : forfaits illisibles, absents ou invalides → « Abonnement : tarifs indisponibles pour le moment », AUCUN prix chiffré", () => {
  [null, undefined, [], "x", {}, [{}], [P("jour", "Jour", 1, 0, 1)], [P("jour", "Jour", 1, -5, 1)], [P("jour", "Jour", 0, 500, 1)], [P("jour", "Jour", 1, 1.5, 1)], [P("Jour!", "Jour", 1, 500, 1)], [P("jour", "", 1, 500, 1)]]
    .forEach((rows) => { const s = Abo.offerSummary(rows); assert.deepStrictEqual(s, { kind: "indisponible", title: "Abonnement : tarifs indisponibles pour le moment", lines: [] }, JSON.stringify(rows)); assert.ok(!/\d/.test(s.title), "aucun chiffre"); });
  assert.strictEqual(Abo.UNAVAILABLE, "Abonnement : tarifs indisponibles pour le moment");
});

// ====================== chat.html : écran verrouillé ======================
const el = (id) => { const s = new Set(["hidden"]); const e = { id, _t: "", children: [], className: "", onclick: null, dataset: {}, set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
  set innerHTML(v) { throw new Error("innerHTML interdit"); }, classList: { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } },
  appendChild(c) { this.children.push(c); return c; }, addEventListener() {}, setAttribute() {} }; return e; };
function locked(o) {
  const ids = {}; const get = (i) => ids[i] || (ids[i] = el(i));
  const doc = { getElementById: get, createElement: () => el(null) };
  const status = [];
  const rep = o.plans === "erreur" ? { data: null, error: { message: "x" } } : { data: o.plans || [], error: null };
  const calls = [];
  const chain = (t) => { const q = { select() { return q; }, order() { return q; }, eq() { return q; }, gt() { return q; }, limit() { return q; }, maybeSingle: async () => ({ data: t === "profiles" ? (o.profile || null) : null, error: null }), then(res, rej) { calls.push(t); return Promise.resolve(t === "salon_forfaits" ? rep : { data: [], error: null }).then(res, rej); } }; return q; };
  const supabase = { from: chain };
  const start = CHAT.indexOf("async function hasPaidPurchase()"), end = CHAT.indexOf("// Retour de paiement : réessaie quelques fois");
  const src = CHAT.slice(start, end);
  const ctx = { document: doc, supabase, currentUser: o.user === undefined ? null : o.user, ROOM_ID: "s-1", roomPhotoUrl: null, paymentReturn: false, MahoutoRoomSafe: Safe, MahoutoSalonAbonnement: Abo,
    MahoutoPaymentReturn: { MSG_LOST_SESSION: "Reconnectez-vous" }, setLockedStatus: (t, e) => status.push([t, !!e]), renderLockedIntro() {}, buyRoomAccess() {}, money: (x) => Number(x).toLocaleString("fr-FR") + " FCFA", setTimeout, window: { location: { reload() {} } }, Number, Array, Promise, String };
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.checkRoomAccess = checkRoomAccess;", ctx);
  return { ids, get, status, calls, run: (room) => ctx.checkRoomAccess(room), ctx };
}
const ROOM = { name: "Bassam YACOUBOU", is_paid: true, price: 500, abonnement: true, created_by: "owner" };
const tick = () => new Promise((r) => setTimeout(r, 10));

test("visiteur SANS compte, salon en abonnement : le prix à vie n'est JAMAIS affiché ; le forfait actif unique l'est", async () => {
  const t = locked({ plans: [JOUR] }); await t.run(ROOM); await tick();
  assert.strictEqual(t.get("locked-price").textContent, "", "aucun prix à vie");
  assert.strictEqual(t.get("locked-offer").textContent, "Jour : " + FCFA(500) + " pour 1 jour"); assert.ok(!t.get("locked-offer").classList.contains("hidden"));
  assert.ok(!t.get("locked-screen").classList.contains("hidden") && !t.get("locked-login-link").classList.contains("hidden"), "écran verrouillé et invitation à se connecter");
  assert.deepStrictEqual(t.calls, ["salon_forfaits"], "une seule lecture, celle des forfaits actifs (lecture publique)");
});

test("visiteur SANS compte, plusieurs forfaits : « à partir de » + courte liste ; prix à vie (2 000) jamais montré même s'il est plus petit/plus grand", async () => {
  const t = locked({ plans: [JOUR, SEM, MOIS] }); await t.run(Object.assign({}, ROOM, { price: 12345 })); await tick();
  const txt = t.get("locked-offer").textContent;
  assert.ok(txt.startsWith("Abonnement à partir de " + FCFA(500)), txt);
  ["Jour : " + FCFA(500) + " pour 1 jour", "Semaine : " + FCFA(2000) + " pour 7 jours", "Mois : " + FCFA(5000) + " pour 30 jours"].forEach((l) => assert.ok(txt.includes(l), l));
  assert.ok(!txt.includes("12") && !txt.includes("12345") && t.get("locked-price").textContent === "", "le prix à vie n'apparaît nulle part");
  assert.deepStrictEqual(t.get("locked-offer").children.map((c) => c.className), ["offer-title", "offer-line", "offer-line", "offer-line"]);
  assert.ok(!TUT.test(txt));
});

test("forfaits illisibles ou aucun actif : « Abonnement : tarifs indisponibles pour le moment », aucun prix chiffré (visiteur, compte anonyme, membre)", async () => {
  for (const plans of ["erreur", []]) {
    for (const user of [null, { id: "u1", is_anonymous: true }, { id: "u2" }]) {
      const t = locked({ plans, user }); await t.run(ROOM); await tick();
      assert.strictEqual(t.get("locked-offer").textContent, "Abonnement : tarifs indisponibles pour le moment", JSON.stringify([plans, user]));
      assert.ok(!/\d/.test(t.get("locked-offer").textContent) && t.get("locked-price").textContent === "", "aucun prix chiffré, aucun prix à vie");
      assert.strictEqual(t.get("locked-offer").children[0].className, "offer-none");
    }
  }
});

test("compte anonyme, salon en abonnement : mêmes forfaits à la place du prix à vie, invitation à se connecter", async () => {
  const t = locked({ plans: [JOUR, SEM], user: { id: "a1", is_anonymous: true } }); await t.run(ROOM); await tick();
  assert.strictEqual(t.get("locked-price").textContent, ""); assert.ok(t.get("locked-offer").textContent.startsWith("Abonnement à partir de " + FCFA(500)));
  assert.strictEqual(t.get("locked-login-note").textContent, "Connectez-vous avec Google ou votre e-mail pour acheter.");
});

test("membre connecté, salon en abonnement : le choix d'un forfait ne change pas (boutons « libellé — prix », achat par forfait) ; jamais de prix à vie", async () => {
  const t = locked({ plans: [JOUR, SEM], user: { id: "m1" } }); await t.run(ROOM); await tick();
  const plans = t.get("locked-plans");
  assert.deepStrictEqual(plans.children.map((b) => b.textContent), ["Jour — " + FCFA(500), "Semaine — " + FCFA(2000)], "boutons existants : libellé et prix");
  assert.ok(!plans.classList.contains("hidden") && t.get("locked-buy-btn").classList.contains("hidden"));
  assert.strictEqual(t.get("locked-price").textContent, ""); assert.ok(t.get("locked-offer").classList.contains("hidden"), "pas de doublon avec les boutons");
  const src = CHAT.slice(CHAT.indexOf("async function showSubscriptionPlans"), CHAT.indexOf("async function checkRoomAccess"));
  assert.ok(src.includes("btn.addEventListener(\"click\", () => buyRoomAccess(room, plan.code, btn));"), "même achat : buyRoomAccess(room, code du forfait)");
});

test("salon payant à PRIX À VIE et salon gratuit : inchangés", async () => {
  const vie = locked({ plans: [JOUR] }); await vie.run(Object.assign({}, ROOM, { abonnement: false })); await tick();
  assert.strictEqual(vie.get("locked-price").textContent, FCFA(500)); assert.ok(vie.get("locked-offer").classList.contains("hidden")); assert.deepStrictEqual(vie.calls, [], "aucune lecture de forfaits");
  const vie2 = locked({ user: null }); await vie2.run(Object.assign({}, ROOM, { abonnement: undefined })); assert.strictEqual(vie2.get("locked-price").textContent, FCFA(500));
  const libre = locked({ plans: [] }); assert.strictEqual(await libre.run({ name: "G", is_paid: false }), true); assert.ok(libre.get("locked-screen").classList.contains("hidden"));
});

test("l'écran verrouillé : texte brut (jamais d'innerHTML), vouvoyé, avec le style prévu ; l'offre se place sous le nom, à la place du prix", () => {
  const s = CHAT.slice(CHAT.indexOf("function renderSubscriptionOffer"), CHAT.indexOf("async function showSubscriptionOffer"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(s) && s.includes(".textContent = text"));
  const i = (x) => CHAT.indexOf(x); assert.ok(i('id="locked-room-name"') < i('id="locked-intro"') && i('id="locked-intro"') < i('id="locked-price"') && i('id="locked-price"') < i('id="locked-offer"') && i('id="locked-offer"') < i('id="locked-plans"'));
  assert.match(CHAT, /body\.light-theme #locked-offer \.offer-title \{ color: var\(--gold-text, #856500\); \}/);
  assert.ok(CHAT.includes('document.getElementById("locked-price").textContent = room.abonnement === true ? "" : money(room.price);'));
});

// ====================== discussions.html : texte de partage identique ======================
function discussionsPrefetch(rep) {
  const log = [];
  const q = { select(c) { log.push(["select", c]); return q; }, eq(k, v) { log.push(["eq", k, v]); return q; }, order(k) { log.push(["order", k]); return q; }, then(res, rej) { log.push(["await"]); return Promise.resolve(rep).then(res, rej); } };
  const src = DISC.slice(DISC.indexOf("let forfaitMin = null, forfaitsRequested = false;"), DISC.indexOf("// ---------- fin du forfait de partage ----------"));
  const f = new Function("supabase", "MahoutoSalonAbonnement", src + "\nreturn { run: (r) => prefetchForfaitMin(r), get min() { return forfaitMin; } };");
  return { o: f({ from: (t) => { log.push(["from", t]); return q; } }, Abo), log };
}
test("discussions.html : lit le plus petit forfait actif (lecture publique, seulement s'il y a une communauté en abonnement), repli sans prix", async () => {
  let d = discussionsPrefetch({ data: [JOUR, SEM], error: null }); await d.o.run([{ is_paid: false }, { is_paid: true, abonnement: false }]); assert.deepStrictEqual(d.log, [], "aucune lecture sans communauté en abonnement"); assert.strictEqual(d.o.min, null);
  d = discussionsPrefetch({ data: [SEM, JOUR], error: null }); await d.o.run([{ is_paid: true, abonnement: true }]); assert.strictEqual(JSON.stringify(d.log), JSON.stringify([["from", "salon_forfaits"], ["select", "code, libelle, jours, montant, ordre, actif"], ["eq", "actif", true], ["order", "ordre"], ["await"]])); assert.strictEqual(d.o.min, 500);
  await d.o.run([{ is_paid: true, abonnement: true }]); assert.strictEqual(d.log.filter((x) => x[0] === "from").length, 1, "lu une seule fois");
  for (const rep of [{ data: null, error: { message: "x" } }, { data: [], error: null }, Promise.reject(new Error("réseau"))]) { const x = discussionsPrefetch(rep); await assert.doesNotReject(x.o.run([{ is_paid: true, abonnement: true }])); assert.strictEqual(x.o.min, null); }
  assert.ok(/<script src="salon-accroche\.js"><\/script>/.test(DISC) && DISC.indexOf("salon-accroche.js") < DISC.indexOf('<script src="config.js">'), "salon-accroche.js chargé par la page");
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(DISC.slice(DISC.indexOf("let forfaitMin = null, forfaitsRequested"), DISC.indexOf("// ---------- fin du forfait de partage"))), "lecture seule");
});

test("le texte de partage est IDENTIQUE depuis discussions.html et depuis l'écran du salon : accroche en première ligne, puis « Rejoignez « nom » sur MAHOUTO+ (communauté payante : à partir de X FCFA). »", () => {
  const row = { id: "s-1", name: "Bassam YACOUBOU", is_paid: true, price: 500, abonnement: true, accroche: "Conseils, devis et entraide entre sérigraphes du Bénin", created_by: "o", lastMessage: "x", unread: 3 };
  const depuisChat = Share.buildMessage(Object.assign({ name: "Salon" }, row, { id: "s-1", forfait_min: 500 }));
  const depuisDiscussions = Share.buildMessage(Object.assign({}, row, { forfait_min: 500 }));
  assert.strictEqual(depuisDiscussions, depuisChat);
  assert.strictEqual(depuisChat, "Conseils, devis et entraide entre sérigraphes du Bénin\nRejoignez « Bassam YACOUBOU » sur MAHOUTO+ (communauté payante : à partir de " + FCFA(500) + ").");
  assert.ok(depuisChat.startsWith(row.accroche)); assert.ok(!TUT.test(depuisChat));
  assert.strictEqual(Share.buildMessage(Object.assign({}, row, { forfait_min: null })).split("\n")[1], "Rejoignez « Bassam YACOUBOU » sur MAHOUTO+ (communauté payante, sur abonnement).", "repli : aucun prix chiffré");
  assert.ok(DISC.includes("MahoutoRoomShare.share({ room: Object.assign({}, room, { forfait_min: forfaitMin }), win: window, doc: document });"), "discussions transmet l'accroche (ligne du salon) et le forfait");
  assert.ok(DISC.includes('.select("*")'), "colonnes lues avec le salon : accroche incluse, repli naturel si la colonne n'existe pas");
});

// ====================== aperçu du lien : photo du salon ======================
const CLOUD = "hefa5gqf";
const UP = (rest) => `https://res.cloudinary.com/${CLOUD}/image/upload/${rest}`;
const meta = (html, key) => { const m = html.match(new RegExp('<meta (?:property|name)="' + key + '" content="([^"]*)"')); return m ? m[1] : null; };
const preview = (photo) => Og.buildRoomPreview({ name: "S", is_paid: true, price: 500, photo_url: photo, emoji: "💬" }, "s-1");

test("photo du salon : acceptée seulement depuis le compte Cloudinary du projet (https, /image/upload/) ; transformée en 1200×630 sans rognage", () => {
  const p = preview(UP("v1700000000/mahoutoplus/photo.jpg")); assert.strictEqual(p.imageSource, "photo");
  assert.strictEqual(p.image.url, UP("f_jpg,q_auto,w_1200,h_630,c_pad,b_auto:predominant/v1700000000/mahoutoplus/photo.jpg")); assert.deepStrictEqual([p.image.width, p.image.height, p.image.card], ["1200", "630", "summary_large_image"]);
  const html = Og.renderRoomPreviewPage(p); assert.strictEqual(meta(html, "og:image"), p.image.url); assert.strictEqual(meta(html, "twitter:image"), p.image.url); assert.strictEqual(meta(html, "og:image:width"), "1200"); assert.strictEqual(meta(html, "og:image:height"), "630");
  assert.ok(p.image.url.includes("c_pad") && !p.image.url.includes("c_fill") && !p.image.url.includes("c_crop"), "carré ou portrait : image entière, bords complétés par la couleur dominante");
  ["png", "webp", "gif", "jpeg"].forEach((e) => assert.strictEqual(preview(UP("v1/x." + e)).imageSource, "photo", e));
});

test("photo hostile ou d'une autre origine : REFUSÉE, le logo reste ; rien de dangereux n'arrive dans la page", () => {
  const LOGO = "https://mahouto.com/assets/icon-512.png";
  const hostiles = ["https://evil.test/x.jpg", "http://res.cloudinary.com/" + CLOUD + "/image/upload/v1/x.jpg", "https://res.cloudinary.com/autre-compte/image/upload/v1/x.jpg", "//res.cloudinary.com/" + CLOUD + "/image/upload/v1/x.jpg",
    "https://res.cloudinary.com.evil.test/" + CLOUD + "/image/upload/v1/x.jpg", "https://evil.test/https://res.cloudinary.com/" + CLOUD + "/image/upload/v1/x.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://res.cloudinary.com/x.jpg",
    UP('v1/x.jpg"><script>alert(1)</script>'), UP("v1/x.jpg?onerror=alert(1)"), UP("v1/../../secret.jpg"), UP("v1/x y.jpg"), UP("v1/<b>.jpg"), UP("v1/x.svg"), UP("v1/x.heic"), UP("v1/x.pdf"), UP("a/b/c/d/e/f.jpg".padEnd(600, "a") + ".jpg"),
    "https://res.cloudinary.com/" + CLOUD + "/video/upload/v1/x.mp4", "", "   ", null, undefined, 123, {}, ["https://res.cloudinary.com/" + CLOUD + "/image/upload/v1/x.jpg"]];
  hostiles.forEach((u) => { const p = preview(u); assert.strictEqual(p.image.url, LOGO, "logo attendu pour : " + JSON.stringify(u)); assert.ok(p.imageSource.startsWith("logo:"), String(u)); const html = Og.renderRoomPreviewPage(p); assert.ok(!/<script>alert|onerror=|evil\.test|javascript:/i.test(html), "rien d'hostile dans la page : " + u); });
  assert.strictEqual(preview(null).imageSource, "logo:aucune-photo"); assert.strictEqual(preview("").imageSource, "logo:aucune-photo");
  assert.strictEqual(preview("https://evil.test/x.jpg").imageSource, "logo:photo-refusee");
});

test("photo « authenticated » (privée, signée) : refusée (non transformable, illisible pour WhatsApp) et signalée par l'en-tête de diagnostic", () => {
  const priv = `https://res.cloudinary.com/${CLOUD}/image/authenticated/s--AbCdEf12--/v1700000000/mahoutoplus/photo.jpg`;
  const p = preview(priv); assert.strictEqual(p.image.url, "https://mahouto.com/assets/icon-512.png"); assert.strictEqual(p.imageSource, "logo:photo-privee");
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } };
  return Og.handleRoomPreview({ query: { id: "s-1" } }, res, { fetchRoom: async () => ({ row: { name: "S", is_paid: true, price: 500, photo_url: priv, emoji: "💬" }, error: null }) }).then(() => {
    assert.strictEqual(res.headers["x-preview-image"], "logo:photo-privee");
    const ok = Object.assign({}, res, { headers: {} }); return Og.handleRoomPreview({ query: { id: "s-1" } }, Object.assign(ok, { setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { return this; }, send(b) { this.body = b; return this; } }), { fetchRoom: async () => ({ row: { name: "S", is_paid: true, photo_url: UP("v1/x.jpg") }, error: null }) }).then(() => assert.strictEqual(ok.headers["x-preview-image"], "photo"));
  });
});

test("l'URL de la photo est échappée dans les balises (esperluette), jamais interprétée", () => {
  const p = preview(UP("v1/a&b.jpg")); const html = Og.renderRoomPreviewPage(p);
  assert.strictEqual(meta(html, "og:image"), UP("f_jpg,q_auto,w_1200,h_630,c_pad,b_auto:predominant/v1/a&amp;b.jpg")); assert.ok(!/content="[^"]*"[^>]*>[^<]*<script>alert/.test(html));
  const src = read("api/_room-og.js"); assert.ok(src.includes('<meta property="og:image" content="${escapeHtml(image.url)}">') && src.includes('<meta name="twitter:image" content="${escapeHtml(image.url)}">'));
});

// ====================== api/attachment.js : photo de salon publique ======================
async function signAs(o) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attach-test-")); fs.cpSync(path.join(root, "api"), path.join(tmp, "api"), { recursive: true });
  const mod = (name, body) => { const d = path.join(tmp, "node_modules", ...name.split("/")); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" })); fs.writeFileSync(path.join(d, "index.js"), body); };
  mod("@supabase/supabase-js", "exports.createClient = () => { const db = globalThis.__DB; const chain = (t) => { const q = { select() { return q; }, eq() { return q; }, gt() { return q; }, maybeSingle: async () => ({ data: db[t] || null, error: null }) }; return q; }; return { auth: { getUser: async () => ({ data: { user: db.user }, error: null }) }, from: chain }; };");
  mod("cloudinary", "exports.v2 = { config() {}, utils: {}, url() { return ''; } };");
  Object.assign(process.env, { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "anon-fictive", SUPABASE_SERVICE_ROLE_KEY: "service-fictive", CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
  globalThis.__DB = { user: { id: o.user }, rooms: { id: "s-1", is_paid: o.paid, created_by: o.owner }, profiles: { role: o.role || "user" }, purchases: o.purchase ? { id: 1 } : null, salon_abonnements: null };
  const handler = (await import(pathToFileURL(path.join(tmp, "api", "attachment.js")).href)).default;
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await handler({ method: "GET", headers: { authorization: "Bearer t" }, query: Object.assign({ filename: "photo.jpg", context: "room", contextId: "s-1" }, o.query || {}) }, res);
  return res;
}
test("api/attachment.js : la photo d'un salon PAYANT est envoyée en « upload » (publique) pour le créateur et les administrateurs ; les pièces jointes restent « authenticated »", async () => {
  let r = await signAs({ user: "admin1", role: "admin", owner: "o1", paid: true, query: { purpose: "photo" } }); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.accessType, "upload"); assert.strictEqual(r.body.type, undefined, "pas de type authenticated");
  r = await signAs({ user: "o1", owner: "o1", paid: true, query: { purpose: "photo" } }); assert.strictEqual(r.body.accessType, "upload");
  r = await signAs({ user: "admin1", role: "admin", owner: "o1", paid: true }); assert.strictEqual(r.body.accessType, "authenticated", "sans purpose : inchangé (pièce jointe d'un salon payant)"); assert.strictEqual(r.body.type, "authenticated");
  r = await signAs({ user: "m1", owner: "o1", paid: true, purchase: true }); assert.strictEqual(r.body.accessType, "authenticated", "un membre ayant acheté envoie toujours des pièces jointes privées");
  r = await signAs({ user: "m1", owner: "o1", paid: false }); assert.strictEqual(r.body.accessType, "upload", "salon gratuit : inchangé");
});
test("api/attachment.js : « purpose=photo » refusé à un simple membre (même abonné ou acheteur) et aux fichiers qui ne sont pas des images", async () => {
  let r = await signAs({ user: "m1", owner: "o1", paid: true, purchase: true, query: { purpose: "photo" } }); assert.strictEqual(r.code, 403); assert.strictEqual(r.body.error, "Seuls le créateur du salon et les administrateurs peuvent changer sa photo.");
  r = await signAs({ user: "m1", owner: "o1", paid: false, query: { purpose: "photo" } }); assert.strictEqual(r.code, 403, "même sur un salon gratuit : réservé au créateur et aux administrateurs");
  for (const filename of ["x.pdf", "x.svg", "x.html", "x.exe", "x"]) { r = await signAs({ user: "admin1", role: "admin", owner: "o1", paid: true, query: { purpose: "photo", filename } }); assert.ok(r.code === 415, filename + " → " + r.code); }
  r = await signAs({ user: "x", owner: "o1", paid: true, query: { purpose: "photo" } }); assert.strictEqual(r.code, 403, "ni l'accès au salon, ni la photo");
});
test("photo de salon : les deux écrans qui la changent demandent « purpose=photo » ; les pièces jointes de chat.html non", () => {
  assert.ok(read("admin/rooms.html").includes('context: "room", contextId: r.id, purpose: "photo"')); assert.ok(read("discussions.html").includes('context: "room", contextId: roomId, purpose: "photo"'));
  assert.ok(!/purpose/.test(CHAT), "chat.html : pièces jointes inchangées"); assert.ok(!/purpose/.test(read("attachments.js")));
  assert.strictEqual((read("discussions.html").match(/purpose: "photo"/g) || []).length, 1, "l'envoi d'un fichier dans un salon (discussions) reste inchangé");
});

test("limites : 12 fonctions, mêmes assistants, cache v139, aucune clé", () => {
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
  assert.strictEqual(fs.readdirSync(path.join(root, "api")).filter((f) => f.startsWith("_")).length, 11);
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(139|1[4-9]\d)";/);
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci/.test(read("salon-abonnement.js") + read("room-share.js")));
});

// ====================== forfaits INACTIFS : jamais comptés, jamais affichés (un administrateur lit aussi les inactifs) ======================
const INACTIF = { code: "test-1-jour", libelle: "Test 1 jour", jours: 1, montant: 300, ordre: 0, actif: false };
const ACTIF = P("jour", "Jour", 1, 500, 1);
const SANS_COLONNE = { code: "sans-actif", libelle: "Sans colonne", jours: 1, montant: 100, ordre: 0 };

test("inactifs : « à partir de » = 500 FCFA même si le forfait inactif à 300 est renvoyé avec l'actif à 500 ; sans colonne « actif » : ignoré", () => {
  [[INACTIF, ACTIF], [ACTIF, INACTIF]].forEach((rows) => {
    assert.strictEqual(Abo.minPrice(rows), 500); assert.deepStrictEqual(Abo.plansFromRows(rows).map((p) => p.code), ["jour"]);
    assert.deepStrictEqual(Abo.offerSummary(rows), { kind: "unique", title: "Jour : " + FCFA(500) + " pour 1 jour", lines: [] }, "un seul forfait actif : pas de liste, pas de 300");
  });
  assert.strictEqual(Abo.offerSummary([INACTIF, ACTIF, SEM]).title, "Abonnement à partir de " + FCFA(500));
  assert.ok(!Abo.offerSummary([INACTIF, ACTIF, SEM]).lines.join("|").includes("300"), "la liste n'a pas le forfait inactif");
  assert.strictEqual(Abo.minPrice([SANS_COLONNE]), null, "sans colonne actif : ignoré"); assert.deepStrictEqual(Abo.plansFromRows([SANS_COLONNE]), []);
  assert.strictEqual(Abo.minPrice([SANS_COLONNE, ACTIF]), 500);
  [false, "true", 1, 0, null, undefined, "oui"].forEach((a) => assert.deepStrictEqual(Abo.plansFromRows([Object.assign({}, ACTIF, { actif: a })]), [], "actif=" + JSON.stringify(a) + " : seul true compte"));
  assert.deepStrictEqual(Abo.offerSummary([INACTIF]), { kind: "indisponible", title: Abo.UNAVAILABLE, lines: [] }, "que des inactifs : tarifs indisponibles");
  assert.ok(/actif/.test(Abo.FORFAIT_COLUMNS) && Abo.FORFAIT_COLUMNS === "code, libelle, jours, montant, ordre, actif");
});

test("écran verrouillé et boutons de choix : les lignes inactives renvoyées (cas administrateur) ne sont jamais affichées", async () => {
  const rows = [INACTIF, ACTIF, SEM];
  for (const user of [null, { id: "a1", is_anonymous: true }]) {
    const t = locked({ plans: rows, user }); await t.run(ROOM); await tick();
    const txt = t.get("locked-offer").textContent; assert.ok(txt.startsWith("Abonnement à partir de " + FCFA(500)), txt); assert.ok(!txt.includes("300") && !txt.includes("Test 1 jour"), txt);
  }
  const m = locked({ plans: rows, user: { id: "m1" } }); await m.run(ROOM); await tick();
  assert.deepStrictEqual(m.get("locked-plans").children.map((b) => b.textContent), ["Jour — " + FCFA(500), "Semaine — " + FCFA(2000)], "aucun bouton pour le forfait inactif");
  const seul = locked({ plans: [INACTIF], user: null }); await seul.run(ROOM); await tick(); assert.strictEqual(seul.get("locked-offer").textContent, Abo.UNAVAILABLE);
});

test("texte de partage (discussions.html et chat.html) : « à partir de 500 FCFA » même si le forfait inactif à 300 est renvoyé ; requêtes filtrées sur actif", async () => {
  const d = discussionsPrefetch({ data: [INACTIF, ACTIF], error: null }); await d.o.run([{ is_paid: true, abonnement: true }]); assert.strictEqual(d.o.min, 500);
  assert.ok(d.log.some((x) => x[0] === "eq" && x[1] === "actif" && x[2] === true), "discussions : .eq(\"actif\", true)");
  assert.strictEqual(Share.buildMessage({ name: "S", is_paid: true, abonnement: true, forfait_min: d.o.min }), "Rejoignez « S » sur MAHOUTO+ (communauté payante : à partir de " + FCFA(500) + ").");
  const sel = (f) => (f.match(/\.select\(MahoutoSalonAbonnement\.FORFAIT_COLUMNS\)[^;]*/) || [""])[0];
  assert.ok(sel(CHAT).includes('.eq("actif", true)') && sel(DISC).includes('.eq("actif", true)'));
  const sansColonne = discussionsPrefetch({ data: [SANS_COLONNE], error: null }); await sansColonne.o.run([{ is_paid: true, abonnement: true }]); assert.strictEqual(sansColonne.o.min, null);
});

test("aperçu du lien (api/produit-og.js) : lecture avec la clé publique seule, donc la RLS ne renvoie que les forfaits actifs ; fichier inchangé", () => {
  const src = read("api/produit-og.js"); const fn = src.slice(src.indexOf("async function fetchRoomForPreview"), src.indexOf("async function fetchRoomForPreview") + 1800);
  assert.ok(fn.includes("process.env.SUPABASE_ANON_KEY") && !/SERVICE_ROLE/.test(fn), "clé publique (anon), jamais service_role : pas de session administrateur");
  const sql = read("salons-abonnement.sql"); assert.ok(/create policy "salon_forfaits_public_read"[\s\S]{0,120}to anon, authenticated\s+using \(actif = true\)/.test(sql));
  assert.ok(/create policy "salon_forfaits_admin_all"[\s\S]{0,120}using \(public\.is_admin\(\)\)/.test(sql), "cause : la politique admin renvoie aussi les inactifs aux administrateurs connectés");
});
