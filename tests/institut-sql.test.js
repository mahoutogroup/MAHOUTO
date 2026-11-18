/* Garde-fous statiques de institut.sql, de son retour arrière et de son SQL de vérification (PR 2 de l'Institut).
   Exécution : node --test tests/institut-sql.test.js — lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté,
   aucune base n'est touchée. Modèle : tests/salon-abonnement-sql.test.js. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read("institut.sql");
const sql = strip(raw);
const rollbackRaw = read("institut-rollback.sql");
const rollback = strip(rollbackRaw);
const verifRaw = read("institut-verification.sql");
const verif = strip(verifRaw);
const EXISTING = ["purchases", "messages", "rooms", "profiles"];
const TABLES = ["institut_contenus", "institut_demandes", "institut_petits_fils"];

// Découpe le fichier en blocs : « -- BLOC n — titre » jusqu'au suivant
function blocks(text) {
  const parts = text.split(/^-- BLOC (\d+) — /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}
const fnBody = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$function\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const policy = (name, table) => { const m = new RegExp('create policy "' + name + '" on ' + table + "[\\s\\S]*?;").exec(sql); assert.ok(m, name); return m[0]; };

test("blocs numérotés 1 à 10, dans l'ordre, courts, avec la note de tête qui les liste", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 90, "bloc " + x.n + " trop long pour un éditeur mobile (" + x.body.split("\n").length + " lignes)"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 — "));
  assert.match(head, /BLOCS \(dans l'ordre\)/);
  for (let n = 1; n <= 10; n++) assert.ok(new RegExp("--   BLOC " + n + "\\s+—").test(head), "note de tête : bloc " + n);
  assert.match(head, /BLOC PAR BLOC/);
  // chaque bloc est autonome : il ne contient jamais le début d'un autre bloc
  b.forEach((x) => assert.ok(!/-- BLOC \d+ — /.test(x.body)));
});

test("100 % additif : rien sur purchases, messages, rooms, profiles (ni drop, ni alter, ni règle, ni droit, ni insertion)", () => {
  EXISTING.forEach((t) => {
    assert.ok(!new RegExp("\\bpublic\\." + t + "\\b", "i").test(sql), "public." + t + " ne doit pas apparaître dans le SQL");
    assert.ok(!new RegExp("\\bon\\s+(only\\s+)?" + t + "\\b", "i").test(sql));
  });
  assert.ok(!/\b(drop\s+table|truncate|alter\s+table\s+public\.(purchases|messages|rooms|profiles))/i.test(sql));
  assert.ok(!/drop\s+table/i.test(sql), "le fichier principal ne supprime aucune table");
  assert.ok(!/^(update|delete\s+from)\b/im.test(sql), "aucune modification de données existantes");
  assert.ok(!/alter\s+table\s+public\.(?!institut_)/i.test(sql), "alter table seulement sur les tables de l'Institut");
  assert.ok(!/alter\s+table\s+storage\./i.test(sql), "aucune modification de storage.objects (propriété de Supabase)");
  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(created, TABLES);
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  assert.ok(!/create index (?!if not exists)/i.test(sql));
  [...sql.matchAll(/create policy "(\w+)" on ([\w.]+)/g)].forEach((m) => assert.ok(sql.includes('drop policy if exists "' + m[1] + '" on ' + m[2] + ";"), "idempotent : " + m[1]));
  [...sql.matchAll(/add constraint (\w+)/g)].forEach((m) => assert.ok(new RegExp("drop constraint if exists " + m[1] + ";").test(sql), m[1]));
});

test("RLS activée sur les 3 tables, droits retirés à anon et authenticated avant d'accorder au plus juste", () => {
  TABLES.forEach((t) => {
    assert.match(sql, new RegExp("alter table public\\." + t + " enable row level security;"), t);
    assert.match(sql, new RegExp("revoke all on public\\." + t + " from anon, authenticated;"), t);
  });
});

test("institut_contenus : clés 'histoire' et 'ouvert', 5000 caractères, 'ouvert' oui/non, lecture publique, écriture is_admin() seulement", () => {
  assert.match(sql, /check \(cle in \('histoire', 'ouvert'\)\)/);
  assert.match(sql, /check \(char_length\(valeur\) <= 5000 and \(cle <> 'ouvert' or valeur in \('oui', 'non'\)\)\)/);
  assert.match(policy("institut_contenus_public_read", "public.institut_contenus"), /for select to anon, authenticated\s+using \(true\)/);
  ["insert", "update", "delete"].forEach((cmd) => {
    const p = policy("institut_contenus_admin_" + cmd, "public.institut_contenus");
    assert.match(p, new RegExp("for " + cmd + " to authenticated"));
    assert.ok(p.includes("public.is_admin()"), cmd + " réservé aux admins");
  });
  assert.match(sql, /grant select on public\.institut_contenus to anon, authenticated;/);
  assert.ok(!/grant[^;]*(insert|update|delete)[^;]*institut_contenus[^;]*to[^;]*anon/i.test(sql));
});

test("valeurs de départ : 'ouvert' = non, 'histoire' = le texte actuel de institut.html, on conflict do nothing", () => {
  const ins = /insert into public\.institut_contenus[\s\S]*?on conflict \(cle\) do nothing;/.exec(sql);
  assert.ok(ins, "insert avec on conflict do nothing");
  assert.match(ins[0], /\('ouvert', 'non'\)/);
  const lit = /\('histoire', E'((?:[^']|'')*)'\)/.exec(ins[0]);
  assert.ok(lit, "texte d'histoire");
  const seed = lit[1].replace(/''/g, "'").replace(/\\n/g, "\n");
  const html = read("institut.html");
  const section = /<section id="histoire">([\s\S]*?)<\/section>/.exec(html)[1];
  const paras = [...section.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].trim());
  assert.strictEqual(seed, paras.join("\n\n"), "le SQL reprend exactement le texte statique de la page");
  assert.ok(seed.includes("SAYÉ LOUIS") && seed.includes("Sayé Louis"));
});

test("institut_ouvert() : stable, search_path fixé, vrai seulement pour 'oui'", () => {
  const f = fnBody("institut_ouvert");
  assert.match(f, /returns boolean/);
  assert.match(f, /\bstable\b/);
  assert.match(f, /set search_path = public, pg_temp/);
  assert.match(f, /c\.valeur = 'oui'/);
  assert.match(f, /coalesce\(\(select[\s\S]*\), false\)/);
  assert.match(sql, /grant execute on function public\.institut_ouvert\(\) to anon, authenticated;/);
});

test("TOUTES les fonctions : search_path fixé ; aucune security definer (inutile ici)", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(names, ["institut_contenus_maj", "institut_demandes_garde", "institut_ouvert"]);
  names.forEach((n) => assert.match(fnBody(n), /set search_path = public, pg_temp/, n));
  assert.ok(!/security definer/i.test(sql), "security definer seulement si nécessaire : ici jamais");
});

test("institut_demandes : données minimales (aucun nom de famille, adresse, téléphone, photo, e-mail)", () => {
  const body = /create table if not exists public\.institut_demandes \(([\s\S]*?)\n\);/.exec(sql)[1];
  const cols = body.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  assert.deepStrictEqual(cols, ["id", "parrain_id", "prenom", "age", "lien", "formation", "motif", "justificatif_path", "statut", "raison_refus", "cree_le", "traite_le", "traite_par"]);
  cols.forEach((c) => assert.ok(!/^(nom|nom_famille|adresse|telephone|tel|email|mail|photo|photo_url)$/.test(c), "colonne interdite : " + c));
  assert.match(body, /parrain_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(body, /statut text not null default 'en_attente'/);
});

test("institut_demandes : contraintes (prénom 1-40, âge 3-35, lien, formation 1-40, motif ≤ 500, statut, raison ≤ 300)", () => {
  assert.match(sql, /check \(char_length\(btrim\(prenom\)\) between 1 and 40\)/);
  assert.match(sql, /check \(age between 3 and 35\)/);
  assert.match(sql, /check \(lien in \('parent', 'proche', 'tuteur', 'enseignant', 'lui_meme', 'autre'\)\)/);
  assert.match(sql, /check \(lien <> 'lui_meme' or age >= 18\)/);
  assert.match(sql, /check \(char_length\(btrim\(formation\)\) between 1 and 40\)/);
  assert.match(sql, /check \(char_length\(motif\) <= 500\)/);
  assert.match(sql, /check \(statut in \('en_attente', 'validee', 'refusee'\)\)/);
  assert.match(sql, /check \(raison_refus is null or \(char_length\(raison_refus\) <= 300 and statut = 'refusee'\)\)/);
  assert.match(sql, /check \(\(statut = 'en_attente'\) = \(traite_le is null\)\)/);
  assert.match(sql, /justificatif_path like parrain_id::text \|\| '\/' \|\| id::text \|\| '\/%'/, "le justificatif doit être rangé sous <uid>/<id>/");
});

test("institut_demandes : le parrain ne voit que les siennes, insère pour lui-même en attente et seulement si ouvert (ou admin)", () => {
  assert.match(policy("institut_demandes_select", "public.institut_demandes"), /for select to authenticated\s+using \(parrain_id = auth\.uid\(\) or public\.is_admin\(\)\)/);
  const ins = policy("institut_demandes_insert_own", "public.institut_demandes");
  assert.match(ins, /for insert to authenticated/);
  assert.match(ins, /parrain_id = auth\.uid\(\)/);
  assert.match(ins, /statut = 'en_attente'/);
  assert.match(ins, /\(public\.institut_ouvert\(\) or public\.is_admin\(\)\)/);
  const upd = policy("institut_demandes_admin_update", "public.institut_demandes");
  assert.match(upd, /using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  const pol = [...sql.matchAll(/create policy "(\w+)" on public\.institut_demandes/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(pol, ["institut_demandes_admin_update", "institut_demandes_insert_own", "institut_demandes_select"], "aucune règle de suppression");
});

test("institut_demandes : droits au plus juste (insertion par colonnes, mise à jour limitée à statut et raison, jamais de suppression)", () => {
  assert.match(sql, /grant select on public\.institut_demandes to authenticated;/);
  assert.match(sql, /grant insert \(id, parrain_id, prenom, age, lien, formation, motif, justificatif_path, statut\)\s+on public\.institut_demandes to authenticated;/);
  assert.match(sql, /grant update \(statut, raison_refus\) on public\.institut_demandes to authenticated;/);
  assert.ok(!/grant[^;]*\bdelete\b[^;]*institut_demandes/i.test(sql), "pas de droit de suppression");
  assert.ok(!/grant[^;]*institut_demandes[^;]*to[^;]*anon/i.test(sql), "aucun droit pour anon");
});

test("garde des demandes : champs figés, traitement réservé aux admins, 5 en attente au plus (message en français)", () => {
  const g = fnBody("institut_demandes_garde");
  assert.match(g, /if v_en_attente >= 5 then\s+raise exception 'Vous avez déjà 5 demandes en attente\./);
  assert.match(g, /pg_advisory_xact_lock\(hashtextextended\(new\.parrain_id::text, 0\)\)/);
  ["new.parrain_id is distinct from old.parrain_id", "new.prenom is distinct from old.prenom", "new.age is distinct from old.age", "new.lien is distinct from old.lien",
    "new.formation is distinct from old.formation", "new.motif is distinct from old.motif"].forEach((c) => assert.ok(g.includes(c), c));
  assert.match(g, /raise exception 'Les informations d''une demande ne peuvent plus être modifiées\.'/);
  assert.match(g, /if not v_serveur and not public\.is_admin\(\) then\s+raise exception 'Seul un administrateur peut traiter une demande\.'/);
  assert.match(g, /new\.traite_le := now\(\);\s+new\.traite_par := auth\.uid\(\);/);
  assert.match(g, /new\.statut := 'en_attente';[\s\S]*new\.traite_le := null;[\s\S]*new\.traite_par := null;/, "une nouvelle demande part toujours en attente, sans trace de traitement");
  assert.match(sql, /drop trigger if exists institut_demandes_garde_trg on public\.institut_demandes;\s*create trigger institut_demandes_garde_trg\s+before insert or update on public\.institut_demandes/);
});

test("institut_petits_fils : marquage par un admin seulement (jamais d'auto-déclaration), lecture de sa propre ligne", () => {
  assert.match(sql, /user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(policy("institut_petits_fils_select", "public.institut_petits_fils"), /using \(user_id = auth\.uid\(\) or public\.is_admin\(\)\)/);
  ["insert", "update", "delete"].forEach((cmd) => assert.ok(policy("institut_petits_fils_admin_" + cmd, "public.institut_petits_fils").includes("public.is_admin()"), cmd));
  assert.match(policy("institut_petits_fils_admin_insert", "public.institut_petits_fils"), /with check \(public\.is_admin\(\) and \(ajoute_par is null or ajoute_par = auth\.uid\(\)\)\)/);
  const pol = [...sql.matchAll(/create policy "(\w+)" on public\.institut_petits_fils/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(pol, ["institut_petits_fils_admin_delete", "institut_petits_fils_admin_insert", "institut_petits_fils_admin_update", "institut_petits_fils_select"]);
  assert.ok(!/grant[^;]*institut_petits_fils[^;]*to[^;]*anon/i.test(sql));
});

test("aucun accès anonyme en écriture : la seule règle « to anon » est la lecture publique de institut_contenus", () => {
  const toAnon = [...sql.matchAll(/create policy "(\w+)" on ([\w.]+)\s+for (\w+) to ([^\n]*)/g)].filter((m) => /\banon\b/.test(m[4]));
  assert.deepStrictEqual(toAnon.map((m) => [m[1], m[3]]), [["institut_contenus_public_read", "select"]]);
  assert.ok(!/for\s+(all|insert|update|delete)\s+to\s+(public|anon)\b/i.test(sql));
  assert.ok(!/\bto\s+public\b/i.test(sql), "aucune règle ouverte à « public »");
  assert.ok(!/grant\s+(insert|update|delete|all)[^;]*\bto\b[^;]*\banon\b/i.test(sql));
});

test("bucket « institut-justificatifs » : privé (public = false), 5 Mo, images et PDF, on conflict do nothing", () => {
  const m = /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s+values \(\s*'institut-justificatifs', 'institut-justificatifs', (true|false), (\d+),\s+array\[([^\]]*)\]\s*\)\s+on conflict \(id\) do nothing;/.exec(sql);
  assert.ok(m, "insertion du bucket");
  assert.strictEqual(m[1], "false", "bucket PRIVÉ");
  assert.strictEqual(Number(m[2]), 5 * 1024 * 1024);
  assert.deepStrictEqual(m[3].split(",").map((x) => x.trim().replace(/'/g, "")).sort(), ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  assert.ok(!/public\s*=\s*true|, true,/i.test(sql.slice(sql.indexOf("insert into storage.buckets"))), "jamais public");
});

test("règles du bucket (storage.objects) : seulement ce bucket ; dossier = uid ; admins lisent tout ; personne ne modifie ; suppression admin", () => {
  const pol = [...sql.matchAll(/create policy "(\w+)" on storage\.objects[\s\S]*?;/g)];
  assert.deepStrictEqual(pol.map((m) => m[1]).sort(), ["institut_justificatifs_admin_delete", "institut_justificatifs_insert_own", "institut_justificatifs_select"]);
  pol.forEach((m) => assert.ok(m[0].includes("bucket_id = 'institut-justificatifs'"), m[1] + " doit être limitée au bucket"));
  const ins = pol.find((m) => m[1] === "institut_justificatifs_insert_own")[0];
  assert.match(ins, /for insert to authenticated/);
  assert.match(ins, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.match(ins, /array_length\(storage\.foldername\(name\), 1\) = 2/);
  const sel = pol.find((m) => m[1] === "institut_justificatifs_select")[0];
  assert.match(sel, /for select to authenticated/);
  assert.match(sel, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text or public\.is_admin\(\)/);
  const del = pol.find((m) => m[1] === "institut_justificatifs_admin_delete")[0];
  assert.match(del, /for delete to authenticated\s+using \(bucket_id = 'institut-justificatifs' and public\.is_admin\(\)\)/);
  assert.ok(!pol.some((m) => /for update|for all/.test(m[0])), "aucune règle de modification");
  assert.ok(!/policy[^;]*storage\.objects[^;]*to\s+(anon|public)\b/i.test(sql));
});

test("retour arrière : existe, confirmation obligatoire, ordre correct, ne touche ni aux tables existantes ni à is_admin()", () => {
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /if confirmation <> 'OUI' then[\s\S]*raise exception/);
  assert.match(rollback, /raise warning 'ATTENTION : % demande\(s\), % petit\(s\)-fils/);
  assert.ok(rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop policy"));
  const b = blocks(rollbackRaw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4]);
  ["institut_justificatifs_insert_own", "institut_justificatifs_select", "institut_justificatifs_admin_delete"].forEach((n) => assert.ok(rollback.includes('drop policy if exists "' + n + '" on storage.objects;'), n));
  TABLES.forEach((t) => assert.ok(rollback.includes("drop table if exists public." + t + ";"), t));
  ["institut_demandes_garde()", "institut_contenus_maj()", "institut_ouvert()"].forEach((f) => assert.ok(rollback.includes("drop function if exists public." + f + ";"), f));
  assert.ok(rollback.indexOf("drop policy") < rollback.indexOf("drop table") && rollback.indexOf("drop table") < rollback.indexOf("drop function"));
  EXISTING.forEach((t) => assert.ok(!new RegExp("\\b" + t + "\\b", "i").test(rollback), t + " jamais touchée"));
  assert.ok(!/is_admin/.test(rollback) && !/\bcascade\b/i.test(rollback));
  // le bucket n'est supprimé que s'il est vide (les fichiers ne sont jamais effacés par SQL)
  assert.match(rollback, /if exists \(select 1 from storage\.objects where bucket_id = 'institut-justificatifs'\) then[\s\S]*else\s+delete from storage\.buckets where id = 'institut-justificatifs';/);
  assert.ok(!/delete from storage\.objects/i.test(rollback));
  assert.match(rollbackRaw.slice(0, 1800), /IRRÉVERSIBLE/);
});

test("vérification : lecture seule (aucune écriture), couvre tables, RLS, règles, bucket, fonctions et prouve que purchases/messages/rooms ne sont pas touchées", () => {
  const noLiterals = verif.replace(/'(?:[^']|'')*'/g, "''");   // les textes entre apostrophes (ex. 'insert' passé à has_table_privilege) ne sont pas des instructions
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(noLiterals), "requêtes en lecture seule : aucun mot d'écriture");
  const stmts = verif.split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(stmts.length >= 10 && stmts.every((s) => /^select\b/i.test(s)), "uniquement des select");
  ["pg_class", "relrowsecurity", "pg_policies", "storage.buckets", "institut-justificatifs", "pg_proc", "proconfig", "has_table_privilege", "institut_contenus"].forEach((w) => assert.ok(verif.includes(w), w));
  EXISTING.forEach((t) => assert.ok(verif.includes("'" + t + "'"), "contrôle de " + t));
  assert.match(verif, /md5\(/, "empreinte comparable avant / après");
  assert.match(verifRaw, /AVANT puis APRÈS/);
});

test("aucune donnée réelle et aucune mention « Saint-Louis » dans les trois fichiers SQL", () => {
  [raw, rollbackRaw, verifRaw].forEach((t) => {
    assert.ok(!/saint[\s-]*louis/i.test(t));
    assert.ok(!/(sk_(live|test)_|whsec_|@[a-z0-9-]+\.[a-z]{2,}|\+\d{6,}|\b\d{8,}\b)/i.test(t.replace(/5242880|10000000/g, "")), "donnée sensible");
  });
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw + rollbackRaw + verifRaw), "aucun identifiant réel");
});
