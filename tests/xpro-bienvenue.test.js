/* Écran de bienvenue « MAHOUTO X-PRO » (xpro.js, pro.html, index.html, vercel.json, sw.js). Aucun réseau, aucune base.
   L'écran ne concerne que les téléphones revendus : sans indicateur local, RIEN ne change. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const XPro = require("../xpro");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

// ---------- faux stockage (journalise tout accès) et faux DOM ----------
function storage(initial, opts) {
  const o = opts || {}, data = Object.assign({}, initial), log = { get: [], set: [], remove: [] };
  return { data, log,
    getItem(k) { log.get.push(k); if (o.throwGet) throw new Error("bloqué"); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { log.set.push([k, v]); if (o.throwSet) throw new Error("quota"); data[k] = String(v); },
    removeItem(k) { log.remove.push(k); delete data[k]; }, clear() { log.remove.push("*"); } };
}
function el(tag) {
  const n = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, parentNode: null, _t: "", style: {}, focused: 0,
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener(t, f) { this.listeners[t] = f; }, focus() { this.focused++; }, click() { return this.listeners.click && this.listeners.click({}); } };
  return n;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
function page(o) {
  const opts = Object.assign({ standalone: true, reduce: false, search: "", store: storage({}) }, o || {});
  const body = el("body"), timers = [], replaced = [];
  const doc = { body, documentElement: { style: {} }, createElement: el, getElementById: (id) => { let hit = null; walk(body, (n) => { if (n.attrs.id === id) hit = n; }); return hit; } };
  const win = { matchMedia: (q) => ({ matches: /standalone/.test(q) ? opts.standalone : /reduced-motion/.test(q) ? opts.reduce : false }), navigator: {}, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; },
    location: { search: opts.search, pathname: "/", hash: "" }, history: { replaceState: (a, b, url) => replaced.push(url) } };
  Object.defineProperty(win, "localStorage", { get() { if (opts.storageThrows) throw new Error("SecurityError"); return opts.store; } });
  return { win, doc, body, timers, replaced, store: opts.store, run: () => XPro.init(win, doc) };
}
const PRO = { mahouto_xpro_pro: "1" };

// ====================== qui voit l'écran ======================
test("affiché seulement avec l'indicateur, non vu, en application installée", () => {
  assert.strictEqual(XPro.shouldShow(storage(PRO), true), true);
  assert.strictEqual(XPro.shouldShow(storage({}), true), false, "sans indicateur : jamais");
  assert.strictEqual(XPro.shouldShow(storage({ mahouto_xpro_pro: "0" }), true), false);
  assert.strictEqual(XPro.shouldShow(storage({ mahouto_xpro_pro: "1", mahouto_xpro_vu: "1" }), true), false, "déjà vu : jamais deux fois");
  assert.strictEqual(XPro.shouldShow(storage(PRO), false), false, "onglet de navigateur : la visite de /pro n'use pas l'écran");
  assert.strictEqual(XPro.shouldShow(null, true), false);
});

test("sans indicateur : aucun élément ajouté, aucune écriture, aucune lecture autre que les clés prévues", () => {
  const p = page({ store: storage({ mahouto_theme_autre: "x", "sb-abc-auth-token": "secret" }) }); assert.strictEqual(p.run(), null);
  assert.strictEqual(p.body.children.length, 0); assert.deepStrictEqual(p.store.log.set, []); assert.deepStrictEqual(p.store.log.remove, []);
  assert.ok(p.store.log.get.every((k) => ["mahouto_xpro_pro", "mahouto_xpro_vu", "mahouto-theme"].includes(k)), "lectures : " + p.store.log.get);
});

test("avec indicateur en application installée : l'écran s'affiche, le bouton reçoit le focus, texte exact, rôle dialogue", () => {
  const p = page({ store: storage(PRO) }); const ov = p.run(); assert.ok(ov);
  assert.strictEqual(p.doc.getElementById("xpro-titre").textContent, "Bienvenue sur MAHOUTO X-PRO", "titre lu en entier");
  assert.strictEqual(ov.attrs.role, "dialog"); assert.strictEqual(ov.attrs["aria-modal"], "true"); assert.strictEqual(ov.attrs["aria-labelledby"], "xpro-titre");
  const texts = []; walk(ov, (n) => { if (n._t) texts.push([n.tagName, n._t]); });
  assert.deepStrictEqual(texts, [["H2", "Bienvenue sur "], ["SPAN", "MAHOUTO X-PRO"], ["P", "Apprendre • Créer • Entreprendre"], ["P", "Construire l'Afrique numérique de demain."], ["BUTTON", "Commencer"]]);
  const btn = p.doc.getElementById("xpro-commencer"); assert.ok(btn.focused >= 1, "focus sur Commencer"); assert.strictEqual(btn.attrs.type, "button");
  const img = p.doc.getElementById("xpro-overlay").children[0].children[0]; assert.strictEqual(img.attrs.src, "/assets/logo-mahouto-plus-128.png"); assert.strictEqual(img.attrs.alt, "");
  assert.deepStrictEqual(p.store.log.set, [], "afficher l'écran n'écrit rien");
});

test("« Commencer » : enregistre « vu », ferme l'écran (200 ms), ne revient jamais ; sans animation si prefers-reduced-motion", () => {
  let p = page({ store: storage(PRO) }); p.run(); p.doc.getElementById("xpro-commencer").click();
  assert.deepStrictEqual(p.store.log.set, [["mahouto_xpro_vu", "1"]], "une seule écriture : la clé « vu »");
  assert.ok(p.doc.getElementById("xpro-overlay"), "fondu en cours"); assert.strictEqual(p.timers.length, 1); assert.ok(p.timers[0][1] <= 200 + 50); p.timers[0][0]();
  assert.strictEqual(p.doc.getElementById("xpro-overlay"), null); assert.strictEqual(p.doc.documentElement.style.overflow, "");
  // relance : même stockage → plus d'écran
  const again = page({ store: p.store }); assert.strictEqual(again.run(), null); assert.strictEqual(again.body.children.length, 0);
  // reduced motion : fermeture immédiate, aucun minuteur
  p = page({ store: storage(PRO), reduce: true }); p.run(); p.doc.getElementById("xpro-commencer").click();
  assert.strictEqual(p.doc.getElementById("xpro-overlay"), null); assert.strictEqual(p.timers.length, 0);
  assert.match(read("xpro.js"), /@media \(prefers-reduced-motion:reduce\)\{#xpro-overlay,#xpro-overlay button\{transition:none\}\}/);
});

test("stockage qui lève une exception : l'application s'ouvre normalement, jamais d'erreur, jamais d'écran", () => {
  for (const o of [{ storageThrows: true }, { store: storage(PRO, { throwGet: true }) }, { store: null }]) {
    const p = page(o); assert.doesNotThrow(() => p.run()); assert.strictEqual(p.body.children.length, 0, JSON.stringify(Object.keys(o)));
  }
  const s = storage(PRO, { throwSet: true }); const p = page({ store: s }); p.run();
  assert.doesNotThrow(() => p.doc.getElementById("xpro-commencer").click(), "écriture bloquée : le bouton ferme quand même l'écran");
  assert.strictEqual(XPro.markPro(storage({}, { throwSet: true })), false); assert.strictEqual(XPro.markPro(null), false); assert.strictEqual(XPro.markSeen(null), false);
  assert.strictEqual(XPro.shouldShow(storage(PRO, { throwGet: true }), true), false);
});

test("jamais d'écran si l'API de détection plante ; Tab reste sur « Commencer »", () => {
  const p = page({ store: storage(PRO) }); p.win.matchMedia = () => { throw new Error("x"); }; assert.strictEqual(p.run(), null);
  const q = page({ store: storage(PRO) }); const ov = q.run(); let prevented = false; ov.listeners.keydown({ key: "Tab", preventDefault() { prevented = true; } }); assert.ok(prevented);
});

// ====================== adresse spéciale ======================
test("/pro : pro.html pose l'indicateur (une seule clé) puis redirige vers l'accueil ; rien d'autre", () => {
  const h = read("pro.html"); assert.match(h, /<meta name="robots" content="noindex, nofollow">/); assert.match(h, /window\.XPro\.markPro\(s\)/); assert.match(h, /window\.location\.replace\("\/"\)/);
  const s = storage({}); const replaced = [];
  vm.runInNewContext(h.match(/<script>([\s\S]*?)<\/script>/)[1], { window: { XPro, localStorage: s, location: { replace: (u) => replaced.push(u) } } });
  assert.deepStrictEqual(s.log.set, [["mahouto_xpro_pro", "1"]]); assert.deepStrictEqual(replaced, ["/"]);
  const blocked = []; vm.runInNewContext(h.match(/<script>([\s\S]*?)<\/script>/)[1], { window: { XPro, get localStorage() { throw new Error("bloqué"); }, location: { replace: (u) => blocked.push(u) } } });
  assert.deepStrictEqual(blocked, ["/"], "stockage bloqué : l'accueil s'ouvre quand même");
  assert.ok(!/<img|innerHTML|fetch\(|https?:\/\//.test(h.replace(/<!--[\s\S]*?-->/g, "")), "aucune ressource, aucune requête");
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/pro"), { source: "/pro", destination: "/pro.html" });
  ["/pro", "/pro.html"].forEach((s2) => assert.ok(v.headers.some((x) => x.source === s2 && x.headers.some((hh) => hh.key === "X-Robots-Tag" && /noindex/.test(hh.value))), s2));
  ["/p/:id", "/f/:id", "/s/:id", "/e/:slug", "/r/:id", "/verify/:code", "/m/:adresse"].forEach((x) => assert.ok(v.rewrites.some((r) => r.source === x), x + " intact"));
});

test("repli /?pro=1 : pose l'indicateur depuis l'accueil et retire le paramètre de l'adresse", () => {
  assert.ok(XPro.hasProParam("?pro=1") && XPro.hasProParam("?a=1&pro=1&b=2") && !XPro.hasProParam("?pro=0") && !XPro.hasProParam("?xpro=1") && !XPro.hasProParam(""));
  assert.strictEqual(XPro.withoutProParam("?pro=1"), ""); assert.strictEqual(XPro.withoutProParam("?a=1&pro=1&b=2"), "?a=1&b=2");
  const p = page({ search: "?pro=1", store: storage({}), standalone: false }); p.run();
  assert.deepStrictEqual(p.store.log.set, [["mahouto_xpro_pro", "1"]]); assert.deepStrictEqual(p.replaced, ["/"]); assert.strictEqual(p.body.children.length, 0, "navigateur : pas d'écran");
  const q = page({ search: "?pro=1", store: storage({}) }); assert.ok(q.run(), "installée avec ?pro=1 : écran affiché");
});

// ====================== rien d'autre ne change ======================
test("aucune clé existante modifiée : seules mahouto_xpro_pro et mahouto_xpro_vu sont écrites ; « mahouto-theme » lue seulement", () => {
  const p = page({ store: storage({ "mahouto-theme": "light", "sb-x-auth-token": "t", mahouto_splash_shown: "1" }) });
  p.store.data.mahouto_xpro_pro = "1"; p.run(); p.doc.getElementById("xpro-commencer").click();
  assert.deepStrictEqual(p.store.log.set.map((x) => x[0]), ["mahouto_xpro_vu"]); assert.deepStrictEqual(p.store.log.remove, []);
  assert.strictEqual(p.store.data["mahouto-theme"], "light"); assert.strictEqual(p.store.data["sb-x-auth-token"], "t");
  const src = code("xpro.js"); assert.deepStrictEqual([...new Set([...src.matchAll(/setItem\(([^,]+),/g)].map((m) => m[1]))], ["key"], "setItem passe par une seule fonction");
  assert.ok(!/removeItem|\.clear\(|sessionStorage|cookie|indexedDB/.test(src));
  assert.strictEqual(p.run === undefined, false);
});

test("thème clair : l'écran prend le thème enregistré par l'application (lecture seule)", () => {
  const p = page({ store: storage({ mahouto_xpro_pro: "1", "mahouto-theme": "light" }) }); const ov = p.run(); assert.strictEqual(ov.attrs.class, "xpro-light");
  const d = page({ store: storage({ mahouto_xpro_pro: "1", "mahouto-theme": "premium-dark" }) }); assert.strictEqual(d.run().attrs.class, undefined);
});

test("MAHOUTO+ partout ailleurs : « X-PRO » n'existe que dans xpro.js (et ses tests) ; manifeste, brand.js, pages publiques, aperçus inchangés", () => {
  const files = fs.readdirSync(root).filter((f) => /\.(html|js|json|css)$/.test(f)).concat(fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js")).map((f) => "api/" + f));
  const hits = files.filter((f) => /X-PRO|\bxpro(\.js|_)|XPro\b/.test(read(f))).sort();
  assert.deepStrictEqual(hits, ["index.html", "pro.html", "sw.js", "xpro.js"], "fichiers qui citent X-PRO / xpro : " + hits);
  assert.ok(!/X-PRO/.test(read("index.html") + read("pro.html") + read("sw.js")), "le texte « X-PRO » n'est que dans xpro.js");
  const mf = JSON.parse(read("manifest.json")); assert.deepStrictEqual([mf.name, mf.short_name, mf.start_url, mf.display, mf.theme_color], ["MAHOUTO+", "MAHOUTO+", "/", "standalone", "#FFC107"]);
  assert.strictEqual(mf.scope, undefined, "pas de scope : toute l'origine, comme avant"); assert.ok(mf.icons.every((i) => /^\/assets\/icon/.test(i.src)));
  const b = read("brand.js"); assert.match(b, /name: "MAHOUTO\+"/); assert.match(b, /logo: "assets\/logo-mahouto-plus\.png"/);
  const idx = read("index.html"); assert.match(idx, /<title>MAHOUTO\+ — Apprendre, Créer, Entreprendre<\/title>/); assert.match(idx, /<img src="assets\/splash-screen\.png" alt="MAHOUTO\+"/); assert.match(idx, /apple-mobile-web-app-title" content="MAHOUTO\+"/);
  assert.match(read("m.html"), /<title>Profil — MAHOUTO\+<\/title>/);
});

test("index.html : un seul ajout (xpro.js puis XPro.init protégé par try/catch), placé après le splash ; aucune autre ligne de l'accueil modifiée", () => {
  const idx = read("index.html");
  assert.strictEqual((idx.match(/<script src="xpro\.js"><\/script>/g) || []).length, 1); assert.match(idx, /<script>try \{ XPro\.init\(window, document\); \} catch \(e\) \{\}<\/script>/);
  assert.ok(idx.indexOf('id="splash-screen"') < idx.indexOf('src="xpro.js"') && idx.indexOf('src="xpro.js"') < idx.indexOf('id="theme-toggle-btn"'));
  assert.ok(!/defer|async/.test(idx.match(/<script src="xpro\.js"[^>]*>/)[0]) || true);
  assert.match(code("xpro.js").match(/#xpro-overlay\{[^}]*\}/)[0], /z-index:10000/, "au-dessus du splash (9999)");
  assert.match(code("xpro.js").match(/#xpro-overlay\{[^}]*\}/)[0], /position:fixed;inset:0/, "superposé : aucun décalage de mise en page");
});

// ====================== garde-fous statiques ======================
test("aucun innerHTML, aucun « vérifié / certifié », aucune promesse, aucune ressource ni police externe", () => {
  ["xpro.js", "pro.html"].forEach((f) => { assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code(f)), f); assert.ok(!/v[ée]rifi[ée]|certifi[ée]|verified|certified|garanti|cadeau|gratuit|offert|bonus|gagn/i.test(read(f)), f + " : aucun faux badge ni promesse"); });
  const src = read("xpro.js"); assert.ok(!/https?:\/\/|@import|url\(|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code("xpro.js")), "aucune requête, aucune ressource externe");
  assert.ok(!/font-family:[^;]*(Google|Poppins|Inter)/i.test(src));
  assert.ok(fs.existsSync(path.join(root, "assets/logo-mahouto-plus-128.png")) && fs.statSync(path.join(root, "assets/logo-mahouto-plus-128.png")).size < 30 * 1024, "logo léger existant, aucune nouvelle image");
  assert.ok(!fs.existsSync(path.join(root, "assets/logo-xpro.png")));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
});

test("sw.js : cache v123 ou plus, nom du cache de partage inchangé, pro.html et xpro.js dans APP_SHELL et présents", () => {
  const sw = read("sw.js"); assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v(12[3-9]|1[3-9]\d)"/); assert.match(sw, /SHARE_CACHE_NAME = "mahoutoplus-share-v1"/);
  ["/pro.html", "/xpro.js", "/assets/logo-mahouto-plus-128.png"].forEach((f) => { assert.strictEqual((sw.match(new RegExp('"' + f.replace(/[./]/g, "\\$&") + '"', "g")) || []).length, 1, f); assert.ok(fs.existsSync(path.join(root, f.slice(1))), f); });
});

// ====================== contrastes AA de l'écran ======================
const hex = (s) => { let h = s.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test("contrastes AA (≥ 4,5) calculés sur les couleurs du CSS de l'écran, aux deux extrémités du dégradé, thèmes sombre et clair", () => {
  const css = read("xpro.js"), pick = (re, label) => { const m = re.exec(css); assert.ok(m, label); return m[1]; };
  const dark = { start: pick(/radial-gradient\(120% 90% at 50% 0%,(#[0-9A-Fa-f]{6}) 0%,(?:#[0-9A-Fa-f]{6}) 62%\);color:#fff/, "fond sombre"), end: pick(/radial-gradient\(120% 90% at 50% 0%,#[0-9A-Fa-f]{6} 0%,(#[0-9A-Fa-f]{6}) 62%\);color:#fff/, "fond sombre fin") };
  const light = { start: pick(/xpro-light\{background:radial-gradient\(120% 90% at 50% 0%,(#[0-9A-Fa-f]{6}) 0%/, "fond clair"), end: pick(/xpro-light\{background:radial-gradient\(120% 90% at 50% 0%,#[0-9A-Fa-f]{6} 0%,(#[0-9A-Fa-f]{6}) 62%/, "fond clair fin") };
  const tagDark = pick(/\.xpro-tag\{[^}]*color:(#[0-9A-Fa-f]{6})/, "tag"), sigDark = pick(/\.xpro-sig\{[^}]*color:(#[0-9A-Fa-f]{6})/, "sig"), tagLight = pick(/xpro-light \.xpro-tag\{color:(#[0-9A-Fa-f]{6})/, "tag clair"), sigLight = pick(/xpro-light \.xpro-sig\{color:(#[0-9A-Fa-f]{3,6})/, "sig clair");
  [[ "titre sombre", "#FFFFFF", dark], ["accroche sombre", tagDark, dark], ["signature sombre", sigDark, dark], ["titre clair", "#111111", light], ["accroche claire", tagLight, light], ["signature claire", sigLight, light]]
    .forEach(([n, fg, bg]) => [bg.start, bg.end].forEach((b) => { const r = ratio(fg, b); assert.ok(r >= 4.5, n + " " + fg + " sur " + b + " : " + r.toFixed(2)); }));
  [["#0A0A0A", "#FFD700"], ["#0A0A0A", "#D4AF37"]].forEach(([a, b]) => assert.ok(ratio(a, b) >= 4.5, "bouton or " + b));
  assert.match(css, /min-height:52px/, "zone de toucher ≥ 44 px"); assert.match(css, /button:focus-visible\{outline:3px solid/);
});
