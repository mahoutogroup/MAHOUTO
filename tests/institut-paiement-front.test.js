/* Tests du front du paiement de l'Institut (PR 4) : module pur institut-paiement-utils.js, garde-fous statiques des pages
   (aucun innerHTML, boutons conditionnels, aucun montant envoyé) et cache du service worker. Aucun réseau. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const PAY = require("../institut-paiement-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("checkoutBody : AUCUN montant, jamais ; identifiants invalides refusés", () => {
  assert.deepStrictEqual(PAY.checkoutBody("parrain", "serigraphie", UUID), { productType: "institut", cas: "parrain", demandeId: UUID, formationId: "serigraphie" });
  assert.deepStrictEqual(PAY.checkoutBody("petit_fils", "serigraphie"), { productType: "institut", cas: "petit_fils", formationId: "serigraphie" });
  [PAY.checkoutBody("parrain", "serigraphie", UUID), PAY.checkoutBody("petit_fils", "x")].forEach((b) => {
    assert.ok(!Object.keys(b).some((k) => /montant|amount|prix|price/i.test(k)), "aucune clé de montant");
  });
  assert.strictEqual(PAY.checkoutBody("parrain", "serigraphie", "pas-un-uuid"), null);
  assert.strictEqual(PAY.checkoutBody("parrain", "serigraphie"), null);
  assert.strictEqual(PAY.checkoutBody("autre", "serigraphie", UUID), null);
  assert.strictEqual(PAY.checkoutBody("petit_fils", "a b"), null);
  assert.strictEqual(PAY.checkoutBody("petit_fils", ""), null);
});

test("canPayDemande : validée ET sans place seulement", () => {
  assert.strictEqual(PAY.canPayDemande({ statut: "validee" }, false), true);
  assert.strictEqual(PAY.canPayDemande({ statut: "validee" }, true), false);
  ["en_attente", "refusee"].forEach((s) => assert.strictEqual(PAY.canPayDemande({ statut: s }, false), false));
  assert.strictEqual(PAY.canPayDemande(null, false), false);
});

test("payableForPetitFils : écarte les formations déjà possédées et les prix invalides", () => {
  const c = [{ id: "a", prixInstitut: 100 }, { id: "b", prixInstitut: 200 }, { id: "c", prixInstitut: 0 }, { id: "d", prixInstitut: 1.5 }];
  assert.deepStrictEqual(PAY.payableForPetitFils(c, ["a"]).map((x) => x.id), ["b"]);
  assert.deepStrictEqual(PAY.payableForPetitFils(null, null), []);
});

test("formatPrice, safeCheckoutUrl (https seulement), messages d'erreur", () => {
  assert.strictEqual(PAY.formatPrice(50000), "50 000 FCFA");
  assert.strictEqual(PAY.formatPrice(0), ""); assert.strictEqual(PAY.formatPrice("50"), "");
  assert.strictEqual(PAY.safeCheckoutUrl("https://paiement.exemple.test/x"), "https://paiement.exemple.test/x");
  ["http://x.test", "javascript:alert(1)", "data:text/html,x", "", null, 5].forEach((u) => assert.strictEqual(PAY.safeCheckoutUrl(u), null));
  assert.strictEqual(PAY.checkoutErrorMessage(409, "Tu possèdes déjà cette formation."), "Tu possèdes déjà cette formation.");
  assert.match(PAY.checkoutErrorMessage(500, null), /Réessayez/);
});

test("retourState : message clair selon SA ligne de paiement ; anomalie → « ne payez pas deux fois » ; aucune donnée sensible", () => {
  assert.strictEqual(PAY.retourState(null).key, "inconnu");
  assert.strictEqual(PAY.retourState({ statut: "en_attente" }).key, "en_attente");
  assert.strictEqual(PAY.retourState({ statut: "paye", type: "parrain", note: null }).key, "paye_parrain");
  assert.strictEqual(PAY.retourState({ statut: "paye", type: "petit_fils", note: null }).key, "paye_petit_fils");
  const a = PAY.retourState({ statut: "paye", type: "parrain", note: "place_deja_existante" });
  assert.strictEqual(a.key, "a_verifier"); assert.match(a.text, /Ne payez pas une seconde fois/);
  assert.strictEqual(PAY.retourState({ statut: "echoue" }).key, "echoue");
  ["inconnu", "en_attente", "paye", "echoue"].forEach((s) => assert.ok(!/(FCFA|\d{4,}|transaction)/i.test(PAY.retourState({ statut: s, type: "parrain" }).text)));
});

test("front : aucun innerHTML / document.write / eval ; aucun montant envoyé ; boutons conditionnés", () => {
  ["institut-demande.js", "institut-retour.js", "institut-paiement-utils.js"].forEach((f) => {
    const c = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(c), f);
  });
  const adm = read("admin/institut.html"); assert.ok(!/innerHTML/.test(adm));
  const d = read("institut-demande.js");
  assert.match(d, /canPay = !!user && \(open \|\| isAdmin\)/, "fermé : pas de paiement sauf admin");
  assert.match(d, /else if \(canPay && catalogue\.length && PAY\.canPayDemande\(d, false\)\)/, "bouton parrain : validée, sans place");
  assert.match(d, /setHidden\("bloc-petit-fils", !\(canPay && petitFils\)\)/, "bouton petit-fils : marqué seulement");
  const fetchBody = /JSON\.stringify\(body\)/.exec(d);
  assert.ok(fetchBody && !/montant|amount|prix/i.test(d.slice(d.indexOf("async function startPayment"), d.indexOf("// Choix de la formation"))), "aucun montant dans la requête");
  assert.ok(d.includes("PAY.safeCheckoutUrl(data.checkoutUrl)"));
});

test("pages : institut-retour.html noindex, scripts dans l'ordre ; institut-demande.html charge le module ; sw.js v114 ou plus + fichiers publics", () => {
  const h = read("institut-retour.html");
  assert.match(h, /<meta name="robots" content="noindex">/);
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.indexOf("institut-paiement-utils.js") < srcs.indexOf("institut-retour.js") && srcs.indexOf("institut-retour.js") !== -1);
  assert.ok(!/<script>/.test(h));
  const d = read("institut-demande.html");
  assert.ok(d.indexOf("institut-paiement-utils.js") > d.indexOf("institut-place-utils.js") && d.indexOf("institut-paiement-utils.js") < d.indexOf("institut-demande.js"));
  const sw = read("sw.js");
  assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v(11[4-9]|1[2-9]\d)"/);
  ["/institut-paiement-utils.js", "/institut-retour.html", "/institut-retour.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
  assert.ok(!sw.includes("admin/institut"));
  // le retour ne lit jamais l'URL
  assert.ok(!/location\.(search|hash)|URLSearchParams/.test(read("institut-retour.js")));
});
