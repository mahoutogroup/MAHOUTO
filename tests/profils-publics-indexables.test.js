/* Pages de profil public indexables page par page : api/_profil-og.js (page indexable / noindex, canonical, titre, JSON-LD, plan du site),
   api/produit-og.js (lectures publiques, plan du site), vercel.json, robots.txt, profils-publics-indexable*.sql.
   Aucun réseau, aucune base : faux accès aux lectures. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (t) => t.replace(/^import .*$/gm, "").replace(/export (const|function|async function)/g, "$1");
const SERVER = (() => {
  const sb = { URL, encodeURIComponent, process: { env: {} }, JSON, Date, isFinite };
  vm.runInNewContext(strip(read("api/_cloudinary-og.js")) + "\n" + strip(read("api/_profil-og.js")) +
    "\nthis.api = { handleProfilPreview, handleProfilSitemap, renderProfilSitemap, buildProfilIndexable, profilIndexableTitle, isIndexableHost, profilContactHref };", sb);
  return sb.api;
})();
const IMG = "https://res.cloudinary.com/hefa5gqf/image/upload/v1793189115/mahoutoplus/avatars/photo-profil.jpg";
const ROW = (o) => Object.assign({ id: "11111111-2222-4333-8444-555555555555", user_id: "99999999-2222-4333-8444-555555555555", adresse: "mahouto-abdallah", nom_affiche: "Mahouto Abdallah",
  avatar_url: IMG, metier: "Sérigraphe", localisation: "Cotonou", presentation: "Impression textile et sérigraphie à Cotonou.", contact_type: "whatsapp", contact_valeur: "+22900001234",
  publie: true, suspendu: false, majeur_declare: true, messages_ouverts: true, indexable: true }, o || {});
const fakeRes = () => ({ headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } });
// Lectures simulées : la page vient de fetchProfil ; l'indexation de fetchIndexable (jamais la colonne dans la ligne publique).
async function get(o) {
  o = Object.assign({ host: "mahouto.com", adresse: "mahouto-abdallah", row: ROW(), indexable: true, query: {}, alias: null }, o || {});
  const calls = [], res = fakeRes();
  const deps = { fetchProfil: async (a) => { calls.push("profil:" + a); return { row: o.row && (a === o.row.adresse) ? o.row : null, error: o.profilError ? new Error("x") : null }; },
    fetchAlias: async (a) => { calls.push("alias:" + a); return { adresse: o.alias, error: null }; },
    fetchIndexable: async (a) => { calls.push("indexable:" + a); if (o.indexableThrows) throw new Error("réseau"); return { indexable: o.indexable, error: o.indexableError ? new Error("x") : null }; } };
  const headers = o.host === null ? {} : { host: o.host }; if (o.forwarded) headers["x-forwarded-host"] = o.forwarded;
  await SERVER.handleProfilPreview({ method: "GET", query: Object.assign({ adresse: o.adresse }, o.query), headers }, res, deps);
  return { res, calls, html: String(res.body) };
}
const meta = (h, k) => { const m = h.match(new RegExp('<meta (?:property|name)="' + k + '" content="([^"]*)"')); return m ? m[1] : null; };
const NOINDEX = (r) => /noindex/.test(r.html) && r.res.headers["X-Robots-Tag"] === "noindex, nofollow" && meta(r.html, "robots") === "noindex, nofollow";
const INDEXABLE = (r) => !/noindex/i.test(r.html) && !/<meta[^>]*nofollow/i.test(r.html) && r.res.headers["X-Robots-Tag"] === undefined && meta(r.html, "robots") === null;
const ldOf = (h) => { const m = h.match(/<script type="application\/ld\+json">([^<]*)<\/script>/); return m ? JSON.parse(m[1]) : null; };

test("page indexable (mahouto.com, décidée par la base) : AUCUN noindex (meta ni en-tête), canonical https://www.mahouto.com, titre « Nom, métier à Ville »", async () => {
  const r = await get(); assert.strictEqual(r.res.code, 200);
  assert.ok(INDEXABLE(r), "aucune trace de noindex : balise meta, en-tête ni texte");
  assert.match(r.html, /<link rel="canonical" href="https:\/\/www\.mahouto\.com\/m\/mahouto-abdallah">/);
  assert.match(r.html, /<title>Mahouto Abdallah, Sérigraphe à Cotonou<\/title>/);
  assert.strictEqual(meta(r.html, "og:url"), "https://www.mahouto.com/m/mahouto-abdallah"); assert.strictEqual(meta(r.html, "og:title"), "Mahouto Abdallah, Sérigraphe à Cotonou");
  assert.strictEqual(r.res.headers["Cache-Control"], "public, max-age=0, s-maxage=60", "cache court : un retrait se voit en 1 minute");
  assert.ok(r.calls.join() === "profil:mahouto-abdallah,indexable:mahouto-abdallah", "une lecture de la page, un booléen d'indexation, aucun alias");
});

test("page indexable : le contenu utile est DANS le HTML initial (nom, métier, ville, présentation, liens), sans redirection automatique ni moteur de rendu", async () => {
  const r = await get(); const body = r.html.slice(r.html.indexOf("<body>"));
  ["<h1>Mahouto Abdallah</h1>", "Sérigraphe · Cotonou", "Impression textile et sérigraphie à Cotonou.", 'href="https://wa.me/22900001234"', "Ouvrir la carte complète", 'href="https://mahouto.com/m.html?adresse=mahouto-abdallah&amp;src=recherche"', "Règles des pages publiques"].forEach((t) => assert.ok(body.includes(t), t));
  assert.ok(!/http-equiv="refresh"|window\.location|location\.replace/.test(r.html), "aucune redirection pour un robot (adresse propre)");
  assert.ok(!/<script(?![^>]*ld\+json)/.test(r.html), "aucun autre script : le contenu n'est pas ajouté par JavaScript");
  const q = await get({ query: { src: "qr" } }); assert.ok(INDEXABLE(q) && /location\.replace\("https:\/\/mahouto\.com\/m\.html\?adresse=mahouto-abdallah\\u0026src=qr"\)/.test(q.html), "lien de QR code (?src=) : l'humain va à la carte, le canonical reste l'adresse propre");
  assert.match(q.html, /<link rel="canonical" href="https:\/\/www\.mahouto\.com\/m\/mahouto-abdallah">/);
});

test("page NON indexable : noindex comme aujourd'hui (meta + en-tête), pas de canonical, pas de contenu de page, aperçu et redirection inchangés", async () => {
  const r = await get({ indexable: false }); assert.ok(NOINDEX(r)); assert.ok(!/rel="canonical"|ld\+json|<h1>/.test(r.html));
  assert.match(r.html, /<title>Mahouto Abdallah — MAHOUTO\+<\/title>/); assert.match(r.html, /http-equiv="refresh"/); assert.strictEqual(r.res.headers["Cache-Control"], "public, max-age=60, s-maxage=300");
});

test("page dépubliée, suspendue, fermée ou inexistante : noindex ; l'indexation n'est même pas demandée ; une lecture en erreur ou une panne = noindex", async () => {
  const absent = await get({ row: null }); assert.ok(NOINDEX(absent)); assert.ok(!absent.calls.some((c) => c.startsWith("indexable:")), "rien de public : aucune lecture d'indexation");
  // dépubliée ou suspendue : profil_public_lire ne renvoie rien (aucune ligne), même si la colonne indexable vaut true
  for (const etat of ["dépubliée", "suspendue"]) { const r = await get({ row: null, indexable: true }); assert.ok(NOINDEX(r), etat); }
  // la base répond « false » dès que la page est dépubliée ou suspendue : même si la page était lisible (cache, course), le verdict gagne
  const retiree = await get({ indexable: false }); assert.ok(NOINDEX(retiree));
  for (const o of [{ indexableError: true }, { indexableThrows: true }, { profilError: true }]) { const r = await get(o); assert.ok(NOINDEX(r) || r.res.code === 503, JSON.stringify(o)); assert.ok(!INDEXABLE(r), JSON.stringify(o) + " : jamais indexable sur erreur"); }
  for (const a of ["", "A", "Mauvaise Adresse", "../x", "a".repeat(40)]) { const r = await get({ adresse: a }); assert.ok(NOINDEX(r) && !r.calls.length, "adresse invalide : " + a); }
});

test("un alias n'est jamais indexable (noindex) ; seule la page principale l'est", async () => {
  const r = await get({ adresse: "imprimeur", alias: "mahouto-abdallah" });
  assert.ok(NOINDEX(r), "l'alias reste noindex"); assert.ok(!r.calls.some((c) => c.startsWith("indexable:")));
});

test("hôte : seule mahouto.com (ou www) peut être indexée ; majestepresse.com, domaines de test, hôte absent ou usurpé : noindex ; canonical TOUJOURS https://www.mahouto.com", async () => {
  for (const host of ["mahouto.com", "www.mahouto.com", "MAHOUTO.COM", "mahouto.com:443"]) { const r = await get({ host }); assert.ok(INDEXABLE(r), host); assert.match(r.html, /<link rel="canonical" href="https:\/\/www\.mahouto\.com\/m\/mahouto-abdallah">/, host + " : canonical https://www.mahouto.com (hôte principal), même servi depuis mahouto.com"); }
  for (const host of ["majestepresse.com", "www.majestepresse.com", "mahouto-git-x-team.vercel.app", "mahouto.com.evil.test", "evil-mahouto.com", "localhost:3000", "", null]) { const r = await get({ host }); assert.ok(NOINDEX(r), String(host) + " : noindex"); assert.ok(!r.calls.some((c) => c.startsWith("indexable:")), String(host) + " : aucune lecture d'indexation"); }
  const r = await get({ host: "majestepresse.com", forwarded: "mahouto.com" }); assert.ok(INDEXABLE(r), "x-forwarded-host de Vercel prime");
  const e = await get({ host: "mahouto.com", forwarded: "majestepresse.com" }); assert.ok(NOINDEX(e), "x-forwarded-host majestepresse.com : noindex");
  const src = read("api/_profil-og.js"); assert.ok(!/headers\.host/.test(src), "l'hôte ne sert jamais au site ni à la marque affichés");
  assert.ok(/export const PROFIL_SITE_SEO = "https:\/\/www\.mahouto\.com";/.test(src) && /export const PROFIL_SITE = "https:\/\/mahouto\.com";/.test(src) && !/majestepresse/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "aucun canonical vers majestepresse.com");
});

test("titre, description et JSON-LD : seulement des champs déjà publics (jamais le contact, jamais d'identifiant) ; parties absentes omises", async () => {
  const r = await get(); const ld = ldOf(r.html);
  assert.deepStrictEqual(ld, { "@context": "https://schema.org", "@type": "Person", name: "Mahouto Abdallah", url: "https://www.mahouto.com/m/mahouto-abdallah", jobTitle: "Sérigraphe",
    description: "Impression textile et sérigraphie à Cotonou.", workLocation: { "@type": "Place", name: "Cotonou" }, image: "https://res.cloudinary.com/hefa5gqf/image/upload/f_jpg,q_auto,fl_strip_profile,w_160,h_160,c_fill,g_auto/v1793189115/mahoutoplus/avatars/photo-profil.jpg" });
  const entetes = [r.html.match(/<title>[^<]*/)[0], meta(r.html, "description"), meta(r.html, "og:description"), meta(r.html, "twitter:description"), r.html.match(/<script type="application\/ld\+json">[^<]*/)[0]].join("\n");
  ["22900001234", "+229", "wa.me", "11111111-2222", "99999999-2222", "user_id", "messages_ouverts", "majeur", "suspendu", "publie", "indexable"].forEach((t) => assert.ok(!entetes.includes(t), "absent du titre, de la description et du JSON-LD : " + t));
  assert.strictEqual(meta(r.html, "description"), "Sérigraphe · Cotonou — Impression textile et sérigraphie à Cotonou.");
  const T = SERVER.profilIndexableTitle; assert.strictEqual(T({ nom_affiche: "Ama", metier: "Imprimeur" }), "Ama, Imprimeur"); assert.strictEqual(T({ nom_affiche: "Ama", localisation: "Lomé" }), "Ama à Lomé"); assert.strictEqual(T({ nom_affiche: "Ama" }), "Ama");
  const min = ldOf((await get({ row: ROW({ metier: null, localisation: null, presentation: null, avatar_url: null, contact_type: null, contact_valeur: null }) })).html);
  assert.deepStrictEqual(Object.keys(min), ["@context", "@type", "name", "url"], "aucun champ vide inventé");
});

test("échappement HTML : nom, métier, ville, présentation et liens hostiles ne sortent jamais de leur balise ; JSON-LD sans fin de script ; contact non sûr refusé", async () => {
  const H = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const r = await get({ row: ROW({ nom_affiche: "Ama" + H, metier: "Met" + H, localisation: "Vil" + H, presentation: "Pre" + H, contact_type: "lien", contact_valeur: 'https://x.test/"><script>alert(3)</script>' }) });
  assert.ok(!/<script>alert|<img src=x|onerror=alert\(2\)>|"><script/.test(r.html.replace(/<script type="application\/ld\+json">[^<]*<\/script>/, "")), "aucun HTML injecté");
  assert.strictEqual((r.html.match(/<script/g) || []).length, 1, "un seul script : le JSON-LD"); assert.ok(!/<\/script>[\s\S]*<\/script>/.test(r.html), "le JSON-LD ne contient pas de fin de balise");
  assert.ok(ldOf(r.html).name.includes("alert(1)"), "le JSON-LD reste du JSON valide");
  const C = SERVER.profilContactHref;
  assert.strictEqual(C(ROW({ contact_type: "lien", contact_valeur: "javascript:alert(1)" })), null); assert.strictEqual(C(ROW({ contact_type: "lien", contact_valeur: "http://x.test/a" })), null); assert.strictEqual(C(ROW({ contact_type: "whatsapp", contact_valeur: "22900001234" })), null);
  assert.ok(C(ROW({ contact_type: "lien", contact_valeur: "https://x.test/a" })).href === "https://x.test/a");
  const s = SERVER.renderProfilSitemap([{ adresse: 'a"<b>', modifie_le: null }]); assert.ok(!/<b>/.test(s));
});

test("plan du site : seulement les adresses valides renvoyées par la base (indexables, publiées, non suspendues), adresses mahouto.com, vide si aucune, 503 sans cache sur erreur", async () => {
  const run = async (d) => { const res = fakeRes(); await SERVER.handleProfilSitemap({}, res, d); return res; };
  const ok = await run({ fetchSitemap: async () => ({ rows: [{ adresse: "mahouto-abdallah", modifie_le: "2026-11-20T10:00:00Z" }, { adresse: "Mauvais Alias", modifie_le: null }, { adresse: "x<y>", modifie_le: "x" }, null, { adresse: "autre-carte" }], error: null }) });
  assert.strictEqual(ok.code, 200); assert.strictEqual(ok.headers["Content-Type"], "application/xml; charset=utf-8"); assert.match(ok.headers["Cache-Control"], /s-maxage=300/);
  assert.deepStrictEqual([...String(ok.body).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]), ["https://www.mahouto.com/m/mahouto-abdallah", "https://www.mahouto.com/m/autre-carte"]);
  assert.match(String(ok.body), /<lastmod>2026-11-20T10:00:00\.000Z<\/lastmod>/); assert.ok(!/majestepresse|vercel\.app/.test(String(ok.body)));
  const vide = await run({ fetchSitemap: async () => ({ rows: [], error: null }) }); assert.strictEqual(vide.code, 200); assert.ok(!/<url>/.test(String(vide.body)) && /<urlset[^>]*>\s*<\/urlset>/.test(String(vide.body)), "valide et vide");
  const panne = await run({ fetchSitemap: async () => ({ rows: [], error: new Error("x") }) }); assert.strictEqual(panne.code, 503); assert.strictEqual(panne.headers["Cache-Control"], "no-store"); assert.ok(!/<url>/.test(String(panne.body)));
  const boom = await run({ fetchSitemap: async () => { throw new Error("réseau"); } }); assert.strictEqual(boom.code, 503);
});

test("api/produit-og.js : lectures publiques (clé anonyme, jamais service_role ni la table) ; plan du site routé avant tout ; aucun nouveau fichier api/ (12 fonctions)", () => {
  const src = read("api/produit-og.js");
  const a = /async function fetchIndexableForPreview[\s\S]*?\n}\n/.exec(src)[0], b = /async function fetchSitemapForPreview[\s\S]*?\n}\n/.exec(src)[0];
  assert.match(a, /createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_ANON_KEY\)/); assert.match(a, /\.rpc\("profil_public_indexable", \{ p_adresse: adresse \}\)/); assert.match(a, /indexable: data === true/);
  assert.match(b, /createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_ANON_KEY\)/); assert.match(b, /\.rpc\("profil_public_sitemap"\)/);
  assert.ok(!/service_role|SERVICE_ROLE|\.from\(/.test(a + b), "ni service_role ni lecture directe de la table");
  assert.match(src, /req\.query\.type === "sitemap-cartes"\)\s*\{\s*return handleProfilSitemap\(/); assert.ok(src.indexOf('type === "sitemap-cartes"') < src.indexOf('type === "profil"'));
  assert.match(src, /fetchIndexable: fetchIndexableForPreview/);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
});

test("vercel.json, robots.txt, m.html : réécriture du plan du site ; /m/:adresse n'a plus d'en-tête noindex FIXE (la fonction le pose sauf page indexable) ; /m.html reste noindex", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/sitemap-cartes.xml"), { source: "/sitemap-cartes.xml", destination: "/api/produit-og?type=sitemap-cartes" });
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/m/:adresse"), { source: "/m/:adresse", destination: "/api/produit-og?type=profil&adresse=:adresse" });
  assert.ok(!v.headers.some((h) => h.source === "/m/:adresse"), "sinon l'en-tête noindex fixe l'emporterait sur la page indexable");
  ["/m.html", "/pro", "/pro.html", "/creer-ma-carte", "/creer-ma-carte.html"].forEach((s) => assert.ok(v.headers.some((h) => h.source === s && h.headers.some((x) => x.key === "X-Robots-Tag" && /noindex/.test(x.value))), s + " reste noindex"));
  assert.match(read("m.html"), /<meta name="robots" content="noindex, nofollow">/, "la carte interactive reste noindex");
  const robots = read("robots-mahouto.txt"); assert.match(robots, /^User-agent: \*\nAllow: \/\n/); assert.match(robots, /Sitemap: https:\/\/www\.mahouto\.com\/sitemap-cartes\.xml/); assert.ok(!/Disallow/i.test(robots), "ne bloque pas l'exploration : les robots doivent voir les noindex");
  assert.ok(!fs.existsSync(path.join(root, "sitemap.xml")), "aucun autre plan du site");
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(14\d|1[5-9]\d)";/);
});

// ====================== SQL (fichiers à lancer à la main) ======================
const SQL = read("profils-publics-indexable.sql"), ROLL = read("profils-publics-indexable-rollback.sql"), VERIF = read("profils-publics-indexable-verification.sql"), ACT = read("profils-publics-indexable-activer.sql");
const sqlCode = (t) => t.replace(/^--.*$/gm, "");
test("SQL : colonne booléenne NOT NULL défaut false ; aucun droit de colonne pour un membre ; déclencheur ; fonction admin protégée ; lectures publiques minimales", () => {
  assert.match(SQL, /add column if not exists indexable boolean not null default false/);
  assert.ok(!/grant\s+(insert|update|select)\s*\([^)]*indexable/i.test(SQL + ACT), "aucun droit de colonne accordé");
  assert.match(SQL, /revoke update \(indexable\) on public\.profils_publics from anon, authenticated/); assert.match(SQL, /revoke insert \(indexable\)/);
  const trg = SQL.slice(SQL.indexOf("function public.profils_publics_indexable_garde"), SQL.indexOf("-- BLOC 5"));
  assert.match(trg, /new\.indexable is distinct from old\.indexable/); assert.match(trg, /Le champ indexable est reserve aux administrateurs/); assert.match(trg, /set search_path = public, pg_temp/);
  assert.match(trg, /before insert or update on public\.profils_publics/); assert.match(trg, /revoke all on function public\.profils_publics_indexable_garde\(\) from public, anon, authenticated/);
  const adm = SQL.slice(SQL.indexOf("function public.profils_publics_admin_indexable"), SQL.indexOf("-- BLOC 6"));
  assert.match(adm, /security definer/); assert.match(adm, /set search_path = public, pg_temp/); assert.match(adm, /if not public\.is_admin\(\) then/); assert.match(adm, /revoke all on function public\.profils_publics_admin_indexable\(text, boolean\) from public, anon;/); assert.match(adm, /grant execute on function public\.profils_publics_admin_indexable\(text, boolean\) to authenticated;/);
  const pub = SQL.slice(SQL.indexOf("function public.profil_public_indexable"));
  ["p.publie", "not p.suspendu", "p.indexable", "public.profils_publics_ouvert()"].forEach((c) => assert.ok(pub.split("function public.profil_public_sitemap")[0].includes(c), "profil_public_indexable : " + c));
  ["p.publie", "not p.suspendu", "p.indexable", "public.profils_publics_ouvert()", "limit 500"].forEach((c) => assert.ok(pub.split("function public.profil_public_sitemap")[1].includes(c), "profil_public_sitemap : " + c));
  assert.match(pub, /returns table \(adresse text, modifie_le timestamptz\)/); assert.ok(!/contact|presentation|nom_affiche|user_id|avatar/.test(sqlCode(pub)), "aucune autre donnée dans les lectures publiques");
  assert.ok(!/create or replace function public\.profil_public_lire|alter function/.test(SQL), "profil_public_lire n'est pas touchée");
});
test("SQL : contraintes de l'éditeur mobile (blocs numérotés, $$, commentaires sans apostrophe placés avant, lignes ≤ 105), rollback confirmé NON, vérification en une ligne", () => {
  [SQL, ROLL, VERIF, ACT].forEach((t, i) => { t.split("\n").forEach((l, n) => assert.ok(l.length <= 105, "fichier " + i + " ligne " + (n + 1) + " : " + l.length));
    t.split("\n").filter((l) => /^\s*--/.test(l)).forEach((l) => assert.ok(!/'/.test(l), "apostrophe dans un commentaire : " + l)); assert.ok(!/LIKE\s+'%|~\s*'\(\?/i.test(t.replace(/ilike 'Mahouto Abdallah%'/, "")), "pas de LIKE %…% ni de longue regex"); });
  assert.ok((SQL.match(/^-- BLOC \d/gm) || []).length === 7 && (SQL.match(/\$\$/g) || []).length % 2 === 0);
  assert.match(ROLL, /confirmation constant text := 'NON'/); assert.match(ROLL, /if confirmation <> 'OUI' then/); assert.match(ROLL, /drop column if exists indexable/);
  assert.strictEqual((VERIF.match(/^select\b/gm) || []).length, 1, "une seule requête"); ["colonne_presente_not_null", "defaut_false", "un_membre_ne_peut_pas_la_modifier", "fonction_admin_protegee", "lectures_publiques_ouvertes"].forEach((c) => assert.ok(VERIF.includes(c), c));
  assert.match(VERIF, /not has_function_privilege\('anon',\s*'public\.profils_publics_admin_indexable\(text, boolean\)'/);
  assert.ok(!/eyJ|sk_live|sk_test|apikey/i.test(SQL + ROLL + VERIF + ACT), "aucune clé");
});

test("adresses de partage et de lien (non officielles pour Google) inchangées : carte complète, QR, aperçu non indexable, image par défaut restent sur mahouto.com", async () => {
  const r = await get(); assert.ok(r.html.includes('href="https://mahouto.com/m.html?adresse=mahouto-abdallah&amp;src=recherche"'), "lien vers la carte complète");
  const n = await get({ indexable: false }); assert.strictEqual(meta(n.html, "og:url"), "https://mahouto.com/m/mahouto-abdallah", "aperçu de partage (noindex) : adresse de partage");
  assert.ok(n.html.includes("https://mahouto.com/m.html?adresse=mahouto-abdallah"), "redirection des humains inchangée");
  assert.ok(!/www\.mahouto\.com/.test(n.html), "page non indexable : aucune adresse www");
  ["profil-public-utils.js", "room-share.js", "invitation.js", "entreprise-utils.js", "api/_room-og.js", "api/_entreprise-og.js"].forEach((f) => assert.ok(!/www\.mahouto\.com/.test(read(f)), f + " : liens de partage non modifiés"));
});
