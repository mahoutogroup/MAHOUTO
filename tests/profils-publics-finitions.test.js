/* Profil public, finitions : rappel visible quand la fonction est OUVERTE (déclencheur maj_le, bandeau admin) et classement des
   sources de visite (« partage » = lien). Aucun réseau, aucune base. */
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

// ====================== durée du bandeau (fonction pure) ======================
const T0 = Date.parse("2026-11-23T10:00:00Z"), MIN = 60000;
const at = (minutes) => PU.ouvertDepuis("2026-11-23T10:00:00Z", T0 + minutes * MIN);

test("ouvertDepuis : heures et minutes, « Pensez à la refermer après vos tests. » sous 2 h", () => {
  assert.strictEqual(at(5).text, "La fonction est OUVERTE depuis 5 min. Pensez à la refermer après vos tests.");
  assert.strictEqual(at(59).text, "La fonction est OUVERTE depuis 59 min. Pensez à la refermer après vos tests.");
  assert.strictEqual(at(60).text, "La fonction est OUVERTE depuis 1 h 0 min. Pensez à la refermer après vos tests.");
  assert.strictEqual(at(90).text, "La fonction est OUVERTE depuis 1 h 30 min. Pensez à la refermer après vos tests.");
  assert.strictEqual(at(119).text, "La fonction est OUVERTE depuis 1 h 59 min. Pensez à la refermer après vos tests.");
  assert.strictEqual(at(0).text, "La fonction est OUVERTE depuis moins d'1 min. Pensez à la refermer après vos tests.");
  assert.ok([at(5), at(119)].every((i) => i.known && i.level === "normal"));
  assert.strictEqual(at(5).minutes, 5);
  assert.strictEqual(PU.ouvertDepuis("2026-11-23T10:00:00Z", T0 + 5 * MIN + 59000).minutes, 5, "arrondi par défaut");
});

test("ouvertDepuis : à partir de 2 h le message est plus insistant", () => {
  assert.strictEqual(PU.OUVERT_INSISTANT_MIN, 120);
  const i = at(120); assert.strictEqual(i.level, "insistant");
  assert.strictEqual(i.text, "La fonction est OUVERTE depuis plus de 2 h (2 h 0 min) : si ce n'est pas voulu, fermez-la maintenant.");
  assert.strictEqual(at(5 * 60 + 12).text, "La fonction est OUVERTE depuis plus de 2 h (5 h 12 min) : si ce n'est pas voulu, fermez-la maintenant.");
  assert.strictEqual(at(26 * 60).level, "insistant");
});

test("ouvertDepuis : maj_le absent, invalide ou dans le futur (horloge en retard) → « La fonction est OUVERTE » sans durée ; jamais de nombre aberrant", () => {
  [null, undefined, "", "pas une date", "2026-13-45", 123, {}, []].forEach((v) => {
    const i = PU.ouvertDepuis(v, T0); assert.deepStrictEqual([i.known, i.minutes, i.level, i.text], [false, null, "normal", "La fonction est OUVERTE"], String(v)); });
  const futur = PU.ouvertDepuis("2026-11-23T10:00:00Z", T0 - 90 * MIN); assert.deepStrictEqual([futur.known, futur.text], [false, "La fonction est OUVERTE"], "durée négative : jamais affichée");
  assert.strictEqual(PU.ouvertDepuis("2026-11-23T10:00:00Z", T0 - 1).known, false);
  [NaN, undefined, null, "x"].forEach((n) => assert.strictEqual(PU.ouvertDepuis("2026-11-23T10:00:00Z", n).known, false, String(n)));
  const vieux = PU.ouvertDepuis("2020-01-01T00:00:00Z", T0); assert.strictEqual(vieux.text, "La fonction est OUVERTE depuis plus de 7 jours : si ce n'est pas voulu, fermez-la maintenant."); assert.strictEqual(vieux.level, "insistant");
  [0, 5, 119, 120, 600, 10080, 10081, 100000].forEach((m) => assert.ok(!/-\d|NaN|Infinity|undefined/.test(at(m).text), String(m)));
});

// ====================== bandeau dans la page admin (faux DOM) ======================
function makeEl(id, startHidden) {
  const el = { id, value: "", disabled: false, children: [], parentNode: null, attrs: {}, listeners: {}, classes: new Set(startHidden ? ["hidden"] : []), _text: "", clicks: 0,
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set className(v) { this._cn = String(v); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c)); }, get className() { return this._cn || [...this.classes].join(" "); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; return this.listeners.click && this.listeners.click({ target: this }); }, remove() {} };
  return el;
}
async function runAdmin(o) {
  const opts = Object.assign({ valeur: "oui", maj_le: "2026-11-23T08:00:00Z", now: Date.parse("2026-11-23T08:30:00Z"), readFail: false, writeDenied: false, confirmAnswer: true }, o || {});
  const ids = ["loading-state", "access-denied", "dashboard", "etat-interrupteur", "btn-interrupteur", "msg-interrupteur", "btn-recharger", "msg-liste", "liste-pages", "msg-signalements", "liste-signalements", "bandeau-ouvert", "bandeau-ouvert-texte", "btn-fermer-bandeau", "alias-nom", "alias-page", "btn-alias-ajouter", "msg-alias-form", "msg-alias", "liste-alias"];
  const els = {}; ids.forEach((i) => { els[i] = makeEl(i, ["access-denied", "dashboard", "bandeau-ouvert"].includes(i)); });
  const state = { valeur: opts.valeur, maj_le: opts.maj_le, now: opts.now }, log = { update: [], confirm: [], reads: 0 }, timers = [];
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t) => { const st = {}; const pick = (o) => { if (!st.cols) return o; const out = {}; st.cols.split(",").map((c) => c.trim()).forEach((c) => { if (c in o) out[c] = o[c]; }); return out; };
      const api = { select: (c) => { st.cols = c; return api; }, eq: (k, v) => { st.f = [k, v]; return api; },
      maybeSingle: async () => { if (t === "profiles") return { data: { role: "admin" }, error: null }; log.reads++; return opts.readFail ? { data: null, error: { message: "x" } } : { data: pick({ valeur: state.valeur, maj_le: opts.noMajLe ? undefined : state.maj_le }), error: null }; },
      update: (p) => { st.upd = p; return api; },
      then: (res, rej) => Promise.resolve((() => { if (!st.upd) return { data: [], error: null }; log.update.push([t, st.upd, st.f]); if (opts.writeDenied) return { data: [], error: null };
        if (st.upd.valeur !== state.valeur) state.maj_le = new Date(state.now).toISOString(); state.valeur = st.upd.valeur; return { data: [pick({ valeur: state.valeur, maj_le: state.maj_le })], error: null }; })()).then(res, rej) }; return api; },
    rpc: async () => ({ data: [], error: null }) };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open() {} };
  const FakeDate = { now: () => state.now, parse: Date.parse };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: { getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }) },
    confirm: (m) => { log.confirm.push(m); return opts.confirmAnswer; }, Array, String, Date: FakeDate, setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; } });
  await tick(40);
  return { els, state, log, timers };
}

test("bandeau : visible SEULEMENT si l'interrupteur est ouvert (rouge, durée, bouton « Fermer maintenant ») ; masqué si fermé ou si la lecture échoue", async () => {
  const d = await runAdmin({});
  assert.ok(!d.els["bandeau-ouvert"].classList.contains("hidden"));
  assert.strictEqual(d.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE depuis 30 min. Pensez à la refermer après vos tests.");
  assert.ok(!d.els["bandeau-ouvert"].classList.contains("insistant"));
  assert.ok(read("admin/profils-publics.html").includes('id="btn-fermer-bandeau">Fermer maintenant</button>'));
  const closed = await runAdmin({ valeur: "non" }); assert.ok(closed.els["bandeau-ouvert"].classList.contains("hidden"), "fermé : pas de bandeau");
  const fail = await runAdmin({ readFail: true }); assert.ok(fail.els["bandeau-ouvert"].classList.contains("hidden"), "lecture impossible : pas de bandeau");
});

test("bandeau : après 2 h il devient insistant ; maj_le absent ou dans le futur → « La fonction est OUVERTE » sans durée", async () => {
  const d = await runAdmin({ now: Date.parse("2026-11-23T11:12:00Z") });
  assert.ok(d.els["bandeau-ouvert"].classList.contains("insistant")); assert.match(d.els["bandeau-ouvert-texte"].textContent, /^La fonction est OUVERTE depuis plus de 2 h \(3 h 12 min\) : si ce n'est pas voulu, fermez-la maintenant\.$/);
  const none = await runAdmin({ noMajLe: true }); assert.strictEqual(none.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE"); assert.ok(!none.els["bandeau-ouvert"].classList.contains("hidden"));
  const bad = await runAdmin({ maj_le: "n'importe quoi" }); assert.strictEqual(bad.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE");
  const futur = await runAdmin({ maj_le: "2026-11-23T09:00:00Z", now: Date.parse("2026-11-23T08:30:00Z") }); assert.strictEqual(futur.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE", "horloge du téléphone en retard : pas de durée négative");
});

test("bandeau : texte remis à jour toutes les minutes (setInterval 60 s) et à chaque actualisation (maj_le relu)", async () => {
  const d = await runAdmin({});
  assert.strictEqual(d.timers.length, 1); assert.strictEqual(d.timers[0].ms, 60000);
  d.state.now += 45 * 60000; d.timers[0].f();
  assert.strictEqual(d.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE depuis 1 h 15 min. Pensez à la refermer après vos tests.");
  d.state.now += 60 * 60000; d.timers[0].f(); assert.ok(d.els["bandeau-ouvert"].classList.contains("insistant"), "passe en insistant après 2 h sans recharger la page");
  const reads = d.log.reads; d.state.maj_le = "2026-11-23T09:30:00Z"; d.els["btn-recharger"].click(); await tick(30);
  assert.ok(d.log.reads > reads, "actualiser relit maj_le"); assert.match(d.els["bandeau-ouvert-texte"].textContent, /depuis (\d+ h )?\d+ min/);
  assert.match(code("admin/profils-publics.js"), /tick = setInterval\(renderBanner, 60000\)/);
});

test("bandeau : « Fermer maintenant » ferme en UN clic, sans confirmation, avec le même code que « Fermer au public » ; le bandeau disparaît", async () => {
  const d = await runAdmin({});
  await d.els["btn-fermer-bandeau"].click(); await tick(30);
  assert.deepStrictEqual(d.log.confirm, [], "aucune confirmation");
  assert.strictEqual(JSON.stringify(d.log.update), JSON.stringify([["profils_publics_reglages", { valeur: "non" }, ["cle", "ouvert"]]]));
  assert.ok(d.els["bandeau-ouvert"].classList.contains("hidden")); assert.match(d.els["etat-interrupteur"].textContent, /FERMÉE/); assert.strictEqual(d.els["btn-interrupteur"].textContent, "Ouvrir au public");
  const js = code("admin/profils-publics.js"); assert.match(js, /\$\("btn-fermer-bandeau"\)\.addEventListener\("click", toggleSwitch\)/, "même fonction que le bouton existant");
  const e = await runAdmin({}); await e.els["btn-interrupteur"].click(); await tick(30); assert.deepStrictEqual(e.log.update.map((u) => u[1].valeur), ["non"], "le bouton existant se comporte de la même façon");
  const denied = await runAdmin({ writeDenied: true }); await denied.els["btn-fermer-bandeau"].click(); await tick(30);
  assert.match(denied.els["msg-interrupteur"].textContent, /refusée ou impossible/); assert.ok(!denied.els["bandeau-ouvert"].classList.contains("hidden"), "écriture refusée : toujours ouvert, bandeau conservé");
});

test("bandeau : ouverture inchangée — confirmation exacte, puis le bandeau apparaît avec « moins d'1 min » ; aucun innerHTML ; thèmes clair et sombre par couleurs fixes lisibles", async () => {
  const d = await runAdmin({ valeur: "non" }); await d.els["btn-interrupteur"].click(); await tick(30);
  assert.deepStrictEqual(d.log.confirm, ["Cette action rend publiques toutes les pages publiées. Vérifiez que vous avez testé le signalement. Continuer ?"]);
  assert.ok(!d.els["bandeau-ouvert"].classList.contains("hidden")); assert.strictEqual(d.els["bandeau-ouvert-texte"].textContent, "La fonction est OUVERTE depuis moins d'1 min. Pensez à la refermer après vos tests.");
  const refuse = await runAdmin({ valeur: "non", confirmAnswer: false }); await refuse.els["btn-interrupteur"].click(); await tick(30); assert.strictEqual(refuse.log.update.length, 0);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code("admin/profils-publics.js")));
  const h = read("admin/profils-publics.html");
  assert.match(h, /\.alerte-ouvert \{[^}]*background: #B91C1C; color: #FFFFFF/); assert.match(h, /\.alerte-ouvert\.insistant \{[^}]*background: #7F1D1D[^}]*border: 4px solid/);
  assert.match(h, /\.alerte-ouvert \{[^}]*flex-wrap: wrap/, "lisible à 360 px (retour à la ligne)");
  const i = h.indexOf('id="bandeau-ouvert"'); assert.ok(i > 0 && i < h.indexOf("<h2>Interrupteur général</h2>"), "en haut de la section « Interrupteur général »");
});

// ====================== SQL ======================
const FF = ["profils-publics-finitions.sql", "profils-publics-finitions-rollback.sql", "profils-publics-finitions-verification.sql"];
const raw = read(FF[0]), sql = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const visitesFn = (t) => /create or replace function public\.profil_public_visites_mien[\s\S]*$/.exec(t)[0].trim();
const norm = (t) => t.replace(/\s+/g, " ").trim();

test("SQL : 3 blocs courts ; règles de l'éditeur mobile ($$, record, pas de LIKE, pas de regex, pas de classe POSIX, lignes courtes, commentaires sans apostrophe)", () => {
  const parts = raw.split(/^-- BLOC (\d+) - /m); const nums = []; for (let i = 1; i < parts.length; i += 2) nums.push(Number(parts[i]));
  assert.deepStrictEqual(nums, [1, 2, 3]);
  FF.forEach((f) => { const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t) && !/\[\[:/.test(t), f);
    t.split("\n").forEach((line, i) => { assert.ok(line.length <= 105, f + ":" + (i + 1) + " ligne longue (" + line.length + ")");
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/(sk_live|eyJ)/.test(t)); });
  const body = FF.slice(0, 2).map(read).join("\n").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\blike\b|\bilike\b|%[a-z]|'%|%'/i.test(body.replace(/'[^']*%[^']*'/g, "")) || !/\blike\b/i.test(body), "aucun LIKE");
  assert.ok(!/ ~ | !~ |regexp_/.test(body), "aucune expression régulière");
});

test("SQL : déclencheur BEFORE UPDATE — maj_le = now() seulement si valeur change ; pas security definer ; ne touche que maj_le", () => {
  const f = /create or replace function public\.profils_publics_reglages_maj\(\)[\s\S]*?\n\$\$;/.exec(sql)[0];
  assert.match(f, /if old\.valeur is distinct from new\.valeur then\s+new\.maj_le := now\(\);\s+end if;\s+return new;/);
  assert.ok(!/security definer/.test(f) && /set search_path = public, pg_temp/.test(f));
  assert.deepStrictEqual([...f.matchAll(/new\.(\w+)\s*:=/g)].map((m) => m[1]), ["maj_le"], "seule maj_le est écrite");
  assert.match(sql, /revoke all on function public\.profils_publics_reglages_maj\(\) from public, anon, authenticated;/);
  assert.match(sql, /create trigger profils_publics_reglages_maj_trg\s+before update on public\.profils_publics_reglages\s+for each row execute function public\.profils_publics_reglages_maj\(\);/);
  assert.match(sql, /drop trigger if exists profils_publics_reglages_maj_trg on public\.profils_publics_reglages;/);
});

test("SQL : la fonction de visites est celle de production (profils-publics-visites.sql) avec UNE seule différence : « partage » dans la liste des liens", () => {
  const prod = visitesFn(read("profils-publics-visites.sql")), now = visitesFn(raw);
  assert.notStrictEqual(norm(prod), norm(now));
  const prodWithPartage = prod.replace("in ('direct', 'whatsapp', 'facebook', 'instagram', 'tiktok')", "in ('direct', 'partage', 'whatsapp', 'facebook', 'instagram', 'tiktok')");
  assert.strictEqual(norm(now), norm(prodWithPartage), "aucune autre modification : signature, colonnes, droits, bornes identiques");
  assert.match(now, /case when v\.source = 'qr' then 'qr'/); assert.match(now, /in \('direct', 'partage', 'whatsapp', 'facebook',\s+'instagram', 'tiktok'\)/);
  assert.match(now, /revoke all on function public\.profil_public_visites_mien\(integer\) from public, anon;\s+grant execute on function public\.profil_public_visites_mien\(integer\) to authenticated;/);
  assert.match(now, /profil_public_visites_mien\(p_jours integer\)/); assert.match(now, /returns table \(jour date, visites integer, qr integer, lien integer, autre integer\)/);
  assert.ok(!/anon;/.test(now.replace("from public, anon;", "")), "anon jamais autorisé");
});

test("SQL : rollback (supprime déclencheur et fonction, remet la fonction de visites de production) et vérification en UNE ligne, lecture seule", () => {
  const rb = read(FF[1]), rbSql = rb.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), v = read(FF[2]);
  assert.match(rbSql, /drop trigger if exists profils_publics_reglages_maj_trg on public\.profils_publics_reglages;/); assert.match(rbSql, /drop function if exists public\.profils_publics_reglages_maj\(\);/);
  assert.strictEqual(norm(visitesFn(rb)), norm(visitesFn(read("profils-publics-visites.sql"))), "fonction précédente identique à la production");
  assert.ok(!/'partage'/.test(visitesFn(rb)) && !/drop table|delete|truncate/i.test(rbSql));
  const q1 = /-- 1\. Verdict[\s\S]*?;\n/.exec(v)[0];
  ["declencheur_actif", "avant_update_par_ligne", "fonction_invoker_search_path", "visites_presente", "visites_recree_avec_partage", "membres_peuvent", "anon_exclu", "memes_colonnes"].forEach((c) => assert.ok(q1.includes(" as " + c), c));
  assert.strictEqual((q1.match(/^select\b/gm) || []).length, 1, "un seul résultat");
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, "''")), "lecture seule");
});

// ====================== sources de visite ======================
test("sources : « partage » est un lien, « qr » reste qr ; valeurs réellement possibles pour une page publique ; texte explicatif des trois catégories", () => {
  const lien = /in \('direct', 'partage', 'whatsapp', 'facebook',\s+'instagram', 'tiktok'\)/.exec(raw)[0];
  ["direct", "partage", "whatsapp", "facebook", "instagram", "tiktok"].forEach((s) => assert.ok(lien.includes("'" + s + "'"), s));
  ["qr", "search", "autre"].forEach((s) => assert.ok(!lien.includes("'" + s + "'"), s + " n'est pas un lien"));
  // d'où viennent les valeurs : api/_profil-og.js (partage, facebook, instagram, tiktok, qr) et analytics.js (direct, whatsapp, search, autre…)
  const og = read("api/_profil-og.js"), ana = read("analytics.js");
  assert.ok(og.includes('s="partage"') && og.includes("src=partage") && og.includes('s="instagram"') && og.includes('s="facebook"') && og.includes('s="tiktok"'));
  assert.ok(ana.includes('return "direct"') && ana.includes('return "whatsapp"') && ana.includes('return "search"') && ana.includes('return "autre"'));
  assert.match(ana, /var SOURCE_RE = \/\^\[a-z0-9_-\]\{1,40\}\$\/;/); ["partage", "qr", "newsletter"].forEach((s) => assert.ok(/^[a-z0-9_-]{1,40}$/.test(s), s));
  const h = read("profil.html");
  assert.ok(h.includes("QR code : scan du QR code. Lien : lien partagé ou ouvert directement. Autre : moteur de recherche, autre site."));
  assert.ok(h.indexOf("pp-visites-repartition") < h.indexOf("QR code : scan du QR code."));
  assert.match(raw, /lien  : direct, partage, whatsapp, facebook, instagram, tiktok/);
});

test("cache : sw.js a changé de version (v120 ou plus) ; aucun nouveau fichier directement dans api/", () => {
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(read("sw.js"))[1]) >= 120);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12);
});
