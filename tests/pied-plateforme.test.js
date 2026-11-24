/* Pied de la page publique : « Une plateforme MAHOUTO+, par MAJESTÉ PRESSE », texte FIXE, identique sur mahouto.com et majestepresse.com.
   Le lien et le QR restent sur mahouto.com ; l'aperçu de partage, brand.js, le manifeste et la carte imprimée ne changent pas. Aucun réseau. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const PU = require("../profil-public-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
const PHRASE = "Une plateforme MAHOUTO+, par MAJESTÉ PRESSE", OLD = "Page créée avec MAHOUTO+";
const html = read("m.html"), cree = /<p class="cree">([\s\S]*?)<\/p>/.exec(html)[1];
const textOf = (h) => h.replace(/<[^>]+>/g, "");

test("le pied contient EXACTEMENT « Une plateforme MAHOUTO+, par MAJESTÉ PRESSE », à la place de l'ancienne phrase", () => {
  assert.match(cree, /<span data-brand-fixed>Une plateforme MAHOUTO\+, par <span class="nw">MAJESTÉ PRESSE<\/span><\/span>/);
  assert.strictEqual(textOf(/<span data-brand-fixed>([\s\S]*?<\/span>)<\/span>/.exec(cree)[0]), PHRASE);
  assert.ok(!html.includes(OLD) && !read("m.js").includes(OLD), "l'ancienne phrase n'existe plus (ni dans m.html, ni dans m.js)");
  assert.strictEqual((html.match(/Une plateforme MAHOUTO\+/g) || []).length, 1, "une seule fois");
});

test("le logo, « Créer ma page », « Règles » et « Signaler cette page » sont conservés, dans l'ordre", () => {
  assert.match(cree, /<img id="cree-logo" src="\/assets\/logo-mahouto-plus-128\.png"/); assert.ok(cree.includes('<a href="/profil.html">Créer ma page</a>'));
  const foot = html.slice(html.indexOf('<footer class="pied">'), html.indexOf("</footer>"));
  const order = ["cree-logo", PHRASE.slice(0, 20), "Créer ma page", 'id="lien-regles"', "btn-signaler"].map((k) => foot.indexOf(k)); assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b));
  assert.ok(foot.includes('id="btn-signaler">Signaler cette page</button>') && foot.includes("Connectez-vous pour signaler cette page"));
  assert.match(html, /\.cree \.nw \{ white-space: nowrap; \}/, "« MAJESTÉ PRESSE » ne se coupe pas en deux lignes");
});

test("la phrase ne dépend PAS de la marque : data-brand-fixed (brand.js ne réécrit pas ce texte), aucune écriture par m.js, aucun MAHOUTO_BRAND dans le pied", () => {
  assert.ok(cree.includes("data-brand-fixed"), "sans cet attribut brand.js remplacerait « MAHOUTO+ » par le nom de la marque du site");
  assert.match(read("brand.js"), /p\.closest\("\[data-brand-fixed\]"\)\) return NodeFilter\.FILTER_REJECT/, "brand.js respecte data-brand-fixed");
  assert.match(read("brand.js"), /var TOKEN = \/MAHOUTO\\\+\/g;/, "garde : c'est bien ce remplacement global qu'il faut éviter");
  const js = code("m.js");
  assert.ok(!/cree\b|plateforme|MAJESTÉ PRESSE/.test(js.replace(/"cree-logo"/g, "")), "m.js n'écrit, ne lit et ne référence pas cette phrase (seul le logo du pied suit la marque)");
  assert.ok(!/MAHOUTO_BRAND|BRAND_NAME/.test(cree), "aucune dépendance à la marque dans le pied");
  assert.ok(!/<span(?![^>]*(data-brand-fixed|class="nw"))[^>]*>[^<]*MAHOUTO\+/.test(cree), "le seul « MAHOUTO+ » du pied est dans le span protégé");
});

test("ne change pas : titre de l'onglet et nom du partage = marque du site (m.js) ; lien et QR = https://mahouto.com/m/<adresse>", () => {
  const js = code("m.js");
  assert.match(js, /document\.title = \(row\.nom_affiche \|\| "Profil"\) \+ " — " \+ BRAND_NAME;/); assert.match(js, /PU\.sharePayload\(row\.nom_affiche, adresse, BRAND_NAME\)/);
  assert.match(js, /var BRAND_NAME = typeof brand\.name === "string" && brand\.name \? brand\.name : "MAHOUTO\+";/);
  assert.strictEqual(PU.SITE, "https://mahouto.com"); assert.strictEqual(PU.qrUrl("mon-atelier"), "https://mahouto.com/m/mon-atelier?src=qr"); assert.strictEqual(PU.shareLink("mon-atelier"), "https://mahouto.com/m/mon-atelier");
  assert.ok(!/majestepresse\.com/i.test(read("profil-public-utils.js") + read("m.js") + html), "aucune adresse majestepresse.com dans la page publique (le lien et le QR restent sur mahouto.com)");
});

test("fichiers inchangés par ce complément : brand.js, manifest.json, carte PNG (empreintes) ; api/_profil-og.js garde le site et la marque fixes", () => {
  // Si l'un de ces fichiers doit changer un jour, mettre l'empreinte à jour DÉLIBÉRÉMENT dans la même PR.
  // api/_profil-og.js : modifié VOLONTAIREMENT par la PR des alias (résolution d'un alias) ; ses invariants de marque sont vérifiés ci-dessous.
  assert.match(read("api/_profil-og.js"), /export const PROFIL_SITE = "https:\/\/mahouto\.com";/); assert.match(read("api/_profil-og.js"), /export const PROFIL_BRAND = "MAHOUTO\+";/);
  assert.strictEqual(sha("brand.js"), "59218d104c8432e666f4a404cd6c793912220c9373a0505a56fe7847a8774165");
  assert.strictEqual(sha("manifest.json"), "3dbd49434a9c6ad9edab1c823fa8af6dd71e01a927c34c3588a6841e2c01f544");
  assert.strictEqual(sha("profil-public-carte.js"), "9c8647382d35ce8022d176638ca08e0998df3e3826a314217c94f69a7e1550e3");
  assert.ok(/MAHOUTO\+/.test(read("api/_profil-og.js")), "l'aperçu WhatsApp garde la marque fixe MAHOUTO+");
  assert.ok(!/MAHOUTO_BRAND|brand\.js/.test(read("api/_profil-og.js")), "l'aperçu ne dépend pas de la marque du site");
});

test("sw.js : version 125 ou plus (une seule incrémentation par PR ; la PR des alias passe à 126)", () => {
  assert.match(read("sw.js"), /CACHE_NAME = "mahoutoplus-shell-v(12[5-9]|1[3-9]\d)"/);
});
