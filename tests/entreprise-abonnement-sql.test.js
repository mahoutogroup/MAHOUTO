/* Garde-fous statiques de entreprises-abonnement.sql, de son retour arrière et du bloc facultatif
   « offrir aux vitrines existantes ». Exécution : node tests/entreprise-abonnement-sql.test.js —
   lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté, aucune base n'est touchée. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read("entreprises-abonnement.sql");
const sql = strip(raw);
const rollback = strip(read("entreprises-abonnement-rollback.sql"));
const offer = strip(read("entreprises-abonnement-offrir-existantes.sql"));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}
const fnBody = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$function\\$;").exec(sql); assert.ok(m, name); return m[0]; };

test("prérequis vérifiés (DO) : is_admin(), tables et fonction des vitrines", () => {
  const head = sql.slice(0, sql.indexOf("alter table public.entreprises add column"));
  assert.match(head, /to_regprocedure\('public\.is_admin\(\)'\) is null[\s\S]*raise exception/);
  assert.match(head, /to_regclass\('public\.entreprises'\) is null[\s\S]*to_regprocedure\('public\.entreprise_is_published\(uuid\)'\) is null[\s\S]*raise exception/);
});

test("AUCUN forfait par défaut ni aucune donnée : pas d'insert, pas de seed, forfaits créés vides", () => {
  assert.ok(!/\binsert\s+into\s+public\.entreprise_forfaits\b/i.test(sql));
  assert.ok(!/\binsert\s+into\s+public\.entreprises\b/i.test(sql));
  assert.ok(!/^(update|delete\s+from|truncate|copy)\b/im.test(sql), "aucune modification de données dans le fichier principal");
  assert.match(raw, /AUCUN forfait par défaut/);
});

test("colonnes ajoutées à entreprises : expire_le (NULL = jamais payée) et offerte (défaut false) ; idempotent", () => {
  assert.match(sql, /alter table public\.entreprises add column if not exists expire_le timestamptz;/);
  assert.match(sql, /alter table public\.entreprises add column if not exists offerte boolean not null default false;/);
});

test("entreprise_forfaits : code unique, jours > 0, montant > 0, actif par défaut false (jamais proposé tant que l'admin ne l'active pas), ordre", () => {
  const body = /create table if not exists public\.entreprise_forfaits \(([\s\S]*?)\);/.exec(sql)[1];
  ["code text not null unique", "libelle text not null", "jours integer not null", "montant integer not null", "actif boolean not null default false", "ordre integer not null default 0"].forEach((c) => assert.ok(body.includes(c), c));
  assert.match(sql, /check \(jours > 0 and jours <= 3650\)/);
  assert.match(sql, /check \(montant > 0 and montant <= 10000000\)/);
  assert.match(sql, /check \(code ~ '\^\[a-z0-9_-\]\{2,30\}\$'\)/);
});

test("entreprise_paiements : colonnes demandées, transaction FedaPay unique, statuts, sources, cohérence confirmé / date", () => {
  const body = /create table if not exists public\.entreprise_paiements \(([\s\S]*?)\);/.exec(sql)[1];
  ["entreprise_id uuid not null references public.entreprises(id)", "forfait_code text", "jours integer not null", "montant integer not null", "fedapay_transaction_id text unique", "statut text not null default 'en_attente'", "source text not null", "cree_le timestamptz not null default now()", "confirme_le timestamptz"].forEach((c) => assert.ok(body.includes(c), c));
  assert.match(sql, /check \(statut in \('en_attente', 'confirme', 'echoue'\)\)/);
  assert.match(sql, /check \(source in \('fedapay', 'manuel'\)\)/);
  assert.match(sql, /\(source = 'fedapay' and fedapay_transaction_id is not null\)\s+or \(source = 'manuel' and fedapay_transaction_id is null\)/);
  assert.match(sql, /check \(\(statut = 'confirme'\) = \(confirme_le is not null\)\)/);
});

test("règle de visibilité : published ET (offerte OU expire_le > now()), évaluée à la lecture, sans tâche planifiée", () => {
  const f = fnBody("entreprise_est_visible");
  assert.match(f, /coalesce\(p_published, false\)\s+and \(coalesce\(p_offerte, false\) or \(p_expire_le is not null and p_expire_le > now\(\)\)\)/);
  assert.match(f, /\bstable\b/);
  assert.ok(!/pg_cron|cron\.schedule|create extension/i.test(sql), "aucune tâche planifiée");
});

test("entreprise_is_published (produits et photos) et la policy de lecture publique des entreprises appliquent la même règle", () => {
  assert.match(fnBody("entreprise_is_published"), /public\.entreprise_est_visible\(e\.published, e\.offerte, e\.expire_le\)/);
  assert.match(sql, /create policy "entreprises_public_read" on public\.entreprises\s+for select to anon, authenticated\s+using \(public\.entreprise_est_visible\(published, offerte, expire_le\)\);/);
  assert.match(sql, /drop policy if exists "entreprises_public_read" on public\.entreprises;/);
});

test("toutes les fonctions : search_path fixé ; fonctions sensibles réservées au serveur (service_role) ou à is_admin()", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(names, ["entreprise_appliquer_jours", "entreprise_confirmer_paiement", "entreprise_echouer_paiement", "entreprise_est_visible", "entreprise_is_published", "entreprise_prolonger_manuel", "entreprises_abonnement_guard"]);
  names.forEach((n) => assert.match(fnBody(n), /set search_path to 'public', 'pg_temp'/, n));
  // interne : aucun rôle ne peut l'appeler
  assert.match(sql, /revoke all on function public\.entreprise_appliquer_jours\(uuid, integer\) from public, anon, authenticated, service_role;/);
  assert.ok(!/grant execute on function public\.entreprise_appliquer_jours/.test(sql));
  // confirmer / échouer : service_role seul
  assert.match(sql, /revoke all on function public\.entreprise_confirmer_paiement\(text, integer\) from public, anon, authenticated;\s*grant execute on function public\.entreprise_confirmer_paiement\(text, integer\) to service_role;/);
  assert.match(sql, /revoke all on function public\.entreprise_echouer_paiement\(text\) from public, anon, authenticated;\s*grant execute on function public\.entreprise_echouer_paiement\(text\) to service_role;/);
  // prolongation manuelle : connecté, mais is_admin() vérifié dans la fonction
  assert.match(fnBody("entreprise_prolonger_manuel"), /if not public\.is_admin\(\) then\s+raise exception 'Réservé aux administrateurs'/);
  assert.match(sql, /grant execute on function public\.entreprise_prolonger_manuel\(uuid, integer\) to authenticated;/);
  assert.ok(!/grant execute on function public\.entreprise_(confirmer|echouer)_paiement[^;]*(anon|authenticated)/.test(sql));
});

test("cumul des jours : à partir de la plus grande valeur entre maintenant et l'ancien expire_le", () => {
  assert.match(fnBody("entreprise_appliquer_jours"), /expire_le = greatest\(coalesce\(expire_le, now\(\)\), now\(\)\) \+ make_interval\(days => p_jours\)/);
  assert.match(fnBody("entreprise_appliquer_jours"), /p_jours is null or p_jours < 1 or p_jours > 3650/);
});

test("idempotence du webhook : ligne verrouillée, seul « en_attente » devient « confirme », un second appel ne prolonge rien", () => {
  const f = fnBody("entreprise_confirmer_paiement");
  assert.match(f, /where fedapay_transaction_id = p_transaction_id\s+and source = 'fedapay'\s+for update;/);
  assert.match(f, /if v\.statut = 'confirme' then\s+return jsonb_build_object\('resultat', 'deja_confirme'\);/);
  assert.match(f, /if v\.statut <> 'en_attente' then/);
  assert.ok(f.indexOf("deja_confirme") < f.indexOf("entreprise_appliquer_jours"), "la prolongation vient APRÈS les contrôles d'état");
  assert.strictEqual((f.match(/entreprise_appliquer_jours/g) || []).length, 1);
  assert.match(sql, /fedapay_transaction_id text unique/);
});

test("montant falsifié refusé : le montant officiel doit égaler l'instantané du forfait enregistré, sinon « echoue » sans prolonger", () => {
  const f = fnBody("entreprise_confirmer_paiement");
  assert.match(f, /if p_montant is null or v\.montant <> p_montant then\s+update public\.entreprise_paiements set statut = 'echoue' where id = v\.id;\s+return jsonb_build_object\('resultat', 'montant_incoherent'\);/);
  assert.ok(f.indexOf("montant_incoherent") < f.indexOf("set statut = 'confirme'"));
});

test("un propriétaire ne peut jamais changer expire_le ni offerte : trigger de garde (service_role, is_admin() ou éditeur SQL seulement)", () => {
  const g = fnBody("entreprises_abonnement_guard");
  assert.match(g, /if auth\.uid\(\) is null or coalesce\(auth\.role\(\), ''\) = 'service_role' or public\.is_admin\(\) then\s+return new;/);
  assert.match(g, /new\.expire_le is distinct from old\.expire_le or new\.offerte is distinct from old\.offerte[\s\S]*raise exception/);
  assert.match(g, /tg_op = 'INSERT'[\s\S]*new\.expire_le is not null or new\.offerte is distinct from false[\s\S]*raise exception/);
  assert.match(sql, /create trigger entreprises_abonnement_guard_trg\s+before insert or update on public\.entreprises/);
  assert.match(sql, /drop trigger if exists entreprises_abonnement_guard_trg on public\.entreprises;/);
});

test("RLS : forfaits (lecture publique des ACTIFS seulement, écriture admin), paiements (admin seulement, aucune lecture publique)", () => {
  assert.match(sql, /alter table public\.entreprise_forfaits  enable row level security;/);
  assert.match(sql, /alter table public\.entreprise_paiements enable row level security;/);
  assert.match(sql, /"entreprise_forfaits_public_read" on public\.entreprise_forfaits\s+for select to anon, authenticated\s+using \(actif = true\);/);
  assert.match(sql, /"entreprise_forfaits_admin_all" on public\.entreprise_forfaits\s+for all to authenticated\s+using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\);/);
  assert.match(sql, /"entreprise_paiements_admin_all" on public\.entreprise_paiements\s+for all to authenticated\s+using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\);/);
  const pol = [...sql.matchAll(/create policy "(\w+)" on public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(pol, ["entreprise_forfaits_admin_all", "entreprise_forfaits_public_read", "entreprise_paiements_admin_all", "entreprises_public_read"]);
  assert.ok(!/entreprise_paiements[^;]*to anon/.test(sql.replace(/revoke all on public\.entreprise_forfaits, public\.entreprise_paiements from anon, authenticated;/, "")), "aucun droit pour anon sur les paiements");
  assert.match(sql, /revoke all on public\.entreprise_forfaits, public\.entreprise_paiements from anon, authenticated;/);
  assert.match(sql, /grant select on public\.entreprise_forfaits to anon, authenticated;/);
  assert.ok(!/grant (insert|update|delete)[^;]*entreprise_forfaits[^;]*to[^;]*anon/i.test(sql));
  assert.ok(!/for (insert|update|delete) to/i.test(sql), "aucune policy d'écriture ouverte à tout connecté");
});

test("idempotent : chaque policy, trigger et contrainte est précédé d'un drop ... if exists ; créations conditionnelles", () => {
  [...sql.matchAll(/create policy "(\w+)" on public\.(\w+)/g)].forEach((m) => assert.ok(sql.includes('drop policy if exists "' + m[1] + '" on public.' + m[2] + ";"), m[1]));
  [...sql.matchAll(/add constraint (\w+)/g)].forEach((m) => assert.ok(new RegExp("drop constraint if exists " + m[1] + ";").test(sql), m[1]));
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  assert.ok(!/create index (?!if not exists)/i.test(sql));
});

test("aucune donnée existante n'est détruite ; seules des tables et fonctions NOUVELLES sont créées (sauf entreprise_is_published remplacée, et la policy recréée)", () => {
  assert.ok(!/drop\s+table|drop\s+column|drop\s+function|truncate|alter\s+table\s+public\.entreprise_(produits|photos)/i.test(sql));
  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(created, ["entreprise_forfaits", "entreprise_paiements"]);
});

test("bloc facultatif « offrir aux vitrines existantes » : fichier SÉPARÉ, ne modifie que offerte, idempotent, prérequis vérifié", () => {
  assert.ok(!/offerte\s*=\s*true\s+where/i.test(sql), "le fichier principal ne modifie aucune vitrine");
  assert.match(offer, /update public\.entreprises\s+set offerte = true\s+where published = true\s+and offerte = false\s+and expire_le is null;/);
  assert.match(offer, /raise exception 'Colonne offerte introuvable/);
  assert.ok(!/delete|drop|truncate|insert/i.test(offer));
  assert.match(read("entreprises-abonnement-offrir-existantes.sql"), /FACULTATIF/);
  assert.match(raw, /entreprises-abonnement-offrir-existantes\.sql/);
});

test("retour arrière : confirmation obligatoire, avertissement de perte, restaure l'ancienne règle AVANT de supprimer les colonnes, ne touche pas aux prérequis", () => {
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /if confirmation <> 'OUI' then[\s\S]*raise exception/);
  assert.match(rollback, /raise warning 'ATTENTION : % forfait\(s\) et % paiement\(s\)[\s\S]*DÉFINITIVEMENT PERDUS/);
  assert.ok(rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop table"));
  assert.match(rollback, /create policy "entreprises_public_read" on public\.entreprises\s+for select to anon, authenticated\s+using \(published = true\);/);
  assert.match(rollback, /where e\.id = eid and e\.published = true/);
  assert.ok(rollback.indexOf('create policy "entreprises_public_read"') < rollback.indexOf("drop column"), "policy restaurée avant la suppression des colonnes");
  assert.ok(rollback.indexOf("drop function if exists public.entreprise_est_visible") > rollback.indexOf('create policy "entreprises_public_read"'));
  const drops = [...rollback.matchAll(/drop\s+(table|function|trigger|column)\s+if exists\s+([\w.()]+(?:, uuid\))?)/gi)].map((m) => m[1].toLowerCase() + " " + m[2]);
  assert.ok(!drops.some((d) => /is_admin|serigraphie|entreprises_?$|entreprise_produits|entreprise_photos/.test(d) && !/column/.test(d)), drops.join(" | "));
  assert.ok(!/\bcascade\b/i.test(rollback));
  assert.match(read("entreprises-abonnement-rollback.sql").slice(0, 1200), /HISTORIQUE DES PAIEMENTS[\s\S]*IRRÉVERSIBLE/);
});

console.log("\n" + passed + " test(s) réussi(s)");
