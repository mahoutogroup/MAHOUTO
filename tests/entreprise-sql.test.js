/* Garde-fous statiques de entreprises-vitrine.sql et entreprises-vitrine-rollback.sql.
   Exécution : node tests/entreprise-sql.test.js — lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté,
   aucune base n'est touchée. Le comportement réel (RLS, contraintes, trigger) se vérifie sur le projet de TEST
   avec la check-list de la description de la PR. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const stripComments = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = stripComments(read("entreprises-vitrine.sql"));
const rollback = stripComments(read("entreprises-vitrine-rollback.sql"));
const serigraphie = read("serigraphie-schema.sql");
const TABLES = ["entreprises", "entreprise_produits", "entreprise_photos"];
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

test("prérequis vérifiés par un bloc DO : public.is_admin() et public.serigraphie_https_only(text[])", () => {
  const first = sql.slice(0, sql.indexOf("create table"));
  assert.match(first, /do \$\$[\s\S]*to_regprocedure\('public\.is_admin\(\)'\) is null[\s\S]*raise exception/);
  assert.match(first, /to_regprocedure\('public\.serigraphie_https_only\(text\[\]\)'\) is null[\s\S]*raise exception/);
});

test("AUCUNE donnée initiale : pas d'insert, pas de update, pas de delete, pas de copy dans le fichier principal", () => {
  assert.ok(!/\binsert\s+into\b/i.test(sql));
  assert.ok(!/^\s*(update|delete\s+from|copy|truncate)\b/im.test(sql));
});

test("nouvelles tables uniquement : seules les 3 tables entreprise* sont créées, modifiées ou protégées", () => {
  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(created, TABLES.slice().sort());
  assert.ok(!/create table (?!if not exists)/i.test(sql), "chaque create table est idempotent");
  const touched = new Set([...sql.matchAll(/\b(?:alter table|on|references)\s+public\.(\w+)/g)].map((m) => m[1]));
  touched.forEach((t) => assert.ok(TABLES.includes(t) || t === "profiles", "table inattendue : " + t));
  assert.ok(!/drop\s+table|drop\s+column|drop\s+function|drop\s+schema|alter\s+function|alter\s+policy/i.test(sql));
  assert.ok(!/serigraphie_(vendors|products|orders)|public\.profiles/.test(sql), "aucune table existante n'est touchée");
});

test("colonnes demandées présentes sur les trois tables, prix NULL possible, légende ≤ 80, position par défaut 0", () => {
  const body = (t) => sql.slice(sql.indexOf("create table if not exists public." + t), sql.indexOf(");", sql.indexOf("create table if not exists public." + t)));
  ["id uuid primary key", "slug text unique", "nom_legal text", "nom_commercial text", "description text", "ville text", "departement text", "whatsapp text", "telephone_appel text", "logo_url text", "banner_url text", "conseil_texte text", "published boolean not null default false", "created_at", "updated_at"]
    .forEach((c) => assert.ok(body("entreprises").includes(c), "entreprises." + c));
  ["entreprise_id uuid not null references public.entreprises(id) on delete cascade", "nom text not null", "prix integer,", "unite text", "disponible boolean not null default true", "image_url text", "position integer", "published boolean not null default true"]
    .forEach((c) => assert.ok(body("entreprise_produits").includes(c), "entreprise_produits." + c));
  ["entreprise_id uuid not null references public.entreprises(id) on delete cascade", "image_url text not null", "legende text", "position integer not null default 0", "published boolean not null default true"]
    .forEach((c) => assert.ok(body("entreprise_photos").includes(c), "entreprise_photos." + c));
  assert.match(sql, /prix is null or prix > 0/);
  assert.match(sql, /legende is null or char_length\(legende\) <= 80/);
});

test("contraintes : slug, téléphone (même regex que serigraphie_vendors), URL d'images (serigraphie_https_only), longueurs, publication", () => {
  assert.ok(sql.includes("slug ~ '^[a-z0-9-]{2,40}$'"));
  const vendorRegex = /whatsapp ~ '([^']+)'/.exec(serigraphie)[1];
  assert.strictEqual(vendorRegex, "^\\+?[0-9 ().-]{6,25}$");
  assert.ok(sql.includes("whatsapp ~ '" + vendorRegex + "'"));
  assert.ok(sql.includes("telephone_appel ~ '" + vendorRegex + "'"));
  ["logo_url", "banner_url", "image_url"].forEach((c) => assert.ok(sql.includes("public.serigraphie_https_only(array[" + c + "])"), c));
  assert.ok(!/serigraphie_https_only\((logo_url|banner_url|image_url)\)/.test(sql), "toujours un tableau (text[])");
  assert.match(sql, /char_length\(btrim\(nom_commercial\)\) between 2 and 80/);
  assert.match(sql, /char_length\(btrim\(nom_legal\)\) between 2 and 120/);
  assert.match(sql, /char_length\(description\) <= 1500/);
  assert.match(sql, /char_length\(conseil_texte\) <= 300/);
  // published = true impossible si le slug ou le nom commercial est vide
  assert.match(sql, /entreprises_published_requires_check[\s\S]*published = false\s+or \([\s\S]*slug is not null and btrim\(slug\) <> ''[\s\S]*nom_commercial is not null and btrim\(nom_commercial\) <> ''/);
});

test("limite de 12 photos : trigger avec verrou, message clair en français", () => {
  assert.match(sql, /create or replace function public\.entreprise_photos_limit\(\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /if n >= 12 then/);
  assert.match(sql, /Limite de 12 photos par entreprise atteinte/);
  assert.match(sql, /create trigger entreprise_photos_limit_trg\s+before insert or update of entreprise_id on public\.entreprise_photos/);
});

test("fonctions créées : exactement 3, toutes avec un search_path fixé, jamais d'altération des fonctions existantes", () => {
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\$function\$;/g)];
  assert.deepStrictEqual(fns.map((m) => m[1]).sort(), ["entreprise_is_published", "entreprise_photos_limit", "entreprises_set_updated_at"]);
  fns.forEach((m) => assert.match(m[0], /set search_path to 'public', 'pg_temp'/, m[1]));
  assert.match(sql, /revoke all on function public\.entreprise_is_published\(uuid\) from public/);
  assert.match(sql, /grant execute on function public\.entreprise_is_published\(uuid\) to anon, authenticated/);
  assert.match(sql, /create trigger entreprises_set_updated_at_trg\s+before update on public\.entreprises/);
});

test("RLS activée sur les 3 tables ; 6 policies : lecture publiée (anon + connecté), tout pour is_admin()", () => {
  TABLES.forEach((t) => assert.ok(sql.includes("alter table public." + t + " ") && new RegExp("alter table public\\." + t + "\\s+enable row level security").test(sql), t));
  const policies = [...sql.matchAll(/create policy "(\w+)" on public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(policies, ["entreprise_photos_admin_all", "entreprise_photos_public_read", "entreprise_produits_admin_all", "entreprise_produits_public_read", "entreprises_admin_all", "entreprises_public_read"]);
  assert.match(sql, /"entreprises_public_read" on public\.entreprises\s+for select to anon, authenticated\s+using \(published = true\)/);
  assert.match(sql, /"entreprise_produits_public_read"[\s\S]*for select to anon, authenticated\s+using \(published = true and public\.entreprise_is_published\(entreprise_id\)\)/);
  assert.match(sql, /"entreprise_photos_public_read"[\s\S]*for select to anon, authenticated\s+using \(published = true and public\.entreprise_is_published\(entreprise_id\)\)/);
  assert.strictEqual((sql.match(/for all to authenticated\s+using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/g) || []).length, 3);
  // aucune policy d'écriture ouverte à anon ou à tout connecté
  assert.ok(!/for (insert|update|delete) to/i.test(sql));
  assert.ok(!/to (anon|public)[^;]*is_admin|for all to (anon|public)/i.test(sql));
  // droits de table : l'anonyme ne peut que lire
  assert.match(sql, /revoke all on public\.entreprises, public\.entreprise_produits, public\.entreprise_photos from anon, authenticated/);
  assert.match(sql, /grant select on [^;]* to anon, authenticated/);
  assert.match(sql, /grant insert, update, delete on [^;]* to authenticated/);
  assert.ok(!/grant (insert|update|delete)[^;]*to[^;]*anon/i.test(sql));
});

test("idempotent : chaque policy, trigger et contrainte est précédé d'un drop ... if exists", () => {
  [...sql.matchAll(/create policy "(\w+)" on public\.(\w+)/g)].forEach((m) => assert.ok(sql.includes('drop policy if exists "' + m[1] + '" on public.' + m[2] + ";"), m[1]));
  [...sql.matchAll(/create trigger (\w+)\s+[\s\S]*? on public\.(\w+)/g)].forEach((m) => assert.ok(sql.includes("drop trigger if exists " + m[1] + " on public." + m[2] + ";"), m[1]));
  [...sql.matchAll(/add constraint (\w+)/g)].forEach((m) => assert.ok(new RegExp("drop constraint if exists " + m[1] + ";").test(sql), m[1]));
  assert.ok(!/create index (?!if not exists)/i.test(sql));
});

test("aucune donnée d'entreprise dans le SQL : aucune URL, aucun numéro, aucun nom propre saisi", () => {
  assert.ok(!/https?:\/\//.test(sql));
  assert.ok(!/'[^']*\+229[^']*'/.test(sql));
});

test("retour arrière : ne supprime que les 3 tables et 3 fonctions créées, confirmation obligatoire, avertissement de perte de données", () => {
  const drops = [...rollback.matchAll(/drop\s+(table|function)\s+if exists\s+([\w.()]+)/gi)].map((m) => m[1].toLowerCase() + " " + m[2]).sort();
  assert.deepStrictEqual(drops, [
    "function public.entreprise_is_published(uuid)", "function public.entreprise_photos_limit()", "function public.entreprises_set_updated_at()",
    "table public.entreprise_photos", "table public.entreprise_produits", "table public.entreprises"
  ].sort());
  assert.ok(!/drop[^;]*(is_admin|serigraphie_https_only|serigraphie_)/i.test(rollback));
  assert.ok(!/\bcascade\b/i.test(rollback), "pas de cascade : aucune dépendance extérieure supprimée");
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /if confirmation <> 'OUI' then[\s\S]*raise exception/);
  assert.match(rollback, /raise warning 'ATTENTION : % entreprise\(s\), % produit\(s\) et % photo\(s\) enregistrés seront DÉFINITIVEMENT PERDUS\./);
  const header = read("entreprises-vitrine-rollback.sql").slice(0, 900);
  assert.ok(/SUPPRIME LES TABLES/.test(header) && /DONNÉES SAISIES/.test(header) && /IRRÉVERSIBLE/.test(header), "avertissement en tête de fichier");
  assert.ok(rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop table"));
});

console.log("\n" + passed + " test(s) réussi(s)");
