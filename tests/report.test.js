/* Tests du signalement de messages — exécution : node tests/report.test.js
   Aucune dépendance, aucun réseau, aucune base : un faux client Supabase enregistre les appels. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Report = require("../report");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

// Faux client : from(table).insert(payload) -> { error }. Pas de .select() : si report.js en
// demandait un (retour de ligne), l'appel lèverait une erreur et le test échouerait.
function fakeSupabase(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert(payload) { calls.push({ table, payload }); return Promise.resolve(result || { error: null }); }
      };
    }
  };
}

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "003_signalements.sql"), "utf8");
  const inList = (re) => (sql.match(re) || [])[1].split(",").map((s) => s.trim().replace(/'/g, ""));

  await test("les raisons proposées sont exactement celles que la base accepte", () => {
    const sqlReasons = inList(/reason text not null check \(reason in \(([^)]*)\)\)/);
    assert.deepStrictEqual(Report.REASONS.map((r) => r.value).sort(), sqlReasons.slice().sort());
  });

  await test("les types de message sont exactement ceux que la base accepte", () => {
    const sqlKinds = inList(/kind text not null check \(kind in \(([^)]*)\)\)/);
    assert.deepStrictEqual(Report.KINDS.slice().sort(), sqlKinds.slice().sort());
  });

  await test("chaque raison a un libellé lisible", () => {
    Report.REASONS.forEach((r) => assert.ok(r.label && r.label.length > 3, r.value));
  });

  await test("isValidRequest : accepte une demande correcte, refuse le reste", () => {
    assert.strictEqual(Report.isValidRequest("room", 12, "spam"), true);
    assert.strictEqual(Report.isValidRequest("dm", "7", "autre"), true);
    assert.strictEqual(Report.isValidRequest("salon", 12, "spam"), false);
    assert.strictEqual(Report.isValidRequest("room", 0, "spam"), false);
    assert.strictEqual(Report.isValidRequest("room", -3, "spam"), false);
    assert.strictEqual(Report.isValidRequest("room", 1.5, "spam"), false);
    assert.strictEqual(Report.isValidRequest("room", "abc", "spam"), false);
    assert.strictEqual(Report.isValidRequest("room", 12, "nimporte"), false);
    assert.strictEqual(Report.isValidRequest("room", 12, undefined), false);
  });

  await test("submit : n'envoie que le type, l'identifiant et la raison (jamais le contenu ni l'auteur)", async () => {
    const supabase = fakeSupabase();
    const res = await Report.submit(supabase, "room", "42", "harcelement");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(supabase.calls.length, 1);
    assert.strictEqual(supabase.calls[0].table, "message_reports");
    assert.deepStrictEqual(supabase.calls[0].payload, { kind: "room", message_id: 42, reason: "harcelement" });
  });

  await test("submit : un doublon donne le message « déjà signalé »", async () => {
    const supabase = fakeSupabase({ error: { code: "23505", message: "duplicate key" } });
    const res = await Report.submit(supabase, "dm", 5, "spam");
    assert.strictEqual(res.ok, false);
    assert.match(res.message, /déjà signalé/);
  });

  await test("submit : toute autre erreur donne un message générique, sans détail technique", async () => {
    const supabase = fakeSupabase({ error: { code: "42P01", message: 'relation "message_reports" does not exist' } });
    const res = await Report.submit(supabase, "room", 5, "spam");
    assert.strictEqual(res.ok, false);
    assert.match(res.message, /Impossible d'envoyer le signalement/);
    assert.ok(!/relation|message_reports|42P01/.test(res.message));
  });

  await test("submit : une exception réseau est rattrapée", async () => {
    const supabase = { from() { return { insert() { return Promise.reject(new Error("réseau")); } }; } };
    const res = await Report.submit(supabase, "room", 5, "spam");
    assert.strictEqual(res.ok, false);
    assert.match(res.message, /Impossible/);
  });

  await test("submit : une demande invalide n'appelle pas la base", async () => {
    const supabase = fakeSupabase();
    const res = await Report.submit(supabase, "room", 5, "");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(supabase.calls.length, 0);
  });

  await test("le module n'utilise pas innerHTML et ne demande pas la ligne en retour (.select)", () => {
    // Commentaires retirés : seuls les appels réels comptent.
    const code = fs.readFileSync(path.join(__dirname, "..", "report.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!/innerHTML/.test(code));
    assert.ok(!/\.select\(/.test(code));
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
