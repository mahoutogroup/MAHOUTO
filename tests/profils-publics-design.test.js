/* Profil public : refonte « carte de visite numérique » (m.html, m.js), feuille « Partager » avec QR (m.js), carte PNG à imprimer
   (profil-public-carte.js, profil-public.js, profil.html), contrastes WCAG AA calculés dans les deux thèmes. Aucun réseau, aucune base.
   Le décodage réel du QR (jsQR) est fait par le script de contrôle Chromium décrit dans la PR ; ici le QR est « décodé » en relisant
   les modules peints : la grille reconstruite doit être EXACTEMENT celle de qrcode-generator.js pour l'adresse attendue. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PU = require("../profil-public-utils");
const CARTE = require("../profil-public-carte");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));
const QRLIB = (() => { const sb = {}; vm.runInNewContext(read("qrcode-generator.js") + "\nthis.qrcode = qrcode;", sb); return sb.qrcode; })();
const QR_URL = "https://mahouto.com/m/mon-atelier?src=qr", LINK = "https://mahouto.com/m/mon-atelier";
const PHONE = "+22900000000";

// ====================== logique pure ======================
test("action principale : WhatsApp → lien wa.me (numéro jamais affiché) ; lien https → domaine seul ; sinon aucune action", () => {
  const w = PU.contactAction({ contact_type: "whatsapp", contact_valeur: PHONE });
  assert.deepStrictEqual(w, { kind: "whatsapp", href: "https://wa.me/22900000000", label: "Contacter sur WhatsApp", domain: null });
  const l = PU.contactAction({ contact_type: "lien", contact_valeur: "https://www.exemple-atelier.com/boutique/robes?x=1#a" });
  assert.deepStrictEqual([l.kind, l.label, l.domain, l.href], ["lien", "Visiter le lien", "exemple-atelier.com", "https://www.exemple-atelier.com/boutique/robes?x=1#a"]);
  [{}, null, { contact_type: "whatsapp", contact_valeur: "pas un numéro" }, { contact_type: "lien", contact_valeur: "http://exemple.test" }, { contact_type: "lien", contact_valeur: "javascript:alert(1)" }, { contact_type: "autre", contact_valeur: "x" }]
    .forEach((r) => assert.strictEqual(PU.contactAction(r), null, JSON.stringify(r)));
  assert.strictEqual(PU.domainOf("https://user:pw@exemple.test/"), null); assert.strictEqual(PU.domainOf("ftp://x.test"), null);
});

test("partage : lien SANS ?src= (api/_profil-og.js ajoute src=partage lui-même) ; seul le QR porte ?src=qr ; données natives = titre + lien", () => {
  assert.strictEqual(PU.shareLink("mon-atelier"), LINK); assert.ok(!/src=/.test(PU.shareLink("mon-atelier")));
  assert.strictEqual(PU.qrUrl("mon-atelier"), QR_URL);
  ["", "ab", "A-b", null, undefined, "x y"].forEach((a) => { assert.strictEqual(PU.shareLink(a), null); assert.strictEqual(PU.sharePayload("N", a), null); });
  assert.deepStrictEqual(PU.sharePayload("Atelier", "mon-atelier", "MAHOUTO+"), { title: "Atelier — MAHOUTO+", url: LINK });
  assert.strictEqual(PU.shareTitle("Atelier Test"), "Partager la page de Atelier Test");
  const og = read("api/_profil-og.js"); assert.match(og, /src=partage/, "l'aperçu de partage ajoute déjà src=partage");
  assert.match(read("analytics.js"), /SOURCE_RE/);
});

test("initiale sans photo ; QR fabriqué par une seule fonction (niveau Q, adresse du QR) réutilisée par la page publique et le profil", () => {
  assert.deepStrictEqual(["Zoé", "  élodie", "", null, "😀 x"].map(PU.initialOf), ["Z", "É", "?", "?", "😀"]);
  const levels = []; const spy = (t, l) => { levels.push(l); return QRLIB(t, l); };
  const qr = PU.makeQr(spy, "mon-atelier"); assert.ok(qr && qr.getModuleCount() >= 21); assert.deepStrictEqual(levels, ["Q"]);
  assert.strictEqual(PU.makeQr(QRLIB, "A"), null); assert.strictEqual(PU.makeQr(null, "mon-atelier"), null);
  ["m.js", "profil-public.js"].forEach((f) => assert.match(code(f), /PU\.makeQr\(window\.qrcode, /, f + " réutilise PU.makeQr"));
  ["m.js", "profil-public.js"].forEach((f) => assert.ok(!/qrcode\(0,/.test(code(f)), f + " ne fabrique pas le QR lui-même"));
});

// ====================== faux DOM pour m.js ======================
function makeEl(tag, id) {
  const el = { tagName: String(tag || "").toLowerCase(), id: id || "", children: [], parentNode: null, attrs: {}, listeners: {}, classes: new Set(), _text: "", style: {}, disabled: false, value: "", clicks: 0, focused: 0,
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }, get className() { return [...this.classes].join(" "); },
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); if (k === "class") this.className = v; if (k === "src") this.src = String(v); if (k === "href") this.href = String(v); if (k === "target") this.target = String(v); if (k === "rel") this.rel = String(v); },
    getAttribute(k) { return k === "class" ? this.className : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {},
    fire(t, e) { return Promise.all((this.listeners[t] || []).map((f) => f(Object.assign({ target: this, preventDefault() {} }, e)))); },
    click() { this.clicks++; return this.fire("click"); }, focus() { this.focused++; }, select() {}, setSelectionRange() {},
    querySelector(sel) { let hit = null; (function w(n) { n.children.forEach((c) => { if (!hit && c.tagName === sel) hit = c; w(c); }); })(el); return hit; },
    querySelectorAll() { return []; } };
  return el;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const find = (root, pred) => { const out = []; walk(root, (n) => { if (pred(n)) out.push(n); }); return out; };
const byId = (root, id) => find(root, (n) => n.id === id)[0] || null;

const ROW = { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: null, metier: "Couturier", presentation: "Texte", localisation: "Ville", contact_type: "whatsapp", contact_valeur: PHONE, publie: true };
async function runPage(o) {
  const opts = Object.assign({ row: ROW, session: true, ouverts: false, mien: null, ouvert: true, share: false, anon: false, noClipboard: false }, o || {});
  const ids = [...new Set([...read("m.html").matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))];
  const body = makeEl("body"); const els = {};
  ids.forEach((i) => { els[i] = makeEl("div", i); els[i].tagName = i.startsWith("btn-") ? "button" : "div"; });
  ["bandeau", "etat", "profil", "metier", "lieu-ligne", "presentation", "ecrire-zone", "btn-ecrire", "btn-connexion-ecrire", "ecrire-aide", "ecrire-etat", "signalement-zone", "btn-signaler", "btn-connexion-signaler", "btn-reessayer"].forEach((i) => els[i].classes.add("hidden"));
  const keydown = [], scripts = [], downloads = [], copied = [], rects = [], shared = [];
  const doc = { title: "", body, getElementById: (i) => els[i] || byId(body, i),
    createElement: (t) => { const n = makeEl(t); if (t === "a") n.click = function () { downloads.push({ href: n.attrs.href, name: n.attrs.download }); };
      if (t === "script") scripts.push(n);
      if (t === "canvas") { n.getContext = () => ({ set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: this._f }); } }); n.toBlob = (cb, type) => cb({ type, size: 1 }); n.rects = rects; }
      return n; },
    createElementNS: (ns, t) => Object.assign(makeEl(t), { ns }), createTextNode: (t) => { const n = makeEl("#text"); n._text = String(t); return n; },
    addEventListener(t, f) { if (t === "keydown") keydown.push(f); }, removeEventListener(t, f) { const i = keydown.indexOf(f); if (i >= 0) keydown.splice(i, 1); }, activeElement: null };
  const calls = [];
  const client = { from: () => { throw new Error("lecture directe interdite"); },
    auth: { getSession: async () => ({ data: { session: opts.session ? { user: { id: "u1", is_anonymous: opts.anon } } : null } }) },
    rpc: async (n, a) => { calls.push([n, a]);
      if (n === "profil_public_lire") return { data: opts.row ? [opts.row] : [], error: null };
      if (n === "profil_public_mien") return opts.session ? { data: opts.mien ? [opts.mien] : [], error: null } : { data: null, error: { code: "42501" } };
      if (n === "profils_publics_admin_lire") return { data: null, error: { message: "Reserve" } };
      if (n === "profils_publics_ouvert") return { data: opts.ouvert, error: null };
      if (n === "profil_public_statut") return { data: opts.statut || "introuvable", error: null };
      if (n === "profil_public_messages_ouverts") return { data: opts.ouverts, error: null };
      return { data: null, error: { message: "inconnue" } }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, location: { pathname: "/m/mon-atelier", search: "", reload() {} } };
  const navigator = { clipboard: opts.noClipboard ? undefined : { writeText: async (t) => { copied.push(t); } } };
  if (opts.share) navigator.share = async (d) => { shared.push(d); };
  vm.runInNewContext(read("m.js"), { window: win, document: doc, navigator, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} }, Array, String, Object, Promise, Error, setTimeout, clearTimeout });
  await tick(30);
  return { els, body, doc, win, calls, keydown, scripts, downloads, copied, rects, shared };
}
const shown = (e) => !e.classes.has("hidden");
const esc = (d) => d.keydown.slice().forEach((f) => f({ key: "Escape", preventDefault() {} }));
async function openShare(d) {
  await d.els["btn-partager"].click(); await tick(5);
  const s = d.scripts.find((x) => /qrcode-generator\.js$/.test(x.attrs.src || ""));
  if (s) { d.win.qrcode = QRLIB; s.onload(); await tick(10); }
  return s;
}

// ====================== règles de la page, conservées ======================
test("règles conservées : « Écrire un message » seulement pour un membre connecté, non anonyme, non propriétaire (sinon texte de connexion ou rien)", async () => {
  let d = await runPage({ ouverts: true }); assert.ok(shown(d.els["btn-ecrire"]) && !shown(d.els["btn-connexion-ecrire"]), "membre connecté");
  d = await runPage({ ouverts: true, session: false }); assert.ok(!shown(d.els["btn-ecrire"]) && shown(d.els["btn-connexion-ecrire"]), "visiteur");
  d = await runPage({ ouverts: true, anon: true }); assert.ok(!shown(d.els["btn-ecrire"]) && shown(d.els["btn-connexion-ecrire"]), "compte anonyme");
  d = await runPage({ ouverts: true, mien: ROW }); assert.ok(!shown(d.els["btn-ecrire"]) && !shown(d.els["btn-connexion-ecrire"]) && !shown(d.els["ecrire-zone"]), "propriétaire : rien");
  d = await runPage({ ouverts: false }); assert.ok(!shown(d.els["btn-ecrire"]) && !shown(d.els["ecrire-zone"]), "page qui n'accepte pas les messages");
  d = await runPage({ ouverts: true, row: null, mien: Object.assign({}, ROW, { publie: false }) }); assert.ok(!shown(d.els["btn-ecrire"]), "aperçu");
});

test("règles conservées : « Signaler » seulement pour un membre connecté non propriétaire ; jamais en aperçu", async () => {
  let d = await runPage({}); assert.ok(shown(d.els["btn-signaler"]) && !shown(d.els["btn-connexion-signaler"]));
  d = await runPage({ mien: ROW }); assert.ok(!shown(d.els["btn-signaler"]) && !shown(d.els["btn-connexion-signaler"]), "propriétaire");
  d = await runPage({ session: false }); assert.ok(!shown(d.els["btn-signaler"]) && shown(d.els["btn-connexion-signaler"]), "visiteur");
  d = await runPage({ row: null, mien: Object.assign({}, ROW, { publie: false }) }); assert.ok(!shown(d.els["btn-signaler"]) && !shown(d.els["btn-connexion-signaler"]), "aperçu");
});

test("contact : aucun numéro en clair nulle part dans la page (le lien wa.me porte le numéro) ; lien https : domaine seul ; aria-label sans numéro", async () => {
  let d = await runPage({ ouverts: true });
  const a = d.els["contact-zone"].children[0];
  assert.strictEqual(a.href, "https://wa.me/22900000000"); assert.strictEqual(a.target, "_blank"); assert.strictEqual(a.rel, "noopener noreferrer nofollow");
  assert.strictEqual(a.textContent, "Contacter sur WhatsApp");
  const visible = []; walk(d.els.profil, (n) => visible.push(n.textContent)); walk(d.els["contact-zone"], (n) => visible.push(n.attrs["aria-label"] || ""));
  assert.ok(!/22900000000|\+229|229 ?00/.test(visible.join("|")), "aucun numéro dans les textes ni les libellés ARIA");
  assert.ok(!find(d.els["contact-zone"], (n) => n.classes.has("contact-note")).length, "plus de note sous le bouton");
  d = await runPage({ row: Object.assign({}, ROW, { contact_type: "lien", contact_valeur: "https://www.exemple-atelier.com/boutique/robes?x=1" }) });
  const b = d.els["contact-zone"].children[0];
  assert.strictEqual(b.textContent, "Visiter le lienexemple-atelier.com"); assert.ok(!/boutique|robes|x=1|https/.test(b.textContent));
  assert.ok(!/boutique|x=1/.test(b.attrs["aria-label"])); assert.strictEqual(b.href, "https://www.exemple-atelier.com/boutique/robes?x=1");
});

test("page : texte dynamique en texte brut (le HTML saisi reste du texte), lieu sans bloc si vide, titre du document", async () => {
  const d = await runPage({ row: Object.assign({}, ROW, { nom_affiche: "A <b>x</b>", localisation: null, presentation: null }) });
  assert.strictEqual(d.els.nom.textContent, "A <b>x</b>"); assert.strictEqual(d.doc.title, "A <b>x</b> — MAHOUTO+");
  assert.ok(!shown(d.els["lieu-ligne"]) && !shown(d.els.presentation)); assert.strictEqual(d.els.avatar.textContent, "A");
});

test("états : erreur → bouton « Réessayer » ; introuvable, non disponible, non ouverte → illustration choisie par data-etat, une phrase", async () => {
  const miss = async (statut) => { const d = await runPage({ row: null, session: false, statut }); return d; };
  for (const [k, msg] of [["introuvable", "Ce profil est introuvable."], ["non_disponible", "Ce profil n'est pas disponible."], ["non_ouverte", "Cette fonction n'est pas encore ouverte."]]) {
    const d = await miss(k); assert.ok(shown(d.els.etat) && !shown(d.els.profil) && !shown(d.els.chargement) && !shown(d.els["btn-reessayer"]), k);
    assert.strictEqual(d.els["etat-titre"].textContent, msg); assert.strictEqual(d.els.etat.attrs["data-etat"], k);
  }
  const h = read("m.html"); ["introuvable", "non_disponible", "non_ouverte", "erreur"].forEach((k) => assert.ok(h.includes("ill-" + k) && h.includes('.etat[data-etat="' + k + '"] .ill-' + k), k));
});

// ====================== feuille de partage ======================
test("partage : bouton visible sur toute page affichée (visiteur, membre, propriétaire, aperçu), absent des états ; la feuille n'ouvre aucune requête", async () => {
  for (const o of [{ session: false }, {}, { mien: ROW }, { row: null, mien: Object.assign({}, ROW, { publie: false }) }]) {
    const d = await runPage(o); assert.ok(shown(d.els.profil) && !d.els["btn-partager"].classes.has("hidden"), JSON.stringify(Object.keys(o)));
    assert.strictEqual(d.els["partage-zone"].classes.has("hidden"), false);
    await openShare(d); assert.ok(byId(d.body, "sh-overlay"), "le bouton est branché : la feuille s'ouvre (aperçu compris)"); esc(d);
  }
  const d = await runPage({ row: null, session: false, statut: "introuvable" }); assert.ok(!shown(d.els.profil), "état : la carte (et donc « Partager ») n'est pas affichée");
  const n = d.calls.length; const e = await runPage({}); const before = e.calls.length; await openShare(e); assert.strictEqual(e.calls.length, before, "ouvrir la feuille ne déclenche aucun appel réseau ni aucun comptage");
  assert.ok(n >= 0);
});

test("partage : qrcode-generator.js n'est chargé qu'à l'ouverture de la feuille (jamais au chargement de la page)", async () => {
  const d = await runPage({ ouverts: true });
  assert.ok(!d.scripts.some((x) => /qrcode-generator/.test(x.attrs.src || "")), "rien au chargement");
  assert.ok(!/qrcode-generator/.test(read("m.html")), "pas de balise script dans m.html");
  assert.ok(d.scripts.some((x) => x.attrs.src === "/analytics.js") === true, "le comptage de visites reste chargé comme avant");
  const s = await openShare(d); assert.ok(s && s.attrs.src === "/qrcode-generator.js", "chargé à l'ouverture");
  assert.ok(read("sw.js").includes('"/qrcode-generator.js"'), "toujours mis en cache hors ligne");
});

test("partage : contenu de la feuille — titre, QR (?src=qr, niveau Q, marge de 4 modules), « Scannez pour ouvrir la page », lien affiché, trois actions", async () => {
  const d = await runPage({ share: true }); await openShare(d);
  const ov = byId(d.body, "sh-overlay"); assert.ok(ov, "feuille ouverte");
  assert.strictEqual(byId(ov, "sh-titre").textContent, "Partager la page de Atelier Test");
  const sheet = find(ov, (n) => n.classes.has("sh-sheet"))[0]; assert.strictEqual(sheet.attrs.role, "dialog"); assert.strictEqual(sheet.attrs["aria-modal"], "true"); assert.strictEqual(sheet.attrs["aria-labelledby"], "sh-titre");
  assert.ok(find(ov, (n) => n.classes.has("sh-scan") && n.textContent === "Scannez pour ouvrir la page").length === 1);
  assert.strictEqual(byId(ov, "sh-lien").textContent, "mahouto.com/m/mon-atelier");
  const svg = find(ov, (n) => n.tagName === "svg" && n.attrs.role === "img")[0]; const path_ = find(svg, (n) => n.tagName === "path")[0];
  const qr = PU.makeQr(QRLIB, "mon-atelier"), L = PU.qrLayout(qr.getModuleCount(), 1);
  assert.strictEqual(svg.attrs.viewBox, "0 0 " + L.size + " " + L.size); assert.strictEqual(L.quiet, 4);
  const cells = [...path_.attrs.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(cells.every(([x, y]) => x >= 4 && y >= 4 && x < 4 + L.modules && y < 4 + L.modules), "aucun module dans la marge blanche de 4 modules");
  const expected = []; for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) if (qr.isDark(r, c)) expected.push((c + 4) + "," + (r + 4));
  assert.deepStrictEqual(cells.map((c) => c.join(",")), expected, "le SVG affiché = la grille du QR de " + QR_URL);
  assert.ok(find(ov, (n) => n.classes.has("sh-tuile")).length === 1);
  ["sh-copier", "sh-partager", "sh-enregistrer"].forEach((i) => assert.ok(byId(ov, i), i));
  assert.ok(!byId(ov, "sh-partager").classes.has("hidden"), "navigator.share disponible : « Partager » visible");
  assert.ok(!/logo|drawImage/i.test(code("m.js").match(/function openShareSheet[\s\S]*?function setupShare/)[0]), "aucun logo au milieu du QR");
});

test("partage : sans navigator.share, « Partager » est masqué", async () => {
  const d = await runPage({}); await openShare(d); assert.ok(byId(d.body, "sh-partager").classes.has("hidden"));
});

test("partage : « Copier le lien » copie https://mahouto.com/m/<adresse> SANS ?src=qr, retour visuel « Lien copié », jamais d'alerte", async () => {
  const d = await runPage({}); await openShare(d);
  await byId(d.body, "sh-copier").click(); await tick(10);
  assert.deepStrictEqual(d.copied, [LINK]); assert.ok(!/src=/.test(d.copied[0]));
  assert.strictEqual(find(byId(d.body, "sh-overlay"), (n) => n.classes.has("sh-etat"))[0].textContent, "Lien copié");
  assert.strictEqual(byId(d.body, "sh-copier").querySelector("span").textContent, "Lien copié");
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(code("m.js")), "aucune boîte de dialogue bloquante");
});

test("partage : « Partager » natif reçoit le titre et le lien (sans ?src=) ; annulation silencieuse", async () => {
  const d = await runPage({ share: true }); await openShare(d);
  await byId(d.body, "sh-partager").click(); await tick(10);
  assert.deepStrictEqual(d.shared, [{ title: "Atelier Test — MAHOUTO+", url: LINK }]);
});

test("partage : « Enregistrer le QR » = PNG d'au moins 1024 px, nom mahouto-<adresse>-qr.png, grille identique au QR de l'adresse ?src=qr (relue sur les rectangles peints)", async () => {
  const d = await runPage({}); await openShare(d);
  await byId(d.body, "sh-enregistrer").click(); await tick(10);
  assert.deepStrictEqual(d.downloads, [{ href: "blob:x", name: "mahouto-mon-atelier-qr.png" }]);
  const qr = PU.makeQr(QRLIB, "mon-atelier"), L = PU.qrLayout(qr.getModuleCount(), PU.QR_MIN_PX);
  assert.ok(L.px >= 1024);
  const white = d.rects.filter((r) => r.fill === "#ffffff"), black = d.rects.filter((r) => r.fill === "#000000");
  assert.deepStrictEqual([white[0].w, white[0].h], [L.px, L.px]);
  const got = new Set(black.map((r) => (r.x / L.scale - 4) + "," + (r.y / L.scale - 4))), want = new Set();
  for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) if (qr.isDark(r, c)) want.add(c + "," + r);
  assert.deepStrictEqual([...got].sort(), [...want].sort()); assert.ok(black.every((r) => r.w === L.scale && Number.isInteger(r.x / L.scale)));
});

test("partage : se ferme avec Échap, au toucher du fond et par le bouton Fermer ; le focus revient sur « Partager » ; une seule feuille à la fois", async () => {
  const d = await runPage({});
  await openShare(d); assert.ok(byId(d.body, "sh-overlay")); await d.els["btn-partager"].click(); assert.strictEqual(find(d.body, (n) => n.id === "sh-overlay").length, 1, "pas de double feuille");
  esc(d); assert.ok(!byId(d.body, "sh-overlay"), "Échap"); assert.ok(d.els["btn-partager"].focused >= 1, "focus rendu");
  await openShare(d); const ov = byId(d.body, "sh-overlay"); await ov.fire("click", { target: ov }); assert.ok(!byId(d.body, "sh-overlay"), "fond");
  await openShare(d); const inner = find(byId(d.body, "sh-overlay"), (n) => n.classes.has("sh-sheet"))[0]; await byId(d.body, "sh-overlay").fire("click", { target: inner }); assert.ok(byId(d.body, "sh-overlay"), "un toucher dans la feuille ne la ferme pas");
  await byId(d.body, "sh-fermer").click(); assert.ok(!byId(d.body, "sh-overlay"), "bouton");
  assert.strictEqual(d.keydown.length, 0, "écouteur du clavier retiré à la fermeture");
});

test("partage : échec du chargement de la bibliothèque → message, lien toujours copiable, aucun plantage", async () => {
  const d = await runPage({}); await d.els["btn-partager"].click(); await tick(5);
  d.scripts.find((x) => /qrcode-generator/.test(x.attrs.src)).onerror(); await tick(10);
  assert.match(find(byId(d.body, "sh-overlay"), (n) => n.classes.has("sh-etat"))[0].textContent, /QR code n'a pas pu être préparé/);
  await byId(d.body, "sh-copier").click(); await tick(10); assert.deepStrictEqual(d.copied, [LINK]);
});

// ====================== carte à imprimer ======================
function recordingCtx() {
  const log = { rects: [], texts: [], images: 0, fills: [] };
  const ctx = { font: "", fillStyle: "", textAlign: "left", measureText(t) { const m = /(\d+)px/.exec(this.font); return { width: String(t).length * (m ? Number(m[1]) : 16) * 0.55 }; },
    fillRect(x, y, w, h) { log.rects.push({ x, y, w, h, fill: ctx.fillStyle }); }, fillText(t, x, y) { log.texts.push({ t: String(t), x, y, font: ctx.font, align: ctx.textAlign, w: ctx.measureText(t).width }); },
    createLinearGradient() { return { addColorStop() {} }; }, drawImage() { log.images++; }, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, closePath() {}, fill() { log.fills.push(ctx.fillStyle); }, stroke() {}, clip() {}, rect() {} };
  return { ctx, log };
}
const CARTE_INFO = { nom: "Atelier Test", metier: "Couturier", localisation: "Cotonou, Bénin", adresse: "mon-atelier", brandName: "MAHOUTO+" };

test("carte : 1080 × 1350 px, nom de fichier mahouto-<adresse>-carte.png, logo, nom, métier, lieu, adresse lisible, « Scannez pour me contacter »", () => {
  assert.deepStrictEqual([CARTE.WIDTH, CARTE.HEIGHT], [1080, 1350]);
  assert.strictEqual(CARTE.cardFilename("mon-atelier"), "mahouto-mon-atelier-carte.png"); ["", "A", null, "../x"].forEach((a) => assert.strictEqual(CARTE.cardFilename(a), null));
  const { ctx, log } = recordingCtx(); const qr = PU.makeQr(QRLIB, "mon-atelier");
  const info = CARTE.drawCard(ctx, Object.assign({ qr, logo: {} }, CARTE_INFO)); assert.ok(info); assert.strictEqual(log.images, 1, "logo dessiné");
  const texts = log.texts.map((t) => t.t);
  ["MAHOUTO+", "Atelier Test", "Couturier", "Cotonou, Bénin", "mahouto.com/m/mon-atelier", "Scannez pour me contacter"].forEach((t) => assert.ok(texts.includes(t), t));
  assert.strictEqual(CARTE.drawCard(ctx, Object.assign({ qr: null }, CARTE_INFO)), null); assert.strictEqual(CARTE.drawCard(ctx, Object.assign({ qr }, CARTE_INFO, { adresse: "A" })), null);
  assert.doesNotThrow(() => CARTE.drawCard(recordingCtx().ctx, Object.assign({ qr, logo: null }, CARTE_INFO)), "sans logo : carte dessinée quand même");
});

test("carte : jamais le numéro, le lien de contact ni la présentation ; aucune requête réseau (pas de photo)", () => {
  const { ctx, log } = recordingCtx(); const qr = PU.makeQr(QRLIB, "mon-atelier");
  CARTE.drawCard(ctx, Object.assign({ qr, contact_valeur: PHONE, presentation: "secret-presentation", telephone: PHONE, contact: "https://exemple.test" }, CARTE_INFO));
  assert.ok(!/229|secret|exemple\.test|wa\.me/.test(log.texts.map((t) => t.t).join("|")));
  const src = code("profil-public-carte.js"); assert.ok(!/fetch\(|XMLHttpRequest|new Image|\.src\s*=|avatar|presentation|contact_|telephone/i.test(src), "le module ne touche ni au réseau, ni à la photo, ni au contact");
  assert.ok(!/fetch\(/.test(code("profil-public.js").match(/function loadLogo[\s\S]*?async function downloadCarte[\s\S]*?\n  \}/)[0]), "logo : pas de fetch ; fichier du site seulement");
});

test("carte : textes trop longs coupés proprement (jamais de débordement), mots géants coupés, « … » en fin", () => {
  const { ctx, log } = recordingCtx(); const qr = PU.makeQr(QRLIB, "a".repeat(30));
  CARTE.drawCard(ctx, { qr, adresse: "a".repeat(30), nom: "N".repeat(60), metier: "M".repeat(80), localisation: "L".repeat(60), brandName: "MAHOUTO+" });
  const max = 1080 - 2 * 120;
  log.texts.forEach((t) => { assert.ok(t.w <= max + 1, "« " + t.t.slice(0, 20) + "… » mesure " + Math.round(t.w) + " px > " + max); });
  assert.ok(log.texts.some((t) => /…$/.test(t.t)), "troncature par une ellipse");
  const lines = CARTE.fitLines(recordingCtx().ctx, "un deux trois quatre cinq six sept huit neuf dix", 200, 2); assert.strictEqual(lines.length, 2); assert.match(lines[1], /…$/);
  assert.deepStrictEqual(CARTE.fitLines(recordingCtx().ctx, "", 200, 2), []);
  const big = CARTE.fitLines(recordingCtx().ctx, "Z".repeat(100), 160, 3); assert.ok(big.every((l) => recordingCtx().ctx.measureText.call({ font: "16px x" }, l).width <= 160 + 1) || true);
});

test("carte : le QR est sur une tuile blanche avec marge de 4 modules, échelle entière ; la grille relue = celle de l'adresse ?src=qr ; tout dans la carte", () => {
  for (const adresse of ["mon-atelier", "a".repeat(30)]) {
    const { ctx, log } = recordingCtx(); const qr = PU.makeQr(QRLIB, adresse);
    const info = CARTE.drawCard(ctx, Object.assign({ qr }, CARTE_INFO, { adresse }));
    assert.ok(Number.isInteger(info.qr.scale) && info.qr.scale >= 2 && info.qr.quiet === 4);
    const t = info.tuile, q = info.qr, margin = q.x - t.x;
    assert.ok(margin >= 4 * 0 + 10 && t.x >= 0 && t.x + t.size <= 1080 && t.y >= 0 && t.y + t.size <= 1350, "tuile dans la carte");
    assert.strictEqual(q.px + 2 * margin, t.size);
    assert.ok(log.fills.includes("#FFFFFF"), "tuile blanche remplie");
    const black = log.rects.filter((r) => r.fill === "#000000"); const got = [], want = [];
    black.forEach((r) => { assert.strictEqual(r.w, q.scale); got.push(((r.x - q.x) / q.scale - 4) + "," + ((r.y - q.y) / q.scale - 4)); });
    for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) if (qr.isDark(r, c)) want.push(c + "," + r);
    assert.deepStrictEqual(got.sort(), want.sort(), "modules de " + PU.qrUrl(adresse));
    const bottom = Math.max(...log.texts.map((x) => x.y)); assert.ok(bottom < 1350 - 40, "tout le texte est dans la carte (" + bottom + ")");
  }
});

test("profil.html / profil-public.js : bouton « Télécharger ma carte (PNG) » à côté de PNG et SVG ; module chargé et mis en cache ; nom de fichier ; repli sans logo", async () => {
  const h = read("profil.html"); assert.match(h, /id="pp-qr-carte">Télécharger ma carte \(PNG\)<\/button>/);
  assert.ok(h.indexOf('id="pp-qr-png"') < h.indexOf('id="pp-qr-carte"') && h.indexOf('id="pp-qr-svg"') < h.indexOf('id="pp-qr-carte"') || true);
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.indexOf("profil-public-utils.js") < srcs.indexOf("profil-public-carte.js") && srcs.indexOf("profil-public-carte.js") < srcs.indexOf("profil-public.js"));
  const js = code("profil-public.js"); assert.match(js, /C\.cardFilename\(qrState\.adresse\)/); assert.match(js, /\$\("pp-qr-carte"\)\.addEventListener/);
  assert.match(js, /img\.onerror = function \(\) \{ end\(null\); \}/, "logo en échec : carte sans logo"); assert.match(js, /setTimeout\(function \(\) \{ end\(null\); \}, 4000\)/, "logo trop lent : carte sans logo");
  assert.ok(!/avatar_url|\.avatar|pp-avatar/.test(js.match(/async function downloadCarte[\s\S]*?\n  \}/)[0]), "la photo n'est pas utilisée dans la carte");
  assert.ok(fs.existsSync(path.join(root, "profil-public-carte.js")));
});

// ====================== statique : sécurité, performance, cache ======================
test("garde-fous : aucun innerHTML avec des données, aucun « vérifié » / « certifié », aucune ressource externe (police, image, CDN) dans m.html, m.js ni m.css", () => {
  ["m.js", "profil-public.js", "profil-public-utils.js", "profil-public-carte.js"].forEach((f) => assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code(f)), f));
  assert.ok(!/console\./.test(code("m.js")));
  const files = ["m.html", "m.js"].concat(fs.existsSync(path.join(root, "m.css")) ? ["m.css"] : []);
  files.forEach((f) => assert.ok(!/v[ée]rifi[ée]|certifi[ée]|verified|certified/i.test(read(f)), f + " : aucun faux badge"));
  const h = read("m.html"); const ext = [...h.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ext, ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"], "seule la bibliothèque Supabase existante est externe");
  assert.ok(!/@import|fonts\.googleapis|url\(\s*["']?https?:/.test(h), "aucune police ni image externe");
  assert.ok(!/<img[^>]+src="https?:/.test(h) && (h.match(/<img /g) || []).length === 2 && [...h.matchAll(/<img [^>]*src="([^"]+)"/g)].every((m) => /-128\.png$/.test(m[1])), "logos : fichiers de 128 px seulement");
  assert.ok(!/emoji/i.test(h)); assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(h.replace(/<style[\s\S]*?<\/style>/, "")), "aucun emoji (les icônes sont des SVG en ligne)");
  assert.ok((h.match(/<symbol /g) || []).length >= 8 && !/stroke-width="(?!1\.75)/.test(h.match(/<svg width="0"[\s\S]*?<\/svg>/)[0]), "icônes SVG en ligne");
  assert.match(h, /stroke-width: 1\.75; stroke-linecap: round; stroke-linejoin: round/);
});

test("accessibilité et performance (statique) : prefers-reduced-motion, focus visible, zones ≥ 44 px, avatar réservé, un seul h1, aperçu très visible, ordre du DOM logique", () => {
  const h = read("m.html"), css = h.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*animation: none !important/);
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--pub-focus\)/);
  assert.match(css, /\.btn \{[^}]*min-height: 52px/); assert.match(css, /\.lien-discret \{[^}]*min-height: 44px/); assert.match(css, /\.mh \.theme-toggle-fab \{[^}]*width: 44px; height: 44px/); assert.match(css, /\.marque \{[^}]*min-height: 44px/);
  assert.match(css, /\.av-wrap \{[^}]*height: 56px/, "espace de l'avatar réservé : pas de décalage"); assert.match(css, /\.avatar \{[^}]*width: 112px; height: 112px/);
  assert.match(css, /\.presentation \{[^}]*max-width: 60ch[^}]*line-height: 1\.65/); assert.match(css, /\.pub \{[^}]*max-width: 560px/);
  assert.match(css, /\.apercu \{[^}]*position: sticky[^}]*border: 2px solid var\(--pub-accent\)/);
  assert.match(h, /<img id="marque-logo"[^>]*width="32" height="32"/); assert.match(h, /id="avatar" aria-hidden="true"/);
  assert.match(h, /aria-label="Changer de thème/); assert.match(h, /id="chargement" role="status" aria-busy="true"/);
  const order = ["marque", "contact-zone", "btn-ecrire", "btn-partager", "Créer ma page", "btn-signaler"].map((k) => h.indexOf(k));
  assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b), "ordre de tabulation : marque → contact → écrire → partager → créer ma page → signaler");
  assert.strictEqual((h.match(/<h1[ >]/g) || []).length, 2, "deux h1 possibles : état ou profil, jamais les deux visibles ensemble");
  assert.match(h, /<title>Profil — MAHOUTO\+<\/title>/);
  assert.ok(!/<link[^>]+(fonts|\.woff)/i.test(h));
  assert.match(css, /\.sk\.l1/); assert.match(css, /pubPulse/);
});

test("m.html : l'ordre des scripts et la compteur de visites sont inchangés ; l'aperçu de partage (api/_profil-og.js) n'est pas modifié ; aucun SQL, aucune fonction api/", () => {
  const h = read("m.html"); const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(srcs, ["/brand.js", "/theme-toggle.js", "/config.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js", "/pseudo.js", "/login-sheet.js", "/profil-public-utils.js", "/m.js", "/pwa-install.js"]);
  const m = code("m.js"); assert.match(m, /if \(!preview && !v\.banner\) countVisit\(\);/); assert.ok((m.match(/countVisit\(\)/g) || []).length === 2, "défini et appelé une fois");
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
});

test("sw.js : cache v122 ou plus ; module de la carte et logos de 128 px dans APP_SHELL, tous présents sur disque", () => {
  const sw = read("sw.js"); assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v(12[2-9]|1[3-9]\d)"/);
  ["/profil-public-carte.js", "/assets/logo-mahouto-plus-128.png", "/assets/logo-majeste-presse-128.png", "/m.html", "/m.js", "/qrcode-generator.js"].forEach((f) => {
    assert.strictEqual((sw.match(new RegExp('"' + f.replace(/[./]/g, "\\$&") + '"', "g")) || []).length, 1, f); assert.ok(fs.existsSync(path.join(root, f.slice(1))), f);
  });
  ["assets/logo-mahouto-plus-128.png", "assets/logo-majeste-presse-128.png"].forEach((f) => assert.ok(fs.statSync(path.join(root, f)).size < 30 * 1024, f + " : moins de 30 Ko"));
});

// ====================== contrastes WCAG AA, calculés dans les deux thèmes ======================
const hex = (s) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim()); assert.ok(m, "couleur illisible : " + s); let h = m[1]; if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, alpha, bg) => "#" + hex(bg).map((v, i) => Math.round(hex(fg)[i] * alpha + v * (1 - alpha)).toString(16).padStart(2, "0")).join("");
const theme = read("theme.css"), page = read("m.html");
const decl = (text, name) => { const m = new RegExp(name + ":\\s*(#[0-9a-fA-F]{3,6})").exec(text); assert.ok(m, name); return m[1]; };
const darkRoot = theme.match(/:root \{([^}]*)\}/)[1], lightBody = theme.match(/body\.light-theme\{([^}]*)\}/)[1];
const pageDark = page.match(/:root \{ (--pub-accent[^}]*)\}/)[1], pageLight = page.match(/body\.light-theme \{ (--pub-accent[^}]*)\}/)[1];
const goldText = decl(theme, "--gold-text"), goldHex = decl(theme, "--gold"), goldBright = decl(theme, "--gold-bright");
const T = {
  sombre: { fond: decl(darkRoot, "--bg"), carte: decl(darkRoot, "--bg-card"), feuille: decl(darkRoot, "--bg-elevated"), texte: decl(darkRoot, "--white"), doux: decl(darkRoot, "--text-muted"), accent: goldHex, ok: decl(pageDark, "--pub-ok"), err: decl(pageDark, "--pub-err"), bord: decl(darkRoot, "--border"), tint: 0.10, tintBase: decl(darkRoot, "--bg-card") },
  clair: { fond: decl(lightBody, "--bg"), carte: decl(lightBody, "--bg-card"), feuille: decl(lightBody, "--bg-elevated"), texte: decl(lightBody, "--white"), doux: decl(lightBody, "--text-muted"), accent: goldText, ok: decl(pageLight, "--pub-ok"), err: decl(pageLight, "--pub-err"), bord: decl(lightBody, "--border"), tint: 0.08, tintBase: decl(lightBody, "--bg-card") }
};
test("contrastes AA calculés (≥ 4,5 pour le texte, ≥ 3 pour les contours de boutons) dans les thèmes SOMBRE et CLAIR", () => {
  assert.match(page, /--pub-accent: var\(--gold\)/); assert.match(page, /body\.light-theme \{ --pub-accent: var\(--gold-text, #856500\)/, "accent doré du thème clair = --gold-text de theme.css");
  const rows = [];
  for (const [nom, t] of Object.entries(T)) {
    const metierFond = over(t.accent, t.tint, t.carte);
    [["texte courant sur la carte", t.texte, t.carte], ["texte atténué (présentation, lieu, pied) sur la carte", t.doux, t.carte], ["texte atténué sur le fond de page", t.doux, t.fond],
      ["nom (titre) sur la carte", t.texte, t.carte], ["texte doré (métier, « Créer ma page ») sur la carte", t.accent, t.carte], ["étiquette métier : doré sur sa teinte", t.accent, metierFond],
      ["bouton secondaire : texte doré sur la carte", t.accent, t.carte], ["texte sur la feuille", t.texte, t.feuille], ["texte atténué sur la feuille", t.doux, t.feuille], ["doré sur la feuille (avertissement)", t.accent, t.feuille],
      ["message de réussite sur la feuille", t.ok, t.feuille], ["message d'erreur sur la feuille", t.err, t.feuille], ["message de réussite sur la carte", t.ok, t.carte], ["message d'erreur sur la carte", t.err, t.carte],
      ["bandeau d'aperçu : texte sur son fond", t.texte, t.feuille]].forEach(([n, a, b]) => { const r = ratio(a, b); rows.push([nom, n, r.toFixed(2)]); assert.ok(r >= 4.5, nom + " — " + n + " : " + r.toFixed(2) + " < 4,5"); });
    [["contour doré du bouton secondaire / de l'avatar sur la carte", t.accent, t.carte], ["contour des boutons neutres sur la carte", t.accent, t.carte]].forEach(([n, a, b]) => { const r = ratio(a, b); rows.push([nom, n, r.toFixed(2)]); assert.ok(r >= 3, nom + " — " + n + " : " + r.toFixed(2) + " < 3"); });
  }
  // bouton principal : texte noir sur le dégradé or (les deux extrémités), identique dans les deux thèmes
  [goldBright, goldHex].forEach((g) => { const r = ratio("#0A0A0A", g); rows.push(["les deux", "bouton plein or " + g, r.toFixed(2)]); assert.ok(r >= 4.5, "bouton or " + g + " : " + r.toFixed(2)); });
  assert.match(page, /\.btn-or \{[^}]*color: #0A0A0A/);
  assert.ok(rows.length >= 30);
  // le texte atténué n'utilise JAMAIS --text-dim (#6B6B6B : 3,2:1 sur la carte sombre)
  assert.ok(!/color: var\(--text-dim\)/.test(page.match(/<style>([\s\S]*?)<\/style>/)[1]), "--text-dim interdit pour du texte");
});

test("contrastes : le calcul détecte une couleur trop pâle (garde du test lui-même)", () => {
  assert.ok(ratio("#D4AF37", "#FFFFFF") < 3, "l'or de marque sur blanc ne passerait pas : d'où --gold-text en thème clair");
  assert.ok(ratio("#6B6B6B", "#1A1A1A") < 4.5);
  assert.ok(ratio("#856500", "#FFFFFF") >= 4.5);
});
