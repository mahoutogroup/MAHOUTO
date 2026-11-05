/* Garde-fous des fichiers SQL de migrations/ — exécution : node tests/migrations.test.js
   Lecture de fichiers uniquement : rien n'est exécuté, aucune base n'est touchée.
   L'exécution réelle des migrations se vérifie sur une base de test (voir la description de la PR). */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "migrations");
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const stripComments = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

const migrations = fs.readdirSync(dir).filter((f) => /^00[1-9]_.*\.sql$/.test(f)).sort();

test("trois migrations numérotées, chacune avec son retour arrière du même nom", () => {
  assert.deepStrictEqual(migrations.map((f) => f.slice(0, 3)), ["001", "002", "003"]);
  migrations.forEach((f) => assert.ok(fs.existsSync(path.join(dir, "rollback", f)), "retour arrière manquant : " + f));
});

test("chaque retour arrière commence par une ligne d'avertissement", () => {
  migrations.forEach((f) => assert.match(read("rollback/" + f).split("\n")[0], /^-- ⚠️ ATTENTION/, f));
});

test("chaque migration et chaque retour arrière tient dans une transaction", () => {
  migrations.forEach((f) => {
    [read(f), read("rollback/" + f)].forEach((sql) => {
      const code = stripComments(sql);
      assert.match(code, /^begin;$/m, f);
      assert.match(code, /^commit;$/m, f);
    });
  });
});

test("000 : le diagnostic est en lecture seule (chaque ordre commence par select ou with)", () => {
  const code = stripComments(read("000_diagnostic_lecture_seule.sql"));
  const orders = code.split(";").map((s) => s.trim()).filter(Boolean);
  assert.strictEqual(orders.length, 2, "deux requêtes attendues");
  orders.forEach((o) => assert.match(o, /^(select|with)\b/i));
});

test("000 : chaque requête renvoie une seule colonne (un seul résultat lisible)", () => {
  const code = stripComments(read("000_diagnostic_lecture_seule.sql"));
  assert.ok(/\)\) as diagnostic;/.test(code));
  assert.ok(/\)\) as comptes_portant_un_nom_reserve;/.test(code));
});

test("001 : restreint la lecture des profils à soi-même et aux admins, sans vue publique", () => {
  const code = stripComments(read("001_profils_lecture_restreinte.sql"));
  assert.match(code, /drop policy if exists "profiles_select_authenticated"/);
  assert.match(code, /using \(auth\.uid\(\) = id or public\.is_admin\(\)\)/);
  assert.ok(!/create (or replace )?view/i.test(code));
  assert.match(code, /raise exception/, "auto-vérification des politiques résiduelles");
});

test("001 : le retour arrière rétablit l'ancienne politique de lecture", () => {
  const code = stripComments(read("rollback/001_profils_lecture_restreinte.sql"));
  assert.match(code, /create policy "profiles_select_authenticated" on public\.profiles/);
  assert.match(code, /auth\.role\(\) = 'authenticated'/);
});

test("002 : la liste de départ des noms réservés est complète", () => {
  const code = read("002_pseudos_reserves.sql");
  ["MAJESTÉ AI", "MAJESTE AI", "MAHOUTO", "MAHOUTO+", "MAHOUTO SCHOOL", "MAJESTÉ PRESSE", "Admin", "Support", "Fondateur", "Annonces"]
    .forEach((n) => assert.ok(code.includes("('" + n + "')"), "nom absent : " + n));
});

test("002 : déclencheurs sur profiles et messages, message d'erreur reconnu par les pages", () => {
  const code = stripComments(read("002_pseudos_reserves.sql"));
  assert.match(code, /create trigger trg_reserved_username_profiles[\s\S]*on public\.profiles/);
  assert.match(code, /create trigger trg_reserved_username_messages[\s\S]*on public\.messages/);
  assert.ok(code.includes("PSEUDO_RESERVE"));
  ["auth.js", "chat.html", "discussions.html", "profil.html"].forEach((f) => {
    const page = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(page.includes("PSEUDO_RESERVE"), f + " ne gère pas le pseudo réservé");
  });
});

test("002 : aucune ligne existante n'est modifiée (pas d'update ni de delete sur les tables de données)", () => {
  const code = stripComments(read("002_pseudos_reserves.sql"));
  assert.ok(!/\bupdate\s+public\.(profiles|messages)\b/i.test(code));
  assert.ok(!/\bdelete\s+from\b/i.test(code));
});

test("003 : seuls l'identifiant, la raison et le type sont enregistrés ; unicité ; lecture réservée aux admins", () => {
  const code = stripComments(read("003_signalements.sql"));
  assert.match(code, /unique \(kind, message_id, reporter_id\)/);
  assert.match(code, /grant insert \(kind, message_id, reason\) on table public\.message_reports to authenticated/);
  assert.match(code, /for select to authenticated\s+using \(public\.is_admin\(\)\)/);
  assert.ok(!/\bcontent\b/.test(code.replace(/dm_messages|messages/g, "")), "aucune colonne de contenu");
  assert.ok(!/grant (update|delete)/i.test(code));
});

test("les fichiers SQL sont exclus du déploiement Vercel", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".vercelignore"), "utf8");
  assert.match(ignore, /^migrations\/?$/m);
});

console.log("\n" + passed + " test(s) réussi(s)");
