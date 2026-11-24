/* Invitations (invitations.sql + rollback + vérification, invitation.js, profil.html, creer-ma-carte.html, profil-public.js,
   regles-pages-publiques.html, sw.js). Lecture statique des fichiers SQL (jamais exécutés ici) et faux DOM pour l'interface.
   Aucun réseau. Les scénarios SQL réels (53 contrôles, comptes neuf, ancien, propriétaire, anonyme, doublon…) ont été joués
   sur une base PostgreSQL locale jetable : voir la description de la PR. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const INV = require("../invitation");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

// ====================== SQL (lecture de fichiers uniquement) ======================
const FILES = ["invitations.sql", "invitations-rollback.sql", "invitations-verification.sql"];
const raw = read(FILES[0]), rawRb = read(FILES[1]), rawVf = read(FILES[2]);
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(raw), sqlRb = strip(rawRb), sqlVf = strip(rawVf);
const blocs = (t) => { const parts = t.split(/^-- BLOC (\d+) - /m), out = {}; for (let i = 1; i < parts.length; i += 2) out[Number(parts[i])] = parts[i + 1]; return out; };
const B = blocs(raw), BR = blocs(rawRb);
const fn = (text, name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(text); assert.ok(m, name); return m[0]; };
const squash = (t) => t.replace(/\s+/g, " ").trim();
const FONCTIONS = [["invitation_mon_code", ""], ["invitation_enregistrer", "text"], ["invitation_admin_totaux", ""]];
const MON = squash(fn(sql, "invitation_mon_code")), ENREG = squash(fn(sql, "invitation_enregistrer")), ADMIN = squash(fn(sql, "invitation_admin_totaux"));
const CODES = squash(B[2].slice(B[2].indexOf("create table"))), COMPTES = squash(B[3].slice(B[3].indexOf("create table")));

test("SQL : 7 blocs courts numérotés dans l'ordre ; rollback en 3 blocs dans l'ordre inverse (fonctions, comptes comptés, codes)", () => {
  assert.deepStrictEqual(Object.keys(B).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(Object.keys(BR).map(Number), [1, 2, 3]);
  assert.ok(/to_regclass\('public\.profils_publics'\)/.test(B[1]) && /is_admin\(\)/.test(B[1]) && /auth\.users/.test(B[1]) && !/create |insert |update |delete |drop /i.test(B[1]), "le bloc 1 ne modifie rien");
  assert.ok(/invitations_codes/.test(B[2]) && /invitations_comptes_comptes/.test(B[3]) && /invitation_mon_code/.test(B[4]) && /invitation_enregistrer/.test(B[5]) && /invitation_admin_totaux/.test(B[6]) && /\bgrant\b/.test(B[7]));
  assert.ok(/drop function/.test(BR[1]) && !/drop table/.test(BR[1]) && /drop table if exists public\.invitations_comptes_comptes/.test(BR[2]) && /drop table if exists public\.invitations_codes/.test(BR[3]));
  [2, 3].forEach((k) => assert.ok(/confirmation constant text := 'NON'/.test(BR[k]) && /raise exception 'Retour arriere NON confirme/.test(BR[k])));
  assert.ok(!/confirmation/.test(BR[1].split("\n").slice(1).join("\n")), "le retrait des fonctions est sans confirmation");
  FONCTIONS.forEach(([n]) => assert.ok(new RegExp("drop function if exists public\\." + n + "\\(").test(sqlRb), n));
});

test("SQL : règles de l'éditeur mobile ($$, pas de %rowtype, LIKE, regex ni POSIX, lignes courtes, commentaires sans apostrophe et AVANT les instructions)", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t), f);
    const s = strip(t);
    assert.ok(!/\blike\b|\bilike\b|similar to/i.test(s), f + " : LIKE"); assert.ok(!/ ~\*? |\[\[:|regexp_/i.test(s), f + " : regex ou POSIX");
    t.split("\n").forEach((l, i) => { assert.ok(l.length <= 105, f + ":" + (i + 1) + " ligne de " + l.length); if (l.trim().startsWith("--")) assert.ok(!/'/.test(l), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
  });
  assert.ok((raw.match(/\$\$/g) || []).length % 2 === 0);
  [B, BR].forEach((bl) => Object.keys(bl).forEach((k) => { const body = bl[k].split("\n").slice(1); const firstCode = body.findIndex((l) => l.trim() && !l.trim().startsWith("--")); const lastComment = body.map((l, i) => (l.trim().startsWith("--") ? i : -1)).filter((i) => i >= 0).pop(); assert.ok(lastComment === undefined || lastComment < firstCode, "bloc " + k + " : commentaire après une instruction"); }));
});

test("SQL règle 1 : AUCUNE table ne relie un compte invité à un inviteur — comptes comptés = user_id + jour, aucune colonne vers un code", () => {
  const cols = COMPTES.slice(COMPTES.indexOf("(", COMPTES.indexOf("create table")) + 1, COMPTES.indexOf(");")).split(",").map((c) => c.trim().split(" ")[0]);
  assert.deepStrictEqual(cols, ["user_id", "compte_le"], "deux colonnes seulement");
  assert.match(COMPTES, /user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(COMPTES, /compte_le date not null default current_date/);
  assert.ok(!/code|inviteur|proprietaire|parrain|references public\./i.test(COMPTES), "aucune référence à un code ou à une table de codes : " + COMPTES);
  // la table des codes ne contient que le code et le compteur : pas de date de mise à jour, pas de compte invité
  assert.ok(/user_id uuid not null unique references auth\.users\(id\) on delete cascade/.test(CODES) && /code text not null unique/.test(CODES) && /nb_inscrits integer not null default 0/.test(CODES));
  assert.ok(!/mis_a_jour|maj_le|updated|derniere|invite_id|compte_invite/i.test(CODES), "aucune colonne permettant de rapprocher un comptage d'un compte");
  // aucune fonction n'écrit un code dans la table des comptes comptés
  assert.ok(!/insert into public\.invitations_comptes_comptes \([^)]*code/i.test(sql));
  assert.match(ENREG, /insert into public\.invitations_comptes_comptes \(user_id\) values \(v_uid\) on conflict \(user_id\) do nothing;/);
});

test("SQL règle 2 : le membre ne voit qu'un nombre — mon_code ne renvoie que (code, nb_inscrits), pour lui seul", () => {
  assert.match(raw, /returns table \(code text, nb_inscrits integer\)/);
  assert.ok(MON.includes("select c.code, c.nb_inscrits from public.invitations_codes c where c.user_id = v_uid;"), "seulement SA ligne");
  assert.ok(!/invitations_comptes_comptes/.test(MON), "mon_code ne lit jamais la table des comptes comptés");
  assert.ok(MON.includes("p.user_id = v_uid and p.publie and not p.suspendu"), "page publiée et non suspendue");
});

test("SQL règle 3 : l'administrateur ne voit que des totaux anonymes (3 nombres), refus pour les autres", () => {
  assert.match(raw, /returns table \(nb_codes bigint, total_inscrits bigint, nb_nb_codes_avec_inscrits bigint\)|returns table \(nb_codes bigint, total_inscrits bigint, nb_codes_avec_inscrits bigint\)/);
  assert.match(ADMIN, /if not public\.is_admin\(\) then raise exception 'Reserve aux administrateurs' using errcode = '42501'; end if;/);
  assert.ok(ADMIN.includes("select count(*), coalesce(sum(c.nb_inscrits), 0)::bigint, count(*) filter (where c.nb_inscrits > 0) from public.invitations_codes c;"), "trois agrégats, rien d'autre");
  assert.ok(!/user_id|c\.code|c\.id\b|cree_le/.test(ADMIN), "aucune donnée nominative");
  assert.ok(!/invitations_comptes_comptes/.test(ADMIN));
});

test("SQL règle 4 : un compte n'est compté qu'UNE fois et seulement s'il est NOUVEAU (créé il y a moins de 2 jours)", () => {
  assert.ok(ENREG.includes("select u.created_at into v_cree from auth.users u where u.id = v_uid;"));
  assert.ok(ENREG.includes("if v_cree is null or v_cree < now() - interval '2 days' then return true; end if;"), "compte récent seulement");
  assert.ok(ENREG.includes("on conflict (user_id) do nothing; get diagnostics v_n = row_count; if v_n = 1 then update public.invitations_codes"), "incrément seulement si le compte vient d'être ajouté");
  assert.ok(ENREG.includes("pg_advisory_xact_lock(hashtextextended('invc:' || v_uid::text, 0))"), "verrou : pas de double comptage");
  assert.ok(ENREG.indexOf("pg_advisory_xact_lock") < ENREG.indexOf("insert into public.invitations_comptes_comptes") && ENREG.indexOf("insert into public.invitations_comptes_comptes") < ENREG.indexOf("update public.invitations_codes"), "verrou, puis ajout du compte, puis compteur (même transaction)");
  assert.match(COMPTES, /primary key/);
  assert.ok(ENREG.indexOf("select c.user_id into v_proprio") < ENREG.indexOf("insert into public.invitations_comptes_comptes"), "un code inconnu ne consomme pas le compte");
});

test("SQL règle 5 : pas de comptage pour le propriétaire du code, ni pour un compte anonyme ou absent", () => {
  assert.ok(ENREG.includes("if not found or v_proprio = v_uid then return true; end if;"), "exclusion du propriétaire");
  assert.ok(ENREG.includes("v_uid is null or coalesce((v_claims ->> 'is_anonymous')::boolean, false) or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then return true;"));
  assert.ok(MON.includes("v_uid is null or coalesce((v_claims ->> 'is_anonymous')::boolean, false) or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then return;"));
});

test("SQL règle 6 : la réponse de l'enregistrement est TOUJOURS vraie (jamais faux, jamais d'erreur levée)", () => {
  assert.match(raw, /create or replace function public\.invitation_enregistrer\(p_code text\)\s+returns boolean/);
  assert.ok(!/return false|return null|raise exception/.test(ENREG), "aucune autre issue que « vrai »");
  assert.strictEqual((ENREG.match(/return true;/g) || []).length, 5, "5 sorties « vrai » : 4 refus, puis la fin");
  assert.ok(ENREG.endsWith("return true; end; $$;"));
});

test("SQL règle 7 : code de 10 caractères tirés au hasard parmi 32 (50 bits), majuscules, format vérifié strictement, jamais issu d'un identifiant", () => {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; assert.strictEqual(ALPHA.length, 32);
  assert.strictEqual(INV.ALPHABET, ALPHA); assert.strictEqual(INV.CODE_LENGTH, 10);
  assert.ok(MON.includes("v_alphabet constant text := '" + ALPHA + "'") && ENREG.includes("v_alphabet constant text := '" + ALPHA + "'") && CODES.includes("'" + ALPHA + "'"));
  assert.ok(MON.includes("foreach v_i in array array[0, 1, 2, 3, 4, 5, 7, 8, 9, 10] loop") && MON.includes("(get_byte(uuid_send(v_u), v_i) % 32) + 1") && MON.includes("v_u := gen_random_uuid();"), "10 octets aléatoires (les octets de version et de variante de l'UUID sont écartés)");
  assert.ok(!/v_uid::text|user_id::text|md5|hashtext|row_number|nextval|random\(\)/.test(MON.slice(MON.indexOf("v_u := gen_random_uuid()"), MON.indexOf("unique_violation"))), "le code ne dérive d'aucun identifiant");
  assert.ok(MON.includes("exception when unique_violation then if v_essai >= 5 then raise exception"), "collision : nouvel essai, 5 au plus");
  assert.match(CODES, /constraint invitations_codes_format check \( char_length\(code\) = 10 and code = upper\(code\) and translate\(code, '[A-Z2-9]{32}', ''\) = ''\)/);
  assert.ok(ENREG.includes("p_code is null or char_length(p_code) <> 10 or p_code <> upper(p_code) or translate(p_code, v_alphabet, '') <> ''"), "format strict à l'enregistrement");
  assert.match(CODES, /constraint invitations_codes_borne check \(nb_inscrits between 0 and 1000000\)/);
});

test("SQL : tables sans politique ni droit ; 3 fonctions SECURITY DEFINER avec search_path ; rien pour anon ni public ; execute aux membres connectés", () => {
  [B[2], B[3]].forEach((b) => { const n = /create table if not exists public\.(\w+)/.exec(b)[1]; assert.ok(new RegExp("alter table public\\." + n + " enable row level security;").test(b) && new RegExp("revoke all on public\\." + n + " from public, anon, authenticated;").test(b), n); });
  assert.ok(!/create policy/.test(sql), "aucune politique"); assert.ok(!/grant[^;]*invitations_(codes|comptes_comptes)/.test(sql), "aucun grant sur les tables");
  FONCTIONS.forEach(([n, a]) => {
    const f = squash(fn(sql, n)); assert.ok(f.includes("security definer") && f.includes("set search_path = public, pg_temp"), n);
    assert.ok(new RegExp("revoke all on function public\\." + n + "\\(" + a + "\\) from public, anon;").test(sql), n + " : droits retirés");
    assert.ok(new RegExp("grant execute on function public\\." + n + "\\(" + a + "\\) to authenticated;").test(sql), n + " : execute aux membres connectés");
  });
  const grants = sql.split(";").map((s) => s.trim()).filter((s) => /^(grant|revoke)\b/.test(s));
  assert.ok(grants.every((g) => !/\banon\b/.test(g) || /^revoke/.test(g)), "aucun grant à anon"); assert.ok(!/\bto\s+(public|anon)\b/i.test(sql));
  assert.strictEqual((sql.match(/grant execute/g) || []).length, 3);
  assert.ok(!/page_views|profils_publics_admin_stats|alter table|drop (table|function)/i.test(sql.replace(/alter table public\.invitations_(codes|comptes_comptes) enable row level security/g, "")), "aucune table ni fonction existante touchée");
});

test("vérification : UNE requête, UNE ligne de booléens, lecture seule ; rollback sans autre suppression", () => {
  assert.ok((sqlVf.match(/;/g) || []).length === 1 && /^\s*select\b/i.test(sqlVf));
  assert.ok(!/\b(insert|update|delete|drop|create|alter|grant|revoke)\b/i.test(sqlVf.replace(/'[^']*'/g, "''")), "lecture seule");
  const cols = [...sqlVf.matchAll(/\bas\s+([a-z_]+)(?:,|\s*;)/g)].map((m) => m[1]);
  assert.strictEqual(cols.length, 12);
  ["rls_activee", "aucune_politique", "aucun_droit_direct", "comptes_comptes_sans_colonne_vers_un_code", "trois_fonctions_definer_search_path", "anon_ne_peut_rien_appeler"].forEach((c) => assert.ok(cols.includes(c), c));
  assert.ok(!/drop (schema|database)|truncate|delete from/i.test(sqlRb));
});

// ====================== invitation.js : fonctions pures ======================
const store = () => { const s = {}; return { s, getItem: (k) => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; };
const OK = "ABCDEFGH23", DAY = 24 * 3600 * 1000;

test("format STRICT du code : 10 caractères, majuscules et chiffres de la liste ; tout le reste est refusé", () => {
  [OK, "ZZZZZZZZZZ", "2222222222", "A2B3C4D5E6"].forEach((c) => assert.strictEqual(INV.codeValide(c), true, c));
  ["", "ABC", "ABCDEFGH2", "ABCDEFGH234", "abcdefgh23", "ABCDEFGH2 ", " ABCDEFGH2", "ABCDEFGHI2", "ABCDEFGHO2", "ABCDEFGH02", "ABCDEFGH12", "ABCDEFGH2é", "ABCDEFGH-2", "<script>aa", null, undefined, 1234567890, {}, ["ABCDEFGH23"]].forEach((c) => assert.strictEqual(INV.codeValide(c), false, String(c)));
  assert.strictEqual(INV.codeFromSearch("?inv=" + OK + "&src=invitation"), OK); assert.strictEqual(INV.codeFromSearch("?src=invitation&inv=" + OK), OK);
  ["", "?inv=", "?inv=abc", "?inv=" + OK.toLowerCase(), "?xinv=" + OK, "?inv=%3Cscript%3E", "?inv=" + OK + "9", "?inv=%E0%A4%A", null].forEach((s) => assert.strictEqual(INV.codeFromSearch(s), null, String(s)));
});

test("règle 8 : le code est gardé 7 jours AU PLUS, puis effacé ; effacé aussi s'il est illisible, invalide ou daté du futur", () => {
  const st = store(), t0 = 1700000000000;
  assert.strictEqual(INV.remember("?inv=" + OK, st, t0), true); assert.deepStrictEqual(JSON.parse(st.s[INV.KEY]), { c: OK, e: t0 + 7 * DAY });
  assert.strictEqual(INV.TTL_MS, 7 * DAY);
  assert.strictEqual(INV.pending(st, t0 + 7 * DAY - 1), OK, "encore valable à la dernière seconde");
  assert.strictEqual(INV.pending(st, t0 + 7 * DAY), null, "périmé au bout de 7 jours"); assert.ok(!(INV.KEY in st.s), "et effacé");
  INV.remember("?inv=" + OK, st, t0); assert.strictEqual(INV.pending(st, t0 + 8 * DAY), null); assert.ok(!(INV.KEY in st.s));
  [JSON.stringify({ c: OK, e: t0 + 400 * DAY }), JSON.stringify({ c: "abc", e: t0 + DAY }), "pas du json", JSON.stringify({ c: OK }), JSON.stringify([OK]), "null"].forEach((v) => { st.s[INV.KEY] = v; assert.strictEqual(INV.pending(st, t0), null, v); assert.ok(!(INV.KEY in st.s), "effacé : " + v); });
  assert.strictEqual(INV.pending({ getItem() { throw new Error("bloqué"); } }, t0), null, "stockage bloqué : rien, sans erreur");
  assert.strictEqual(INV.remember("?inv=" + OK, { setItem() { throw new Error("bloqué"); } }, t0), false);
  st.s[INV.KEY] = JSON.stringify({ c: OK, e: t0 + DAY }); assert.strictEqual(INV.remember("?inv=invalide", st, t0), false); assert.strictEqual(JSON.parse(st.s[INV.KEY]).c, OK, "un code invalide ne remplace pas un code gardé");
  assert.deepStrictEqual(Object.keys(st.s), [INV.KEY], "une seule clé de stockage");
  assert.strictEqual(INV.KEY, "mahouto_inv");
});

test("textes : lien sur mahouto.com uniquement, compteur neutre à 0, singulier et pluriel, message de partage", () => {
  assert.strictEqual(INV.lien(OK), "https://mahouto.com/creer-ma-carte?inv=ABCDEFGH23&src=invitation"); assert.strictEqual(INV.lien("abc"), "");
  assert.strictEqual(INV.texteCompteur(0), "Personne n'a encore rejoint grâce à votre lien."); assert.strictEqual(INV.texteCompteur(1), "1 personne a rejoint grâce à votre lien."); assert.strictEqual(INV.texteCompteur(12), "12 personnes ont rejoint grâce à votre lien.");
  ["x", -3, null, undefined, NaN].forEach((v) => assert.strictEqual(INV.texteCompteur(v), "Personne n'a encore rejoint grâce à votre lien."));
  assert.match(INV.lienWhatsapp(INV.lien(OK)), /^https:\/\/wa\.me\/\?text=Cr%C3%A9ez%20votre%20carte%20de%20visite%20en%20ligne%20sur%20MAHOUTO%2B%20%3A%20https%3A%2F%2Fmahouto\.com%2Fcreer-ma-carte%3Finv%3DABCDEFGH23%26src%3Dinvitation$/);
});

// ====================== enregistrement au retour de connexion ======================
const client = (o) => { const calls = []; return { calls, rpc: async (n, a) => { calls.push([n, JSON.stringify(a)]); if (o && o.hang) return new Promise(() => {}); return o && o.error ? { data: null, error: { message: "x" } } : { data: true, error: null }; } }; };
test("enregistrement : UNE seule fois, code effacé après la réponse, jamais d'erreur ; ni anonyme ni sans code ni sans connexion → aucun appel", async () => {
  const st = store(); INV.remember("?inv=" + OK, st);
  const c = client();
  const [a, b] = await Promise.all([INV.registerPending(c, { id: "u1" }, st), INV.registerPending(c, { id: "u1" }, st)]);
  assert.deepStrictEqual(c.calls, [["invitation_enregistrer", JSON.stringify({ p_code: OK })]], "un seul appel malgré deux chargements simultanés");
  assert.ok(a !== b || a === true); assert.ok(!(INV.KEY in st.s), "code effacé après utilisation");
  assert.strictEqual(await INV.registerPending(c, { id: "u1" }, st), false); assert.strictEqual(c.calls.length, 1, "plus de code : plus d'appel");
  for (const u of [null, { id: "u", is_anonymous: true }, { id: "u", app_metadata: { provider: "anonymous" } }]) { const s2 = store(); INV.remember("?inv=" + OK, s2); const c2 = client(); assert.strictEqual(await INV.registerPending(c2, u, s2), false); assert.strictEqual(c2.calls.length, 0); assert.ok(INV.KEY in s2.s, "code gardé : la connexion n'est pas celle d'un membre"); }
  const s3 = store(); INV.remember("?inv=" + OK, s3, 0); const c3 = client(); assert.strictEqual(await INV.registerPending(c3, { id: "u" }, s3, 8 * DAY), false); assert.strictEqual(c3.calls.length, 0, "code périmé : aucun appel");
  const s4 = store(); INV.remember("?inv=" + OK, s4); const c4 = client({ error: true }); await INV.registerPending(c4, { id: "u" }, s4); assert.ok(INV.KEY in s4.s, "erreur réseau : code gardé pour un prochain chargement");
  const c5 = { rpc: async () => { throw new Error("boum"); } }; const s5 = store(); INV.remember("?inv=" + OK, s5); assert.strictEqual(await INV.registerPending(c5, { id: "u" }, s5), false, "une exception est avalée");
  assert.strictEqual(await INV.registerPending(client(), { id: "u" }, { getItem() { throw new Error("x"); } }), false);
});

// ====================== creer-ma-carte.html : capture du code ======================
const PAGE = read("creer-ma-carte.html");
test("creer-ma-carte.html : ?inv= vérifié et gardé 7 jours, rien d'affiché, aucun script externe de plus, aucun cookie", () => {
  const tag = '<script src="/invitation.js"></script>';
  assert.ok(PAGE.includes(tag) && PAGE.indexOf(tag) > PAGE.indexOf('<script src="/login-sheet.js">') && PAGE.indexOf(tag) < PAGE.indexOf('<script src="/analytics.js"'), "script local, avant analytics.js");
  const inline = PAGE.match(/<script>\s*\/\/ Lien d'invitation[\s\S]*?<\/script>/)[0];
  const st = store(); const win = { MahoutoInvitation: INV, location: { search: "?inv=" + OK + "&src=invitation" }, localStorage: st };
  vm.runInNewContext(inline.replace(/<\/?script>/g, ""), { window: win });
  assert.deepStrictEqual(JSON.parse(st.s[INV.KEY]).c, OK, "gardé");
  const bad = store(); vm.runInNewContext(inline.replace(/<\/?script>/g, ""), { window: { MahoutoInvitation: INV, location: { search: "?inv=abc" }, localStorage: bad } }); assert.deepStrictEqual(bad.s, {}, "format invalide : rien gardé");
  assert.doesNotThrow(() => vm.runInNewContext(inline.replace(/<\/?script>/g, ""), { window: {} }), "sans le script : sans effet");
  assert.doesNotThrow(() => vm.runInNewContext(inline.replace(/<\/?script>/g, ""), { window: { MahoutoInvitation: INV, location: { search: "?inv=" + OK }, get localStorage() { throw new Error("bloqué"); } } }));
  assert.ok(!/document\.write|innerHTML|document\.cookie|setItem/.test(inline), "ce script n'écrit rien lui-même, n'affiche rien");
  assert.ok(!/<script[^>]+src="https?:/i.test(PAGE) && !/(src|href)="https?:\/\//i.test(PAGE), "aucune ressource externe");
  assert.ok(!/document\.cookie/.test(read("invitation.js")), "aucun cookie");
  const own = PAGE.replace(/<script src="[^"]*"[^>]*><\/script>/g, "");
  assert.ok(!/analytics|page_views|\/rest\/v1|sendBeacon|document\.cookie|setItem|sessionStorage|\.rpc\(|fetch\(/i.test(own), "la page n'envoie rien et n'écrit rien elle-même");
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(PAGE), "noindex conservé");
});

// ====================== profil.html : la section n'apparaît que page publiée ======================
function fakeEl(id) {
  const el = { id, children: [], attrs: {}, _text: "", listeners: {}, classes: new Set(["hidden"]),
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    set innerHTML(v) { throw new Error("innerHTML interdit"); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); }, contains: (c) => el.classes.has(c) },
    addEventListener(t, f) { this.listeners[t] = f; } };
  return el;
}
function runProfil(o) {
  const opts = Object.assign({ session: { user: { id: "u1" } }, row: { code: OK, nb_inscrits: 3 }, share: true, clipboard: true, pending: null, deja: false }, o || {});
  const els = {}; ["inv-section", "inv-lien", "inv-compteur", "inv-copier", "inv-whatsapp", "inv-partager-systeme"].forEach((i) => { els[i] = fakeEl(i); });
  els["inv-copier"].classes.delete("hidden"); els["inv-copier"]._text = "Copier le lien";
  const calls = [], listeners = {}, opened = [], shared = [], copied = [], st = store(); if (opts.pending) INV.remember("?inv=" + opts.pending, st);
  const sb = { auth: { getSession: async () => ({ data: { session: opts.session } }) }, rpc: async (n, a) => { calls.push([n, a && JSON.stringify(a)]); if (n === "invitation_mon_code") return opts.error ? { data: null, error: { message: "x" } } : { data: opts.row ? [opts.row] : [], error: null }; return { data: true, error: null }; } };
  const doc = { getElementById: (i) => els[i], createElement: () => ({ setAttribute() {}, select() {}, style: {} }), addEventListener: (t, f) => { listeners[t] = f; }, body: { appendChild() {}, removeChild() {}, getAttribute: (k) => (k === "data-pp-publie" && opts.deja ? "1" : null) }, execCommand: () => true };
  const win = { MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => sb }, localStorage: st, open: (u, n, f) => opened.push([u, n, f]) };
  win.window = win;
  const nav = { share: opts.share ? async (d) => { shared.push(d); } : undefined, clipboard: opts.clipboard ? { writeText: async (t) => { copied.push(t); } } : undefined };
  vm.runInNewContext(read("invitation.js"), { window: win, document: doc, navigator: nav, Date, JSON, Math, Number, isFinite, Array, String, Promise, Error, setTimeout, encodeURIComponent, decodeURIComponent, RegExp });
  return { els, calls, st, opened, shared, copied, fire: async (publie) => { await listeners["pp-publication"]({ detail: { publie } }); await tick(); } };
}
const shown = (e) => !e.classes.has("hidden");

test("section « Inviter des professionnels » : masquée par défaut ; visible SEULEMENT si la page est publiée ET que la base renvoie un code", async () => {
  let r = runProfil(); await tick();
  assert.ok(!shown(r.els["inv-section"]), "masquée au chargement"); assert.deepStrictEqual(r.calls, [], "aucun appel tant que la publication n'est pas connue");
  await r.fire(false); assert.ok(!shown(r.els["inv-section"]), "page non publiée : masquée"); assert.ok(!r.calls.some((c) => c[0] === "invitation_mon_code"), "et aucun code demandé");
  await r.fire(true); assert.ok(shown(r.els["inv-section"]), "page publiée : visible");
  assert.strictEqual(r.els["inv-lien"].textContent, "https://mahouto.com/creer-ma-carte?inv=ABCDEFGH23&src=invitation"); assert.strictEqual(r.els["inv-compteur"].textContent, "3 personnes ont rejoint grâce à votre lien.");
  await r.fire(false); assert.ok(!shown(r.els["inv-section"]), "dépublication : la section se masque");
  r = runProfil({ row: null }); await tick(); await r.fire(true); assert.ok(!shown(r.els["inv-section"]), "publiée côté page mais refusée par la base (suspendue, anonyme…) : masquée");
  r = runProfil({ error: true }); await tick(); await r.fire(true); assert.ok(!shown(r.els["inv-section"]), "fonction absente : masquée, sans erreur");
  r = runProfil({ row: { code: "abc", nb_inscrits: 1 } }); await tick(); await r.fire(true); assert.ok(!shown(r.els["inv-section"]), "code invalide renvoyé : masquée");
  r = runProfil({ row: { code: OK, nb_inscrits: 0 } }); await tick(); await r.fire(true); assert.strictEqual(r.els["inv-compteur"].textContent, "Personne n'a encore rejoint grâce à votre lien.");
});

test("section : si la publication était déjà connue avant le chargement du fichier (attribut posé par profil-public.js), la section se charge quand même", async () => {
  let r = runProfil({ deja: true }); await tick(30);
  assert.ok(shown(r.els["inv-section"]) && r.els["inv-compteur"].textContent === "3 personnes ont rejoint grâce à votre lien.");
  r = runProfil({ deja: true, row: null }); await tick(30); assert.ok(!shown(r.els["inv-section"]), "la base décide : masquée");
  r = runProfil({ deja: false }); await tick(30); assert.ok(!shown(r.els["inv-section"]), "sans publication connue : masquée");
});

test("section : Copier, WhatsApp, partage système (seulement s'il existe) ; aucun identifiant ni nom affiché", async () => {
  let r = runProfil(); await tick(); await r.fire(true);
  assert.ok(shown(r.els["inv-partager-systeme"])); await r.els["inv-copier"].listeners.click(); assert.deepStrictEqual(r.copied, ["https://mahouto.com/creer-ma-carte?inv=ABCDEFGH23&src=invitation"]); assert.strictEqual(r.els["inv-copier"].textContent, "Lien copié ✓");
  r.els["inv-whatsapp"].listeners.click(); assert.strictEqual(r.opened.length, 1); assert.ok(r.opened[0][0].startsWith("https://wa.me/?text=") && r.opened[0][2] === "noopener");
  await r.els["inv-partager-systeme"].listeners.click(); assert.deepStrictEqual(r.shared.map((d) => Object.keys(d)), [["text"]]); assert.match(r.shared[0].text, /MAHOUTO\+ : https:\/\/mahouto\.com\/creer-ma-carte\?inv=ABCDEFGH23&src=invitation$/);
  r = runProfil({ share: false }); await tick(); await r.fire(true); assert.ok(!shown(r.els["inv-partager-systeme"]), "pas de partage système : bouton masqué");
  r = runProfil({ row: { code: OK, nb_inscrits: 2, user_id: "00000000-0000-4000-8000-0000000000aa", nom: "Marie" } }); await tick(); await r.fire(true);
  const tout = Object.values(r.els).map((e) => e.textContent).join("|"); assert.ok(!/0000000000aa|Marie|user_id/.test(tout), "rien d'autre que le lien et le nombre n'est affiché");
});

test("profil.html : au retour de connexion, le code en attente est enregistré une fois, sans attendre, sans erreur visible", async () => {
  const r = runProfil({ pending: OK }); await tick(30);
  assert.deepStrictEqual(r.calls.filter((c) => c[0] === "invitation_enregistrer"), [["invitation_enregistrer", JSON.stringify({ p_code: OK })]]); assert.ok(!(INV.KEY in r.st.s), "code effacé");
  assert.ok(!shown(r.els["inv-section"]), "rien affiché");
  const h = runProfil({ pending: OK, session: null }); await tick(30); assert.deepStrictEqual(h.calls, [], "non connecté : aucun appel"); assert.ok(INV.KEY in h.st.s);
  const an = runProfil({ pending: OK, session: { user: { id: "u", is_anonymous: true } } }); await tick(30); assert.deepStrictEqual(an.calls, [], "anonyme : aucun appel");
});

// ====================== profil.html, profil-public.js, règles, cache, périmètre ======================
const HTML = read("profil.html");
const SEC = HTML.slice(HTML.indexOf('<section class="pp inv hidden" id="inv-section"'), HTML.indexOf("</section>", HTML.indexOf('id="inv-section"')));
test("profil.html : section masquée au départ, 3 lignes d'explication, boutons ≥ 48 px, vouvoiement, aucun style de page publique modifié", () => {
  assert.ok(SEC.length > 500, "section présente et masquée au départ");
  assert.match(SEC, /<h2 id="inv-titre">Inviter des professionnels<\/h2>/); assert.strictEqual((SEC.match(/<li>/g) || []).length, 3);
  assert.match(SEC, /aucune récompense/); assert.match(SEC, /Vous ne voyez jamais qui s'est inscrit/); assert.match(SEC, /invite un professionnel à créer sa carte de visite/);
  ["inv-lien", "inv-copier", "inv-whatsapp", "inv-partager-systeme", "inv-compteur"].forEach((i) => assert.ok(new RegExp('id="' + i + '"').test(SEC), i));
  assert.match(SEC, /id="inv-partager-systeme"/); assert.match(SEC, /class="pp-btn secondary hidden" id="inv-partager-systeme"/);
  assert.ok(HTML.indexOf('id="inv-section"') > HTML.indexOf('id="pv-section"'), "après « Qui a vu ma carte »");
  assert.strictEqual((HTML.match(/<script src="invitation\.js"><\/script>/g) || []).length, 1); assert.ok(HTML.indexOf('invitation.js') > HTML.indexOf('profil-public.js'));
  const css = HTML.match(/\/\* Inviter des professionnels[\s\S]*?(?=\/\* Mon profil public)/)[0];
  assert.match(css, /\.inv \.inv-actions \.pp-btn \{ min-height: 48px/); assert.ok(!/var\(--text-dim\)/.test(css));
  assert.match(css, /body\.light-theme \.inv \.inv-compteur \{ color: var\(--gold-text, #856500\); \}/);
  assert.ok(!/\b(tu|ton|ta|tes|toi)\b/i.test(SEC.replace(/<[^>]+>/g, " ")), "vouvoiement");
});

test("profil.html : contrastes AA dans les deux thèmes (texte atténué, lien, compteur doré)", () => {
  const hex = (s) => { let h = s.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const theme = read("theme.css"), decl = (t, n) => { const m = new RegExp(n + ":\\s*(#[0-9a-fA-F]{3,6})").exec(t); assert.ok(m, n); return m[1]; };
  const dark = theme.match(/:root \{([^}]*)\}/)[1], light = theme.match(/body\.light-theme\{([^}]*)\}/)[1];
  const TH = { sombre: { fond: decl(dark, "--bg"), carte: decl(dark, "--bg-card"), texte: decl(dark, "--white"), doux: decl(dark, "--text-muted"), accent: decl(dark, "--gold") }, clair: { fond: decl(light, "--bg"), carte: decl(light, "--bg-card"), texte: decl(light, "--white"), doux: decl(light, "--text-muted"), accent: decl(theme, "--gold-text") } };
  for (const [n, t] of Object.entries(TH)) [["texte atténué / carte", t.doux, t.carte], ["lien sur fond de zone", t.texte, t.fond], ["compteur doré / carte", t.accent, t.carte]].forEach(([l, a, b]) => assert.ok(ratio(a, b) >= 4.5, n + " " + l + " " + ratio(a, b).toFixed(2)));
});

test("profil-public.js : n'émet qu'un événement « pp-publication » (publié ou non), rien d'autre n'est changé", () => {
  const js = read("profil-public.js");
  assert.ok(js.includes('document.body.setAttribute("data-pp-publie", published ? "1" : "0"); document.dispatchEvent(new CustomEvent("pp-publication", { detail: { publie: published } }))'));
  assert.strictEqual((js.match(/pp-publication/g) || []).length, 1, "une seule émission");
  assert.ok(js.indexOf("pp-publication") > js.indexOf("refreshQr(published);"));
});

test("règles : section « Lien d'invitation » (facultatif, sans récompense, un nombre, aucune identité, 7 jours) ; la date n'est PAS modifiée", () => {
  const P = read("regles-pages-publiques.html"), s = P.slice(P.indexOf('<section aria-labelledby="r-invitation">'), P.indexOf("</section>", P.indexOf('id="r-invitation"')));
  assert.match(s, /<h2 id="r-invitation">Lien d'invitation<\/h2>/); assert.strictEqual((s.match(/<li>/g) || []).length, 5);
  ["facultatif", "aucune récompense", "seulement un nombre", "jamais leur nom", "Aucune identité n'est enregistrée", "7 jours"].forEach((x) => assert.ok(new RegExp(x, "i").test(s), x));
  assert.match(P, /<p class="maj">Dernière mise à jour : 24 novembre 2026\.<\/p>/);
});

test("le mot « parrain » n'apparaît nulle part dans les nouveaux textes, ni dans le nouveau code", () => {
  const P = read("regles-pages-publiques.html");
  const nouveaux = [raw, rawRb, rawVf, read("invitation.js"), SEC, P.slice(P.indexOf('<section aria-labelledby="r-invitation">'), P.indexOf("</section>", P.indexOf('id="r-invitation"'))), PAGE.match(/<script>\s*\/\/ Lien d'invitation[\s\S]*?<\/script>/)[0], read("tests/invitations.test.js").split("\n").slice(0, 3).join("")];
  nouveaux.slice(0, 7).forEach((t, i) => assert.ok(!/parrain/i.test(t.replace(/Vocabulaire : « invitation » et « inviter », jamais un autre mot\./, "")), "texte " + i));
  assert.ok(!/parrain/i.test(HTML.slice(HTML.indexOf('id="inv-section"') - 40, HTML.indexOf('id="inv-section"') + 1500)));
});

test("sw.js : cache v132 (main était à v131), invitation.js pré-caché comme les pages comparables ; api/ et analytics.js inchangés", () => {
  const sw = read("sw.js"); assert.match(sw, /const CACHE_NAME = "mahoutoplus-shell-v(132|13[3-9]|1[4-9]\d)";/); assert.strictEqual((sw.match(/"\/invitation\.js"/g) || []).length, 1); assert.ok(sw.indexOf('"/invitation.js"') > sw.indexOf('"/profil-visiteurs.js"'));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions : aucun fichier ajouté dans api/");
  const an = read("analytics.js"); assert.deepStrictEqual([...an.matchAll(/var (K_[A-Z]+) = "([a-z_]+)"/g)].map((m) => m[2]).sort(), ["mahouto_pv_admin", "mahouto_pv_seen", "mahouto_pv_src", "mahouto_vid"], "analytics.js n'a pas de nouvelle clé");
  assert.ok(!/inv/.test(an.replace(/investigat|invalid|invit|inversion/gi, "").replace(/[a-z]inv|inv[a-z]/gi, "")), "analytics.js ne connaît pas ?inv=");
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci|BEGIN (RSA )?PRIVATE KEY/.test([raw, rawRb, rawVf, read("invitation.js")].join("\n")), "aucune clé ni secret");
});
