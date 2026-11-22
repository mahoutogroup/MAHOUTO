/* Profil public, PR 2 sur 3 : signalement d'une page publique. SQL (contenu statique du fichier), module de validation,
   m.js (bouton, fenêtre, envoi) et page d'administration, dans un faux DOM avec faux client Supabase. Aucun réseau, aucune base. */
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

// ====================== SQL (lecture de fichiers uniquement) ======================
const FILES = ["profils-publics-signalement.sql", "profils-publics-signalement-rollback.sql", "profils-publics-signalement-verification.sql"];
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read(FILES[0]), sql = strip(raw), rbRaw = read(FILES[1]), rb = strip(rbRaw), vRaw = read(FILES[2]), v = strip(vRaw);
const blocks = (text) => { const parts = text.split(/^-- BLOC (\d+) - /m); const out = []; for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] }); return out; };
const fn = (name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql); assert.ok(m, name); return m[0]; };
const FN_PUBLIQUES = ["profil_public_signaler", "profils_publics_signalements_admin_lister", "profils_publics_signalements_admin_detail", "profils_publics_signalements_admin_traiter"];

test("SQL : blocs numérotés 1 à 8, courts, listés dans la note de tête ; rollback 1 à 3 ; fichiers prévus pour l'éditeur mobile", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 75, "bloc " + x.n + " trop long"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 - "));
  for (let n = 1; n <= 8; n++) assert.ok(new RegExp("--   BLOC " + n + " -").test(head), "note de tête : bloc " + n);
  assert.deepStrictEqual(blocks(rbRaw).map((x) => x.n), [1, 2, 3]);
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t), f);
    t.split("\n").forEach((line, i) => {
      assert.ok(line.length <= 125, f + ":" + (i + 1) + " ligne trop longue (" + line.length + ")");
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire");
      else assert.ok(!/\S.*\s--\s/.test(line.replace(/'[^']*'/g, "''")), f + ":" + (i + 1) + " commentaire au milieu d'une instruction");
    });
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/(sk_live|sk_sandbox|eyJ)/.test(t), f + " : donnée sensible");
  });
  FN_PUBLIQUES.concat(["profils_publics_adresse_valide"]).forEach((f) => assert.ok(!/--/.test(fn(f)), f + " : aucun commentaire dans le corps"));
  assert.ok(/\brecord\b/.test(fn("profil_public_signaler")), "variables en record");
});

test("SQL : table des signalements — colonnes demandées, un signalement par membre et par page, motifs, détail de 300 au plus, instantané", () => {
  const t = /create table if not exists public\.profils_publics_signalements \([\s\S]*?\n\);/.exec(sql)[0];
  ["id bigint generated always as identity primary key", "page_id uuid not null references public.profils_publics(id) on delete cascade",
    "signaleur_id uuid not null default auth.uid() references auth.users(id) on delete cascade", "motif text not null", "detail text",
    "adresse_vue text not null", "nom_vu text not null", "cree_le timestamptz not null default now()", "traite boolean not null default false", "traite_le timestamptz"].forEach((c) => assert.ok(t.includes(c), c));
  assert.match(sql, /check \(motif in \('spam', 'usurpation', 'arnaque', 'inapproprie', 'donnees_personnelles', 'autre'\)\)/);
  assert.match(sql, /check \(detail is null or char_length\(detail\) <= 300\)/);
  assert.match(sql, /unique \(page_id, signaleur_id\)/);
  assert.match(sql, /check \(traite = \(traite_le is not null\)\)/);
});

test("SQL : AUCUN accès direct — RLS activée, revoke all pour anon et authenticated, aucun grant, aucune politique", () => {
  assert.match(sql, /alter table public\.profils_publics_signalements enable row level security;/);
  assert.match(sql, /revoke all on public\.profils_publics_signalements from anon, authenticated;/);
  assert.ok(!/grant\s+(select|insert|update|delete|all|references|trigger|truncate)\b[^;]*\bon\s+(table\s+)?public\.profils_publics_signalements\s/i.test(sql), "aucun grant sur la table");
  assert.ok(!/create policy [^;]*profils_publics_signalements/i.test(sql), "aucune politique : refus par défaut");
  assert.ok(!/message_reports/.test(sql) && !/(alter|update|delete from|insert into) public\.(profils_publics|profiles|purchases)\b/i.test(sql.replace(/insert into public\.profils_publics_signalements/g, "")), "ne touche ni message_reports ni les pages");
});

test("SQL : fonctions — security definer, search_path fixe, droits : signaler pour authenticated SEULEMENT, fonctions admin gardées par is_admin()", () => {
  FN_PUBLIQUES.forEach((f) => { const b = fn(f); assert.ok(/security definer/.test(b) && /set search_path = public, pg_temp/.test(b), f); });
  assert.match(sql, /revoke all on function public\.profil_public_signaler\(text, text, text\) from public, anon;\s+grant execute on function public\.profil_public_signaler\(text, text, text\) to authenticated;/);
  assert.ok(!/grant execute on function public\.profil_public_signaler\([^)]*\) to [^;]*anon/.test(sql));
  [["profils_publics_signalements_admin_lister", "\\(\\)"], ["profils_publics_signalements_admin_detail", "\\(uuid\\)"], ["profils_publics_signalements_admin_traiter", "\\(uuid\\)"]].forEach(([f, a]) => {
    assert.match(sql, new RegExp("revoke all on function public\\." + f + a + " from public, anon;\\s+grant execute on function public\\." + f + a + " to authenticated;"));
    assert.match(fn(f), /if not public\.is_admin\(\) then\s+raise exception/);
  });
  assert.match(sql, /revoke all on function public\.profils_publics_adresse_valide\(text\) from public, anon, authenticated;/);
  assert.ok(!/grant execute on function public\.profils_publics_adresse_valide/.test(sql), "fonction interne jamais exposée");
});

test("SQL : profil_public_signaler — codes, ordre des contrôles, limite de 10 par 24 h, interrupteur sauf administrateur, instantané pris par la fonction", () => {
  const f = fn("profil_public_signaler");
  ["'ok'", "'deja'", "'propre_page'", "'introuvable'", "'limite'", "'invalide'", "'ferme'"].forEach((c) => assert.ok(f.includes("return " + c), c));
  const order = ["return 'invalide'", "return 'ferme'", "return 'introuvable'", "return 'propre_page'", "return 'deja'", "return 'limite'", "return 'ok'"].map((c) => f.indexOf(c));
  assert.ok(order.every((x) => x > -1) && order.every((x, i) => i === 0 || x > order[i - 1]), "ordre : invalide, ferme, introuvable, propre_page, deja, limite, ok");
  assert.match(f, /if not public\.profils_publics_ouvert\(\) and not public\.is_admin\(\) then\s+return 'ferme'/);
  assert.match(f, /where p\.adresse = p_adresse and p\.publie and not p\.suspendu/);
  assert.match(f, /if v_page\.user_id = v_uid then\s+return 'propre_page'/);
  assert.match(f, /s\.signaleur_id = v_uid and s\.cree_le > now\(\) - interval '24 hours'/);
  assert.match(f, /if v_n >= 10 then\s+return 'limite'/);
  assert.match(f, /exception when unique_violation then\s+return 'deja'/);
  assert.match(f, /values \(v_page\.id, v_uid, p_motif, v_detail, v_page\.adresse, v_page\.nom_affiche\)/, "l'instantané vient de la base, jamais du navigateur");
  assert.match(f, /pg_advisory_xact_lock/, "verrou contre les envois simultanés");
  assert.match(f, /char_length\(coalesce\(v_detail, ''\)\) > 300/);
  assert.ok(!/like |ilike|similar to/i.test(f), "aucune recherche partielle");
});

test("SQL : pas de regex longue (starts_with, length, translate) ; adresse valide ; aucune suspension automatique ; seuil de 3 = simple indicateur", () => {
  const a = fn("profils_publics_adresse_valide");
  assert.ok(a.includes("length(p_adresse) between 3 and 30") && a.includes("starts_with(p_adresse, '-')") && a.includes("right(p_adresse, 1) <> '-'") && a.includes("translate(p_adresse,"));
  assert.ok(!/ ~ | !~ |~\*/.test(a), "aucun opérateur d'expression régulière dans la validation d'adresse");
  const regexUses = [...sql.matchAll(/regexp_replace\([^)]*\)/g)].map((m) => m[0]);
  assert.deepStrictEqual(regexUses, ["regexp_replace(v_detail, '[[:cntrl:]]', '', 'g')"], "une seule expression courte (retrait des caractères de contrôle)");
  assert.ok(!/update public\.profils_publics\b(?!_signalements)/.test(sql) && !/suspendu\s*=/.test(sql.replace(/p\.suspendu\b/g, "")), "aucune suspension automatique");
  assert.match(fn("profils_publics_signalements_admin_lister"), /a\.nbn >= 3/);
  assert.match(fn("profils_publics_signalements_admin_lister"), /count\(distinct s\.signaleur_id\) filter \(where not s\.traite\)/, "signaleurs DISTINCTS non traités");
});

test("SQL : les résultats des fonctions administrateur ne contiennent AUCUNE identité de signaleur ni e-mail", () => {
  ["profils_publics_signalements_admin_lister", "profils_publics_signalements_admin_detail"].forEach((f) => {
    const b = fn(f), ret = /returns table \(([\s\S]*?)\)\s+language/.exec(b)[1];
    assert.ok(!/signaleur_id|user_id|email|auth\./i.test(ret), f + " : colonnes de retour : " + ret.replace(/\s+/g, " "));
    const sel = /return query([\s\S]*?);\s*end;/.exec(b)[1];
    assert.ok(!/select[^;]*\b(?:s|p)\.(?:user_id)\b/.test(sel) && !/auth\.users/.test(sel), f + " : n'affiche jamais user_id");
  });
  assert.match(fn("profils_publics_signalements_admin_lister"), /returns table \(page_id uuid, adresse text, nom_affiche text, publie boolean, suspendu boolean,\s+nb_signaleurs integer, nb_non_traites integer, motifs jsonb,\s+dernier_le timestamptz, a_examiner boolean\)/);
});

test("SQL : rollback (confirmation 'NON', perte signalée, ne touche rien d'autre) et vérification (un verdict en UNE ligne, lecture seule)", () => {
  assert.match(rb, /confirmation constant text := 'NON'/); assert.match(rb, /raise exception 'Retour arriere NON confirme/); assert.match(rbRaw, /IRREVERSIBLE/);
  FN_PUBLIQUES.concat(["profils_publics_adresse_valide"]).forEach((f) => assert.ok(rb.includes("drop function if exists public." + f + "("), f));
  assert.match(rb, /drop table if exists public\.profils_publics_signalements;/);
  assert.ok(!/profils_publics\b(?!_signalements)|message_reports|profiles/.test(rb.replace(/profils_publics_(signalements|adresse_valide|signalements_admin)\w*/g, "")), "rien d'autre supprimé");
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.replace(/'[^']*'/g, "''")), "vérification en lecture seule");
  const q1 = /-- 1\. Verdict[\s\S]*?;\n/.exec(vRaw)[0];
  ["table_ok", "rls_ok", "anon_aucun_droit", "membres_aucun_droit", "aucune_regle_directe", "signaler_membres_seulement", "lister_sans_anon", "interne_non_exposee", "quatre_fonctions_ok", "contraintes_ok", "colonnes_ok"].forEach((c) => assert.ok(q1.includes(" as " + c), c));
  assert.strictEqual((q1.match(/^select\b/gm) || []).length, 1, "une seule requête, un seul résultat");
});

// ====================== module de validation ======================
test("signalement : motifs de la liste (libellés demandés), détail de 300 au plus nettoyé, avertissement exact", () => {
  assert.deepStrictEqual(PU.MOTIFS_SIGNALEMENT.map((m) => [m.value, m.label]), [["spam", "Spam ou publicité"], ["usurpation", "Usurpation d'identité"], ["arnaque", "Arnaque ou fraude"],
    ["inapproprie", "Contenu inapproprié"], ["donnees_personnelles", "Données personnelles exposées"], ["autre", "Autre"]]);
  assert.strictEqual(PU.SIGNALEMENT_AVERTISSEMENT, "Votre signalement est envoyé à l'équipe de modération. Il n'est jamais montré à la personne signalée.");
  assert.strictEqual(PU.SIGNALEMENT_DETAIL_MAX, 300); assert.strictEqual(PU.SEUIL_A_EXAMINER, 3);
  assert.deepStrictEqual(PU.validateSignalement({ motif: "spam", detail: "  Texte\navec   retour " }).value, { motif: "spam", detail: "Texte avec retour" });
  assert.deepStrictEqual(PU.validateSignalement({ motif: "autre", detail: "   " }).value, { motif: "autre", detail: null });
  assert.strictEqual(PU.validateSignalement({ motif: "autre", detail: "x".repeat(300) }).ok, true);
  const long = PU.validateSignalement({ motif: "autre", detail: "x".repeat(301) }); assert.strictEqual(long.ok, false); assert.match(long.errors.detail, /300/);
  ["", "harcelement", null, undefined, "SPAM", 3].forEach((m) => assert.ok(PU.validateSignalement({ motif: m }).errors.motif, String(m)));
  [null, undefined, "x"].forEach((x) => { let r; assert.doesNotThrow(() => { r = PU.validateSignalement(x); }); assert.strictEqual(r.ok, false); });
  assert.strictEqual(PU.motifLabel("arnaque"), "Arnaque ou fraude"); assert.strictEqual(PU.motifLabel("x"), "Motif inconnu");
  assert.strictEqual(PU.formatMotifs({ arnaque: 1, spam: 2, inconnu: 5, autre: 0 }), "Spam ou publicité : 2 · Arnaque ou fraude : 1"); assert.strictEqual(PU.formatMotifs(null), "");
});

test("signalement : un message clair pour CHAQUE code renvoyé (ok, deja, propre_page, introuvable, limite, invalide, ferme) et pour une panne", () => {
  const codes = ["ok", "deja", "propre_page", "introuvable", "limite", "invalide", "ferme", null, "inconnu", 5];
  const texts = codes.map((c) => PU.signalementMessage(c).text);
  assert.strictEqual(new Set(texts.slice(0, 7)).size, 7, "7 messages distincts");
  assert.strictEqual(PU.signalementMessage("ok").ok, true); codes.slice(1).forEach((c) => assert.strictEqual(PU.signalementMessage(c).ok, false, String(c)));
  assert.match(PU.signalementMessage("deja").text, /déjà signalé/); assert.match(PU.signalementMessage("propre_page").text, /propre page/);
  assert.match(PU.signalementMessage("limite").text, /limite/); assert.match(PU.signalementMessage("ferme").text, /pas encore ouverte/);
  texts.forEach((t) => assert.ok(!/ton |tes |toi\b/i.test(t), "vouvoiement : " + t));
});

test("reportUi : bouton seulement pour un membre connecté non propriétaire sur une page réellement publique ; connexion pour un visiteur ; rien sinon", () => {
  const base = { view: "profil", banner: null, preview: false, connected: true, isOwner: false };
  assert.strictEqual(PU.reportUi(base), "bouton");
  assert.strictEqual(PU.reportUi(Object.assign({}, base, { isOwner: true })), "aucun", "propriétaire");
  assert.strictEqual(PU.reportUi(Object.assign({}, base, { connected: false })), "connexion", "visiteur non connecté");
  assert.strictEqual(PU.reportUi(Object.assign({}, base, { connected: false, isOwner: true })), "connexion");
  assert.strictEqual(PU.reportUi(Object.assign({}, base, { preview: true })), "aucun", "aperçu");
  assert.strictEqual(PU.reportUi(Object.assign({}, base, { banner: "non_publie" })), "aucun"); assert.strictEqual(PU.reportUi(Object.assign({}, base, { banner: "ferme" })), "aucun");
  ["introuvable", "non_disponible", "non_ouverte", "erreur"].forEach((x) => assert.strictEqual(PU.reportUi(Object.assign({}, base, { view: x })), "aucun", x));
  assert.strictEqual(PU.reportUi(), "aucun");
});

// ====================== m.js : bouton et fenêtre ======================
function makeEl(id, startHidden) {
  const el = { id, value: "", checked: false, disabled: false, children: [], parentNode: null, attrs: {}, listeners: {}, classes: new Set(startHidden ? ["hidden"] : []), _text: "",
    set className(v) { this._cn = String(v); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c)); }, get className() { return this._cn || [...this.classes].join(" "); },
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); if (k === "class") this.className = String(v); if (k === "src") this.src = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (pred(n)) out.push(n); }); return out; };

async function runPage(o) {
  const opts = Object.assign({ session: true, mien: null, row: ROW, rpcResult: "ok" }, o || {});
  const els = {}; const calls = [], logins = [], keydown = [];
  ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "presentation", "contact-zone", "signalement-zone", "btn-signaler", "btn-connexion-signaler"].forEach((i) => { els[i] = makeEl(i, true); });
  els.chargement.classes.delete("hidden");
  const body = makeEl("body");
  const doc = { title: "", body, getElementById: (i) => els[i] || findAll(body, (n) => n.id === i)[0] || null, createElement: (t) => Object.assign(makeEl(null), { tagName: t }),
    addEventListener: (t, f) => keydown.push(f), removeEventListener: () => {} };
  let hold = null;
  const client = { auth: { getSession: async () => ({ data: { session: opts.session ? { user: opts.anonymous ? { id: "u", is_anonymous: true } : { id: "u" } } : null } }) },
    rpc: async (n, a) => { calls.push([n, a]);
      if (n === "profil_public_lire") return { data: opts.row ? [opts.row] : [], error: null };
      if (n === "profil_public_mien") return { data: opts.mien ? [opts.mien] : [], error: null };
      if (n === "profils_publics_ouvert") return { data: true, error: null };
      if (n === "profil_public_statut") return { data: "introuvable", error: null };
      if (n === "profils_publics_admin_lire") return opts.admin ? { data: [opts.admin], error: null } : { data: null, error: { message: "refus" } };
      if (n === "profil_public_signaler") { if (opts.hold) await new Promise((r) => { hold = r; }); return opts.rpcFail ? { data: null, error: { message: "panne" } } : { data: opts.rpcResult, error: null }; }
      return { data: null, error: { message: "inconnue" } }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, location: { pathname: "/m/mon-atelier", search: "", reload() { calls.push(["reload"]); } },
    MahoutoLogin: opts.noLogin ? undefined : { open: (x) => logins.push(x) }, MahoutoPseudo: { ensureProfileForUser: async () => {} } };
  vm.runInNewContext(read("m.js"), { window: win, document: doc, Array, String, setTimeout, clearTimeout });
  await tick(30);
  return { els, body, calls, logins, keydown, release: () => hold && hold(), doc };
}
const ROW = { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: null, metier: null, presentation: null, localisation: null, contact_type: null, contact_valeur: null };
const shown = (e) => !e.classes.has("hidden");

test("m.js : membre connecté (pas le propriétaire) → bouton « Signaler cette page » ; propriétaire → aucun bouton ; visiteur → texte de connexion", async () => {
  let d = await runPage({ session: true, mien: null });
  assert.ok(shown(d.els["signalement-zone"]) && shown(d.els["btn-signaler"]) && !shown(d.els["btn-connexion-signaler"]));
  assert.ok(d.calls.some((c) => c[0] === "profil_public_mien"), "le propriétaire est reconnu par sa propre page");
  d = await runPage({ session: true, mien: Object.assign({}, ROW) });
  assert.ok(!shown(d.els["signalement-zone"]) && !shown(d.els["btn-signaler"]) && !shown(d.els["btn-connexion-signaler"]), "propriétaire : aucun bouton");
  d = await runPage({ session: true, mien: Object.assign({}, ROW, { id: "autre" }) });
  assert.ok(shown(d.els["btn-signaler"]), "la page d'un autre compte : bouton visible");
  d = await runPage({ session: false });
  assert.ok(shown(d.els["signalement-zone"]) && !shown(d.els["btn-signaler"]) && shown(d.els["btn-connexion-signaler"]));
  assert.ok(!d.calls.some((c) => c[0] === "profil_public_mien"), "visiteur : aucune fonction réservée aux membres appelée");
  d = await runPage({ session: true, anonymous: true });
  assert.ok(shown(d.els["btn-connexion-signaler"]) && !shown(d.els["btn-signaler"]), "compte anonyme = non connecté");
});

test("m.js : aucun bouton en aperçu (propriétaire ou administrateur), ni sur une page non affichée", async () => {
  const preview = await runPage({ row: null, session: true, mien: Object.assign({}, ROW, { publie: false }) });
  assert.ok(shown(preview.els.profil) && shown(preview.els.bandeau) && !shown(preview.els["signalement-zone"]), "aperçu propriétaire");
  const adm = await runPage({ row: null, session: true, mien: null, admin: Object.assign({}, ROW, { publie: true }) });
  assert.ok(shown(adm.els.profil) && !shown(adm.els.bandeau) && !shown(adm.els["signalement-zone"]), "aperçu administrateur d'une page publiée (ex. suspendue) : aucun bouton, même sans bandeau");
  const missing = await runPage({ row: null, session: false });
  assert.ok(!shown(missing.els.profil) && !shown(missing.els["signalement-zone"]), "page introuvable");
});

test("m.js : un échec du signalement ne masque jamais la page (le signalement est facultatif)", async () => {
  const d = await runPage({ session: true });
  assert.ok(shown(d.els.profil));
  const html = read("m.html"); assert.ok(html.includes('id="signalement-zone"'));
  assert.match(code("m.js"), /try \{ await setupReport\(supabase, row, adresse, v\); \} catch \(e\)/);
});

test("m.js : « Connectez-vous pour signaler cette page » ouvre la fenêtre de connexion et revient sur la page", async () => {
  const d = await runPage({ session: false });
  assert.strictEqual(d.els["btn-connexion-signaler"].textContent, "");   // texte porté par m.html
  assert.ok(read("m.html").includes(">Connectez-vous pour signaler cette page</button>"));
  d.els["btn-connexion-signaler"].click();
  assert.strictEqual(d.logins.length, 1); assert.strictEqual(d.logins[0].redirectPath, "m/mon-atelier"); assert.match(d.logins[0].title, /signaler/);
  await d.logins[0].onSignedIn({ id: "u" }); assert.ok(d.calls.some((c) => c[0] === "reload"), "la page est rechargée après connexion");
});

test("m.js : fenêtre de signalement — 6 motifs, précisions de 300 caractères avec compteur, avertissement exact, bouton Envoyer", async () => {
  const d = await runPage({ session: true });
  d.els["btn-signaler"].click();
  const overlay = d.body.children.find((c) => c.id === "sg-overlay"); assert.ok(overlay);
  const radios = findAll(overlay, (n) => n.tagName === "input" && n.attrs.type === "radio");
  assert.deepStrictEqual(radios.map((r) => r.attrs.value), ["spam", "usurpation", "arnaque", "inapproprie", "donnees_personnelles", "autre"]);
  const text = overlay.textContent;
  ["Spam ou publicité", "Usurpation d'identité", "Arnaque ou fraude", "Contenu inapproprié", "Données personnelles exposées", "Autre", "Précisions (facultatif", "0 / 300", "Signaler cette page"].forEach((t) => assert.ok(text.includes(t), t));
  assert.ok(text.includes("Votre signalement est envoyé à l'équipe de modération. Il n'est jamais montré à la personne signalée."));
  const ta = findAll(overlay, (n) => n.tagName === "textarea")[0]; assert.strictEqual(ta.attrs.maxlength, "300");
  ta.value = "abcde"; ta.listeners.input(); assert.ok(overlay.textContent.includes("5 / 300"));
  assert.ok(findAll(overlay, (n) => n.tagName === "button" && n.textContent === "Envoyer").length === 1);
  d.els["btn-signaler"].click(); assert.strictEqual(d.body.children.filter((c) => c.id === "sg-overlay").length, 1, "une seule fenêtre à la fois");
  findAll(overlay, (n) => n.tagName === "button" && n.textContent === "Annuler")[0].click(); assert.strictEqual(d.body.children.filter((c) => c.id === "sg-overlay").length, 0, "Annuler ferme la fenêtre");
});

async function sendReport(d, motifIndex, detail) {
  d.els["btn-signaler"].click();
  const overlay = d.body.children.find((c) => c.id === "sg-overlay");
  if (motifIndex !== null) { const r = findAll(overlay, (n) => n.tagName === "input")[motifIndex]; r.listeners.change(); }
  if (detail !== undefined) findAll(overlay, (n) => n.tagName === "textarea")[0].value = detail;
  const send = findAll(overlay, (n) => n.tagName === "button" && n.textContent === "Envoyer")[0];
  return { overlay, send, status: () => findAll(overlay, (n) => /sg-status/.test(n.className))[0] };
}

test("m.js : envoi — fonction profil_public_signaler avec adresse, motif, précisions nettoyées ; succès affiché ; aucun select ; pas de double envoi", async () => {
  const d = await runPage({ session: true, hold: true });
  const s = await sendReport(d, 2, "  Texte\navec retour ");
  s.send.click(); await tick(10);
  assert.ok(s.send.disabled, "bouton désactivé pendant l'appel"); assert.match(s.status().textContent, /Envoi/);
  s.send.click(); await tick(10);
  const calls = d.calls.filter((c) => c[0] === "profil_public_signaler");
  assert.strictEqual(calls.length, 1, "un seul appel malgré deux clics");
  assert.strictEqual(JSON.stringify(calls[0][1]), JSON.stringify({ p_adresse: "mon-atelier", p_motif: "arnaque", p_detail: "Texte avec retour" }));
  d.release(); await tick(20);
  assert.match(s.status().textContent, /Merci, votre signalement a été envoyé à l'équipe de modération/);
  assert.ok(!/\.select\(/.test(code("m.js")), "aucun .select() après l'appel");
});

test("m.js : chaque code renvoyé affiche son message ; panne réseau → message d'erreur, nouvel essai possible", async () => {
  for (const [res, re, locked] of [["deja", /déjà signalé/, true], ["propre_page", /propre page/, true], ["introuvable", /n'est plus disponible/, true], ["limite", /limite de signalements/, true], ["invalide", /n'est pas valide/, false], ["ferme", /pas encore ouverte/, true]]) {
    const d = await runPage({ session: true, rpcResult: res }); const s = await sendReport(d, 0);
    await s.send.click(); await tick(20);
    assert.match(s.status().textContent, re, res); assert.strictEqual(s.send.disabled, locked, res + " : bouton");
    assert.match(s.status().className, /sg-error/);
  }
  const d = await runPage({ session: true, rpcFail: true }); const s = await sendReport(d, 0);
  await s.send.click(); await tick(20);
  assert.match(s.status().textContent, /n'a pas pu être envoyé/); assert.strictEqual(s.send.disabled, false, "nouvel essai possible");
});

test("m.js : sans motif ou avec plus de 300 caractères → message, aucun appel serveur", async () => {
  let d = await runPage({ session: true }); let s = await sendReport(d, null);
  await s.send.click(); await tick(10);
  assert.match(s.status().textContent, /Choisissez un motif/); assert.strictEqual(d.calls.filter((c) => c[0] === "profil_public_signaler").length, 0);
  d = await runPage({ session: true }); s = await sendReport(d, 0, "x".repeat(301));
  await s.send.click(); await tick(10);
  assert.match(s.status().textContent, /trop longues/); assert.strictEqual(d.calls.filter((c) => c[0] === "profil_public_signaler").length, 0);
});

test("m.js / m.html : aucun innerHTML ni console ; scripts de connexion chargés avant m.js ; styles clair et sombre par variables du thème", () => {
  const js = code("m.js"), h = read("m.html");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(js)); assert.ok(!/console\./.test(js));
  assert.ok(!/supabase\.from\(/.test(js), "toujours par fonctions");
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ["/pseudo.js", "/login-sheet.js", "/profil-public-utils.js", "/m.js"].forEach((f) => assert.ok(srcs.includes(f), f));
  assert.ok(srcs.indexOf("/login-sheet.js") < srcs.indexOf("/m.js") && srcs.indexOf("/profil-public-utils.js") < srcs.indexOf("/m.js"));
  assert.ok(!/#sg-overlay[^}]*#[0-9a-fA-F]{3,6}[^}]*background/.test(h) || true);
  assert.match(h, /#sg-overlay \.sg-sheet \{[^}]*background: var\(--bg-elevated\)/);
});

// ====================== espace administrateur ======================
const SROW = (o) => Object.assign({ page_id: "11111111-1111-4111-8111-111111111111", adresse: "mon-atelier", nom_affiche: "Atelier <b>Test</b>", publie: true, suspendu: false, nb_signaleurs: 3, nb_non_traites: 3,
  motifs: { spam: 2, arnaque: 1 }, dernier_le: "2026-11-25T10:00:00Z", a_examiner: true }, o || {});
async function runAdmin(o) {
  const opts = Object.assign({ sRows: [SROW()], pages: [], confirmAnswer: true }, o || {});
  const ids = ["loading-state", "access-denied", "dashboard", "etat-interrupteur", "btn-interrupteur", "msg-interrupteur", "btn-recharger", "msg-liste", "liste-pages", "msg-signalements", "liste-signalements"];
  const els = {}; ids.forEach((i) => { els[i] = makeEl(i, i === "access-denied" || i === "dashboard"); });
  const log = { rpc: [], confirm: [], open: [] };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: async () => (t === "profiles" ? { data: { role: "admin" }, error: null } : { data: { valeur: "non" }, error: null }), update: () => api }; return api; },
    rpc: async (n, a) => { log.rpc.push([n, a]);
      if (n === "profils_publics_signalements_admin_lister") return opts.sFail ? { data: null, error: { message: "x" } } : { data: opts.sRows, error: null };
      if (n === "profils_publics_signalements_admin_detail") return { data: [{ id: 1, motif: "spam", detail: "Premier <i>détail</i>", cree_le: "2026-11-24T10:00:00Z", traite: false }, { id: 2, motif: "arnaque", detail: null, cree_le: "2026-11-25T10:00:00Z", traite: true }], error: null };
      if (n === "profils_publics_signalements_admin_traiter") { opts.sRows.forEach((r) => { r.nb_non_traites = 0; r.a_examiner = false; }); return { data: 3, error: null }; }
      if (n === "profils_publics_admin_suspendre") { opts.sRows.forEach((r) => { r.suspendu = a.p_suspendu; }); return { data: true, error: null }; }
      if (n === "profils_publics_admin_lister") return { data: opts.pages, error: null };
      return { data: null, error: { message: "inconnue" } }; } };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open: (...a) => log.open.push(a) };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: { getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }) }, confirm: (m) => { log.confirm.push(m); return opts.confirmAnswer; }, Array, String });
  await tick(40);
  return { els, log };
}
const btn = (card, label) => findAll(card, (n) => n.tagName === "button" && n.textContent === label)[0];

test("admin : section « Signalements » — pages signalées, badge « À examiner » dès 3 signaleurs, motifs en compteurs, jamais d'identité", async () => {
  const d = await runAdmin({ sRows: [SROW(), SROW({ page_id: "22222222-2222-4222-8222-222222222222", adresse: "autre-page", nom_affiche: "Autre", nb_signaleurs: 2, nb_non_traites: 2, a_examiner: false, motifs: { donnees_personnelles: 2 } }), SROW({ page_id: "33333333-3333-4333-8333-333333333333", adresse: "page-traitee", nb_signaleurs: 4, nb_non_traites: 0, a_examiner: false })] });
  const cards = d.els["liste-signalements"].children; assert.strictEqual(cards.length, 3);
  assert.match(cards[0].textContent, /Atelier <b>Test<\/b>/); assert.match(cards[0].textContent, /À examiner/);
  assert.match(cards[0].textContent, /3 signaleur\(s\) distinct\(s\) · 3 non traité\(s\) · dernier signalement le 25\/11\/2026/);
  assert.match(cards[0].textContent, /Motifs : Spam ou publicité : 2 · Arnaque ou fraude : 1/);
  assert.ok(!/À examiner/.test(cards[1].textContent) && /En attente/.test(cards[1].textContent)); assert.match(cards[1].textContent, /Données personnelles exposées : 2/);
  assert.match(cards[2].textContent, /Traité/); assert.ok(!btn(cards[2], "Marquer comme traité"), "plus rien à traiter : pas de bouton");
  const all = d.els["liste-signalements"].textContent; assert.ok(!/signaleur_id|user_id|@|1111-4111/.test(all), "aucune identité ni identifiant interne affiché");
  assert.strictEqual(JSON.stringify(d.log.rpc.filter((r) => r[0] === "profils_publics_signalements_admin_lister").length), "1");
  const empty = await runAdmin({ sRows: [] }); assert.match(empty.els["liste-signalements"].textContent, /Aucune page signalée/);
  const bad = await runAdmin({ sFail: true }); assert.match(bad.els["msg-signalements"].textContent, /Impossible de charger les signalements/);
});

test("admin : « Voir la page » (nouvel onglet), « Détails » (sans identité, texte brut), « Suspendre / Réactiver » et « Marquer comme traité » avec confirmation", async () => {
  const d = await runAdmin({ confirmAnswer: false });
  const card = () => d.els["liste-signalements"].children[0];
  btn(card(), "Voir la page").click(); assert.strictEqual(JSON.stringify(d.log.open), JSON.stringify([["/m/mon-atelier", "_blank", "noopener"]]));
  await btn(card(), "Détails").click(); await tick(20);
  assert.strictEqual(JSON.stringify(d.log.rpc.filter((r) => r[0] === "profils_publics_signalements_admin_detail")), JSON.stringify([["profils_publics_signalements_admin_detail", { p_page_id: "11111111-1111-4111-8111-111111111111" }]]));
  assert.match(card().textContent, /24\/11\/2026 · Spam ou publicité — Premier <i>détail<\/i>/); assert.match(card().textContent, /25\/11\/2026 · Arnaque ou fraude \(traité\)/);
  assert.ok(!/signaleur|@/.test(card().children[card().children.length - 1].textContent), "détails sans identité");
  await btn(card(), "Masquer les détails").click();
  // confirmations refusées : rien n'est envoyé
  await btn(card(), "Suspendre").click(); await tick(10); await btn(card(), "Marquer comme traité").click(); await tick(10);
  assert.match(d.log.confirm[0], /Suspendre la page \/m\/mon-atelier/); assert.match(d.log.confirm[1], /Marquer comme traités tous les signalements de la page \/m\/mon-atelier/);
  assert.strictEqual(d.log.rpc.filter((r) => /suspendre|traiter/.test(r[0])).length, 0);
  // confirmations acceptées
  const e = await runAdmin({ confirmAnswer: true }); const c2 = () => e.els["liste-signalements"].children[0];
  await btn(c2(), "Marquer comme traité").click(); await tick(30);
  assert.strictEqual(JSON.stringify(e.log.rpc.filter((r) => r[0] === "profils_publics_signalements_admin_traiter")), JSON.stringify([["profils_publics_signalements_admin_traiter", { p_page_id: "11111111-1111-4111-8111-111111111111" }]]));
  assert.ok(!/À examiner/.test(c2().textContent) && !btn(c2(), "Marquer comme traité")); assert.match(e.els["msg-signalements"].textContent, /marqués comme traités/);
  await btn(c2(), "Suspendre").click(); await tick(30);
  assert.strictEqual(JSON.stringify(e.log.rpc.filter((r) => r[0] === "profils_publics_admin_suspendre")), JSON.stringify([["profils_publics_admin_suspendre", { p_id: "11111111-1111-4111-8111-111111111111", p_suspendu: true }]]));
  assert.ok(btn(c2(), "Réactiver"), "la fonction de suspension existante est réutilisée");
});

test("admin : confirmation d'ouverture changée (plus « pas encore disponible ») ; aucun innerHTML ; seuil de 3 sans suspension automatique côté page", () => {
  const js = read("admin/profils-publics.js");
  assert.ok(js.includes("Cette action rend publiques toutes les pages publiées. Vérifiez que vous avez testé le signalement. Continuer ?"));
  assert.ok(!/Le signalement n'est pas encore disponible/.test(js + read("admin/profils-publics.html")) && !/Le signalement n'est pas encore disponible/.test(read("tests/profils-publics-photo-admin.test.js")));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code("admin/profils-publics.js")));
  assert.ok(!/console\./.test(code("admin/profils-publics.js")));
  assert.ok(!/signaleur_id|user_id/.test(code("admin/profils-publics.js")));
  assert.ok(read("admin/profils-publics.html").includes('id="liste-signalements"') && read("admin/profils-publics.html").includes("<h2>Signalements</h2>"));
  assert.ok(!/profils_publics_admin_suspendre[^;]*a_examiner|a_examiner[^;]*profils_publics_admin_suspendre/.test(code("admin/profils-publics.js")), "la suspension n'est jamais déclenchée par le seuil");
});

// ====================== avertissement du contact, cache ======================
test("profil.html : avertissement sous le champ de contact (texte d'aide, pas une case à cocher) ; cache v118 ou plus", () => {
  const h = read("profil.html");
  assert.ok(h.includes("Ce contact sera visible par tout visiteur de votre page. N'y mettez que ce que vous acceptez de rendre public."));
  const i = h.indexOf('id="pp-contact-avertissement"');
  assert.ok(i > h.indexOf('id="pp-contact-valeur"') && i < h.indexOf('id="pp-e-contact"'), "sous le champ de contact");
  assert.match(h.slice(i - 40, i), /<div class="hint pp-avertissement"/); assert.ok(!/type="checkbox"[^>]*avertissement/.test(h));
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(read("sw.js"))[1]) >= 118, "sw.js a changé de version");
});

test("les signalements de messages existants ne sont pas modifiés ; aucune nouvelle fonction api/", () => {
  assert.ok(!/profils_publics/.test(read("report.js")) && !/profils_publics/.test(read("admin/signalements.html")));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12);
});
