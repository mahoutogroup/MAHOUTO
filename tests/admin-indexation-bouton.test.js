/* Écran administrateur : autoriser ou retirer l'indexation Google d'une page de membre (admin/profils-publics.js et .html,
   profils-publics-indexable-admin.sql + rollback + vérification, sw.js). Lecture statique des SQL (jamais exécutés ici),
   interface exécutée dans un faux DOM avec un faux client. Aucun réseau. */
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
const JS = code("admin/profils-publics.js");

// ====================== SQL ======================
const SQL = read("profils-publics-indexable-admin.sql"), ROLL = read("profils-publics-indexable-admin-rollback.sql"), VERIF = read("profils-publics-indexable-admin-verification.sql");
const sqlCode = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
test("SQL : fonction administrateurs seulement, une seule colonne (adresse), droits resserrés, additive", () => {
  const c = sqlCode(SQL);
  assert.match(c, /create or replace function public\.profils_publics_admin_indexables\(\)\s+returns table \(adresse text\)/);
  assert.match(c, /\bstable\b/); assert.match(c, /security definer/); assert.match(c, /set search_path = public, pg_temp/);
  assert.match(c, /if not public\.is_admin\(\) then\s+raise exception 'Reserve aux administrateurs\.';/);
  assert.match(c, /select p\.adresse\s+from public\.profils_publics p\s+where p\.indexable/);
  assert.match(c, /revoke all on function public\.profils_publics_admin_indexables\(\) from public, anon;/);
  assert.match(c, /grant execute on function public\.profils_publics_admin_indexables\(\) to authenticated;/);
  assert.ok(!/user_id|p\.id\b|email|e-mail|\bid uuid/i.test(c), "ni id, ni user_id, ni e-mail");
  assert.ok(!/drop function|alter table|create table|profils_publics_admin_lister|profil_public_lire|create or replace function public\.profils_publics_admin_indexable\(/.test(c), "additif : rien d'existant n'est modifié ni supprimé");
  assert.match(c, /column_name = 'indexable'/); assert.match(c, /to_regprocedure\('public\.profils_publics_admin_indexable\(text, boolean\)'\) is null/, "prérequis vérifiés avec un message clair");
  assert.strictEqual((SQL.match(/^-- BLOC \d/gm) || []).length, 2);
});
test("SQL : conventions de l'éditeur mobile (lignes ≤ 105, commentaires sans apostrophe, $$ appariés) ; rollback et vérification présents", () => {
  [SQL, ROLL, VERIF].forEach((t, i) => { t.split("\n").forEach((l, n) => assert.ok(l.length <= 105, "fichier " + i + " ligne " + (n + 1)));
    t.split("\n").filter((l) => /^\s*--/.test(l)).forEach((l) => assert.ok(!/'/.test(l), "apostrophe dans un commentaire : " + l)); assert.ok(!/eyJ|sk_live|apikey|@\w+\.\w+/i.test(t), "aucune clé ni e-mail"); });
  assert.strictEqual((SQL.match(/\$\$/g) || []).length % 2, 0);
  assert.match(ROLL, /drop function if exists public\.profils_publics_admin_indexables\(\);/); assert.ok(!/drop column|drop table/.test(ROLL), "le rollback ne touche pas aux données");
  assert.strictEqual((VERIF.match(/^select\b/gm) || []).length, 1, "une seule requête");
  ["fonction_existe", "security_definer_search_path", "anon_sans_droit", "authenticated_avec_droit"].forEach((c) => assert.ok(VERIF.includes(c), c));
  assert.match(VERIF, /not has_function_privilege\('anon', 'public\.profils_publics_admin_indexables\(\)', 'execute'\)/);
  assert.match(VERIF, /has_function_privilege\('authenticated', 'public\.profils_publics_admin_indexables\(\)',\s+'execute'\)/);
});

// ====================== interface (lecture statique) ======================
test("interface : appelle les deux fonctions, libellés, condition d'« Autoriser Google », pas d'innerHTML, aide en vouvoiement", () => {
  assert.match(JS, /rpc\("profils_publics_admin_indexables"\)/); assert.match(JS, /rpc\("profils_publics_admin_indexable", \{ p_adresse: adresse, p_indexable: autoriser \}\)/);
  assert.ok(JS.includes('"Autoriser Google"') && JS.includes('"Retirer de Google"') && JS.includes('"Visible sur Google"') && JS.includes('"Non indexée"') && JS.includes('"Indexation : SQL à exécuter."'));
  assert.match(JS, /else if \(r\.publie === true && r\.suspendu !== true\) \{\s*var autoriser/, "Autoriser Google : publiée ET non suspendue ET non indexée");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(JS), "aucun innerHTML"); assert.ok(!/user_id|\.email|e-mail/i.test(JS), "aucun identifiant ni e-mail");
  assert.ok(!/profils_publics_admin_lister["'],\s*\{/.test(JS)); assert.match(read("admin/profils-publics.js"), /Indexation Google : badge/, "en-tête mis à jour");
  const html = read("admin/profils-publics.html");
  assert.ok(html.includes("Une page n'apparaît sur Google que si elle est publiée, non suspendue, que l'interrupteur général est ouvert ET que vous l'avez autorisée ici. Google met de quelques heures à quelques semaines à la prendre en compte. La suspension ou le retrait la rend invisible pour Google dans la minute qui suit."));
  assert.ok(html.indexOf('id="liste-pages"') < html.indexOf("Une page n'apparaît sur Google"), "l'aide est sous la liste");
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(146|14[7-9]|1[5-9]\d)";/);
});

// ====================== interface (exécutée) ======================
function makeEl(id) {
  const el = { id, children: [], attrs: {}, _t: "", classes: new Set(), listeners: {}, value: "", disabled: false,
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
const cls = (n) => n.className || n.attrs.class;
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const findAll = (r, p) => { const o = []; walk(r, (n) => { if (p(n)) o.push(n); }); return o; };
const ROWS = () => [
  { id: "id-1", user_id: "USER-SECRET-1", adresse: "page-publiee", nom_affiche: "Publiée A", publie: true, suspendu: false, publie_le: "2026-11-20T10:00:00Z" },
  { id: "id-2", user_id: "USER-SECRET-2", adresse: "deja-indexee", nom_affiche: "Indexée B", publie: true, suspendu: false, publie_le: "2026-11-20T10:00:00Z" },
  { id: "id-3", user_id: "USER-SECRET-3", adresse: "suspendue-indexee", nom_affiche: "Suspendue C", publie: true, suspendu: true, publie_le: "2026-11-20T10:00:00Z" },
  { id: "id-4", user_id: "USER-SECRET-4", adresse: "brouillon-dep", nom_affiche: "Brouillon D", publie: false, suspendu: false, publie_le: null },
  { id: "id-5", user_id: "USER-SECRET-5", adresse: "suspendue-non", nom_affiche: "Suspendue E", publie: true, suspendu: true, publie_le: "2026-11-20T10:00:00Z" }];
async function runAdmin(o) {
  const opts = Object.assign({ indexables: ["deja-indexee", "suspendue-indexee"], idxFail: false, idxThrows: false, action: true, confirmAnswer: true }, o || {});
  const ids = [...new Set([...read("admin/profils-publics.html").matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))], els = {}; ids.forEach((i) => { els[i] = makeEl(i); });
  ["access-denied", "dashboard", "bandeau-ouvert"].forEach((i) => els[i].classes.add("hidden"));
  const log = { rpc: [], confirm: [] }, state = { idx: new Set(opts.indexables) };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: async () => (t === "profiles" ? { data: { role: "admin" }, error: null } : { data: { valeur: "non", maj_le: null }, error: null }), then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) }; return api; },
    rpc: async (n, a) => { log.rpc.push([n, a]);
      if (n === "profils_publics_admin_lister") return { data: ROWS(), error: null };
      if (n === "profils_publics_admin_indexables") { if (opts.idxThrows) throw new Error("réseau"); return opts.idxFail ? { data: null, error: { message: "function does not exist" } } : { data: [...state.idx].map((adresse) => ({ adresse })), error: null }; }
      if (n === "profils_publics_admin_indexable") { if (opts.action === true) { if (a.p_indexable) state.idx.add(a.p_adresse); else state.idx.delete(a.p_adresse); } return opts.action === "erreur" ? { data: null, error: { message: "Reserve aux administrateurs." } } : { data: opts.action, error: null }; }
      if (n === "profils_publics_admin_suspendre") return { data: true, error: null };
      return { data: [], error: null }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open: () => {} };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: { getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }) }, confirm: (m) => { log.confirm.push(m); return opts.confirmAnswer; }, Array, String, Date, Set, Promise, Number, setInterval: () => 1 });
  await tick(50); return { els, log, state };
}
const cards = (d) => findAll(d.els["liste-pages"], (n) => cls(n) === "card item");
const card = (d, adresse) => cards(d).find((c) => findAll(c, (n) => cls(n) === "meta")[0].textContent === "/m/" + adresse);
const btns = (c) => findAll(c, (n) => /^btn( |$)/.test(cls(n) || "") && n.tagName === "button").map((b) => b.textContent);
const badges = (c) => findAll(c, (n) => /^badge/.test(cls(n) || "")).map((b) => b.textContent);
const calls = (d, n) => d.log.rpc.filter((c) => c[0] === n);

test("badges et boutons : « Visible sur Google » / « Non indexée » ; Autoriser seulement publiée + non suspendue + non indexée ; Retirer dès qu'indexée (même suspendue)", async () => {
  const d = await runAdmin(); assert.strictEqual(cards(d).length, 5);
  assert.strictEqual(calls(d, "profils_publics_admin_indexables").length, 1, "une lecture des adresses indexables"); assert.strictEqual(calls(d, "profils_publics_admin_lister").length, 1);
  assert.deepStrictEqual(badges(card(d, "page-publiee")), ["Publiée", "Non indexée"]); assert.deepStrictEqual(badges(card(d, "deja-indexee")), ["Publiée", "Visible sur Google"]);
  assert.deepStrictEqual(badges(card(d, "suspendue-indexee")), ["Suspendue", "Visible sur Google"]); assert.deepStrictEqual(badges(card(d, "brouillon-dep")), ["Brouillon", "Non indexée"]);
  assert.deepStrictEqual(btns(card(d, "page-publiee")), ["Voir", "Suspendre", "Autoriser Google"]);
  assert.deepStrictEqual(btns(card(d, "deja-indexee")), ["Voir", "Suspendre", "Retirer de Google"]);
  assert.deepStrictEqual(btns(card(d, "suspendue-indexee")), ["Voir", "Réactiver", "Retirer de Google"], "indexée et suspendue : on peut la retirer");
  assert.deepStrictEqual(btns(card(d, "brouillon-dep")), ["Voir", "Suspendre"], "brouillon non indexé : aucun bouton d'indexation");
  assert.deepStrictEqual(btns(card(d, "suspendue-non")), ["Voir", "Réactiver"], "suspendue non indexée : pas d'Autoriser");
});

test("« Autoriser Google » : confirmation avec le texte exact avant tout appel ; refus = rien ; acceptation = rpc(p_adresse, p_indexable true), liste rechargée, message", async () => {
  let d = await runAdmin({ confirmAnswer: false }); findAll(card(d, "page-publiee"), (n) => n.textContent === "Autoriser Google")[0].click(); await tick(30);
  assert.deepStrictEqual(d.log.confirm, ["Autoriser Google à afficher la page /m/page-publiee (nom, métier, ville, présentation) ? Faites-le seulement si le membre l'a demandé clairement, de préférence par écrit."]);
  assert.strictEqual(calls(d, "profils_publics_admin_indexable").length, 0, "refus : aucun appel");
  d = await runAdmin(); findAll(card(d, "page-publiee"), (n) => n.textContent === "Autoriser Google")[0].click(); await tick(60);
  assert.strictEqual(JSON.stringify(calls(d, "profils_publics_admin_indexable")), JSON.stringify([["profils_publics_admin_indexable", { p_adresse: "page-publiee", p_indexable: true }]]));
  assert.strictEqual(calls(d, "profils_publics_admin_lister").length, 2, "liste rechargée"); assert.strictEqual(d.els["msg-liste"].textContent, "Page autorisée pour Google."); assert.ok(!d.els["msg-liste"].classes.has("error"));
  assert.deepStrictEqual(badges(card(d, "page-publiee")), ["Publiée", "Visible sur Google"]); assert.ok(btns(card(d, "page-publiee")).includes("Retirer de Google"));
});

test("« Retirer de Google » : confirmation courte ; acceptation = rpc(p_indexable false), liste rechargée, message ; échecs : « Action impossible : … »", async () => {
  let d = await runAdmin({ confirmAnswer: false }); findAll(card(d, "deja-indexee"), (n) => n.textContent === "Retirer de Google")[0].click(); await tick(30);
  assert.deepStrictEqual(d.log.confirm, ["Retirer la page /m/deja-indexee de Google ?"]); assert.strictEqual(calls(d, "profils_publics_admin_indexable").length, 0);
  d = await runAdmin(); findAll(card(d, "suspendue-indexee"), (n) => n.textContent === "Retirer de Google")[0].click(); await tick(60);
  assert.strictEqual(JSON.stringify(calls(d, "profils_publics_admin_indexable")), JSON.stringify([["profils_publics_admin_indexable", { p_adresse: "suspendue-indexee", p_indexable: false }]]));
  assert.strictEqual(d.els["msg-liste"].textContent, "Page retirée de Google."); assert.deepStrictEqual(badges(card(d, "suspendue-indexee")), ["Suspendue", "Non indexée"]);
  for (const action of [false, "erreur"]) { d = await runAdmin({ action }); findAll(card(d, "page-publiee"), (n) => n.textContent === "Autoriser Google")[0].click(); await tick(40);
    assert.ok(d.els["msg-liste"].classes.has("error"), String(action)); assert.match(d.els["msg-liste"].textContent, /^Action impossible : .+\.$/); assert.strictEqual(calls(d, "profils_publics_admin_lister").length, 1, "pas de rechargement après un échec"); }
  assert.match((await (async () => { const x = await runAdmin({ action: "erreur" }); findAll(card(x, "page-publiee"), (n) => n.textContent === "Autoriser Google")[0].click(); await tick(40); return x.els["msg-liste"].textContent; })()), /Reserve aux administrateurs/);
});

test("SQL pas encore exécuté (fonction absente, erreur ou panne) : la liste s'affiche, sans badge ni bouton d'indexation, message discret « Indexation : SQL à exécuter. »", async () => {
  for (const o of [{ idxFail: true }, { idxThrows: true }]) {
    const d = await runAdmin(o); assert.strictEqual(cards(d).length, 5, "la liste reste affichée");
    assert.strictEqual(d.els["msg-liste"].textContent, "Indexation : SQL à exécuter."); assert.ok(!d.els["msg-liste"].classes.has("error"), "discret : pas en rouge");
    cards(d).forEach((c) => { assert.ok(!badges(c).some((b) => /Google|indexée/.test(b)), "aucun badge d'indexation"); assert.ok(!btns(c).some((b) => /Google/.test(b)), "aucun bouton d'indexation"); });
    assert.deepStrictEqual(btns(card(d, "page-publiee")), ["Voir", "Suspendre"], "Suspendre et Voir continuent de fonctionner");
  }
  const ok = await runAdmin(); assert.strictEqual(ok.els["msg-liste"].textContent, "");
});

test("aucun identifiant de compte ni e-mail affiché ; texte dynamique en texte brut ; suspension existante inchangée", async () => {
  const d = await runAdmin(); const all = d.els["liste-pages"].textContent; assert.ok(!/USER-SECRET|id-[1-5]|@/.test(all), "ni user_id, ni id, ni e-mail dans la liste");
  const susp = findAll(card(d, "page-publiee"), (n) => n.textContent === "Suspendre")[0]; susp.click(); await tick(40);
  assert.strictEqual(JSON.stringify(calls(d, "profils_publics_admin_suspendre").map((c) => c[1])), JSON.stringify([{ p_id: "id-1", p_suspendu: true }]), "la suspension passe toujours par profils_publics_admin_suspendre(p_id)");
  assert.strictEqual(calls(d, "profils_publics_admin_indexables").length, 2, "badges relus après la suspension");
});
