/* Tests du métré construction — exécution : node tests/metre-calc.test.js
   Aucune dépendance. Les valeurs attendues du scénario de référence ont été
   calculées à la main (voir les commentaires), pas recopiées de la sortie du moteur. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Calc = require("../metre-calc");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (e) { console.error("  ÉCHEC  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 0.01 : eps), a + " ≠ " + b);
const qty = (res, id) => { const l = res.lines.find((x) => x.id === id); return l ? l.qty : 0; };

/* Scénario de référence : salon 600 + chambre 300 + cuisine 300 = 1200 × 400 cm,
   murs de 210 cm, parpaings 40 × 20 × 15, 3 portes, 4 fenêtres, toiture en tôle. */
function ref() { return clone(Calc.DEFAULTS); }

console.log("Saisie et affichage");
test("parseNum accepte espaces, virgule décimale et refuse le reste", () => {
  assert.strictEqual(Calc.parseNum("1 200").value, 1200);
  assert.strictEqual(Calc.parseNum("2,5").value, 2.5);
  assert.strictEqual(Calc.parseNum("").empty, true);
  assert.ok(Calc.parseNum("abc").error);
  assert.ok(Calc.parseNum("-3").error);
  assert.ok(Calc.parseNum("2,5", { integer: true }).error);
  assert.ok(Calc.parseNum("5", { min: 10 }).error);
  assert.ok(Calc.parseNum("50", { max: 10 }).error);
  assert.ok(Calc.parseNum("1e999").error);
});
test("fmtNum et fmtMoney ne produisent jamais NaN ni -0", () => {
  assert.strictEqual(Calc.fmtNum(1234567), "1 234 567");
  assert.strictEqual(Calc.fmtNum(-0.2), "0");
  assert.strictEqual(Calc.fmtNum(NaN), "—");
  assert.strictEqual(Calc.fmtNum(6.04, 1), "6,0");
  assert.strictEqual(Calc.fmtMoney(1500), "1 500 FCFA");
  assert.strictEqual(Calc.fmtMoney(Infinity), "—");
});

console.log("Scénario de référence 1200 × 400 cm");
test("géométrie : murs, ouvertures, surface nette", () => {
  const res = Calc.compute(ref()), r = res.r;
  assert.strictEqual(res.ready, true);
  near(r.wallLength, 40);                 // 2 × (12 + 4) + 2 refends × 4 m
  near(r.grossArea, 84);                  // 40 × 2,10
  near(r.openArea, 11.16);                // 3 × 0,9 × 2,0 + 4 × 1,2 × 1,2
  near(r.netArea, 72.84);
  near(r.density, 1 / (0.42 * 0.21), 1e-6);
});
test("parpaings : murs + soubassement + 8 % de casse", () => {
  const r = Calc.compute(ref()).r;
  near(r.blocksWalls, 72.84 / (0.42 * 0.21), 0.01);   // ≈ 825,9
  near(r.blocksBase, (40 / 0.42) * 3, 0.01);          // ≈ 285,7
  assert.strictEqual(r.blocks, Math.ceil((825.85 + 285.71) * 1.08 - 1e-9)); // 1201
});
test("béton : semelle, dalle, chaînages, poteaux, linteaux", () => {
  const r = Calc.compute(ref()).r, p = r.concreteParts;
  near(p.footing, 40 * 0.4 * 0.2);                           // 3,2
  near(p.slab, ((12 - 0.3) * (4 - 0.3) - 2 * 0.15 * 3.7) * 0.1); // 4,218
  near(p.ties, 2 * 40 * 0.15 * 0.2);                         // 2,4
  assert.strictEqual(r.postCount, 14);                       // 40 / 3
  near(p.posts, 14 * 0.15 * 0.15 * (2.1 + 0.8));             // 0,9135
  near(p.lintels, (3 * 1.3 + 4 * 1.6) * 0.15 * 0.2);         // 0,309
  near(r.concrete, 11.04 * 1.05, 0.01);
});
test("fer, ciment, sable et gravier", () => {
  const res = Calc.compute(ref()), r = res.r;
  near(r.steel8, 320 + 14 * 2.9 * 4 + 120, 0.01);            // 602,4 m
  assert.strictEqual(r.bars8, 56);                           // 602,4 × 1,10 / 12
  assert.strictEqual(r.bars6, 26);
  assert.strictEqual(r.cementBags, 116);                     // ≈ 110,1 sacs × 1,05
  assert.strictEqual(r.sand, 11);
  assert.strictEqual(r.gravel, 10);
  assert.strictEqual(qty(res, "cement"), 116);
});
test("toiture en tôle : surface, tôle, charpente et avertissement de portée", () => {
  const res = Calc.compute(ref()), r = res.r;
  near(r.roofArea, 12.8 * 4.8 * Math.sqrt(1.01), 0.01);
  assert.strictEqual(r.sheetArea, 68);
  assert.strictEqual(r.rafters, 23);
  assert.ok(res.warnings.some((w) => /charpentier/.test(w)), "avertissement de portée attendu pour 6 m");
});
test("cuisine : carrelage, colle, évier", () => {
  const res = Calc.compute(ref());
  near(res.r.tileNet, (3 - 0.15) * (4 - 0.3), 0.01);         // 10,545 m²
  assert.strictEqual(qty(res, "sink"), 1);
  assert.strictEqual(qty(res, "tileGlue"), 3);
});
test("aucune valeur non finie dans le résultat", () => {
  const res = Calc.compute(ref());
  (function walk(o, p) {
    if (typeof o === "number") assert.ok(isFinite(o), "non fini en " + p);
    else if (o && typeof o === "object") Object.keys(o).forEach((k) => walk(o[k], p + "." + k));
  })(res.r, "r");
  res.lines.forEach((l) => assert.ok(l.qty > 0 && isFinite(l.qty), l.id));
});

console.log("Variations");
test("une seule pièce 394 × 400 : pas de refend, moins de matériaux", () => {
  const s = ref();
  s.rooms = [{ name: "Chambre", type: "chambre", length: "394", tiled: false }];
  s.doors = "1"; s.windows = "1";
  const res = Calc.compute(s), full = Calc.compute(ref());
  near(res.r.wallLength, 2 * (3.94 + 4));
  assert.ok(res.r.blocks < full.r.blocks / 2);
  assert.ok(res.r.cementBags < full.r.cementBags / 2);
  assert.strictEqual(qty(res, "sink"), 0);
  assert.strictEqual(qty(res, "tiles"), 0);
  assert.ok(!res.warnings.some((w) => /charpentier/.test(w)), "pas d'avertissement de portée à 3,94 m");
});
test("parpaing de 20 cm : même nombre de blocs, plus de béton et de mortier", () => {
  const s = ref(); s.blockThickness = "20";
  const a = Calc.compute(s).r, b = Calc.compute(ref()).r;
  assert.strictEqual(a.blocks, b.blocks);
  assert.ok(a.concrete > b.concrete && a.mortar > b.mortar);
});
test("plus de portes et fenêtres : moins de parpaings", () => {
  const s = ref(); s.doors = "5"; s.windows = "8";
  assert.ok(Calc.compute(s).r.blocks < Calc.compute(ref()).r.blocks);
});
test("sans enduit : moins de ciment", () => {
  const s = ref(); s.plaster = false;
  const a = Calc.compute(s), b = Calc.compute(ref());
  assert.strictEqual(a.r.plaster, 0);
  assert.ok(a.r.cementBags < b.r.cementBags);
});
test("dalle de toiture : plus de béton et de fer, pas de tôle, avertissement", () => {
  const s = ref(); s.roofType = "dalle";
  const a = Calc.compute(s), b = Calc.compute(ref());
  assert.strictEqual(qty(a, "sheet"), 0);
  assert.ok(a.r.concrete > b.r.concrete);
  assert.ok(a.r.bars8 > b.r.bars8);
  assert.ok(a.warnings.some((w) => /dalle/i.test(w)));
});
test("champs facultatifs vides comptent pour zéro", () => {
  const s = ref(); s.doors = ""; s.windows = ""; s.sockets = ""; s.fill = ""; s.pvcLength = "";
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, true);
  assert.strictEqual(qty(res, "doors"), 0);
  assert.strictEqual(qty(res, "pvc"), 0);
});
test("remblai saisi : ligne ajoutée", () => {
  const s = ref(); s.fill = "6,5";
  assert.strictEqual(qty(Calc.compute(s), "fill"), 6.5);
});

console.log("Validation");
test("dimension manquante ou invalide : pas de résultat, message clair", () => {
  const s = ref(); s.depth = ""; s.wallHeight = "abc"; s.rooms[1].length = "10";
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, false);
  assert.ok(res.errors.depth && res.errors.wallHeight && res.errors["rooms.1.length"]);
  assert.strictEqual(res.r, null);
});
test("aucune pièce, épaisseur de parpaing inconnue, type de toiture inconnu", () => {
  const a = ref(); a.rooms = [];
  assert.ok(Calc.compute(a).errors.rooms);
  const b = ref(); b.blockThickness = "17";
  assert.ok(Calc.compute(b).errors.blockThickness);
  const c = ref(); c.roofType = "paille";
  assert.ok(Calc.compute(c).errors.roofType);
});
test("ouvertures plus grandes que les murs : refus", () => {
  const s = ref(); s.doors = "30"; s.windows = "40"; s.windowW = "300"; s.windowH = "250";
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, false);
  assert.ok(res.errors.doors);
});
test("compute ne modifie pas l'état fourni et ne plante pas sur une entrée vide", () => {
  const s = ref(), copy = clone(s);
  Calc.compute(s);
  assert.deepStrictEqual(s, copy);
  assert.strictEqual(Calc.compute(null).ready, false);
  assert.strictEqual(Calc.compute({}).ready, false);
});

console.log("Budget");
test("prix partiels : total partiel, lignes manquantes signalées", () => {
  const res = Calc.compute(ref());
  const b = Calc.budget(res, { blocks: "300", cement: "6 500" }, "", 10);
  assert.strictEqual(b.rows.find((r) => r.id === "blocks").total, 1201 * 300);
  assert.strictEqual(b.rows.find((r) => r.id === "cement").total, 116 * 6500);
  assert.strictEqual(b.materials, 1201 * 300 + 116 * 6500);
  assert.strictEqual(b.complete, false);
  assert.ok(b.missing.includes("sand") && !b.missing.includes("blocks"));
  assert.strictEqual(b.total, b.materials + Math.round(b.materials * 0.10));
});
test("main-d'œuvre et imprévus", () => {
  const res = Calc.compute(ref());
  const b = Calc.budget(res, { blocks: "300" }, "1 500 000", 10);
  const base = 1201 * 300 + 1500000;
  assert.strictEqual(b.labour, 1500000);
  assert.strictEqual(b.contingency, Math.round(base * 0.1));
  assert.strictEqual(b.total, base + Math.round(base * 0.1));
});
test("tous les prix saisis : budget complet ; somme des groupes = matériaux", () => {
  const res = Calc.compute(ref()), prices = {};
  res.lines.forEach((l) => { prices[l.id] = "100"; });
  const b = Calc.budget(res, prices, "", 0);
  assert.strictEqual(b.complete, true);
  assert.strictEqual(Object.values(b.groups).reduce((a, x) => a + x, 0), b.materials);
  assert.strictEqual(b.total, b.materials);
});
test("prix invalide : erreur sur la ligne, jamais NaN", () => {
  const res = Calc.compute(ref());
  const b = Calc.budget(res, { blocks: "abc", cement: "-5" }, "x", 10);
  assert.strictEqual(b.ok, false);
  assert.ok(b.errors.blocks && b.errors.cement && b.errors.labour);
  assert.ok(isFinite(b.total));
});

console.log("Intégration de la page");
test("metre.html charge le moteur et n'utilise pas innerHTML", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "metre.html"), "utf8");
  assert.ok(/<script src="metre-calc\.js"><\/script>/.test(html));
  assert.ok(!/\.innerHTML\s*=/.test(html), "innerHTML interdit (texte saisi par l'utilisateur)");
});
test("la page est dans le cache hors ligne et liée depuis l'accueil", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.ok(sw.includes('"/metre.html"') && sw.includes('"/metre-calc.js"'));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(idx.includes('href="metre.html"'));
});

console.log("\n" + passed + " tests réussis" + (process.exitCode ? " — des échecs ont eu lieu" : ""));
