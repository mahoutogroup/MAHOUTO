/* Accroche de l'accueil (marque MAJESTÉ PRESSE) : une seule phrase, les deux anciennes lignes retirées.
   Exécution : node tests/accroche-accueil.test.js — aucune dépendance, aucun réseau. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

const NEW_LINE = "Imprimeurs et sérigraphes : votre plateforme pour vendre, apprendre et échanger.";

// brand.js est exécuté tel quel, avec un navigateur minimal : on lit les marques par hôte.
function brandFor(host) {
  const sandbox = {
    console,
    location: { hostname: "mahouto.com", search: "" },
    document: { readyState: "complete", documentElement: { style: {} }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createTreeWalker() { return { nextNode() { return false; } }; } },
    setTimeout() {},
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("brand.js"), sandbox);
  return sandbox.MAHOUTO_BRAND_BY_HOST(host);
}

test("MAJESTÉ PRESSE : l'accroche est la phrase unique demandée, le sous-titre d'accueil est masqué", () => {
  const b = brandFor("majestepresse.com");
  assert.strictEqual(b.tagline, NEW_LINE);
  assert.strictEqual(b.hideHomeSubtagline, true);
  assert.strictEqual(b.name, "MAJESTÉ PRESSE");
});

test("l'ancienne ligne « Informer • Former • Inspirer » n'est plus l'accroche de l'accueil", () => {
  assert.ok(!/Informer • Former • Inspirer/.test(read("brand.js")));
  assert.notStrictEqual(brandFor("majestepresse.com").tagline, "Informer • Former • Inspirer");
});

test("MAHOUTO+ (défaut) : accueil inchangé, sous-titre non masqué", () => {
  const b = brandFor("mahouto.com");
  assert.strictEqual(b.tagline, "Apprendre • Créer • Entreprendre");
  assert.strictEqual(b.subtitle, "Construire l'Afrique numérique de demain.");
  assert.ok(!b.hideHomeSubtagline);
  assert.strictEqual(brandFor("localhost").id, "mahouto");
});

test("brand.js : le sous-titre d'accueil est masqué par display:none (HTML conservé), sans effet sur share.html", () => {
  const code = read("brand.js");
  assert.match(code, /if \(sub && brand\.hideHomeSubtagline\) sub\.style\.setProperty\("display", "none", "important"\);\s*else if \(sub && brand\.subtitle\) sub\.textContent = brand\.subtitle;/);
  assert.match(code, /shareSub && brand\.subtitle\) shareSub\.textContent = brand\.subtitle;/);
});

test("accueil : titre, logo et boutons de connexion inchangés ; mêmes classes (couleurs) pour l'accroche", () => {
  const html = read("index.html");
  assert.match(html, /<h1>MAHOUTO<span class="plus">\+<\/span><\/h1>/);
  assert.match(html, /<p class="tagline">Apprendre • Créer • Entreprendre<\/p>/);
  assert.match(html, /\.hero \.tagline \{ font-size: 14px; color: var\(--white\); margin-top: 8px; font-weight: 600; \}/);
  assert.match(html, /id="btn-login-google"/);
});

test("MAJESTÉ PRESSE : une seule source de texte — sous-titre (share.html) = accroche de l'accueil = description du manifeste", () => {
  const b = brandFor("majestepresse.com");
  assert.strictEqual(b.subtitle, NEW_LINE);
  assert.strictEqual(b.subtitle, b.tagline);
  assert.strictEqual(b.hideHomeSubtagline, true);
  const code = read("brand.js");
  assert.strictEqual((code.match(/Imprimeurs et sérigraphes : votre plateforme pour vendre, apprendre et échanger\./g) || []).length, 1, "la phrase n'est écrite qu'une fois dans brand.js");
  const manifest = JSON.parse(read("manifest-majeste.json"));
  assert.strictEqual(manifest.description, "MAJESTÉ PRESSE – " + NEW_LINE);
  assert.strictEqual(manifest.name, "MAJESTÉ PRESSE");
  // share.html lit la valeur de la marque (brand.js) au lieu de la dupliquer
  assert.match(code, /shareSub && brand\.subtitle\) shareSub\.textContent = brand\.subtitle;/);
  assert.ok(!/Imprimeurs et sérigraphes/.test(read("share.html")), "share.html ne duplique pas la phrase");
});

test("MAHOUTO+ inchangé : sous-titre de share.html par défaut et marque MAHOUTO+", () => {
  assert.match(read("share.html"), /L'Afrique qui apprend, crée et entreprend\./);
  assert.strictEqual(brandFor("mahouto.com").subtitle, "Construire l'Afrique numérique de demain.");
});

test("« Informer • Former • Inspirer » et « La presse qui éclaire » n'apparaissent dans AUCUN texte affiché de la marque MAJESTÉ PRESSE", () => {
  const OLD = /Informer\s*(?:•|,)\s*[Ff]ormer\s*(?:•|,)\s*[Ii]nspirer|presse qui éclaire|savoir qui élève/i;
  const files = [];
  (function scan(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if ([".git", "node_modules", "tests", "migrations"].includes(e.name)) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return scan(p);
      if (/\.(html|js|json|css)$/.test(e.name)) files.push(path.relative(root, p));
    });
  })(root);
  assert.ok(files.includes("manifest-majeste.json") && files.includes("brand.js") && files.includes("share.html"));
  const bad = files.filter((f) => OLD.test(read(f)));
  assert.deepStrictEqual(bad, []);
  const b = brandFor("majestepresse.com");
  Object.keys(b).forEach((k) => { if (typeof b[k] === "string") assert.ok(!OLD.test(b[k]), "brand." + k); });
});

test("cache hors ligne : brand.js et index.html dans le shell, version ≥ v100", () => {
  const sw = read("sw.js");
  assert.match(sw, /"\/brand\.js"/);
  assert.match(sw, /"\/index\.html"/);
  assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 100);
});

console.log("\n" + passed + " test(s) réussi(s)");
