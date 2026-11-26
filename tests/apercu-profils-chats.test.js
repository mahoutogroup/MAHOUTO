/* Aperçu des pages publiques de membres dans les messages (chat.html, dm-chat.html) : link-preview.js (client) et
   api/_profil-og.js + api/produit-og.js (type=profil, format=json). Aucun réseau, aucune base : faux fetch, faux stockage, faux DOM. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 10));
const json = (o) => JSON.parse(JSON.stringify(o));   // sort un objet du vm (comparaisons profondes entre domaines)

// ====================== serveur (module ESM chargé tel quel dans un vm) ======================
const SERVER = (() => {
  const strip = (t) => t.replace(/^import .*$/gm, "").replace(/export (const|function|async function)/g, "$1");
  const sb = { URL, encodeURIComponent, process: { env: {} }, JSON };
  vm.runInNewContext(strip(read("api/_cloudinary-og.js")) + "\n" + strip(read("api/_profil-og.js")) +
    "\nthis.api = { handleProfilJson, handleProfilPreview, buildProfilCard, profilCardImage, readProfilPage, PROFIL_JSON_CACHE };", sb);
  return sb.api;
})();
const IMG = "https://res.cloudinary.com/hefa5gqf/image/upload/v1793189115/mahoutoplus/avatars/photo-profil.jpg";
const ROW = (o) => Object.assign({ id: "11111111-2222-4333-8444-555555555555", adresse: "serigraphe", nom_affiche: "Atelier Sérigraphe", avatar_url: IMG, metier: "Sérigraphe", presentation: "Impression sur textile et affiches, depuis 2015.", localisation: "Cotonou, Bénin",
  contact_type: "whatsapp", contact_valeur: "+22900000000", user_id: "99999999-2222-4333-8444-555555555555", publie: true, suspendu: false, majeur_declare: true }, o || {});
function deps(o) {
  const opts = Object.assign({ pages: { serigraphe: ROW() }, alias: { imprimeur: "serigraphe" }, aliasError: false, pageError: null, noAlias: false }, o || {}), calls = [];
  const d = { calls, fetchProfil: async (a) => { calls.push("profil:" + a); if (opts.pageError === a) return { row: null, error: new Error("x") }; return { row: opts.pages[a] || null, error: null }; } };
  if (!opts.noAlias) d.fetchAlias = async (a) => { calls.push("alias:" + a); return opts.aliasError ? { adresse: null, error: new Error("x") } : { adresse: Object.prototype.hasOwnProperty.call(opts.alias, a) ? opts.alias[a] : null, error: null }; };
  return d;
}
function fakeRes() { const r = { headers: {}, code: null, payload: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.payload = json(b); return this; }, send(b) { this.payload = b; return this; } }; return r; }
const getJson = async (adresse, d, method) => { const res = fakeRes(); await SERVER.handleProfilJson({ query: { adresse, type: "profil", format: "json" }, method: method || "GET" }, res, d); return res; };
const getHtml = async (adresse, d) => { const res = fakeRes(); await SERVER.handleProfilPreview({ query: { adresse } }, res, d); return res; };

test("JSON profil : page publique → {title, description, image, adresse} ; nom, « métier · ville — début de la présentation », photo Cloudinary du projet", async () => {
  const d = deps(); const res = await getJson("serigraphe", d);
  assert.strictEqual(res.code, 200); assert.deepStrictEqual(Object.keys(res.payload).sort(), ["adresse", "description", "image", "title"], "empreinte des clés");
  assert.strictEqual(res.payload.title, "Atelier Sérigraphe"); assert.strictEqual(res.payload.adresse, "serigraphe");
  assert.strictEqual(res.payload.description, "Sérigraphe · Cotonou, Bénin — Impression sur textile et affiches, depuis 2015.");
  assert.match(res.payload.image, /^https:\/\/res\.cloudinary\.com\/hefa5gqf\/image\/upload\/f_jpg,q_auto,fl_strip_profile,w_160,h_160,c_fill,g_auto\/v1793189115\/mahoutoplus\/avatars\/photo-profil\.jpg$/);
  assert.deepStrictEqual(d.calls, ["profil:serigraphe"], "une seule lecture, aucun appel d'alias");
  assert.ok(res.payload.description.length <= 200, "longueur limitée");
});

test("JSON profil : JAMAIS le contact, un identifiant ou un champ absent de l'aperçu de partage (ni dans les clés, ni dans le texte)", async () => {
  const row = ROW({ contact_type: "lien", contact_valeur: "https://exemple.test/contact-prive", presentation: "Texte public." });
  const res = await getJson("serigraphe", deps({ pages: { serigraphe: row } })); const body = JSON.stringify(res.payload);
  ["contact", "wa.me", "+229", "exemple.test", "user_id", "99999999-2222", "11111111-2222", "majeur", "suspendu", "publie", "id\""].forEach((x) => assert.ok(!body.includes(x), "ne doit pas contenir : " + x));
  assert.deepStrictEqual(Object.keys(res.payload).sort(), ["adresse", "description", "image", "title"]);
  // même description que l'aperçu de partage HTML (même fonction)
  const html = await getHtml("serigraphe", deps({ pages: { serigraphe: row } })); assert.ok(html.payload.includes(res.payload.description.replace(/&/g, "&amp;")), "même description que l'aperçu de partage");
  const src = code("api/_profil-og.js").match(/export function buildProfilCard[\s\S]*?\n}\n/)[0]; assert.ok(!/contact|user_id|\bid\b/.test(src.replace(/profilDescription|row\.id/g, "")), "le code de la carte ne lit que nom, métier, ville, présentation, photo");
});

test("JSON profil : photo seulement si elle vient du compte Cloudinary du projet ; sinon image vide", async () => {
  for (const url of [null, "", "https://exemple.test/a.jpg", "http://res.cloudinary.com/hefa5gqf/image/upload/v1/a.jpg", "https://res.cloudinary.com/autre-compte/image/upload/v1/a.jpg", IMG + "?x=1", "https://res.cloudinary.com/hefa5gqf/image/upload/v1/a.svg", "javascript:alert(1)"]) {
    const res = await getJson("serigraphe", deps({ pages: { serigraphe: ROW({ avatar_url: url }) } })); assert.strictEqual(res.code, 200, String(url)); assert.strictEqual(res.payload.image, "", String(url));
  }
});

test("JSON profil : page non publique (inexistante, non publiée, suspendue, interrupteur fermé : la lecture ne renvoie rien) → 404 SANS contenu de page", async () => {
  const res = await getJson("inconnu-xyz", deps({ pages: {} })); assert.strictEqual(res.code, 404); assert.deepStrictEqual(res.payload, { error: "not_found" });
  const body = JSON.stringify(res.payload); ["title", "description", "nom", "Atelier"].forEach((x) => assert.ok(!body.includes(x)));
  const wrongRow = await getJson("serigraphe", deps({ pages: { serigraphe: ROW({ adresse: "autre-adresse" }) } })); assert.strictEqual(wrongRow.code, 404, "ligne qui ne correspond pas à l'adresse");
  const noName = await getJson("serigraphe", deps({ pages: { serigraphe: ROW({ nom_affiche: "  " }) } })); assert.strictEqual(noName.code, 404, "sans nom affiché");
  assert.strictEqual(res.headers["Cache-Control"], SERVER.PROFIL_JSON_CACHE);
  // indiscernable : mêmes réponses pour tous les états non publics
  const a = await getJson("serigraphe", deps({ pages: {} })), b = await getJson("autre-page", deps({ pages: {} })); assert.deepStrictEqual(a.payload, b.payload);
});

test("JSON profil : alias → la page principale, avec l'adresse PRINCIPALE dans le champ « adresse » ; mêmes requêtes que l'aperçu HTML", async () => {
  const d = deps(); const res = await getJson("imprimeur", d);
  assert.strictEqual(res.code, 200); assert.strictEqual(res.payload.adresse, "serigraphe"); assert.strictEqual(res.payload.title, "Atelier Sérigraphe");
  assert.deepStrictEqual(d.calls, ["profil:imprimeur", "alias:imprimeur", "profil:serigraphe"]);
  for (const [adresse, o] of [["serigraphe", {}], ["imprimeur", {}], ["inconnu-xyz", {}], ["imprimeur", { aliasError: true }], ["imprimeur", { pageError: "serigraphe" }], ["serigraphe", { pageError: "serigraphe" }], ["imprimeur", { alias: { imprimeur: "../x" } }], ["imprimeur", { alias: { imprimeur: "imprimeur" } }]]) {
    const dj = deps(o), dh = deps(o); await getJson(adresse, dj); await getHtml(adresse, dh); assert.deepStrictEqual(dj.calls, dh.calls, "mêmes requêtes que l'aperçu HTML : " + adresse + " " + JSON.stringify(o));
  }
  const none = deps({ alias: {} }); assert.strictEqual((await getJson("imprimeur", none)).code, 404);
  const bad = await getJson("imprimeur", deps({ alias: { imprimeur: "../x" } })); assert.strictEqual(bad.code, 404, "adresse renvoyée invalide : ignorée");
});

test("JSON profil : erreur de lecture → 503 SANS cache, sans contenu ; adresse invalide → 404 avant toute requête ; méthode autre que GET → 405", async () => {
  for (const o of [{ pageError: "serigraphe" }, { aliasError: true, pages: {} }, { pageError: "serigraphe", pages: {} }]) {
    const res = await getJson(o.aliasError ? "imprimeur" : "serigraphe", deps(o)); assert.strictEqual(res.code, 503, JSON.stringify(o)); assert.strictEqual(res.headers["Cache-Control"], "no-store"); assert.deepStrictEqual(res.payload, { error: "unavailable" });
  }
  const principal = await getJson("imprimeur", deps({ pageError: "serigraphe" })); assert.strictEqual(principal.code, 503);
  for (const bad of ["A", "ab", "-abc", "abc-", "ABC", "a b", "a".repeat(31), "../x", "", undefined, ["x"], "imprimeur'or'1"]) {
    const d = deps(); const res = await getJson(bad, d); assert.strictEqual(res.code, 404, String(bad)); assert.deepStrictEqual(d.calls, [], "aucune requête : " + String(bad));
  }
  const post = await getJson("serigraphe", deps(), "POST"); assert.strictEqual(post.code, 405); assert.strictEqual(post.headers["Cache-Control"], "no-store");
});

test("JSON profil : en-têtes — cache court (5 minutes au plus), noindex, JSON ; site et marque fixes ; aucune nouvelle fonction api/", async () => {
  const res = await getJson("serigraphe", deps());
  assert.strictEqual(res.headers["Content-Type"], "application/json; charset=utf-8"); assert.strictEqual(res.headers["X-Robots-Tag"], "noindex, nofollow");
  const sMax = Number(/s-maxage=(\d+)/.exec(res.headers["Cache-Control"])[1]); assert.ok(sMax <= 300, "s-maxage ≤ 5 minutes : " + sMax); assert.match(res.headers["Cache-Control"], /^public, max-age=60, s-maxage=300$/);
  const og = read("api/_profil-og.js"); assert.match(og, /export const PROFIL_SITE = "https:\/\/mahouto\.com";/); assert.match(og, /export const PROFIL_BRAND = "MAHOUTO\+";/); assert.ok(!/headers\.host/.test(og));
  const prod = read("api/produit-og.js");
  assert.match(prod, /req\.query\.type === "profil" && req\.query\.format === "json"\) \{\s*return handleProfilJson\(req, res, \{ fetchProfil: fetchProfilForPreview, fetchAlias: fetchAliasForPreview \}\);/);
  assert.match(prod, /req\.query\.type === "profil" && req\.query\.format !== "json"\) \{\s*return handleProfilPreview\(req, res, \{ fetchProfil: fetchProfilForPreview, fetchAlias: fetchAliasForPreview, fetchIndexable: fetchIndexableForPreview \}\);/, "l'aperçu HTML est inchangé");
  assert.ok(prod.indexOf("return handleProfilJson(req, res") < prod.indexOf("return handleJson(req, res, base, type);"), "routé avant le JSON générique des produits");
  assert.match(prod, /import \{ handleProfilPreview, handleProfilJson, handleProfilSitemap \} from "\.\/_profil-og\.js";/);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
  assert.ok(!fs.readdirSync(root).some((f) => /\.sql$/.test(f) && /apercu|chats/.test(f)), "aucun SQL");
});

// ====================== client : link-preview.js ======================
function makeEl(tag) {
  const el = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, parentNode: null, _t: "", className: "", alt: "", src: "", href: "", target: "", rel: "", loading: "", referrerPolicy: "", isConnected: true,
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; this.isConnected = false; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; } };
  return el;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const find = (r, p) => { const o = []; walk(r, (n) => { if (p(n)) o.push(n); }); return o; };
function env(o) {
  const opts = Object.assign({ responses: {}, ls: {}, now: 1700000000000 }, o || {}), fetches = [], writes = [], store = Object.assign({}, opts.ls), state = { now: opts.now };
  const head = makeEl("head"), doc = { head, createElement: makeEl };
  const sandbox = { window: {}, document: doc, URL, Array, JSON, Promise, WeakMap, Date: { now: () => state.now }, encodeURIComponent, String,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { writes.push([k, v]); store[k] = String(v); } },
    fetch: async (u) => { fetches.push(u); const r = typeof opts.responses === "function" ? opts.responses(u) : opts.responses[u]; if (!r) return { ok: false, status: 404, json: async () => ({ error: "not_found" }) }; return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body }; } };
  sandbox.window = sandbox; vm.runInNewContext(read("link-preview.js"), sandbox);
  return { LP: sandbox.window.MahoutoLinkPreview, fetches, writes, store, state, doc };
}
const API = (a) => "/api/produit-og?type=profil&adresse=" + a + "&format=json";
const OK = (o) => ({ body: Object.assign({ title: "Atelier Sérigraphe", description: "Sérigraphe · Cotonou — Texte.", image: IMG, adresse: "serigraphe" }, o || {}) });

test("findLinks : /m/<adresse> reconnu sur les quatre hôtes (adresse reconstruite sans paramètres ni ancre) ; produits /p/ et /s/ inchangés", () => {
  const { LP } = env(); const f = (t) => json(LP.findLinks(t));
  for (const host of ["mahouto.com", "www.mahouto.com", "majestepresse.com", "www.majestepresse.com"]) {
    const r = f("Regardez https://" + host + "/m/mon-atelier?src=qr#haut, merci"); assert.strictEqual(r.length, 1, host); assert.strictEqual(r[0].href, "https://" + host + "/m/mon-atelier"); assert.strictEqual(r[0].type, "profil"); assert.strictEqual(r[0].id, "mon-atelier");
    assert.strictEqual(r[0].siteName, host.endsWith("mahouto.com") ? "MAHOUTO+" : "MAJESTÉ PRESSE"); assert.strictEqual(r[0].ttl, 5 * 60 * 1000, "5 minutes pour une page de membre");
  }
  assert.strictEqual(f("https://mahouto.com/m/mon-atelier/")[0].href, "https://mahouto.com/m/mon-atelier"); assert.strictEqual(f("www.mahouto.com/m/abc")[0].href, "https://www.mahouto.com/m/abc", "sans https:// (comme linkify)");
  assert.strictEqual(f("https://mahouto.com/p/abc-123")[0].type, "produit"); assert.strictEqual(f("https://mahouto.com/p/abc-123")[0].ttl, 24 * 3600 * 1000);
  assert.strictEqual(f("https://mahouto.com/s/12345678-1234-1234-1234-123456789abc")[0].type, "serigraphie");
  assert.strictEqual(f("https://mahouto.com/m/aaa https://mahouto.com/m/bbb https://mahouto.com/m/ccc").length, 2, "MAX_CARDS inchangé (2)");
  assert.strictEqual(f("https://mahouto.com/m/aaa https://mahouto.com/m/aaa?x=1").length, 1, "sans doublon");
});

test("findLinks : rejette adresses invalides, ports, identifiants, hôtes inconnus, http, autres chemins (aucune requête)", () => {
  const { LP, fetches } = env(); const none = (u) => assert.strictEqual(LP.findLinks("voir " + u).length, 0, u);
  ["ab", "a", "-abc", "abc-", "ABC", "Mon-Atelier", "a".repeat(31), "mon_atelier", "mon.atelier", "abc%20def", "%41bc", "abc/def", "é-atelier"].forEach((a) => none("https://mahouto.com/m/" + a));
  ["https://mahouto.com:8443/m/abc", "https://user@mahouto.com/m/abc", "https://user:pw@mahouto.com/m/abc", "http://mahouto.com/m/abc", "https://mahouto.com.evil.test/m/abc", "https://evil.test/m/abc", "https://notmahouto.com/m/abc", "https://sub.mahouto.com/m/abc", "https://mahouto.com@evil.test/m/abc",
    "https://exemple.test/?u=https://mahouto.com/m/abc", "ftp://mahouto.com/m/abc", "javascript:alert(1)//mahouto.com/m/abc"].forEach(none);
  ["https://mahouto.com/m/", "https://mahouto.com/m", "https://mahouto.com/m/abc/def", "https://mahouto.com/M/abc", "https://mahouto.com/m.html?adresse=abc", "https://mahouto.com/profil.html", "https://mahouto.com/", "https://mahouto.com/e/abc", "https://mahouto.com/r/abc", "https://mahouto.com/f/abc"].forEach(none);
  assert.strictEqual(LP.findLinks("").length + LP.findLinks(null).length + LP.findLinks(undefined).length, 0); assert.deepStrictEqual(fetches, []);
});

test("carte : message avec un lien /m/<adresse> → une requête /api/produit-og?type=profil&adresse=…&format=json, carte compacte, valeurs en texte brut, lien = adresse du MESSAGE", async () => {
  const e = env({ responses: { [API("serigraphe")]: OK({ title: "<b>Atelier</b> & Cie", description: "<img src=x onerror=alert(1)>", adresse: "adresse-venue-de-la-reponse" }) } });
  const bubble = makeEl("div"), scroller = makeEl("div"); e.LP.attach(bubble, "Voir https://mahouto.com/m/serigraphe?src=qr", scroller); await tick(30);
  assert.deepStrictEqual(e.fetches, [API("serigraphe")]);
  const card = find(bubble, (n) => n.tagName === "A")[0]; assert.ok(card, "carte affichée"); assert.strictEqual(card.href, "https://mahouto.com/m/serigraphe", "le lien est l'adresse du message, jamais celle de la réponse");
  assert.ok(!JSON.stringify(card.attrs).includes("venue-de-la-reponse") && card.href.indexOf("venue-de-la-reponse") < 0);
  assert.match(card.className, /mlp-profil/); assert.strictEqual(card.target, "_blank"); assert.strictEqual(card.rel, "noopener noreferrer");
  assert.strictEqual(find(card, (n) => n.className === "mlp-title")[0].textContent, "<b>Atelier</b> & Cie", "texte brut"); assert.strictEqual(find(card, (n) => n.className === "mlp-desc")[0].textContent, "<img src=x onerror=alert(1)>");
  assert.strictEqual(find(card, (n) => n.className === "mlp-site")[0].textContent, "MAHOUTO+");
  const img = find(card, (n) => n.tagName === "IMG")[0]; assert.strictEqual(img.src, IMG); assert.strictEqual(img.alt, ""); assert.strictEqual(img.referrerPolicy, "no-referrer");
  assert.strictEqual(find(card, (n) => n.className === "mlp-avatar")[0].children[0].textContent, "<", "initiale (texte), derrière la photo");
});

test("carte : lien /m/<alias> → le lien de la carte reste l'adresse de l'alias tapée dans le message (la réponse porte l'adresse principale, ignorée)", async () => {
  const e = env({ responses: { [API("imprimeur")]: OK({ adresse: "serigraphe" }) } }); const bubble = makeEl("div");
  e.LP.attach(bubble, "https://www.majestepresse.com/m/imprimeur", makeEl("div")); await tick(30);
  const card = find(bubble, (n) => n.tagName === "A")[0]; assert.strictEqual(card.href, "https://www.majestepresse.com/m/imprimeur"); assert.strictEqual(find(card, (n) => n.className === "mlp-site")[0].textContent, "MAJESTÉ PRESSE");
});

test("carte : photo non Cloudinary ignorée ; sans photo → initiale seule ; présentation vide → pas de ligne de description", async () => {
  const e = env({ responses: { [API("sans-photo")]: OK({ image: "https://exemple.test/a.jpg", description: "" }), [API("javascript-img")]: OK({ image: "javascript:alert(1)" }) } });
  const b1 = makeEl("div"); e.LP.attach(b1, "https://mahouto.com/m/sans-photo", makeEl("div")); await tick(30);
  assert.strictEqual(find(b1, (n) => n.tagName === "IMG").length, 0); assert.strictEqual(find(b1, (n) => n.className === "mlp-avatar")[0].children[0].textContent, "A"); assert.strictEqual(find(b1, (n) => n.className === "mlp-desc").length, 0);
  const b2 = makeEl("div"); e.LP.attach(b2, "https://mahouto.com/m/javascript-img", makeEl("div")); await tick(30); assert.strictEqual(find(b2, (n) => n.tagName === "IMG").length, 0);
});

test("cache : 5 minutes pour une page de membre (24 h pour un produit) ; un deuxième affichage ne refait pas la requête, un affichage après 5 minutes oui", async () => {
  const e = env({ responses: { [API("serigraphe")]: OK(), "/api/produit-og?type=produit&id=abc&format=json": { body: { title: "Produit", description: "Texte", image: IMG } } } });
  const attach = (t) => { const b = makeEl("div"); e.LP.attach(b, t, makeEl("div")); return b; };
  attach("https://mahouto.com/m/serigraphe"); await tick(30); assert.strictEqual(e.fetches.length, 1);
  const key = "mahouto_lp:https://mahouto.com/m/serigraphe"; assert.ok(e.store[key], "écrit dans localStorage"); assert.strictEqual(JSON.parse(e.store[key]).t, e.state.now);
  const b2 = attach("https://mahouto.com/m/serigraphe"); await tick(30); assert.strictEqual(e.fetches.length, 1, "servi par le cache"); assert.ok(find(b2, (n) => n.tagName === "A").length === 1, "la carte s'affiche depuis le cache");
  e.state.now += 4 * 60 * 1000 + 59000; attach("https://mahouto.com/m/serigraphe"); await tick(30); assert.strictEqual(e.fetches.length, 1, "avant 5 minutes : encore en cache");
  e.state.now += 2000; attach("https://mahouto.com/m/serigraphe"); await tick(30); assert.strictEqual(e.fetches.length, 2, "après 5 minutes : nouvelle lecture (une page suspendue disparaît)");
  attach("https://mahouto.com/p/abc"); await tick(30); assert.strictEqual(e.fetches.length, 3); e.state.now += 6 * 60 * 1000; attach("https://mahouto.com/p/abc"); await tick(30); assert.strictEqual(e.fetches.length, 3, "produit : toujours 24 h");
  e.state.now += 24 * 3600 * 1000; attach("https://mahouto.com/p/abc"); await tick(30); assert.strictEqual(e.fetches.length, 4, "produit : refait après 24 h");
});

test("cache : une réponse 404 ou 503 (ou invalide, ou réseau coupé) n'écrit RIEN dans localStorage et n'affiche aucune carte ; le lien reste du texte", async () => {
  for (const r of [{ status: 404, body: { error: "not_found" } }, { status: 503, body: { error: "unavailable" } }, { status: 200, body: { title: "" } }, { status: 200, body: {} }, { status: 200, body: null }]) {
    const e = env({ responses: { [API("inconnue")]: r } }); const bubble = makeEl("div"); e.LP.attach(bubble, "https://mahouto.com/m/inconnue", makeEl("div")); await tick(30);
    assert.strictEqual(e.fetches.length, 1); assert.deepStrictEqual(e.writes, [], "aucune écriture : " + r.status); assert.deepStrictEqual(Object.keys(e.store), [], "aucune trace");
    assert.strictEqual(find(bubble, (n) => n.tagName === "A").length, 0, "aucune carte"); assert.strictEqual(find(bubble, (n) => n.className === "mlp-slot").length, 0, "emplacement retiré");
  }
  const down = env({ responses: () => { throw new Error("hors ligne"); } }); const b = makeEl("div"); down.LP.attach(b, "https://mahouto.com/m/serigraphe", makeEl("div")); await tick(30); assert.deepStrictEqual(down.writes, []); assert.strictEqual(find(b, (n) => n.tagName === "A").length, 0);
});

test("aucune requête sans lien reconnu ; MAX_CARDS inchangé ; le chat reste en bas après le chargement de la carte", async () => {
  const e = env({ responses: { [API("aaa")]: OK(), [API("bbb")]: OK() } });
  ["Bonjour", "https://exemple.test/m/abc", "https://mahouto.com/m/AB", "https://mahouto.com:444/m/abc", ""].forEach((t) => e.LP.attach(makeEl("div"), t, makeEl("div"))); await tick(20); assert.deepStrictEqual(e.fetches, [], "aucune requête");
  const b = makeEl("div"); e.LP.attach(b, "https://mahouto.com/m/aaa https://mahouto.com/m/bbb https://mahouto.com/m/ccc", makeEl("div")); await tick(30); assert.strictEqual(e.fetches.length, 2, "2 cartes au plus");
  const scroller = Object.assign(makeEl("div"), { scrollHeight: 1000, scrollTop: 600, clientHeight: 380 }); const e2 = env({ responses: { [API("aaa")]: OK() } }); e2.LP.attach(makeEl("div"), "https://mahouto.com/m/aaa", scroller); await tick(30);
  assert.strictEqual(scroller.scrollTop, 1000, "près du bas : on reste en bas"); const far = Object.assign(makeEl("div"), { scrollHeight: 1000, scrollTop: 100, clientHeight: 380 }); const e3 = env({ responses: { [API("aaa")]: OK() } }); e3.LP.attach(makeEl("div"), "https://mahouto.com/m/aaa", far); await tick(30); assert.strictEqual(far.scrollTop, 100, "loin du bas : on ne force pas");
});

test("garde-fous du client : aucun innerHTML, une seule requête par adresse à la fois, image Cloudinary exigée, durées 24 h / 5 min, pages chat et dm-chat inchangées, cache v127", () => {
  const js = code("link-preview.js"); assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(js));
  assert.match(js, /var TTL_MS = 24 \* 60 \* 60 \* 1000;/); assert.match(js, /var TTL_PROFIL_MS = 5 \* 60 \* 1000;/); assert.match(js, /var MAX_CARDS = 2;/); assert.match(js, /\/\^https:\\\/\\\/res\\\.cloudinary\\\.com\\\//);
  assert.match(js, /a\.href = link\.href;/, "le lien est celui de l'adresse du message"); assert.match(read("link-preview.js"), /a\.href = link\.href;\s+\/\/ adresse validée, jamais celle de la réponse/); assert.ok(!/json\.adresse|json\.href|json\.url/.test(js), "aucune adresse venue de la réponse");
  assert.ok(!/writeCache\([^)]*\)[\s\S]{0,40}catch/.test(js.slice(js.indexOf(".catch(function (err)"))), "aucune écriture dans la branche d'erreur");
  const catchBranch = js.slice(js.indexOf(".catch(function (err) {"), js.indexOf("return inflight[link.href];")); assert.ok(!/writeCache|localStorage/.test(catchBranch), "l'erreur n'écrit pas en cache");
  assert.match(js, /if \(!resp\.ok\) throw new Error\("http " \+ resp\.status\);/, "404 et 503 sont des échecs");
  assert.match(read("chat.html"), /MahoutoLinkPreview\.attach\(bubble, msg\.content, messagesEl\);/); assert.match(read("dm-chat.html"), /MahoutoLinkPreview\.attach\(bubble, msg\.content, messagesEl\);/);
  assert.match(read("sw.js"), /CACHE_NAME = "mahoutoplus-shell-v(12[7-9]|1[3-9]\d)"/);
  const css = js.slice(js.indexOf("var css ="), js.indexOf("var st = document.createElement")); assert.match(css, /\.mlp-profil\{display:flex/); assert.match(css, /body\.light-theme \.mlp-profil \.mlp-avatar\{color:var\(--gold-text,#856500\)\}/);
  assert.ok(css.indexOf(".mlp-desc{") < css.indexOf(".mlp-profil{"), "les styles des autres types sont inchangés, la variante profil s'ajoute après");
});
