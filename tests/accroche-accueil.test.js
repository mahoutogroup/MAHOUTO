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

test("cache hors ligne : brand.js et index.html dans le shell, version ≥ v98", () => {
  const sw = read("sw.js");
  assert.match(sw, /"\/brand\.js"/);
  assert.match(sw, /"\/index\.html"/);
  assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 98);
});

console.log("\n" + passed + " test(s) réussi(s)");
