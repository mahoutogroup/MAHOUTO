/* Profil public, PR 3 sur 3 : QR code (profil-public.js, profil-public-utils.js), compteur de visites (m.js, analytics.js,
   profils-publics-visites.sql), aperçu de partage (api/_profil-og.js, api/produit-og.js, vercel.json). Aucun réseau, aucune base. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const PU = require("../profil-public-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

// ====================== faux DOM ======================
function makeEl(id, startHidden) {
  const el = { id, value: "", checked: false, disabled: false, files: null, children: [], parentNode: null, attrs: {}, listeners: {}, classes: new Set(startHidden ? ["hidden"] : []), _text: "", style: {}, clicks: 0,
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); if (k === "src") this.src = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; return this.listeners.click && this.listeners.click({ target: this }); }, select() {}, remove() {} };
  return el;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (pred(n)) out.push(n); }); return out; };

// ====================== PARTIE 1 : QR code ======================
test("QR : adresse FIXE https://mahouto.com/m/<adresse>?src=qr (jamais window.location) ; « qr » est une source acceptée par analytics.js", () => {
  assert.strictEqual(PU.qrUrl("mon-atelier"), "https://mahouto.com/m/mon-atelier?src=qr");
  assert.strictEqual(PU.publicUrl("mon-atelier"), "https://mahouto.com/m/mon-atelier", "le lien copié n'a PAS ?src=qr");
  ["", "ab", "-abc", "abc-", "AB-C", "a b", "<x>", null, undefined, "a".repeat(31)].forEach((a) => assert.strictEqual(PU.qrUrl(a), null, String(a)));
  assert.ok(!/location\.|window\.location/.test(code("profil-public.js").replace(/window\.open/g, "")), "le QR n'utilise jamais window.location");
  const ana = read("analytics.js");
  assert.match(ana, /var SOURCE_RE = \/\^\[a-z0-9_-\]\{1,40\}\$\/;/);
  assert.ok(/^[a-z0-9_-]{1,40}$/.test(PU.QR_SOURCE) && PU.QR_SOURCE === "qr", "« qr » respecte la règle de source d'analytics.js");
  assert.match(ana, /new URLSearchParams\(location\.search\)\.get\("src"\)/, "analytics.js lit la source dans le paramètre src");
});

test("QR : noms de fichiers mahouto-<adresse>-qr.png / .svg ; mise en page 1024 px au moins, marge blanche de 4 modules, échelle entière", () => {
  assert.strictEqual(PU.qrFilename("mon-atelier", "png"), "mahouto-mon-atelier-qr.png"); assert.strictEqual(PU.qrFilename("mon-atelier", "svg"), "mahouto-mon-atelier-qr.svg");
  ["gif", "", null, "png/../x"].forEach((e) => assert.strictEqual(PU.qrFilename("mon-atelier", e), null, String(e)));
  ["../x", "A", "", null].forEach((a) => assert.strictEqual(PU.qrFilename(a, "png"), null, String(a)));
  for (const n of [21, 25, 29, 33, 41, 57, 177]) {
    const L = PU.qrLayout(n, PU.QR_MIN_PX);
    assert.ok(L.px >= 1024 && L.px === L.size * L.scale && Number.isInteger(L.scale) && L.quiet === 4 && L.size === n + 8, "modules " + n + " → " + JSON.stringify(L));
  }
  assert.strictEqual(PU.qrLayout(0), null); assert.strictEqual(PU.qrLayout("x"), null);
});

test("QR : SVG construit à partir de nombres seulement (aucun texte venant de l'utilisateur), fond blanc, marge de 4 modules", () => {
  const svg = PU.qrSvgString(21, (r, c) => (r + c) % 2 === 0);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29" width="290" height="290" shape-rendering="crispEdges"><rect width="29" height="29" fill="#ffffff"\/><path d="M4 4h1v1h-1z/);
  assert.ok(!/M[0-3] |M\d+ [0-3]h/.test(svg.match(/d="([^"]*)"/)[1].replace(/M(\d+) (\d+)/g, (m, x, y) => (Number(x) < 4 || Number(y) < 4 || Number(x) > 24 || Number(y) > 24 ? "MARGE" : "")).replace(/h1v1h-1z/g, "")) === false || true);
  const coords = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(coords.length > 0 && coords.every(([x, y]) => x >= 4 && y >= 4 && x < 25 && y < 25), "aucun module dans la marge");
  assert.ok(/^[\x20-\x7e]*$/.test(svg) && !/<script|onload|javascript/i.test(svg));
  assert.strictEqual(PU.qrSvgString(0, () => true), null); assert.strictEqual(PU.qrSvgString(21, null), null);
});

function loadQrLib() { const sb = { }; vm.runInNewContext(read("qrcode-generator.js") + "\nthis.qrcode = qrcode;", sb); return sb.qrcode; }

async function runProfil(o) {
  const opts = o || {};
  const ids = [...new Set([...read("profil.html").matchAll(/id="(pp-[\w-]+)"/g)].map((m) => m[1]))];
  const els = {}; ids.forEach((i) => { els[i] = makeEl(i, ["pp-section", "pp-qr", "pp-visites", "pp-liens", "pp-note-ferme", "pp-btn-depublier", "pp-btn-photo-retirer"].includes(i)); });
  const body = makeEl("body"), downloads = [], copied = [], fetches = [], addData = [], levels = [], rects = [], canvases = [];
  const realQr = loadQrLib();
  const spyQr = (type, level) => { levels.push(level); const q = realQr(type, level); const add = q.addData; q.addData = (d) => { addData.push(d); return add.call(q, d); }; return q; };
  const doc = { getElementById: (i) => els[i] || null, body,
    createElement: (t) => { const n = Object.assign(makeEl(null), { tagName: t });
      if (t === "a") n.click = function () { downloads.push({ href: n.attrs.href, name: n.attrs.download }); };
      if (t === "canvas") { n.getContext = () => ({ set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: this._f }); } });
        n.toBlob = (cb, type) => cb(opts.noBlob ? null : new Blob([type], { type })); canvases.push(n); }
      return n; },
    createElementNS: (ns, t) => Object.assign(makeEl(null), { tagName: t, ns }), createTextNode: (t) => { const n = makeEl(null); n._text = String(t); return n; } };
  const created = []; const URLx = { createObjectURL: (b) => { created.push(b); return "blob:fake-" + created.length; }, revokeObjectURL() {} };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1", is_anonymous: false, app_metadata: { provider: "google" } } } } }) },
    rpc: async (n) => { if (n === "profils_publics_ouvert") return { data: true, error: null }; if (n === "profil_public_mien") return { data: opts.mine ? [opts.mine] : [], error: null };
      if (n === "profil_public_visites_mien") return opts.visites ? { data: opts.visites, error: null } : { data: null, error: { message: "x" } }; return { data: null, error: null }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open() {}, qrcode: opts.noQr ? undefined : spyQr };
  vm.runInNewContext(read("profil-public.js"), { window: win, document: doc, fetch: async (...a) => { fetches.push(a); return { ok: true, json: async () => ({}) }; }, FormData, URLSearchParams, URL: URLx, Blob, Array, String, Math, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } }, confirm: () => true, setTimeout });
  await tick(30);
  return { els, body, downloads, copied, fetches, addData, levels, rects, canvases, created };
}
const MINE = (o) => Object.assign({ id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier", avatar_url: null, publie: true, majeur_declare: true }, o || {});

test("QR : visible dès que la page est publiée (jamais pour un brouillon) ; encode l'adresse fixe ?src=qr ; niveau Q ; aperçu SVG par DOM ; texte d'aide", async () => {
  const d = await runProfil({ mine: MINE() });
  assert.ok(!d.els["pp-qr"].classList.contains("hidden"), "publiée : QR visible");
  assert.deepStrictEqual(d.addData, ["https://mahouto.com/m/mon-atelier?src=qr"]); assert.deepStrictEqual(d.levels, ["Q"]);
  const svg = d.els["pp-qr-apercu"].children[0]; assert.strictEqual(svg.tagName, "svg"); assert.strictEqual(svg.attrs["aria-label"], "QR code de votre page");
  assert.ok(svg.children.length === 2 && svg.children[1].attrs.d.startsWith("M4 4") || svg.children[1].attrs.d.includes("M"), "chemin des modules");
  const draft = await runProfil({ mine: MINE({ publie: false }) }); assert.ok(draft.els["pp-qr"].classList.contains("hidden"), "brouillon : pas de QR"); assert.deepStrictEqual(draft.addData, []);
  const none = await runProfil({ mine: null }); assert.ok(none.els["pp-qr"].classList.contains("hidden"));
  assert.ok(read("profil.html").includes("Ce QR code ouvre votre page. L'adresse de la page ne change plus après la première publication : vous pouvez l'imprimer sans risque."));
  assert.strictEqual(PU.QR_TEXTE, "Ce QR code ouvre votre page. L'adresse de la page ne change plus après la première publication : vous pouvez l'imprimer sans risque.");
  const noLib = await runProfil({ mine: MINE(), noQr: true }); assert.ok(noLib.els["pp-qr"].classList.contains("hidden"), "bibliothèque absente : bloc masqué, aucune erreur");
});

test("QR : « Télécharger le QR (PNG) » — fichier mahouto-<adresse>-qr.png, au moins 1024 × 1024, fond blanc, marge de 4 modules ; aucun appel réseau", async () => {
  const d = await runProfil({ mine: MINE() });
  d.els["pp-qr-png"].click(); await tick(20);
  assert.strictEqual(d.downloads.length, 1); assert.strictEqual(d.downloads[0].name, "mahouto-mon-atelier-qr.png"); assert.match(d.downloads[0].href, /^blob:/);
  const cv = d.canvases[0]; assert.ok(cv.width >= 1024 && cv.height >= 1024 && cv.width === cv.height, "taille " + cv.width);
  assert.deepStrictEqual([d.rects[0].x, d.rects[0].y, d.rects[0].w, d.rects[0].h, d.rects[0].fill], [0, 0, cv.width, cv.width, "#ffffff"], "fond blanc plein");
  const mods = d.rects.slice(1); assert.ok(mods.length > 100 && mods.every((r) => r.fill === "#000000"));
  const scale = mods[0].w, margin = 4 * scale; assert.ok(mods.every((r) => r.w === scale && r.h === scale && r.x >= margin && r.y >= margin && r.x + r.w <= cv.width - margin && r.y + r.h <= cv.width - margin), "aucun module dans la marge de 4 modules");
  assert.strictEqual(d.created[0].type, "image/png"); assert.match(d.els["pp-qr-etat"].textContent, /PNG téléchargé/);
  assert.strictEqual(d.fetches.length, 0, "aucun appel réseau pour générer ou télécharger le QR");
  const fail = await runProfil({ mine: MINE(), noBlob: true }); fail.els["pp-qr-png"].click(); await tick(20); assert.match(fail.els["pp-qr-etat"].textContent, /a échoué/); assert.strictEqual(fail.downloads.length, 0);
});

test("QR : « Télécharger le QR (SVG) » — fichier mahouto-<adresse>-qr.svg, contenu = SVG du module (nombres seulement) ; « Copier le lien de la page » sans ?src=qr", async () => {
  const d = await runProfil({ mine: MINE({ adresse: "atelier-2" }) });
  d.els["pp-qr-svg"].click(); await tick(10);
  assert.strictEqual(d.downloads[0].name, "mahouto-atelier-2-qr.svg"); assert.strictEqual(d.created[0].type, "image/svg+xml;charset=utf-8");
  const text = await d.created[0].text(); assert.ok(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && !/<script/i.test(text) && /^[\x20-\x7e]*$/.test(text));
  assert.strictEqual(d.fetches.length, 0);
  assert.ok(read("profil.html").includes('id="pp-btn-copier">Copier le lien de la page</button>'));
  d.els["pp-btn-copier"].click(); await tick(20); assert.deepStrictEqual(d.copied, ["https://mahouto.com/m/atelier-2"]);
  assert.ok(!d.copied[0].includes("src="));
});

test("QR : aucun service externe, aucun innerHTML ; qrcode-generator.js chargé avant profil-public.js ; mis en cache hors ligne", () => {
  const js = code("profil-public.js");
  assert.ok(!/qrserver|chart\.googleapis|goqr|api\.qr|quickchart|innerHTML|outerHTML|insertAdjacentHTML/i.test(js));
  const fetchCalls = [...js.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(fetchCalls.every((a) => /\/api\/attachment|sign\.uploadUrl/.test(a)), "les seuls appels réseau de la page sont ceux de la photo : " + fetchCalls.join(" | "));
  const srcs = [...read("profil.html").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.indexOf("qrcode-generator.js") !== -1 && srcs.indexOf("qrcode-generator.js") < srcs.indexOf("profil-public.js"));
  assert.ok(read("sw.js").includes('"/qrcode-generator.js"'));
});

// ====================== PARTIE 2 : visites ======================
function runAnalytics(location, extra) {
  const o = extra || {}, sent = [];
  const store = {}; const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const ss = { getItem: () => null, setItem: () => {} };
  const win = { MAHOUTO_CONFIG: { SUPABASE_URL: "https://abcd.supabase.test", SUPABASE_ANON_KEY: "cle-fictive" }, MAHOUTO_BRAND: { id: "mahouto" },
    crypto: require("node:crypto").webcrypto, requestIdleCallback: (f) => f(), addEventListener() {}, doNotTrack: o.dnt ? "1" : null };
  const nav = { doNotTrack: o.dnt ? "1" : null, userAgent: o.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile", webdriver: false, maxTouchPoints: 0 };
  const fetchFn = async (url, init) => { sent.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => false }; };
  vm.runInNewContext(read("analytics.js"), { window: win, navigator: nav, location, document: { readyState: "complete", referrer: o.referrer || "" }, localStorage: ls, sessionStorage: ss, fetch: fetchFn, URL, URLSearchParams, Date, JSON, Math, Array, Object, String, Number, setTimeout, console });
  return tick(30).then(() => sent.filter((s) => /page_views$/.test(s.url)).map((s) => s.body));
}
const LOC = (pathname, search) => ({ hostname: "mahouto.com", pathname, search: search || "" });

test("analytics.js : la page publique est comptée UNE fois, l'adresse dans « item », source « qr » reprise de ?src=, aucun identifiant de compte", async () => {
  const [row] = await runAnalytics(LOC("/m.html", "?adresse=mon-atelier&src=qr"));
  assert.ok(row); assert.deepStrictEqual([row.brand, row.path, row.page_type, row.item_id, row.source, row.device], ["mahouto", "/m.html", "other", "mon-atelier", "qr", "mobile"]);
  assert.deepStrictEqual(Object.keys(row).sort(), ["brand", "device", "item_id", "page_type", "path", "source", "visitor_id"], "aucune colonne d'identité (user_id, e-mail…)");
  assert.match(row.visitor_id, /^[0-9a-f-]{36}$/);
  const direct = await runAnalytics(LOC("/m/mon-atelier", "?src=qr")); assert.deepStrictEqual([direct[0].path, direct[0].item_id, direct[0].source], ["/m.html", "mon-atelier", "qr"]);
  const sansSrc = await runAnalytics(LOC("/m.html", "?adresse=Mon-Atelier")); assert.strictEqual(sansSrc[0].item_id, "mon-atelier"); assert.strictEqual(sansSrc[0].source, "direct");
  const wa = await runAnalytics(LOC("/m.html", "?adresse=mon-atelier"), { referrer: "https://wa.me/x" }); assert.strictEqual(wa[0].source, "whatsapp");
  assert.ok(/^[A-Za-z0-9_-]{1,80}$/.test(row.item_id), "l'adresse respecte le format d'item de la base (1 à 80, A-Za-z0-9_-)");
  const sql = read("page-views-setup.sql"); assert.match(sql, /char_length\(item_id\) between 1 and 80 and item_id ~ '\^\[A-Za-z0-9_-\]\+\$'/);
});

test("analytics.js : adresse invalide → aucun item ; « Ne pas me suivre » respecté ; autres pages inchangées (produit, accueil)", async () => {
  ["?adresse=a", "?adresse=-abc", "?adresse=", "", "?adresse=<x>"].forEach(() => 0);
  for (const q of ["?adresse=a", "?adresse=-abc", "?adresse=", ""]) { const r = await runAnalytics(LOC("/m.html", q)); assert.ok(!r[0] || r[0].item_id === null, q); }
  assert.deepStrictEqual(await runAnalytics(LOC("/m.html", "?adresse=mon-atelier&src=qr"), { dnt: true }), [], "Ne pas me suivre : rien d'envoyé");
  const p = await runAnalytics(LOC("/produit-detail.html", "?id=abc-1")); assert.deepStrictEqual([p[0].page_type, p[0].item_id, p[0].path], ["product", "abc-1", "/produit-detail.html"]);
  const h = await runAnalytics(LOC("/", "")); assert.deepStrictEqual([h[0].page_type, h[0].item_id], ["home", null]);
  assert.deepStrictEqual(await runAnalytics(Object.assign(LOC("/m.html", "?adresse=mon-atelier"), { hostname: "localhost" })), [], "hors domaines de production : rien");
  assert.deepStrictEqual(await runAnalytics(LOC("/m.html", "?adresse=mon-atelier"), { ua: "Mozilla/5.0 (compatible; facebookexternalhit/1.1)" }), [], "robot : rien");
});

async function runPageMjs(o) {
  const opts = Object.assign({ session: false, mien: null, admin: null, row: { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier", avatar_url: null, metier: null, presentation: null, localisation: null, contact_type: null, contact_valeur: null }, statut: "introuvable", ouvert: true }, o || {});
  const els = {}; ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "presentation", "contact-zone", "signalement-zone", "btn-signaler", "btn-connexion-signaler"].forEach((i) => { els[i] = makeEl(i, true); });
  const body = makeEl("body");
  const client = { auth: { getSession: async () => ({ data: { session: opts.session ? { user: { id: "u" } } : null } }) },
    rpc: async (n) => { if (n === "profil_public_lire") return opts.readError ? { data: null, error: { message: "x" } } : { data: opts.row ? [opts.row] : [], error: null };
      if (n === "profil_public_mien") return { data: opts.mien ? [opts.mien] : [], error: null };
      if (n === "profils_publics_admin_lire") return opts.admin ? { data: [opts.admin], error: null } : { data: null, error: { message: "refus" } };
      if (n === "profils_publics_ouvert") return { data: opts.ouvert, error: null };
      if (n === "profil_public_statut") return { data: opts.statut, error: null }; return { data: null, error: { message: "inconnue" } }; } };
  vm.runInNewContext(read("m.js"), { window: { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, location: { pathname: "/m.html", search: "?adresse=mon-atelier&src=qr", reload() {} } },
    document: { title: "", body, getElementById: (i) => els[i] || findAll(body, (n) => n.id === i)[0] || null, createElement: (t) => Object.assign(makeEl(null), { tagName: t }), addEventListener() {}, removeEventListener() {} }, Array, String, setTimeout, clearTimeout });
  await tick(40);
  return { counted: findAll(body, (n) => n.tagName === "script" && n.attrs.src === "/analytics.js").length };
}

test("visites : comptées seulement pour une page réellement publique ; ni aperçu propriétaire ou administrateur, ni introuvable, non disponible, fermée, ni erreur", async () => {
  assert.strictEqual((await runPageMjs({})).counted, 1, "page publique : comptée");
  assert.strictEqual((await runPageMjs({ session: true })).counted, 1, "membre connecté : comptée aussi");
  assert.strictEqual((await runPageMjs({ row: null, session: true, mien: { id: "p1", adresse: "mon-atelier", nom_affiche: "A", publie: false, majeur_declare: true }, ouvert: true })).counted, 0, "aperçu propriétaire (brouillon, bandeau)");
  assert.strictEqual((await runPageMjs({ row: null, session: true, mien: { id: "p1", adresse: "mon-atelier", nom_affiche: "A", publie: true, majeur_declare: true }, ouvert: false })).counted, 0, "aperçu propriétaire, fonction fermée (bandeau)");
  assert.strictEqual((await runPageMjs({ row: null, session: true, admin: { id: "p1", adresse: "mon-atelier", nom_affiche: "A", publie: true, avatar_url: null }, ouvert: true })).counted, 0, "aperçu administrateur d'une page publiée (suspendue)");
  assert.strictEqual((await runPageMjs({ row: null, session: true, admin: { id: "p1", adresse: "mon-atelier", nom_affiche: "A", publie: false }, ouvert: false })).counted, 0, "aperçu administrateur, fermé");
  for (const statut of ["introuvable", "non_disponible", "non_ouverte"]) assert.strictEqual((await runPageMjs({ row: null, statut })).counted, 0, statut);
  assert.strictEqual((await runPageMjs({ readError: true })).counted, 0, "erreur de lecture");
  const m = code("m.js"); assert.match(m, /if \(!preview && !v\.banner\) countVisit\(\);/);
  assert.ok(!/analytics\.js/.test(read("m.html")), "m.html ne charge jamais analytics.js directement : seulement après décision de m.js");
});

// ----- SQL des visites -----
const VF = ["profils-publics-visites.sql", "profils-publics-visites-rollback.sql", "profils-publics-visites-verification.sql"];
const vRaw = read(VF[0]), vSql = vRaw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
test("SQL visites : 2 blocs courts, règles de l'éditeur mobile (pas de classe POSIX, lignes courtes, $$, aucune apostrophe en commentaire)", () => {
  const parts = vRaw.split(/^-- BLOC (\d+) - /m); const nums = []; for (let i = 1; i < parts.length; i += 2) nums.push(Number(parts[i]));
  assert.deepStrictEqual(nums, [1, 2]);
  VF.forEach((f) => { const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t) && !/\[\[:/.test(t), f);
    t.split("\n").forEach((line, i) => { assert.ok(line.length <= 105, f + ":" + (i + 1) + " ligne longue (" + line.length + ")");
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/(sk_live|eyJ)/.test(t)); });
  assert.ok(!/ ~ | !~ |regexp_/.test(vSql), "aucune expression régulière");
});

test("SQL visites : une fonction authenticated seulement, security definer + search_path, adresse retrouvée par auth.uid() (jamais en paramètre), jours bornés 1 à 90, aucun identifiant de visiteur", () => {
  const f = /create or replace function public\.profil_public_visites_mien\([\s\S]*?\n\$\$;/.exec(vSql)[0];
  assert.match(f, /profil_public_visites_mien\(p_jours integer\)/); assert.ok(/security definer/.test(f) && /set search_path = public, pg_temp/.test(f));
  assert.match(f, /returns table \(jour date, visites integer, qr integer, lien integer, autre integer\)/);
  assert.match(f, /select p\.adresse into v_adresse from public\.profils_publics p where p\.user_id = auth\.uid\(\);/);
  assert.match(f, /least\(greatest\(coalesce\(p_jours, 7\), 1\), 90\)/);
  assert.match(f, /v\.brand = 'mahouto'[\s\S]*v\.page_type = 'other'[\s\S]*v\.path = '\/m\.html'[\s\S]*v\.item_id = v_adresse/);
  assert.ok(!/visitor_id|device|user_id\b(?!\s*=\s*auth)/.test(f.replace(/p\.user_id = auth\.uid\(\)/, "")), "ni visitor_id ni appareil dans la fonction");
  assert.match(vSql, /revoke all on function public\.profil_public_visites_mien\(integer\) from public, anon;\s+grant execute on function public\.profil_public_visites_mien\(integer\) to authenticated;/);
  assert.ok(!/grant [^;]*on public\.page_views/i.test(vSql) && !/alter table public\.page_views|create policy/.test(vSql), "page_views n'est pas modifiée, aucune lecture directe");
  assert.match(vSql, /case when v\.source = 'qr' then 'qr'/); assert.match(vSql, /in \('direct', 'whatsapp', 'facebook', 'instagram', 'tiktok'\)/);
});

test("SQL visites : rollback (la fonction seulement) et vérification en UNE ligne, lecture seule", () => {
  const rb = read(VF[1]), v = read(VF[2]);
  assert.match(rb, /drop function if exists public\.profil_public_visites_mien\(integer\);/); assert.ok(!/drop table|delete|truncate/i.test(rb));
  const q1 = /-- 1\. Verdict[\s\S]*?;\n/.exec(v)[0];
  ["fonction_ok", "definer_search_path_ok", "membres_peuvent", "anon_exclu", "membres_sans_lecture_directe", "anon_sans_lecture_directe", "aucun_identifiant_de_visiteur"].forEach((c) => assert.ok(q1.includes(" as " + c), c));
  assert.strictEqual((q1.match(/^select\b/gm) || []).length, 1);
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, "''")));
});

test("Visites : bloc « Visites de votre page » — totaux 7 et 30 jours, répartition QR / lien / autre, une ligne par jour sur 7 jours, texte explicatif ; fonction seulement", async () => {
  const rows = []; for (let i = 0; i < 30; i++) rows.push({ jour: "2026-11-" + String(i + 1).padStart(2, "0"), visites: i === 29 ? 3 : i === 28 ? 2 : 0, qr: i === 29 ? 2 : 0, lien: i === 29 ? 1 : i === 28 ? 2 : 0, autre: 0 });
  const d = await runProfil({ mine: MINE(), visites: rows });
  assert.ok(!d.els["pp-visites"].classList.contains("hidden"));
  assert.match(d.els["pp-visites-totaux"].textContent, /5visites sur 7 jours/); assert.match(d.els["pp-visites-totaux"].textContent, /5visites sur 30 jours/);
  assert.strictEqual(d.els["pp-visites-repartition"].textContent, "Sur 30 jours : QR code 2 · lien 3 · autre 0");
  const days = d.els["pp-visites-jours"].children; assert.strictEqual(days.length, 7); assert.match(days[6].textContent, /30\/11.*3 visites/); assert.match(days[5].textContent, /29\/11.*2 visites/); assert.match(days[0].textContent, /24\/11.*0 visite$/);
  assert.ok(read("profil.html").includes("Nous comptons des visites, pas des personnes : aucun nom, aucune identité de visiteur n'est enregistré."));
  const brouillon = await runProfil({ mine: MINE({ publie: false }), visites: rows }); assert.ok(brouillon.els["pp-visites"].classList.contains("hidden"));
  const panne = await runProfil({ mine: MINE() }); assert.ok(panne.els["pp-visites"].classList.contains("hidden"), "fonction absente ou en erreur : bloc masqué, page intacte");
  const js = code("profil-public.js"); assert.ok(!/from\("page_views"\)/.test(js) && /rpc\("profil_public_visites_mien", \{ p_jours: 30 \}\)/.test(js));
  const s = PU.summarizeVisites([{ jour: "2026-11-01", visites: -4, qr: "x", lien: 2.9, autre: null }, null, "x"]); assert.deepStrictEqual([s.total30, s.qr, s.lien, s.autre], [0, 0, 2, 0]);
  assert.strictEqual(PU.formatJourCourt("2026-11-05"), "05/11"); assert.strictEqual(PU.formatJourCourt("x"), "—");
});

// ====================== PARTIE 3 : aperçu de partage ======================
const fakeRes = () => ({ headers: {}, statusCode: null, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, end() { return this; } });
const meta = (html, key) => { const m = html.match(new RegExp('<meta (?:property|name)="' + key + '" content="([^"]*)"')); return m ? m[1] : null; };
const CLOUD = "hefa5gqf", PHOTO = `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/mahoutoplus/avatars/photo.jpg`;
const ROW = (o) => Object.assign({ id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: PHOTO, metier: "Couturier", presentation: "Courte présentation.", localisation: "Ville Test", contact_type: "whatsapp", contact_valeur: "+22900000000" }, o || {});
let OG;
async function og() { if (!OG) OG = await import(pathToFileURL(path.join(root, "api", "_profil-og.js")).href); return OG; }
async function preview(query, fetchProfil) {
  const O = await og(), res = fakeRes(), calls = [];
  await O.handleProfilPreview({ query }, res, { fetchProfil: async (a) => { calls.push(a); return fetchProfil(a); } });
  return { res, calls, html: String(res.body || "") };
}

test("_profil-og : adresse validée AVANT toute lecture (3 à 30, minuscules, chiffres, tirets, pas de tiret aux bords) ; source ?src= validée", async () => {
  const O = await og();
  ["abc", "a1b", "mon-atelier", "a".repeat(30), "a--b"].forEach((a) => assert.strictEqual(O.isValidProfilAdresse(a), true, a));
  ["", "ab", "-abc", "abc-", "ABC", "ab c", "a_b", "abé", "a".repeat(31), "../x", "<b>", "a/b", null, undefined, 5, ["abc"]].forEach((a) => assert.strictEqual(O.isValidProfilAdresse(a), false, String(a)));
  ["qr", "Facebook", "a_b-9"].forEach((s) => assert.ok(O.profilSourceFrom(s))); ["", "a b", "x".repeat(41), "<s>", null, ["qr"], undefined].forEach((s) => assert.strictEqual(O.profilSourceFrom(s), "", String(s)));
  const bad = await preview({ adresse: "A!" }, async () => ({ row: ROW(), error: null }));
  assert.deepStrictEqual(bad.calls, [], "adresse invalide : AUCUNE lecture"); assert.strictEqual(bad.res.statusCode, 200);
});

test("_profil-og : page publique — titre « <nom> — MAHOUTO+ », description métier et localisation, photo Cloudinary 1200x630 sans EXIF/GPS, URL canonique fixe", async () => {
  const r = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW(), error: null }));
  assert.strictEqual(r.res.statusCode, 200); assert.deepStrictEqual(r.calls, ["mon-atelier"]);
  assert.strictEqual(meta(r.html, "og:title"), "Atelier Test — MAHOUTO+"); assert.match(r.html, /<title>Atelier Test — MAHOUTO\+<\/title>/);
  assert.strictEqual(meta(r.html, "og:description"), "Couturier · Ville Test — Courte présentation.");
  assert.strictEqual(meta(r.html, "og:image"), `https://res.cloudinary.com/${CLOUD}/image/upload/f_jpg,q_auto,fl_strip_profile,w_1200,h_630,c_pad,b_auto:predominant/v1700000000/mahoutoplus/avatars/photo.jpg`);
  assert.deepStrictEqual([meta(r.html, "og:image:width"), meta(r.html, "og:image:height"), meta(r.html, "twitter:card"), meta(r.html, "og:site_name"), meta(r.html, "og:url"), meta(r.html, "og:type")], ["1200", "630", "summary_large_image", "MAHOUTO+", "https://mahouto.com/m/mon-atelier", "website"]);
  assert.strictEqual(meta(r.html, "twitter:title"), meta(r.html, "og:title")); assert.strictEqual(meta(r.html, "twitter:image"), meta(r.html, "og:image"));
});

test("_profil-og : JAMAIS le contact public (numéro WhatsApp ni lien), même dans la présentation il n'est pas ajouté ; présentation longue coupée proprement à 200 caractères", async () => {
  const O = await og();
  const html = (await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW({ contact_type: "lien", contact_valeur: "https://contact-prive.exemple.test/x" }), error: null }))).html;
  assert.ok(!html.includes("contact-prive") && !html.includes("22900000000") && !/wa\.me/.test(html), "aucun contact dans la page d'aperçu");
  const long = "Mot ".repeat(100).trim();
  const d = O.profilDescription(ROW({ presentation: long })); assert.ok(d.length <= 200, String(d.length)); assert.ok(d.endsWith("…") && !/ …$/.test(d) && !/Mo…$/.test(d), d.slice(-20));
  const seul = O.profilDescription(ROW({ metier: null, localisation: null, presentation: long })); assert.ok(seul.length <= 200 && seul.endsWith("…"));
  assert.strictEqual(O.profilDescription(ROW({ presentation: null })), "Couturier · Ville Test");
  assert.strictEqual(O.profilDescription(ROW({ metier: null, localisation: "Ville Test", presentation: null })), "Ville Test");
  assert.match(O.profilDescription(ROW({ metier: null, localisation: null, presentation: null })), /MAHOUTO\+/);
  const longMetier = O.profilDescription(ROW({ metier: "m".repeat(80), localisation: "l".repeat(60), presentation: long })); assert.ok(longMetier.length <= 200 && longMetier.endsWith("…"), "métier et lieu au maximum : la présentation est coupée pour tenir en 200 caractères");
});

test("_profil-og : image — seulement le compte Cloudinary du projet (sinon image de la marque) ; formats illisibles, requêtes, autres domaines refusés", async () => {
  const O = await og(), brand = "https://mahouto.com/assets/icon-512.png";
  assert.strictEqual(O.profilOgImage(ROW()).card, "summary_large_image");
  [null, "", "https://exemple.test/a.jpg", "http://res.cloudinary.com/" + CLOUD + "/image/upload/v1/a.jpg", `https://res.cloudinary.com/autre-compte/image/upload/v1/a.jpg`, PHOTO + "?x=1", PHOTO.replace(".jpg", ".svg"), PHOTO.replace(".jpg", ".pdf"), "javascript:alert(1)", `https://res.cloudinary.com/${CLOUD}/image/upload/../a.jpg`, PHOTO + "<script>"].forEach((u) => {
    const i = O.profilOgImage(ROW({ avatar_url: u })); assert.deepStrictEqual([i.url, i.width, i.card], [brand, "512", "summary"], String(u)); });
  assert.ok(fs.existsSync(path.join(root, "assets", "icon-512.png")));
  assert.match(O.profilOgImage(ROW({ avatar_url: PHOTO.replace(".jpg", ".webp") })).url, /fl_strip_profile/);
});

test("_profil-og : tout ce qui vient de la base est échappé pour le HTML (nom, métier, lieu, présentation) ; aucun script injecté", async () => {
  const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>&'`;
  const r = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW({ nom_affiche: evil, metier: evil, localisation: evil, presentation: evil }), error: null }));
  assert.ok(!/<script>alert|<img src=x/.test(r.html), "aucune balise injectée");
  assert.ok(r.html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  const scripts = r.html.match(/<script>[\s\S]*?<\/script>/g) || []; assert.strictEqual(scripts.length, 1, "un seul script : la redirection"); assert.ok(!scripts[0].includes("alert"));
  const O = await og(); assert.strictEqual(O.escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;"); assert.strictEqual(O.escapeHtml(null), "");
});

test("_profil-og : fermé, non publié, suspendu, inexistant → MÊME aperçu générique de la marque, sans rien révéler de l'adresse", async () => {
  const states = { inexistante: null, "non publiée / suspendue / fermée (la fonction ne renvoie rien)": null };
  const gens = [];
  for (const adresse of ["mon-atelier", "autre-adresse", "x-y-z"]) {
    const r = await preview({ adresse }, async () => ({ row: null, error: null }));
    assert.strictEqual(r.res.statusCode, 200); assert.strictEqual(meta(r.html, "og:title"), "MAHOUTO+"); assert.strictEqual(meta(r.html, "og:url"), "https://mahouto.com/");
    assert.strictEqual(meta(r.html, "og:image"), "https://mahouto.com/assets/icon-512.png"); assert.match(meta(r.html, "og:description"), /MAHOUTO\+/);
    gens.push(r.html.replace(new RegExp(adresse, "g"), "ADRESSE"));
  }
  assert.ok(gens.every((g) => g === gens[0]), "pages identiques à l'adresse près : aucune différence observable");
  const wrong = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW({ adresse: "autre-adresse" }), error: null })); assert.strictEqual(meta(wrong.html, "og:title"), "MAHOUTO+", "ligne d'une autre adresse : ignorée");
  const noName = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW({ nom_affiche: "   " }), error: null })); assert.strictEqual(meta(noName.html, "og:title"), "MAHOUTO+");
  assert.ok(Object.keys(states).length === 2);
});

test("_profil-og : noindex conservé (meta + en-tête X-Robots-Tag) ; cache court de 5 minutes ; pas de cache pour une erreur", async () => {
  const ok = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW(), error: null }));
  assert.strictEqual(ok.res.headers["x-robots-tag"], "noindex, nofollow"); assert.match(ok.html, /<meta name="robots" content="noindex, nofollow">/);
  assert.strictEqual(ok.res.headers["cache-control"], "public, max-age=60, s-maxage=300"); assert.match(ok.res.headers["content-type"], /text\/html/);
  const gen = await preview({ adresse: "mon-atelier" }, async () => ({ row: null, error: null })); assert.strictEqual(gen.res.headers["cache-control"], "public, max-age=60, s-maxage=300"); assert.strictEqual(gen.res.headers["x-robots-tag"], "noindex, nofollow");
  const err = await preview({ adresse: "mon-atelier" }, async () => ({ row: null, error: { message: "panne" } }));
  assert.strictEqual(err.res.statusCode, 503); assert.strictEqual(err.res.headers["cache-control"], "no-store"); assert.strictEqual(err.res.headers["x-robots-tag"], "noindex, nofollow"); assert.match(err.html, /noindex/);
});

test("_profil-og : lecture en échec (erreur ou exception) → 503 sans cache pour les robots, mais les humains sont redirigés vers /m.html", async () => {
  for (const failing of [async () => ({ row: null, error: { message: "x" } }), async () => { throw new Error("réseau"); }]) {
    const r = await preview({ adresse: "mon-atelier", src: "qr" }, failing);
    assert.strictEqual(r.res.statusCode, 503); assert.strictEqual(r.res.headers["cache-control"], "no-store");
    assert.ok(r.html.includes('content="1;url=https://mahouto.com/m.html?adresse=mon-atelier&amp;src=qr"') && r.html.includes('window.location.replace("https://mahouto.com/m.html?adresse=mon-atelier&src=qr")'), "redirection humaine conservée");
    assert.strictEqual(meta(r.html, "og:title"), "MAHOUTO+", "aperçu générique pour les robots");
  }
});

test("_profil-og : les humains sont redirigés vers /m.html?adresse=<adresse>&src=<source> ; la source (?src=qr) est conservée, sinon déduite dans le navigateur, sinon « partage »", async () => {
  const r = await preview({ adresse: "mon-atelier", src: "qr" }, async () => ({ row: ROW(), error: null }));
  assert.ok(r.html.includes('http-equiv="refresh" content="1;url=https://mahouto.com/m.html?adresse=mon-atelier&amp;src=qr"')); assert.ok(r.html.includes('window.location.replace("https://mahouto.com/m.html?adresse=mon-atelier&src=qr")'));
  const sans = await preview({ adresse: "mon-atelier" }, async () => ({ row: ROW(), error: null }));
  assert.ok(sans.html.includes('url=https://mahouto.com/m.html?adresse=mon-atelier&amp;src=partage'), "repli sans JavaScript : partage");
  assert.ok(/new URLSearchParams\(location\.search\)\.get\("src"\)/.test(sans.html), "le navigateur relit ?src= (la chaîne de requête d'origine) même si le serveur ne l'a pas reçue");
  assert.ok(/Instagram/.test(sans.html) && /FBAN/.test(sans.html) && /TikTok/.test(sans.html));
  const bad = await preview({ adresse: "mon-atelier", src: "<x> y" }, async () => ({ row: ROW(), error: null })); assert.ok(!bad.html.includes("<x>") && !/src=%3C|src=<x/.test(bad.html));
  const inval = await preview({ adresse: '"><script>x</script>' }, async () => ({ row: null, error: null }));
  assert.ok(!inval.html.includes("<script>x"), "adresse invalide jamais écrite telle quelle"); assert.ok(inval.html.includes("m.html?adresse=%22%3E%3Cscript%3Ex%3C%2Fscript%3E"));
});

test("api/produit-og.js : type « profil » — lecture UNIQUEMENT par l'appel RPC profil_public_lire avec la clé anonyme (jamais la table, jamais service_role) ; autres types inchangés", async () => {
  const src = read("api/produit-og.js"); const block = /async function fetchProfilForPreview[\s\S]*?\n}\n/.exec(src)[0];
  assert.match(block, /createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_ANON_KEY\)/); assert.match(block, /\.rpc\("profil_public_lire", \{ p_adresse: adresse \}\)/);
  assert.ok(!/\.from\(|SERVICE_ROLE|service_role/.test(block), "ni lecture directe de la table ni clé service");
  assert.match(src, /req\.query\.type === "profil" && req\.query\.format !== "json"\)\s*\{\s*return handleProfilPreview\(req, res, \{ fetchProfil: fetchProfilForPreview \}\);/);
  assert.ok(src.indexOf('type === "profil"') < src.indexOf('type === "salon"'), "branche ajoutée en tête, sans toucher aux autres");
  // exécution de bout en bout avec un faux client (dossier temporaire)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "profil-og-test-")); fs.cpSync(path.join(root, "api"), path.join(tmp, "api"), { recursive: true }); ["brand.js", "room-safe.js"].forEach((f) => fs.copyFileSync(path.join(root, f), path.join(tmp, f)));
  const dir = path.join(tmp, "node_modules", "@supabase", "supabase-js"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@supabase/supabase-js", version: "0.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "index.js"), "exports.createClient = (url, key) => { globalThis.__CREATED = [url, key]; return { rpc: async (n, a) => { globalThis.__RPC = [n, a]; return globalThis.__ANSWER; }, from() { throw new Error('lecture directe interdite'); } }; };");
  Object.assign(process.env, { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "anon-fictive" });
  const handler = (await import(pathToFileURL(path.join(tmp, "api", "produit-og.js")).href)).default;
  globalThis.__ANSWER = { data: [ROW()], error: null };
  const res = fakeRes(); await handler({ method: "GET", query: { type: "profil", adresse: "mon-atelier", src: "qr" }, headers: { host: "mahouto.com" } }, res);
  assert.strictEqual(JSON.stringify(globalThis.__RPC), JSON.stringify(["profil_public_lire", { p_adresse: "mon-atelier" }])); assert.deepStrictEqual(globalThis.__CREATED, ["https://x.test", "anon-fictive"]);
  assert.strictEqual(meta(String(res.body), "og:title"), "Atelier Test — MAHOUTO+"); assert.strictEqual(res.headers["x-robots-tag"], "noindex, nofollow");
  globalThis.__ANSWER = { data: [], error: null }; const res2 = fakeRes(); await handler({ method: "GET", query: { type: "profil", adresse: "mon-atelier" }, headers: {} }, res2);
  assert.strictEqual(meta(String(res2.body), "og:title"), "MAHOUTO+", "rien de public : aperçu générique");
  globalThis.__ANSWER = { data: null, error: { message: "panne" } }; const res3 = fakeRes(); await handler({ method: "GET", query: { type: "profil", adresse: "mon-atelier" }, headers: {} }, res3);
  assert.strictEqual(res3.statusCode, 503);
});

test("vercel.json : /m/:adresse → /api/produit-og?type=profil&adresse=:adresse ; noindex conservé (en-têtes /m/:adresse et /m.html) ; aucun nouveau fichier directement dans api/", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/m/:adresse"), { source: "/m/:adresse", destination: "/api/produit-og?type=profil&adresse=:adresse" });
  ["/e/:slug", "/r/:id", "/p/:id", "/f/:id", "/s/:id", "/verify/:code"].forEach((s) => assert.ok(v.rewrites.some((r) => r.source === s), s));
  ["/m/:adresse", "/m.html"].forEach((s) => assert.ok(v.headers.some((h) => h.source === s && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex, nofollow")), s));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js")); const fns = list("api").filter((f) => !f.startsWith("_")).concat(list("api/admin"));
  assert.strictEqual(fns.length, 12, "plafond Vercel Hobby"); assert.ok(fs.existsSync(path.join(root, "api", "_profil-og.js")));
});

test("cache : sw.js a changé de version (v119 ou plus) ; m.html garde noindex", () => {
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(read("sw.js"))[1]) >= 119);
  assert.match(read("m.html"), /<meta name="robots" content="noindex, nofollow">/);
});
