/* Tests des documents Word du Métré construction — exécution : node tests/metre-docs.test.js
   Aucune dépendance. Écrit les .docx d'exemple dans le dossier OUT_DIR (défaut : /tmp/metre-docx-out).
   Les valeurs attendues viennent de Calc.compute / Calc.budget (déjà testés dans metre-calc.test.js) : on vérifie
   ici que les documents les reprennent fidèlement, avec des espaces insécables, sans NaN ni « undefined ». */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Calc = require("../metre-calc");
const Docs = require("../metre-docs");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (e) { console.error("  ÉCHEC  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const NBSP = String.fromCharCode(0xA0);
const CTRL = String.fromCharCode(1);
const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime();   // 17/11/2026, midi (heure locale)

// Lecture minimale d'une archive « stockée » (même méthode que tests/serigraphie-calculateur.test.js)
function readZip(bytes) {
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
// Texte brut d'un morceau de XML (espaces insécables conservés)
function xmlRaw(x) { return x.replace(/<w:br\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'); }
const nb = (s) => s.split(" ").join(NBSP);
const money = (n) => nb(Calc.fmtMoney(n).split(NBSP).join(" "));   // attendu : espaces insécables partout
const OUT = process.env.OUT_DIR || "/tmp/metre-docx-out";
fs.mkdirSync(OUT, { recursive: true });

function input(extra) {
  const state = clone(Calc.DEFAULTS);
  return Object.assign({ state, prices: {}, labour: "", contingency: "10", project: "Maison fictive" }, extra || {});
}
function allPrices(state, value) {
  const prices = {};
  Calc.compute(state).lines.forEach((l) => { prices[l.id] = value; });
  return prices;
}
function docText(doc) { return Object.values(readZip(doc.bytes)).map(xmlRaw).join(" "); }

console.log("Devis estimatif et métré détaillé");
test("scénario de référence, tous les prix à 100 : deux .docx valides avec les totaux de Calc.budget, espaces insécables", () => {
  const inp = input(); inp.prices = allPrices(inp.state, "100"); inp.labour = "500000";
  const res = Calc.compute(inp.state), bd = Calc.budget(res, inp.prices, inp.labour, 10);
  assert.strictEqual(res.r.blocks, 1201); assert.strictEqual(res.r.cementBags, 116);
  assert.strictEqual(bd.complete, true);
  for (const [kind, doc] of [["quote", Docs.buildQuoteDoc(inp, { now: NOW })], ["metre", Docs.buildMetreDoc(inp, { now: NOW })]]) {
    assert.ok(doc.bytes && !doc.error, kind);
    fs.writeFileSync(path.join(OUT, doc.filename), doc.bytes);
    assert.strictEqual(Buffer.from(doc.bytes.subarray(0, 2)).toString(), "PK");
    const files = readZip(doc.bytes);
    ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"].forEach((f) => assert.ok(files[f], kind + " : " + f + " manquant"));
    const x = files["word/document.xml"], text = xmlRaw(x);
    assert.ok(x.startsWith("<?xml") && x.endsWith("</w:document>"));
    // 1 201 parpaings et 116 sacs, avec espace insécable
    assert.ok(text.includes("1" + NBSP + "201"), kind + " : 1 201 parpaings");
    assert.ok(text.includes("116" + NBSP + "sacs"), kind + " : 116 sacs");
  }
  const quote = docText(Docs.buildQuoteDoc(inp, { now: NOW }));
  [bd.materials, bd.labour, bd.contingency, bd.total].forEach((v) => assert.ok(quote.includes(money(v)), "montant manquant : " + money(v)));
  assert.ok(quote.includes("TOTAL") && !quote.includes("TOTAL PARTIEL") && !quote.includes("à chiffrer"));
  assert.ok(quote.includes("Imprévus (10" + NBSP + "%)"));
  Object.keys(bd.groups).forEach((g) => assert.ok(quote.includes("Sous-total " + g) && quote.includes(money(bd.groups[g])), "sous-total " + g));
  // aucun montant avec un espace ordinaire (sauf avant « FCFA » : déjà insécable)
  assert.ok(!/\d \d{3}/.test(quote.replace(/Établi le [\d/]+/, "")), "espace ordinaire dans un nombre : " + (quote.match(/\d \d{3}/) || [])[0]);
  assert.ok(!/\d FCFA/.test(quote), "espace ordinaire avant FCFA");
  assert.ok(quote.includes("Estimation à faire valider par un professionnel du bâtiment."));
});
test("espaces insécables garantis par metre-docs.js même si fmtNum / fmtMoney renvoyaient des espaces ordinaires", () => {
  const origNum = Calc.fmtNum, origMoney = Calc.fmtMoney;
  const plain = (s) => s.split(NBSP).join(" ");
  Calc.fmtNum = (n, d) => plain(origNum(n, d)); Calc.fmtMoney = (n) => plain(origMoney(n));
  try {
    assert.ok(Calc.fmtMoney(1500).includes("1 500 FCFA"), "simulation : espaces ordinaires");
    const inp = input(); inp.prices = allPrices(inp.state, "100");
    const quote = docText(Docs.buildQuoteDoc(inp, { now: NOW })), metre = docText(Docs.buildMetreDoc(inp, { now: NOW }));
    [quote, metre].forEach((t) => {
      assert.ok(t.includes("1" + NBSP + "201") && t.includes("116" + NBSP + "sacs"));
      assert.ok(!/\d \d{3}/.test(t.replace(/Établi le [\d/]+/, "")), "espace ordinaire dans un nombre : " + (t.match(/\d \d{3}/) || [])[0]);
    });
    assert.ok(!/\d FCFA/.test(quote), "espace ordinaire avant FCFA");
  } finally { Calc.fmtNum = origNum; Calc.fmtMoney = origMoney; }
});
test("devis : ligne de prix = quantité × prix, formaté en FCFA", () => {
  const inp = input(); inp.prices = { blocks: "300", cement: "6 500" };
  const text = docText(Docs.buildQuoteDoc(inp, { now: NOW }));
  assert.ok(text.includes(money(1201 * 300)), "parpaings");
  assert.ok(text.includes(money(116 * 6500)), "ciment");
  assert.ok(text.includes(money(300)) && text.includes(money(6500)));
});
test("métré détaillé : dimensions, surfaces, volumes de béton, quantités, hypothèses, avertissements", () => {
  const inp = input(), res = Calc.compute(inp.state), r = res.r;
  const doc = Docs.buildMetreDoc(inp, { now: NOW }), t = docText(doc);
  ["Dimensions saisies", "Surfaces et longueurs", "Volumes de béton", "Liste complète des quantités", "Hypothèses de calcul", "Avertissements"].forEach((h) => assert.ok(t.includes(h), "section : " + h));
  ["Salon", "Chambre", "Cuisine", "Profondeur extérieure", "Hauteur des murs", "Épaisseur des parpaings", "Portes", "Fenêtres", "Tôle sur charpente"].forEach((w) => assert.ok(t.includes(w), w));
  assert.ok(t.includes("48,0" + NBSP + "m²") && t.includes("40,0" + NBSP + "m") && t.includes("72,8" + NBSP + "m²"), "surfaces et longueurs");
  ["Semelle de fondation", "Dalle de sol", "Chaînages", "Poteaux (14)", "Linteaux", "Total béton"].forEach((w) => assert.ok(t.includes(w), w));
  assert.ok(t.includes(Calc.fmtNum(r.concrete, 2).split(NBSP).join(NBSP) + NBSP + "m³"), "total béton");
  res.lines.forEach((l) => assert.ok(t.includes(l.label), "ligne : " + l.label));
  assert.ok(t.includes("40" + NBSP + "×" + NBSP + "20" + NBSP + "×" + NBSP + "15" + NBSP + "cm"), "parpaing");
  assert.ok(t.includes("Non (parpaings achetés)"));
  res.warnings.forEach((w) => assert.ok(t.includes(w), "avertissement : " + w.slice(0, 30)));
  assert.strictEqual(doc.filename, "Metre-detaille-Maison-fictive.docx");
});
test("projet sans aucun prix : « TOTAL PARTIEL », « à chiffrer », aucun NaN ni undefined", () => {
  const inp = input(), n = Calc.compute(inp.state).lines.length;
  for (const doc of [Docs.buildQuoteDoc(inp, { now: NOW }), Docs.buildMetreDoc(inp, { now: NOW })]) {
    assert.ok(doc.bytes, "document produit");
    Object.values(readZip(doc.bytes)).forEach((x) => {
      ["NaN", "undefined", "null", "Infinity", "[object"].forEach((bad) => assert.ok(!x.includes(bad), "« " + bad + " » dans le XML"));
    });
  }
  const t = docText(Docs.buildQuoteDoc(inp, { now: NOW }));
  assert.ok(t.includes("TOTAL PARTIEL"));
  assert.ok(t.includes("à chiffrer"));
  assert.ok(t.includes(n + " lignes sans prix"), n + " lignes sans prix attendu");
  assert.ok(t.includes("0" + NBSP + "FCFA"), "total partiel à 0 FCFA");
  assert.strictEqual((t.match(/à chiffrer/g) || []).length >= n * 2, true, "chaque ligne : prix et total à chiffrer");
});
test("prix partiels : total partiel, sous-total de groupe marqué « partiel »", () => {
  const inp = input(); inp.prices = { blocks: "300" };
  const t = docText(Docs.buildQuoteDoc(inp, { now: NOW })), bd = Calc.budget(Calc.compute(inp.state), inp.prices, "", 10);
  assert.ok(t.includes("TOTAL PARTIEL") && t.includes(money(bd.total)));
  assert.ok(t.includes(money(bd.groups["Gros œuvre"]) + " (partiel)"));
  assert.ok(t.includes((bd.missing.length) + " lignes sans prix"));
  const one = input(); one.prices = allPrices(one.state, "100"); delete one.prices.sand;
  assert.ok(docText(Docs.buildQuoteDoc(one, { now: NOW })).includes("1 ligne sans prix"), "singulier");
});
test("nom de projet et de pièce avec < > & \" : échappés dans le XML, jamais en balises brutes", () => {
  const inp = input({ project: 'Villa <b>&"Test"</b> ' + CTRL + "fin" });
  inp.state.rooms[0].name = 'Salon <A&B> "Test"' + CTRL;
  for (const doc of [Docs.buildQuoteDoc(inp, { now: NOW }), Docs.buildMetreDoc(inp, { now: NOW })]) {
    const files = readZip(doc.bytes);
    const joined = Object.values(files).join("\n");
    assert.ok(joined.includes("Villa &lt;b&gt;&amp;&quot;Test&quot;&lt;/b&gt; fin"), "projet échappé");
    assert.ok(!joined.includes("<b>&"), "balise brute <b>");
    assert.ok(!joined.includes("<A&B>"), "balise brute <A&B>");
    assert.ok(!joined.includes(CTRL), "caractère de contrôle");
    assert.ok(files["word/header1.xml"].includes("Villa &lt;b&gt;"), "en-tête échappé");
    // le XML reste bien formé : chaque « < » ouvre une balise
    Object.keys(files).filter((f) => f.endsWith(".xml") || f.endsWith(".rels")).forEach((f) => assert.ok(!/<(?![\/?]?[A-Za-z_])/.test(files[f]), "« < » isolé dans " + f));
  }
  assert.ok(docText(Docs.buildMetreDoc(inp, { now: NOW })).includes('Salon <A&B> "Test"'), "nom de pièce restitué");
});
test("nom de fichier : slug sans accents ni caractères spéciaux, repli sur « Projet sans nom »", () => {
  assert.strictEqual(Docs.buildQuoteDoc(input({ project: "Café <Été> & Co / 2026" }), { now: NOW }).filename, "Devis-estimatif-Cafe-Ete-Co-2026.docx");
  assert.strictEqual(Docs.buildMetreDoc(input({ project: "  " }), { now: NOW }).filename, "Metre-detaille-Projet-sans-nom.docx");
  assert.strictEqual(Docs.buildQuoteDoc(input({ project: "../../etc/passwd" }), { now: NOW }).filename, "Devis-estimatif-etc-passwd.docx");
  assert.ok(/^[A-Za-z0-9.-]+$/.test(Docs.buildQuoteDoc(input({ project: "é à ç ñ ü ß 日本" }), { now: NOW }).filename));
});
test("projet sans nom : « Projet sans nom » et date injectée dans l'en-tête et le titre", () => {
  const doc = Docs.buildQuoteDoc(input({ project: "" }), { now: NOW }), files = readZip(doc.bytes);
  assert.ok(xmlRaw(files["word/header1.xml"]).includes("Projet sans nom") && xmlRaw(files["word/header1.xml"]).includes("MAJESTÉ PRESSE"));
  assert.ok(xmlRaw(files["word/header1.xml"]).includes("17/11/2026"));
  assert.ok(xmlRaw(files["word/document.xml"]).includes("Projet : Projet sans nom") && xmlRaw(files["word/document.xml"]).includes("Établi le 17/11/2026"));
});
test("option « parpaings sur place » : « Fabrication des parpaings » présent, ligne « Parpaings 40 × 20 » absente", () => {
  const inp = input(); inp.state.makeBlocks = true;
  const quote = docText(Docs.buildQuoteDoc(inp, { now: NOW }));
  assert.ok(quote.includes("Fabrication des parpaings (main-d'œuvre du maçon)"));
  assert.ok(!/Parpaings 40/.test(quote), "pas de ligne d'achat de parpaings");
  assert.ok(quote.includes("Ciment et sable déjà comptés plus bas"));
  const base = Calc.compute(input().state).r.cementBags, withMade = Calc.compute(inp.state).r.cementBags;
  assert.ok(withMade > base && quote.includes("167" + NBSP + "sacs") === (withMade === 167));
  const metre = docText(Docs.buildMetreDoc(inp, { now: NOW }));
  assert.ok(metre.includes("Parpaings fabriqués sur place par le maçon") && metre.includes("Oui"));
  assert.ok(metre.includes("25 (valeur automatique pour 15" + NBSP + "cm)"), "parpaings par sac automatique");
  assert.ok(metre.includes("fabriquer les parpaings") && metre.includes("sécher"), "détail du ciment et avertissement de séchage");
  inp.state.blocksPerBag = "30";
  assert.ok(docText(Docs.buildMetreDoc(inp, { now: NOW })).includes("30 (saisi)"));
  fs.writeFileSync(path.join(OUT, "Devis-parpaings-sur-place.docx"), Docs.buildQuoteDoc(inp, { now: NOW }).bytes);
});
test("dalle de toiture : volume affiché dans le métré", () => {
  const inp = input(); inp.state.roofType = "dalle";
  const t = docText(Docs.buildMetreDoc(inp, { now: NOW }));
  assert.ok(t.includes("Dalle de toiture (pertes comprises)") && t.includes("Dalle en béton"));
  assert.ok(!docText(Docs.buildQuoteDoc(inp, { now: NOW })).includes("Tôle de toiture"));
});

console.log("Entrées invalides : { error }, jamais d'exception");
test("champ obligatoire vide ou valeur hors limites : { error } sans fichier", () => {
  const a = input(); a.state.depth = "";
  const b = input(); b.state.rooms[1].length = "10";
  const c = input(); c.state.makeBlocks = true; c.state.blocksPerBag = "100";
  const d = input(); d.state.rooms = [];
  for (const inp of [a, b, c, d]) {
    for (const fn of [Docs.buildQuoteDoc, Docs.buildMetreDoc]) {
      let res; assert.doesNotThrow(() => { res = fn(inp, { now: NOW }); });
      assert.ok(res.error && typeof res.error === "string" && !res.bytes && !res.filename, JSON.stringify(res).slice(0, 80));
    }
  }
  assert.ok(/Corrigez les champs/.test(Docs.buildQuoteDoc(a, { now: NOW }).error));
});
test("prix, main-d'œuvre ou imprévus invalides : { error } qui nomme le problème", () => {
  const p = input({ prices: { blocks: "abc", cement: "-5" } });
  let res = Docs.buildQuoteDoc(p, { now: NOW });
  assert.ok(res.error && /prix saisi/.test(res.error) && !res.bytes);
  assert.ok(Docs.buildMetreDoc(p, { now: NOW }).error, "le métré refuse aussi");
  res = Docs.buildQuoteDoc(input({ labour: "x" }), { now: NOW }); assert.ok(res.error && /main-d'œuvre/.test(res.error));
  res = Docs.buildQuoteDoc(input({ contingency: "dix" }), { now: NOW }); assert.ok(res.error && /Imprévus/.test(res.error));
});
test("entrées absentes ou aberrantes : { error }, pas d'exception", () => {
  [undefined, null, 42, "texte", {}, { state: null }, { state: "x" }, { state: {} }, { state: clone(Calc.DEFAULTS), prices: null, contingency: null }].forEach((inp) => {
    let q, m;
    assert.doesNotThrow(() => { q = Docs.buildQuoteDoc(inp); m = Docs.buildMetreDoc(inp); });
    assert.ok(q && m && (q.error || q.bytes) && (m.error || m.bytes));
  });
  // prices et contingency absents : valeurs par défaut sûres (aucun prix, imprévus à 0 %)
  const ok = Docs.buildQuoteDoc({ state: clone(Calc.DEFAULTS), prices: null, contingency: null });
  assert.ok(ok.bytes && docText(ok).includes("Imprévus (0" + NBSP + "%)"));
});
test("les documents ne modifient pas l'entrée fournie", () => {
  const inp = input(); inp.prices = allPrices(inp.state, "100"); const copy = clone(inp);
  Docs.buildQuoteDoc(inp, { now: NOW }); Docs.buildMetreDoc(inp, { now: NOW });
  assert.deepStrictEqual(inp, copy);
});

console.log("Intégration de la page");
const html = fs.readFileSync(path.join(__dirname, "..", "metre.html"), "utf8");
test("metre.html : boutons d'export, scripts dans l'ordre, zone de statut, boutons désactivés tant que le résultat n'est pas prêt", () => {
  assert.ok(/<button[^>]*id="btn-export-quote"[^>]*>Exporter le devis Word<\/button>/.test(html));
  assert.ok(/<button[^>]*id="btn-export-metre"[^>]*>Exporter le métré Word<\/button>/.test(html));
  const iCalc = html.indexOf('<script src="metre-calc.js"></script>'), iDocx = html.indexOf('<script src="docx-lite.js"></script>'), iDocs = html.indexOf('<script src="metre-docs.js"></script>');
  const iMain = html.indexOf("<script>\n(function () {");
  assert.ok(iCalc > 0 && iCalc < iDocx && iDocx < iDocs && iDocs < iMain, "ordre : metre-calc, docx-lite, metre-docs, script principal");
  assert.ok(/<div id="export-status"[^>]*role="status"/.test(html));
  assert.ok(/btn-export-quote"\)\.disabled = !result\.ready/.test(html) && /btn-export-metre"\)\.disabled = !result\.ready/.test(html));
  assert.ok(/Docs\.buildQuoteDoc\(input/.test(html) && /Docs\.buildMetreDoc\(input/.test(html) && /Docx\.download\(doc\.bytes, doc\.filename\)/.test(html));
  assert.ok(/if \(doc\.error\) \{ setExportStatus\(doc\.error, true\)/.test(html), "l'erreur est affichée, aucun fichier produit");
  // les boutons d'export sont dans un bloc no-print
  assert.ok(/<div class="actions no-print">[\s\S]*btn-print[\s\S]*btn-export-quote[\s\S]*btn-export-metre[\s\S]*<\/div>/.test(html));
});
test("metre.html : règle CSS plus spécifique pour les cases à cocher des champs (flex, écart 8 px, case dorée de 18 px)", () => {
  assert.ok(/\.field \.check \{[^}]*display: flex[^}]*gap: 8px/.test(html));
  assert.ok(/\.field \.check input \{[^}]*width: 18px[^}]*height: 18px[^}]*accent-color: #D4AF37/.test(html));
  assert.ok(html.indexOf(".field .check {") > html.indexOf(".field label {"), "règle placée après « .field label »");
});
test("metre.html : aucun innerHTML ; le nom du projet n'est jamais inséré dans du HTML", () => {
  assert.ok(!/\.innerHTML\s*=/.test(html));
  assert.ok(!/insertAdjacentHTML|document\.write/.test(html));
});
test("service worker : docx-lite.js et metre-docs.js en cache hors ligne, version ≥ v108", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.ok(sw.includes('"/docx-lite.js"') && sw.includes('"/metre-docs.js"') && sw.includes('"/metre-calc.js"') && sw.includes('"/metre.html"'));
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 108);
});
test("sécurité : metre-docs.js n'utilise ni réseau, ni stockage, ni DOM ; aucune donnée personnelle dans le dépôt", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "metre-docs.js"), "utf8");
  assert.ok(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|document\.|window\.|eval\(|new Function)/.test(src));
  [src, html].forEach((t) => assert.ok(!/(sk_(live|test)_|whsec_|\+\d{6,}|@[a-z0-9-]+\.[a-z]{2,})/i.test(t)));
});

console.log("\n" + passed + " test(s) réussi(s)" + (process.exitCode ? " — AU MOINS UN ÉCHEC" : ""));
