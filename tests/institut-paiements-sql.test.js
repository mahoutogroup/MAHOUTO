/* Garde-fous statiques de institut-paiements.sql, de son retour arrière et de son SQL de vérification (PR 4 de l'Institut).
   Lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté, aucune base n'est touchée. Le comportement réel
   (idempotence, droits, contraintes) est éprouvé à part sur un PostgreSQL local jetable (voir la description de la PR). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read("institut-paiements.sql");
const sql = strip(raw);
const rollbackRaw = read("institut-paiements-rollback.sql");
const rollback = strip(rollbackRaw);
const verifRaw = read("institut-paiements-verification.sql");
const verif = strip(verifRaw);
const FUNCTIONS = ["institut_paiement_place", "institut_paiement_acces", "institut_confirmer_paiement", "institut_echouer_paiement"];

function blocks(text) {
  const parts = text.split(/^-- BLOC (\d+) — /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}
const fnBody = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$function\\$;").exec(sql); assert.ok(m, name); return m[0]; };

test("blocs numérotés 1 à 8, dans l'ordre, courts, listés dans la note de tête", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 60, "bloc " + x.n + " trop long"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 — "));
  for (let n = 1; n <= 8; n++) assert.ok(new RegExp("--   BLOC " + n + "\\s+—").test(head), "note de tête : bloc " + n);
});

test("aucun secret, aucun numéro, aucun e-mail, aucune donnée réelle ; jamais « Saint-Louis »", () => {
  [raw, rollbackRaw, verifRaw].forEach((t) => {
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t), "e-mail");
    assert.ok(!/\+?\d[\d ]{8,}\d/.test(t.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "")), "numéro");
    assert.ok(!/Saint-Louis/i.test(t));
    assert.ok(!/(sk_live|sk_sandbox|service_role_key\s*=|eyJ)/.test(t), "clé");
  });
});

test("additif : seule institut_places est modifiée (contraintes) ; rien sur purchases / formations / messages / rooms / profiles", () => {
  const alters = [...sql.matchAll(/alter table\s+(public\.\w+)/gi)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(alters)].sort(), ["public.institut_paiements", "public.institut_places"]);
  assert.ok(!/(update|delete from|drop table|truncate)\s+public\.(purchases|formations|messages|rooms|profiles)/i.test(sql));
  assert.ok(!/create (or replace )?trigger/i.test(sql), "aucun déclencheur ajouté");
  // purchases : une seule insertion, dans la fonction interne d'accès
  assert.strictEqual((sql.match(/insert into public\.purchases/g) || []).length, 1);
  assert.ok(fnBody("institut_paiement_acces").includes("insert into public.purchases"));
});

test("institut_places : source « payee » acceptée, cohérence avec don_id conservée", () => {
  assert.match(sql, /check \(source in \('don', 'offerte', 'payee'\)\)/);
  assert.match(sql, /check \(\(source = 'don' and don_id is not null\) or \(source in \('offerte', 'payee'\) and don_id is null\)\)/);
});

test("institut_paiements : colonnes, contraintes, transaction unique, RLS lecture seule (payeur et admin)", () => {
  const t = /create table if not exists public\.institut_paiements \([\s\S]*?\n\);/.exec(sql)[0];
  ["type text not null", "formation_id text not null", "montant integer not null", "fedapay_transaction_id text not null unique", "statut text not null default 'en_attente'", "demande_id uuid", "note text"].forEach((c) => assert.ok(t.includes(c), c));
  assert.match(sql, /check \(type in \('parrain', 'petit_fils'\)\)/);
  assert.match(sql, /check \(statut in \('en_attente', 'paye', 'echoue'\)\)/);
  assert.match(sql, /check \(montant > 0\)/);
  assert.match(sql, /check \(\(statut = 'paye'\) = \(confirme_le is not null\)\)/);
  assert.match(sql, /alter table public\.institut_paiements enable row level security;/);
  assert.match(sql, /revoke all on public\.institut_paiements from anon, authenticated;\s+grant select on public\.institut_paiements to authenticated;/);
  const pols = [...sql.matchAll(/create policy "(\w+)" on public\.institut_paiements\s+for (\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(pols, [["institut_paiements_payeur_select", "select"], ["institut_paiements_admin_select", "select"]]);
  assert.ok(!/grant (insert|update|delete)/i.test(sql), "aucune écriture directe");
});

test("fonctions : security definer, search_path fixé, droits retirés à public/anon/authenticated, confirmer/échouer réservées au service_role", () => {
  FUNCTIONS.forEach((f) => {
    const b = fnBody(f);
    assert.ok(/security definer/.test(b) && /set search_path = public, pg_temp/.test(b), f);
    assert.match(sql, new RegExp("revoke all on function public\\." + f + "\\([^)]*\\) from public, anon, authenticated;"));
  });
  ["institut_confirmer_paiement\\(text, integer\\)", "institut_echouer_paiement\\(text\\)"].forEach((f) => assert.match(sql, new RegExp("grant execute on function public\\." + f + " to service_role;")));
  assert.ok(!/grant execute on function public\.institut_paiement_(place|acces)/.test(sql), "fonctions internes jamais exposées");
});

test("confirmation : verrou, seul en_attente passe à paye (idempotent), montant comparé, aucun accès sans appel du serveur", () => {
  const b = fnBody("institut_confirmer_paiement");
  assert.match(b, /where fedapay_transaction_id = p_transaction_id for update/);
  assert.match(b, /if v\.statut = 'paye' then\s+return jsonb_build_object\('resultat', 'deja_confirme'\)/);
  assert.match(b, /if p_montant is null or v\.montant <> p_montant then[\s\S]*'montant_incoherent'/);
  assert.match(b, /auth\.role\(\)[\s\S]*'service_role'/);
  assert.ok(b.indexOf("deja_confirme") < b.indexOf("institut_paiement_place"), "idempotence avant toute création");
});

test("cas parrain : demande validée exigée, jamais deux places, code généré par institut_code_genere, source « payee »", () => {
  const b = fnBody("institut_paiement_place");
  assert.match(b, /from public\.institut_demandes where id = v_p\.demande_id for update/);
  assert.match(b, /v_demande\.statut <> 'validee'[\s\S]*'demande_non_validee'/);
  assert.match(b, /exists \(select 1 from public\.institut_places where demande_id = v_p\.demande_id\)[\s\S]*'place_deja_existante'/);
  assert.match(b, /values \(v_p\.demande_id, v_p\.formation_id, 'payee', null, public\.institut_code_genere\(\), v_p\.user_id\)/);
  assert.match(b, /exception when unique_violation/);
});

test("cas petit-fils : purchases « paid », montant = prix payé, jamais de doublon d'accès, identifiant de transaction enregistré", () => {
  const b = fnBody("institut_paiement_acces");
  assert.match(b, /x\.status = 'paid'[\s\S]*'deja_possedee'/);
  assert.match(b, /values \(v_p\.user_id, v_p\.formation_id, coalesce\(v_nom, v_p\.formation_id\), v_p\.montant, 'paid', 'formation', now\(\), v_p\.fedapay_transaction_id, 'approved'\)/);
  assert.match(b, /exception when unique_violation then\s+return 'achat_existant'/);
});

test("retour arrière : confirmation 'NON' par défaut, avertissement, ne touche pas purchases ni les autres tables, rétablit les contraintes d'origine", () => {
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /raise exception 'Retour arrière NON confirmé/);
  assert.match(rollbackRaw, /IRRÉVERSIBLE/);
  assert.match(rollback, /drop table if exists public\.institut_paiements;/);
  FUNCTIONS.forEach((f) => assert.ok(rollback.includes("drop function if exists public." + f + "("), f));
  assert.match(rollback, /update public\.institut_places set source = 'offerte' where source = 'payee';/);
  assert.match(rollback, /check \(source in \('don', 'offerte'\)\)/);
  assert.ok(!/(delete from|update|alter table|drop table)\s+(if exists\s+)?public\.(purchases|formations|messages|rooms|profiles)/i.test(rollback));
  assert.deepStrictEqual(blocks(rollbackRaw).map((x) => x.n), [1, 2, 3]);
});

test("vérification : lecture seule (aucune écriture), couvre RLS, droits, fonctions, contraintes et empreintes", () => {
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(verif.replace(/'[^']*'/g, "''")), "lecture seule");
  ["pg_policies", "has_table_privilege", "has_function_privilege", "pg_constraint", "relrowsecurity", "md5("].forEach((k) => assert.ok(verif.includes(k), k));
});
