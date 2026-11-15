/* Garde-fous statiques de salons-abonnement.sql, de son retour arrière et du SQL de vérification.
   Exécution : node tests/salon-abonnement-sql.test.js — lecture de fichiers UNIQUEMENT : aucun SQL n'est
   exécuté, aucune base n'est touchée. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const rawMain = read("salons-abonnement.sql");
const sql = strip(rawMain);
const rollback = strip(read("salons-abonnement-rollback.sql"));
const verifRaw = read("salons-abonnement-verification.sql");
const verif = strip(verifRaw);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}
const fnBody = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$function\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const ORIGINAL_POLICIES = ["messages_public_read", "messages_insert_own", "messages_update_own", "messages_delete_room_owner_or_admin"];

test("prérequis vérifiés (DO) : is_admin(), tables rooms / messages / purchases", () => {
  const head = sql.slice(0, sql.indexOf("alter table public.rooms add column"));
  assert.match(head, /to_regprocedure\('public\.is_admin\(\)'\) is null[\s\S]*raise exception/);
  assert.match(head, /to_regclass\('public\.rooms'\) is null[\s\S]*to_regclass\('public\.messages'\) is null[\s\S]*to_regclass\('public\.purchases'\) is null[\s\S]*raise exception/);
});

test("AUCUN salon existant modifié : rooms.abonnement vaut false par défaut, aucun update / delete de données", () => {
  assert.match(sql, /alter table public\.rooms add column if not exists abonnement boolean not null default false;/);
  assert.ok(!/^(update|delete\s+from|truncate|copy)\b/im.test(sql), "aucune instruction de modification de données au niveau racine");
  assert.ok(!/\binsert\s+into\s+public\.(rooms|messages|purchases)\b/i.test(sql));
  assert.match(sql, /check \(abonnement = false or is_paid = true\)/, "un salon en abonnement doit être payant");
});

test("PURCHASES et les 4 règles d'origine de messages ne sont JAMAIS touchées (ni table, ni règle, ni droit)", () => {
  assert.ok(!/alter\s+table\s+public\.purchases|drop\s+table[^;]*purchases|insert\s+into\s+public\.purchases|update\s+public\.purchases|delete\s+from\s+public\.purchases/i.test(sql));
  assert.ok(!/policy[^;]*\bon public\.purchases\b/i.test(sql), "aucune règle sur purchases");
  ORIGINAL_POLICIES.forEach((n) => {
    assert.ok(!new RegExp('(drop|create|alter)\\s+policy\\s+(if exists\\s+)?"' + n + '"', "i").test(sql), n + " ne doit pas être touchée");
  });
  assert.ok(!/alter\s+table\s+public\.messages/i.test(sql), "aucun changement de structure de messages");
});

test("règles d'accès des abonnés : 3 règles SUPPLÉMENTAIRES (permissives) sur messages, basées sur salon_abonnement_actif()", () => {
  const pol = [...sql.matchAll(/create policy "(\w+)" on public\.messages/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(pol, ["messages_insert_abonnes", "messages_select_abonnes", "messages_update_abonnes"]);
  assert.ok(!/as restrictive/i.test(sql), "une règle restrictive pourrait retirer des accès existants");
  assert.match(sql, /"messages_select_abonnes" on public\.messages\s+for select\s+using \(public\.salon_abonnement_actif\(room_id\)\);/);
  assert.match(sql, /"messages_insert_abonnes" on public\.messages\s+for insert\s+with check \(auth\.uid\(\) = user_id and public\.salon_abonnement_actif\(room_id\)\);/);
  assert.match(sql, /"messages_update_abonnes" on public\.messages\s+for update\s+using \(auth\.uid\(\) = user_id and public\.salon_abonnement_actif\(room_id\)\)\s+with check \(auth\.uid\(\) = user_id\);/);
  pol.forEach((n) => assert.ok(sql.includes('drop policy if exists "' + n + '" on public.messages;'), "idempotent : " + n));
});

test("expiration évaluée à la lecture (now()), sans tâche planifiée ; verrouillage lecture ET envoi à l'expiration", () => {
  assert.match(fnBody("salon_abonnement_actif"), /a\.user_id = auth\.uid\(\)\s+and a\.room_id = p_room_id\s+and a\.expire_le > now\(\)\s*\);/);
  assert.match(fnBody("salon_abonnement_actif"), /\bstable\b/);
  assert.ok(!/pg_cron|cron\.schedule|create extension/i.test(sql));
  assert.match(rawMain, /lecture ET envoi sont bloqués côté base/);
});

test("TOUTES les fonctions : search_path fixé ('public', 'pg_temp'), y compris celles des règles d'accès et security definer", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(names, ["rooms_abonnement_guard", "salon_abonnement_actif", "salon_appliquer_jours", "salon_compteurs", "salon_confirmer_paiement", "salon_echouer_paiement"]);
  names.forEach((n) => assert.match(fnBody(n), /set search_path to 'public', 'pg_temp'/, n));
  ["salon_abonnement_actif", "salon_appliquer_jours", "salon_compteurs", "salon_confirmer_paiement", "salon_echouer_paiement"].forEach((n) => assert.match(fnBody(n), /security definer/, n));
});

test("droits des fonctions : interne inaccessible, confirmation/échec service_role seul, compteurs admin seulement", () => {
  assert.match(sql, /revoke all on function public\.salon_appliquer_jours\(uuid, text, integer\) from public, anon, authenticated, service_role;/);
  assert.ok(!/grant execute on function public\.salon_appliquer_jours/.test(sql));
  assert.match(sql, /revoke all on function public\.salon_confirmer_paiement\(text, integer\) from public, anon, authenticated;\s*grant execute on function public\.salon_confirmer_paiement\(text, integer\) to service_role;/);
  assert.match(sql, /revoke all on function public\.salon_echouer_paiement\(text\) from public, anon, authenticated;\s*grant execute on function public\.salon_echouer_paiement\(text\) to service_role;/);
  assert.ok(!/grant execute on function public\.salon_(confirmer|echouer)_paiement[^;]*(anon|authenticated)/.test(sql));
  assert.match(fnBody("salon_compteurs"), /if not public\.is_admin\(\) then\s+raise exception 'Réservé aux administrateurs'/);
  assert.ok(!/user_id/.test(fnBody("salon_compteurs").split("returns table")[1].split("as $function$")[0]), "compteurs : jamais d'identifiant de membre en sortie");
});

test("salon_forfaits : code unique, jours > 0, montant > 0, actif faux par défaut, lecture publique des ACTIFS, écriture admin", () => {
  const body = /create table if not exists public\.salon_forfaits \(([\s\S]*?)\);/.exec(sql)[1];
  ["code text not null unique", "libelle text not null", "jours integer not null", "montant integer not null", "actif boolean not null default false", "ordre integer not null default 0"].forEach((c) => assert.ok(body.includes(c), c));
  assert.match(sql, /check \(jours > 0 and jours <= 3650\)/);
  assert.match(sql, /check \(montant > 0 and montant <= 10000000\)/);
  assert.match(sql, /"salon_forfaits_public_read" on public\.salon_forfaits\s+for select to anon, authenticated\s+using \(actif = true\);/);
  assert.match(sql, /"salon_forfaits_admin_all" on public\.salon_forfaits\s+for all to authenticated\s+using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\);/);
});

test("forfaits initiaux : « Test 1 jour » ACTIF 100 F ; « 1 mois » / « 3 mois » INACTIFS avec montants d'exemple ; jamais écrasés", () => {
  const ins = /insert into public\.salon_forfaits[\s\S]*?on conflict \(code\) do nothing;/.exec(sql);
  assert.ok(ins, "insert avec on conflict do nothing");
  const rows = [...ins[0].matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(true|false),\s*(\d+)\)/g)].map((m) => [m[1], m[2], +m[3], +m[4], m[5] === "true"]);
  assert.deepStrictEqual(rows, [["test-1-jour", "Test 1 jour", 1, 100, true], ["1-mois", "1 mois", 30, 1111, false], ["3-mois", "3 mois", 90, 2999, false]]);
  assert.ok(2999 < 3 * 1111, "petit avantage de prix sur le forfait 3 mois");
  assert.strictEqual((sql.match(/insert into public\.salon_forfaits/g) || []).length, 1);
  assert.match(rawMain, /EXEMPLE FICTIFS/);
  assert.match(rawMain, /FORFAIT DE TEST ACTIF[\s\S]*DÉSACTIVEZ-LE/);
});

test("salon_abonnements : une ligne par (membre, salon), lecture du SIEN seulement, AUCUNE règle d'écriture", () => {
  const body = /create table if not exists public\.salon_abonnements \(([\s\S]*?)\);/.exec(sql)[1];
  assert.ok(body.includes("primary key (user_id, room_id)") && body.includes("expire_le timestamptz not null"));
  assert.match(sql, /"salon_abonnements_own_read" on public\.salon_abonnements\s+for select to authenticated\s+using \(user_id = auth\.uid\(\) or public\.is_admin\(\)\);/);
  assert.ok(!/policy "[^"]+" on public\.salon_abonnements\s+for (insert|update|delete|all)/.test(sql));
  assert.ok(!/grant (insert|update|delete)[^;]*salon_abonnements/i.test(sql));
});

test("salon_paiements : transaction FedaPay unique, statuts, cohérence confirmé/date, lecture admin seulement", () => {
  const body = /create table if not exists public\.salon_paiements \(([\s\S]*?)\);/.exec(sql)[1];
  ["fedapay_transaction_id text not null unique", "statut text not null default 'en_attente'", "confirme_le timestamptz"].forEach((c) => assert.ok(body.includes(c), c));
  assert.match(sql, /check \(statut in \('en_attente', 'confirme', 'echoue'\)\)/);
  assert.match(sql, /check \(\(statut = 'confirme'\) = \(confirme_le is not null\)\)/);
  assert.match(sql, /"salon_paiements_admin_read" on public\.salon_paiements\s+for select to authenticated\s+using \(public\.is_admin\(\)\);/);
  assert.ok(!/policy "[^"]+" on public\.salon_paiements\s+for (insert|update|delete|all)/.test(sql));
  assert.ok(!/grant (insert|update|delete)[^;]*salon_paiements/i.test(sql));
  assert.ok(!/references public\.rooms/.test(body), "l'historique des paiements ne bloque pas la suppression d'un salon");
});

test("RLS activée sur les 3 tables ; aucun droit pour anon sur abonnements / paiements", () => {
  ["salon_forfaits", "salon_abonnements", "salon_paiements"].forEach((t) => assert.match(sql, new RegExp("alter table public\\." + t + "\\s+enable row level security;")));
  assert.match(sql, /revoke all on public\.salon_forfaits, public\.salon_abonnements, public\.salon_paiements from anon, authenticated;/);
  assert.match(sql, /grant select on public\.salon_abonnements to authenticated;/);
  assert.ok(!/grant[^;]*salon_(abonnements|paiements)[^;]*to[^;]*anon/i.test(sql));
});

test("cumul des jours : base = la plus grande valeur entre maintenant et l'ancienne date", () => {
  assert.match(fnBody("salon_appliquer_jours"), /expire_le = greatest\(a\.expire_le, now\(\)\) \+ make_interval\(days => p_jours\)/);
  assert.match(fnBody("salon_appliquer_jours"), /now\(\) \+ make_interval\(days => p_jours\)/);
  assert.match(fnBody("salon_appliquer_jours"), /p_jours is null or p_jours < 1 or p_jours > 3650/);
});

test("idempotence et montant : ligne verrouillée, seul « en_attente » → « confirme », montant officiel = instantané", () => {
  const f = fnBody("salon_confirmer_paiement");
  assert.match(f, /where fedapay_transaction_id = p_transaction_id\s+for update;/);
  assert.match(f, /if v\.statut = 'confirme' then\s+return jsonb_build_object\('resultat', 'deja_confirme'\);/);
  assert.match(f, /if p_montant is null or v\.montant <> p_montant then\s+update public\.salon_paiements set statut = 'echoue' where id = v\.id;\s+return jsonb_build_object\('resultat', 'montant_incoherent'\);/);
  assert.ok(f.indexOf("deja_confirme") < f.indexOf("salon_appliquer_jours") && f.indexOf("montant_incoherent") < f.indexOf("salon_appliquer_jours"));
  assert.strictEqual((f.match(/salon_appliquer_jours/g) || []).length, 1);
  assert.match(f, /if auth\.uid\(\) is not null and coalesce\(auth\.role\(\), ''\) <> 'service_role' then\s+raise exception 'Réservé au serveur'/);
  assert.ok(!/purchases/.test(f + fnBody("salon_appliquer_jours")), "ne crée jamais d'achat à vie");
});

test("garde : seul un admin (ou le serveur / l'éditeur SQL) peut changer rooms.abonnement", () => {
  const g = fnBody("rooms_abonnement_guard");
  assert.match(g, /if auth\.uid\(\) is null or coalesce\(auth\.role\(\), ''\) = 'service_role' or public\.is_admin\(\) then\s+return new;/);
  assert.match(g, /tg_op = 'INSERT'[\s\S]*new\.abonnement is distinct from false[\s\S]*raise exception/);
  assert.match(g, /new\.abonnement is distinct from old\.abonnement then\s+raise exception/);
  assert.match(sql, /drop trigger if exists rooms_abonnement_guard_trg on public\.rooms;\s*create trigger rooms_abonnement_guard_trg\s+before insert or update on public\.rooms/);
});

test("idempotent : drop ... if exists avant chaque policy, trigger, contrainte ; créations conditionnelles", () => {
  [...sql.matchAll(/create policy "(\w+)" on public\.(\w+)/g)].forEach((m) => assert.ok(sql.includes('drop policy if exists "' + m[1] + '" on public.' + m[2] + ";"), m[1]));
  [...sql.matchAll(/add constraint (\w+)/g)].forEach((m) => assert.ok(new RegExp("drop constraint if exists " + m[1] + ";").test(sql), m[1]));
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  assert.ok(!/create index (?!if not exists)/i.test(sql));
  assert.ok(!/drop\s+table|drop\s+column|truncate/i.test(sql), "le fichier principal ne détruit rien");
});

test("retour arrière : confirmation obligatoire, avertissement de perte, ne touche NI purchases NI les 4 règles d'origine, supprime la table de vérification", () => {
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /if confirmation <> 'OUI' then[\s\S]*raise exception/);
  assert.match(rollback, /raise warning 'ATTENTION : % forfait\(s\), % abonnement\(s\) et % paiement\(s\)[\s\S]*DÉFINITIVEMENT PERDUS/);
  assert.ok(rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop policy") && rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop table"));
  ["messages_select_abonnes", "messages_insert_abonnes", "messages_update_abonnes"].forEach((n) => assert.ok(rollback.includes('drop policy if exists "' + n + '" on public.messages;'), n));
  ORIGINAL_POLICIES.forEach((n) => assert.ok(!rollback.includes('"' + n + '"'), n + " intacte"));
  assert.ok(!/purchases/i.test(rollback), "purchases n'est jamais touchée");
  assert.ok(rollback.includes("drop table if exists public.zz_verif_salons_avant;"));
  ["salon_paiements", "salon_abonnements", "salon_forfaits"].forEach((t) => assert.ok(rollback.includes("drop table if exists public." + t + ";"), t));
  assert.ok(rollback.indexOf("rooms_abonnement_requires_paid") < rollback.indexOf("drop column if exists abonnement"), "contrainte retirée avant la colonne");
  assert.ok(!/\bcascade\b/i.test(rollback));
  assert.match(read("salons-abonnement-rollback.sql").slice(0, 1500), /IRRÉVERSIBLE/);
});

test("vérification : table d'instantané verrouillée (RLS sans aucune règle, droits retirés) et SANS identifiant de membre", () => {
  assert.match(verif, /create table if not exists public\.zz_verif_salons_avant/);
  assert.match(verif, /alter table public\.zz_verif_salons_avant enable row level security;/);
  assert.match(verif, /revoke all on public\.zz_verif_salons_avant from anon, authenticated;/);
  assert.ok(!/create\s+policy[^;]*zz_verif_salons_avant/i.test(verif), "aucune règle de lecture ni d'écriture");
  assert.ok(!/grant[^;]*zz_verif_salons_avant/i.test(verif));
  const table = /create table if not exists public\.zz_verif_salons_avant \(([\s\S]*?)\);/.exec(verif)[1];
  assert.ok(!/user|membre_id|email/i.test(table), "colonnes : rubrique, cle, valeur, releve_le seulement");
  // ce qui est inséré : des comptes par salon et des empreintes, jamais p.user_id lui-même
  const inserts = verif.match(/insert into public\.zz_verif_salons_avant[\s\S]*?;/g);
  assert.strictEqual(inserts.length, 2);
  inserts.forEach((i) => assert.ok(!/select[^;]*\buser_id\b(?![^()]*\))/.test(i.replace(/count\(distinct p\.user_id\)/g, "")), i.slice(0, 80)));
  assert.match(verif, /count\(distinct p\.user_id\)::text/);
});

test("vérification : AVANT (comptes + empreintes des 4 règles) puis APRÈS (comparaison, « 0 accès perdu »), sans rien modifier d'autre", () => {
  assert.match(verifRaw, /PARTIE 1 — AVANT[\s\S]*PARTIE 2 — APRÈS/);
  ORIGINAL_POLICIES.forEach((n) => assert.ok(verif.includes("'" + n + "'"), n));
  assert.match(verif, /md5\(coalesce\(pol\.qual, ''\)/);
  assert.match(verif, /'PROBLÈME : accès perdu'/);
  assert.match(verif, /'PROBLÈME : règle modifiée'/);
  assert.match(verif, /as acces_perdus;/);
  assert.ok(!/^(update|delete|truncate|alter\s+table\s+public\.(purchases|rooms|messages))\b/im.test(verif));
  assert.ok(!/insert into public\.(purchases|rooms|messages)/i.test(verif));
  assert.ok(/^-- drop table if exists public\.zz_verif_salons_avant;/m.test(verifRaw), "nettoyage facultatif, commenté");
});

test("aucune donnée réelle : pas de numéro, de clé, d'adresse e-mail, ni de nom de personne dans les 3 fichiers SQL", () => {
  [rawMain, read("salons-abonnement-rollback.sql"), verifRaw].forEach((t) => {
    assert.ok(!/(sk_(live|test)_|whsec_|@[a-z0-9-]+\.[a-z]{2,}|\+\d{6,})/i.test(t));
  });
});

console.log("\n" + passed + " test(s) réussi(s)");
