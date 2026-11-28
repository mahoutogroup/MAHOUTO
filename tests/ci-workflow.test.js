/* Tests automatiques (GitHub Actions) : .github/workflows/tests.yml. Lecture statique : aucun réseau, aucun secret. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const WF = read(".github/workflows/tests.yml");
const body = WF.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

test("workflow : déclenché sur pull_request et sur push vers main, droits en lecture seule", () => {
  assert.match(body, /^on:\n  pull_request:\n  push:\n    branches: \[main\]/m);
  assert.match(body, /^permissions:\n  contents: read\n/m);
  assert.ok(!/write/.test(body.replace(/Lancer les tests/, "")), "aucun droit d'écriture");
});
test("workflow : checkout, Node 20, puis node --test tests/*.test.js ; aucune installation, aucun secret", () => {
  assert.match(body, /uses: actions\/checkout@v4/);
  assert.match(body, /uses: actions\/setup-node@v4\n\s+with:\n\s+node-version: 20\n/);
  assert.match(body, /run: node --test tests\/\*\.test\.js/);
  assert.ok(!/npm (install|ci)/.test(body), "les tests utilisent de faux modules : aucune installation (vérifié dans un clone propre)");
  assert.ok(!/secrets\.|\$\{\{\s*env\./.test(body), "aucun secret");
  assert.ok(body.indexOf("actions/checkout") < body.indexOf("actions/setup-node") && body.indexOf("actions/setup-node") < body.indexOf("node --test"), "ordre des étapes");
});
test("package.json : aucun champ engines (la version de Node de Vercel n'est pas influencée) ", () => {
  const pkg = JSON.parse(read("package.json")); assert.ok(!("engines" in pkg));
});
