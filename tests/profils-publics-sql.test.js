/* Garde-fous statiques de profils-publics.sql, de son retour arrière et de son SQL de vérification (PR 1 du profil public).
   Lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté. Le comportement réel (droits par colonne, RLS, garde) est éprouvé
   sur un PostgreSQL local jetable (voir la description de la PR). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const FILES = ["profils-publics.sql", "profils-publics-rollback.sql", "profils-publics-verification.sql"];
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read(FILES[0]), sql = strip(raw);
const rbRaw = read(FILES[1]), rb = strip(rbRaw);
const vRaw = read(FILES[2]), v = strip(vRaw);

function blocks(text) {
  const parts = text.split(/^-- BLOC (\d+) - /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}
const fn = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const FUNCTIONS = ["profils_publics_ouvert", "profils_publics_adresse_reservee", "profils_publics_garde", "profil_public_mien", "profil_public_adresse_disponible",
  "profil_public_statut", "profil_public_lire", "profils_publics_admin_lister", "profils_publics_admin_lire", "profils_publics_admin_suspendre", "profils_publics_admin_adresse"];

test("blocs numérotés 1 à 11, courts, listés dans la note de tête ; rollback 1 à 3", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 130, "bloc " + x.n + " trop long"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 - "));
  for (let n = 1; n <= 11; n++) assert.ok(new RegExp("--   BLOC " + n + "\\s+-").test(head), "note de tête : bloc " + n);
  assert.deepStrictEqual(blocks(rbRaw).map((x) => x.n), [1, 2, 3]);
});

test("collage mobile : $$ jamais $function$, aucun %rowtype / %type, aucune apostrophe dans les commentaires, commentaires avant les instructions", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t), f + " : $function$");
    assert.ok(!/%rowtype|%type/i.test(t), f + " : %rowtype / %type");
    t.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire");
      else assert.ok(!/\S.*\s--\s/.test(line.replace(/'[^']*'/g, "''")), f + ":" + (i + 1) + " commentaire au milieu d'une instruction");
    });
  });
  FUNCTIONS.forEach((f) => assert.ok(!/--/.test(fn(f)), f + " : aucun commentaire dans le corps"));
  assert.ok(/\brecord\b/.test(fn("profil_public_adresse_disponible")), "variables en record");
});

test("aucun secret, e-mail, numéro réel ou nom réel dans les trois fichiers", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t), f + " : e-mail");
    assert.ok(!/\+?\d[\d ]{8,}\d/.test(t.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "")), f + " : numéro");
    assert.ok(!/(sk_live|sk_sandbox|eyJ)/.test(t));
  });
});

test("additif : aucune table existante modifiée ; ne touche ni profiles, ni paiements, ni Institut", () => {
  [sql, rb].forEach((t) => {
    assert.ok(!/alter table public\.(profiles|purchases|formations|messages|rooms|institut_\w+)/i.test(t));
    assert.ok(!/(insert into|update|delete from) public\.(profiles|purchases|institut_\w+)/i.test(t));
    assert.ok(!/institut_paiements|institut_demandes|institut_places/.test(t));
  });
  assert.ok(!/create or replace function public\.is_admin|create or replace function public\.is_reserved_username/.test(sql), "réutilise, ne redéfinit pas");
  assert.match(sql, /public\.is_reserved_username\(p_adresse\)/);
});

test("table profils_publics : colonnes demandées, id propre à la page, user_id unique, adresse unique", () => {
  const t = /create table if not exists public\.profils_publics \([\s\S]*?\n\);/.exec(sql)[0];
  ["id uuid primary key default gen_random_uuid()", "user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade", "adresse text not null unique",
    "nom_affiche text not null", "avatar_url text", "metier text", "presentation text", "localisation text", "contact_type text", "contact_valeur text",
    "publie boolean not null default false", "majeur_declare boolean not null default false", "suspendu boolean not null default false",
    "cree_le timestamptz", "modifie_le timestamptz"].forEach((c) => assert.ok(t.includes(c), c));
});

test("contraintes de format : adresse, nom, photo https, longueurs, un seul contact cohérent, majorité exigée pour publier", () => {
  assert.match(sql, /adresse ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,28\}\[a-z0-9\]\$'/);
  assert.match(sql, /char_length\(btrim\(nom_affiche\)\) between 1 and 60/);
  assert.match(sql, /avatar_url ~ '\^https:\/\/[^']*' and char_length\(avatar_url\) <= 500/);
  assert.match(sql, /char_length\(metier\) <= 80/); assert.match(sql, /char_length\(presentation\) <= 280/); assert.match(sql, /char_length\(localisation\) <= 60/);
  const c = /add constraint profils_publics_contact_check\s+check \(coalesce\(([\s\S]*?), false\)\);/.exec(sql);
  assert.ok(c, "contrainte de contact protégée contre NULL (coalesce)");
  assert.ok(c[1].includes("contact_type is null and contact_valeur is null") && c[1].includes("contact_type = 'whatsapp'") && c[1].includes("contact_type = 'lien'"));
  assert.match(sql, /contact_valeur ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/);
  assert.match(sql, /check \(not publie or majeur_declare\)/);
});

test("interrupteur : table de réglages, ouvert = non par défaut, lecture publique, écriture admin, fonction qui le lit", () => {
  assert.match(sql, /insert into public\.profils_publics_reglages \(cle, valeur\) values \('ouvert', 'non'\) on conflict \(cle\) do nothing;/);
  assert.match(sql, /check \(cle = 'ouvert' and valeur in \('oui', 'non'\)\)/);
  assert.match(sql, /grant select on public\.profils_publics_reglages to anon, authenticated;/);
  assert.match(sql, /grant insert, update on public\.profils_publics_reglages to authenticated;/);
  const pol = [...sql.matchAll(/create policy "(\w+)" on public\.profils_publics_reglages\s+for (\w+)/g)].map((m) => m[1] + ":" + m[2]);
  assert.deepStrictEqual(pol, ["profils_publics_reglages_lecture:select", "profils_publics_reglages_admin_insert:insert", "profils_publics_reglages_admin_update:update"]);
  assert.match(fn("profils_publics_ouvert"), /coalesce\(\(select r\.valeur = 'oui'[\s\S]*, false\)/);
});

test("AUCUNE lecture directe pour anon : pas de droit sur la table, pas de politique de lecture publique ; authenticated ne lit que la colonne id", () => {
  assert.match(sql, /revoke all on public\.profils_publics from anon, authenticated;/);
  assert.ok(!/grant [^;]*on public\.profils_publics to [^;]*\banon\b/i.test(sql), "aucun droit pour anon sur la table");
  assert.ok(!/profils_publics_lecture_publique" on public\.profils_publics\s+for/.test(sql), "aucune politique de lecture publique");
  assert.match(sql, /drop policy if exists "profils_publics_lecture_publique" on public\.profils_publics;/, "l'ancienne politique est supprimée si elle existe");
  const sel = /grant select \(([^)]*)\)\s+on public\.profils_publics to (\w+(?:, \w+)*);/.exec(sql);
  assert.ok(sel);
  assert.deepStrictEqual([sel[1].trim(), sel[2]], ["id", "authenticated"], "seule la colonne id, seulement pour authenticated");
  ["insert", "update"].forEach((op) => {
    const g = new RegExp("grant " + op + " \\(([^)]*)\\)\\s+on public\\.profils_publics to authenticated;").exec(sql);
    assert.ok(g, op);
    const c = g[1].split(",").map((x) => x.trim());
    ["suspendu", "user_id", "publie_le", "id", "cree_le", "modifie_le"].forEach((x) => assert.ok(!c.includes(x), op + " : " + x));
    assert.ok(c.includes("majeur_declare") && c.includes("publie") && c.includes("adresse"));
  });
  assert.ok(!/grant (all|delete)/i.test(sql));
  assert.match(sql, /alter table public\.profils_publics enable row level security;/);
});

test("profil_public_lire : UNE page par adresse exacte, security definer, publiée + non suspendue + ouverte, aucune colonne sensible, aucune recherche partielle", () => {
  const f = fn("profil_public_lire");
  assert.match(f, /returns table \(id uuid, adresse text, nom_affiche text, avatar_url text, metier text, presentation text,\s+localisation text, contact_type text, contact_valeur text\)/);
  assert.ok(/security definer/.test(f) && /set search_path = public, pg_temp/.test(f));
  assert.match(f, /where p_adresse ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,28\}\[a-z0-9\]\$'/);
  assert.match(f, /and p\.adresse = p_adresse/);
  assert.match(f, /and p\.publie\s+and not p\.suspendu\s+and public\.profils_publics_ouvert\(\)\s+limit 1;/);
  ["user_id", "majeur_declare", "suspendu", "publie_le", "cree_le", "modifie_le"].forEach((c) => assert.ok(!new RegExp("\\bp\\." + c + "\\b").test(f.replace(/and not p\.suspendu/, "")) && !new RegExp("," + " " + c).test(f.split("language sql")[0]), c + " jamais renvoyé"));
  assert.ok(!/like|ilike|similar|~\*|%|position\(|strpos|starts_with/i.test(f.replace(/'\^\[a-z0-9\]\[a-z0-9-\]\{1,28\}\[a-z0-9\]\$'/, "")), "aucune recherche partielle");
  assert.match(sql, /revoke all on function public\.profil_public_lire\(text\) from public;\s+grant execute on function public\.profil_public_lire\(text\) to anon, authenticated;/);
});

test("règles RLS : propriétaire et admin seulement (lecture, mise à jour), insertion propriétaire ; aucune politique pour anon ni de suppression", () => {
  const pols = [...sql.matchAll(/create policy "(\w+)" on public\.profils_publics\s+for (\w+) to (anon, authenticated|authenticated)\b/g)].map((m) => [m[1], m[2], m[3].trim()]);
  assert.deepStrictEqual(pols, [["profils_publics_proprietaire_select", "select", "authenticated"],
    ["profils_publics_admin_select", "select", "authenticated"], ["profils_publics_proprietaire_insert", "insert", "authenticated"],
    ["profils_publics_proprietaire_update", "update", "authenticated"], ["profils_publics_admin_update", "update", "authenticated"]]);
  assert.match(sql, /for select to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /for insert to authenticated with check \(user_id = auth\.uid\(\)\)/);
  assert.ok(!/for delete/.test(sql));
});

test("garde : adresse figée dès la première publication (sauf admin), majorité, suspendu réservé, propriétaire figé, dates tenues à jour", () => {
  const g = fn("profils_publics_garde");
  assert.match(g, /v_serveur boolean := \(auth\.uid\(\) is null\) or \(coalesce\(auth\.role\(\), ''\) = 'service_role'\)/);
  assert.match(g, /v_admin := v_serveur or public\.is_admin\(\)/);
  assert.match(g, /new\.modifie_le := now\(\)/);
  assert.match(g, /if new\.publie and not new\.majeur_declare then\s+raise exception/);
  assert.match(g, /if new\.suspendu is distinct from old\.suspendu then\s+raise exception/);
  assert.match(g, /if old\.publie_le is not null then\s+raise exception 'Une fois la page publiee/);
  assert.match(g, /new\.id is distinct from old\.id or new\.user_id is distinct from old\.user_id/);
  assert.match(g, /profils_publics_adresse_reservee\(new\.adresse\)/);
  assert.ok(/if not v_admin then[\s\S]*if new\.suspendu then/.test(g), "insertion : suspendu refusé aux non-admins");
  assert.match(sql, /create trigger profils_publics_garde_trg\s+before insert or update on public\.profils_publics\s+for each row execute function public\.profils_publics_garde\(\);/);
});

test("adresses réservées : liste fixe (admin, api, support, mahouto, majeste, institut…) puis liste des pseudos réservés", () => {
  const f = fn("profils_publics_adresse_reservee");
  ["admin", "api", "support", "mahouto", "majeste", "institut"].forEach((a) => assert.ok(f.includes("'" + a + "'"), a));
  assert.match(f, /replace\(coalesce\(p_adresse, ''\), '-', ''\)/);
  assert.match(f, /public\.is_reserved_username\(p_adresse\) or public\.is_reserved_username\(v_sans_tirets\)/);
});

test("fonctions : security definer + search_path fixé pour celles qui lisent hors RLS ; droits retirés à public ; anon exclu des fonctions du propriétaire et des admins", () => {
  ["profil_public_mien", "profil_public_adresse_disponible", "profil_public_statut", "profil_public_lire", "profils_publics_admin_lister", "profils_publics_admin_lire", "profils_publics_admin_suspendre", "profils_publics_admin_adresse"].forEach((f) => {
    const b = fn(f);
    assert.ok(/security definer/.test(b) && /set search_path = public, pg_temp/.test(b), f);
  });
  FUNCTIONS.filter((f) => f !== "profils_publics_garde").forEach((f) => assert.match(sql, new RegExp("revoke all on function public\\." + f + "\\([^)]*\\) from public")));
  ["profil_public_mien()", "profil_public_adresse_disponible(text)", "profils_publics_admin_lister()", "profils_publics_admin_lire(text)", "profils_publics_admin_suspendre(uuid, boolean)", "profils_publics_admin_adresse(uuid, text)"].forEach((f) => {
    assert.match(sql, new RegExp("revoke all on function public\\." + f.replace(/[()]/g, "\\$&") + " from public, anon;"));
    assert.match(sql, new RegExp("grant execute on function public\\." + f.replace(/[()]/g, "\\$&") + " to authenticated;"));
  });
  assert.match(sql, /grant execute on function public\.profil_public_statut\(text\) to anon, authenticated;/);
  assert.ok(!/suspendu/.test(fn("profil_public_mien")), "la fonction du propriétaire ne renvoie jamais suspendu");
  ["profils_publics_admin_lister", "profils_publics_admin_lire", "profils_publics_admin_suspendre", "profils_publics_admin_adresse"].forEach((f) => assert.match(fn(f), /if not public\.is_admin\(\) then\s+raise exception/));
});

test("rollback : confirmation 'NON', perte signalée, ne touche ni profiles ni les pseudos réservés ; vérification : lecture seule et complète", () => {
  assert.match(rb, /confirmation constant text := 'NON'/);
  assert.match(rb, /raise exception 'Retour arriere NON confirme/);
  assert.match(rbRaw, /IRREVERSIBLE/);
  assert.match(rb, /drop table if exists public\.profils_publics;/); assert.match(rb, /drop table if exists public\.profils_publics_reglages;/);
  FUNCTIONS.forEach((f) => assert.ok(rb.includes("drop function if exists public." + f + "("), f));
  assert.ok(!/profiles|reserved_usernames|is_reserved_username/.test(rb));
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.replace(/'[^']*'/g, "''")), "vérification en lecture seule");
  ["has_column_privilege", "pg_policies", "pg_constraint", "relrowsecurity", "has_function_privilege", "pg_trigger"].forEach((k) => assert.ok(v.includes(k), k));
  assert.match(v, /has_column_privilege\('anon'/); assert.ok(v.includes("'public.profil_public_lire(text)'") && v.includes("profils_publics_lecture_publique"), "contrôles de lecture publique supprimée");
  assert.ok(rb.includes("drop function if exists public.profil_public_lire(text);") && rb.includes("drop function if exists public.profils_publics_admin_lire(text);"));
});
