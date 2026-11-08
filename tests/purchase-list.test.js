/* Achats affichés dans « Ma bibliothèque » : règle de tri (fonction pure). Exécution : node tests/purchase-list.test.js */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../purchase-list");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}
const NOW = Date.parse("2026-11-10T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const ago = (ms) => new Date(NOW - ms).toISOString();
const P = (id, status, ageMs, course, type) => ({ id, status, created_at: ago(ageMs), course_id: course || "a", product_type: type || "salon" });
const ids = (list) => L.visiblePurchases(list, NOW).map((p) => p.id);

test("pending récent (moins de 3 jours) : affiché", () => {
  assert.deepStrictEqual(ids([P(1, "pending", 2 * 3600 * 1000), P(2, "pending", 2 * DAY + 23 * 3600 * 1000)]), [1, 2]);
});
test("pending ancien (plus de 3 jours) : masqué", () => {
  assert.deepStrictEqual(ids([P(1, "pending", 3 * DAY + 1), P(2, "pending", 49 * DAY)]), []);
});
test("limite : exactement 3 jours encore affiché, 3 jours et 1 ms masqué", () => {
  assert.deepStrictEqual(ids([P(1, "pending", 3 * DAY)]), [1]);
  assert.deepStrictEqual(ids([P(1, "pending", 3 * DAY + 1)]), []);
  assert.strictEqual(L.MAX_PENDING_AGE_MS, 3 * DAY);
});
test("pending masqué, même récent, si un paid existe pour le même article (même course_id et même type)", () => {
  assert.deepStrictEqual(ids([P(1, "pending", 3600 * 1000, "vip"), P(2, "paid", 5 * DAY, "vip")]), [2]);
  assert.deepStrictEqual(ids([P(1, "pending", 60 * DAY, "vip"), P(2, "paid", 5 * DAY, "vip")]), [2]);
});
test("un paid d'un AUTRE article ou d'un autre type ne masque pas le pending", () => {
  assert.deepStrictEqual(ids([P(1, "pending", 3600 * 1000, "vip", "salon"), P(2, "paid", DAY, "autre", "salon")]), [1, 2]);
  assert.deepStrictEqual(ids([P(1, "pending", 3600 * 1000, "x", "salon"), P(2, "paid", DAY, "x", "formation")]), [1, 2]);
});
test("paid : toujours affiché, quel que soit son âge", () => {
  assert.deepStrictEqual(ids([P(1, "paid", 400 * DAY), P(2, "paid", 0)]), [1, 2]);
});
test("failed (et statut inconnu) : jamais affichés", () => {
  assert.deepStrictEqual(ids([P(1, "failed", 1000), P(2, "failed", 90 * DAY), P(3, "refunded", 1000), P(4, undefined, 1000)]), []);
});
test("paiement tardif : un ancien pending devenu paid réapparaît", () => {
  const before = [P(1, "pending", 10 * DAY, "vip")];
  assert.deepStrictEqual(ids(before), []);
  assert.deepStrictEqual(ids([Object.assign({}, before[0], { status: "paid" })]), [1]);
});
test("liste mélangée : ordre conservé, entrée non modifiée, tous les types d'achat", () => {
  const list = [
    P(1, "pending", 1000, "vip", "salon"), P(2, "paid", 2 * DAY, "vip", "salon"), P(3, "pending", 22 * DAY, "f1", "formation"),
    P(4, "pending", DAY, "f2", "formation"), P(5, "failed", 100, "p1", "digital_product"), P(6, "pending", 4 * DAY, "p2", "digital_product"),
    P(7, "paid", 90 * DAY, "p3", "digital_product")
  ];
  const copy = JSON.stringify(list);
  assert.deepStrictEqual(ids(list), [2, 4, 7]);
  assert.strictEqual(JSON.stringify(list), copy);
});
test("date absente ou illisible, date dans le futur : pas de preuve d'ancienneté, le pending reste affiché", () => {
  assert.deepStrictEqual(ids([{ id: 1, status: "pending", created_at: null, course_id: "a", product_type: "salon" }, { id: 2, status: "pending", created_at: "pas une date", course_id: "b", product_type: "salon" }, P(3, "pending", -DAY, "c")]), [1, 2, 3]);
});
test("entrées invalides : pas d'exception", () => {
  assert.deepStrictEqual(L.visiblePurchases(undefined, NOW), []);
  assert.deepStrictEqual(L.visiblePurchases([null, undefined], NOW), []);
  assert.ok(Array.isArray(L.visiblePurchases([P(1, "paid", 0)])));
});
test("mes-achats.html : utilise la fonction, avant le calcul des sections ; aucune écriture en base ; sw.js", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "mes-achats.html"), "utf8");
  assert.match(html, /<script src="purchase-list\.js"><\/script>/);
  assert.match(html, /const purchases = MahoutoPurchaseList\.visiblePurchases\(data\.purchases\);/);
  const render = html.slice(html.indexOf("function renderAll"));
  assert.ok(render.indexOf("visiblePurchases") < render.indexOf('p.product_type === "formation"'));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(html), "aucune écriture");
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(fs.readFileSync(path.join(root, "purchase-list.js"), "utf8")));
  assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /"\/purchase-list\.js"/);
});
console.log("\n" + passed + " test(s) réussi(s)");
