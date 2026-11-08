/* Le formulaire de pseudo des salons ne doit jamais écraser le pseudo d'un compte qui en a déjà un.
   Exécution : node tests/pseudo-ecrasement.test.js — aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Pseudo = require("../pseudo");

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

// Faux client : enregistre toute écriture (upsert / update / insert) sur profiles.
function fakeSupabase({ row, readError, writeError }) {
  const writes = [];
  return {
    writes,
    from(table) {
      assert.strictEqual(table, "profiles");
      return {
        select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: row === undefined ? null : row, error: readError || null }); } }; } }; },
        upsert(payload, opts) { writes.push({ op: "upsert", payload, opts }); return Promise.resolve({ error: writeError || null }); },
        insert(payload) { writes.push({ op: "insert", payload }); return Promise.resolve({ error: writeError || null }); },
        update(payload) { return { eq(col, val) { writes.push({ op: "update", payload, col, val }); return Promise.resolve({ error: writeError || null }); } }; }
      };
    }
  };
}

(async () => {
  await test("compte connecté avec un pseudo (Google, e-mail) : rien n'est écrit, le pseudo du profil est gardé", async () => {
    const db = fakeSupabase({ row: { username: "Awa Google" } });
    const res = await Pseudo.saveIfMissing(db, "u1", "Autre pseudo saisi");
    assert.deepStrictEqual(res, { error: null, username: "Awa Google", kept: true });
    assert.strictEqual(db.writes.length, 0, "aucune écriture (ni upsert, ni update)");
  });

  await test("compte anonyme sans profil : le pseudo saisi est enregistré, sans écraser une ligne qui apparaîtrait entre-temps", async () => {
    const db = fakeSupabase({ row: null });
    const res = await Pseudo.saveIfMissing(db, "u2", "Koffi");
    assert.deepStrictEqual(res, { error: null, username: "Koffi", kept: false });
    assert.strictEqual(db.writes.length, 1);
    assert.strictEqual(db.writes[0].op, "upsert");
    assert.deepStrictEqual(db.writes[0].payload, { id: "u2", username: "Koffi" });
    assert.strictEqual(db.writes[0].opts.ignoreDuplicates, true, "ON CONFLICT DO NOTHING : jamais d'écrasement");
  });

  await test("ligne existante mais pseudo vide : on le renseigne (update ciblé), sans upsert", async () => {
    for (const empty of ["", "   ", null]) {
      const db = fakeSupabase({ row: { username: empty } });
      const res = await Pseudo.saveIfMissing(db, "u3", "Awa");
      assert.strictEqual(res.kept, false);
      assert.deepStrictEqual(db.writes, [{ op: "update", payload: { username: "Awa" }, col: "id", val: "u3" }]);
    }
  });

  await test("lecture du profil impossible (réseau) : RIEN n'est écrit, l'erreur est renvoyée", async () => {
    const db = fakeSupabase({ readError: { code: "PGRST000", message: "réseau" } });
    const res = await Pseudo.saveIfMissing(db, "u4", "Awa");
    assert.ok(res.error);
    assert.strictEqual(res.kept, false);
    assert.strictEqual(db.writes.length, 0);
  });

  await test("pseudo refusé par la base (réservé, e-mail, déjà pris) : l'erreur remonte pour le message à l'écran", async () => {
    const db = fakeSupabase({ row: null, writeError: { message: "PSEUDO_RESERVE: x", code: "23514" } });
    const res = await Pseudo.saveIfMissing(db, "u5", "Admin");
    assert.strictEqual(Pseudo.refusal(res.error).kind, "reserved");
    assert.strictEqual(res.username, "Admin");
  });

  await test("isNeutralName : « Membre xxxxxx » (6 ou 8 caractères) oui, un vrai nom non", () => {
    assert.strictEqual(Pseudo.isNeutralName("Membre 0b3b3d"), true);
    assert.strictEqual(Pseudo.isNeutralName("Membre 0b3b3de9"), true);
    assert.strictEqual(Pseudo.isNeutralName("Membre Dupont"), false);
    assert.strictEqual(Pseudo.isNeutralName("Awa Koffi"), false);
  });

  // ---------- pages ----------
  for (const page of ["chat.html", "discussions.html"]) {
    const code = strip(read(page));
    await test(page + " : ensureProfile passe par saveIfMissing ; plus aucun upsert direct du pseudo saisi sur profiles", () => {
      assert.match(code, /MahoutoPseudo\.saveIfMissing\(supabase, userId, username\)/);
      assert.ok(!/\.from\("profiles"\)\s*\.upsert\(/.test(code), "aucun .from(\"profiles\").upsert(...) direct");
      assert.ok(!/\.upsert\(\s*\{\s*id:\s*userId,\s*username/.test(code));
    });

    await test(page + " : joinChat n'écrit pas le pseudo saisi par-dessus un profil (erreur de lecture : on s'arrête)", () => {
      const join = code.slice(code.indexOf("async function joinChat"), code.indexOf("async function", code.indexOf("async function joinChat") + 10));
      assert.match(join, /const result = await ensureProfile\(currentUser\.id, username\)/);
      assert.match(join, /if \(result\.error\) throw result\.error;/);
      // une fois l'erreur écartée, le formulaire ne réécrit rien d'autre sur profiles
      assert.ok(!/from\("profiles"\)\s*\.(upsert|update|insert)/.test(join));
    });
  }

  await test("chat.html : le pseudo affiché est celui du profil si le compte en avait déjà un (pas celui saisi)", () => {
    const code = strip(read("chat.html"));
    assert.match(code, /currentUsername = result\.username;/);
    assert.ok(!/currentUsername = username;/.test(code));
  });

  await test("discussions.html : la création du pseudo au retour Google lit déjà le profil, puis ensureProfile relit avant d'écrire", () => {
    const code = strip(read("discussions.html"));
    assert.match(code, /MahoutoPseudo\.refusal\(\(await ensureProfile\(currentUser\.id, wanted\)\)\.error\)/);
  });

  await test("autres écritures sur profiles dans le dépôt : seules celles attendues (inventaire)", () => {
    const writers = {};
    fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f)).concat(fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js")).map((f) => "api/" + f))
      .forEach((f) => {
        const code = strip(read(f));
        const re = /\.from\("profiles"\)\s*(?:\.select\([^)]*\)\s*)?\.(upsert|update|insert|delete)\(/g;
        let m; while ((m = re.exec(code))) (writers[f] = writers[f] || []).push(m[1]);
      });
    // pseudo pris dans « Mon profil » (action volontaire), création au premier login (auth.js), avatar Google (auth.js, profil.html)
    assert.deepStrictEqual(Object.keys(writers).sort(), ["auth.js", "pseudo.js", "profil.html"].sort());
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
