/* Indexation : pages à connexion en noindex (meta + en-tête), canonical par domaine (en-tête Link avec condition d'hôte),
   robots.txt par domaine (réécritures avec condition d'hôte). Aucun réseau : vercel.json est lu et appliqué par un petit simulateur. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const V = JSON.parse(read("vercel.json"));

// Pages qui demandent une connexion (compte, messagerie, achats, outils internes) : noindex en double.
const LOGIN = ["profil", "discussions", "chat", "dm-chat", "messages-prives", "mes-achats", "certificates", "serigraphie-commande", "serigraphie-confirmation",
  "serigraphie-vendeur", "share", "get-video-url", "cast-prototype"].map((n) => n + ".html");
const ADMIN = fs.readdirSync(path.join(root, "admin")).filter((f) => f.endsWith(".html")).map((f) => "admin/" + f);
// Pages publiques à garder indexées : jamais de noindex, jamais de canonical statique.
const PUBLIC = ["index.html", "accueil-majeste.html", "academie-majestepresse.html", "regles-pages-publiques.html", "mentions-legales.html", "conditions-vente.html", "conditions-vendeurs.html"];

// Simulateur minimal : source exacte, « /admin/(.*) », ou « /(.*) » ; condition has/host exacte.
const matchSource = (src, p) => src === p || (src === "/admin/(.*)" && p.startsWith("/admin/")) || src === "/(.*)";
const hasOk = (has, host) => !has || has.every((c) => c.type === "host" && c.value === host);
const headersFor = (host, p) => { const out = {}; V.headers.forEach((h) => { if (matchSource(h.source, p) && hasOk(h.has, host)) h.headers.forEach((x) => { (out[x.key] = out[x.key] || []).push(x.value); }); }); return out; };
const rewriteFor = (host, p) => { const r = V.rewrites.find((x) => x.source === p && hasOk(x.has, host)); return r ? r.destination : null; };

test("pages à connexion : noindex, nofollow en double — balise meta robots ET en-tête X-Robots-Tag, pour chaque page et chaque domaine", () => {
  [...LOGIN, ...ADMIN].forEach((f) => {
    const html = read(f); assert.match(html, /<meta name="robots" content="noindex(, nofollow)?">/, f + " : meta robots noindex");
    assert.ok(html.indexOf('name="robots"') < html.indexOf("</head>"), f + " : dans le head");
    assert.strictEqual((html.match(/name="robots"/g) || []).length, 1, f + " : une seule balise");
    ["mahouto.com", "majestepresse.com"].forEach((host) => assert.ok((headersFor(host, "/" + f)["X-Robots-Tag"] || []).some((x) => /noindex/.test(x)), f + " : en-tête X-Robots-Tag sur " + host));
  });
  assert.ok(ADMIN.length >= 14, "toutes les pages admin/ sont couvertes");
  assert.ok(V.headers.some((h) => h.source === "/admin/(.*)"), "un en-tête pour tout admin/");
});

test("pages publiques à garder indexées : aucun noindex (meta ni en-tête), aucune balise canonical statique ; /m/, /r/, /pro, /creer-ma-carte non touchés", () => {
  PUBLIC.forEach((f) => {
    const html = read(f); assert.ok(!/name="robots"/.test(html), f + " : pas de meta robots"); assert.ok(!/rel="canonical"/.test(html), f + " : pas de canonical statique unique");
    ["mahouto.com", "majestepresse.com"].forEach((host) => assert.ok(!(headersFor(host, "/" + f)["X-Robots-Tag"] || []).length, f + " : pas d'X-Robots-Tag sur " + host));
  });
  ["/", "/regles-pages-publiques"].forEach((p) => assert.ok(!(headersFor("mahouto.com", p)["X-Robots-Tag"] || []).length, p));
  assert.ok(!V.headers.some((h) => h.source === "/m/:adresse"), "/m/ : géré par la fonction"); assert.ok(!V.headers.some((h) => /^\/r\b/.test(h.source)), "/r/ : géré par la fonction");
  ["/pro", "/pro.html", "/creer-ma-carte", "/creer-ma-carte.html", "/m.html"].forEach((s) => assert.ok(V.headers.some((h) => h.source === s && h.headers.some((x) => x.key === "X-Robots-Tag")), s + " inchangé"));
  const ignores = ["index.html", "ai.html", "school.html", "produits.html", "produit-detail.html", "formation-detail.html", "formation-lecture.html", "serigraphie.html", "serigraphie-produit.html", "entreprise.html", "entrepreneur.html", "metre.html", "verify.html"];
  ignores.forEach((f) => assert.ok(!/name="robots"/.test(read(f)), f + " : non modifiée (publique ou à décider)"));
});

const PAGES = [["/", "/"], ["/index.html", "/"], ["/accueil-majeste.html", "/accueil-majeste.html"], ["/academie-majestepresse.html", "/academie-majestepresse.html"],
  ["/regles-pages-publiques", "/regles-pages-publiques"], ["/regles-pages-publiques.html", "/regles-pages-publiques"], ["/mentions-legales.html", "/mentions-legales.html"],
  ["/conditions-vente.html", "/conditions-vente.html"], ["/conditions-vendeurs.html", "/conditions-vendeurs.html"]];
test("canonical par domaine : en-tête Link avec condition d'hôte ; mahouto.com (redirigé en 308 vers www) et www → https://www.mahouto.com ; majestepresse.com (redirigé en 308 vers www) et www → https://www.majestepresse.com ; jamais de croisement", () => {
  const BASE = { "mahouto.com": "https://www.mahouto.com", "www.mahouto.com": "https://www.mahouto.com", "majestepresse.com": "https://www.majestepresse.com", "www.majestepresse.com": "https://www.majestepresse.com" };
  PAGES.forEach(([p, canon]) => Object.entries(BASE).forEach(([host, base]) => {
    const link = headersFor(host, p).Link; assert.deepStrictEqual(link, ['<' + base + canon + '>; rel="canonical"'], p + " sur " + host);
  }));
  assert.deepStrictEqual(headersFor("mahouto-git-x.vercel.app", "/mentions-legales.html").Link, undefined, "hôte inconnu (aperçu) : aucun canonical");
  const liens = V.headers.filter((h) => h.headers.some((x) => x.key === "Link"));
  assert.ok(liens.length === PAGES.length * 4 && liens.every((h) => h.has && h.has.length === 1 && h.has[0].type === "host"), "chaque règle Link a une condition d'hôte");
  liens.forEach((h) => {
    const host = h.has[0].value, val = h.headers[0].value, attendu = BASE[host];
    const origine = (val.match(/^<(https:\/\/[^/>]+)/) || [])[1];
    assert.strictEqual(origine, attendu, host + " : origine exacte, pas de croisement");
    assert.ok(!/^<https:\/\/(majestepresse|mahouto)\.com/.test(val), host + " : jamais un hôte sans www");
  });
});

test("robots.txt par domaine : majestepresse.com (et www) → robots-majestepresse.txt (Allow, sans Sitemap) ; mahouto.com et tout autre hôte → robots-mahouto.txt (contenu d'avant)", () => {
  assert.ok(!fs.existsSync(path.join(root, "robots.txt")), "pas de fichier robots.txt à la racine : un fichier statique passerait avant les réécritures");
  ["majestepresse.com", "www.majestepresse.com"].forEach((h) => assert.strictEqual(rewriteFor(h, "/robots.txt"), "/robots-majestepresse.txt", h));
  ["mahouto.com", "www.mahouto.com", "xyz.vercel.app"].forEach((h) => assert.strictEqual(rewriteFor(h, "/robots.txt"), "/robots-mahouto.txt", h));
  assert.ok(V.rewrites.findIndex((r) => r.has) < V.rewrites.findIndex((r) => r.source === "/robots.txt" && !r.has), "la règle conditionnelle passe avant la règle générale");
  const maj = read("robots-majestepresse.txt"), mah = read("robots-mahouto.txt");
  assert.strictEqual(maj, "User-agent: *\nAllow: /\n"); assert.ok(!/sitemap/i.test(maj) && !/Disallow/i.test(maj));
  assert.strictEqual(mah, "User-agent: *\nAllow: /\n\nSitemap: https://www.mahouto.com/sitemap-cartes.xml\n");
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions");
  ["/m/:adresse", "/r/:id", "/sitemap-cartes.xml"].forEach((s) => assert.ok(V.rewrites.some((r) => r.source === s), s + " intacte"));
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(14[4-9]|1[5-9]\d)";/);
});
