/* Tests du pseudo neutre et des refus de pseudo — exécution : node tests/pseudo.test.js
   Aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Pseudo = require("../pseudo");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

test("pseudo neutre : « Membre » + les 6 premiers caractères de l'identifiant", () => {
  assert.strictEqual(Pseudo.neutralName("0b3b3de9-b835-40ec-b076-22fdc3c4ab02"), "Membre 0b3b3d");
  assert.strictEqual(Pseudo.neutralName("0b3b3de9-b835-40ec-b076-22fdc3c4ab02", 8), "Membre 0b3b3de9");
});

test("looksLikeEmail : adresses reconnues, pseudos normaux acceptés", () => {
  ["a@b.com", "jean.dupont@gmail.com", " x@y.co ", "nom+tag@exemple.bj"].forEach((v) => assert.strictEqual(Pseudo.looksLikeEmail(v), true, v));
  ["jean.dupont", "Membre 0b3b3d", "a@b", "a b@c.d", "", null, undefined, "@gmail.com"].forEach((v) => assert.strictEqual(Pseudo.looksLikeEmail(v), false, String(v)));
});

test("refusal : reconnaît les trois refus de la base, rien d'autre", () => {
  assert.strictEqual(Pseudo.refusal({ message: "PSEUDO_RESERVE: ce pseudo est reserve" }).kind, "reserved");
  assert.strictEqual(Pseudo.refusal({ message: "PSEUDO_EMAIL: le pseudo ne peut pas etre une adresse e-mail" }).kind, "email");
  assert.strictEqual(Pseudo.refusal({ code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_unique_idx"' }).kind, "taken");
  assert.strictEqual(Pseudo.refusal({ code: "23505", message: 'duplicate key value violates unique constraint "profiles_pkey"' }), null);
  assert.strictEqual(Pseudo.refusal({ code: "42501", message: "permission denied" }), null);
  assert.strictEqual(Pseudo.refusal(null), null);
  assert.strictEqual(Pseudo.refusal(undefined), null);
});

test("refusal : messages affichés à la personne", () => {
  assert.strictEqual(Pseudo.refusal({ message: "PSEUDO_RESERVE" }).message, "Ce pseudo est réservé. Choisis-en un autre.");
  assert.strictEqual(Pseudo.refusal({ message: "PSEUDO_EMAIL" }).message, "Le pseudo ne peut pas être une adresse e-mail. Choisis-en un autre.");
  assert.strictEqual(Pseudo.refusal({ code: "23505", message: "profiles_username_unique_idx" }).message, "Ce pseudo est déjà pris. Choisis-en un autre.");
});

test("le nom de l'index et les codes d'erreur sont les mêmes que dans les migrations", () => {
  assert.ok(read("migrations/004_pseudos_uniques.sql").includes(Pseudo.UNIQUE_INDEX));
  const m2 = read("migrations/002_pseudos_reserves.sql");
  assert.ok(m2.includes("PSEUDO_RESERVE") && m2.includes("PSEUDO_EMAIL"));
});

test("l'adresse e-mail (ou son préfixe) n'est plus jamais utilisée comme pseudo ou nom affiché", () => {
  ["auth.js", "discussions.html", "share.html", "index.html", "chat.html", "profil.html"].forEach((f) => {
    const code = f.endsWith(".js") ? stripComments(read(f)) : read(f);
    assert.ok(!/email\.split\(/.test(code), f + " : préfixe de l'e-mail utilisé");
    assert.ok(!/\|\|\s*(current)?[uU]ser\.email/.test(code), f + " : e-mail utilisé comme repli");
    assert.ok(!/fallbackName/.test(code), f + " : ancien repli sur l'e-mail");
  });
});

test("les pages concernées chargent pseudo.js, et le service worker le met en cache", () => {
  ["index.html", "chat.html", "discussions.html", "profil.html", "share.html"].forEach((f) => {
    assert.match(read(f), /<script src="\/?pseudo\.js"><\/script>/, f);
  });
  const sw = read("sw.js");
  assert.ok(sw.includes('"/pseudo.js"') && sw.includes('"/report.js"'));
  assert.ok(read("index.html").indexOf("pseudo.js") < read("index.html").indexOf('src="auth.js"'), "pseudo.js doit précéder auth.js");
});

test("sans nom (inscription par e-mail), auth.js crée un pseudo neutre", () => {
  const code = read("auth.js");
  assert.match(code, /MahoutoPseudo\.neutralName\(user\.id\)/);
  assert.match(code, /MahoutoPseudo\.looksLikeEmail\(userName\)/);
});

test("messages-prives.html : la recherche n'appelle pas search_profiles sans session", () => {
  const code = read("messages-prives.html");
  const start = code.indexOf("async function runSearch");
  const guard = code.indexOf("ensureLoggedIn()", start);
  const rpc = code.indexOf('rpc("search_profiles"', start);
  assert.ok(start > 0 && guard > start && rpc > guard, "contrôle de connexion avant l'appel");
});

test("les trois fonctions retirées à anon (migration 005) ne sont appelées que par les pages prévues", () => {
  const expected = {
    get_or_create_dm_conversation: ["messages-prives.html"],
    search_profiles: ["messages-prives.html"],
    get_public_profile: ["dm-chat.html", "messages-prives.html", "share.html"]
  };
  const files = fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f));
  const apiFiles = fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js")).map((f) => "api/" + f);
  Object.keys(expected).forEach((fn) => {
    const callers = files.concat(apiFiles).filter((f) => new RegExp('rpc\\(\\s*["\']' + fn + '["\']').test(read(f))).sort();
    assert.deepStrictEqual(callers, expected[fn], fn + " : appelants inattendus : " + callers.join(", "));
  });
});

console.log("\n" + passed + " test(s) réussi(s)");
