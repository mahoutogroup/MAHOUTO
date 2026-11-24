/* « Qui a vu ma carte » (profils-publics-visiteurs.sql + rollback + vérification, profil-visiteurs.js, profil.html, m.js,
   regles-pages-publiques.html, sw.js). Lecture statique des fichiers SQL (jamais exécutés ici) et faux DOM pour l'interface.
   Aucun réseau. Les scénarios SQL réels (62 contrôles à 5 comptes) ont été joués sur une base PostgreSQL locale jetable :
   voir la description de la PR. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PV = require("../profil-visiteurs");
const PU = require("../profil-public-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

// ====================== SQL (lecture de fichiers uniquement) ======================
const FILES = ["profils-publics-visiteurs.sql", "profils-publics-visiteurs-rollback.sql", "profils-publics-visiteurs-verification.sql"];
const raw = read(FILES[0]), rawRb = read(FILES[1]), rawVf = read(FILES[2]);
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(raw), sqlRb = strip(rawRb), sqlVf = strip(rawVf);
const blocs = (t) => { const parts = t.split(/^-- BLOC (\d+) - /m), out = {}; for (let i = 1; i < parts.length; i += 2) out[Number(parts[i])] = parts[i + 1]; return out; };
const B = blocs(raw), BR = blocs(rawRb);
const fn = (text, name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(text); assert.ok(m, name); return m[0]; };
const squash = (t) => t.replace(/\s+/g, " ").trim();
const FONCTIONS = ["profil_public_visiteur_enregistrer", "profil_public_visiteur_reglage_lire", "profil_public_visiteur_reglage_ecrire", "profil_public_visiteurs_lister", "profil_public_visiteurs_purger"];
const ENREG = squash(fn(sql, "profil_public_visiteur_enregistrer")), LISTER = squash(fn(sql, "profil_public_visiteurs_lister"));
const ECRIRE = squash(fn(sql, "profil_public_visiteur_reglage_ecrire")), PURGER = squash(fn(sql, "profil_public_visiteurs_purger"));

test("SQL : 8 blocs courts numérotés dans l'ordre ; rollback en 3 blocs dans l'ordre inverse ; un seul fichier de vérification", () => {
  assert.deepStrictEqual(Object.keys(B).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(Object.keys(BR).map(Number), [1, 2, 3]);
  assert.ok(/to_regprocedure\('public\.dm_bloque_entre\(uuid, uuid\)'\)/.test(B[1]) && !/create |insert |update |delete |drop /i.test(B[1]), "le bloc 1 ne modifie rien");
  assert.ok(/profils_publics_visiteurs_reglages/.test(B[2]) && /profils_publics_passages/.test(B[3]) && /profil_public_visiteur_enregistrer/.test(B[4]));
  assert.ok(/reglage_lire/.test(B[5]) && /reglage_ecrire/.test(B[5]) && /visiteurs_lister/.test(B[6]) && /visiteurs_purger/.test(B[7]) && /\bgrant\b/.test(B[8]));
  [4, 5, 6, 7].forEach((k) => assert.ok(!/\bgrant\b/.test(B[k]), "les droits des fonctions sont dans le bloc 8"));
  assert.ok(/drop function/.test(BR[1]) && !/drop table/.test(BR[1]), "bloc 1 : fonctions seulement, sans perte");
  assert.ok(/drop table if exists public\.profils_publics_passages/.test(BR[2]) && /drop table if exists public\.profils_publics_visiteurs_reglages/.test(BR[3]));
  [2, 3].forEach((k) => assert.ok(/confirmation constant text := 'NON'/.test(BR[k]) && /raise exception 'Retour arriere NON confirme/.test(BR[k]), "bloc " + k + " : confirmation requise"));
  assert.ok(!/confirmation/.test(BR[1].split("\n").slice(1).join("\n")), "le retrait des fonctions est sans confirmation");
});

test("SQL : règles de l'éditeur mobile ($$ jamais $function$, record, pas de %rowtype, de LIKE, de regex ni de classe POSIX, lignes courtes, commentaires sans apostrophe et AVANT les instructions)", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t), f + " : $function$"); assert.ok(!/%rowtype|%type/i.test(t), f + " : %rowtype");
    const s = strip(t);
    assert.ok(!/\blike\b|\bilike\b|similar to/i.test(s), f + " : LIKE"); assert.ok(!/ ~\*? |\[\[:|regexp_/i.test(s), f + " : regex ou POSIX");
    t.split("\n").forEach((l, i) => { assert.ok(l.length <= 105, f + ":" + (i + 1) + " ligne de " + l.length + " caractères"); if (l.trim().startsWith("--")) assert.ok(!/'/.test(l), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
  });
  assert.ok((raw.match(/\$\$/g) || []).length % 2 === 0, "délimiteurs $$ appariés");
  [B, BR].forEach((bl) => Object.keys(bl).forEach((k) => { const body = bl[k].split("\n").slice(1); const firstCode = body.findIndex((l) => l.trim() && !l.trim().startsWith("--")); const lastComment = body.map((l, i) => (l.trim().startsWith("--") ? i : -1)).filter((i) => i >= 0).pop(); assert.ok(lastComment === undefined || lastComment < firstCode, "bloc " + k + " : un commentaire placé après une instruction"); }));
});

test("SQL : règle 1 — OPT-IN : le réglage vaut false par défaut, aucune ligne pour un membre sans accord", () => {
  assert.match(sql, /montrer_mon_nom boolean not null default false/);
  assert.ok(!/default true/.test(sql), "aucun défaut à vrai");
  assert.match(ENREG, /if not coalesce\(\(select r\.montrer_mon_nom from public\.profils_publics_visiteurs_reglages r where r\.user_id = v_uid\), false\) then return true; end if;/);
  assert.ok(ENREG.indexOf("r.montrer_mon_nom") < ENREG.indexOf("insert into public.profils_publics_passages"), "l'accord est vérifié AVANT toute écriture");
  assert.match(raw, /create table if not exists public\.profils_publics_visiteurs_reglages \(\s*user_id uuid primary key references auth\.users\(id\) on delete cascade,/);
});

test("SQL : règle 2 — RÉCIPROCITÉ : la liste est vide si le propre réglage du propriétaire est désactivé", () => {
  assert.match(LISTER, /if not coalesce\(\(select r\.montrer_mon_nom from public\.profils_publics_visiteurs_reglages r where r\.user_id = v_uid\), false\) then return; end if; return query/);
  assert.ok(LISTER.indexOf("r.montrer_mon_nom") < LISTER.indexOf("return query"), "la réciprocité est vérifiée AVANT de lire les passages");
});

test("SQL : règle 3 — désactiver EFFACE les passages du visiteur dans la même transaction (verrou commun avec l'enregistrement)", () => {
  assert.match(ECRIRE, /if not p_actif then delete from public\.profils_publics_passages x where x\.visiteur_id = v_uid; end if;/);
  assert.ok(ECRIRE.indexOf("pg_advisory_xact_lock(hashtextextended('ppv:' || v_uid::text, 0))") > 0 && ENREG.includes("pg_advisory_xact_lock(hashtextextended('ppv:' || v_uid::text, 0))"), "même verrou des deux côtés");
  assert.ok(ECRIRE.indexOf("pg_advisory_xact_lock") < ECRIRE.indexOf("insert into"), "le verrou est pris avant d'écrire");
  assert.ok(!/to authenticated[\s\S]*profils_publics_visiteurs_reglages/.test(B[2].replace(/grant select[^;]*;/, "")), "aucun droit d'écriture directe sur le réglage");
  assert.match(B[2], /grant select on public\.profils_publics_visiteurs_reglages to authenticated;/);
  assert.ok(!/grant (insert|update|delete|all)/i.test(sql), "aucune écriture directe accordée");
});

test("SQL : règle 4 — conservation 30 jours : filtre dans la liste, purge administrateur, aucune tâche planifiée", () => {
  assert.ok(LISTER.includes("x.derniere_visite > now() - interval '30 days'"), "filtre de 30 jours dans la liste");
  assert.match(PURGER, /delete from public\.profils_publics_passages x where x\.derniere_visite < now\(\) - interval '30 days'/);
  assert.match(PURGER, /if not public\.is_admin\(\) then raise exception/);
  assert.ok(ENREG.includes("t.derniere_visite < now() - interval '30 days' then 1"), "un passage de plus de 30 jours repart de 1");
  assert.ok(!/pg_cron|cron\.schedule|create extension/i.test(sql), "aucune tâche planifiée inventée");
});

test("SQL : règle 5 — la liste ne renvoie ni identifiant, ni IP, ni appareil, ni e-mail, ni téléphone, ni heure", () => {
  assert.match(raw, /returns table \(nom text, adresse text, nb_visites integer, dernier_jour date\)/);
  const sel = LISTER.slice(LISTER.indexOf("return query select"), LISTER.indexOf(" from public.profils_publics_passages x"));
  assert.ok(sel.length > 40 && !/_id\b|user_id|email|phone|tel|contact|\bip\b|device|full_name/i.test(sel), "colonnes sélectionnées : " + sel);
  assert.ok(sel.includes("pr.username") && !/full_name/.test(LISTER), "le nom affiché est le pseudo, jamais le nom légal");
  assert.ok(sel.includes("(x.derniere_visite at time zone 'Africa/Porto-Novo')::date"), "un jour, jamais une heure");
  assert.ok(!/\b(ip|ip_address|user_agent|device|email|phone|telephone|contact_valeur)\b/i.test(B[3]), "la table des passages ne stocke aucune de ces données");
  assert.ok(/case when pp\.id is not null then pp\.adresse else null end/.test(LISTER) && /pp\.publie and not pp\.suspendu/.test(LISTER), "adresse seulement si la page est publiée et non suspendue");
  assert.ok(/limit 100/.test(LISTER));
});

test("SQL : règle 6 — exclusions : propriétaire, blocage (dans un sens ou dans l'autre), page non publiée, non connecté ou anonyme", () => {
  assert.ok(ENREG.includes("if v_proprio = v_uid or public.dm_bloque_entre(v_uid, v_proprio) then return true; end if;"));
  assert.ok(ENREG.includes("where p.adresse = v_adresse and p.publie and not p.suspendu"), "page publiée et non suspendue");
  assert.ok(ENREG.includes("public.profils_publics_ouvert()"), "fonction fermée = rien");
  assert.ok(ENREG.includes("public.profil_public_alias_resoudre(p_adresse)"), "alias résolus vers l'adresse principale");
  [ENREG, LISTER, ECRIRE].forEach((f) => { assert.ok(f.includes("v_uid is null") && f.includes("'is_anonymous'") && f.includes("= 'anonymous'"), "non connecté et anonyme écartés"); });
  assert.match(raw, /constraint pp_passages_pas_soi_meme check \(proprietaire_id <> visiteur_id\)/);
});

test("SQL : règle 7 — un membre bloqué (dans un sens ou dans l'autre) n'apparaît plus dans la liste", () => {
  assert.ok(LISTER.includes("and not public.dm_bloque_entre(v_uid, x.visiteur_id)"));
});

test("SQL : règle 8 — aucune vue nominative pour l'administrateur ; statistiques administrateur inchangées", () => {
  assert.ok(!/is_admin/.test(LISTER + ENREG + ECRIRE), "is_admin n'ouvre aucune lecture nominative");
  assert.ok(!/select[^;]*\b(nom|username|adresse)\b[^;]*from public\.profils_publics_passages/i.test(PURGER), "la purge ne lit aucun nom");
  assert.ok(!/page_views|profils_publics_admin_stats|drop (table|function)/i.test(sql), "aucune table ni fonction existante touchée");
  assert.ok([...sql.matchAll(/alter table ([\w.]+)/g)].every((m) => /^public\.profils_publics_(passages|visiteurs_reglages)$/.test(m[1])), "alter table : uniquement les deux nouvelles tables");
  assert.ok(!/create policy[^;]*profils_publics_passages/i.test(sql), "aucune politique de lecture sur les passages");
});

test("SQL : règle 10 — une ligne par couple (clé primaire double), compteur mis à jour une fois par 30 minutes, plafonné", () => {
  assert.match(raw, /primary key \(proprietaire_id, visiteur_id\)/);
  assert.ok(ENREG.includes("on conflict (proprietaire_id, visiteur_id) do update"));
  assert.ok(ENREG.includes("t.derniere_visite < now() - interval '30 minutes' then least(t.nb_visites + 1, 9999)"));
  assert.match(raw, /constraint pp_passages_compteur check \(nb_visites between 1 and 9999\)/);
});

test("SQL : tables — passages : RLS activée, AUCUNE politique, aucun droit ; réglage : une seule politique « sa propre ligne »", () => {
  assert.ok(/alter table public\.profils_publics_passages enable row level security;/.test(B[3]) && /revoke all on public\.profils_publics_passages from public, anon, authenticated;/.test(B[3]));
  assert.ok(!/create policy/.test(B[3]) && (sql.match(/create policy/g) || []).length === 1, "une seule politique dans tout le fichier");
  assert.match(B[2], /create policy "pp_visiteurs_reglages_lire_le_sien" on public\.profils_publics_visiteurs_reglages\s+for select to authenticated using \(user_id = auth\.uid\(\)\);/);
  assert.ok(!/grant[^;]*profils_publics_passages/.test(sql), "aucun grant sur la table des passages");
  assert.ok(/references auth\.users\(id\) on delete cascade/.test(B[3]) && (B[3].match(/on delete cascade/g) || []).length === 2, "suppression de compte = suppression des données");
});

test("SQL : les 5 fonctions sont SECURITY DEFINER avec search_path fixé ; droits : rien pour public ni anon, execute aux membres connectés seulement", () => {
  FONCTIONS.forEach((n) => { const f = squash(fn(sql, n)); assert.ok(f.includes("security definer") && f.includes("set search_path = public, pg_temp"), n + " : security definer + search_path"); });
  const grants = sql.split(";").map((s) => s.trim()).filter((s) => /^(grant|revoke)\b/.test(s));
  assert.ok(grants.every((g) => !/\banon\b/.test(g) || /^revoke/.test(g)), "anon n'a AUCUN grant");
  assert.ok(!/\bto\s+(public|anon)\b/i.test(sql) && !/\bto\s+[^;]*\banon\b/i.test(sql.replace(/revoke[^;]*;/g, "")), "aucun grant à anon ni à public");
  FONCTIONS.forEach((n) => {
    assert.ok(new RegExp("revoke all on function public\\." + n + "\\([a-z]*\\) from public, anon;").test(sql), n + " : droits retirés à public et anon");
    assert.ok(new RegExp("grant execute on function public\\." + n + "\\([a-z]*\\) to authenticated;").test(sql), n + " : execute aux membres connectés");
  });
  assert.strictEqual((sql.match(/grant execute/g) || []).length, 5);
});

test("SQL : l'enregistrement renvoie toujours true (il ne révèle ni un blocage ni un refus) ; la liste ne lit jamais la table des préférences d'un autre autrement que par jointure", () => {
  assert.ok(!/return false/.test(ENREG), "aucun retour faux : la réponse est toujours neutre");
  assert.ok(LISTER.includes("join public.profils_publics_visiteurs_reglages rv on rv.user_id = x.visiteur_id and rv.montrer_mon_nom"), "seulement les visiteurs qui ont dit oui");
});

test("rollback : 3 blocs ; vérification : UNE seule requête, UNE ligne de booléens", () => {
  assert.ok((sqlVf.match(/;/g) || []).length === 1 && /^\s*select\b/i.test(sqlVf));
  assert.ok(!/\b(insert|update|delete|drop|create|alter|grant|revoke)\b/i.test(sqlVf.replace(/'[^']*'/g, "''")), "lecture seule");
  const cols = [...sqlVf.matchAll(/\bas\s+([a-z_]+)(?:,|\s*;)/g)].map((m) => m[1]);
  assert.ok(cols.length >= 12, "12 colonnes de verdict : " + cols.length);
  ["deux_tables_presentes", "rls_activee", "reglage_desactive_par_defaut", "aucune_politique_sur_les_passages", "aucun_droit_direct_sauf_lire_le_sien", "cinq_fonctions_definer_search_path", "anon_ne_peut_rien_appeler", "liste_sans_identifiant_ni_heure"].forEach((c) => assert.ok(cols.includes(c), c));
  FONCTIONS.forEach((n) => assert.ok(new RegExp("drop function if exists public\\." + n + "\\(").test(sqlRb), n));
  assert.ok(!/drop (schema|database)|truncate|delete from/i.test(sqlRb));
  assert.ok(sqlRb.indexOf("drop function") < sqlRb.indexOf("drop table if exists public.profils_publics_passages") && sqlRb.indexOf("profils_publics_passages;") < sqlRb.indexOf("drop table if exists public.profils_publics_visiteurs_reglages"), "ordre inverse de la création");
});

// ====================== profil-visiteurs.js : fonctions pures ======================
test("profil-visiteurs.js : jour en français, libellés, nettoyage des lignes (rien d'inattendu n'est recopié)", () => {
  assert.strictEqual(PV.formatJour("2026-11-12"), "12 novembre 2026"); assert.strictEqual(PV.formatJour("2026-12-01"), "1er décembre 2026");
  ["", null, "2026-13-01", "2026-00-10", "12/11/2026", "2026-11-12T10:00:00Z"].forEach((j) => assert.strictEqual(PV.formatJour(j), "—", String(j)));
  assert.strictEqual(PV.libelleVisites(1), "1 visite"); assert.strictEqual(PV.libelleVisites(3), "3 visites");
  const rows = PV.nettoyerLignes([
    { nom: "  Alice ", adresse: "atelier-alice", nb_visites: 3, dernier_jour: "2026-11-12", user_id: "00000000-0000-4000-8000-000000000001", ip: "1.2.3.4", email: "a@b.c" },
    { nom: "Bob", adresse: "<script>", nb_visites: "x", dernier_jour: "n'importe quoi" }, { nom: "   ", adresse: "vide-nom", nb_visites: 1 }, null, "texte", { nom: "N".repeat(100), nb_visites: 5000000 }]);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[0], { nom: "Alice", adresse: "atelier-alice", visites: 3, jour: "2026-11-12" });
  assert.deepStrictEqual([rows[1].adresse, rows[1].visites], [null, 1], "adresse invalide = pas de lien ; compteur invalide = 1");
  assert.deepStrictEqual([rows[2].nom.length, rows[2].visites], [60, 9999]);
  assert.ok(!JSON.stringify(rows).match(/user_id|1\.2\.3\.4|a@b\.c|email|"ip"/), "aucun champ inattendu recopié");
  assert.strictEqual(PV.nettoyerLignes(Array.from({ length: 150 }, (_, i) => ({ nom: "m" + i, nb_visites: 1 }))).length, 100);
  assert.deepStrictEqual(PV.nettoyerLignes(null), []);
  assert.deepStrictEqual(["masque", "indisponible", "invitation", "liste", "invitation"], [PV.etatSection({ connecte: false }), PV.etatSection({ connecte: true, indisponible: true }), PV.etatSection({ connecte: true, actif: false }), PV.etatSection({ connecte: true, actif: true }), PV.etatSection({ connecte: true, actif: null })]);
});

// ====================== profil-visiteurs.js dans un faux DOM ======================
function fakeEl(id, tag) {
  const el = { id, tagName: tag || "div", children: [], attrs: {}, _text: "", listeners: {}, classes: new Set(), checked: false, disabled: false,
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set innerHTML(v) { throw new Error("innerHTML interdit"); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); }, contains: (c) => el.classes.has(c) },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; } };
  return el;
}
const IDS = ["pv-section", "pv-switch", "pv-etat", "pv-invitation", "pv-liste-zone", "pv-liste", "pv-vide"];
const LIGNES = [{ nom: "Alice", adresse: "atelier-alice", nb_visites: 3, dernier_jour: "2026-11-12", user_id: "00000000-0000-4000-8000-0000000000aa" }, { nom: "<b>Bruno</b>", adresse: null, nb_visites: 1, dernier_jour: "2026-11-10" }];
function runVisiteurs(o) {
  const els = {}; IDS.forEach((i) => { els[i] = fakeEl(i, i === "pv-switch" ? "input" : i === "pv-liste" ? "ul" : "div"); });
  ["pv-section", "pv-etat", "pv-invitation", "pv-liste-zone", "pv-liste", "pv-vide"].forEach((i) => els[i].classes.add("hidden"));
  els["pv-section"].classes.add("hidden");
  const calls = [], opts = Object.assign({ session: { user: { id: "u1" } }, actif: false, liste: LIGNES }, o || {});
  let actif = opts.actif;
  const client = { calls, from: (t) => { throw new Error("lecture directe interdite : " + t); },
    auth: { getSession: async () => ({ data: { session: opts.session } }) },
    rpc: async (n, a) => {
      calls.push([n, a]);
      if (n === "profil_public_visiteur_reglage_lire") return opts.lireError ? { data: null, error: { message: "x" } } : { data: actif, error: null };
      if (n === "profil_public_visiteur_reglage_ecrire") { if (opts.ecrireError) return { data: null, error: { message: "x" } }; actif = a.p_actif; return { data: actif, error: null }; }
      if (n === "profil_public_visiteurs_lister") return opts.listeError ? { data: null, error: { message: "x" } } : { data: opts.liste, error: null };
      return { data: null, error: { message: "inconnue" } };
    } };
  const doc = { getElementById: (i) => els[i], createElement: (t) => fakeEl(null, t) };
  const win = { MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => client } };
  win.window = win;
  vm.runInNewContext(read("profil-visiteurs.js"), { window: win, document: doc, Array, String, Math, Number, isFinite, JSON });
  return { els, calls, toggle: async (on) => { els["pv-switch"].checked = on; await els["pv-switch"].listeners.change(); await tick(); } };
}
const shown = (e) => !e.classes.has("hidden");

test("profil-visiteurs.js : non connecté ou compte anonyme → section masquée, aucune requête", async () => {
  for (const session of [null, { user: { id: "u", is_anonymous: true } }, { user: { id: "u", app_metadata: { provider: "anonymous" } } }]) {
    const r = runVisiteurs({ session }); await tick();
    assert.ok(!shown(r.els["pv-section"]) === false || r.els["pv-section"].classes.has("hidden")); assert.deepStrictEqual(r.calls, []);
  }
});

test("profil-visiteurs.js : réglage désactivé → invitation seulement, la liste n'est JAMAIS demandée (aucun nombre révélé)", async () => {
  const r = runVisiteurs({ actif: false }); await tick();
  assert.ok(shown(r.els["pv-section"]) && shown(r.els["pv-invitation"]) && !shown(r.els["pv-liste-zone"]));
  assert.strictEqual(r.els["pv-switch"].checked, false, "désactivé par défaut");
  assert.deepStrictEqual(r.calls.map((c) => c[0]), ["profil_public_visiteur_reglage_lire"], "aucun appel à la liste");
  assert.ok(!/\d/.test(r.els["pv-invitation"].textContent || "") && !r.els["pv-liste"].children.length);
});

test("profil-visiteurs.js : activer → réglage écrit, liste chargée, noms en TEXTE, lien seulement avec une adresse publique, aucun identifiant", async () => {
  const r = runVisiteurs({ actif: false }); await tick();
  await r.toggle(true);
  assert.deepStrictEqual(r.calls.map((c) => c[0]), ["profil_public_visiteur_reglage_lire", "profil_public_visiteur_reglage_ecrire", "profil_public_visiteurs_lister"]);
  assert.strictEqual(JSON.stringify(r.calls[1][1]), JSON.stringify({ p_actif: true }));
  assert.ok(shown(r.els["pv-liste-zone"]) && !shown(r.els["pv-invitation"]) && shown(r.els["pv-liste"]) && !shown(r.els["pv-vide"]));
  const [a, b] = r.els["pv-liste"].children;
  const lien = a.children[0]; assert.deepStrictEqual([lien.tagName, lien.attrs.href, lien.textContent], ["a", "/m/atelier-alice", "Alice"]);
  assert.strictEqual(a.children[1].textContent, "3 visites · dernier passage le 12 novembre 2026");
  assert.deepStrictEqual([b.children[0].tagName, b.children[0].textContent], ["span", "<b>Bruno</b>"], "pas de lien sans page publique ; le HTML reste du texte");
  assert.strictEqual(b.children[1].textContent, "1 visite · dernier passage le 10 novembre 2026");
  const all = (e) => e.textContent + JSON.stringify(e.attrs) + e.children.map(all).join(""); const tout = all(r.els["pv-liste"]);
  assert.ok(!/0000000000aa|user_id/.test(tout), "aucun identifiant dans la page");
});

test("profil-visiteurs.js : réglage déjà actif → liste chargée à l'ouverture ; liste vide → message ; échec de liste → erreur discrète", async () => {
  let r = runVisiteurs({ actif: true }); await tick();
  assert.strictEqual(r.els["pv-switch"].checked, true); assert.ok(shown(r.els["pv-liste"]) && r.els["pv-liste"].children.length === 2);
  r = runVisiteurs({ actif: true, liste: [] }); await tick();
  assert.ok(shown(r.els["pv-vide"]) && !shown(r.els["pv-liste"]));
  r = runVisiteurs({ actif: true, listeError: true }); await tick();
  assert.ok(shown(r.els["pv-etat"]) && /pas pu être chargée/.test(r.els["pv-etat"].textContent) && shown(r.els["pv-liste-zone"]));
});

test("profil-visiteurs.js : désactiver → message d'effacement, la liste disparaît et n'est plus demandée", async () => {
  const r = runVisiteurs({ actif: true }); await tick();
  const avant = r.calls.length; await r.toggle(false);
  assert.strictEqual(JSON.stringify(r.calls.slice(avant)), JSON.stringify([["profil_public_visiteur_reglage_ecrire", { p_actif: false }]]));
  assert.ok(!shown(r.els["pv-liste-zone"]) && shown(r.els["pv-invitation"]));
  assert.match(r.els["pv-etat"].textContent, /historique de visites a été effacé/);
});

test("profil-visiteurs.js : écriture refusée → l'interrupteur revient à son état, message d'erreur ; fonction absente → message neutre, interrupteur bloqué", async () => {
  let r = runVisiteurs({ actif: false, ecrireError: true }); await tick();
  await r.toggle(true);
  assert.strictEqual(r.els["pv-switch"].checked, false); assert.ok(!shown(r.els["pv-liste-zone"]) && shown(r.els["pv-etat"]) && r.els["pv-etat"].classes.has("erreur"));
  assert.strictEqual(r.els["pv-switch"].disabled, false, "réactivé après l'échec");
  r = runVisiteurs({ lireError: true }); await tick();
  assert.ok(r.els["pv-switch"].disabled === true && /pas encore disponible/.test(r.els["pv-etat"].textContent) && !shown(r.els["pv-liste-zone"]) && !shown(r.els["pv-invitation"]));
});

test("profil-visiteurs.js : aucun innerHTML, aucune ressource externe, aucun stockage local, aucun suivi", () => {
  const js = read("profil-visiteurs.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(js));
  assert.ok(!/https?:\/\/|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|console\./.test(js), "aucune requête libre, aucun stockage, aucun journal");
  assert.ok(!/supabase\.from\(|\.from\(["']/.test(js), "jamais de lecture directe d'une table");
});

// ====================== profil.html ======================
const HTML = read("profil.html");
test("profil.html : interrupteur DÉSACTIVÉ par défaut, explication en 3 lignes, liste et invitation, section masquée tant que non connecté", () => {
  const sec = HTML.slice(HTML.indexOf('<section class="pp pv hidden" id="pv-section"'), HTML.indexOf("</section>", HTML.indexOf('id="pv-section"')));
  assert.ok(sec.length > 500, "section présente et masquée au départ");
  assert.match(sec, /<input type="checkbox" id="pv-switch" role="switch">/); assert.ok(!/id="pv-switch"[^>]*\b(checked|disabled)\b/.test(sec), "désactivé par défaut");
  assert.match(sec, /<label class="pv-interrupteur" for="pv-switch">[\s\S]*Montrer mon nom quand je consulte la carte d'un membre<\/span><\/label>/);
  assert.strictEqual((sec.match(/<li>/g) || []).length, 3, "explication en 3 lignes");
  assert.match(sec, /Qui voit quoi/); assert.match(sec, /Réciprocité/); assert.match(sec, /Effacement/); assert.match(sec, /30 jours/);
  assert.match(sec, /<h2 id="pv-titre">Qui a vu ma carte<\/h2>/);
  ["pv-etat", "pv-invitation", "pv-liste-zone", "pv-vide", "pv-liste"].forEach((i) => assert.ok(new RegExp('id="' + i + '"').test(sec), i));
  assert.match(sec, /<a class="pp-regles" id="pv-lien-regles" href="\/regles-pages-publiques\.html">/);
  assert.ok(HTML.indexOf('id="pv-section"') > HTML.indexOf('id="pp-section"'), "après « Mon profil public »");
  assert.ok(HTML.indexOf('<script src="profil-visiteurs.js"></script>') > HTML.indexOf('<script src="profil-public.js"></script>'));
  assert.strictEqual((HTML.match(/profil-visiteurs\.js/g) || []).length, 1);
});

test("profil.html : zones tactiles ≥ 48 px (interrupteur 56, liens 48), contrastes AA dans les deux thèmes, --text-dim jamais pour du texte", () => {
  const css = HTML.match(/\/\* Qui a vu ma carte[\s\S]*?(?=\/\* Mon profil public)/)[0];
  assert.match(css, /\.pv \.pv-interrupteur \{[^}]*min-height: 56px/); assert.match(css, /\.pv \.pv-nom \{[^}]*min-height: 48px/); assert.match(css, /\.pv \.pv-liste li \{[^}]*min-height: 56px/);
  assert.ok(!/var\(--text-dim\)/.test(css));
  assert.match(css, /body\.light-theme \.pv a\.pv-nom \{ color: var\(--gold-text, #856500\); \}/);
  assert.match(css, /prefers-reduced-motion|transition: background \.15s/);
  const hex = (s) => { let h = s.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const theme = read("theme.css"), decl = (t, n) => { const m = new RegExp(n + ":\\s*(#[0-9a-fA-F]{3,6})").exec(t); assert.ok(m, n); return m[1]; };
  const dark = theme.match(/:root \{([^}]*)\}/)[1], light = theme.match(/body\.light-theme\{([^}]*)\}/)[1];
  const TH = { sombre: { fond: decl(dark, "--bg"), carte: decl(dark, "--bg-card"), texte: decl(dark, "--white"), doux: decl(dark, "--text-muted"), accent: decl(dark, "--gold") }, clair: { fond: decl(light, "--bg"), carte: decl(light, "--bg-card"), texte: decl(light, "--white"), doux: decl(light, "--text-muted"), accent: decl(theme, "--gold-text") } };
  for (const [n, t] of Object.entries(TH)) [["texte atténué sur la carte", t.doux, t.carte, 4.5], ["texte atténué sur le fond de l'interrupteur", t.doux, t.fond, 4.5], ["nom sur la carte", t.texte, t.carte, 4.5], ["lien doré sur la carte", t.accent, t.carte, 4.5], ["piste de l'interrupteur (3:1)", t.doux, t.fond, 3]]
    .forEach(([l, a, b, min]) => { const r = ratio(a, b); assert.ok(r >= min, n + " — " + l + " : " + r.toFixed(2)); });
  assert.ok(ratio("#0A0A0A", decl(dark, "--gold")) >= 3, "bouton de l'interrupteur actif sur la piste dorée");
});

// ====================== m.js : enregistrement discret ======================
function fakeElM(id) {
  const el = { id, children: [], attrs: {}, _text: "", listeners: {}, classes: new Set(["hidden"]),
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); }, contains: (c) => el.classes.has(c) },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; } };
  return el;
}
async function runM(client) {
  const els = {};
  ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "lieu-ligne", "presentation", "contact-zone", "btn-reessayer", "btn-partager", "signalement-zone", "btn-signaler", "btn-connexion-signaler", "ecrire-zone", "btn-ecrire", "btn-connexion-ecrire", "ecrire-aide", "ecrire-etat"].forEach((i) => { els[i] = fakeElM(i); });
  els.chargement.classes.delete("hidden");
  const doc = { title: "", body: fakeElM("body"), getElementById: (i) => els[i], createElement: (t) => Object.assign(fakeElM(null), { tagName: t }) };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => client }, location: { pathname: "/m/mon-atelier", search: "" } };
  vm.runInNewContext(read("m.js"), { window: win, document: doc, Array, String, Promise });
  await tick(30);
  return els;
}
const ROW = { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: "", metier: "", presentation: "", localisation: "", contact_type: "", contact_valeur: "", publie: true };
function clientM(o) {
  const opts = o || {}, calls = [];
  return { calls,
    auth: { getSession: async () => { calls.push(["getSession"]); return { data: { session: opts.user ? { user: opts.user } : null } }; } },
    rpc: (n, a) => {
      calls.push([n, a]);
      if (n === "profil_public_lire") return Promise.resolve({ data: opts.preview ? [] : [ROW], error: null });
      if (n === "profil_public_mien") return Promise.resolve({ data: opts.preview ? [ROW] : [], error: null });
      if (n === "profils_publics_ouvert") return Promise.resolve({ data: true, error: null });
      if (n === "profil_public_visiteur_enregistrer") {
        if (opts.enreg === "pending") return new Promise(() => {});
        if (opts.enreg === "throw") return Promise.reject(new Error("réseau coupé"));
        if (opts.enreg === "error") return Promise.resolve({ data: null, error: { message: "fonction absente", code: "42883" } });
        return Promise.resolve({ data: true, error: null });
      }
      if (n === "profil_public_messages_ouverts") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: { message: "inconnue" } });
    } };
}
const visible = (e) => !e.classes.has("hidden");
const ENR = (c) => c.calls.filter((x) => x[0] === "profil_public_visiteur_enregistrer");

test("m.js : membre connecté → un appel d'enregistrement avec l'adresse seulement, la page s'affiche normalement", async () => {
  const c = clientM({ user: { id: "u1" } }); const els = await runM(c);
  assert.strictEqual(JSON.stringify(ENR(c)), JSON.stringify([["profil_public_visiteur_enregistrer", { p_adresse: "mon-atelier" }]]));
  assert.ok(visible(els.profil) && !visible(els.etat) && els.nom.textContent === "Atelier Test");
  assert.ok(visible(els["ecrire-zone"]), "la suite (message, signalement) s'affiche aussi");
});

test("m.js : règle 9 — l'enregistrement n'est JAMAIS attendu : une réponse qui n'arrive jamais ne bloque ni la page ni la suite", async () => {
  const c = clientM({ user: { id: "u1" }, enreg: "pending" }); const els = await runM(c);
  assert.strictEqual(ENR(c).length, 1);
  assert.ok(visible(els.profil) && !visible(els.etat) && !visible(els.chargement) && visible(els["ecrire-zone"]) && visible(els["signalement-zone"]));
  assert.ok(c.calls.some((x) => x[1] === "profil_public_messages_ouverts" || x[0] === "profil_public_messages_ouverts"));
});

test("m.js : règle 9 — échec, refus ou erreur réseau : AUCUN message d'erreur visible, page intacte", async () => {
  for (const enreg of ["throw", "error"]) {
    const c = clientM({ user: { id: "u1" }, enreg }); const els = await runM(c);
    assert.ok(visible(els.profil) && !visible(els.etat) && !visible(els.bandeau), enreg);
    assert.ok(!Object.values(els).some((e) => /fonction absente|réseau coupé|42883|erreur/i.test(e.textContent)), enreg + " : aucun texte d'erreur");
  }
});

test("m.js : visiteur non connecté, compte anonyme ou aperçu du propriétaire → aucun appel d'enregistrement", async () => {
  for (const o of [{ user: null }, { user: { id: "u", is_anonymous: true } }, { user: { id: "u", app_metadata: { provider: "anonymous" } } }, { user: { id: "u1" }, preview: true }]) {
    const c = clientM(o); await runM(c); assert.strictEqual(ENR(c).length, 0, JSON.stringify(o));
  }
});

test("m.js : garde-fous statiques — appel sans await, dans un try/catch muet, une seule lecture de session partagée, aucun affichage", () => {
  const js = read("m.js"), f = squash(js.slice(js.indexOf("async function recordVisit"), js.indexOf("// ---------- Signalement")));
  assert.match(js, /\n\s+if \(!preview && !v\.banner\) recordVisit\(supabase, adresse\);/); assert.ok(!/await recordVisit/.test(js), "jamais attendu");
  assert.match(f, /^async function recordVisit\(supabase, adresse\) \{ try \{ if \(!\(await currentUser\(supabase\)\)\) return; await supabase\.rpc\("profil_public_visiteur_enregistrer", \{ p_adresse: adresse \}\); \} catch \(e\) \{ \/\* ignoré en silence \*\/ \} \}/);
  assert.ok(!/show\(|showState|textContent|say\(|alert|console/.test(f.replace(/\/\/[^\n]*/g, "")), "aucun affichage dans l'enregistrement");
  assert.ok(js.indexOf("recordVisit(supabase, adresse);") < js.indexOf("await setupReport(supabase, row, adresse, v)"), "lancé avant le signalement et le message : aucun retard");
  assert.ok(!/innerHTML/.test(js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")));
  assert.strictEqual((js.match(/getSession\(\)/g) || []).length, 1, "une seule lecture de session");
});

// ====================== règles, cache, périmètre ======================
test("regles-pages-publiques.html : paragraphe « Qui a vu ma carte » (opt-in, réciprocité, 30 jours, effacement) ; la date existante n'est PAS modifiée", () => {
  const P = read("regles-pages-publiques.html"), s = P.slice(P.indexOf('<section aria-labelledby="r-visiteurs">'), P.indexOf("</section>", P.indexOf('id="r-visiteurs"')));
  assert.match(s, /<h2 id="r-visiteurs">Qui a vu ma carte<\/h2>/);
  assert.match(s, /facultative et désactivée par défaut/); assert.match(s, /à condition qu'ils l'aient eux aussi activée/); assert.match(s, /30 jours au maximum/); assert.match(s, /effacé immédiatement/); assert.match(s, /vous devez avoir activé le réglage vous-même/);
  assert.match(P, /<p class="maj">Dernière mise à jour : 24 novembre 2026\.<\/p>/, "la date reste celle de la page existante (à revoir par le fondateur)");
});

test("sw.js : cache v130 (main était à v129) et profil-visiteurs.js pré-caché ; vercel.json et api/ inchangés", () => {
  const sw = read("sw.js"); assert.match(sw, /const CACHE_NAME = "mahoutoplus-shell-v(130|13[1-9]|1[4-9]\d)";/); assert.strictEqual((sw.match(/"\/profil-visiteurs\.js"/g) || []).length, 1);
  assert.ok(sw.indexOf('"/profil-visiteurs.js"') > sw.indexOf('"/profil-public.js"'));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions sur 12 : aucun fichier ajouté dans api/");
  assert.ok(!fs.readdirSync(path.join(root, "api")).some((f) => /visiteur/i.test(f)));
  const v = JSON.parse(read("vercel.json")); assert.ok(!JSON.stringify(v).includes("visiteurs"), "aucune réécriture ni en-tête nouveau");
});

test("périmètre : le partage, le QR, les statistiques administrateur et l'aperçu des salons ne sont pas touchés ; aucune clé ni secret", () => {
  const touche = [FILES[0], "profil-visiteurs.js", "m.js", "profil.html"].map(read).join("\n");
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci|BEGIN (RSA )?PRIVATE KEY|password\s*=/.test(touche + rawRb + rawVf), "aucune clé ni secret");
  const mjs = read("m.js"); ["setupShare", "countVisit", "reportUi", "messagesUi"].forEach((n) => assert.ok(mjs.includes(n), n + " toujours présent"));
  assert.ok(!/admin\/profils-publics/.test(sw_diff_guard()), "page d'administration non concernée");
});
function sw_diff_guard() { return read("sw.js").split("\n").filter((l) => /visiteur/.test(l)).join("\n"); }
