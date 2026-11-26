/* Profil public : ALIAS d'adresse (profils-publics-alias.sql + rollback + vérification, api/_profil-og.js, api/produit-og.js,
   admin/profils-publics.html et .js, sw.js). Lecture statique des fichiers SQL (jamais exécutés ici), code serveur avec faux res,
   interface d'administration en faux DOM. Aucun réseau. Les scénarios SQL réels ont été joués sur une base PostgreSQL locale jetable
   (voir la description de la PR). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PU = require("../profil-public-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));
const squash = (t) => t.replace(/\s+/g, " ").trim();

// ====================== SQL ======================
const FILES = ["profils-publics-alias.sql", "profils-publics-alias-rollback.sql", "profils-publics-alias-verification.sql"];
const raw = read(FILES[0]), rawRb = read(FILES[1]), rawVf = read(FILES[2]);
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(raw), sqlRb = strip(rawRb), sqlVf = strip(rawVf);
const blocs = (t) => { const parts = t.split(/^-- BLOC (\d+) - /m), out = {}; for (let i = 1; i < parts.length; i += 2) out[Number(parts[i])] = parts[i + 1]; return out; };
const B = blocs(raw), BR = blocs(rawRb);
const fn = (text, name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(text); assert.ok(m, name); return m[0]; };
const ORIGINAL = strip(read("profils-publics.sql"));

test("SQL : 8 blocs courts numérotés, déclencheur activé EN DERNIER, rollback en 4 blocs", () => {
  assert.deepStrictEqual(Object.keys(B).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]); assert.deepStrictEqual(Object.keys(BR).map(Number), [1, 2, 3, 4]);
  assert.ok(/create trigger profils_publics_alias_garde_trg/.test(B[8]) && Object.keys(B).slice(0, 7).every((k) => !/create trigger/.test(B[k])), "le déclencheur n'est créé que dans le dernier bloc");
  assert.ok(raw.indexOf("create or replace function public.profils_publics_alias_garde()") < raw.indexOf("create trigger"));
});

test("SQL : règles de l'éditeur mobile ($$ jamais $function$, record, pas de %rowtype, LIKE, regex, POSIX, lignes ≤ 105, commentaires sans apostrophe, ASCII)", () => {
  FILES.forEach((f) => {
    const t = read(f); assert.ok(!/\$function\$/.test(t), f); assert.ok(!/%rowtype|%type/i.test(t), f);
    const s = strip(t).split("\n").filter((l) => l.trim() !== "if p_adresse is null or p_adresse !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then").join("\n"); // la courte regex EXISTANTE de profil_public_adresse_disponible est conservée telle quelle
    assert.ok(!/\blike\b|\bilike\b|similar to/i.test(s), f + " : LIKE"); assert.ok(!/ !?~\*? |\[\[:|regexp_/i.test(s), f + " : regex ou POSIX");
    t.split("\n").forEach((l, i) => { assert.ok(l.length <= 105, f + ":" + (i + 1) + " : " + l.length); if (l.trim().startsWith("--")) assert.ok(!/'/.test(l), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
    assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(t), f + " : caractères non ASCII");
  });
  assert.match(fn(sql, "profils_publics_admin_alias_ajouter"), /v_page record;/, "record");
});

test("SQL : table profils_publics_alias — alias clé primaire, page_id → profils_publics on delete cascade, cree_le, cree_par ; RLS SANS politique, aucun droit direct", () => {
  const t = B[2];
  assert.match(t, /create table if not exists public\.profils_publics_alias \(\s*alias text primary key,\s*page_id uuid not null references public\.profils_publics\(id\) on delete cascade,\s*cree_le timestamptz not null default now\(\),\s*cree_par uuid,/);
  assert.match(t, /alter table public\.profils_publics_alias enable row level security;/);
  assert.match(t, /revoke all on public\.profils_publics_alias from public;/); assert.match(t, /revoke all on public\.profils_publics_alias from anon, authenticated;/);
  assert.ok(!/create policy[^;]*profils_publics_alias/i.test(sql), "AUCUNE politique"); assert.ok(!/grant (select|insert|update|delete|all)[^;]*profils_publics_alias/i.test(sql), "aucun droit direct");
  assert.match(t, /create index if not exists profils_publics_alias_page_idx/);
});

test("SQL : fonctions — security definer + search_path ; admin : refus immédiat si pas is_admin ; internes sans droit client ; grants des fonctions publiques identiques à profil_public_lire", () => {
  ["profils_publics_alias_pris", "profils_publics_alias_garde", "profils_publics_admin_alias_ajouter", "profils_publics_admin_alias_retirer", "profils_publics_admin_alias_lister", "profil_public_alias_resoudre", "profil_public_adresse_disponible"].forEach((n) => {
    const f = fn(sql, n); assert.match(f, /security definer/, n); assert.match(f, /set search_path = public, pg_temp/, n);
  });
  ["profils_publics_admin_alias_ajouter", "profils_publics_admin_alias_retirer", "profils_publics_admin_alias_lister"].forEach((n) => {
    const f = fn(sql, n); const first = f.slice(f.indexOf("begin")); assert.match(first, /begin\s+(declare[\s\S]*?begin\s+)?if not public\.is_admin\(\) then/, n + " : is_admin avant tout"); });
  assert.ok(fn(sql, "profils_publics_admin_alias_ajouter").indexOf("is_admin()") < fn(sql, "profils_publics_admin_alias_ajouter").indexOf("insert into"));
  assert.ok(sql.includes("revoke all on function public.profils_publics_alias_pris(text) from public, anon, authenticated;") && sql.includes("revoke all on function public.profils_publics_alias_garde() from public, anon, authenticated;"));
  assert.ok(!/grant execute on function public\.profils_publics_alias_(pris|garde)/.test(sql), "aucun grant aux fonctions internes");
  [["profils_publics_admin_alias_ajouter", "(text, text)"], ["profils_publics_admin_alias_retirer", "(text)"], ["profils_publics_admin_alias_lister", "()"]].forEach(([n, a]) => {
    assert.ok(sql.includes("revoke all on function public." + n + a + " from public, anon;"), n); assert.ok(sql.includes("grant execute on function public." + n + a + " to authenticated;"), n); });
  // mêmes droits que profil_public_lire (relus dans le dépôt : revoke public, grant anon + authenticated)
  assert.ok(ORIGINAL.includes("revoke all on function public.profil_public_lire(text) from public;") && ORIGINAL.includes("grant execute on function public.profil_public_lire(text) to anon, authenticated;"));
  assert.ok(sql.includes("revoke all on function public.profil_public_alias_resoudre(text) from public;") && sql.includes("grant execute on function public.profil_public_alias_resoudre(text) to anon, authenticated;"));
  assert.strictEqual((sql.match(/grant execute/g) || []).length, 5, "5 grants : 3 admin, 1 résolution, 1 adresse_disponible (comme avant)");
  assert.ok(!/grant execute[^;]*to[^;]*\banon\b/.test(sql.replace("grant execute on function public.profil_public_alias_resoudre(text) to anon, authenticated;", "")), "anon : seulement la résolution");
});

test("SQL : alias_ajouter — codes (ok, invalide, reserve, deja_pris, page_introuvable, limite, non_admin), normalisation, réutilise adresse_valide et adresse_reservee, verrou advisory, limite 5", () => {
  const f = fn(sql, "profils_publics_admin_alias_ajouter");
  ["ok", "invalide", "reserve", "deja_pris", "page_introuvable", "limite", "non_admin"].forEach((c) => assert.ok(f.includes("return '" + c + "'"), c));
  assert.match(f, /public\.profils_publics_adresse_valide\(v_alias\)/); assert.match(f, /public\.profils_publics_adresse_reservee\(v_alias\)/);
  assert.match(f, /lower\(btrim\(coalesce\(p_alias, ''\)\)\)/); assert.match(f, /pg_advisory_xact_lock\(hashtextextended\('ppa:' \|\| v_alias, 0\)\)/);
  assert.match(f, /exists \(select 1 from public\.profils_publics p where p\.adresse = v_alias\)\s+or exists \(select 1 from public\.profils_publics_alias a where a\.alias = v_alias\)/, "unicité croisée côté alias");
  assert.match(f, /if v_n >= 10 then|if v_n >= 5 then/); assert.match(f, /if v_n >= 5 then\s+return 'limite'/); assert.ok(!/if v_n >= 10/.test(f));
  assert.match(f, /insert into public\.profils_publics_alias \(alias, page_id, cree_par\)\s+values \(v_alias, v_page\.id, auth\.uid\(\)\)/);
  const order = ["non_admin", "invalide", "reserve", "deja_pris", "page_introuvable", "limite", "insert into"].map((k) => f.indexOf(k)); assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b), "ordre des contrôles");
  const r = fn(sql, "profils_publics_admin_alias_retirer"); ["ok", "absent", "non_admin"].forEach((c) => assert.ok(r.includes("return '" + c + "'"), c)); assert.match(r, /delete from public\.profils_publics_alias a\s+where a\.alias = /);
  const l = fn(sql, "profils_publics_admin_alias_lister"); assert.match(l, /returns table \(alias text, adresse text, cree_le timestamptz\)/); assert.match(l, /if not public\.is_admin\(\) then\s+return;/, "pas administrateur = aucune ligne"); assert.ok(!/user_id|cree_par/.test(l), "ni user_id ni cree_par");
});

test("SQL : unicité croisée côté adresse principale — NOUVEAU déclencheur séparé (le déclencheur existant n'est pas modifié), verrou advisory, message existant (23505)", () => {
  const g = fn(sql, "profils_publics_alias_garde");
  assert.match(g, /if tg_op = 'UPDATE' and new\.adresse is not distinct from old\.adresse then\s+return new;/, "ne fait rien si l'adresse ne change pas");
  assert.match(g, /pg_advisory_xact_lock\(hashtextextended\('ppa:' \|\| coalesce\(new\.adresse, ''\), 0\)\)/, "même clé de verrou que alias_ajouter");
  assert.match(g, /exists \(select 1 from public\.profils_publics_alias a where a\.alias = new\.adresse\)/); assert.match(g, /using errcode = '23505'/);
  assert.ok(g.indexOf("pg_advisory_xact_lock") < g.indexOf("exists (select 1"), "verrou avant la vérification");
  assert.match(B[8], /create trigger profils_publics_alias_garde_trg\s+before insert or update of adresse on public\.profils_publics\s+for each row execute function public\.profils_publics_alias_garde\(\);/);
  assert.strictEqual((sql.match(/create trigger/g) || []).length, 1); assert.ok(!/after (insert|update|delete)|before delete/i.test(sql));
  assert.ok(!/create or replace function public\.profils_publics_garde\(/.test(sql + sqlRb), "le garde existant n'est ni recréé ni modifié");
  assert.ok(!/drop trigger[^;]*profils_publics_garde_trg/.test(sql + sqlRb));
  assert.match(read("profil-public-utils.js"), /if \(code === "23505"\) return "Cette adresse est déjà prise/, "le client affiche déjà ce message pour 23505");
});

test("SQL : profil_public_adresse_disponible = version actuelle + UN seul ajout (alias → prise) ; même signature et même type de retour", () => {
  const f = fn(sql, "profil_public_adresse_disponible"), o = fn(ORIGINAL, "profil_public_adresse_disponible");
  const added = "  if public.profils_publics_alias_pris(p_adresse) then\n    return 'prise';\n  end if;\n  if public.profils_publics_adresse_reservee";
  const expected = o.replace("  if public.profils_publics_adresse_reservee", added); assert.notStrictEqual(expected, o);
  assert.strictEqual(squash(f), squash(expected)); assert.match(f, /returns text/);
  assert.strictEqual(squash(fn(sqlRb, "profil_public_adresse_disponible")), squash(o), "le rollback remet la version d'origine");
  ["invalide", "libre", "prise", "reservee"].forEach((c) => assert.ok(f.includes("return '" + c + "'"), c));
});

test("SQL : résolution publique — l'adresse principale seulement, page publiée + non suspendue + interrupteur ouvert, jamais user_id ni autre donnée", () => {
  const f = fn(sql, "profil_public_alias_resoudre");
  assert.match(f, /returns text/); assert.match(f, /select p\.adresse\s+from public\.profils_publics_alias a\s+join public\.profils_publics p on p\.id = a\.page_id/);
  assert.match(f, /public\.profils_publics_adresse_valide\(p_alias\)/); assert.match(f, /a\.alias = p_alias/); assert.match(f, /and p\.publie\s+and not p\.suspendu\s+and public\.profils_publics_ouvert\(\)/);
  assert.ok(!/user_id|cree_par|nom_affiche|contact|id\b.*returns/i.test(f.replace("page_id", "").replace("p.id", "")), "aucune autre donnée");
  assert.strictEqual((f.match(/select p\.\w+/g) || []).join(), "select p.adresse");
});

test("SQL : aucune politique RLS modifiée, aucune donnée supprimée ni modifiée, aucune fonction existante recréée (hors adresse_disponible)", () => {
  assert.ok(!/(create|alter|drop) policy/i.test(sql + sqlRb), "aucune politique");
  assert.ok(!/(update\s+public\.profils_publics\b|delete\s+from\s+public\.profils_publics\b|truncate|alter table public\.profils_publics\b)/i.test(sql + sqlRb), "aucune donnée ni structure de profils_publics touchée");
  const created = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(created, ["profil_public_adresse_disponible", "profil_public_alias_resoudre", "profils_publics_admin_alias_ajouter", "profils_publics_admin_alias_lister", "profils_publics_admin_alias_retirer", "profils_publics_alias_garde", "profils_publics_alias_pris"]);
  ["profil_public_lire", "profil_public_signaler", "profil_public_ecrire", "profil_public_messages_ouverts", "profil_public_messages_mien", "profil_public_visites_mien", "profil_public_statut", "profil_public_mien"].forEach((n) => assert.ok(!sql.includes("function public." + n + "("), n + " non modifiée"));
});

test("rollback : BLOC 1 = retrait IMMÉDIAT du déclencheur (une instruction, sans confirmation) ; BLOC 2 version d'origine ; BLOC 3 fonctions ; BLOC 4 table avec confirmation", () => {
  assert.strictEqual(squash(BR[1].replace(/^[\s\S]*?\n(?=drop trigger)/, "").split("\n\n")[0]), "drop trigger if exists profils_publics_alias_garde_trg on public.profils_publics;");
  assert.ok(!/confirmation :=|constant text|raise exception|\bdo \$\$/.test(BR[1]), "sans confirmation");
  ["profil_public_alias_resoudre()", "profils_publics_admin_alias_lister()", "profils_publics_admin_alias_retirer(text)", "profils_publics_admin_alias_ajouter(text, text)", "profils_publics_alias_garde()", "profils_publics_alias_pris(text)"].forEach((n) => assert.ok(BR[3].includes("drop function if exists public." + n.replace("resoudre()", "resoudre(text)") + ";"), n));
  assert.match(BR[4], /confirmation constant text := 'NON'/); assert.ok(BR[4].indexOf("raise exception") < BR[4].indexOf("drop table")); assert.ok(!/drop table[^;]*profils_publics\b[^_]/.test(sqlRb) && !/delete from|truncate/i.test(sqlRb));
  assert.ok(raw.includes("drop trigger if exists profils_publics_alias_garde_trg on public.profils_publics;") && raw.includes("RETRAIT IMMEDIAT"));
});

test("vérification : UNE requête de verdict (colonnes booléennes), lecture seule", () => {
  const first = sqlVf.split(/;\s*\n/)[0]; assert.match(first, /^\s*select\s+coalesce/); assert.ok(!/^\s*(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b/im.test(sqlVf));
  const cols = [...first.matchAll(/\bas (\w+)(?=,|\s*$)/g)].map((m) => m[1]);
  ["table_avec_rls", "table_sans_politique", "aucun_droit_direct", "suppression_en_cascade", "fonctions_internes_sans_droit_client", "fonctions_admin_membres_connectes_seulement", "resolution_memes_droits_que_lire", "six_fonctions_definer_search_path",
    "resolution_sans_user_id", "ajouter_admin_et_limite_5", "declencheur_alias_actif", "declencheur_existant_intact", "fonction_garde_existante_non_modifiee", "adresse_disponible_voit_les_alias", "profil_public_lire_non_modifiee"].forEach((c) => assert.ok(cols.includes(c), c));
  assert.ok(cols.length >= 16);
});

// ====================== serveur : aperçu et redirection ======================
const { handleProfilPreview } = (() => { let src = read("api/_profil-og.js").replace(/^import .*$/m, 'const cloudinaryImageParts = () => null;').replace(/export (const|function|async function)/g, "$1"); const sb = { URL, encodeURIComponent }; vm.runInNewContext(src + "\nthis.handleProfilPreview = handleProfilPreview;", sb); return sb; })();
function fakeRes() { const r = { headers: {}, code: null, body: "", setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } }; return r; }
const ROW = (adresse) => ({ id: "p1", adresse, nom_affiche: "Atelier Sérigraphe", avatar_url: null, metier: "Sérigraphe", presentation: "Texte", localisation: "Cotonou", contact_type: "whatsapp", contact_valeur: "+22900000000" });
function deps(o) {
  const opts = Object.assign({ pages: { serigraphe: ROW("serigraphe") }, alias: { imprimeur: "serigraphe" }, aliasError: false, pageError: null }, o || {}), calls = [];
  const d = { calls, fetchProfil: async (a) => { calls.push(["profil", a]); if (opts.pageError === a) return { row: null, error: new Error("x") }; return { row: opts.pages[a] || null, error: null }; } };
  if (!opts.noAlias) d.fetchAlias = async (a) => { calls.push(["alias", a]); return opts.aliasError ? { adresse: null, error: new Error("x") } : { adresse: Object.prototype.hasOwnProperty.call(opts.alias, a) ? opts.alias[a] : null, error: null }; };
  return d;
}
const run = async (adresse, d, src) => { const res = fakeRes(); await handleProfilPreview({ query: { adresse, src } }, res, d); return res; };

test("serveur : une adresse qui est déjà une page ne déclenche AUCUNE résolution d'alias (une seule lecture)", async () => {
  const d = deps(); const res = await run("serigraphe", d); assert.deepStrictEqual(d.calls, [["profil", "serigraphe"]]); assert.strictEqual(res.code, 200);
  assert.match(res.body, /<title>Atelier Sérigraphe — MAHOUTO\+<\/title>/); assert.match(res.body, /og:url" content="https:\/\/mahouto\.com\/m\/serigraphe"/);
});

test("serveur : un alias → aperçu de la page PRINCIPALE, lien canonique et redirection vers /m.html?adresse=<principale>&src=… (la source est conservée)", async () => {
  const d = deps(); const res = await run("imprimeur", d, "qr");
  assert.deepStrictEqual(d.calls, [["profil", "imprimeur"], ["alias", "imprimeur"], ["profil", "serigraphe"]]); assert.strictEqual(res.code, 200);
  assert.match(res.body, /<title>Atelier Sérigraphe — MAHOUTO\+<\/title>/); assert.match(res.body, /og:url" content="https:\/\/mahouto\.com\/m\/serigraphe"/); assert.ok(!res.body.includes("/m/imprimeur"), "l'alias n'apparaît pas dans l'aperçu");
  assert.match(res.body, /window\.location\.replace\("https:\/\/mahouto\.com\/m\.html\?adresse=serigraphe&src=qr"\)/);
  assert.strictEqual(res.headers["X-Robots-Tag"], "noindex, nofollow"); assert.match(res.body, /<meta name="robots" content="noindex, nofollow">/);
  const sans = await run("imprimeur", deps()); assert.match(sans.body, /adresse=serigraphe/); assert.match(sans.body, /src=partage/, "sans source : déduite comme aujourd'hui");
});

test("serveur : alias absent, non résolu (page non publique), invalide ou principal inconnu → comportement actuel (aperçu générique, noindex, même réponse)", async () => {
  const sans = await run("inconnu-xyz", deps({ noAlias: true })), avec = await run("inconnu-xyz", deps());
  assert.strictEqual(avec.body, sans.body, "alias inconnu : réponse identique à celle d'avant les alias"); assert.strictEqual(avec.code, 200); assert.match(avec.body, /<title>MAHOUTO\+<\/title>/);
  const bad = deps({ alias: { imprimeur: "../x" } }); assert.match((await run("imprimeur", bad)).body, /<title>MAHOUTO\+<\/title>/); assert.deepStrictEqual(bad.calls, [["profil", "imprimeur"], ["alias", "imprimeur"]], "adresse renvoyée invalide : ignorée, aucune lecture");
  const same = deps({ alias: { imprimeur: "imprimeur" } }); assert.match((await run("imprimeur", same)).body, /<title>MAHOUTO\+<\/title>/); assert.strictEqual(same.calls.length, 2, "boucle évitée");
  const gone = deps({ pages: {}, alias: { imprimeur: "serigraphe" } }); const g = await run("imprimeur", gone); assert.match(g.body, /<title>MAHOUTO\+<\/title>/); assert.match(g.body, /adresse=serigraphe/, "principale disparue : générique, redirection humaine vers la principale");
  const invalid = deps(); await run("A", invalid); assert.deepStrictEqual(invalid.calls, [], "adresse invalide : aucune lecture");
});

test("serveur : erreurs de lecture → 503 sans cache, l'humain est quand même redirigé ; l'ancien comportement sans fetchAlias est inchangé", async () => {
  const e1 = await run("imprimeur", deps({ aliasError: true })); assert.strictEqual(e1.code, 503); assert.strictEqual(e1.headers["Cache-Control"], "no-store"); assert.match(e1.body, /adresse=imprimeur/);
  const e2 = await run("imprimeur", deps({ pageError: "serigraphe" })); assert.strictEqual(e2.code, 503); assert.strictEqual(e2.headers["Cache-Control"], "no-store"); assert.match(e2.body, /adresse=serigraphe/);
  const e3 = await run("serigraphe", deps({ pageError: "serigraphe" })); assert.strictEqual(e3.code, 503);
  const sans = deps({ noAlias: true }); const r = await run("serigraphe", sans); assert.strictEqual(r.code, 200); assert.deepStrictEqual(sans.calls, [["profil", "serigraphe"]]);
});

test("serveur : api/produit-og.js — résolution par l'appel RPC profil_public_alias_resoudre avec la clé anonyme ; aucune nouvelle fonction api/ ; site et marque fixes", () => {
  const src = read("api/produit-og.js"); const block = /async function fetchAliasForPreview[\s\S]*?\n}\n/.exec(src)[0];
  assert.match(block, /createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_ANON_KEY\)/); assert.match(block, /rpc\("profil_public_alias_resoudre", \{ p_alias: alias \}\)/);
  assert.ok(!/service_role|SERVICE_ROLE|\.from\(/.test(block), "jamais service_role ni la table"); assert.match(block, /typeof data === "string" \? data : null/);
  assert.match(src, /handleProfilPreview\(req, res, \{ fetchProfil: fetchProfilForPreview, fetchAlias: fetchAliasForPreview, fetchIndexable: fetchIndexableForPreview \}\)/);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
  const og = read("api/_profil-og.js"); assert.match(og, /export const PROFIL_SITE = "https:\/\/mahouto\.com";/); assert.match(og, /export const PROFIL_BRAND = "MAHOUTO\+";/); assert.ok(!/headers\.host|MAHOUTO_BRAND/.test(og));
  const v = JSON.parse(read("vercel.json")); assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/m/:adresse"), { source: "/m/:adresse", destination: "/api/produit-og?type=profil&adresse=:adresse" });
  assert.ok(!fs.readdirSync(root).some((f) => /\.sql$/.test(f) && /alias/.test(f) && !FILES.includes(f)), "aucun autre SQL");
});

test("m.js n'est PAS modifié : une adresse tapée directement dans /m.html?adresse=<alias> n'est pas résolue (limite connue) ; profil_public_lire/statut inchangées", () => {
  assert.ok(!/alias/i.test(read("m.js")) && !/alias/i.test(read("profil-public-utils.js")), "ni m.js ni le module client ne connaissent les alias");
});

// ====================== interface d'administration ======================
function makeEl(id) {
  const el = { id, children: [], attrs: {}, _t: "", classes: new Set(), listeners: {}, value: "", disabled: false, clicks: 0,
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
const cls = (n) => n.className || n.attrs.class;
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const findAll = (r, p) => { const o = []; walk(r, (n) => { if (p(n)) o.push(n); }); return o; };
async function runAdmin(o) {
  const opts = Object.assign({ rows: [{ alias: "imprimeur", adresse: "serigraphe", cree_le: "2026-11-24T10:00:00Z" }, { alias: "graphiste", adresse: "serigraphe", cree_le: "2026-11-24T11:00:00Z" }], confirmAnswer: true, ajouter: "ok", retirer: "ok", listFail: false }, o || {});
  const ids = [...new Set([...read("admin/profils-publics.html").matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))], els = {}; ids.forEach((i) => { els[i] = makeEl(i); });
  ["access-denied", "dashboard", "bandeau-ouvert"].forEach((i) => els[i].classes.add("hidden"));
  const log = { rpc: [], confirm: [], open: [] }, state = { rows: opts.rows.slice() };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: async () => (t === "profiles" ? { data: { role: "admin" }, error: null } : { data: { valeur: "non", maj_le: null }, error: null }), then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) }; return api; },
    rpc: async (n, a) => { log.rpc.push([n, a]);
      if (n === "profils_publics_admin_alias_lister") return opts.listFail ? { data: null, error: { message: "x" } } : { data: state.rows, error: null };
      if (n === "profils_publics_admin_alias_ajouter") { if (opts.ajouter === "ok") state.rows.push({ alias: a.p_alias, adresse: a.p_adresse_page, cree_le: "2026-11-24T12:00:00Z" }); return opts.ajouter === null ? { data: null, error: { message: "x" } } : { data: opts.ajouter, error: null }; }
      if (n === "profils_publics_admin_alias_retirer") { if (opts.retirer === "ok") state.rows = state.rows.filter((r) => r.alias !== a.p_alias); return opts.retirer === null ? { data: null, error: { message: "x" } } : { data: opts.retirer, error: null }; }
      return { data: [], error: null }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open: (...a) => log.open.push(a) };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: { getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }) }, confirm: (m) => { log.confirm.push(m); return opts.confirmAnswer; }, Array, String, Date, setInterval: () => 1 });
  await tick(40); return { els, log, state };
}
const aliasCalls = (d, n) => d.log.rpc.filter((c) => c[0] === n);

test("admin : section « Adresses supplémentaires » — liste (alias → page, date), texte brut, « Voir » dans un nouvel onglet", async () => {
  const d = await runAdmin({ rows: [{ alias: "imprimeur", adresse: "serigraphe", cree_le: "2026-11-24T10:00:00Z" }, { alias: "x<b>y", adresse: "page<i>", cree_le: null }] });
  assert.deepStrictEqual(aliasCalls(d, "profils_publics_admin_alias_lister").length, 1);
  const cards = findAll(d.els["liste-alias"], (n) => cls(n) === "card item"); assert.strictEqual(cards.length, 2);
  assert.strictEqual(findAll(cards[0], (n) => cls(n) === "who")[0].textContent, "/m/imprimeur  →  /m/serigraphe");
  assert.match(findAll(cards[0], (n) => cls(n) === "meta")[0].textContent, /^Ajoutée le 24\/11\/2026$/);
  assert.strictEqual(findAll(cards[1], (n) => cls(n) === "who")[0].textContent, "/m/x<b>y  →  /m/page<i>", "le HTML reste du texte");
  const see = findAll(cards[0], (n) => n.textContent === "Voir")[0]; see.click(); assert.strictEqual(JSON.stringify(d.log.open[0]), JSON.stringify(["/m/imprimeur", "_blank", "noopener"]));
  assert.strictEqual(findAll(cards[1], (n) => n.textContent === "Voir").length, 0, "alias invalide : pas de bouton");
  assert.strictEqual(findAll(cards[0], (n) => n.textContent === "Retirer")[0].attrs["aria-label"], "Retirer l'adresse supplémentaire imprimeur");
  const vide = await runAdmin({ rows: [] }); assert.match(vide.els["liste-alias"].textContent, /Aucune adresse supplémentaire/);
  const ko = await runAdmin({ listFail: true }); assert.match(ko.els["msg-alias"].textContent, /Impossible de charger les adresses supplémentaires/); assert.ok(ko.els["msg-alias"].classes.has("error"));
});

test("admin : « Retirer » demande une CONFIRMATION avant tout appel ; refus = rien ; acceptation = profils_publics_admin_alias_retirer(p_alias) puis liste rechargée", async () => {
  let d = await runAdmin({ confirmAnswer: false }); const rm = () => findAll(d.els["liste-alias"], (n) => n.textContent === "Retirer")[0];
  rm().click(); await tick(20); assert.strictEqual(d.log.confirm.length, 1); assert.match(d.log.confirm[0], /Retirer l'adresse supplémentaire \/m\/imprimeur \? La page \/m\/serigraphe reste inchangée\./);
  assert.strictEqual(aliasCalls(d, "profils_publics_admin_alias_retirer").length, 0, "refus : aucun appel");
  d = await runAdmin({ confirmAnswer: true }); rm().click(); await tick(30);
  assert.strictEqual(JSON.stringify(aliasCalls(d, "profils_publics_admin_alias_retirer")), JSON.stringify([["profils_publics_admin_alias_retirer", { p_alias: "imprimeur" }]])); assert.strictEqual(aliasCalls(d, "profils_publics_admin_alias_lister").length, 2, "liste rechargée");
  assert.strictEqual(d.els["msg-alias"].textContent, "Adresse supplémentaire retirée."); assert.strictEqual(findAll(d.els["liste-alias"], (n) => cls(n) === "card item").length, 1);
  for (const [code, re, err] of [["absent", /n'existe plus/, false], ["non_admin", /réservée aux administrateurs/, true], [null, /n'a pas pu être enregistré/, true]]) {
    d = await runAdmin({ retirer: code }); rm().click(); await tick(30); assert.match(d.els["msg-alias"].textContent, re, String(code)); assert.strictEqual(d.els["msg-alias"].classes.has("error"), err, String(code));
  }
});

test("admin : « Ajouter un alias » — un message clair par code ; champs normalisés ; format vérifié avant l'appel ; pas de double envoi ; champ vidé après succès", async () => {
  let d = await runAdmin(); d.els["alias-nom"].value = "  Developpeur "; d.els["alias-page"].value = "SERIGRAPHE"; d.els["btn-alias-ajouter"].click(); await tick(40);
  assert.strictEqual(JSON.stringify(aliasCalls(d, "profils_publics_admin_alias_ajouter")), JSON.stringify([["profils_publics_admin_alias_ajouter", { p_alias: "developpeur", p_adresse_page: "serigraphe" }]]));
  assert.strictEqual(d.els["msg-alias-form"].textContent, "Adresse supplémentaire ajoutée."); assert.ok(!d.els["msg-alias-form"].classes.has("error")); assert.strictEqual(d.els["alias-nom"].value, "");
  assert.strictEqual(findAll(d.els["liste-alias"], (n) => cls(n) === "card item").length, 3, "liste rechargée");
  const MSG = { invalide: /Adresse invalide/, reserve: /réservée/, deja_pris: /déjà utilisée/, page_introuvable: /Aucune page n'a cette adresse principale/, limite: /5 adresses supplémentaires/, non_admin: /réservée aux administrateurs/, [null]: /n'a pas pu être enregistré/ };
  for (const code of ["invalide", "reserve", "deja_pris", "page_introuvable", "limite", "non_admin", null]) {
    d = await runAdmin({ ajouter: code }); d.els["alias-nom"].value = "nouveau"; d.els["alias-page"].value = "serigraphe"; d.els["btn-alias-ajouter"].click(); await tick(40);
    assert.match(d.els["msg-alias-form"].textContent, MSG[code], String(code)); assert.ok(d.els["msg-alias-form"].classes.has("error"), String(code)); assert.strictEqual(d.els["alias-nom"].value, "nouveau", "saisie conservée en cas d'échec");
  }
  d = await runAdmin(); [["A", "serigraphe"], ["ok", "-x"], ["", "serigraphe"], ["ab cd", "serigraphe"], ["nouveau", ""]].forEach(([a, p]) => { });
  for (const [a, p] of [["A", "serigraphe"], ["nouveau", "-x"], ["", "serigraphe"], ["ab cd", "serigraphe"], ["nouveau", ""]]) { d.els["alias-nom"].value = a; d.els["alias-page"].value = p; d.els["btn-alias-ajouter"].click(); await tick(10); assert.match(d.els["msg-alias-form"].textContent, /Adresse invalide/); }
  assert.strictEqual(aliasCalls(d, "profils_publics_admin_alias_ajouter").length, 0, "format invalide : aucun appel");
});

test("admin : aucun innerHTML, aucun identifiant de compte, fonctions réservées ; HTML : formulaire accessible, zones ≥ 44 px, cohérent avec l'existant", () => {
  const js = code("admin/profils-publics.js"); assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(js));
  const rpcs = [...js.matchAll(/rpc\("(profils_publics_admin_alias_\w+)"/g)].map((m) => m[1]); assert.deepStrictEqual([...new Set(rpcs)].sort(), ["profils_publics_admin_alias_ajouter", "profils_publics_admin_alias_lister", "profils_publics_admin_alias_retirer"]);
  assert.ok(!/profils_publics_alias\b|\.from\("profils_publics_alias"\)/.test(js), "jamais la table : uniquement les fonctions");
  assert.ok(/if \(!confirm\("Retirer l'adresse supplémentaire/.test(js), "confirmation avant retrait");
  const h = read("admin/profils-publics.html");
  assert.match(h, /<h2>Adresses supplémentaires<\/h2>/); assert.match(h, /<label class="lbl" for="alias-nom">Alias \(nouvelle adresse\)<\/label><input type="text" id="alias-nom" maxlength="30"/); assert.match(h, /<label class="lbl" for="alias-page">Adresse principale de la page<\/label>/);
  assert.match(h, /id="btn-alias-ajouter">Ajouter l'alias<\/button>/); assert.match(h, /id="msg-alias-form" role="status"/); assert.match(h, /id="liste-alias" aria-label="Adresses supplémentaires"/);
  assert.match(h, /#alias-nom, #alias-page \{ width: 100%; min-height: 44px; \}/); assert.match(h, /\.btn44 \{ min-height: 44px;/); assert.match(h, /#liste-alias \.item \.actions \.btn \{ min-height: 44px;/);
  assert.match(h, /@media \(max-width: 480px\) \{ \.grid2 \{ grid-template-columns: 1fr; \} \}/, "formulaire sur une colonne sur petit écran");
  assert.ok(h.indexOf("<h2>Signalements</h2>") < h.indexOf("<h2>Adresses supplémentaires</h2>") && h.indexOf("<h2>Adresses supplémentaires</h2>") < h.indexOf("<h2>Pages</h2>"));
  assert.ok(!/profils_publics_alias|user_id/.test(h));
});

test("côté membre rien ne change ; sw.js : cache v126 ou plus ; aucun fichier de plus dans api/", () => {
  assert.ok(!/alias/i.test(read("profil.html") + read("profil-public.js")), "aucune création d'alias par les membres");
  assert.match(read("sw.js"), /CACHE_NAME = "mahoutoplus-shell-v(12[6-9]|1[3-9]\d)"/); assert.match(read("sw.js"), /SHARE_CACHE_NAME = "mahoutoplus-share-v1"/);
  assert.ok(fs.readdirSync(path.join(root, "api")).filter((f) => !f.startsWith("_") && f.endsWith(".js")).length + fs.readdirSync(path.join(root, "api/admin")).filter((f) => f.endsWith(".js") && !f.startsWith("_")).length === 12);
});
