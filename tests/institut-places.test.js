/* Places, dons, codes d'invitation et catalogue de l'Institut SAYÉ LOUIS (PR 3) : validation pure
   (institut-place-utils.js, institut-utils.js, purchase-list.js) et garde-fous statiques des pages et scripts.
   Exécution : node --test tests/institut-places.test.js — aucune dépendance, aucun réseau, aucune base.
   Toutes les valeurs sont FICTIVES (aucun nom, téléphone, e-mail ou identifiant réel). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const U = require("../institut-utils");
const P = require("../institut-place-utils");
const D = require("../institut-demande-utils");
const PL = require("../purchase-list");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const NB = String.fromCharCode(0xA0);

// ---------- code d'invitation ----------
test("code : normalisation (majuscules, sans espaces ni tirets ni séparateurs) et mise en forme ABCD-EFGH", () => {
  assert.strictEqual(P.normalizeCode("abcd-efgh"), "ABCDEFGH");
  assert.strictEqual(P.normalizeCode("  ab cd  ef-gh "), "ABCDEFGH");
  assert.strictEqual(P.normalizeCode("ab" + NB + "cd" + String.fromCharCode(0x2013) + "ef_gh.jk"), "ABCDEFGHJK");
  assert.strictEqual(P.normalizeCode(null), ""); assert.strictEqual(P.normalizeCode(undefined), ""); assert.strictEqual(P.normalizeCode(12), "12");
  assert.strictEqual(P.formatCode("abcdefgh"), "ABCD-EFGH");
  assert.strictEqual(P.formatCode("abcd"), "ABCD");
  assert.strictEqual(P.formatCode("abcde"), "ABCD-E");
  assert.strictEqual(P.formatCode("abcdefghijkl"), "ABCD-EFGH", "limité à 8 caractères");
  assert.strictEqual(P.formatCode("ab-cd ef$gh"), "ABCD-EFGH", "caractères parasites retirés");
  assert.strictEqual(P.formatCode(""), "");
});

test("code : format de 8 caractères de l'alphabet sans ambiguïté (ni I, ni O, ni 0, ni 1) ; message neutre sinon", () => {
  assert.strictEqual(P.CODE_ALPHABET.length, 32);
  assert.ok(!/[IO01]/.test(P.CODE_ALPHABET));
  assert.strictEqual(P.CODE_LENGTH, 8);
  ["ABCDEFGH", "abcd-efgh", "A2B3 C4D5", "ZZZZ-2222", "98765432"].forEach((c) => { const r = P.validateCode(c); assert.strictEqual(r.ok, true, c); assert.ok(P.CODE_RE.test(r.code)); });
  ["ABCDEFGI", "ABCDEFGO", "ABCDEFG0", "ABCDEFG1", "ABCDEFG", "ABCDEFGHJ", "ABCD-EFG!", "<script>", "ABCDEFGH' or 1=1"].forEach((c) => {
    const r = P.validateCode(c); assert.strictEqual(r.ok, false, c); assert.strictEqual(r.error, P.MSG_CODE_FORMAT, "même message d'aide au format pour : " + c);
  });
  assert.match(P.validateCode("").error, /Saisissez le code/);
  assert.match(P.validateCode("   -  ").error, /Saisissez le code/);
  assert.ok(!/existe|n'existe pas|inconnu|expiré/i.test(P.MSG_CODE_INVALIDE), "aucun indice sur les codes qui existent");
});

test("format refusé dans le navigateur : message utile (8 caractères, lettres et chiffres, jamais O I 0 1) ; la normalisation ne change pas", () => {
  const MSG = "Ce code ne ressemble pas à un code valide. Il compte 8 caractères (lettres et chiffres). Les lettres O, I et les chiffres 0, 1 ne sont jamais utilisés : vérifiez votre saisie.";
  assert.strictEqual(P.MSG_CODE_FORMAT, MSG);
  ["ABC", "ABCDEFGHJ", "ABCDEFG0", "ABCDEFGI", "abcd-efgO", "AB CD-EF 1H", "<script>", "ABCD-EFG!"].forEach((c) => {
    const r = P.validateCode(c); assert.deepStrictEqual(r, { ok: false, error: MSG }, c);
  });
  assert.match(P.validateCode("").error, /Saisissez le code/, "saisie vide : message inchangé");
  assert.ok(!/existe|inconnu|déjà été utilisé/i.test(P.MSG_CODE_FORMAT), "aucun indice sur les codes qui existent");
  // normalisation inchangée : majuscules, espaces et tirets ignorés
  assert.deepStrictEqual(P.validateCode("ab cd-ef gh"), { ok: true, code: "ABCDEFGH" });
  assert.strictEqual(P.normalizeCode(" a-b c_d.e f-g h "), "ABCDEFGH");
  assert.strictEqual(P.formatCode("abcdefgh"), "ABCD-EFGH");
  // la page affiche exactement ce message avant tout appel serveur
  const js = read("institut-place.js");
  assert.match(js, /var check = P\.validateCode\(\$\("f-code"\)\.value\);\s*if \(!check\.ok\) \{ setStatus\("e-code", check\.error, true\);[^}]*return; \}/);
  assert.ok(js.indexOf("P.validateCode(") < js.indexOf('supabase.rpc("institut_reclamer_place"'), "validation locale avant l'appel");
  assert.ok(!js.includes("ne ressemble pas"), "le texte vit dans le module testable, pas dans la page");
});

test("admin/institut.html : « Place non réclamée » n'apparaît qu'une fois dans le cadre de la place (pas de doublon)", () => {
  const html = read("admin/institut.html");
  const fn = /function placeInfo\(place\) \{([\s\S]*?)\n  \}\n/.exec(html)[1];
  assert.ok(!/state\.label|placeState/.test(fn), "le libellé d'état n'est plus répété entre parenthèses");
  assert.strictEqual((fn.match(/non réclamée/g) || []).length, 1, "une seule occurrence de « non réclamée »");
  assert.strictEqual((fn.match(/réclamée le/g) || []).length, 1);
  assert.match(fn, /el\("div", \{ class: "who", text: "Place : " \+ when \}\)/);
  assert.match(fn, /U\.formatDate\(place\.cree_le\) \}\),/, "la ligne de détail se termine par la date d'attribution");
  assert.ok(!/innerHTML/.test(fn));
  // le libellé du module partagé reste disponible (demande du parrain : « Place utilisée »)
  assert.strictEqual(P.placeState({ code: "X", reclamee_le: null }).label, "Place non réclamée");
});

test("réponse de la base : succès = identifiant de formation ; chaque « ERREUR:<CODE> » a un message clair ; inconnu = mal formé = déjà utilisé", () => {
  assert.deepStrictEqual(P.claimOutcome("serigraphie"), { ok: true, formationId: "serigraphie" });
  assert.deepStrictEqual(P.claimOutcome("f-1"), { ok: true, formationId: "f-1" });
  const invalid = P.claimOutcome("ERREUR:CODE_INVALIDE");
  assert.deepStrictEqual(invalid, { ok: false, message: P.MSG_CODE_INVALIDE }, "réponse du serveur inchangée");
  assert.strictEqual(P.MSG_CODE_INVALIDE, "Ce code n'est pas valide ou a déjà été utilisé. Vérifiez-le puis réessayez.");
  assert.notStrictEqual(P.MSG_CODE_FORMAT, P.MSG_CODE_INVALIDE, "le refus local et la réponse du serveur sont deux messages distincts");
  assert.match(P.claimOutcome("ERREUR:TROP_DE_TENTATIVES").message, /Trop de tentatives.*une heure/);
  assert.match(P.claimOutcome("ERREUR:DEJA_POSSEDEE").message, /déjà accès.*n'a pas été utilisé/);
  assert.match(P.claimOutcome("ERREUR:PARRAIN").message, /compte de l'élève/);
  assert.match(P.claimOutcome("ERREUR:ACHAT_EXISTANT").message, /n'a pas été utilisé/);
  ["ERREUR:AUTRE", "ERREUR:", "", null, undefined, 42, {}].forEach((x) => { const r = P.claimOutcome(x); assert.strictEqual(r.ok, false, String(x)); assert.ok(r.message.length > 10); });
  ["ERREUR:AUTRE", "ERREUR:CODE_INVALIDE"].forEach((x) => assert.ok(!/ERREUR|CODE_/.test(P.claimOutcome(x).message), "le code technique n'est jamais affiché"));
});

test("erreurs techniques : messages clairs, jamais le texte brut de la base ; adresse de la formation encodée", () => {
  assert.match(P.rpcErrorMessage({ message: "Failed to fetch" }), /Pas de connexion/);
  assert.match(P.rpcErrorMessage({ code: "42501", message: "permission denied for function" }), /session a expiré/);
  assert.match(P.rpcErrorMessage({ message: "Connectez-vous pour utiliser un code d'invitation." }), /Connectez-vous/);
  assert.ok(!/boom/.test(P.rpcErrorMessage({ message: "boom" })));
  assert.ok(P.rpcErrorMessage(null).length > 10);
  assert.strictEqual(P.formationUrl("serigraphie"), "formation-detail.html?course=serigraphie");
  assert.strictEqual(P.formationUrl("a b&c"), "formation-detail.html?course=a%20b%26c");
});

// ---------- prix Institut ----------
test("prix Institut : entier > 0 ; supérieur au prix Académie = AVERTISSEMENT sans blocage", () => {
  assert.deepStrictEqual(P.validatePrixInstitut("50000", 250000), { ok: true, value: 50000 });
  assert.deepStrictEqual(P.validatePrixInstitut(" 50 000 ", 250000), { ok: true, value: 50000 });
  assert.deepStrictEqual(P.validatePrixInstitut("250000", 250000), { ok: true, value: 250000 }, "égal : pas d'avertissement");
  const over = P.validatePrixInstitut("300000", 250000);
  assert.strictEqual(over.ok, true); assert.strictEqual(over.value, 300000); assert.match(over.warning, /supérieur au prix de l'Académie/);
  assert.match(over.warning, new RegExp("300" + NB + "000" + NB + "FCFA"));
  assert.strictEqual(P.validatePrixInstitut("300000", null).warning, undefined, "prix Académie inconnu : pas d'avertissement");
  ["", "  ", "0", "-5", "12,5", "12.5", "abc", "1e3", "1234567890", null, undefined].forEach((v) => {
    const r = P.validatePrixInstitut(v, 250000); assert.strictEqual(r.ok, false, String(v)); assert.ok(r.error);
  });
});

test("prix de l'Académie : le prix promotionnel s'il existe, sinon le prix ; jamais de prix invalide", () => {
  assert.strictEqual(P.academyPrice({ prix: 250000, promotion: null }), 250000);
  assert.strictEqual(P.academyPrice({ prix: 300000, promotion: 250000 }), 250000);
  assert.strictEqual(P.academyPrice({ prix: 300000, promotion: 0 }), 300000);
  assert.strictEqual(P.academyPrice({ prix: 0 }), null); assert.strictEqual(P.academyPrice({ prix: "abc" }), null); assert.strictEqual(P.academyPrice(null), null);
  assert.strictEqual(U.formatFcfa(250000), "250" + NB + "000" + NB + "FCFA");
  assert.strictEqual(U.formatFcfa(50), "50" + NB + "FCFA"); assert.strictEqual(U.formatFcfa(NaN), "—");
});

// ---------- dons ----------
test("don : montant > 0, 1 à 1000 places, donateur ≤ 80, note ≤ 300 (facultatifs : null si vides)", () => {
  const ok = P.validateDon({ montant: "100 000", places: "2", donateur: "  Donateur Fictif ", note: "  Reçu en main propre.  " });
  assert.deepStrictEqual(ok, { ok: true, value: { montant: 100000, places: 2, donateur: "Donateur Fictif", note: "Reçu en main propre." } });
  assert.deepStrictEqual(P.validateDon({ montant: "5000", places: "1", donateur: "", note: "" }).value, { montant: 5000, places: 1, donateur: null, note: null });
  assert.strictEqual(P.validateDon({ montant: "5000", places: "1000" }).ok, true);
  assert.strictEqual(P.validateDon({ montant: "5000", places: "1", donateur: "a".repeat(80) }).ok, true);
  assert.strictEqual(P.validateDon({ montant: "5000", places: "1", note: "a".repeat(300) }).ok, true);
  [["montant", { montant: "0", places: "1" }], ["montant", { montant: "-5", places: "1" }], ["montant", { montant: "abc", places: "1" }], ["montant", { montant: "", places: "1" }], ["montant", { montant: "12,5", places: "1" }],
    ["places", { montant: "5000", places: "0" }], ["places", { montant: "5000", places: "1001" }], ["places", { montant: "5000", places: "" }], ["places", { montant: "5000", places: "1.5" }],
    ["donateur", { montant: "5000", places: "1", donateur: "a".repeat(81) }], ["note", { montant: "5000", places: "1", note: "a".repeat(301) }]]
    .forEach(([field, input]) => { const r = P.validateDon(input); assert.strictEqual(r.ok, false, JSON.stringify(input)); assert.ok(r.errors[field], field); });
  [null, undefined, "x", 5].forEach((x) => { assert.strictEqual(P.validateDon(x).ok, false); });
});

test("places d'un don : restantes (jamais négatives), compte par don, état d'une place", () => {
  assert.strictEqual(P.placesRestantes({ places: 5 }, 2), 3); assert.strictEqual(P.placesRestantes({ places: 5 }, 5), 0); assert.strictEqual(P.placesRestantes({ places: 5 }, 9), 0);
  assert.strictEqual(P.placesRestantes(null, 1), 0); assert.strictEqual(P.placesRestantes({ places: "x" }, 1), 0);
  assert.deepStrictEqual(P.usedByDon([{ don_id: "a" }, { don_id: "a" }, { don_id: null }, { don_id: "b" }, null]), { a: 2, b: 1 });
  assert.deepStrictEqual(P.usedByDon(null), {});
  assert.deepStrictEqual(P.placeState(null), { key: "aucune", label: "Aucune place attribuée" });
  assert.deepStrictEqual(P.placeState({ code: "X", reclamee_le: null }), { key: "non_reclamee", label: "Place non réclamée" });
  assert.deepStrictEqual(P.placeState({ code: "X", reclamee_le: "2026-11-18T10:00:00Z" }), { key: "reclamee", label: "Place utilisée" });
});

// ---------- catalogue : formations de l'Académie proposées à l'Institut ----------
test("catalogue : formations actives lues (nom, prix) ; id trop long, nom absent ou ligne invalide ignorés ; tri par ordre puis nom", () => {
  const rows = [
    { formation_id: "f3", prix_institut: 3000, ordre: 2, formations: { nom: "Zèbre", prix: 9000, promotion: null } },
    { formation_id: "f1", prix_institut: 1000, ordre: 1, formations: { nom: "Sérigraphie", prix: 3000, promotion: 2500 } },
    { formation_id: "f2", prix_institut: 2000, ordre: 2, formations: { nom: "Abeille", prix: 8000 } },
    { formation_id: "x".repeat(41), prix_institut: 1, ordre: 0, formations: { nom: "Trop long" } },
    { formation_id: "f4", prix_institut: 1, ordre: 0, formations: null }, { formation_id: "f5", prix_institut: 1, ordre: 0, formations: { nom: "  " } },
    null, { formation_id: 12, formations: { nom: "n" } }
  ];
  const c = P.formationChoices(rows);
  assert.deepStrictEqual(c.map((x) => x.id), ["f1", "f2", "f3"]);
  assert.deepStrictEqual([c[0].nom, c[0].prixInstitut, c[0].prixAcademie], ["Sérigraphie", 1000, 2500]);
  assert.strictEqual(c[1].prixAcademie, 8000);
  assert.deepStrictEqual(P.formationChoices(null), []); assert.deepStrictEqual(P.formationChoices("x"), []);
  assert.strictEqual(P.formationChoices([{ formation_id: "a", prix_institut: 5, formations: { nom: "<b>X</b>" } }])[0].nom, "<b>X</b>", "le nom reste du texte (jamais interprété)");
});

test("liste de demande : l'identifiant choisi est celui de la liste lue dans la base ; repli sur la constante Sérigraphie", () => {
  const ok = { prenom: "Awa", age: "16", situation: "pere", parrainMajeur: true, lien: "parent", motif: "" };
  const dyn = [["fmt-1", "Formation Un"], ["fmt-2", "Formation Deux"]];
  assert.strictEqual(D.validateDemande(Object.assign({ formation: "fmt-2" }, ok), dyn).value.formation, "fmt-2");
  assert.strictEqual(D.validateDemande(Object.assign({ formation: "serigraphie" }, ok), dyn).ok, false, "la constante n'est plus acceptée quand la liste vient de la base");
  assert.strictEqual(D.validateDemande(Object.assign({ formation: "serigraphie" }, ok), []).ok, true, "liste vide : repli");
  assert.strictEqual(D.validateDemande(Object.assign({ formation: "serigraphie" }, ok), null).ok, true);
  assert.strictEqual(D.validateDemande(Object.assign({ formation: "serigraphie" }, ok)).ok, true, "comportement des PR 1 et 2 inchangé");
  assert.deepStrictEqual(U.FORMATIONS, [["serigraphie", "Sérigraphie"]]);
  assert.strictEqual(P.formationName("fmt-1", { "fmt-1": "Formation Un" }), "Formation Un");
  assert.strictEqual(P.formationName("serigraphie", {}), "Sérigraphie");
  assert.strictEqual(P.formationName("inconnue", null), "inconnue");
});

// ---------- achats : une place Institut dans « Mes achats » ----------
test("une place Institut (formation payée à 0 FCFA, sans transaction) est reconnue ; un vrai achat ou un autre type ne l'est jamais", () => {
  const base = { product_type: "formation", status: "paid", amount: 0, fedapay_transaction_id: null };
  assert.strictEqual(PL.isInstitutPlace(base), true);
  assert.strictEqual(PL.isInstitutPlace(Object.assign({}, base, { amount: "0" })), true);
  [{ amount: 250000 }, { fedapay_transaction_id: "123" }, { status: "pending" }, { status: "failed" }, { product_type: "salon" }, { product_type: "digital_product" }]
    .forEach((x) => assert.strictEqual(PL.isInstitutPlace(Object.assign({}, base, x)), false, JSON.stringify(x)));
  assert.strictEqual(PL.isInstitutPlace(null), false);
  // la liste affichée reste celle des achats payés : la place apparaît comme n'importe quel achat payé
  assert.strictEqual(PL.visiblePurchases([Object.assign({ course_id: "f1", created_at: "2026-11-18T10:00:00Z" }, base)]).length, 1);
});

// ---------- garde-fous statiques ----------
const FILES = ["institut.html", "institut-demande.html", "institut-place.html", "admin/institut.html", "institut-page.js", "institut-demande.js", "institut-place.js",
  "institut-utils.js", "institut-demande-utils.js", "institut-place-utils.js", "purchase-list.js"];
function code(f) { return read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1"); }

test("aucun innerHTML (ni outerHTML, insertAdjacentHTML, document.write, eval) dans les fichiers nouveaux ou modifiés de l'Institut", () => {
  FILES.forEach((f) => assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/.test(code(f)), f));
  assert.ok(code("admin/institut.html").length > 15000, "le contrôle lit bien du code");
});

test("aucune mention « Saint-Louis » ; « SAYÉ LOUIS » / « Sayé Louis » bien orthographiés ; aucune donnée personnelle réelle", () => {
  FILES.concat(["institut-places.sql", "institut-places-rollback.sql", "institut-places-verification.sql"]).forEach((f) => {
    const t = read(f);
    assert.ok(!/saint[\s-]*louis/i.test(t), f);
    assert.ok(!/\bSAYE\b|\bSaye\b/.test(t), f);
    (t.match(/Institut\s+SAY[ÉEé]\s+LOUIS|Institut\s+Sayé\s+Louis/gi) || []).forEach((m) => assert.strictEqual(m.replace(/\s+/g, " "), "Institut SAYÉ LOUIS", f + " : " + m));
    assert.ok(!/(\+\d{6,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|sk_(live|test)_|whsec_)/.test(t), f + " : donnée sensible");
  });
});

test("index.html : la carte « Institut SAYÉ LOUIS » reste .disabled, « Bientôt disponible », sans lien ; les pages restent noindex ; interrupteur « ouvert » intact", () => {
  const index = read("index.html");
  assert.ok(!/institut[a-z-]*\.html/.test(index));
  const m = /<div class="card module-card disabled">((?:(?!<div class="card)[\s\S])*?<h2>Institut SAYÉ LOUIS<\/h2>[\s\S]*?<div class="go">Bientôt disponible<\/div>)\s*<\/div>/.exec(index);
  assert.ok(m && !/<a\b|onclick/.test(m[1]));
  ["institut.html", "institut-demande.html", "institut-place.html", "admin/institut.html"].forEach((f) => assert.match(read(f), /<meta name="robots" content="noindex">/, f));
  const admin = read("admin/institut.html");
  assert.match(admin, /U\.openValue\(next\)/); assert.match(admin, /saveContent\("ouvert"/);
  assert.match(read("institut-page.js"), /U\.isOpenValue\(value\)/);
});

test("aucun fichier ajouté dans api/ (12 fonctions) et api/fedapay-*.js non modifiés : pas de paiement dans cette PR", () => {
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js")).sort();
  assert.deepStrictEqual(list("api"), ["_attachment-rules.js", "_brand.js", "_cloudinary-og.js", "_entreprise-abonnement.js", "_entreprise-og.js", "_institut-paiement.js", "_roles.js", "_room-og.js", "_salon-abonnement.js", "_serigraphie.js",
    "attachment.js", "course.js", "digital-products-download.js", "fedapay-checkout.js", "fedapay-webhook.js", "produit-og.js", "push.js", "share-finalize.js", "share-pending.js", "share-target.js"]);
  assert.deepStrictEqual(list("api/admin"), ["list-users.js", "user-action.js"]);
  const functions = list("api").filter((f) => !f.startsWith("_")).concat(list("api/admin").map((f) => "admin/" + f));
  assert.strictEqual(functions.length, 12, "limite Vercel Hobby");
  // PR 4 : les deux fichiers FedaPay n'ont qu'une branche déléguée chacun vers le helper (pas de logique d'argent ici).
  assert.match(read("api/fedapay-checkout.js"), /productType === "institut"[\s\S]{0,200}handleInstitutCheckout\(req, res\)/);
  assert.match(read("api/fedapay-webhook.js"), /handleInstitutWebhook\(supabaseAdmin, \{ transactionId, officialStatus, officialAmount, log \}\)/);
  // purchase-list.js lit la colonne fedapay_transaction_id pour reconnaître une place (affichage) : il n'initie aucun paiement.
  // PR 4 : seuls institut-demande.js/.html (boutons de paiement) et admin/institut.html (onglet « Paiements », lecture seule)
  // parlent de paiement ; les autres pages et scripts de l'Institut n'en initient aucun.
  const PAIEMENT_OK = ["purchase-list.js", "institut-demande.js", "institut-demande.html", "admin/institut.html"];
  FILES.filter((f) => PAIEMENT_OK.indexOf(f) === -1).forEach((f) => assert.ok(!/fedapay|checkout/i.test(code(f)), f + " : aucun paiement"));
  assert.ok(!/fedapay-checkout/i.test(code("admin/institut.html")), "l'administration n'initie aucun paiement");
});

test("institut.html : « En chiffres » masquée par défaut, lien discret « J'ai un code d'invitation » sous le bouton (hors de la zone remplacée), scripts dans l'ordre", () => {
  const html = read("institut.html");
  assert.match(html, /<section id="chiffres" hidden>/);
  assert.ok(html.includes("En chiffres") && html.includes("places financées par des dons") && html.includes("élèves formés") && html.includes("Ces chiffres ne contiennent aucun nom."));
  assert.match(html, /id="cta-zone">[\s\S]*?<\/div>\s*<p class="code-link"><a href="institut-place\.html">J'ai un code d'invitation<\/a><\/p>/);
  const zone = /<div class="cta-zone" id="cta-zone">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.ok(!/institut-place/.test(zone), "le lien n'est pas dans la zone que le script remplace");
  assert.match(html, /<table id="tarif-table">/);
  assert.ok(html.includes("250&nbsp;000&nbsp;FCFA") && html.includes("50&nbsp;000&nbsp;FCFA"), "tableau statique conservé");
  assert.ok(html.indexOf("institut-utils.js") < html.indexOf("institut-place-utils.js") && html.indexOf("institut-place-utils.js") < html.indexOf("institut-page.js"));
  const js = read("institut-page.js");
  assert.match(js, /client\.rpc\("institut_stats"\)/);
  assert.match(js, /\.select\("formation_id, prix_institut, ordre, formations\(nom, prix, promotion\)"\)\s*\.eq\("actif", true\)/);
  assert.ok(!/console\./.test(code("institut-page.js")));
});

test("institut-demande : formations lues dans institut_formations (repli constant), « Mes demandes » avec place, code en évidence, bouton Copier, consigne", () => {
  const js = read("institut-demande.js"), html = read("institut-demande.html");
  assert.match(js, /\.from\("institut_formations"\)\s*\.select\("formation_id, prix_institut, ordre, formations\(nom, prix, promotion\)"\)\s*\.eq\("actif", true\)/);
  assert.match(js, /var formationList = U\.FORMATIONS;/);
  assert.match(js, /D\.validateDemande\(\{[\s\S]*?\}, formationList\)/);
  assert.match(js, /from\("institut_places"\)\.select\("demande_id, code, reclamee_le"\)\.in\("demande_id", validated\)/);
  ["Place accordée", "Place utilisée", "Validée : la place est en cours d'attribution.", "Donnez ce code à l'orphelin : il le saisira sur son propre compte.", "Copier"]
    .forEach((t) => assert.ok(js.includes(t), t));
  assert.match(js, /P\.formatCode\(place\.code\)/);
  assert.ok(!/console\./.test(code("institut-demande.js")));
  assert.ok(html.indexOf("institut-demande-utils.js") < html.indexOf("institut-place-utils.js") && html.indexOf("institut-place-utils.js") < html.indexOf("institut-demande.js"));
  assert.match(html, /\.guide \.code \{[^}]*font-size: 24px/, "code en évidence");
});

test("institut-place.html : saisie du code (majuscules automatiques, espaces et tirets acceptés), appel de institut_reclamer_place, lien vers la formation, connexion existante", () => {
  const html = read("institut-place.html"), js = read("institut-place.js");
  const input = /<input type="text" id="f-code"[^>]*>/.exec(html)[0];
  ['autocapitalize="characters"', 'autocomplete="off"', 'spellcheck="false"', 'autocorrect="off"'].forEach((a) => assert.ok(input.includes(a), a));
  assert.match(html, /text-transform: uppercase/);
  assert.ok(html.includes("Utilisez le compte de l'élève."));
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ["config.js", "pseudo.js", "login-sheet.js", "institut-utils.js", "institut-place-utils.js", "institut-place.js"].forEach((f) => assert.ok(srcs.includes(f), f));
  assert.ok(srcs.indexOf("institut-place-utils.js") < srcs.indexOf("institut-place.js"));
  assert.ok(!/<script>/.test(html), "aucun script en ligne");
  assert.match(js, /supabase\.rpc\("institut_reclamer_place", \{ p_code: check\.code \}\)/);
  assert.match(js, /P\.formatCode\(el\.value\)/);
  assert.match(js, /P\.claimOutcome\(res\.data\)/);
  assert.match(js, /P\.formationUrl\(outcome\.formationId\)/);
  assert.match(js, /is_anonymous !== true/);
  assert.match(js, /window\.MahoutoLogin\.open\(\{/);
  assert.ok(!/console\./.test(code("institut-place.js")) && !/location\.(search|hash)|history\./.test(code("institut-place.js")), "le code n'est jamais écrit dans la console ni dans l'adresse");
  assert.ok(!/Math\.random/.test(js));
});

test("admin/institut.html : onglets Formations et Dons, attribution par la fonction, aucun upsert sur institut_formations, prix contrôlé, copie du code, aucune lecture d'e-mail", () => {
  const html = read("admin/institut.html");
  ["tab-demandes", "tab-formations", "tab-dons", "tab-petits-fils", "tab-textes", "panel-formations", "panel-dons"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  assert.match(html, /const TABS = \["demandes", "formations", "dons", "petits-fils", "paiements", "textes"\]/);
  assert.match(html, /ADMIN_ROLES\.indexOf\(profile\.role\) === -1\)[\s\S]*access-denied/);
  assert.match(html, /supabase\.rpc\("institut_attribuer_place", \{ p_demande: d\.id, p_formation: fSel\.value, p_source: source, p_don: source === "don" \? donSel\.value : null \}\)/);
  assert.match(html, /if \(activeIds\.indexOf\(d\.formation\) !== -1\) fSel\.value = d\.formation;/, "présélection de la formation de la demande");
  assert.match(html, /P\.placesRestantes\(x, refs\.usedByDon\[x\.id\] \|\| 0\) > 0/, "seuls les dons avec des places restantes");
  assert.match(html, /P\.validatePrixInstitut\(raw, academie\)/);
  assert.ok(!/from\("institut_formations"\)\s*\.upsert|upsert\([^)]*formation_id/.test(html), "pas d'upsert : la base n'autorise la mise à jour que de certaines colonnes");
  assert.match(html, /\.from\("institut_formations"\)\.update\(\{ prix_institut: v\.value, actif: toggle\.checked \}\)/);
  assert.match(html, /\.from\("institut_formations"\)\.insert\(\{ formation_id: f\.id/);
  assert.match(html, /supabase\.from\("institut_dons"\)\.insert\(v\.value\)/);
  assert.ok(html.includes("Proposer à l'Institut") && html.includes("Attribuer une place") && html.includes("Copier") && html.includes("Enregistrer le don"));
  assert.ok((html.match(/confirm\(/g) || []).length >= 6, "confirmation avant chaque action");
  assert.ok(!/\.email|list-users|"email"|full_name/.test(html));
  assert.match(html, /select\("id, username"\)/);
  assert.ok(html.includes("Le nom du donateur et le montant restent dans l'administration"), "dons privés");
  assert.match(html, /if \(name === "dons"\) loadDons\(\);\s+if \(name === "formations"\) loadFormations\(\);/, "onglets Dons et Formations rafraîchis à l'ouverture (places utilisées à jour après une attribution)");
  assert.ok(!/institut_dons[^;\n]*public|publi[^;\n]*institut_dons/i.test(read("institut-page.js") + read("institut-demande.js") + read("institut-place.js")), "aucune page publique ne lit les dons");
  [/institut_dons/, /\bdonateur\b/].forEach((re) => ["institut.html", "institut-page.js", "institut-demande.js", "institut-demande.html", "institut-place.js", "institut-place.html"].forEach((f) => assert.ok(!re.test(code(f)), f + " ne lit ni n'affiche les dons (" + re + ")")));
});

test("mes-achats.html : une place Institut s'affiche « Place Institut SAYÉ LOUIS » (et non « 0 FCFA · Acheté le ») ; admin/statistiques.html ne calcule aucun revenu et reste intact", () => {
  const html = read("mes-achats.html");
  assert.match(html, /MahoutoPurchaseList\.isInstitutPlace\(purchase\) \? "Place Institut SAYÉ LOUIS · accordée le " \+ formatDate\(purchase\.created_at\) : money\(purchase\.amount\) \+ " · Acheté le "/);
  assert.strictEqual((html.match(/Place Institut SAYÉ LOUIS/g) || []).length, 1, "seule la ligne des formations est concernée");
  assert.ok(html.includes('<script src="purchase-list.js"></script>'));
  const stats = read("admin/statistiques.html");
  assert.ok(!/purchases|amount|revenu|chiffre d'affaires/i.test(stats), "aucun total d'achats ni revenu dans statistiques.html");
});

test("service worker : nouvelles pages et scripts publics en cache hors ligne, version ≥ v112, page admin non mise en cache (convention)", () => {
  const sw = read("sw.js");
  const shell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  ["/institut.html", "/institut-demande.html", "/institut-place.html", "/institut-page.js", "/institut-utils.js", "/institut-demande-utils.js", "/institut-demande.js", "/institut-place.js", "/institut-place-utils.js", "/purchase-list.js"]
    .forEach((f) => assert.ok(shell.includes('"' + f + '"'), f));
  assert.ok(!/admin\/institut/.test(shell));
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 112);
});
