/* Vitrine d'entreprise : logique pure (entreprise-utils.js), aperçu de partage (api/_entreprise-og.js),
   et garde-fous statiques des pages (entreprise.html, admin/vitrines.html), du service worker et de vercel.json.
   Exécution : node tests/entreprise.test.js — aucune dépendance, aucun réseau, aucune base.
   Toutes les valeurs ci-dessous sont FICTIVES (aucune donnée d'entreprise réelle). */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const U = require("../entreprise-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

(async () => {
  // ---------- slug ----------
  await test("slug : ^[a-z0-9-]{2,40}$", () => {
    ["ab", "atelier-exemple", "a1", "x".repeat(40), "a-b-c-1"].forEach((s) => assert.strictEqual(U.isValidSlug(s), true, s));
    ["", "a", "A1", "Atelier", "x".repeat(41), "a b", "a_b", "é1", "a/b", "../x", "a.b", "<b>", null, undefined, 12].forEach((s) => assert.strictEqual(U.isValidSlug(s), false, String(s)));
  });
  await test("slugify : minuscules, sans accents, tirets, 40 caractères maximum", () => {
    assert.strictEqual(U.slugify("Atelier Été & Co !"), "atelier-ete-co");
    assert.strictEqual(U.slugify("  --Exemple--  "), "exemple");
    assert.ok(U.slugify("x".repeat(80)).length <= 40);
    assert.strictEqual(U.isValidSlug(U.slugify("Boutique Fictive Numéro 1")), true);
  });

  // ---------- numéros ----------
  await test("numéros : local à 10 chiffres (01…), 229…, +229…, 00229… → +229…", () => {
    const WANT = "+2290123456789";
    ["01 23 45 67 89", "0123456789", "(01) 23-45-67-89", "2290123456789", "229 01 23 45 67 89", "+229 01 23 45 67 89", "+2290123456789", "00229 01 23 45 67 89", " 01.23.45.67.89 "]
      .forEach((x) => { const r = U.normalizePhone(x); assert.strictEqual(r.ok, true, x); assert.strictEqual(r.e164, WANT, x); assert.strictEqual(r.digits, "2290123456789", x); });
  });
  await test("numéros : étranger avec + accepté tel quel ; vide accepté (bouton masqué)", () => {
    assert.strictEqual(U.normalizePhone("+33 6 12 34 56 78").e164, "+33612345678");
    assert.strictEqual(U.normalizePhone("0033 6 12 34 56 78").e164, "+33612345678");
    const e = U.normalizePhone("   ");
    assert.deepStrictEqual([e.ok, e.empty, e.e164], [true, true, null]);
  });
  await test("numéros refusés : anciens numéros à 8 chiffres, mauvais préfixe, trop court/long, lettres → message en français", () => {
    ["90123456", "229 90 12 34 56", "+229 90 12 34 56", "0223456789", "01234567", "012345678901", "12345", "abc", "01 23 45 67 8a", "<script>", "01 23 45 67 89; drop"].forEach((x) => {
      const r = U.normalizePhone(x); assert.strictEqual(r.ok, false, x); assert.ok(typeof r.error === "string" && r.error.length > 10, x);
    });
    assert.match(U.normalizePhone("1234").error, /Entrez le numéro à 10 chiffres, qui commence par 01/);
    assert.match(U.normalizePhone("+1").error, /\+/);
  });
  await test("lien WhatsApp : seulement les chiffres, message pré-rempli encodé ; numéro vide ou invalide → null", () => {
    assert.strictEqual(U.whatsappLink("01 23 45 67 89", "Atelier Exemple"),
      "https://wa.me/2290123456789?text=" + encodeURIComponent("Bonjour, je vous contacte depuis votre page Atelier Exemple."));
    assert.strictEqual(U.whatsappLink("", "X"), null);
    assert.strictEqual(U.whatsappLink(null, "X"), null);
    assert.strictEqual(U.whatsappLink("abc", "X"), null);
    // le texte brut n'est jamais repris dans le lien
    assert.strictEqual(U.whatsappLink("01 23 45 67 89?text=pirate&x=https://evil.test", "X"), null);
    const link = U.whatsappLink("+229 01 23 45 67 89", "Nom \"&<b>");
    assert.match(link, /^https:\/\/wa\.me\/[0-9]{8,15}\?text=[A-Za-z0-9%._~-]*$/);
  });
  await test("lien tel: construit avec les chiffres seulement ; vide ou invalide → null (bouton masqué)", () => {
    assert.strictEqual(U.telLink("01 23 45 67 89"), "tel:+2290123456789");
    assert.strictEqual(U.telLink("+33 6 12 34 56 78"), "tel:+33612345678");
    assert.strictEqual(U.telLink(""), null);
    assert.strictEqual(U.telLink("javascript:alert(1)"), null);
  });

  // ---------- prix ----------
  await test("prix : FCFA si renseigné et > 0, sinon « Prix sur demande »", () => {
    assert.strictEqual(U.priceLabel(12500), (12500).toLocaleString("fr-FR") + " FCFA");
    assert.strictEqual(U.priceLabel("2000"), (2000).toLocaleString("fr-FR") + " FCFA");
    [null, undefined, "", 0, -5, 12.5, "abc", NaN].forEach((p) => assert.strictEqual(U.priceLabel(p), "Prix sur demande", String(p)));
    assert.strictEqual(U.availabilityLabel(true), "Disponible");
    assert.strictEqual(U.availabilityLabel(false), "Indisponible");
    assert.strictEqual(U.availabilityLabel(undefined), "Disponible");
  });

  // ---------- photos ----------
  await test("photos : limite de 12, compteur, légende / texte alternatif", () => {
    assert.strictEqual(U.MAX_PHOTOS, 12);
    assert.strictEqual(U.canAddPhoto(0), true);
    assert.strictEqual(U.canAddPhoto(11), true);
    assert.strictEqual(U.canAddPhoto(12), false);
    assert.strictEqual(U.canAddPhoto(20), false);
    assert.strictEqual(U.photoCounter(3), "3 / 12 photos");
    assert.strictEqual(U.photoCounter(12), "12 / 12 photos");
    assert.strictEqual(U.photoAlt({ legende: "Atelier" }, "Boutique Fictive"), "Atelier");
    assert.strictEqual(U.photoAlt({ legende: "   " }, "Boutique Fictive"), "Photo de Boutique Fictive");
    assert.strictEqual(U.photoAlt({ legende: null }, "Boutique Fictive"), "Photo de Boutique Fictive");
  });
  await test("tri par position (nulls à la fin, puis date, puis id) sans modifier la liste d'origine", () => {
    const list = [
      { id: "c", position: 2, created_at: "2026-01-03" }, { id: "a", position: 0, created_at: "2026-01-02" },
      { id: "z", position: null, created_at: "2026-01-01" }, { id: "b", position: 0, created_at: "2026-01-01" }, { id: "d", position: 1, created_at: "2026-01-05" }
    ];
    const copy = JSON.stringify(list);
    assert.deepStrictEqual(U.sortByPosition(list).map((x) => x.id), ["b", "a", "d", "c", "z"]);
    assert.strictEqual(JSON.stringify(list), copy);
    assert.deepStrictEqual(U.sortByPosition(undefined), []);
  });
  await test("monter / descendre : positions 0..n-1, bornes respectées", () => {
    const list = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
    assert.deepStrictEqual(U.moveItem(list, 1, -1).map((x) => x.id + x.position), ["b0", "a1", "c2"]);
    assert.deepStrictEqual(U.moveItem(list, 1, 1).map((x) => x.id + x.position), ["a0", "c1", "b2"]);
    assert.deepStrictEqual(U.moveItem(list, 0, -1).map((x) => x.id + x.position), ["a0", "b1", "c2"]);
    assert.deepStrictEqual(U.moveItem(list, 2, 1).map((x) => x.id + x.position), ["a0", "b1", "c2"]);
    assert.deepStrictEqual(list.map((x) => x.position), [0, 1, 2], "liste d'origine intacte");
  });

  // ---------- images ----------
  await test("images : seulement Cloudinary en https ; affichage avec fl_strip_profile (métadonnées EXIF/GPS retirées)", () => {
    const ok = "https://res.cloudinary.com/democloud/image/upload/v1700000000/dossier/photo.jpg";
    assert.strictEqual(U.imageDeliveryUrl(ok, 800), "https://res.cloudinary.com/democloud/image/upload/f_auto,q_auto,fl_strip_profile,w_800,c_limit/v1700000000/dossier/photo.jpg");
    ["http://res.cloudinary.com/x/image/upload/v1/a.jpg", "https://exemple.test/a.jpg", "https://res.cloudinary.com.pirate.test/a.jpg", "https://res.cloudinary.com@pirate.test/a.jpg", "javascript:alert(1)", "https://res.cloudinary.com/x/a b.jpg", "", null].forEach((u) => assert.strictEqual(U.imageDeliveryUrl(u, 400), null, String(u)));
    const already = "https://res.cloudinary.com/democloud/image/upload/f_auto,q_auto,w_1000,c_limit/v1/a.jpg";
    assert.strictEqual(U.imageDeliveryUrl(already, 400), already, "pas de transformation empilée");
  });
  await test("adresse partageable : https://mahouto.com/e/<slug> seulement avec un slug valide", () => {
    assert.strictEqual(U.shareUrl("atelier-exemple"), "https://mahouto.com/e/atelier-exemple");
    assert.strictEqual(U.shareUrl("Bad Slug"), null);
  });

  // ---------- aperçu de partage ----------
  const og = await import(pathToFileURL(path.join(root, "api", "_entreprise-og.js")).href);
  const CLOUD = "https://res.cloudinary.com/" + (process.env.CLOUDINARY_CLOUD_NAME || "hefa5gqf").trim() + "/image/upload/v1/demo/";
  const ROW = { slug: "atelier-exemple", nom_commercial: "Atelier Exemple", description: "Une description fictive.", ville: "Ville Fictive", logo_url: CLOUD + "logo.png", banner_url: CLOUD + "banniere.jpg", published: true };
  const fakeRes = () => ({ headers: {}, code: null, body: "", setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } });

  await test("aperçu : vitrine publiée → 200, titre, description, URL canonique /e/<slug>, redirection vers la page", () => {
    const p = og.buildEntreprisePreview(ROW, "atelier-exemple");
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.title, "Atelier Exemple");
    assert.strictEqual(p.description, "Une description fictive.");
    assert.strictEqual(p.canonicalUrl, "https://mahouto.com/e/atelier-exemple");
    assert.strictEqual(p.targetUrl, "https://mahouto.com/entreprise.html?slug=atelier-exemple");
    const html = og.renderEntreprisePreviewPage(p);
    assert.match(html, /<meta property="og:title" content="Atelier Exemple">/);
    assert.match(html, /<meta property="og:image:width" content="1200">/);
    assert.match(html, /window\.location\.replace\("https:\/\/mahouto\.com\/entreprise\.html\?slug=atelier-exemple"\)/);
  });
  await test("aperçu : sans description → texte de repli avec la ville ; sans ville → texte simple", () => {
    assert.match(og.buildEntreprisePreview({ ...ROW, description: null }, "atelier-exemple").description, /Atelier Exemple — Ville Fictive/);
    assert.match(og.buildEntreprisePreview({ ...ROW, description: null, ville: null }, "atelier-exemple").description, /^Découvrez Atelier Exemple sur MAHOUTO\+$/);
  });
  await test("aperçu : nom et description hostiles échappés dans toutes les balises", () => {
    const bad = '"><script>alert(1)</script>&\'';
    const html = og.renderEntreprisePreviewPage(og.buildEntreprisePreview({ ...ROW, nom_commercial: "Nom " + bad, description: "Desc " + bad }, "atelier-exemple"));
    assert.ok(!/<script>alert\(1\)/.test(html));
    assert.ok(!/content="[^"]*">\s*<script>alert/.test(html));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&quot;&gt;&lt;script&gt;/);
  });
  await test("aperçu : image 1200x630 — bannière, sinon logo, sinon image par défaut ; sans métadonnées (fl_strip_profile)", () => {
    const a = og.entrepriseOgImage(ROW);
    assert.strictEqual(a.url, CLOUD.replace(/v1\/demo\/$/, "") + "f_jpg,q_auto,fl_strip_profile,w_1200,h_630,c_pad,b_auto:predominant/v1/demo/banniere.jpg");
    assert.deepStrictEqual([a.width, a.height, a.card], ["1200", "630", "summary_large_image"]);
    const b = og.entrepriseOgImage({ ...ROW, banner_url: null });
    assert.match(b.url, /fl_strip_profile.*\/demo\/logo\.png$/);
    const c = og.entrepriseOgImage({ ...ROW, banner_url: "https://exemple.test/x.jpg", logo_url: null });
    assert.strictEqual(c.url, "https://mahouto.com/assets/icon-512.png");
    const d = og.entrepriseOgImage({ ...ROW, banner_url: "https://exemple.test/x.jpg", logo_url: CLOUD + "logo.png" });
    assert.match(d.url, /logo\.png$/, "bannière non utilisable : le logo prend le relais");
    assert.strictEqual(og.entrepriseOgImage({ ...ROW, banner_url: CLOUD + "doc.svg", logo_url: CLOUD + "image.pdf" }).url, "https://mahouto.com/assets/icon-512.png", "formats non lus par WhatsApp");
  });
  await test("aperçu : introuvable, non publié ou sans nom → 404 générique", () => {
    [[null, "atelier-exemple"], [{ ...ROW, published: false }, "atelier-exemple"], [{ ...ROW, nom_commercial: "  " }, "atelier-exemple"], [ROW, "Mauvais Slug"]].forEach(([row, slug]) => {
      const p = og.buildEntreprisePreview(row, slug);
      assert.strictEqual(p.status, 404);
      assert.strictEqual(p.title, "Vitrine introuvable — MAHOUTO+");
      assert.ok(!/Atelier Exemple/.test(og.renderEntreprisePreviewPage(p)), "aucune donnée d'une vitrine non publiée");
    });
  });
  await test("gestionnaire : slug invalide → 404 SANS lecture ; valide → une lecture ; échec → 503 sans cache + redirection", async () => {
    let calls = 0;
    const deps = { fetchEntreprise: async (s) => { calls++; return { row: s === "atelier-exemple" ? ROW : null, error: null }; } };
    for (const bad of ["", "A", "a b", "../x", "x".repeat(41), undefined, ["a", "b"]]) {
      const res = fakeRes(); await og.handleEntreprisePreview({ query: { slug: bad } }, res, deps); assert.strictEqual(res.code, 404, String(bad));
    }
    assert.strictEqual(calls, 0, "aucune lecture pour un slug invalide");
    let res = fakeRes(); await og.handleEntreprisePreview({ query: { slug: "atelier-exemple" } }, res, deps);
    assert.strictEqual(res.code, 200); assert.strictEqual(calls, 1);
    assert.match(res.headers["Cache-Control"], /s-maxage=120/);
    res = fakeRes(); await og.handleEntreprisePreview({ query: { slug: "inconnu" } }, res, deps); assert.strictEqual(res.code, 404);
    res = fakeRes(); await og.handleEntreprisePreview({ query: { slug: "atelier-exemple" } }, res, { fetchEntreprise: async () => ({ row: null, error: new Error("panne") }) });
    assert.strictEqual(res.code, 503); assert.strictEqual(res.headers["Cache-Control"], "no-store");
    assert.match(res.body, /entreprise\.html\?slug=atelier-exemple/);
    res = fakeRes(); await og.handleEntreprisePreview({ query: { slug: "atelier-exemple" } }, res, { fetchEntreprise: async () => { throw new Error("boom"); } });
    assert.strictEqual(res.code, 503); assert.ok(!/boom/.test(res.body));
  });

  // ---------- pages ----------
  const page = read("entreprise.html"), admin = read("admin/vitrines.html");
  const code = (html) => html.slice(html.indexOf("<script>"));

  await test("page publique : rendu sans innerHTML, WhatsApp et appel construits par les fonctions pures, QR en nœuds SVG", () => {
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(page));
    assert.match(page, /U\.whatsappLink\(ent\.whatsapp, nom\)/);
    assert.match(page, /U\.telLink\(ent\.telephone_appel\)/);
    assert.ok(!/href="https:\/\/wa\.me|href="tel:/.test(page), "aucun lien en dur");
    assert.match(page, /document\.createElementNS\(NS, "svg"\)/);
    assert.match(page, /<script src="qrcode-generator\.js"><\/script>/);
    assert.ok(!/<script src="https?:\/\/(?!cdn\.jsdelivr\.net\/npm\/@supabase)/.test(page), "aucun script externe hors Supabase");
    assert.ok(!/(?:qrserver|chart\.googleapis|api\.qrcode)/i.test(page + admin), "aucun service de QR externe");
  });
  await test("page publique : slug validé avant toute requête, lecture des publiés seulement, vitrine introuvable, pied de page exact", () => {
    const c = code(page);
    assert.ok(c.indexOf("U.isValidSlug(slug)") < c.indexOf('supabase.from("entreprises")'));
    assert.match(c, /\.eq\("slug", slug\)\.eq\("published", true\)\.maybeSingle\(\)/);
    assert.match(c, /\.eq\("entreprise_id", ent\.id\)\.eq\("published", true\)/);
    assert.match(page, /Vitrine introuvable/);
    assert.match(page, /Page publiée par MAHOUTO\+ avec l'accord de l'entreprise\./);
    assert.match(page, /text: "Prix sur demande"|U\.priceLabel\(p\.prix\)/);
    assert.match(page, /<script src="pwa-install\.js"><\/script>\s*<\/body>/);
  });
  await test("visionneuse : rôle dialog, aria-modal, fermer, Échap, focus géré, glissement gauche/droite, images paresseuses", () => {
    assert.match(page, /id="viewer" role="dialog" aria-modal="true"/);
    assert.match(page, /aria-label="Fermer la visionneuse"/);
    assert.match(page, /e\.key === "Escape"/);
    assert.match(page, /\$\("v-close"\)\.focus\(\)/);
    assert.match(page, /viewer\.opener\.focus\(\)/);
    assert.match(page, /touchstart[\s\S]*touchend[\s\S]*Math\.abs\(dx\) > 50/);
    assert.match(page, /loading: "lazy"/);
    assert.match(page, /grid-template-columns: repeat\(2, 1fr\)/);
    assert.match(page, /text: "Photos"/);
    assert.match(page, /if \(photos\.length\) \{/, "section masquée sans photo");
  });
  await test("admin : aucun innerHTML, avertissements, nom légal, contrôle de type/taille, envoi séquentiel, mémoire libérée", () => {
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(admin));
    assert.match(admin, /Pour une société, saisissez la dénomination \(ex\. SOJA SARL\)\. Ne saisissez jamais le nom d'une personne\./);
    assert.strictEqual((admin.match(/Ne publiez pas de photo où une personne est reconnaissable sans son accord\./g) || []).length, 2);
    assert.match(admin, /MAX_UPLOAD_BYTES = 8 \* 1024 \* 1024/);
    assert.match(admin, /Format non accepté : utilisez une image JPEG, PNG ou WebP\./);
    assert.match(admin, /for \(let i = 0; i < files\.length; i\+\+\) \{\s*\/\/ séquentiel/);
    assert.ok(!/Promise\.all\([^)]*(upload|processAndUpload|files)/i.test(admin), "aucun envoi en parallèle");
    assert.match(admin, /bitmap\.close\(\)/);
    assert.match(admin, /URL\.revokeObjectURL\(objectUrl\)/);
    assert.match(admin, /canvas\.width = 0; canvas\.height = 0/);
    assert.match(admin, /imageOrientation: "from-image"/);
    assert.match(admin, /busyUpload/);
    assert.match(admin, /U\.canAddPhoto\(PHOTOS\.length\)/);
    assert.match(admin, /U\.photoCounter\(PHOTOS\.length\)/);
    assert.match(admin, /U\.normalizePhone\(\$\(inputId\)\.value\)/);
    assert.match(admin, /if \(r\.ok && !r\.empty\) \$\(inputId\)\.value = r\.e164/);
    assert.match(admin, /Pour publier, renseignez l'adresse \(slug\) et le nom commercial\./);
    assert.match(admin, /role !== "admin" && role !== "super_admin" && role !== "founder"/);
    assert.match(admin, /confirm\("Supprimer cette photo de la galerie \?"\)/);
  });
  await test("lien depuis le tableau de bord (admin/formations.html) seulement ; aucun lien d'entreprise dans index.html", () => {
    assert.match(read("admin/formations.html"), /<a href="vitrines\.html"[^>]*>Vitrines<\/a>/);
    ["produits", "rooms", "users", "statistiques", "signalements"].forEach((p) => assert.ok(!/vitrines\.html/.test(read("admin/" + p + ".html")), p));
    assert.ok(!/entreprise\.html|\/e\//.test(read("index.html")));
  });

  // ---------- PWA, routes, fonctions ----------
  await test("service worker : pages et scripts dans APP_SHELL, version ≥ v104 ; /e/:slug → api/produit-og (type entreprise)", () => {
    const sw = read("sw.js");
    const shell = sw.slice(sw.indexOf("const APP_SHELL = ["), sw.indexOf("];", sw.indexOf("const APP_SHELL = [")));
    ["/entreprise.html", "/entreprise-utils.js", "/qrcode-generator.js"].forEach((f) => assert.strictEqual((shell.match(new RegExp('"' + f.replace(/[./]/g, "\\$&") + '"', "g")) || []).length, 1, f));
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 104);
    ["entreprise.html", "entreprise-utils.js", "qrcode-generator.js"].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f));
    const rw = JSON.parse(read("vercel.json")).rewrites.find((r) => r.source === "/e/:slug");
    assert.deepStrictEqual(rw, { source: "/e/:slug", destination: "/api/produit-og?type=entreprise&slug=:slug" });
    const og2 = read("api/produit-og.js");
    assert.match(og2, /req\.query\.type === "entreprise" && req\.query\.format !== "json"/);
    assert.match(og2, /\.from\("entreprises"\)\.select\(ENTREPRISE_FIELDS\)\.eq\("slug", slug\)\.eq\("published", true\)/);
    assert.ok(!/SERVICE_ROLE/.test(read("api/_entreprise-og.js")), "jamais de clé service_role");
  });
  await test("plafond Vercel : toujours 12 fonctions (aucun nouveau fichier non préfixé par « _ » dans api/)", () => {
    const fns = [];
    (function scan(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) return scan(p); if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(path.relative(path.join(root, "api"), p)); }); })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12, fns.join(", "));
    assert.ok(!fns.some((f) => /entreprise/.test(f)));
  });
  await test("QR code : bibliothèque MIT copiée dans le dépôt, intacte (empreinte SHA-256), avec sa licence ; jamais chargée depuis un CDN", () => {
    const buf = fs.readFileSync(path.join(root, "qrcode-generator.js"));
    assert.strictEqual(crypto.createHash("sha256").update(buf).digest("hex"), "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c");
    assert.match(buf.toString("utf8"), /Copyright \(c\) 2009 Kazuhiko Arase[\s\S]*Licensed under the MIT license/);
    const lic = read("LICENSE-qrcode-generator.txt");
    assert.match(lic, /The MIT License \(MIT\)/);
    assert.match(lic, /Copyright \(c\) 2009 Kazuhiko Arase/);
    assert.match(lic, /2\.0\.4/);
    assert.ok(!/cdn[^"']*qrcode/i.test(page + admin));
  });
  await test("aucune donnée d'entreprise réelle : aucun numéro de téléphone ni adresse e-mail dans les nouveaux fichiers", () => {
    ["entreprise.html", "entreprise-utils.js", "admin/vitrines.html", "api/_entreprise-og.js", "entreprises-vitrine.sql", "entreprises-vitrine-rollback.sql"].forEach((f) => {
      const t = read(f);
      assert.ok(!/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/.test(t), f + " : e-mail");
      assert.ok(!/(?:\+?229|\b01)[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}\b/.test(t.replace(/01 23 45 67 89/g, "")), f + " : numéro");
    });
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
