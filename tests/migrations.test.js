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

test("migrations numérotées (001 à 006, puis 007…), chacune avec son retour arrière du même nom", () => {
  const nums = migrations.map((f) => f.slice(0, 3));
  assert.deepStrictEqual(nums.slice(0, 6), ["001", "002", "003", "004", "005", "006"]);
  assert.deepStrictEqual(nums, nums.slice().sort(), "numéros croissants");
  assert.strictEqual(new Set(nums).size, nums.length, "aucun numéro en double");
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
  assert.ok(code.lastIndexOf("revoke execute") < code.indexOf("grant execute"), "les GRANT viennent après tous les REVOKE");
});

test("005 : le retour arrière redonne l'exécution à anon", () => {
  const code = stripComments(read("rollback/005_anon_sans_fonctions_messagerie.sql"));
  ["get_or_create_dm_conversation(uuid)", "search_profiles(text)", "get_public_profile(uuid)"].forEach((f) =>
    assert.ok(code.includes("grant execute on function public." + f + " to public, anon, authenticated, service_role;")));
});

test("007 : seul l'auteur modifie un message privé (plus d'is_admin() dans la politique d'UPDATE de dm_messages)", () => {
  const raw = read("007_dm_messages_update_auteur_seul.sql");
  const code = stripComments(raw);
  assert.ok(!/is_admin/i.test(code), "aucun is_admin() dans le code de la 007");
  assert.match(code, /create policy "dm_messages_update_own" on public\.dm_messages\s+for update to authenticated\s+using \(sender_id = auth\.uid\(\)\)\s+with check \(sender_id = auth\.uid\(\)\);/);
  assert.ok(code.includes('drop policy if exists "dm_messages_update_own_or_admin" on public.dm_messages;'));
  assert.ok(code.includes('drop policy if exists "dm_messages_update_own" on public.dm_messages;'));
  assert.match(code, /^begin;$/m);
  assert.match(code, /^commit;$/m);
  assert.strictEqual((code.match(/create policy/g) || []).length, 1, "une seule politique créée");
  assert.ok(!/\b(grant|revoke|update public|delete from|insert into|alter table)\b/i.test(code), "ni droits, ni données, ni autre politique");
  assert.match(raw, /DÉJÀ EXÉCUTÉE EN PRODUCTION LE 7 NOVEMBRE 2026/);
});

test("007 : le retour arrière recrée l'ancienne politique (auteur ou admin)", () => {
  const code = stripComments(read("rollback/007_dm_messages_update_auteur_seul.sql"));
  assert.match(code, /create policy "dm_messages_update_own_or_admin" on public\.dm_messages\s+for update using \(sender_id = auth\.uid\(\) or is_admin\(\)\)\s+with check \(sender_id = auth\.uid\(\) or is_admin\(\)\);/);
  assert.match(read("rollback/007_dm_messages_update_auteur_seul.sql").split("\n")[0], /^-- ⚠️ ATTENTION/);
});

test("supabase-schema.sql reflète l'état réel : un seul UPDATE sur dm_messages, réservé à l'auteur", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "supabase-schema.sql"), "utf8");
  const code = schema.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const creates = code.match(/create policy "dm_messages_update[^"]*" on public\.dm_messages[\s\S]*?;/g) || [];
  assert.strictEqual(creates.length, 1);
  assert.match(creates[0], /"dm_messages_update_own"/);
  assert.ok(!/is_admin/.test(creates[0]));
  assert.match(creates[0], /for update to authenticated\s+using \(sender_id = auth\.uid\(\)\)\s+with check \(sender_id = auth\.uid\(\)\)/);
});

test("006 : écriture réservée aux admins, quatre colonnes modifiables seulement, aucun DELETE", () => {
  const code = stripComments(read("006_moderation_signalements.sql"));
  assert.ok(/revoke update, delete on table public\.message_reports from public, anon, authenticated;/.test(code), "update/delete retirés d'abord");
  assert.ok(code.includes("grant update (status, handled_by, handled_at, admin_note) on table public.message_reports to authenticated;"));
  const grants = code.match(/grant update \([^)]*\)/g) || [];
  assert.strictEqual(grants.length, 1, "un seul GRANT UPDATE, limité à des colonnes");
  assert.ok(!/grant (all|update|delete)\s+on/i.test(code), "aucun GRANT de table entière");
  assert.match(code, /create policy "message_reports_update_admin" on public\.message_reports\s+for update to authenticated\s+using \(public\.is_admin\(\)\)\s+with check \(public\.is_admin\(\)\);/);
  assert.ok(!/for delete|for all/i.test(code), "aucune politique DELETE ni ALL");
  assert.ok(!/grant[^;]*\bdelete\b/i.test(code));
  assert.match(code, /check \(status in \('open', 'dismissed', 'actioned'\)\)/);
  assert.match(code, /status text not null default 'open'/);
});

test("006 : handled_by et handled_at remplis par un déclencheur (auth.uid(), now())", () => {
  const code = stripComments(read("006_moderation_signalements.sql"));
  assert.match(code, /create trigger trg_message_report_handled\s+before update on public\.message_reports/);
  assert.ok(code.includes("new.handled_by := auth.uid();") && code.includes("new.handled_at := now();"));
  assert.ok(code.includes("new.handled_by := old.handled_by;"), "non modifiable par le client hors changement de statut");
});

test("006 : fonction de masquage de salon réservée aux admins, sans équivalent pour les messages privés", () => {
  const code = stripComments(read("006_moderation_signalements.sql"));
  const fn = code.slice(code.indexOf("create or replace function public.admin_hide_room_message"));
  assert.match(fn, /security definer\s+set search_path = public/);
  assert.ok(fn.indexOf("public.is_admin()") < fn.indexOf("update public.messages"), "is_admin() vérifié avant toute écriture");
  assert.ok(fn.includes("revoke execute on function public.admin_hide_room_message(bigint) from public, anon;"));
  assert.ok(fn.includes("grant execute on function public.admin_hide_room_message(bigint) to authenticated;"));
  assert.ok(/is_deleted = true/.test(fn) && !/delete from/i.test(code), "la ligne n'est pas effacée");
  assert.ok(!/dm_messages|dm_conversations/.test(code), "006 ne touche jamais aux messages privés (code)");
  assert.strictEqual((code.match(/create or replace function public\.admin_hide_/g) || []).length, 1, "une seule fonction de masquage");
  assert.ok(!/(create|alter|drop)\s+policy[^;]*(messages|dm_)/i.test(code.replace(/message_reports/g, "")), "aucune politique existante modifiée");
});

test("006 : le retour arrière retire seulement ce que la 006 a ajouté", () => {
  const code = stripComments(read("rollback/006_moderation_signalements.sql"));
  ["admin_hide_room_message", "trg_message_report_handled", "set_message_report_handled", "message_reports_update_admin"].forEach((n) => assert.ok(code.includes(n), n));
  ["status", "handled_by", "handled_at", "admin_note"].forEach((c) => assert.ok(new RegExp("drop column if exists " + c).test(code), c));
  assert.ok(!/drop table|delete from|truncate|update public/i.test(code), "aucun signalement supprimé ou modifié");
  assert.ok(!/drop column if exists (kind|message_id|reporter_id|reason|created_at|reported_user_id|message_text)/.test(code));
});

test("008 : modérateur = colonne séparée protégée par son propre déclencheur ; les deux déclencheurs de rôle ne sont pas touchés", () => {
  const code = stripComments(read("008_roles_moderateur.sql"));
  assert.match(code, /add column if not exists is_moderator boolean not null default false/);
  assert.match(code, /create trigger trg_protect_moderator_flag\s+before insert or update on public\.profiles/);
  assert.match(code, /new\.is_moderator := false;/, "inscription : forcé à faux");
  assert.ok(!/trg_prevent_profile_role_change|trg_protect_role|prevent_profile_role_change|protect_role_column/.test(code), "les déclencheurs de rôle existants ne sont ni modifiés ni supprimés");
  assert.ok(!/alter table public\.profiles[^;]*\brole\b/i.test(code), "profiles.role n'est pas touchée");
  assert.ok(!/function public\.is_admin/.test(code), "is_admin() n'est pas redéfinie");
});

test("008 : apply_role_change réservée à service_role ; role_changes lisible par le founder seul, jamais écrite par un client", () => {
  const code = stripComments(read("008_roles_moderateur.sql"));
  assert.ok(code.includes("revoke execute on function public.apply_role_change(uuid, uuid, text, boolean, text) from public, anon, authenticated;"));
  assert.ok(code.includes("grant execute on function public.apply_role_change(uuid, uuid, text, boolean, text) to service_role;"));
  assert.ok(!/grant execute on function public\.apply_role_change[^;]*authenticated/.test(code));
  ["ROLE_FOUNDER_REQUIS", "ROLE_SOI_MEME", "ROLE_CIBLE_PROTEGEE", "ROLE_CIBLE_INTROUVABLE", "ROLE_VALEUR_INVALIDE", "ROLE_AUCUN_CHANGEMENT"].forEach((e) => assert.ok(code.includes(e), e));
  assert.match(code, /alter table public\.role_changes enable row level security;/);
  assert.ok(code.includes("revoke all on table public.role_changes from public, anon, authenticated;"));
  assert.ok(code.includes("grant select on table public.role_changes to authenticated;"));
  assert.ok(!/grant (insert|update|delete|all)[^;]*role_changes/i.test(code));
  assert.match(code, /create policy "role_changes_select_founder" on public\.role_changes\s+for select to authenticated\s+using \(public\.is_founder\(\)\);/);
});

test("008 : droits du modérateur limités aux signalements de SALON ; aucune politique sur les profils ni les messages privés", () => {
  const code = stripComments(read("008_roles_moderateur.sql"));
  assert.match(code, /create policy "message_reports_select_moderator" on public\.message_reports\s+for select to authenticated\s+using \(kind = 'room' and public\.is_moderator\(\)\);/);
  assert.match(code, /create policy "message_reports_update_moderator" on public\.message_reports\s+for update to authenticated\s+using \(kind = 'room' and public\.is_moderator\(\)\)\s+with check \(kind = 'room' and public\.is_moderator\(\)\);/);
  const policies = code.match(/create policy "[^"]+" on public\.[a-z_]+/g) || [];
  assert.deepStrictEqual(policies.map((p) => p.split(" on public.")[1]).sort(), ["message_reports", "message_reports", "role_changes"]);
  assert.ok(!/(dm_messages|dm_conversations|dm_hidden|dm_read_state)/.test(code.replace(/prosrc/g, "")), "aucune référence aux messages privés dans le code");
  assert.ok(!/drop policy[^;]*(?<!moderator)"\s+on/.test(code.replace(/drop policy if exists "[a-z_]*(moderator|founder)"[^;]*;/g, "")), "aucune politique existante supprimée");
  assert.ok(!/grant (insert|update|delete|all)/i.test(code.replace(/grant execute/gi, "")), "aucun droit de table accordé");
});

test("008 : fonctions du modérateur réservées aux connectés ; le modérateur ne masque qu'un message signalé ; seulement id et pseudo des personnes citées", () => {
  const code = stripComments(read("008_roles_moderateur.sql"));
  ["is_moderator()", "is_founder()", "moderator_room_messages(bigint[])", "moderator_report_people(bigint[])", "admin_hide_room_message(bigint)"].forEach((f) => {
    assert.ok(code.includes("revoke execute on function public." + f + " from public, anon;"), "revoke " + f);
    assert.ok(code.includes("grant execute on function public." + f + " to authenticated;"), "grant " + f);
  });
  const hide = code.slice(code.indexOf("create or replace function public.admin_hide_room_message"), code.indexOf("create or replace function public.moderator_room_messages"));
  assert.ok(hide.indexOf("public.is_moderator()") < hide.indexOf("update public.messages"));
  assert.match(hide, /not public\.is_admin\(\) and not exists \(\s+select 1 from public\.message_reports r\s+where r\.kind = 'room' and r\.message_id = p_message_id and r\.reporter_id <> auth\.uid\(\)\s+\)/);
  const people = code.slice(code.indexOf("create or replace function public.moderator_report_people"));
  assert.match(people, /returns table \(user_id uuid, username text\)/);
  assert.ok(!/full_name|country|email|\brole\b/.test(people.slice(0, people.indexOf("commit;"))), "ni nom légal, ni pays, ni e-mail, ni rôle");
  assert.match(code, /returns table \(report_id bigint, message_id bigint, content text, is_deleted boolean, attachment_type text\)/);
});

test("008 : le retour arrière retire tout, rend admin_hide_room_message aux admins, ne touche ni profiles.role ni les signalements", () => {
  const raw = read("rollback/008_roles_moderateur.sql");
  const code = stripComments(raw);
  assert.match(raw.split("\n")[0], /^-- ⚠️ ATTENTION/);
  ["message_reports_select_moderator", "message_reports_update_moderator", "moderator_room_messages", "moderator_report_people", "apply_role_change", "role_changes_select_founder", "trg_protect_moderator_flag", "protect_moderator_flag", "is_moderator()", "is_founder()"].forEach((n) => assert.ok(code.includes(n), n));
  assert.ok(code.includes("drop column if exists is_moderator"));
  assert.match(code, /if not public\.is_admin\(\) then\s+raise exception 'ADMIN_REQUIRED/);
  assert.ok(!/is_moderator\(\)/.test(code.slice(code.indexOf("create or replace function public.admin_hide_room_message"), code.indexOf("drop function if exists public.apply_role_change"))), "la version restaurée n'utilise plus is_moderator()");
  assert.ok(!/drop trigger[^;]*(prevent_profile_role_change|trg_protect_role)/.test(code));
  assert.ok(!/update public\.(profiles|message_reports)|delete from|truncate/i.test(code.replace(/update public\.message_reports\s+set (message_text|status)/g, "")));
});

test("009 : contraintes CHECK de format sur rooms (couleur hexadécimale, émoji court sans < > \" ' &, photo https), NOT VALID puis validées seulement sans violation", () => {
  const code = stripComments(read("009_salons_champs_valides.sql"));
  assert.match(code, /add constraint rooms_color_hex_check\s+check \(color ~ '\^#\(\[0-9A-Fa-f\]\{3\}\|\[0-9A-Fa-f\]\{4\}\|\[0-9A-Fa-f\]\{6\}\|\[0-9A-Fa-f\]\{8\}\)\$'\)\s+not valid;/);
  assert.match(code, /add constraint rooms_emoji_safe_check\s+check \(char_length\(emoji\) between 1 and 16 and emoji !~ '\[<>"''&\[:cntrl:\]\\u2028\\u2029\]'\)\s+not valid;/);
  assert.match(code, /add constraint rooms_photo_url_check\s+check \(photo_url is null or \(char_length\(photo_url\) <= 2048 and photo_url ~\* '\^https:\/\/\[\^\[:space:\]"''<>`\\\\\]\+\$'\)\)\s+not valid;/);
  assert.strictEqual((code.match(/not valid;/g) || []).length, 3, "les trois contraintes sont créées NOT VALID");
  assert.match(code, /if nb = 0 then\s+execute format\('alter table public\.rooms validate constraint %I', c\.name\);/, "validation seulement si aucune ligne ne viole");
  assert.ok(!/\b(update|delete from|insert into|truncate|drop table|drop column)\b/i.test(code.replace(/drop constraint if exists/gi, "")), "aucune donnée modifiée");
  assert.match(code, /^begin;$/m);
  assert.match(code, /^commit;$/m);
});

test("009 : les valeurs de couleur produites par le code (salons de départ, création dans les pages) passent la contrainte", () => {
  const code = stripComments(read("009_salons_champs_valides.sql"));
  const src = code.match(/color ~ '(\^#[^']+\$)'/)[1];
  const re = new RegExp(src);
  const schema = fs.readFileSync(path.join(__dirname, "..", "supabase-schema.sql"), "utf8");
  const seed = schema.slice(schema.indexOf("insert into public.rooms (id, name, emoji, color, is_group) values"));
  const colors = (seed.slice(0, seed.indexOf("on conflict")).match(/'#[0-9A-Fa-f]+'/g) || []).map((c) => c.slice(1, -1));
  assert.ok(colors.length >= 3, "salons de départ trouvés");
  const pages = ["discussions.html", "admin/rooms.html"].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
  (pages.match(/color: "#[0-9A-Fa-f]+"|\|\| "#[0-9A-Fa-f]+"|value="#[0-9A-Fa-f]+"/g) || []).forEach((m) => colors.push(m.match(/#[0-9A-Fa-f]+/)[0]));
  assert.ok(colors.length >= 6);
  colors.forEach((c) => assert.ok(re.test(c), "couleur du code refusée par la contrainte : " + c));
  ["red", 'x" onmouseover="1', "#12", "#GGGGGG"].forEach((c) => assert.ok(!re.test(c), "couleur piégée acceptée : " + c));
});

test("009 : retour arrière, requête de lecture seule et script de nettoyage à valider", () => {
  const rb = read("rollback/009_salons_champs_valides.sql");
  assert.match(rb.split("\n")[0], /^-- ⚠️ ATTENTION/);
  ["rooms_color_hex_check", "rooms_emoji_safe_check", "rooms_photo_url_check"].forEach((n) => assert.ok(stripComments(rb).includes("drop constraint if exists " + n), n));
  assert.ok(!/update|delete from|truncate/i.test(stripComments(rb)));

  const ro = stripComments(read("a_valider/009_salons_violations_lecture_seule.sql"));
  assert.match(ro.trim(), /^select/i);
  assert.ok(!/\b(update|delete|insert|alter|drop|create|truncate|grant)\b/i.test(ro), "requête strictement en lecture seule");

  const raw = read("a_valider/009_salons_nettoyage.sql");
  const clean = stripComments(raw);
  assert.match(clean, /^begin;$/m);
  assert.match(clean.trim(), /rollback;$/, "s'annule par défaut : à remplacer par commit après relecture");
  assert.ok(!/^commit;$/m.test(clean), "aucun commit par défaut");
  assert.ok(!/delete from|truncate|drop /i.test(clean), "aucune suppression de salon ni de message");
  assert.ok(!/\bset\s+name\b|name\s*=/.test(clean.replace(/relname/g, "")), "les noms ne sont pas touchés");
});

test("les fichiers SQL sont exclus du déploiement Vercel", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".vercelignore"), "utf8");
  assert.match(ignore, /^migrations\/?$/m);
});

console.log("\n" + passed + " test(s) réussi(s)");
