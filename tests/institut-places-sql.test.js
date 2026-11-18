/* Garde-fous statiques de institut-places.sql, de son retour arrière et de son SQL de vérification (PR 3 de l'Institut).
   Exécution : node --test tests/institut-places-sql.test.js — lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté,
   aucune base n'est touchée. Modèle : tests/institut-sql.test.js. Le comportement réel (rôles, RLS, fonctions) est
   éprouvé à part sur un PostgreSQL local jetable (voir la description de la PR). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read("institut-places.sql");
const sql = strip(raw);
const rollbackRaw = read("institut-places-rollback.sql");
const rollback = strip(rollbackRaw);
const verifRaw = read("institut-places-verification.sql");
const verif = strip(verifRaw);
const EXISTING = ["formations", "purchases", "messages", "rooms", "profiles", "institut_demandes", "institut_contenus", "institut_petits_fils"];
const NEW_TABLES = ["institut_formations", "institut_dons", "institut_places", "institut_tentatives"];
const FUNCTIONS = ["institut_formations_maj", "institut_dons_garde", "institut_code_genere", "institut_attribuer_place", "institut_reclamer_place", "institut_stats"];

function blocks(text) {
  const parts = text.split(/^-- BLOC (\d+) — /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}
const fnBody = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$function\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const policy = (name, table) => { const m = new RegExp('create policy "' + name + '" on ' + table + "[\\s\\S]*?;").exec(sql); assert.ok(m, name); return m[0]; };
const policiesOn = (table) => [...sql.matchAll(new RegExp('create policy "(\\w+)" on public\\.' + table + "\\b", "g"))].map((m) => m[1]).sort();

test("blocs numérotés 1 à 13, dans l'ordre, courts, avec la note de tête qui les liste", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 90, "bloc " + x.n + " trop long (" + x.body.split("\n").length + " lignes)"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 — "));
  assert.match(head, /BLOCS \(dans l'ordre\)/);
  for (let n = 1; n <= 13; n++) assert.ok(new RegExp("--   BLOC " + n + "\\s+—").test(head), "note de tête : bloc " + n);
  assert.match(head, /BLOC PAR BLOC/);
  assert.match(head, /Prérequis : institut\.sql/);
  b.forEach((x) => assert.ok(!/-- BLOC \d+ — /.test(x.body), "bloc autonome"));
});

test("collage direct : les commentaires d'un bloc sont AVANT ses instructions, jamais au milieu ni en fin de ligne", () => {
  blocks(raw).forEach((x) => {
    const lines = x.body.split("\n").slice(1);
    let seenCode = false;
    lines.forEach((l, i) => {
      const t = l.trim();
      if (!t) return;
      if (t.startsWith("--")) assert.ok(!seenCode, "bloc " + x.n + " : commentaire au milieu des instructions (ligne " + (i + 2) + ")");
      else { seenCode = true; assert.ok(!/\s--\s/.test(l) && !/;\s*--/.test(l), "bloc " + x.n + " : commentaire en fin de ligne : " + t.slice(0, 50)); }
    });
    assert.ok(seenCode, "bloc " + x.n + " : instructions");
  });
});

test("100 % additif : aucune table existante modifiée (formations, purchases, messages, rooms, profiles, tables des PR 1 et 2)", () => {
  EXISTING.forEach((t) => {
    assert.ok(!new RegExp("\\b(alter\\s+table|drop\\s+table|truncate(\\s+table)?)\\s+(if\\s+exists\\s+)?(only\\s+)?public\\." + t + "\\b", "i").test(sql), t + " : ni alter, ni drop, ni truncate");
    assert.ok(!new RegExp("\\bon\\s+(only\\s+)?public\\." + t + "\\b", "i").test(sql), t + " : ni règle, ni déclencheur, ni index, ni droit");
  });
  assert.ok(!/\bdrop\s+table\b/i.test(sql), "le fichier principal ne supprime aucune table");
  assert.ok(!/^(update|delete\s+from|truncate)\b/im.test(sql), "aucune modification de données au niveau racine");
  assert.ok(!/alter\s+table\s+public\.(?!institut_(formations|dons|places|tentatives)\b)/i.test(sql), "alter table seulement sur les nouvelles tables");
  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(created, NEW_TABLES.slice().sort());
  assert.ok(!/create table (?!if not exists)/i.test(sql) && !/create index (?!if not exists)/i.test(sql));
  [...sql.matchAll(/create policy "(\w+)" on ([\w.]+)/g)].forEach((m) => assert.ok(sql.includes('drop policy if exists "' + m[1] + '" on ' + m[2] + ";"), "idempotent : " + m[1]));
  [...sql.matchAll(/add constraint (\w+)/g)].forEach((m) => assert.ok(new RegExp("drop constraint if exists " + m[1] + ";").test(sql), m[1]));
});

test("aucune donnée insérée par le fichier : les seules écritures sont celles des fonctions (places, tentatives, achat de la réclamation)", () => {
  const targets = [...sql.matchAll(/insert into (public\.\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(targets, ["public.institut_places", "public.institut_tentatives", "public.institut_tentatives", "public.institut_tentatives", "public.purchases"]);
  assert.ok(!/insert into public\.(formations|institut_demandes|institut_contenus|institut_petits_fils|institut_formations|institut_dons)/.test(sql));
  const withoutPrereq = sql.split("\n").filter((l) => !/to_regclass|raise exception 'public\./.test(l)).join("\n");   // le bloc 1 vérifie seulement l'existence de la table
  assert.strictEqual((withoutPrereq.match(/public\.purchases/g) || []).length, 2, "purchases : une lecture (déjà possédée) et une insertion (réclamation), rien d'autre");
  assert.strictEqual((fnBody("institut_reclamer_place").match(/public\.purchases/g) || []).length, 2, "et uniquement dans institut_reclamer_place");
});

test("RLS activée sur les 4 nouvelles tables, droits retirés à anon et authenticated avant d'accorder au plus juste", () => {
  NEW_TABLES.forEach((t) => {
    assert.match(sql, new RegExp("alter table public\\." + t + " enable row level security;"), t);
    assert.match(sql, new RegExp("revoke all on public\\." + t + " from anon, authenticated;"), t);
  });
});

test("institut_formations : clé étrangère vers formations, prix > 0, lecture publique des actives, écriture is_admin() seulement", () => {
  const body = /create table if not exists public\.institut_formations \(([\s\S]*?)\n\);/.exec(sql)[1];
  assert.match(body, /formation_id text primary key references public\.formations\(id\) on delete cascade/);
  assert.match(body, /prix_institut integer not null/);
  assert.match(body, /actif boolean not null default false/);
  assert.match(body, /ordre integer not null default 0/);
  assert.match(sql, /check \(prix_institut > 0\)/);
  assert.match(policy("institut_formations_public_read", "public.institut_formations"), /for select to anon, authenticated\s+using \(actif = true\)/);
  assert.match(policy("institut_formations_admin_select", "public.institut_formations"), /using \(public\.is_admin\(\)\)/);
  ["insert", "update", "delete"].forEach((cmd) => assert.ok(policy("institut_formations_admin_" + cmd, "public.institut_formations").includes("public.is_admin()"), cmd));
  assert.match(sql, /grant update \(prix_institut, actif, ordre\) on public\.institut_formations to authenticated;/, "le formation_id n'est pas modifiable");
  assert.ok(!/grant[^;]*institut_formations[^;]*to[^;]*anon[^;]*;/i.test(sql.replace(/grant select on public\.institut_formations to anon, authenticated;/, "")), "anon : lecture seule");
});

test("institut_dons : montant > 0, 1 à 1000 places, donateur ≤ 80, note ≤ 300 ; administrateurs seuls (lecture ET écriture), rien de public", () => {
  assert.match(sql, /check \(montant > 0\)/);
  assert.match(sql, /check \(places between 1 and 1000\)/);
  assert.match(sql, /check \(donateur is null or char_length\(donateur\) <= 80\)/);
  assert.match(sql, /check \(note is null or char_length\(note\) <= 300\)/);
  assert.match(sql, /recu_le date not null default current_date/);
  assert.match(sql, /cree_par uuid default auth\.uid\(\)/);
  assert.deepStrictEqual(policiesOn("institut_dons"), ["institut_dons_admin_delete", "institut_dons_admin_insert", "institut_dons_admin_select", "institut_dons_admin_update"]);
  policiesOn("institut_dons").forEach((n) => assert.ok(policy(n, "public.institut_dons").includes("public.is_admin()"), n));
  assert.ok(!/institut_dons[^;]*to anon|to anon[^;]*institut_dons/i.test(sql));
  assert.match(sql, /grant insert \(montant, places, donateur, note, recu_le\) on public\.institut_dons to authenticated;/, "cree_par n'est pas falsifiable");
});

test("institut_places : conditions du modèle (don ⇔ don_id, bénéficiaire ⇔ date, code à 8 caractères sans ambiguïté, unique), clés étrangères", () => {
  const body = /create table if not exists public\.institut_places \(([\s\S]*?)\n\);/.exec(sql)[1];
  assert.match(body, /demande_id uuid not null unique references public\.institut_demandes\(id\) on delete cascade/);
  assert.match(body, /formation_id text not null references public\.institut_formations\(formation_id\)/);
  assert.match(body, /don_id uuid references public\.institut_dons\(id\) on delete restrict/);
  assert.match(body, /code text not null unique/);
  assert.match(body, /beneficiaire_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(sql, /check \(source in \('don', 'offerte'\)\)/);
  assert.match(sql, /check \(\(source = 'don' and don_id is not null\) or \(source = 'offerte' and don_id is null\)\)/);
  assert.match(sql, /check \(\(beneficiaire_id is null\) = \(reclamee_le is null\)\)/);
  assert.match(sql, /check \(code ~ '\^\[ABCDEFGHJKLMNPQRSTUVWXYZ23456789\]\{8\}\$'\)/);
  assert.ok(!/[IO01]/.test("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") && "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".length === 32);
});

test("institut_places : LECTURE SEULE (admins, parrain de la demande, bénéficiaire) ; aucun droit d'écriture, même pour les admins", () => {
  assert.deepStrictEqual(policiesOn("institut_places"), ["institut_places_admin_select", "institut_places_beneficiaire_select", "institut_places_parrain_select"]);
  assert.match(policy("institut_places_admin_select", "public.institut_places"), /for select to authenticated using \(public\.is_admin\(\)\)/);
  assert.match(policy("institut_places_parrain_select", "public.institut_places"), /for select to authenticated\s+using \(exists \(select 1 from public\.institut_demandes d where d\.id = demande_id and d\.parrain_id = auth\.uid\(\)\)\)/);
  assert.match(policy("institut_places_beneficiaire_select", "public.institut_places"), /for select to authenticated using \(beneficiaire_id = auth\.uid\(\)\)/);
  assert.match(sql, /grant select on public\.institut_places to authenticated;/);
  assert.ok(!/grant[^;]*\b(insert|update|delete|all)\b[^;]*institut_places/i.test(sql), "aucun droit d'écriture sur institut_places");
  assert.ok(!/for (insert|update|delete|all)[^;]*on public\.institut_places|on public\.institut_places\s+for (insert|update|delete|all)/i.test(sql));
});

test("institut_tentatives : RLS activée, AUCUNE règle, aucun droit (accessible seulement par les fonctions)", () => {
  assert.deepStrictEqual(policiesOn("institut_tentatives"), []);
  assert.ok(!/grant[^;]*institut_tentatives/i.test(sql));
  assert.match(sql, /create index if not exists institut_tentatives_user_idx on public\.institut_tentatives \(user_id, cree_le desc\);/);
});

test("aucun accès anonyme en écriture : la seule règle « to anon » est la lecture des formations actives", () => {
  const toAnon = [...sql.matchAll(/create policy "(\w+)" on ([\w.]+)\s+for (\w+) to ([^\n]*)/g)].filter((m) => /\banon\b/.test(m[4]));
  assert.deepStrictEqual(toAnon.map((m) => [m[1], m[3]]), [["institut_formations_public_read", "select"]]);
  assert.ok(!/\bto\s+public\b/i.test(sql) && !/grant\s+(insert|update|delete|all)[^;]*\bto\b[^;]*\banon\b/i.test(sql));
});

test("TOUTES les fonctions : search_path fixé ; security definer seulement pour attribuer, réclamer et stats", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(names, FUNCTIONS.slice().sort());
  names.forEach((n) => assert.match(fnBody(n), /set search_path = public, pg_temp/, n));
  const definers = names.filter((n) => /security definer/.test(fnBody(n))).sort();
  assert.deepStrictEqual(definers, ["institut_attribuer_place", "institut_reclamer_place", "institut_stats"]);
});

test("security definer : revoke ... from public PUIS grant execute précis (attribuer et réclamer : connectés ; stats : anon et connectés)", () => {
  assert.match(sql, /revoke all on function public\.institut_attribuer_place\(uuid, text, text, uuid\) from public, anon;\s*grant execute on function public\.institut_attribuer_place\(uuid, text, text, uuid\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.institut_reclamer_place\(text\) from public, anon;\s*grant execute on function public\.institut_reclamer_place\(text\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.institut_stats\(\) from public;\s*grant execute on function public\.institut_stats\(\) to anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.institut_code_genere\(\) from public, anon, authenticated;/);
  assert.ok(!/grant execute on function public\.institut_code_genere/.test(sql), "le générateur n'est appelable que par les fonctions");
  assert.ok(!/grant execute on function public\.institut_(attribuer|reclamer)[^;]*anon/.test(sql));
});

test("code d'invitation : tiré de gen_random_uuid() (aléatoire cryptographique), jamais de random() ; alphabet de 32 symboles, 5 bits chacun", () => {
  const f = fnBody("institut_code_genere");
  assert.match(f, /uuid_send\(gen_random_uuid\(\)\)/);
  assert.ok(!/\brandom\s*\(/i.test(sql), "random() interdit");
  assert.ok(!/setseed|clock_timestamp|now\(\)|txid/i.test(f), "aucune source prévisible");
  assert.match(f, /v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'/);
  assert.match(f, /\(get_byte\(v_octets, i\) & 31\) \+ 1/, "5 bits par caractère (32 symboles : aucun biais)");
  const positions = /v_positions constant integer\[\] := array\[([^\]]*)\]/.exec(f)[1].split(",").map((x) => Number(x.trim()));
  assert.deepStrictEqual(positions, [0, 1, 2, 3, 4, 5, 7, 9]);
  assert.ok(!positions.includes(6) && !positions.includes(8), "octets 6 et 8 d'un UUID v4 exclus (bits de version et de variante fixes)");
  assert.strictEqual(positions.length, 8);
});

test("institut_attribuer_place : réservée aux admins, tout dans une transaction, toutes les vérifications, verrous, 10 essais au plus", () => {
  const f = fnBody("institut_attribuer_place");
  assert.match(f, /returns uuid/);
  assert.match(f, /p_don uuid default null/);
  assert.match(f, /if not public\.is_admin\(\) then\s+raise exception 'Réservé aux administrateurs\.';\s+end if;/);
  assert.ok(f.indexOf("if not public.is_admin() then") < f.indexOf("select * into v_demande"), "contrôle admin avant toute lecture");
  assert.match(f, /where id = p_demande for update/, "la demande est verrouillée (deux attributions simultanées impossibles)");
  assert.match(f, /v_demande\.statut <> 'validee'/);
  assert.match(f, /exists \(select 1 from public\.institut_places where demande_id = p_demande\)/);
  assert.match(f, /formation_id = p_formation and actif/);
  assert.match(f, /p_source not in \('don', 'offerte'\)/);
  assert.match(f, /pg_advisory_xact_lock\(hashtextextended\(p_don::text, 0\)\)/);
  assert.match(f, /v_utilisees >= v_don\.places/);
  assert.match(f, /exception when unique_violation then\s+if v_essai >= 10 then/);
  assert.match(f, /institut_code_genere\(\)/);
  ["Demande introuvable.", "La demande doit d'abord être validée.", "Cette demande a déjà une place.", "Cette formation n'est pas proposée par l'Institut.", "Ce don n'a plus de place disponible.", "Don introuvable."]
    .forEach((m) => assert.ok(f.includes(m.replace(/'/g, "''")), "message : " + m));
});

test("institut_reclamer_place : connecté seulement, anti-devinette (5 échecs/heure), verrou, neutre, achat unique à 0 FCFA, place non consommée si déjà propriétaire", () => {
  const f = fnBody("institut_reclamer_place");
  assert.match(f, /returns text/);
  assert.match(f, /if v_uid is null then\s+raise exception 'Connectez-vous/);
  assert.strictEqual((f.match(/raise exception/g) || []).length, 1, "une seule exception (non connecté) : un échec de saisie doit pouvoir être enregistré");
  assert.match(f, /regexp_replace\(coalesce\(p_code, ''\), '\[\\s-\]', '', 'g'\)/);
  assert.match(f, /upper\(/);
  assert.match(f, /count\(\*\) from public\.institut_tentatives where user_id = v_uid and cree_le > now\(\) - interval '1 hour'\) >= 5/);
  assert.match(f, /return 'ERREUR:TROP_DE_TENTATIVES'/);
  assert.match(f, /pg_advisory_xact_lock\(hashtextextended\('institut_tentatives:' \|\| v_uid::text, 0\)\)/);
  assert.match(f, /select \* into v_place from public\.institut_places where code = v_code for update;/);
  // inconnu, mal formé, déjà réclamé, demande plus validée : MÊME réponse, et la tentative est enregistrée AVANT de répondre
  const invalid = f.match(/insert into public\.institut_tentatives \(user_id\) values \(v_uid\);\s+return 'ERREUR:CODE_INVALIDE';/g) || [];
  assert.strictEqual(invalid.length, 3, "mal formé, inconnu ou déjà réclamé, demande non validée : tentative enregistrée puis réponse identique");
  assert.match(f, /if not found or v_place\.reclamee_le is not null then/);
  assert.match(f, /v_statut is distinct from 'validee'/);
  assert.match(f, /return 'ERREUR:PARRAIN'/);
  assert.match(f, /if exists \(select 1 from public\.purchases p where p\.user_id = v_uid and [^;]*\) then\s+return 'ERREUR:DEJA_POSSEDEE';/);
  assert.ok(f.indexOf("ERREUR:DEJA_POSSEDEE") < f.indexOf("update public.institut_places"), "le contrôle « déjà propriétaire » précède toute écriture : la place n'est pas consommée");
  assert.match(f, /p\.user_id = v_uid and p\.course_id = v_place\.formation_id and p\.product_type = 'formation' and p\.status = 'paid'/);
  assert.match(f, /update public\.institut_places set beneficiaire_id = v_uid, reclamee_le = now\(\) where id = v_place\.id;/);
  assert.match(f, /insert into public\.purchases \(user_id, course_id, course_name, amount, status, product_type, paid_at, fedapay_transaction_id\)\s+values \(v_uid, v_place\.formation_id, coalesce\(v_nom, v_place\.formation_id\), 0, 'paid', 'formation', now\(\), null\);/);
  assert.match(f, /exception when unique_violation then\s+return 'ERREUR:ACHAT_EXISTANT';/);
  assert.match(f, /select f\.nom into v_nom from public\.formations f where f\.id = v_place\.formation_id/);
  assert.strictEqual((f.match(/insert into public\.purchases/g) || []).length, 1, "exactement UNE ligne purchases par réclamation");
  assert.match(f, /return v_place\.formation_id;/);
  assert.match(raw, /NE LÈVE PAS d'exception pour un échec de saisie/, "le choix est documenté dans le fichier");
});

test("institut_stats : exactement deux nombres entiers ; jamais de nom, de montant, de code ni d'identifiant", () => {
  const f = fnBody("institut_stats");
  assert.match(f, /returns table \(places_financees integer, eleves_formes integer\)/);
  assert.match(f, /select count\(\*\)::integer from public\.institut_places where source = 'don'/);
  assert.match(f, /select count\(\*\)::integer from public\.institut_places where reclamee_le is not null/);
  assert.ok(!/\b(code|donateur|montant|user_id|beneficiaire_id|parrain_id|demande_id|don_id|note|prenom|id)\b/.test(f.replace(/institut_places/g, "").split("as $function$")[1] || ""), "aucune colonne d'identité dans le corps");
  assert.strictEqual((f.match(/select count/g) || []).length, 2);
  assert.match(raw, /places_financees » = nombre de places ATTRIBUÉES/, "le choix est documenté");
});

test("garde des dons : un don ne peut pas financer moins de places que celles déjà attribuées", () => {
  const f = fnBody("institut_dons_garde");
  assert.match(f, /select count\(\*\) into v_utilisees from public\.institut_places where don_id = old\.id;/);
  assert.match(f, /if new\.places < v_utilisees then\s+raise exception/);
  assert.match(sql, /create trigger institut_dons_garde_trg\s+before update of places on public\.institut_dons/);
  assert.ok(raw.indexOf("-- BLOC 8 — Fonction institut_dons_garde") > raw.indexOf("-- BLOC 6 — Table institut_places"), "créée après la table institut_places");
});

test("retour arrière : confirmation obligatoire, ordre tables puis fonctions, ne touche NI purchases NI les tables existantes, les achats d'élèves restent", () => {
  assert.match(rollback, /confirmation constant text := 'NON'/);
  assert.match(rollback, /if confirmation <> 'OUI' then[\s\S]*raise exception/);
  assert.match(rollback, /raise warning 'ATTENTION : % place\(s\) \(dont % déjà réclamée\(s\)\) et % don\(s\)/);
  assert.deepStrictEqual(blocks(rollbackRaw).map((x) => x.n), [1, 2, 3]);
  assert.ok(rollback.indexOf("confirmation <> 'OUI'") < rollback.indexOf("drop table"));
  const tables = [...rollback.matchAll(/drop table if exists public\.(\w+);/g)].map((m) => m[1]);
  assert.deepStrictEqual(tables.slice().sort(), NEW_TABLES.slice().sort());
  assert.ok(tables.indexOf("institut_places") < tables.indexOf("institut_dons") && tables.indexOf("institut_places") < tables.indexOf("institut_formations"), "places avant dons et formations (clés étrangères)");
  FUNCTIONS.forEach((n) => assert.ok(new RegExp("drop function if exists public\\." + n + "\\(").test(rollback), n));
  assert.ok(rollback.indexOf("drop table") < rollback.indexOf("drop function"), "tables avant fonctions (les déclencheurs disparaissent avec les tables)");
  // le seul mot « purchases » est dans le texte de l'avertissement (entre apostrophes) : jamais dans une instruction
  const rollbackCode = rollback.replace(/'(?:[^']|'')*'/g, "''");
  EXISTING.concat(["purchases"]).forEach((t) => assert.ok(!new RegExp("\\b" + t + "\\b", "i").test(rollbackCode), t + " jamais touchée"));
  assert.match(rollback, /Les achats déjà créés pour les élèves restent dans public\.purchases\./);
  assert.ok(!/\bcascade\b/i.test(rollback) && !/is_admin/.test(rollback));
  assert.match(rollbackRaw.slice(0, 2200), /LES ACHATS DÉJÀ CRÉÉS RESTENT/);
  assert.match(rollbackRaw.slice(0, 2200), /GARDENT leur accès/);
  assert.match(rollbackRaw.slice(0, 2200), /IRRÉVERSIBLE/);
});

test("vérification : lecture seule (que des select), couvre tables, RLS, règles, fonctions, droits ; prouve que les tables existantes n'ont pas changé", () => {
  const noLiterals = verif.replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(noLiterals), "aucun mot d'écriture");
  const stmts = verif.split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(stmts.length >= 9 && stmts.every((s) => /^select\b/i.test(s)), "uniquement des select");
  ["pg_class", "relrowsecurity", "pg_policies", "pg_proc", "prosecdef", "proconfig", "has_table_privilege", "has_function_privilege", "pg_get_function_result", "pg_constraint"].forEach((w) => assert.ok(verif.includes(w), w));
  EXISTING.forEach((t) => assert.ok(verif.includes("'" + t + "'"), "contrôle de " + t));
  NEW_TABLES.forEach((t) => assert.ok(verif.includes("'" + t + "'"), t));
  assert.match(verif, /md5\(/);
  assert.match(verifRaw, /AVANT puis APRÈS/);
  assert.match(verifRaw, /les 8 empreintes doivent être IDENTIQUES/);
  assert.match(verifRaw, /TABLE\(places_financees integer, eleves_formes integer\)/);
});

test("aucune donnée réelle et aucune mention « Saint-Louis » dans les trois fichiers SQL", () => {
  [raw, rollbackRaw, verifRaw].forEach((t) => {
    assert.ok(!/saint[\s-]*louis/i.test(t));
    assert.ok(!/(sk_(live|test)_|whsec_|@[a-z0-9-]+\.[a-z]{2,}|\+\d{6,}|\b\d{8,}\b)/i.test(t.replace(/10000000/g, "")), "donnée sensible");
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t), "aucun identifiant réel");
  });
});
