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

const OFFICIAL_IDS = [
  "0b3b3de9-b835-40ec-b076-22fdc3c4ab02", "8894a9f5-c2e4-45c3-a927-e36f64a104f7", "0a68d262-5615-4819-8d48-e6522f6a0e6f",
  "5b096879-b856-42f5-9952-790f09abbf6f", "6706610f-5a79-411b-a24d-07481cbd0ce7", "9e999155-e1c9-4286-adc4-9f4c97c95c3b",
  "1af183aa-45ef-4a4d-afa9-6b77ca8b04a2", "149965bd-1565-40ce-bc6d-07154f43c256", "ae75d336-3653-487f-bec2-5ee793e0fafa"
];

test("cinq migrations numérotées (001 à 005), chacune avec son retour arrière du même nom", () => {
  assert.deepStrictEqual(migrations.map((f) => f.slice(0, 3)), ["001", "002", "003", "004", "005"]);
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

test("000 : le diagnostic est en lecture seule (trois ordres, chacun commence par select ou with)", () => {
  const code = stripComments(read("000_diagnostic_lecture_seule.sql"));
  const orders = code.split(";").map((s) => s.trim()).filter(Boolean);
  assert.strictEqual(orders.length, 3, "trois requêtes attendues");
  orders.forEach((o) => assert.match(o, /^(select|with)\b/i));
});

test("000 : chaque requête renvoie une seule colonne (un seul résultat lisible)", () => {
  const code = stripComments(read("000_diagnostic_lecture_seule.sql"));
  ["diagnostic", "comptes_portant_un_nom_reserve", "doublons_et_pseudos_email"].forEach((c) => assert.ok(code.includes(")) as " + c + ";"), c));
});

test("001 : lecture des profils réservée à soi-même et aux admins ; aucune vue ; déclencheurs de rôle non touchés", () => {
  const code = stripComments(read("001_profils_lecture_restreinte.sql"));
  assert.match(code, /drop policy if exists "profiles_select_authenticated"/);
  assert.match(code, /using \(auth\.uid\(\) = id or public\.is_admin\(\)\)/);
  assert.ok(!/create (or replace )?view/i.test(code));
  assert.ok(!/drop trigger|create trigger|alter table .* disable trigger/i.test(code), "les déclencheurs de rôle ne doivent pas être touchés");
  assert.ok(code.includes("trg_prevent_profile_role_change") && code.includes("trg_protect_role"));
  assert.match(code, /raise exception/, "auto-vérification des politiques résiduelles");
});

test("001 : le retour arrière rétablit l'ancienne politique de lecture", () => {
  const code = stripComments(read("rollback/001_profils_lecture_restreinte.sql"));
  assert.match(code, /create policy "profiles_select_authenticated" on public\.profiles/);
  assert.match(code, /auth\.role\(\) = 'authenticated'/);
});

test("002 : liste de départ des noms réservés complète", () => {
  const code = read("002_pseudos_reserves.sql");
  ["MAJESTÉ AI", "MAJESTE AI", "MAHOUTO", "MAHOUTO+", "MAHOUTO SCHOOL", "MAJESTÉ PRESSE", "Admin", "Support", "Fondateur", "Annonces"]
    .forEach((n) => assert.ok(code.includes("('" + n + "')"), "nom absent : " + n));
});

test("002 : les 9 comptes officiels sont exemptés par identifiant, plus les rôles founder / admin / super_admin", () => {
  const code = stripComments(read("002_pseudos_reserves.sql"));
  OFFICIAL_IDS.forEach((id) => assert.ok(code.includes("('" + id + "'::uuid"), "identifiant absent : " + id));
  assert.strictEqual((code.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::uuid/g) || []).length, 9);
  assert.match(code, /public\.is_admin\(\)/);
  assert.match(code, /reserved_username_exempt_accounts e where e\.user_id = auth\.uid\(\)/);
  // is_admin() couvre ces trois rôles dans le schéma du dépôt
  const schema = fs.readFileSync(path.join(__dirname, "..", "supabase-schema.sql"), "utf8");
  assert.match(schema, /role in \('admin', 'super_admin', 'founder'\)/);
});

test("002 : contrôle seulement à l'insertion ou quand le pseudo change", () => {
  const code = stripComments(read("002_pseudos_reserves.sql"));
  assert.match(code, /before insert or update of username on public\.profiles/);
  assert.match(code, /before insert or update of username on public\.messages/);
  assert.strictEqual((code.match(/tg_op = 'UPDATE' and new\.username is not distinct from old\.username/g) || []).length, 2);
});

test("002 : aucune donnée existante modifiée (pas d'update ni de delete sur profils et messages)", () => {
  const code = stripComments(read("002_pseudos_reserves.sql"));
  assert.ok(!/\bupdate\s+public\.(profiles|messages)\b/i.test(code));
  assert.ok(!/\bdelete\s+from\b/i.test(code));
});

test("002 : les pages gèrent PSEUDO_RESERVE et PSEUDO_EMAIL (module partagé pseudo.js)", () => {
  assert.ok(stripComments(read("002_pseudos_reserves.sql")).includes("PSEUDO_EMAIL"));
  const pseudo = fs.readFileSync(path.join(__dirname, "..", "pseudo.js"), "utf8");
  assert.ok(pseudo.includes("PSEUDO_RESERVE") && pseudo.includes("PSEUDO_EMAIL"));
});

test("003 : le navigateur n'écrit que le type, l'identifiant et la raison ; le texte du message privé est copié par la base", () => {
  const code = stripComments(read("003_signalements.sql"));
  assert.match(code, /grant insert \(kind, message_id, reason\) on table public\.message_reports to authenticated/);
  assert.ok(!/grant insert \([^)]*(message_text|reported_user_id|reporter_id)/.test(code));
  assert.match(code, /unique \(kind, message_id, reporter_id\)/);
  assert.match(code, /for select to authenticated\s+using \(public\.is_admin\(\)\)/);
  assert.match(code, /create trigger trg_message_report_snapshot\s+before insert on public\.message_reports/);
  assert.ok(!/grant (update|delete)/i.test(code));
});

test("003 : une seule lecture de message privé, par identifiant, dans le déclencheur ; aucune fonction de lecture pour les admins", () => {
  const code = stripComments(read("003_signalements.sql"));
  assert.strictEqual((code.match(/from public\.dm_messages d\s+where d\.id = new\.message_id/g) || []).length, 1);
  assert.ok(!/create (or replace )?function public\.[a-z_]*(admin|read|get)[a-z_]*dm/i.test(code));
  assert.ok(!/policy[^;]*on public\.dm_messages/i.test(code), "la RLS de dm_messages ne doit pas changer");
  assert.match(code, /revoke execute on function public\.fill_message_report_snapshot\(\)/);
});

test("004 : la vérification des doublons précède la création de l'index unique ; index partiel sur le pseudo normalisé", () => {
  const code = stripComments(read("004_pseudos_uniques.sql"));
  const check = code.indexOf("raise exception");
  const index = code.indexOf("create unique index");
  assert.ok(check > 0 && index > check, "vérification avant l'index");
  assert.match(code, /profiles_username_unique_idx/);
  assert.match(code, /lower\(translate\(regexp_replace\(trim\(username\), '\\s\+', ' ', 'g'\)/);
  assert.match(code, /where trim\(username\) <> ''/);
  assert.ok(!/\b(update|delete)\b/i.test(code));
});

test("004 : l'expression de l'index est la même que celle de la requête de doublons (000, requête 3)", () => {
  const idx = stripComments(read("004_pseudos_uniques.sql"));
  const diag = stripComments(read("000_diagnostic_lecture_seule.sql"));
  const expr = idx.match(/lower\(translate\(regexp_replace\(trim\(username\)[^\n]*?'\)\)/)[0];
  const asDiag = expr.replace("trim(username)", "trim(p.username)");
  assert.ok(diag.includes(asDiag), "expression différente entre l'index et la requête de doublons");
});

test("005 : retire anon et PUBLIC sur les trois fonctions, redonne authenticated et service_role, ne touche pas is_admin()", () => {
  const code = stripComments(read("005_anon_sans_fonctions_messagerie.sql"));
  ["get_or_create_dm_conversation(uuid)", "search_profiles(text)", "get_public_profile(uuid)"].forEach((f) => {
    assert.ok(code.includes("revoke execute on function public." + f + " from public, anon;"), "revoke " + f);
    assert.ok(code.includes("grant execute on function public." + f + " to authenticated, service_role;"), "grant " + f);
  });
  assert.ok(!/(revoke|grant)[^;]*is_admin/i.test(code.replace(/has_function_privilege\([^)]*\)/g, "")), "is_admin() ne doit être ni retirée ni modifiée");
  assert.ok(!/revoke[^;]*\bauthenticated\b/i.test(code));
});

test("005 : le retour arrière redonne l'exécution à anon", () => {
  const code = stripComments(read("rollback/005_anon_sans_fonctions_messagerie.sql"));
  ["get_or_create_dm_conversation(uuid)", "search_profiles(text)", "get_public_profile(uuid)"].forEach((f) =>
    assert.ok(code.includes("grant execute on function public." + f + " to public, anon, authenticated, service_role;")));
});

test("les fichiers SQL sont exclus du déploiement Vercel", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".vercelignore"), "utf8");
  assert.match(ignore, /^migrations\/?$/m);
});

console.log("\n" + passed + " test(s) réussi(s)");
