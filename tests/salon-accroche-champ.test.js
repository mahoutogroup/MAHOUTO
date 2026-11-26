/* Phrase d'accroche : le champ de admin/rooms.html est un <textarea> qui grandit avec le texte (une ligne au départ, sans barre de
   défilement ni poignée), sans retour à la ligne (Entrée, collage), limité à 120 caractères, avec un compteur exact et des lignes
   d'aide qui ne se chevauchent plus. Exécution réelle de bindField dans un faux champ ; la mise en page est vérifiée dans Chromium
   (voir la description de la PR). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const A = require("../salon-accroche");

const ADM = fs.readFileSync(path.join(__dirname, "..", "admin", "rooms.html"), "utf8");
const CSS = ADM.match(/<style>([\s\S]*?)<\/style>/)[1];

test("le champ est un <textarea> d'une ligne au départ, limité à 120, jamais un <input> ; sans poignée ni barre de défilement", () => {
  assert.ok(ADM.includes('<textarea class="r-accroche" rows="1" maxlength="120" autocomplete="off" placeholder="Ex : Conseils, devis et entraide entre sérigraphes"></textarea>'));
  assert.ok(!/<input[^>]*class="r-accroche"/.test(ADM), "plus de champ <input> pour l'accroche");
  assert.strictEqual((ADM.match(/class="r-accroche"/g) || []).length, 1);
  const rule = CSS.match(/\.room-row textarea\.r-accroche \{([^}]*)\}/)[1];
  assert.match(rule, /resize:\s*none/); assert.match(rule, /overflow:\s*hidden/); assert.match(rule, /width:\s*100%/); assert.match(rule, /display:\s*block/);
  assert.match(CSS, /\.room-row input::placeholder, \.room-row textarea::placeholder \{ color: var\(--text-muted\); opacity: 1; \}/);
  assert.ok(ADM.includes('accrocheInput.value = MahoutoSalonAccroche.clean(r.accroche);'), "valeur posée en texte au chargement, jamais dans du HTML");
  assert.ok(ADM.indexOf('accrocheInput.value = MahoutoSalonAccroche.clean') < ADM.indexOf("MahoutoSalonAccroche.bindField(accrocheInput"), "valeur posée AVANT le calcul de hauteur : la hauteur est juste dès le chargement");
});

test("espacement : la marge négative de .abo-hint est annulée dans le bloc de l'accroche (le compteur ne chevauche plus l'aide)", () => {
  assert.match(CSS, /\.room-row \.abo-hint \{[^}]*margin-top: -4px/, "la règle d'origine (autres blocs) est inchangée");
  assert.match(CSS, /\.room-row \.r-accroche-bloc \.abo-hint \{ margin-top: 6px; \}/);
  // spécificité : 3 classes (.room-row .r-accroche-bloc .abo-hint) contre 2 (.room-row .abo-hint) : la règle du bloc l'emporte, quel que soit l'ordre
  assert.ok(".room-row .r-accroche-bloc .abo-hint".split(".").length - 1 > ".room-row .abo-hint".split(".").length - 1);
});

// ---------- faux <textarea> : valeur, sélection, hauteur proportionnelle au nombre de lignes (40 caractères par ligne) ----------
function field(initial) {
  const l = {};
  const el = { value: initial || "", selectionStart: 0, selectionEnd: 0, style: { height: "" }, isConnected: true, offsetHeight: 0, clientHeight: 0, _h: [],
    addEventListener(t, f) { l[t] = f; },
    setRangeText(text, s, e) { this.value = this.value.slice(0, s) + text + this.value.slice(e); this.selectionStart = this.selectionEnd = s + text.length; },
    get scrollHeight() { return 20 * Math.max(1, Math.ceil(Array.from(this.value).length / 40)) + 20; } };
  // offsetHeight/clientHeight : bordures de 2 px (scrollHeight n'en tient pas compte)
  Object.defineProperty(el, "offsetHeight", { get() { return (el.style.height === "auto" ? el.scrollHeight : parseFloat(el.style.height) || 0) + 2; } });
  Object.defineProperty(el, "clientHeight", { get() { return (el.style.height === "auto" ? el.scrollHeight : parseFloat(el.style.height) || 0); } });
  const heights = []; let h = ""; Object.defineProperty(el.style, "height", { get() { return h; }, set(v) { h = v; heights.push(v); } });
  const counter = { textContent: "" };
  return { el, l, counter, heights, fire: (t, ev) => { const e = Object.assign({ prevented: false, preventDefault() { this.prevented = true; } }, ev || {}); if (l[t]) l[t](e); return e; } };
}
const bind = (initial) => { const f = field(initial); f.api = A.bindField(f.el, f.counter); return f; };
const hauteur = (f) => parseFloat(f.el.style.height);

test("Entrée n'ajoute AUCUN retour à la ligne (touche Entrée, clavier mobile « saut de ligne » et « paragraphe »), les autres touches passent", () => {
  const f = bind("");
  assert.strictEqual(f.fire("keydown", { key: "Enter" }).prevented, true);
  assert.strictEqual(f.fire("keydown", { key: "Enter", shiftKey: true }).prevented, true, "Maj + Entrée non plus");
  assert.strictEqual(f.fire("keydown", { key: "a" }).prevented, false); assert.strictEqual(f.fire("keydown", { key: "Backspace" }).prevented, false);
  assert.strictEqual(f.fire("beforeinput", { inputType: "insertLineBreak" }).prevented, true);
  assert.strictEqual(f.fire("beforeinput", { inputType: "insertParagraph" }).prevented, true);
  assert.strictEqual(f.fire("beforeinput", { inputType: "insertText" }).prevented, false); assert.strictEqual(f.fire("beforeinput", { inputType: "insertFromPaste" }).prevented, false);
});

test("un retour à la ligne arrivé par un autre chemin (clavier qui ne prévient pas) est remplacé par une espace", () => {
  const f = bind("");
  f.el.value = "Bonjour\nà tous\r\net\ttoutes"; f.fire("input");
  assert.strictEqual(f.el.value, "Bonjour à tous et toutes"); assert.ok(!/[\r\n\t]/.test(f.el.value));
  f.el.value = "a b c"; f.fire("input"); assert.strictEqual(f.el.value, "a b c");
});

test("un texte collé avec retours à la ligne est nettoyé comme salon-accroche.js (une ligne, espaces réduits, bords rognés)", () => {
  const f = bind("début ");
  f.el.selectionStart = f.el.selectionEnd = f.el.value.length;
  const e = f.fire("paste", { clipboardData: { getData: (t) => { assert.strictEqual(t, "text"); return "  Conseils \n\n et   entraide\r\n entre\tpairs \n"; } } });
  assert.strictEqual(e.prevented, true, "le collage brut est remplacé par le texte nettoyé");
  assert.strictEqual(f.el.value, "début Conseils et entraide entre pairs");
  assert.strictEqual(f.el.value.replace(/^début /, ""), A.clean("  Conseils \n\n et   entraide\r\n entre\tpairs \n"), "exactement ce que fait clean()");
  const g = bind("abcdef"); g.el.selectionStart = 2; g.el.selectionEnd = 4; g.fire("paste", { clipboardData: { getData: () => "X\nY" } });
  assert.strictEqual(g.el.value, "abX Yef", "remplace la sélection");
  const h = bind("x"); const e2 = h.fire("paste", { clipboardData: undefined }); assert.strictEqual(e2.prevented, false, "sans presse-papiers : le gestionnaire de saisie nettoie ensuite");
});

test("la limite de 120 caractères est conservée : saisie ou collage au-delà coupés, accents et émojis comptés comme un caractère, compteur exact", () => {
  const f = bind("");
  f.el.value = "é".repeat(125); f.fire("input"); assert.strictEqual(Array.from(f.el.value).length, 120); assert.strictEqual(f.counter.textContent, "120 / 120");
  const g = bind(""); g.el.selectionStart = g.el.selectionEnd = 0; g.fire("paste", { clipboardData: { getData: () => "a".repeat(300) } });
  assert.strictEqual(g.el.value.length, 120); assert.strictEqual(g.counter.textContent, "120 / 120");
  const h = bind(""); h.el.value = "😀".repeat(130); h.fire("input"); assert.strictEqual(Array.from(h.el.value).length, 120, "un émoji = un caractère"); assert.strictEqual(h.counter.textContent, "120 / 120");
  assert.ok(A.validate(f.el.value).ok, "le texte coupé est accepté par la validation (inchangée)"); assert.strictEqual(A.validate("é".repeat(121)).ok, false, "la validation refuse toujours 121");
  assert.ok(ADM.includes('maxlength="120"') && A.MAX === 120);
});

test("le compteur est exact à chaque saisie et au chargement", () => {
  const f = bind("Phrase existante"); assert.strictEqual(f.counter.textContent, "16 / 120");
  f.el.value = "Phrase existante, plus longue"; f.fire("input"); assert.strictEqual(f.counter.textContent, "29 / 120");
  f.el.value = ""; f.fire("input"); assert.strictEqual(f.counter.textContent, "0 / 120");
  f.el.value = "  espaces   multiples  "; f.fire("input"); assert.strictEqual(f.counter.textContent, "17 / 120", "compté comme la validation : espaces réduits, bords rognés");
});

test("la hauteur suit le contenu : calculée au chargement et à chaque saisie, une ligne au départ, grandit puis rétrécit ; jamais de barre de défilement", () => {
  const vide = bind(""); assert.strictEqual(vide.el.style.height, "auto", "champ vide : une seule ligne (rows=\"1\"), l'exemple grisé qui passerait sur deux lignes n'agrandit pas le champ");
  assert.ok(ADM.includes('rows="1"') && vide.heights.includes("auto"), "on repart de « auto » avant de mesurer : le champ peut aussi rétrécir");
  assert.strictEqual(hauteur(bind("x")), 20 + 20 + 2, "un caractère : une ligne (contenu + bordures)");
  const chargé = bind("x".repeat(100)); assert.strictEqual(hauteur(chargé), 20 * 3 + 20 + 2, "100 caractères = 3 lignes dès le chargement");
  const f = bind(""); f.el.value = "y"; f.fire("input"); const h0 = hauteur(f);
  f.el.value = "y".repeat(45); f.fire("input"); const h1 = hauteur(f); assert.ok(h1 > h0, "grandit : " + h0 + " → " + h1);
  f.el.value = "y".repeat(100); f.fire("input"); const h2 = hauteur(f); assert.ok(h2 > h1, "grandit encore : " + h2);
  f.el.value = "y"; f.fire("input"); assert.strictEqual(hauteur(f), h0, "rétrécit quand on efface");
  [f.el.value = "a".repeat(120)].forEach(() => { f.fire("input"); assert.strictEqual(hauteur(f), 20 * 3 + 20 + 2, "120 caractères = 3 lignes, tout est visible"); });
  const rule = CSS.match(/\.room-row textarea\.r-accroche \{([^}]*)\}/)[1]; assert.match(rule, /overflow:\s*hidden/, "aucune barre de défilement : la hauteur suit le contenu");
  assert.strictEqual(A.fit.length, 1);
});

test("rien d'autre n'a changé : validation, texte d'aide et textes identiques ; l'enregistrement lit toujours la valeur du champ", () => {
  assert.ok(ADM.includes("const check = MahoutoSalonAccroche.validate(accrocheInput.value);"));
  assert.ok(ADM.includes("Cette phrase s'affiche sur l'écran verrouillé de la communauté, sous le nom et avant le prix, pour les personnes qui n'y ont pas encore accès. Pas de lien ni d'adresse web."));
  assert.ok(ADM.includes("<label>Phrase d'accroche (facultatif)</label>"));
  assert.ok(ADM.includes("if (accrocheInput) payload.accroche = accrocheValue;"));
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"); assert.match(sw, /const CACHE_NAME = "mahoutoplus-shell-v(137|13[8-9]|1[4-9]\d)";/);
});
