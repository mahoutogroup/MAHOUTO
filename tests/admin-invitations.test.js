/* admin/statistiques.html : bloc « Invitations » (totaux anonymes de invitation_admin_totaux). Lecture statique de la page et
   exécution réelle de la fonction loadInvitations dans un faux DOM. Aucun réseau, aucune base. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PAGE = read("admin/statistiques.html");
const SQL = read("invitations.sql");
const FN = PAGE.slice(PAGE.indexOf("// ---------- Invitations"), PAGE.indexOf("// ---------- fin des invitations ----------"));
const BLOCK = PAGE.slice(PAGE.indexOf('<div class="card block" id="invitations-block">'), PAGE.indexOf('<div class="card block">', PAGE.indexOf('id="invitations-block"')));
const visible = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const FORMES = /(?<![\p{L}])(tu|toi|ton|ta|tes|t'|connecte|réessaie|vérifie|saisis|clique)(?![\p{L}])/iu;

test("la fonction SQL existante renvoie bien les 3 valeurs affichées (aucun SQL à ajouter) et reste réservée aux administrateurs", () => {
  assert.match(SQL, /create or replace function public\.invitation_admin_totaux\(\)\s+returns table \(nb_codes bigint, total_inscrits bigint, nb_codes_avec_inscrits bigint\)/);
  assert.match(SQL, /if not public\.is_admin\(\) then\s+raise exception 'Reserve aux administrateurs' using errcode = '42501';/);
  assert.match(SQL, /grant execute on function public\.invitation_admin_totaux\(\) to authenticated;/);
  assert.match(SQL, /revoke all on function public\.invitation_admin_totaux\(\) from public, anon;/);
});

test("le bloc « Invitations » est sous le tableau « Sources » (et avant « Appareils »), avec trois nombres et un texte sobre vouvoyé", () => {
  assert.ok(BLOCK.length > 300);
  const i = (s) => PAGE.indexOf(s);
  assert.ok(i('<h2>Sources</h2>') < i('id="invitations-block"') && i('id="invitations-block"') < i('<h2>Appareils</h2>'));
  assert.match(BLOCK, /<h2>Invitations<\/h2>/);
  ["Codes créés", "Inscrits grâce aux invitations", "Codes avec au moins 1 inscrit"].forEach((l) => assert.ok(BLOCK.includes(">" + l + "<"), l));
  assert.strictEqual((BLOCK.match(/class="value"/g) || []).length, 3, "trois nombres seulement");
  assert.ok(!FORMES.test(visible(BLOCK)), "vouvoiement : " + visible(BLOCK));
  assert.ok(/aucun nom ni lien entre personnes/.test(BLOCK));
});

test("la page appelle invitation_admin_totaux (une fois, sans argument), avec la session administrateur déjà utilisée, sans bloquer le reste", () => {
  assert.strictEqual((PAGE.match(/rpc\("invitation_admin_totaux"\)/g) || []).length, 1, "un seul appel, sans argument");
  assert.ok(!/createClient\([^)]*\)[\s\S]*createClient\(/.test(PAGE), "un seul client Supabase : la session administrateur de la page");
  const init = PAGE.slice(PAGE.indexOf("async function init()"));
  assert.ok(init.indexOf("contentEl.classList.remove") < init.indexOf("loadInvitations()"), "après le contrôle administrateur");
  assert.match(init, /await loadAll\(\);\s+loadInvitations\(\)\.catch\(\(\) => \{[^}]*\}\);/, "lancé sans attendre, une erreur ne bloque rien");
  assert.ok(!/loadInvitations\(\)/.test(PAGE.slice(PAGE.indexOf("async function loadAll()"), PAGE.indexOf("function startLive"))), "pas rappelé à chaque changement de période (totaux depuis le début)");
});

test("AUCUNE donnée personnelle : seuls trois champs numériques sont lus et affichés (jamais nom, e-mail, code, identifiant ou lien invitant-invité)", () => {
  const champs = [...new Set([...FN.matchAll(/row\[|row\.([a-z_]+)/g)].map((m) => m[1]).filter(Boolean))];
  assert.deepStrictEqual(champs, [], "aucun accès par point : les champs sont dans la liste fermée");
  assert.deepStrictEqual([...FN.matchAll(/\["([a-z_]+)", "inv-[a-z]+", "inv-card-[a-z]+"\]/g)].map((m) => m[1]), ["nb_codes", "total_inscrits", "nb_codes_avec_inscrits"]);
  assert.ok(!/user_id|e-?mail|\bnom\b|username|invitations_codes|invitations_comptes|p_code|row\.code|\[0\]\.code|\["code"\]|JSON\.stringify|console\.|innerHTML|insertAdjacentHTML/i.test(FN), "aucune donnée personnelle, aucun code, aucun HTML injecté");
  assert.ok(!/from\("invitations|\.from\(/.test(FN), "jamais de lecture directe d'une table");
  assert.ok(!/user_id|e-?mail|code d'invitation/i.test(visible(BLOCK).replace(/Codes créés|Codes avec au moins 1 inscrit/g, "")), "rien de nominatif dans le bloc");
  assert.ok((FN.match(/\.textContent\s*=/g) || []).length >= 3, "affichage en texte seulement");
});

// ---------- exécution réelle de loadInvitations dans un faux DOM ----------
function run(rpc) {
  const els = {}; ["inv-message", "inv-codes", "inv-inscrits", "inv-avec", "inv-card-codes", "inv-card-inscrits", "inv-card-avec"].forEach((i) => {
    const s = new Set(i === "inv-message" ? ["hidden"] : []);
    els[i] = { textContent: "–", classList: { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) } };
  });
  const calls = [];
  const sb = { rpc: async (n, a) => { calls.push([n, a === undefined ? "sans argument" : JSON.stringify(a)]); return rpc(); } };
  const code = FN.replace(/^[^\n]*\n/, "") + "\nloadInvitations;";
  const f = vm.runInNewContext("(function(supabase, $, nf, isFinite, Number, Array){ " + code.replace(/loadInvitations;$/, "return loadInvitations;") + " })", {})(sb, (i) => els[i], { format: (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") }, isFinite, Number, Array);
  return { els, calls, run: () => f() };
}
const hid = (e) => e.classList.contains("hidden");

test("loadInvitations : affiche les trois totaux (nombres seulement) après un appel sans argument", async () => {
  const r = run(async () => ({ data: [{ nb_codes: 12, total_inscrits: "3456", nb_codes_avec_inscrits: 7, code: "ABCDEFGH23", user_id: "00000000-0000-4000-8000-0000000000aa", nom: "Marie" }], error: null }));
  await r.run();
  assert.deepStrictEqual(r.calls, [["invitation_admin_totaux", "sans argument"]]);
  assert.deepStrictEqual([r.els["inv-codes"].textContent, r.els["inv-inscrits"].textContent, r.els["inv-avec"].textContent], ["12", "3 456", "7"]);
  const tout = Object.values(r.els).map((e) => e.textContent).join("|"); assert.ok(!/ABCDEFGH23|0000000000aa|Marie/.test(tout), "un champ inattendu renvoyé n'est jamais affiché");
  assert.ok(hid(r.els["inv-message"]) && !hid(r.els["inv-card-avec"]));
});

test("loadInvitations : une valeur non renvoyée est simplement masquée (aucun SQL ajouté) ; valeurs invalides → « – »", async () => {
  let r = run(async () => ({ data: [{ nb_codes: 5, total_inscrits: 2 }], error: null })); await r.run();
  assert.ok(hid(r.els["inv-card-avec"]) && !hid(r.els["inv-card-codes"]) && !hid(r.els["inv-card-inscrits"]));
  assert.deepStrictEqual([r.els["inv-codes"].textContent, r.els["inv-inscrits"].textContent], ["5", "2"]);
  r = run(async () => ({ data: [{ nb_codes: "abc", total_inscrits: -4, nb_codes_avec_inscrits: null }], error: null })); await r.run();
  assert.deepStrictEqual([r.els["inv-codes"].textContent, r.els["inv-inscrits"].textContent, hid(r.els["inv-card-avec"])], ["–", "–", true]);
  r = run(async () => ({ data: [{ nb_codes: 0, total_inscrits: 0, nb_codes_avec_inscrits: 0 }], error: null })); await r.run();
  assert.deepStrictEqual([r.els["inv-codes"].textContent, r.els["inv-inscrits"].textContent, r.els["inv-avec"].textContent], ["0", "0", "0"], "zéro est affiché, pas masqué");
});

test("loadInvitations : accès refusé ou échec → message court vouvoyé, jamais d'exception, le reste de la page n'est pas touché", async () => {
  const cas = [[async () => ({ data: null, error: { code: "42501", message: "Reserve aux administrateurs" } }), /^Accès refusé : ces totaux sont réservés aux administrateurs\.$/],
    [async () => ({ data: null, error: { status: 403 } }), /^Accès refusé/], [async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }), /^Les totaux des invitations ne sont pas disponibles pour le moment\. Vérifiez que le script SQL des invitations a bien été exécuté\.$/],
    [async () => { throw new Error("réseau"); }, /^Les totaux des invitations ne sont pas disponibles/], [async () => ({ data: [], error: null }), /^Les totaux des invitations ne sont pas disponibles/], [async () => ({ data: "x", error: null }), /^Les totaux des invitations ne sont pas disponibles/]];
  for (const [fn, re] of cas) {
    const r = run(fn); await assert.doesNotReject(r.run());
    assert.match(r.els["inv-message"].textContent, re); assert.ok(!hid(r.els["inv-message"]));
    assert.ok(!FORMES.test(r.els["inv-message"].textContent), "vouvoiement"); assert.strictEqual(r.els["inv-codes"].textContent, "–");
  }
});

test("sw.js : cache v135 (main est à v134) ; page d'administration toujours hors du pré-cache ; aucun fichier dans api/", () => {
  const sw = read("sw.js"); assert.match(sw, /const CACHE_NAME = "mahoutoplus-shell-v(135|13[6-9]|1[4-9]\d)";/);
  assert.ok(!sw.includes("statistiques.html"), "la page d'administration n'est pas pré-cachée");
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci/.test(PAGE + read("tests/admin-invitations.test.js").slice(0, 0)), "aucune clé");
});
