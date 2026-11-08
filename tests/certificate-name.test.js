/* Nom imprimé sur un certificat : jamais d'adresse e-mail. Exécution : node tests/certificate-name.test.js
   Aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Name = require("../certificate-name");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

// ---------- faux DOM (innerHTML interdit) ----------
function fakeDoc() {
  const ids = {};
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, listeners: {}, className: "", _text: "", value: "", parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") ids[v] = this; },
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      focus() {},
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    return n;
  }
  const doc = { createElement: node, getElementById: (id) => ids[id] || null, head: node("head"), body: node("body") };
  return doc;
}
const walk = (n, fn) => { fn(n); n.children.forEach((c) => walk(c, fn)); };
const all = (n, pred) => { const r = []; walk(n, (x) => { if (pred(x)) r.push(x); }); return r; };

(async () => {
  await test("resolve : nom légal d'abord, puis pseudo propre ; jamais une adresse e-mail", () => {
    assert.strictEqual(Name.resolve({ full_name: "Awa Koffi", username: "awa" }), "Awa Koffi");
    assert.strictEqual(Name.resolve({ full_name: "", username: "Awa K" }), "Awa K");
    assert.strictEqual(Name.resolve({ full_name: null, username: "Awa K" }), "Awa K");
    assert.strictEqual(Name.resolve({ full_name: "  Awa   Koffi  ", username: null }), "Awa Koffi");
  });

  await test("resolve : ni nom légal ni pseudo propre → null (le nom sera demandé)", () => {
    [
      null, undefined, {}, { full_name: "", username: "" }, { full_name: null, username: null },
      { full_name: "", username: "jean.dupont@gmail.com" },          // pseudo en forme d'e-mail
      { full_name: "a@b.co", username: "Membre 0b3b3d" },            // nom légal e-mail + pseudo neutre
      { full_name: "", username: "Membre 0b3b3de9" },                // pseudo neutre par défaut
      { full_name: "contact@exemple.bj", username: null }
    ].forEach((p) => assert.strictEqual(Name.resolve(p), null, JSON.stringify(p)));
  });

  await test("clean : toute valeur contenant « @ » est refusée (ancien cache avec e-mail compris)", () => {
    ["a@b.com", " x@y.co ", "Jean@", "@jean", "jean dupont@gmail", null, "", "   "].forEach((v) => assert.strictEqual(Name.clean(v), null, String(v)));
    assert.strictEqual(Name.clean("Awa  Koffi"), "Awa Koffi");
  });

  await test("validateTyped : nom correct accepté (accents, tirets, apostrophes) ; e-mail, vide, trop long, sans lettres refusés", () => {
    ["Awa Koffi", "Jean-Pierre N'Diaye", "Élodie Dupré", "  Mahouto   Abdallah ", "Žofia Ćirić"].forEach((v) =>
      assert.strictEqual(Name.validateTyped(v).ok, true, v));
    assert.strictEqual(Name.validateTyped("Awa  Koffi").name, "Awa Koffi");
    ["", " ", "A", "12345", "!!", "a@b.com", "jean@exemple.bj", "x".repeat(101), "Awa\u0000Koffi"].forEach((v) =>
      assert.strictEqual(Name.validateTyped(v).ok, false, JSON.stringify(v)));
    assert.match(Name.validateTyped("a@b.com").message, /pas une adresse e-mail/);
  });

  await test("fenêtre : annulation → null, rien n'est généré ; nom valide → renvoyé ; e-mail refusé avec message ; aucun innerHTML", async () => {
    const doc = fakeDoc();
    // annulation
    let p = Name.ask(doc);
    let overlay = doc.body.children[0];
    all(overlay, (n) => n.tag === "button").find((b) => b.textContent === "Annuler").listeners.click();
    assert.strictEqual(await p, null);
    assert.strictEqual(doc.body.children.length, 0, "fenêtre retirée");
    // e-mail refusé puis nom valide
    p = Name.ask(doc);
    overlay = doc.body.children[0];
    const input = all(overlay, (n) => n.tag === "input")[0];
    const ok = all(overlay, (n) => n.tag === "button").find((b) => /Générer/.test(b.textContent));
    const err = all(overlay, (n) => n.attrs.role === "alert")[0];
    input.value = "moi@exemple.com"; ok.listeners.click();
    assert.match(err.textContent, /pas une adresse e-mail/);
    assert.strictEqual(doc.body.children.length, 1, "la fenêtre reste ouverte");
    input.value = "  Awa Koffi "; ok.listeners.click();
    assert.strictEqual(await p, "Awa Koffi");
    assert.strictEqual(doc.body.children.length, 0);
    assert.strictEqual(all(overlay, (n) => ["img", "a", "script"].includes(n.tag)).length, 0);
  });

  const page = read("certificates.html");
  const code = strip(page.slice(page.indexOf("<script>")));

  await test("certificates.html : l'adresse e-mail n'est plus un repli du nom ; le nom est demandé avant la génération", () => {
    assert.ok(!/user\.email\s*\|\|/.test(code) && !/\|\|\s*user\.email/.test(code), "plus de repli sur user.email pour le nom");
    assert.match(code, /const userName = MahoutoCertificateName\.resolve\(profile\);/);
    assert.match(code, /MahoutoCertificateName\.clean\(userName\) \|\| typedName/);
    const click = code.slice(code.indexOf("let printedName"), code.indexOf("MahoutoCertificatePdf.download"));
    assert.match(click, /await MahoutoCertificateName\.ask\(document\)/);
    assert.ok(click.indexOf("if (!printedName)") < code.indexOf("MahoutoCertificatePdf.download"), "demande avant la génération");
    assert.match(code, /userName: printedName/);
    assert.match(code, /MahoutoCertificateName\.clean\(cached\.data\.userName\)/, "cache nettoyé");
    assert.match(page, /<script src="certificate-name\.js"><\/script>\s*<script src="certificate-pdf\.js">/);
  });

  await test("certificate-pdf.js : garde-fou, aucun document sans nom ni avec un « @ » imprimé", () => {
    const pdf = strip(read("certificate-pdf.js"));
    const head = pdf.slice(pdf.indexOf("async function download(certificate)"), pdf.indexOf("await loadJsPDF()", pdf.indexOf("async function download(certificate)")));
    assert.match(head, /!printed \|\| printed\.indexOf\("@"\) !== -1/);
    assert.match(head, /throw new Error\("Aucun nom à imprimer/);
    assert.match(pdf, /const nameText = printed;/);
    assert.ok(!/certificate\.userName \|\| "—"/.test(pdf));
  });

  await test("le nom saisi n'est ni enregistré ni envoyé : aucun accès réseau dans certificate-name.js, aucun innerHTML, aucun journal", () => {
    const lib = strip(read("certificate-name.js"));
    assert.ok(!/fetch\(|supabase|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML|console\./.test(lib));
    assert.ok(!/MahoutoOfflineCache\.save\([^)]*typedName/.test(code));
  });

  await test("cache hors ligne : certificate-name.js ajouté à l'App Shell, version ≥ v88", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/certificate-name\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 88);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
