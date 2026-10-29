/* Tests du calculateur de devis — exécution : node tests/serigraphie-calculateur.test.js
   Aucune dépendance. Écrit deux .docx d'exemple dans le dossier indiqué par OUT_DIR (défaut : /tmp/docx-out). */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Calc = require("../serigraphie-calc");
const Docs = require("../serigraphie-docs");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (e) { console.error("  ÉCHEC  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 0.01), a + " ≠ " + b);

function scenario() {
  const s = clone(Calc.DEFAULTS);
  s.order.qty = "150"; s.order.unitPrice = "1500"; s.order.client = "Client Test"; s.order.ref = "DV-001"; s.order.date = "2026-10-28";
  s.order.designation = "T-shirts personnalisés";
  s.garments.mode = "lot"; s.garments.lotPrice = "11000"; s.garments.lotSize = "12"; s.garments.transport = "2000"; s.garments.quality = "280 g";
  s.dtf.logosPerGarment = "2"; s.dtf.sheets = [{ format: "A4", capacity: "6", price: "500", logos: "" }];
  s.serigraphie = [{ label: "Consommables", kind: "consommable", amount: "7000" }];
  s.other = [];
  return s;
}
function allFinite(o, p) {
  if (typeof o === "number") assert.ok(isFinite(o), "Valeur non finie en " + p);
  else if (o && typeof o === "object") Object.keys(o).forEach((k) => allFinite(o[k], p + "." + k));
}

console.log("Scénario de référence (150 T-shirts)");
test("quantités, DTF et dépenses attendues", () => {
  const res = Calc.compute(scenario()), r = res.r;
  assert.strictEqual(res.ready, true);
  assert.strictEqual(r.lots, 13);
  assert.strictEqual(r.bought, 156);
  assert.strictEqual(r.remaining, 6);
  assert.strictEqual(r.totalLogos, 300);
  assert.strictEqual(r.dtfSheets, 50);
  assert.strictEqual(r.dtfTotal, 25000);
  assert.strictEqual(r.garmentsCost, 143000);
  assert.strictEqual(r.totalCash, 177000);
  assert.strictEqual(r.revenue, 225000);
  assert.strictEqual(r.cashDiff, 48000);
});
test("méthode prorata : bénéfice imputé distinct de la trésorerie", () => {
  const r = Calc.compute(scenario()).r;
  near(r.garmentsAllocated, 145000 * 150 / 156);
  near(r.stockValue, 145000 * 6 / 156);
  near(r.imputedCost, 171423.08);
  near(r.profit, 53576.92);
  near(r.margin, 23.81, 0.01);
  near(r.profit - r.cashDiff, r.stockValue);   // bénéfice = trésorerie + stock
  near(r.unitCost, 171423.08 / 150);
  assert.strictEqual(r.unitCash, 177000 / 150);
  assert.strictEqual(r.profitPerGarment, r.profit / 150);
});
test("méthode prudente : tout est imputé, le stock n'est pas valorisé", () => {
  const s = scenario(); s.method = "full";
  const r = Calc.compute(s).r;
  assert.strictEqual(r.imputedCost, 177000);
  assert.strictEqual(r.stockValue, 0);
  assert.strictEqual(r.profit, 48000);
});
test("prix conseillé : marge 30 %, arrondi au multiple de 25 F supérieur", () => {
  const r = Calc.compute(scenario()).r;
  near(r.recommendedRaw, r.unitCost / 0.7);
  assert.strictEqual(r.recommended, 1650);
  assert.ok(r.recommendedMargin >= 30);
});
test("un seul objectif à la fois : par vêtement et total", () => {
  const a = scenario(); a.target = { mode: "perGarment", value: "200" };
  const ra = Calc.compute(a).r; near(ra.recommendedRaw, ra.unitCost + 200); assert.strictEqual(ra.recommended % 25, 0);
  const b = scenario(); b.target = { mode: "total", value: "60000" };
  const rb = Calc.compute(b).r; near(rb.recommendedRaw, (rb.imputedCost + 60000) / 150);
  assert.ok(rb.recommendedProfit >= 60000);
});

console.log("Cas limites et saisies invalides");
test("quantité vide, nulle, négative ou décimale", () => {
  ["", "0", "-5", "abc", "2.5"].forEach((q) => {
    const s = scenario(); s.order.qty = q;
    const res = Calc.compute(s);
    assert.strictEqual(res.ready, false, "qty=" + q);
    assert.ok(res.errors["order.qty"], "erreur attendue pour qty=" + q);
    allFinite(res.r, "r");
  });
});
test("prix négatif refusé", () => {
  const s = scenario(); s.order.unitPrice = "-100";
  const res = Calc.compute(s);
  assert.ok(res.errors["order.unitPrice"]); assert.strictEqual(res.ready, false);
  const s2 = scenario(); s2.garments.lotPrice = "-1";
  assert.ok(Calc.compute(s2).errors["garments.lotPrice"]);
});
test("saisie avec espaces et virgule", () => {
  assert.strictEqual(Calc.parseAmount("11 000").value, 11000);
  assert.strictEqual(Calc.parseAmount("2,5").value, 2.5);
  assert.ok(Calc.parseAmount("1e5").error);
});
test("aucune dépense de sérigraphie", () => {
  const s = scenario(); s.serigraphie = [];
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, true); assert.strictEqual(res.r.serTotal, 0);
  assert.strictEqual(res.r.totalCash, 170000);
});
test("plusieurs dépenses personnalisées additionnées", () => {
  const s = scenario();
  s.serigraphie.push({ label: "Encre blanche", kind: "consommable", amount: "1 500" }, { label: "Main-d'œuvre", kind: "main_oeuvre", amount: "5000" });
  s.other = [{ label: "Livraison", amount: "3000" }, { label: "Emballage", amount: "800" }, { label: "Commission", amount: "2 200" }];
  const r = Calc.compute(s).r;
  assert.strictEqual(r.serTotal, 13500); assert.strictEqual(r.otherTotal, 6000); assert.strictEqual(r.totalCash, 143000 + 2000 + 25000 + 13500 + 6000);
});
test("prix de vente inférieur au coût de revient : avertissement, pas d'erreur", () => {
  const s = scenario(); s.order.unitPrice = "900";
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, true); assert.ok(res.r.profit < 0);
  assert.ok(res.warnings.some((w) => /déficitaire/.test(w)));
});
test("prix de vente vide : coûts calculés, pas de bénéfice", () => {
  const s = scenario(); s.order.unitPrice = "";
  const res = Calc.compute(s);
  assert.strictEqual(res.ready, true); assert.strictEqual(res.r.revenue, null); assert.strictEqual(res.r.profit, null);
  assert.ok(res.r.recommended > 0);
});
test("quantité achetée inférieure à la commande : erreur", () => {
  const s = scenario(); s.garments.boughtQty = "100";
  assert.ok(Calc.compute(s).errors["garments.boughtQty"]);
});
test("quantité achetée supérieure : lots arrondis au supérieur", () => {
  const s = scenario(); s.garments.boughtQty = "160";
  const r = Calc.compute(s).r;
  assert.strictEqual(r.lots, 14); assert.strictEqual(r.bought, 168); assert.strictEqual(r.remaining, 18);
});
test("achat à l'unité", () => {
  const s = scenario(); s.garments.mode = "unit"; s.garments.unitPrice = "950";
  const r = Calc.compute(s).r;
  assert.strictEqual(r.bought, 150); assert.strictEqual(r.remaining, 0); assert.strictEqual(r.garmentsCost, 142500);
  assert.strictEqual(r.garmentsAllocated, 142500 + 2000);
});
test("feuilles de capacités différentes + reste automatique", () => {
  const s = scenario();
  s.dtf.sheets = [{ format: "A4", capacity: "6", price: "500", logos: "100" }, { format: "A3", capacity: "20", price: "1200", logos: "" }];
  const r = Calc.compute(s).r;
  assert.strictEqual(r.sheetLines[0].sheets, 17);      // ceil(100/6)
  assert.strictEqual(r.sheetLines[1].logos, 200);
  assert.strictEqual(r.sheetLines[1].sheets, 10);      // ceil(200/20)
  assert.strictEqual(r.dtfTotal, 17 * 500 + 10 * 1200);
});
test("répartition DTF incohérente : erreur claire", () => {
  const s = scenario(); s.dtf.sheets = [{ format: "A4", capacity: "6", price: "500", logos: "400" }];
  assert.ok(Calc.compute(s).errors["dtf.sheets"]);
  const s2 = scenario(); s2.dtf.sheets = [{ format: "A4", capacity: "6", price: "500", logos: "100" }];
  assert.ok(/aucune feuille|aucun/i.test(Calc.compute(s2).errors["dtf.sheets"]));
});
test("capacité de feuille manquante ou nulle", () => {
  const s = scenario(); s.dtf.sheets[0].capacity = "";
  assert.ok(Calc.compute(s).errors["dtf.sheets.0.capacity"]);
  s.dtf.sheets[0].capacity = "0";
  assert.ok(Calc.compute(s).errors["dtf.sheets.0.capacity"]);
});
test("logos de réserve et quantité à personnaliser", () => {
  const s = scenario(); s.dtf.spareLogos = "10"; s.dtf.personalizeQty = "140";
  const r = Calc.compute(s).r;
  assert.strictEqual(r.totalLogos, 290); assert.strictEqual(r.dtfSheets, 49);
});
test("sous-traitance + consommables : avertissement anti double comptage", () => {
  const s = scenario(); s.serigraphie.push({ label: "Atelier partenaire", kind: "soustraitance", amount: "20000" });
  assert.ok(Calc.compute(s).warnings.some((w) => /deux fois/.test(w)));
});
test("jamais de NaN ni d'Infinity, même avec des champs absurdes", () => {
  ["", "0", "-1", "abc", "1e9", "99999999999999999999"].forEach((x) => {
    const s = scenario();
    s.order.unitPrice = x; s.garments.lotPrice = x; s.garments.lotSize = x; s.dtf.logosPerGarment = x; s.target.value = x; s.roundTo = x;
    const res = Calc.compute(s); allFinite(res.r, "r");
  });
  assert.strictEqual(Calc.fmtNum(NaN), "—"); assert.strictEqual(Calc.fmtNum(Infinity), "—"); assert.strictEqual(Calc.fmtMoney(undefined), "—");
  assert.strictEqual(Calc.fmtNum(1500.4).replace(/\s/g, " "), "1 500");
  assert.strictEqual(Calc.fmtNum(-0.2), "0");
});
test("marge cible 100 % refusée (division par zéro évitée)", () => {
  const s = scenario(); s.target = { mode: "margin", value: "100" };
  const res = Calc.compute(s); assert.ok(res.errors["target.value"]); assert.strictEqual(res.ready, false);
});

console.log("Documents Word");
function readZip(bytes) { // lecture minimale d'une archive « stockée »
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
  let eocd = bytes.length - 22; assert.strictEqual(dv.getUint32(eocd, true), 0x06054b50);
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50);
    const size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = Buffer.from(bytes.subarray(p + 46, p + 46 + nl)).toString("utf8");
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
    out[name] = Buffer.from(bytes.subarray(start, start + size)).toString("utf8");
    p += 46 + nl + el + cl;
  }
  return out;
}
function xmlText(x) { return x.replace(/<w:br\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[\u00A0\u202F]/g, " "); }
const OUT = process.env.OUT_DIR || "/tmp/docx-out";
fs.mkdirSync(OUT, { recursive: true });

test("devis client : vrai .docx, total correct, aucune donnée interne", () => {
  const s = scenario();
  // Valeurs de coût volontairement uniques pour détecter la moindre fuite
  s.garments.lotPrice = "11111"; s.garments.transport = "2222"; s.dtf.sheets[0].price = "333"; s.serigraphie[0].amount = "7654";
  s.other = [{ label: "Commission secrète", amount: "4444" }];
  s.order.notes = "Livraison sous 5 jours."; s.order.conditions = "Acompte de 50 % à la commande.";
  const doc = Docs.buildClientDoc(s);
  assert.ok(doc.bytes && !doc.error);
  fs.writeFileSync(path.join(OUT, doc.filename), doc.bytes);
  const files = readZip(doc.bytes);
  ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"].forEach((f) => assert.ok(files[f], f + " manquant"));
  assert.strictEqual(Buffer.from(doc.bytes.subarray(0, 2)).toString(), "PK");
  const all = Object.values(files).map(xmlText).join(" ");
  assert.ok(/Devis de personnalisation textile/.test(all));
  assert.ok(/225 000 FCFA/.test(all), "total 225 000 FCFA attendu");
  assert.ok(/1 500 FCFA/.test(all));
  assert.ok(/Livraison sous 5 jours/.test(all) && /Acompte de 50 %/.test(all));
  const raw = Object.values(files).join(" ");
  // 1) Saisies de coût uniques : jamais présentes (ni brutes, ni formatées)
  ["11111", "11 111", "2222", "2 222", "7654", "7 654", "4444", "4 444", "Commission secrète"].forEach((leak) => {
    assert.ok(!raw.includes(leak) && !all.includes(leak), "FUITE détectée : " + leak);
  });
  // 2) Montants internes réellement calculés : absents du texte (comparaison par nombre entier complet)
  const ir = Calc.compute(s).r;
  const sale = new Set([Calc.fmtNum(150 * 1500), Calc.fmtNum(1500), Calc.fmtNum(150)]);
  [ir.garmentsCost, ir.purchaseTransport, ir.dtfTotal, ir.serTotal, ir.otherTotal, ir.totalCash, ir.imputedCost, ir.profit, ir.cashDiff, ir.stockValue, ir.unitCost, ir.unitCash]
    .map((v) => Calc.fmtNum(v).replace(/[\u00A0\u202F]/g, " ")).filter((t) => t !== "0" && !sale.has(t.replace(/ /g, "\u00A0")) && !sale.has(t))
    .forEach((t) => assert.ok(!new RegExp("(?<![\\d])" + t + "(?![\\d])").test(all), "FUITE d'un montant interne : " + t));
  [/b[ée]n[ée]fice/i, /marge/i, /co[uû]t/i, /rentabilit/i, /d[ée]caiss/i, /stock/i, /tr[ée]sorerie/i, /confidentiel/i].forEach((re) => {
    assert.ok(!re.test(all), "mot interne dans le devis client : " + re);
  });
});
test("devis client : refusé sans quantité ou sans prix de vente", () => {
  const s = scenario(); s.order.unitPrice = ""; assert.ok(Docs.buildClientDoc(s).error);
  const t = scenario(); t.order.qty = "0"; assert.ok(Docs.buildClientDoc(t).error);
});
test("devis client : texte spécial échappé (XML sûr)", () => {
  const s = scenario(); s.order.client = 'Société <A&B> "Test"'; s.order.notes = "Ligne 1\nLigne 2 \u0001";
  const doc = Docs.buildClientDoc(s); const x = readZip(doc.bytes)["word/document.xml"];
  assert.ok(x.includes("Société &lt;A&amp;B&gt; &quot;Test&quot;")); assert.ok(!/\u0001/.test(x)); assert.ok(!/<A&B>/.test(x));
});
test("fiche interne : contient coûts, bénéfice et mention confidentielle", () => {
  const s = scenario(); const res = Calc.compute(s);
  const doc = Docs.buildInternalDoc(s, res);
  assert.ok(doc.bytes && !doc.error);
  fs.writeFileSync(path.join(OUT, doc.filename), doc.bytes);
  const all = Object.values(readZip(doc.bytes)).map(xmlText).join(" ");
  ["CONFIDENTIEL", "143 000 FCFA", "177 000 FCFA", "25 000 FCFA", "53 577 FCFA", "48 000 FCFA", "Fiche interne de rentabilité", "estimations"].forEach((t) => assert.ok(all.includes(t), "manquant : " + t));
});
test("fiche interne : refusée tant que le calcul est incomplet", () => {
  const s = scenario(); s.order.qty = ""; assert.ok(Docs.buildInternalDoc(s, Calc.compute(s)).error);
});

console.log("\n" + passed + " test(s) réussi(s)" + (process.exitCode ? " — AU MOINS UN ÉCHEC" : ""));
