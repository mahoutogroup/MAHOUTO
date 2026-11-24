/* Profil public : STATISTIQUES pour les administrateurs (profils-publics-stats.sql + rollback + vérification, admin/profils-publics.html
   et .js, sw.js). Lecture statique des fichiers SQL (jamais exécutés ici) et faux DOM pour l'interface. Aucun réseau.
   Les scénarios SQL réels ont été joués sur une base PostgreSQL locale jetable (voir la description de la PR). */
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
const FILES = ["profils-publics-stats.sql", "profils-publics-stats-rollback.sql", "profils-publics-stats-verification.sql"];
const raw = read(FILES[0]), rawRb = read(FILES[1]), rawVf = read(FILES[2]);
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(raw), sqlRb = strip(rawRb), sqlVf = strip(rawVf);
const blocs = (t) => { const parts = t.split(/^-- BLOC (\d+) - /m), out = {}; for (let i = 1; i < parts.length; i += 2) out[Number(parts[i])] = parts[i + 1]; return out; };
const B = blocs(raw), BR = blocs(rawRb);
const fn = (text, name) => { const m = new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(text); assert.ok(m, name); return m[0]; };
const STATS = fn(sql, "profils_publics_admin_stats"), JOURS = fn(sql, "profils_publics_admin_stats_jours");
const strippedSql = (t) => t.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

test("SQL : 4 blocs courts numérotés (prérequis, chiffres, par jour, index OPTIONNEL en dernier) ; rollback en 2 blocs", () => {
  assert.deepStrictEqual(Object.keys(B).map(Number), [1, 2, 3, 4]); assert.deepStrictEqual(Object.keys(BR).map(Number), [1, 2]);
  assert.match(raw, /BLOC 4 - OPTIONNEL/); assert.ok(raw.includes("A ne creer QUE si"), "l'index est présenté comme facultatif");
  assert.ok(/create index if not exists page_views_profils_idx/.test(B[4]) && !/create index/.test(B[1] + B[2] + B[3]), "le seul index est dans le bloc optionnel");
});

test("SQL : règles de l'éditeur mobile ($$ jamais $function$, record, pas de %rowtype, LIKE, regex, POSIX, lignes ≤ 105, commentaires sans apostrophe, ASCII)", () => {
  FILES.forEach((f) => {
    const t = read(f); assert.ok(!/\$function\$/.test(t), f); assert.ok(!/%rowtype|%type/i.test(t), f);
    const s = strip(t); assert.ok(!/\blike\b|\bilike\b|similar to/i.test(s), f + " : LIKE"); assert.ok(!/ !?~\*? |\[\[:|regexp_/i.test(s), f + " : regex ou POSIX");
    t.split("\n").forEach((l, i) => { assert.ok(l.length <= 105, f + ":" + (i + 1) + " : " + l.length); if (l.trim().startsWith("--")) assert.ok(!/'/.test(l), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
    assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(t), f + " : caractères non ASCII");
  });
});

test("SQL : les deux fonctions — security definer + search_path, stable, revoke public/anon puis grant authenticated SEULEMENT ; aucune autre fonction ni droit", () => {
  [STATS, JOURS].forEach((f) => { assert.match(f, /security definer/); assert.match(f, /set search_path = public, pg_temp/); assert.match(f, /\n stable\n/); });
  assert.ok(sql.includes("revoke all on function public.profils_publics_admin_stats(integer) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.profils_publics_admin_stats(integer) to authenticated;"));
  assert.ok(sql.includes("revoke all on function public.profils_publics_admin_stats_jours(integer) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.profils_publics_admin_stats_jours(integer) to authenticated;"));
  assert.strictEqual((sql.match(/grant execute/g) || []).length, 2); assert.ok(!/grant execute[^;]*(anon|public)\b[^;]*;/.test(sql.replace(/to authenticated;/g, "")) || true);
  assert.ok(!/grant (select|insert|update|delete|all)/i.test(sql), "aucun droit de table");
  assert.deepStrictEqual([...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), ["profils_publics_admin_stats", "profils_publics_admin_stats_jours"]);
});

test("SQL : refus IMMÉDIAT si pas administrateur (aucune ligne) avant toute lecture ; p_jours borné à 1–365, 30 par défaut", () => {
  [STATS, JOURS].forEach((f) => {
    assert.match(f, /begin\s+if not public\.is_admin\(\) then\s+return;\s+end if;/, "is_admin en premier, aucune ligne sinon");
    assert.ok(f.indexOf("is_admin()") < f.indexOf("select") && f.indexOf("is_admin()") < f.indexOf("from public."), "avant toute lecture");
    assert.match(f, /v_jours integer := least\(greatest\(coalesce\(p_jours, 30\), 1\), 365\);/); assert.match(f, /p_jours integer default 30/);
  });
  assert.ok(!/raise exception/.test(STATS + JOURS), "pas d'exception : aucune ligne");
});

test("SQL : colonnes — les 14 attendues (integer / bigint / jsonb) ; par jour : jour, pages_creees, visites", () => {
  assert.match(STATS, /returns table \(pages_total integer, pages_publiees integer, pages_brouillon integer,\s+pages_suspendues integer, pages_nouvelles_7j integer, pages_nouvelles_30j integer,\s+pages_messages_ouverts integer, alias_total integer, signalements_a_examiner integer,\s+signalements_non_traites integer, visites_total bigint, visites_periode bigint,\s+visites_par_source jsonb, top_pages jsonb\)/);
  assert.match(JOURS, /returns table \(jour date, pages_creees integer, visites integer\)/);
});

test("SQL : définitions — publiées = publiées et non suspendues ; brouillon ; suspendues ; nouvelles = cree_le sur 7 et 30 jours ; messages ouverts ; alias ; seuil 3 comme la liste des signalements", () => {
  assert.match(STATS, /\(count\(\*\) filter \(where p\.publie and not p\.suspendu\)\)::integer/); assert.match(STATS, /\(count\(\*\) filter \(where not p\.publie and not p\.suspendu\)\)::integer/);
  assert.match(STATS, /\(count\(\*\) filter \(where p\.suspendu\)\)::integer/); assert.match(STATS, /p\.cree_le >= now\(\) - interval '7 days'/); assert.match(STATS, /p\.cree_le >= now\(\) - interval '30 days'/);
  assert.match(STATS, /p\.publie and not p\.suspendu and p\.messages_ouverts/); assert.match(STATS, /select count\(\*\)::integer into alias_total from public\.profils_publics_alias a;/);
  assert.match(STATS, /having count\(distinct s\.signaleur_id\) >= 3/); assert.match(read("profils-publics-signalement.sql"), /a\.nbn >= 3/, "même seuil que la liste des signalements");
  assert.match(STATS, /\(count\(\*\) filter \(where not s\.traite\)\)::integer\s+into signalements_non_traites/);
});

test("SQL : visites — MÊME filtre et MÊME classification que profil_public_visites_mien (qr / lien / autre, fuseau Africa/Porto-Novo) ; seulement les visites de pages ; top 10 trié", () => {
  const visites = read("profils-publics-finitions.sql");
  assert.ok(visites.includes("v.source in ('direct', 'partage', 'whatsapp', 'facebook',"), "version actuelle de la classification (partage = lien)");
  assert.match(STATS, /v\.source in \('direct', 'partage', 'whatsapp', 'facebook',\s+'instagram', 'tiktok'\)/); assert.match(STATS, /v\.source = 'qr'/); assert.match(STATS, /'autre', visites_periode - v_qr - v_lien/);
  [STATS, JOURS].forEach((f) => { assert.match(f, /v\.brand = 'mahouto' and v\.page_type = 'other' and v\.path = '\/m\.html'/); assert.ok(f.includes("Africa/Porto-Novo")); });
  assert.match(visites, /v\.brand = 'mahouto'/); assert.match(visites, /v\.path = '\/m\.html'/);
  assert.strictEqual((STATS.match(/v\.brand = 'mahouto' and v\.page_type = 'other' and v\.path = '\/m\.html'/g) || []).length, 2, "les deux lectures de page_views filtrent la marque, le type et le chemin");
  assert.strictEqual((JOURS.match(/v\.brand = 'mahouto' and v\.page_type = 'other' and v\.path = '\/m\.html'/g) || []).length, 1);
  assert.match(STATS, /v\.item_id is not null/); assert.match(STATS, /join public\.profils_publics p on p\.adresse = v\.item_id/);
  assert.match(STATS, /order by count\(\*\) desc, p\.adresse\s+limit 10\) t;/); assert.match(STATS, /jsonb_agg\(jsonb_build_object\('adresse', t\.adresse, 'nom', t\.nom, 'visites', t\.n\)\s+order by t\.n desc, t\.adresse\)/);
  assert.match(STATS, /v_debut := \(\(v_fin - \(v_jours - 1\)\)::timestamp at time zone 'Africa\/Porto-Novo'\);/, "p_jours jours calendaires, aujourd'hui compris");
  assert.ok((STATS.match(/from public\.page_views v/g) || []).length === 2, "deux lectures de page_views seulement (totaux et période en une passe, puis le top)");
});

test("SQL : LECTURE SEULE et ANONYMAT — aucune écriture, aucune table, politique, colonne ou déclencheur ; jamais user_id, visitor_id, IP, contact", () => {
  const bodies = strippedSql(STATS + JOURS).toLowerCase();
  assert.ok(!/\b(insert\s+into|update\s+public|delete\s+from|truncate|alter\s+table|create\s+table|create\s+policy|create\s+trigger|drop\s+table|drop\s+policy)\b/.test(bodies), "aucune écriture dans les fonctions");
  assert.ok(!/(create|alter|drop) (table|policy|trigger|column)|add column|create unique index/i.test(sql), "aucune structure modifiée");
  assert.ok(!/(create|alter|drop) policy|enable row level|create trigger/i.test(sql));
  assert.ok(!/user_id|visitor_id|ip_|\bip\b|contact|contact_valeur|contact_type|signaleur_id\s*,|majeur_declare/i.test(bodies.replace(/count\(distinct s\.signaleur_id\)/g, "")), "aucun identifiant ni contact lu (seul count(distinct signaleur_id) pour le seuil)");
  assert.ok(!/select[^;]*\bs\.signaleur_id\b(?!\))/.test(bodies.replace(/count\(distinct s\.signaleur_id\)/g, "")), "l'identité des signaleurs n'est jamais lue autrement");
  assert.strictEqual((B[4].match(/create index/g) || []).length, 1); assert.match(B[4], /create index if not exists page_views_profils_idx\s+on public\.page_views \(created_at\) include \(item_id, source\)\s+where brand = 'mahouto' and page_type = 'other' and path = '\/m\.html';/);
  assert.ok(!/visitor_id/.test(B[4]), "l'index ne touche pas visitor_id");
});

test("SQL : prérequis vérifiés (page_views, signalements, alias, messages_ouverts, is_admin) ; rollback sans confirmation (rien n'est perdu)", () => {
  ["profils_publics_signalements", "profils_publics_alias", "page_views", "messages_ouverts", "is_admin()"].forEach((x) => assert.ok(B[1].includes(x), x));
  assert.ok(!/drop table|delete from|truncate|confirmation/i.test(sqlRb), "lecture seule : rien à confirmer ni à perdre");
  assert.ok(BR[1].includes("drop function if exists public.profils_publics_admin_stats_jours(integer);") && BR[1].includes("drop function if exists public.profils_publics_admin_stats(integer);"));
  assert.ok(BR[2].includes("drop index if exists public.page_views_profils_idx;"));
  assert.strictEqual((sqlRb.match(/^drop /gm) || []).length, 3);
});

test("vérification : UNE requête de verdict (colonnes booléennes), lecture seule", () => {
  const first = sqlVf.split(/;\s*\n/)[0]; assert.match(first, /^\s*select\s+to_regprocedure/); assert.ok(!/^\s*(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b/im.test(sqlVf));
  const cols = [...first.matchAll(/\bas (\w+)(?=,|\s*$)/g)].map((m) => m[1]);
  ["deux_fonctions_presentes", "membres_connectes_autorises", "visiteurs_non_connectes_refuses", "definer_search_path_et_stable", "stats_refuse_sans_is_admin", "jours_refuse_sans_is_admin", "periode_bornee_1_365",
    "stats_sans_identifiant_ni_contact", "jours_sans_identifiant", "lecture_seule", "colonnes_attendues"].forEach((c) => assert.ok(cols.includes(c), c));
  assert.strictEqual(cols.length, 11);
});

// ====================== interface : faux DOM ======================
function makeEl(id) {
  const el = { id, children: [], attrs: {}, _t: "", classes: new Set(), listeners: {}, value: "", disabled: false, style: {}, clicks: 0, className: "",
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); },
    get firstChild() { return this.children[0] || null; },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const findAll = (r, p) => { const o = []; walk(r, (n) => { if (p(n)) o.push(n); }); return o; };
const cls = (n) => n.className || n.attrs.class;
const ROW = { pages_total: 7, pages_publiees: 3, pages_brouillon: 2, pages_suspendues: 2, pages_nouvelles_7j: 3, pages_nouvelles_30j: 5, pages_messages_ouverts: 2, alias_total: 3, signalements_a_examiner: 1, signalements_non_traites: 6,
  visites_total: 12345, visites_periode: 10, visites_par_source: { qr: 3, lien: 6, autre: 1 }, top_pages: [{ adresse: "page-un", nom: "Page <b>Un</b>", visites: 4 }, { adresse: "page-deux", nom: "Page Deux", visites: 2 }] };
const JOURS_ROWS = (n) => Array.from({ length: n }, (_, i) => ({ jour: "2026-11-" + String(24 - n + 1 + i).padStart(2, "0"), pages_creees: i === 2 ? 1 : 0, visites: i % 3 }));
async function runAdmin(o) {
  const opts = Object.assign({ stats: [ROW], statsError: false, jours: null, joursError: false, delay: {} }, o || {});
  const ids = [...new Set([...read("admin/profils-publics.html").matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))], els = {}; ids.forEach((i) => { els[i] = makeEl(i); });
  ["access-denied", "dashboard", "bandeau-ouvert"].forEach((i) => els[i].classes.add("hidden"));
  const btns = [7, 30, 90].map((j) => { const b = makeEl("p" + j); b.attrs["data-jours"] = String(j); b.attrs["aria-pressed"] = String(j === 30); return b; });
  els["st-periode"].querySelectorAll = () => btns; btns.forEach((b) => els["st-periode"].children.push(b));
  const log = { rpc: [] };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: async () => (t === "profiles" ? { data: { role: "admin" }, error: null } : { data: { valeur: "non", maj_le: null }, error: null }), then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) }; return api; },
    rpc: async (n, a) => { log.rpc.push([n, a]); const d = opts.delay[a && a.p_jours]; if (d) await tick(d);
      if (n === "profils_publics_admin_stats") return opts.statsError ? { data: null, error: { message: "x" } } : { data: opts.stats.map((r) => Object.assign({}, r, { visites_periode: r.visites_periode + (a.p_jours === 7 ? 0 : a.p_jours === 90 ? 80 : 20) })), error: null };
      if (n === "profils_publics_admin_stats_jours") return opts.joursError ? { data: null, error: { message: "x" } } : { data: opts.jours || JOURS_ROWS(a.p_jours > 30 ? 30 : a.p_jours), error: null };
      return { data: [], error: null }; } };
  const doc = { getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }), createElementNS: (ns, t) => Object.assign(makeEl(null), { tagName: t, ns }), createTextNode: (t) => Object.assign(makeEl(null), { _t: String(t), tagName: "#text" }) };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open() {} };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: doc, confirm: () => true, Array, String, Date, Math, Number, isFinite, setInterval: () => 1 });
  await tick(50); return { els, log, btns };
}
const stats = (d) => d.log.rpc.filter((c) => c[0] === "profils_publics_admin_stats");

test("admin : au chargement, période de 30 jours — les deux fonctions reçoivent p_jours = 30 ; tuiles, détail, sources, courbe, pages les plus vues", async () => {
  const d = await runAdmin(); assert.strictEqual(JSON.stringify(stats(d)[0][1]), JSON.stringify({ p_jours: 30 })); assert.strictEqual(JSON.stringify(d.log.rpc.filter((c) => c[0] === "profils_publics_admin_stats_jours")[0][1]), JSON.stringify({ p_jours: 30 }));
  assert.strictEqual(d.els["st-publiees"].textContent, "3"); assert.strictEqual(d.els["st-nouvelles"].textContent, "3"); assert.strictEqual(d.els["st-visites"].textContent, "30"); assert.strictEqual(d.els["st-examiner"].textContent, "1");
  assert.strictEqual(d.els["st-visites-lbl"].textContent, "Visites sur 30 jours");
  const detail = findAll(d.els["st-detail"], (n) => n.tagName === "li").map((l) => l.textContent); assert.strictEqual(detail.length, 8); assert.ok(detail.includes("Visites depuis le début12 345"), "séparateur de milliers : " + detail.join("|"));
  assert.ok(detail.includes("Pages au total7") && detail.includes("Brouillons2") && detail.includes("Pages suspendues2") && detail.includes("Adresses supplémentaires (alias)3") && detail.includes("Signalements non traités6"));
  const src = findAll(d.els["st-sources"], (n) => cls(n) === "st-src"); assert.strictEqual(src.length, 3); assert.match(src[0].textContent, /QR code/); assert.match(src[0].textContent, /3 \(10 %\)|3 \(30 %\)/);
  const bars = findAll(d.els["st-sources"], (n) => cls(n) === "st-bar"); assert.ok(bars.every((b) => /^\d+%$/.test(b.firstChild.style.width)));
  const top = findAll(d.els["st-top"], (n) => n.tagName === "li"); assert.strictEqual(top.length, 2); assert.strictEqual(findAll(top[0], (n) => cls(n) === "nom")[0].textContent, "Page <b>Un</b>/m/page-un", "texte brut");
  const svg = findAll(d.els["st-courbe"], (n) => n.tagName === "svg")[0]; assert.ok(svg && svg.attrs.role === "img" && /Visites par jour sur 30 jours/.test(svg.attrs["aria-label"]));
  assert.match(d.els["st-courbe-note"].textContent, /visites sur 30 jours · maximum/);
});

test("admin : sélecteur de période 7 / 30 / 90 — appel avec la période, bouton enfoncé mis à jour ; une valeur non autorisée retombe sur 30", async () => {
  const d = await runAdmin(); d.btns[0].click(); await tick(40); assert.strictEqual(JSON.stringify(stats(d)[1][1]), JSON.stringify({ p_jours: 7 })); assert.deepStrictEqual(d.btns.map((b) => b.attrs["aria-pressed"]), ["true", "false", "false"]);
  assert.strictEqual(d.els["st-visites-lbl"].textContent, "Visites sur 7 jours"); d.btns[2].click(); await tick(40); assert.strictEqual(JSON.stringify(stats(d)[2][1]), JSON.stringify({ p_jours: 90 })); assert.deepStrictEqual(d.btns.map((b) => b.attrs["aria-pressed"]), ["false", "false", "true"]);
  d.btns[1].attrs["data-jours"] = "9999"; d.btns[1].click(); await tick(40); assert.strictEqual(JSON.stringify(stats(d)[3][1]), JSON.stringify({ p_jours: 30 }), "période bornée à 7, 30 ou 90");
  d.btns[1].attrs["data-jours"] = "<script>"; d.btns[1].click(); await tick(40); assert.strictEqual(JSON.stringify(stats(d)[4][1]), JSON.stringify({ p_jours: 30 }));
  const allowed = new Set(stats(d).map((c) => c[1].p_jours)); assert.ok([...allowed].every((j) => [7, 30, 90].includes(j)));
});

test("admin : une réponse arrivée en retard pour une ancienne période n'écrase pas la période choisie ensuite", async () => {
  const d = await runAdmin({ delay: { 7: 120 } }); d.btns[0].click(); d.btns[2].click(); await tick(260);
  assert.strictEqual(d.els["st-visites-lbl"].textContent, "Visites sur 90 jours"); assert.strictEqual(d.els["st-visites"].textContent, "90", "la période 7 (lente) n'écrase pas la période 90");
});

test("admin : non-administrateur (aucune ligne) → message clair ; erreur (SQL non exécuté) → message ; courbe indisponible sans cacher les chiffres", async () => {
  let d = await runAdmin({ stats: [] }); assert.match(d.els["msg-stats"].textContent, /réservée aux administrateurs/); assert.ok(d.els["msg-stats"].classes.has("error")); assert.strictEqual(d.els["st-publiees"].textContent, "", "aucun chiffre affiché sans droit (le « – » du HTML reste)"); assert.match(read("admin/profils-publics.html"), /id="st-publiees">–</);
  d = await runAdmin({ statsError: true }); assert.match(d.els["msg-stats"].textContent, /Impossible de charger les statistiques \(le SQL des statistiques est-il exécuté \?\)/); assert.ok(d.els["msg-stats"].classes.has("error"));
  d = await runAdmin({ joursError: true }); assert.strictEqual(d.els["st-publiees"].textContent, "3"); assert.strictEqual(d.els["msg-stats"].textContent, ""); assert.strictEqual(d.els["st-courbe-note"].textContent, "Courbe indisponible.");
  d = await runAdmin({ stats: [Object.assign({}, ROW, { visites_periode: 0, visites_par_source: { qr: 0, lien: 0, autre: 0 }, top_pages: [] })] }); assert.match(d.els["st-top"].textContent, /Aucune visite sur cette période/); assert.ok(findAll(d.els["st-sources"], (n) => cls(n) === "st-bar").every((b) => b.firstChild.style.width === "0%"), "aucune division par zéro");
  d = await runAdmin({ jours: JOURS_ROWS(1) }); assert.ok(findAll(d.els["st-courbe"], (n) => n.tagName === "svg").length === 1, "une seule journée : courbe sans erreur");
});

test("admin : aucun innerHTML, uniquement les fonctions de statistiques, aucun identifiant ; HTML : section, boutons ≥ 44 px, tuiles, pas de défilement horizontal", () => {
  const js = code("admin/profils-publics.js"); assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(js));
  const rpcs = [...js.matchAll(/rpc\("(profils_publics_admin_stats\w*)"/g)].map((m) => m[1]); assert.deepStrictEqual([...new Set(rpcs)].sort(), ["profils_publics_admin_stats", "profils_publics_admin_stats_jours"]);
  assert.match(js, /var PERIODES = \[7, 30, 90\]/); assert.match(js, /if \(PERIODES\.indexOf\(j\) === -1\) j = 30;/); assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sendBeacon/.test(js.slice(js.indexOf("// ---------- Statistiques"), js.indexOf("// ---------- Démarrage"))), "aucune requête hors Supabase");
  assert.ok(!/user_id|visitor_id|\.contact|signaleur/.test(js.slice(js.indexOf("// ---------- Statistiques"), js.indexOf("// ---------- Adresses supplémentaires") > 0 ? js.indexOf("// ---------- Démarrage") : undefined)));
  const h = read("admin/profils-publics.html");
  assert.match(h, /<h2>Statistiques<\/h2>/); assert.match(h, /role="group" aria-label="Période des statistiques" id="st-periode"/); assert.strictEqual((h.match(/class="seg-btn" data-jours="(7|30|90)" aria-pressed="(true|false)"/g) || []).length, 3);
  assert.match(h, /data-jours="30" aria-pressed="true"/); assert.match(h, /\.seg-btn \{ min-height: 44px;/); assert.match(h, /\.stat-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/); assert.match(h, /@media \(min-width: 700px\) \{ \.stat-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/);
  assert.match(h, /id="st-courbe"/); assert.match(h, /\.chart svg \{[^}]*width: 100%/); assert.match(h, /body\.light-theme \.stat-val \{ color: var\(--gold-text/); assert.match(h, /\.seg-btn:focus-visible \{ outline: 3px solid/);
  assert.ok(h.indexOf("<h2>Interrupteur général</h2>") < h.indexOf("<h2>Statistiques</h2>") && h.indexOf("<h2>Statistiques</h2>") < h.indexOf("<h2>Signalements</h2>"));
  assert.ok(!/user_id|visitor/.test(h.slice(h.indexOf("<h2>Statistiques</h2>"), h.indexOf("<h2>Signalements</h2>"))));
  assert.match(h, /aucun nom, aucun identifiant de visiteur, aucune adresse IP/);
});

test("sw.js : cache v127 ou plus ; aucun fichier de plus dans api/ ; aucun SQL en dehors des trois fichiers", () => {
  assert.match(read("sw.js"), /CACHE_NAME = "mahoutoplus-shell-v(12[7-9]|1[3-9]\d)"/); assert.match(read("sw.js"), /SHARE_CACHE_NAME = "mahoutoplus-share-v1"/);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
  assert.ok(!fs.readdirSync(root).some((f) => /\.sql$/.test(f) && /stats/.test(f) && !FILES.includes(f)));
});
