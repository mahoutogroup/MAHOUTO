/* Guide de l'entrepreneur (entrepreneur.html) : page statique, sans base de données ni appel réseau.
   Exécution : node tests/entrepreneur.test.js — aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

const page = read("entrepreneur.html");
const index = read("index.html");
const sw = read("sw.js");

test("la page existe, avec titre, description et accordéons (9 rubriques)", () => {
  assert.ok(fs.existsSync(path.join(root, "entrepreneur.html")));
  assert.match(page, /<title>Guide de l'entrepreneur — MAHOUTO\+<\/title>/);
  assert.match(page, /<meta name="description" content="Guide simple pour les entrepreneurs/);
  assert.strictEqual((page.match(/<details/g) || []).length, 9);
  assert.strictEqual((page.match(/<\/details>/g) || []).length, 9);
  assert.strictEqual((page.match(/<summary>/g) || []).length, 9);
  assert.strictEqual((page.match(/<table/g) || []).length, (page.match(/<\/table>/g) || []).length);
});

test("page statique : aucun appel réseau, aucune base, aucune clé", () => {
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|supabase|createClient|\.rpc\(|\.from\(|Authorization|Bearer|sk_live|sk_test|api[_-]?key/i.test(page));
  assert.ok(!/<form|<input|innerHTML|document\.write|eval\(/.test(page));
  // seuls scripts : modules partagés du site (aucun script externe, aucun script inline)
  const scripts = [...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  scripts.forEach((m) => {
    assert.match(m[1], /src="[a-z-]+\.js"/, "script local seulement : " + m[0].slice(0, 60));
    assert.strictEqual(m[2].trim(), "");
  });
  assert.deepStrictEqual(scripts.map((m) => /src="([^"]+)"/.exec(m[1])[1]), ["brand.js", "theme-toggle.js", "config.js", "pwa-install.js"]);
});

test("tous les fichiers et pages référencés existent (liens, icônes, manifeste, feuilles de style, scripts)", () => {
  const refs = new Set();
  for (const m of page.matchAll(/(?:href|src)="([^"#?]+)"/g)) if (!/^(https?:|mailto:|tel:)/.test(m[1])) refs.add(m[1]);
  assert.ok(refs.has("index.html") && refs.has("ai.html") && refs.has("mentions-legales.html") && refs.has("manifest.json"));
  refs.forEach((r) => assert.ok(fs.existsSync(path.join(root, r)), "introuvable : " + r));
});

test("les styles employés existent dans theme.css (variables) et l'enregistrement du service worker est présent", () => {
  const css = read("theme.css");
  const used = new Set([...page.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]));
  used.forEach((v) => assert.ok(new RegExp("--" + v + "\\s*:").test(css), "variable CSS manquante : --" + v));
  assert.match(page, /<script src="pwa-install\.js"><\/script>\s*<\/body>/);
  assert.match(read("pwa-install.js"), /serviceWorker\.register\("\/sw\.js"\)/);
});

test("compatible avec la politique de sécurité du site : styles et scripts en ligne autorisés, aucune ressource externe", () => {
  const csp = (JSON.parse(read("vercel.json")).headers[0].headers.find((h) => /Content-Security-Policy/.test(h.key)) || {}).value || "";
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.ok(!/(?:href|src)="https?:/.test(page), "aucune ressource externe");
});

test("service worker : /entrepreneur.html dans APP_SHELL, version du cache ≥ v103", () => {
  const shell = sw.slice(sw.indexOf("const APP_SHELL = ["), sw.indexOf("];", sw.indexOf("const APP_SHELL = [")));
  assert.match(shell, /"\/entrepreneur\.html"/);
  assert.strictEqual((shell.match(/"\/entrepreneur\.html"/g) || []).length, 1);
  assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 103);
});

test("accueil : une seule icône ic-briefcase, une carte « Guide de l'entrepreneur » vers entrepreneur.html, même structure que les cartes voisines", () => {
  assert.strictEqual((index.match(/id="ic-briefcase"/g) || []).length, 1);
  const card = /<a class="card module-card" href="entrepreneur\.html">([\s\S]*?)<\/a>/.exec(index);
  assert.ok(card, "carte absente");
  assert.match(card[1], /<svg class="ico mc-arrow" aria-hidden="true"><use href="#ic-arrow"\/><\/svg>/);
  assert.match(card[1], /<svg class="ico mc-ico" aria-hidden="true"><use href="#ic-briefcase"\/><\/svg>/);
  assert.match(card[1], /<h2>Guide de l'entrepreneur<\/h2>/);
  assert.match(card[1], /<p>Société ou entreprise individuelle : papiers, comptes, impôts\.<\/p>/);
  // dans la grille des modules, à côté de la Boutique
  assert.ok(index.indexOf('href="produits.html"') < index.indexOf('href="entrepreneur.html"'));
  assert.ok(index.indexOf('href="entrepreneur.html"') < index.indexOf("Institut SAYÉ LOUIS"));
  // le symbole utilisé est bien défini dans le sprite de l'accueil
  assert.ok(index.indexOf('id="ic-briefcase"') < index.indexOf('href="entrepreneur.html"'));
});

test("aucune donnée personnelle ni d'entreprise réelle dans le guide (exemples fictifs signalés)", () => {
  assert.match(page, /Exemple : les chiffres sont inventés\./);
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}|\+?\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}/i.test(page.replace(/monentreprise\.bj/, "")), "ni e-mail ni numéro de téléphone");
});

console.log("\n" + passed + " test(s) réussi(s)");
