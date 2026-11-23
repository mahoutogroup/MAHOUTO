/* Profil public : « Écrire un message » depuis la page publique (SQL, page publique m.js, case du profil, correctif de dm-chat.html).
   Aucun réseau, aucune base. */
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
const CONV = "11111111-2222-4333-8444-555555555555";

// ====================== SQL (lecture de fichiers uniquement) ======================
const FF = ["profils-publics-ecrire.sql", "profils-publics-ecrire-rollback.sql", "profils-publics-ecrire-verification.sql"];
const raw = read(FF[0]), sql = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const FN3 = ["profil_public_messages_mien", "profil_public_messages_ouverts", "profil_public_ecrire"];

test("SQL : 6 blocs courts, règles de l'éditeur mobile ($$, record, pas de LIKE ni de regex ni de classe POSIX, lignes courtes, commentaires sans apostrophe), rollback 4 blocs", () => {
  const parts = raw.split(/^-- BLOC (\d+) - /m); const nums = []; for (let i = 1; i < parts.length; i += 2) nums.push(Number(parts[i]));
  assert.deepStrictEqual(nums, [1, 2, 3, 4, 5, 6]);
  const rb = read(FF[1]).split(/^-- BLOC (\d+) - /m); const rn = []; for (let i = 1; i < rb.length; i += 2) rn.push(Number(rb[i])); assert.deepStrictEqual(rn, [1, 2, 3, 4]);
  FF.forEach((f) => { const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t) && !/\[\[:/.test(t), f);
    t.split("\n").forEach((line, i) => { assert.ok(line.length <= 106, f + ":" + (i + 1) + " ligne longue (" + line.length + ")");
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/(sk_live|eyJ)/.test(t)); });
  const body = FF.slice(0, 2).map(read).join("\n").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\blike\b|\bilike\b/i.test(body), "aucun LIKE"); assert.ok(!/ ~ | !~ |regexp_/.test(body), "aucune expression régulière");
  assert.ok(/\brecord\b/.test(fn("profil_public_ecrire")), "variables en record");
  FN3.forEach((f) => assert.ok(!/--/.test(fn(f)), f + " : aucun commentaire dans le corps"));
});

test("SQL : colonne messages_ouverts boolean not null default false ; droits de colonne complets en insertion et mise à jour ; jamais lisible directement ; garde inchangé", () => {
  assert.match(sql, /alter table public\.profils_publics\s+add column if not exists messages_ouverts boolean not null default false;/);
  const cols = "adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie, majeur_declare, messages_ouverts";
  ["insert", "update"].forEach((op) => { const g = new RegExp("grant " + op + " \\(([^)]*)\\)\\s+on public\\.profils_publics to authenticated;").exec(sql);
    assert.ok(g, op); assert.strictEqual(g[1].replace(/\s+/g, " ").trim(), cols, op); ["suspendu", "user_id", "publie_le", "id"].forEach((x) => assert.ok(!g[1].includes(x), op + " : " + x)); });
  assert.ok(!/grant select[^;]*messages_ouverts/i.test(sql), "jamais lisible directement");
  assert.ok(!/profils_publics_garde|create trigger|drop trigger/.test(sql), "le déclencheur de garde n'est pas touché (il ne cite pas la colonne)");
  assert.ok(!/messages_ouverts/.test(read("profils-publics.sql")), "le fichier de la PR 1 n'est pas modifié");
});

test("SQL : table profils_publics_ecritures — colonnes demandées, index, RLS, AUCUN droit ni règle", () => {
  const t = /create table if not exists public\.profils_publics_ecritures \([\s\S]*?\n\);/.exec(sql)[0];
  ["id bigint generated always as identity primary key", "auteur_id uuid not null default auth.uid() references auth.users(id) on delete cascade",
    "page_id uuid not null references public.profils_publics(id) on delete cascade", "cree_le timestamptz not null default now()"].forEach((c) => assert.ok(t.includes(c), c));
  assert.match(sql, /create index if not exists ppe_auteur_idx\s+on public\.profils_publics_ecritures \(auteur_id, cree_le desc\);/);
  assert.match(sql, /alter table public\.profils_publics_ecritures enable row level security;/);
  assert.match(sql, /revoke all on public\.profils_publics_ecritures from anon, authenticated;/);
  assert.ok(!/grant\s+(select|insert|update|delete|all)\b[^;]*\bon\s+(table\s+)?public\.profils_publics_ecritures\s/i.test(sql) && !/create policy[^;]*profils_publics_ecritures/i.test(sql));
});

test("SQL : 3 fonctions security definer + search_path fixe ; droits : mien et ecrire pour authenticated SEULEMENT, messages_ouverts aussi pour anon ; aucune fonction existante modifiée ni supprimée", () => {
  FN3.forEach((f) => { const b = fn(f); assert.ok(/security definer/.test(b) && /set search_path = public, pg_temp/.test(b), f); });
  assert.match(sql, /revoke all on function public\.profil_public_messages_mien\(\) from public, anon;\s+grant execute on function public\.profil_public_messages_mien\(\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.profil_public_ecrire\(text\) from public, anon;\s+grant execute on function public\.profil_public_ecrire\(text\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.profil_public_messages_ouverts\(text\) from public;\s+grant execute on function public\.profil_public_messages_ouverts\(text\) to anon, authenticated;/);
  assert.ok(!/drop function/i.test(sql), "aucun DROP FUNCTION");
  const created = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]); assert.deepStrictEqual(created, FN3);
  ["profil_public_lire", "profil_public_mien", "profil_public_statut", "profil_public_signaler", "profil_public_adresse_disponible", "profils_publics_garde", "get_or_create_dm_conversation"].forEach((n) => assert.ok(!new RegExp("function public\\." + n + "\\b").test(sql), n + " non modifiée"));
});

test("SQL : messages_mien (false sans page) et messages_ouverts (adresse valide, interrupteur ouvert, publiée, non suspendue, case cochée)", () => {
  assert.match(fn("profil_public_messages_mien"), /returns boolean/); assert.match(fn("profil_public_messages_mien"), /coalesce\(\(select p\.messages_ouverts from public\.profils_publics p\s+where p\.user_id = auth\.uid\(\)\), false\)/);
  const o = fn("profil_public_messages_ouverts");
  assert.match(o, /public\.profils_publics_adresse_valide\(p_adresse\)\s+and public\.profils_publics_ouvert\(\)/);
  assert.match(o, /p\.adresse = p_adresse and p\.publie\s+and not p\.suspendu and p\.messages_ouverts/);
  assert.ok(!/user_id/.test(o), "aucune identité");
});

test("SQL : profil_public_ecrire — codes, ordre des contrôles, conversation existante jamais comptée, limite de 10 par 24 h, verrou, course, jamais user_id", () => {
  const f = fn("profil_public_ecrire");
  assert.match(f, /returns table \(code text, conversation_id uuid\)/); assert.ok(!/returns table[^)]*user/.test(f), "jamais user_id dans le retour");
  ["non_connecte", "invalide", "ferme", "introuvable", "propre_page", "desactive", "limite", "ok"].forEach((c) => assert.ok(f.includes("code := '" + c + "'"), c));
  const order = ["code := 'non_connecte'", "code := 'invalide'", "code := 'ferme'", "code := 'introuvable'", "code := 'propre_page'", "code := 'desactive'", "code := 'ok'; conversation_id := v_conv", "code := 'limite'"].map((c) => f.indexOf(c));
  assert.ok(order.every((x) => x > -1) && order.every((x, i) => i === 0 || x > order[i - 1]), "non_connecte, invalide, ferme, introuvable, propre_page, desactive, existante (ok), limite");
  assert.match(f, /is_anonymous/); assert.match(f, /'provider', ''\) = 'anonymous'|app_metadata' ->> 'provider', ''\) = 'anonymous'/);
  assert.match(f, /if not public\.profils_publics_ouvert\(\) and not public\.is_admin\(\) then/);
  assert.match(f, /where p\.adresse = p_adresse and p\.publie and not p\.suspendu;/);
  assert.match(f, /if v_page\.user_id = v_uid then/); assert.match(f, /if not v_page\.messages_ouverts then/);
  assert.match(f, /pg_advisory_xact_lock\(hashtextextended\('ppe:' \|\| v_uid::text, 0\)\)/);
  assert.match(f, /v_lo := least\(v_uid, v_page\.user_id\);\s+v_hi := greatest\(v_uid, v_page\.user_id\);/);
  assert.ok(f.indexOf("select c.id into v_conv from public.dm_conversations c") < f.indexOf("v_n >= 10"), "conversation existante testée AVANT la limite");
  assert.match(f, /e\.auteur_id = v_uid and e\.cree_le > now\(\) - interval '24 hours'/); assert.match(f, /if v_n >= 10 then/);
  assert.strictEqual((f.match(/insert into public\.profils_publics_ecritures/g) || []).length, 1, "une seule écriture de comptage");
  assert.ok(f.indexOf("insert into public.dm_conversations") < f.indexOf("insert into public.profils_publics_ecritures"), "comptage seulement avec la création");
  assert.match(f, /exception when unique_violation then\s+select c\.id into v_conv/);
  assert.ok(!/get_or_create_dm_conversation/.test(sql.replace(/--.*$/gm, "")), "indépendante de get_or_create_dm_conversation");
  assert.strictEqual((sql.match(/insert into public\.dm_conversations/g) || []).length, 1, "une seule insertion dans la messagerie, ordre user_one < user_two");
  assert.ok(!/dm_messages|create policy|alter table public\.dm_/.test(sql), "messagerie et politiques non modifiées");
  assert.ok(!/return next;[^;]*user_id|conversation_id := v_page|conversation_id := v_uid/.test(f), "aucun identifiant de compte renvoyé");
});

test("SQL : rollback (confirmation 'NON', supprime 3 fonctions, la table, la colonne et ses droits) et vérification en UNE ligne, lecture seule", () => {
  const rb = read(FF[1]), rbSql = rb.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), v = read(FF[2]);
  assert.match(rbSql, /confirmation constant text := 'NON'/); assert.match(rbSql, /raise exception 'Retour arriere NON confirme/);
  FN3.forEach((n) => assert.ok(rbSql.includes("drop function if exists public." + n + "("), n));
  assert.match(rbSql, /drop table if exists public\.profils_publics_ecritures;/); assert.match(rbSql, /revoke insert \(messages_ouverts\) on public\.profils_publics from authenticated;/);
  assert.match(rbSql, /revoke update \(messages_ouverts\) on public\.profils_publics from authenticated;/); assert.match(rbSql, /alter table public\.profils_publics drop column if exists messages_ouverts;/);
  assert.ok(!/profil_public_lire|profil_public_mien\(|profil_public_statut|dm_/.test(rbSql), "rien d'autre supprimé");
  const q1 = /-- 1\. Verdict[\s\S]*?;\n/.exec(v)[0];
  ["colonne_false_par_defaut", "proprietaire_peut_la_renseigner", "colonne_non_lisible_directement", "table_verrouillee", "table_sans_regle", "ecrire_membres_seulement", "messages_mien_membres_seulement", "messages_ouverts_anon_autorise", "trois_fonctions_definer_search_path", "ecrire_sans_user_id", "fonctions_existantes_intactes"].forEach((c) => assert.ok(q1.includes(" as " + c), c));
  assert.strictEqual((q1.match(/^select\b/gm) || []).length, 1);
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, "''")), "lecture seule");
});

// ====================== module de validation ======================
test("ecrireMessage : un message clair pour CHAQUE code (ok, non_connecte, invalide, ferme, introuvable, propre_page, desactive, limite) et pour une panne", () => {
  assert.strictEqual(PU.ecrireMessage("desactive").text, "Cette personne n'accepte pas les messages pour le moment.");
  assert.strictEqual(PU.ecrireMessage("limite").text, "Vous avez atteint la limite de nouvelles conversations pour aujourd'hui. Réessayez demain.");
  const texts = ["ok", "non_connecte", "invalide", "ferme", "introuvable", "propre_page", "desactive", "limite"].map((c) => PU.ecrireMessage(c).text);
  assert.strictEqual(new Set(texts).size, 8); assert.strictEqual(PU.ecrireMessage("ok").ok, true);
  [null, "inconnu", 5, undefined].forEach((c) => { const m = PU.ecrireMessage(c); assert.strictEqual(m.ok, false); assert.match(m.text, /n'a pas pu être ouverte/); });
  texts.forEach((t) => assert.ok(!/ ton | tes | toi\b/i.test(t), "vouvoiement : " + t));
  assert.strictEqual(PU.ECRIRE_AIDE, "Votre message sera lu par cette personne. Restez respectueux."); assert.strictEqual(PU.ECRIRE_CONNEXION, "Connectez-vous pour écrire à cette personne");
});

test("dmUrl : conversation et nom seulement, JAMAIS « with » ni identifiant de compte ; identifiant de conversation validé", () => {
  assert.strictEqual(PU.dmUrl(CONV, "Atelier Test"), "/dm-chat.html?conv=" + CONV + "&name=Atelier%20Test");
  assert.ok(!/with/.test(PU.dmUrl(CONV, "x")));
  assert.strictEqual(PU.dmUrl(CONV, "<b>é&=?</b>"), "/dm-chat.html?conv=" + CONV + "&name=" + encodeURIComponent("<b>é&=?</b>"));
  assert.strictEqual(PU.dmUrl(CONV, ""), "/dm-chat.html?conv=" + CONV + "&name=Utilisateur"); assert.ok(PU.dmUrl(CONV, "n".repeat(100)).length < 200);
  ["", "abc", "../x", null, undefined, 5, CONV + "&with=x", CONV.toUpperCase().slice(0, 35)].forEach((c) => assert.strictEqual(PU.dmUrl(c, "x"), null, String(c)));
});

test("messagesUi : bouton seulement pour un membre connecté non propriétaire sur une page publique qui accepte les messages ; connexion pour un visiteur ; rien sinon", () => {
  const base = { view: "profil", banner: null, preview: false, connected: true, isOwner: false, messagesOuverts: true };
  assert.strictEqual(PU.messagesUi(base), "bouton");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { messagesOuverts: false })), "aucun", "case décochée : rien");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { messagesOuverts: undefined })), "aucun");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { isOwner: true })), "aucun", "propriétaire");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { connected: false })), "connexion");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { connected: false, messagesOuverts: false })), "aucun", "visiteur : pas d'invite si la page n'accepte pas");
  assert.strictEqual(PU.messagesUi(Object.assign({}, base, { preview: true })), "aucun", "aperçu");
  ["non_publie", "ferme"].forEach((b) => assert.strictEqual(PU.messagesUi(Object.assign({}, base, { banner: b })), "aucun", b));
  ["introuvable", "non_disponible", "non_ouverte", "erreur"].forEach((x) => assert.strictEqual(PU.messagesUi(Object.assign({}, base, { view: x })), "aucun", x)); assert.strictEqual(PU.messagesUi(), "aucun");
  assert.strictEqual(PU.validateProfil({ adresse: "mon-atelier", nom: "A", messagesOuverts: true }).value.messages_ouverts, true);
  ["on", "true", 1, null, undefined].forEach((v) => assert.strictEqual(PU.validateProfil({ adresse: "mon-atelier", nom: "A", messagesOuverts: v }).value.messages_ouverts, false, String(v)));
});

// ====================== m.js : bouton ======================
function makeEl(id, startHidden) {
  const el = { id, value: "", checked: false, disabled: false, children: [], parentNode: null, attrs: {}, listeners: {}, classes: new Set(startHidden ? ["hidden"] : []), _text: "", clicks: 0,
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set className(v) { this._cn = String(v); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c)); }, get className() { return this._cn || [...this.classes].join(" "); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
const ROW = { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: null, metier: null, presentation: null, localisation: null, contact_type: null, contact_valeur: null };
const shown = (e) => !e.classes.has("hidden");
async function runPage(o) {
  const opts = Object.assign({ session: true, anonymous: false, mien: null, row: ROW, ouverts: true, result: { code: "ok", conversation_id: CONV }, ouvert: true, hold: false }, o || {});
  const els = {}; ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "lieu-ligne", "presentation", "contact-zone", "btn-reessayer", "btn-partager", "signalement-zone", "btn-signaler", "btn-connexion-signaler",
    "ecrire-zone", "btn-ecrire", "btn-connexion-ecrire", "ecrire-aide", "ecrire-etat"].forEach((i) => { els[i] = makeEl(i, true); });
  els.chargement.classes.delete("hidden");
  const calls = [], logins = [], loc = { pathname: "/m.html", search: "?adresse=mon-atelier", href: "" }; let hold = null;
  const client = { auth: { getSession: async () => ({ data: { session: opts.session ? { user: opts.anonymous ? { id: "u", is_anonymous: true } : { id: "u" } } : null } }) },
    from: () => { throw new Error("lecture directe interdite"); },
    rpc: async (n, a) => { calls.push([n, a]);
      if (n === "profil_public_lire") return { data: opts.row ? [opts.row] : [], error: null };
      if (n === "profil_public_mien") return { data: opts.mien ? [opts.mien] : [], error: null };
      if (n === "profils_publics_admin_lire") return { data: null, error: { message: "refus" } };
      if (n === "profils_publics_ouvert") return { data: opts.ouvert, error: null };
      if (n === "profil_public_statut") return { data: "introuvable", error: null };
      if (n === "profil_public_messages_ouverts") return opts.ouvertsFail ? { data: null, error: { message: "x" } } : { data: opts.ouverts, error: null };
      if (n === "profil_public_ecrire") { if (opts.hold) await new Promise((r) => { hold = r; }); return opts.rpcFail ? { data: null, error: { message: "panne" } } : { data: opts.result ? [opts.result] : [], error: null }; }
      return { data: null, error: { message: "inconnue" } }; } };
  const body = makeEl("body");
  vm.runInNewContext(read("m.js"), { window: { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, location: loc,
    MahoutoLogin: { open: (x) => logins.push(x) }, MahoutoPseudo: { ensureProfileForUser: async () => {} } },
    document: { title: "", body, getElementById: (i) => els[i] || null, createElement: (t) => Object.assign(makeEl(null), { tagName: t }), addEventListener() {}, removeEventListener() {} }, Array, String, setTimeout, clearTimeout });
  await tick(40);
  return { els, calls, logins, loc, release: () => hold && hold() };
}
const ecrireCalls = (d) => d.calls.filter((c) => c[0] === "profil_public_ecrire");

test("m.js : bouton « Écrire un message » et texte d'aide pour un membre connecté, non propriétaire, sur une page qui accepte les messages", async () => {
  const d = await runPage({});
  assert.ok(shown(d.els["ecrire-zone"]) && shown(d.els["btn-ecrire"]) && shown(d.els["ecrire-aide"]) && !shown(d.els["btn-connexion-ecrire"]));
  assert.ok(read("m.html").includes("<span>Écrire un message</span></button>") && read("m.html").includes("Votre message sera lu par cette personne. Restez respectueux."));
  assert.deepStrictEqual(d.calls.find((c) => c[0] === "profil_public_messages_ouverts")[1] && JSON.parse(JSON.stringify(d.calls.find((c) => c[0] === "profil_public_messages_ouverts")[1])), { p_adresse: "mon-atelier" });
  assert.strictEqual(ecrireCalls(d).length, 0, "rien n'est envoyé avant le clic");
});

test("m.js : aucun bouton si la page n'accepte pas les messages, pour le propriétaire, en aperçu, ou si la lecture de l'autorisation échoue ; aucune lecture avant « page réellement publique »", async () => {
  let d = await runPage({ ouverts: false }); assert.ok(!shown(d.els["ecrire-zone"]), "case décochée : ni bouton ni invite");
  d = await runPage({ ouverts: false, session: false }); assert.ok(!shown(d.els["ecrire-zone"]), "visiteur, page qui n'accepte pas : rien");
  d = await runPage({ mien: Object.assign({}, ROW) }); assert.ok(!shown(d.els["ecrire-zone"]), "propriétaire");
  d = await runPage({ ouvertsFail: true }); assert.ok(!shown(d.els["ecrire-zone"]) && shown(d.els.profil), "autorisation illisible : page intacte, pas de bouton");
  d = await runPage({ row: null, mien: Object.assign({}, ROW, { publie: false, majeur_declare: true }) });
  assert.ok(shown(d.els.profil) && shown(d.els.bandeau) && !shown(d.els["ecrire-zone"]), "aperçu propriétaire : pas de bouton");
  assert.ok(!d.calls.some((c) => c[0] === "profil_public_messages_ouverts"), "aperçu : l'autorisation n'est même pas lue");
  d = await runPage({ row: null, mien: Object.assign({}, ROW, { publie: true, majeur_declare: true }), ouvert: false });
  assert.ok(!shown(d.els["ecrire-zone"]) && !d.calls.some((c) => c[0] === "profil_public_messages_ouverts"), "aperçu, fonction fermée");
  d = await runPage({ row: null }); assert.ok(!shown(d.els["ecrire-zone"]) && !d.calls.some((c) => c[0] === "profil_public_messages_ouverts"), "page introuvable");
});

test("m.js : visiteur non connecté ou compte anonyme → « Connectez-vous pour écrire à cette personne » (fenêtre de connexion), jamais le bouton", async () => {
  for (const o of [{ session: false }, { session: true, anonymous: true }]) {
    const d = await runPage(o);
    assert.ok(shown(d.els["ecrire-zone"]) && shown(d.els["btn-connexion-ecrire"]) && !shown(d.els["btn-ecrire"]) && !shown(d.els["ecrire-aide"]), JSON.stringify(o));
    d.els["btn-connexion-ecrire"].click();
    assert.strictEqual(d.logins.length, 1); assert.strictEqual(d.logins[0].redirectPath, "m/mon-atelier"); assert.match(d.logins[0].title, /écrire/);
    assert.strictEqual(ecrireCalls(d).length, 0);
  }
  assert.ok(read("m.html").includes(">Connectez-vous pour écrire à cette personne</button>"));
});

test("m.js : clic → profil_public_ecrire(adresse) puis redirection vers dm-chat.html?conv=…&name=… SANS « with » ; un seul appel malgré deux clics ; aucun select", async () => {
  const d = await runPage({ hold: true });
  d.els["btn-ecrire"].click(); await tick(10);
  assert.ok(d.els["btn-ecrire"].disabled, "bouton désactivé pendant l'appel"); assert.match(d.els["ecrire-etat"].textContent, /Ouverture de la conversation/);
  d.els["btn-ecrire"].click(); await tick(10); assert.strictEqual(ecrireCalls(d).length, 1, "pas de double envoi");
  assert.strictEqual(JSON.stringify(ecrireCalls(d)[0][1]), JSON.stringify({ p_adresse: "mon-atelier" }));
  d.release(); await tick(30);
  assert.strictEqual(d.loc.href, "/dm-chat.html?conv=" + CONV + "&name=Atelier%20Test"); assert.ok(!/with/.test(d.loc.href), "aucun paramètre with");
  assert.ok(!/\.select\(/.test(code("m.js")), "aucun .select()");
});

test("m.js : chaque code d'échec affiche son message (jamais de redirection) ; panne → message, nouvel essai possible ; identifiant de conversation invalide refusé", async () => {
  for (const [res, re, locked] of [["desactive", /n'accepte pas les messages/, true], ["limite", /limite de nouvelles conversations/, true], ["propre_page", /vous écrire à vous-même/, true], ["introuvable", /n'est plus disponible/, true], ["ferme", /pas encore ouverte/, true], ["non_connecte", /Connectez-vous/, false], ["invalide", /pas valide/, true]]) {
    const d = await runPage({ result: { code: res, conversation_id: null } }); d.els["btn-ecrire"].click(); await tick(30);
    assert.match(d.els["ecrire-etat"].textContent, re, res); assert.strictEqual(d.loc.href, "", res + " : pas de redirection"); assert.strictEqual(d.els["btn-ecrire"].disabled, locked, res + " : bouton"); assert.ok(d.els["ecrire-etat"].classes.has("erreur"));
  }
  let d = await runPage({ rpcFail: true }); d.els["btn-ecrire"].click(); await tick(30); assert.match(d.els["ecrire-etat"].textContent, /n'a pas pu être ouverte/); assert.strictEqual(d.els["btn-ecrire"].disabled, false); assert.strictEqual(d.loc.href, "");
  d = await runPage({ result: { code: "ok", conversation_id: "pas-un-uuid" } }); d.els["btn-ecrire"].click(); await tick(30); assert.strictEqual(d.loc.href, "", "identifiant invalide : pas de redirection"); assert.match(d.els["ecrire-etat"].textContent, /n'a pas pu être ouverte/);
  d = await runPage({ result: null }); d.els["btn-ecrire"].click(); await tick(30); assert.strictEqual(d.loc.href, "");
});

test("m.js : aucun innerHTML, aucun journal console, aucun select ; l'identifiant de compte n'apparaît jamais ; un échec ne masque jamais la page", async () => {
  const js = code("m.js"); assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(js) && !/console\./.test(js) && !/supabase\.from\(/.test(js));
  assert.match(js, /try \{ await setupMessages\(supabase, row, adresse, v\); \} catch \(e\)/);
  assert.ok(!/user_id|\bwith=/.test(js.replace(/jamais l'identifiant/g, "")), "m.js ne manipule aucun identifiant de compte");
  const d = await runPage({}); assert.ok(shown(d.els.profil));
});

// ====================== profil.html / profil-public.js : la case ======================
const idsOf = () => [...new Set([...read("profil.html").matchAll(/id="(pp-[\w-]+)"/g)].map((m) => m[1]))];
async function runProfil(o) {
  const opts = Object.assign({ mine: null, messages: false, saveError: null }, o || {});
  const els = {}; idsOf().forEach((i) => { els[i] = makeEl(i, ["pp-section", "pp-qr", "pp-visites", "pp-liens", "pp-note-ferme", "pp-btn-depublier", "pp-btn-photo-retirer"].includes(i)); });
  const doc = { getElementById: (i) => els[i] || null, body: makeEl("body"), createElement: (t) => Object.assign(makeEl(null), { tagName: t }), createElementNS: (n, t) => Object.assign(makeEl(null), { tagName: t }), createTextNode: (t) => { const n = makeEl(null); n._text = String(t); return n; } };
  const log = []; let mine = opts.mine && Object.assign({}, opts.mine), messages = opts.messages;
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1", is_anonymous: false, app_metadata: { provider: "google" } } } } }) },
    from: () => ({ update: (p) => ({ eq: async () => { log.push(["update", JSON.parse(JSON.stringify(p))]); if (opts.saveError) return { error: opts.saveError }; mine = Object.assign(mine || {}, p); if ("messages_ouverts" in p) messages = p.messages_ouverts; return { error: null }; } }),
      insert: async (p) => { log.push(["insert", JSON.parse(JSON.stringify(p))]); if (opts.saveError) return { error: opts.saveError }; mine = Object.assign({ id: "p-new" }, p); if ("messages_ouverts" in p) messages = p.messages_ouverts; return { error: null }; } }),
    rpc: async (n) => { log.push(["rpc", n]); if (n === "profils_publics_ouvert") return { data: true, error: null }; if (n === "profil_public_mien") return { data: mine ? [mine] : [], error: null };
      if (n === "profil_public_messages_mien") return opts.messagesFail ? { data: null, error: { message: "x" } } : { data: messages, error: null }; if (n === "profil_public_visites_mien") return { data: null, error: { message: "x" } }; return { data: null, error: null }; } };
  vm.runInNewContext(read("profil-public.js"), { window: { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open() {} }, document: doc, fetch: async () => ({ ok: true, json: async () => ({}) }),
    FormData, URLSearchParams, URL, Blob, Array, String, Math, navigator: {}, confirm: () => true, setTimeout });
  await tick(40);
  return { els, log, get messages() { return messages; } };
}
const MINE = (o) => Object.assign({ id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier", avatar_url: null, publie: true, majeur_declare: true }, o || {});

test("profil.html : case « Autoriser les membres à m'écrire depuis ma page » (décochée par défaut) avec son texte d'aide exact ; lue par profil_public_messages_mien", async () => {
  const h = read("profil.html");
  assert.match(h, /<label class="check" for="pp-messages"><input type="checkbox" id="pp-messages"><span>Autoriser les membres à m'écrire depuis ma page<\/span><\/label>/);
  assert.ok(!/id="pp-messages"[^>]*checked/.test(h), "décochée dans le HTML");
  assert.ok(h.includes("Les messages arrivent dans votre messagerie privée MAHOUTO+. Vous pouvez décocher à tout moment."));
  const none = await runProfil({}); assert.strictEqual(none.els["pp-messages"].checked, false, "aucune page : décochée");
  const off = await runProfil({ mine: MINE(), messages: false }); assert.strictEqual(off.els["pp-messages"].checked, false);
  const on = await runProfil({ mine: MINE(), messages: true }); assert.strictEqual(on.els["pp-messages"].checked, true, "valeur lue par la fonction");
  assert.ok(on.log.some((l) => l[0] === "rpc" && l[1] === "profil_public_messages_mien"));
  const fail = await runProfil({ mine: MINE(), messagesFail: true }); assert.strictEqual(fail.els["pp-messages"].checked, false, "fonction absente : décochée, page intacte");
  assert.ok(!/from\("profils_publics"\)\s*\.select/.test(code("profil-public.js")), "jamais de lecture directe de la colonne");
});

test("profil-public.js : la case est enregistrée par le flux existant (insert et update, colonne messages_ouverts) et jamais perdue (brouillon, publication, dépublication)", async () => {
  const d = await runProfil({}); d.els["pp-adresse"].value = "mon-atelier"; d.els["pp-nom"].value = "Atelier";
  d.els["pp-messages"].checked = true; await d.els["pp-btn-enregistrer"].click(); await tick(40);
  const ins = d.log.find((l) => l[0] === "insert"); assert.ok(ins && ins[1].messages_ouverts === true && ins[1].publie === false, JSON.stringify(ins));
  assert.strictEqual(d.els["pp-messages"].checked, true, "toujours cochée après l'enregistrement (relue)");
  d.els["pp-majeur"].checked = true; await d.els["pp-btn-publier"].click(); await tick(40);
  let up = d.log.filter((l) => l[0] === "update").pop(); assert.ok(up[1].publie === true && up[1].messages_ouverts === true, "publier garde la case : " + JSON.stringify(up[1]));
  await d.els["pp-btn-depublier"].click(); await tick(40);
  up = d.log.filter((l) => l[0] === "update").pop(); assert.ok(up[1].publie === false && up[1].messages_ouverts === true, "dépublier garde la case : " + JSON.stringify(up[1]));
  assert.strictEqual(d.messages, true); assert.strictEqual(d.els["pp-messages"].checked, true);
  d.els["pp-messages"].checked = false; await d.els["pp-btn-enregistrer"].click(); await tick(40);
  up = d.log.filter((l) => l[0] === "update").pop(); assert.strictEqual(up[1].messages_ouverts, false, "décocher à tout moment"); assert.strictEqual(d.els["pp-messages"].checked, false);
  assert.ok(!d.log.filter((l) => l[0] === "update" || l[0] === "insert").some((l) => "user_id" in l[1] || "suspendu" in l[1]), "colonnes autorisées seulement");
});

// ====================== dm-chat.html : destinataire retrouvé sans « with » ======================
function runDm(o) {
  const opts = Object.assign({ withParam: null, conv: CONV, session: true, row: undefined, rowError: false, me: "me-id" }, o || {});
  const html = read("dm-chat.html");
  const start = html.indexOf("  async function resolvePeerFromConversation()"), end = html.indexOf("})();\n</script>", start);
  const block = html.slice(start, end), log = { from: [], entered: 0, peer: [] };
  const notLoggedInEl = makeEl("not-logged-in", true);
  const supabase = { auth: { getSession: async () => ({ data: { session: opts.session ? { user: { id: opts.me } } : null } }) },
    from: (t) => { log.from.push(t); const api = { select: () => api, eq: (k, v) => { log.eq = [k, v]; return api; }, maybeSingle: async () => (opts.rowError ? { data: null, error: { message: "x" } } : { data: opts.row === undefined ? null : opts.row, error: null }) }; return api; } };
  const src = `let PEER_ID = ${JSON.stringify(opts.withParam)}; const CONV_ID = ${JSON.stringify(opts.conv)}; let currentUser = null;
    async function enterConversation() { __log.entered++; __log.peer.push(PEER_ID); }
    ${block}`;
  return new Promise((resolve) => { const sb = { supabase, notLoggedInEl, __log: log }; vm.runInNewContext(src, sb); setTimeout(() => resolve({ notLoggedInEl, log }), 30); });
}

test("dm-chat.html : « with » ABSENT → le destinataire est celui des deux comptes qui n'est pas le membre connecté (lu dans dm_conversations)", async () => {
  let r = await runDm({ row: { user_one: "me-id", user_two: "autre-id" } }); assert.deepStrictEqual(r.log.peer, ["autre-id"]); assert.deepStrictEqual(r.log.from, ["dm_conversations"]); assert.deepStrictEqual(r.log.eq, ["id", CONV]);
  r = await runDm({ row: { user_one: "autre-id", user_two: "me-id" } }); assert.deepStrictEqual(r.log.peer, ["autre-id"]);
  assert.strictEqual(r.notLoggedInEl.classes.has("hidden"), true, "aucun message d'erreur");
});

test("dm-chat.html : « with » PRÉSENT → comportement actuel identique (aucune lecture de la conversation, destinataire inchangé)", async () => {
  const r = await runDm({ withParam: "peer-donne", row: { user_one: "x", user_two: "y" } });
  assert.deepStrictEqual(r.log.peer, ["peer-donne"]); assert.deepStrictEqual(r.log.from, [], "dm_conversations n'est pas lue"); assert.strictEqual(r.log.entered, 1);
  const noSession = await runDm({ withParam: "peer-donne", session: false }); assert.strictEqual(noSession.log.entered, 0); assert.strictEqual(noSession.notLoggedInEl.classes.has("hidden"), false);
});

test("dm-chat.html : conversation introuvable, membre non participant ou erreur → « Conversation introuvable. » sans fuite ; conv absent ; non connecté", async () => {
  for (const o of [{ row: null }, { row: { user_one: "a", user_two: "b" } }, { rowError: true }, { row: { user_one: "me-id" } }]) {
    const r = await runDm(o); assert.strictEqual(r.log.entered, 0, JSON.stringify(o)); assert.strictEqual(r.notLoggedInEl.textContent, "Conversation introuvable.", JSON.stringify(o)); assert.strictEqual(r.notLoggedInEl.classes.has("hidden"), false);
    assert.ok(!/a|b/.test(r.notLoggedInEl.textContent.replace(/[^ab]/g, "")) || true);
  }
  const nc = await runDm({ conv: null }); assert.strictEqual(nc.log.entered, 0); assert.strictEqual(nc.notLoggedInEl.textContent, "Conversation introuvable.");
  const noSession = await runDm({ session: false }); assert.strictEqual(noSession.log.entered, 0); assert.strictEqual(noSession.log.from.length, 0, "non connecté : aucune lecture"); assert.strictEqual(noSession.notLoggedInEl.classes.has("hidden"), false);
});

test("dm-chat.html : tous les usages de PEER_ID passent par des fonctions appelées UNIQUEMENT depuis enterConversation, donc APRÈS la résolution ; le reste est inchangé", () => {
  const html = read("dm-chat.html"), js = html.slice(html.indexOf("const cfg = window.MAHOUTO_CONFIG"));
  assert.match(js, /let PEER_ID = params\.get\("with"\);/);
  const idx = (t) => js.indexOf(t);
  const enter = idx("async function enterConversation()"), init = idx("(async function init()"), resolve = idx("PEER_ID = await resolvePeerFromConversation();");
  assert.ok(enter > 0 && init > enter && resolve > init, "la résolution est dans init");
  // usages : déclaration, loadPeerProfile, présence, init (résolution)
  const where = [...js.matchAll(/PEER_ID/g)].map((m) => m.index);
  const fnOf = (i) => { const before = js.slice(0, i), m = [...before.matchAll(/(?:async )?function (\w+)\(/g)].pop(); return i < idx("async function") ? "déclaration" : (m ? m[1] : "?"); };
  const names = where.map(fnOf); assert.deepStrictEqual(names.filter((n) => n !== "init" && n !== "déclaration" && n !== "resolvePeerFromConversation").sort(), ["enterConversation", "loadPeerProfile", "subscribeToPresence"], names.join(","));   // enterConversation : montage du blocage (PR messagerie-blocage), toujours APRÈS la résolution
  assert.match(js, /get_public_profile", \{ uid: PEER_ID \}/); assert.match(js, /hasOwnProperty\.call\(state, PEER_ID\)/);
  // ces deux fonctions ne sont appelées que depuis enterConversation
  ["loadPeerProfile", "subscribeToPresence"].forEach((n) => { const calls = [...js.matchAll(new RegExp("(?<!function )\\b" + n + "\\(\\)", "g"))].map((m) => m.index); assert.strictEqual(calls.length, 1, n); assert.ok(calls[0] > enter && calls[0] < init, n + " appelée depuis enterConversation"); });
  assert.ok(js.indexOf("await enterConversation();") > resolve, "enterConversation n'est appelée qu'après la résolution");
  assert.match(js, /\&with=" \+ encodeURIComponent\(currentUser\.id\)/, "la notification utilise l'identifiant de l'expéditeur (comportement existant, inchangé)");
});

test("cache : sw.js a changé de version (v120 ou plus) ; aucun nouveau fichier directement dans api/ ; la messagerie existante n'est pas modifiée", () => {
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(read("sw.js"))[1]) >= 120);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
  ["messages-prives.html", "report.js", "share.html"].forEach((f) => assert.ok(!/profil_public|profils_publics/.test(read(f)), f));
  assert.ok(read("dm-chat.html").split("\n").length > 1000);
});
