/* Demande de parrainage de l'Institut SAYÉ LOUIS (PR 2) : validation pure (institut-demande-utils.js, institut-utils.js),
   comportement de institut-page.js dans un faux DOM, et garde-fous statiques des pages et des scripts.
   Exécution : node --test tests/institut-demande.test.js — aucune dépendance, aucun réseau, aucune base.
   Toutes les valeurs sont FICTIVES (aucun nom, téléphone, e-mail ou identifiant réel). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const U = require("../institut-utils");
const D = require("../institut-demande-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const UID = "11111111-2222-4333-8444-555555555555";
const RID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ok = (o) => Object.assign({ prenom: "Awa", age: "12", lien: "parent", formation: "serigraphie", motif: "" }, o || {});

// ---------- validation de la demande ----------
test("demande valide : valeurs nettoyées, âge converti en nombre", () => {
  const r = D.validateDemande(ok({ prenom: "  Jean-Paul ", age: " 12 ", motif: "  Il aime dessiner.  " }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { prenom: "Jean-Paul", age: 12, lien: "parent", formation: "serigraphie", motif: "Il aime dessiner." });
});

test("prénom : 1 à 40 lettres (accents, tiret, apostrophe) ; refuse chiffres, adresse, téléphone, vide, trop long", () => {
  ["Awa", "Élodie", "Jean-Paul", "N'Dri", "Marie Claire", "Zoé"].forEach((p) => assert.strictEqual(D.validateDemande(ok({ prenom: p })).ok, true, p));
  assert.strictEqual(D.validateDemande(ok({ prenom: "a".repeat(40) })).ok, true);
  ["", "   ", "a".repeat(41), "Awa2", "awa@exemple.test", "01 23 45 67 89", "<b>Awa</b>", "Awa/Koffi", "-Awa", "Awa;drop", null, undefined].forEach((p) => {
    const r = D.validateDemande(ok({ prenom: p }));
    assert.strictEqual(r.ok, false, String(p)); assert.ok(r.errors.prenom, String(p));
  });
  assert.match(D.validateDemande(ok({ prenom: "awa@exemple.test" })).errors.prenom, /Ne saisissez que le prénom/);
});

test("âge : entier de 3 à 35 ; refuse le reste avec un message", () => {
  ["3", "12", "35", " 18 ", 7].forEach((a) => assert.strictEqual(D.validateDemande(ok({ age: a })).ok, true, String(a)));
  ["2", "36", "0", "-3", "12.5", "12,5", "abc", "", "1e1", "1000", null, undefined].forEach((a) => {
    const r = D.validateDemande(ok({ age: a })); assert.strictEqual(r.ok, false, String(a)); assert.ok(r.errors.age, String(a));
  });
});

test("lien et formation : seulement les valeurs de la liste ; « lui-même » seulement si majeur", () => {
  U.LIENS.forEach(([code]) => { if (code !== "lui_meme") assert.strictEqual(D.validateDemande(ok({ lien: code })).ok, true, code); });
  ["", "cousin", "PARENT", "parent ", null, undefined, 3].forEach((l) => assert.ok(D.validateDemande(ok({ lien: l })).errors.lien, String(l)));
  assert.strictEqual(D.validateDemande(ok({ lien: "lui_meme", age: "17" })).ok, false);
  assert.match(D.validateDemande(ok({ lien: "lui_meme", age: "17" })).errors.lien, /majeur/);
  assert.strictEqual(D.validateDemande(ok({ lien: "lui_meme", age: "18" })).ok, true);
  assert.strictEqual(D.validateDemande(ok({ lien: "lui_meme", age: "30" })).ok, true);
  assert.deepStrictEqual(U.FORMATIONS, [["serigraphie", "Sérigraphie"]]);
  ["", "informatique", "serigraphie2", null].forEach((f) => assert.ok(D.validateDemande(ok({ formation: f })).errors.formation, String(f)));
});

test("motif : facultatif, 500 caractères au plus ; caractères de contrôle retirés", () => {
  assert.strictEqual(D.validateDemande(ok({ motif: "" })).ok, true);
  assert.strictEqual(D.validateDemande(ok({ motif: undefined })).value.motif, "");
  assert.strictEqual(D.validateDemande(ok({ motif: "a".repeat(500) })).ok, true);
  const long = D.validateDemande(ok({ motif: "a".repeat(501) }));
  assert.strictEqual(long.ok, false); assert.match(long.errors.motif, /500/);
  assert.strictEqual(D.validateDemande(ok({ motif: "bonjour" + String.fromCharCode(1) + "!" })).value.motif, "bonjour!");
  // les émojis comptent pour un caractère, comme char_length() en base
  assert.strictEqual(D.validateDemande(ok({ motif: "😀".repeat(500) })).ok, true);
});

test("saisie absente ou aberrante : refus sans exception, toutes les erreurs signalées", () => {
  [null, undefined, "texte", 42, {}].forEach((x) => { let r; assert.doesNotThrow(() => { r = D.validateDemande(x); }); assert.strictEqual(r.ok, false); });
  const r = D.validateDemande({});
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ["age", "formation", "lien", "prenom"]);
});

// ---------- justificatif ----------
test("justificatif : types autorisés (JPEG, PNG, WebP, PDF), 5 Mo au plus, facultatif", () => {
  assert.deepStrictEqual(D.validateFile(null), { ok: true, none: true });
  [["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["application/pdf", "pdf"], ["IMAGE/JPEG", "jpg"]].forEach(([type, ext]) => {
    const r = D.validateFile({ type, size: 1000, name: "x" }); assert.strictEqual(r.ok, true, type); assert.strictEqual(r.ext, ext);
  });
  ["image/gif", "image/svg+xml", "text/html", "application/zip", "application/x-msdownload", "", undefined, "image/jpeg; x=1", "__proto__", "toString"].forEach((type) => {
    const r = D.validateFile({ type, size: 1000 }); assert.strictEqual(r.ok, false, String(type)); assert.match(r.error, /Format non accepté/);
  });
  assert.strictEqual(D.validateFile({ type: "application/pdf", size: 5 * 1024 * 1024 }).ok, true);
  const big = D.validateFile({ type: "application/pdf", size: 5 * 1024 * 1024 + 1 });
  assert.strictEqual(big.ok, false); assert.match(big.error, /5 Mo/);
  [0, -1, NaN, undefined].forEach((size) => assert.strictEqual(D.validateFile({ type: "image/png", size }).ok, false, String(size)));
  assert.strictEqual(D.MAX_FILE_BYTES, 5242880);
  assert.strictEqual(D.BUCKET, "institut-justificatifs");
});

test("identifiant, nom aléatoire et chemin de stockage <uid>/<id>/<aléatoire>.<ext>", () => {
  const fake = { randomUUID: () => RID, getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 17 + 3) & 255; return a; } };
  assert.strictEqual(D.newId(fake), RID);
  const viaBytes = D.newId({ getRandomValues: fake.getRandomValues });
  assert.ok(D.isUuid(viaBytes) && viaBytes[14] === "4" && "89ab".includes(viaBytes[19]), "UUID v4 construit : " + viaBytes);
  assert.strictEqual(D.newId(null), null); assert.strictEqual(D.newId({}), null);
  const rnd = D.randomName(fake);
  assert.ok(/^[0-9a-f]{32}$/.test(rnd)); assert.strictEqual(D.randomName(null), null);
  assert.strictEqual(D.storagePath(UID, RID, "jpg", rnd), UID + "/" + RID + "/" + rnd + ".jpg");
  // chemin refusé si un élément est invalide (pas de remontée de dossier, pas d'extension exotique)
  [["../x", RID, "jpg", rnd], [UID, "../../x", "jpg", rnd], [UID, RID, "exe", rnd], [UID, RID, "jpg", "../../a"], [UID, RID, "jpg", "abc"], [UID, RID, "JPG", rnd], [null, RID, "jpg", rnd], [UID, RID, "jpg/x", rnd]]
    .forEach((a) => assert.strictEqual(D.storagePath(...a), null, JSON.stringify(a)));
  // le nom d'origine du fichier n'est jamais utilisé : seul un nom aléatoire est possible
  assert.ok(D.storagePath.length === 4);
});

test("messages d'erreur clairs en français (réseau, limite de 5 demandes, fichier, fermé, base)", () => {
  assert.match(D.errorMessage({ message: "Failed to fetch" }, "insert"), /Pas de connexion/);
  assert.match(D.errorMessage({ message: "Vous avez déjà 5 demandes en attente. Patientez…" }, "insert"), /5 demandes en attente/);
  assert.match(D.errorMessage({ message: "The object exceeded the maximum allowed size" }, "upload"), /5 Mo/);
  assert.match(D.errorMessage({ message: "mime type image/gif is not supported" }, "upload"), /Format de fichier non accepté/);
  assert.match(D.errorMessage({ message: "boom" }, "upload"), /envoi du justificatif a échoué/);
  assert.match(D.errorMessage({ code: "42501", message: "new row violates row-level security policy" }, "insert"), /pas ouvert aux demandes/);
  assert.match(D.errorMessage({ code: "23514", message: "check" }, "insert"), /pas valide/);
  assert.match(D.errorMessage({ message: "autre" }, "insert"), /n'a pas pu être enregistrée/);
  assert.ok(D.errorMessage(null, "insert").length > 10);
  // aucun message ne reprend le texte technique brut
  assert.ok(!/boom|autre/.test(D.errorMessage({ message: "boom autre" }, "insert")));
});

test("écran affiché : connexion, fermé, formulaire ; un admin peut déposer avant l'ouverture", () => {
  assert.strictEqual(D.viewState({ signedIn: false, open: true, isAdmin: false }), "login");
  assert.strictEqual(D.viewState(null), "login");
  assert.strictEqual(D.viewState({ signedIn: true, open: false, isAdmin: false }), "closed");
  assert.strictEqual(D.viewState({ signedIn: true, open: true, isAdmin: false }), "form");
  assert.strictEqual(D.viewState({ signedIn: true, open: false, isAdmin: true }), "form");
  assert.strictEqual(D.viewState({ signedIn: true, open: "oui", isAdmin: false }), "closed", "seul true ouvre");
});

// ---------- logique partagée (institut-utils.js) ----------
test("textes : paragraphes séparés par une ligne vide, limite de 5000 caractères, vide accepté", () => {
  assert.deepStrictEqual(U.paragraphs("A\n\nB\n\n\n\nC"), ["A", "B", "C"]);
  assert.deepStrictEqual(U.paragraphs("A\r\n\r\nB"), ["A", "B"]);
  assert.deepStrictEqual(U.paragraphs("ligne 1\nligne 2\n\nB"), ["ligne 1\nligne 2", "B"]);
  assert.deepStrictEqual(U.paragraphs(""), []); assert.deepStrictEqual(U.paragraphs("  \n\n  "), []); assert.deepStrictEqual(U.paragraphs(null), []);
  assert.strictEqual(U.validateHistoire("a".repeat(5000)).ok, true);
  const long = U.validateHistoire("a".repeat(5001)); assert.strictEqual(long.ok, false); assert.match(long.error, /5001 caractères pour 5000/);
  assert.deepStrictEqual(U.validateHistoire(""), { ok: true, value: "", count: 0 });
  assert.strictEqual(U.validateHistoire("a" + String.fromCharCode(0) + "b").value, "ab");
  assert.strictEqual(U.validateHistoire(12).ok, false);
  assert.strictEqual(U.HISTOIRE_MAX, 5000);
});

test("raison du refus (1 à 300), recherche d'utilisateur (jokers échappés), ouverture, filtres, libellés", () => {
  assert.strictEqual(U.validateRefus("").ok, false); assert.strictEqual(U.validateRefus("   ").ok, false);
  assert.strictEqual(U.validateRefus("Dossier incomplet").value, "Dossier incomplet");
  assert.strictEqual(U.validateRefus("a".repeat(300)).ok, true); assert.strictEqual(U.validateRefus("a".repeat(301)).ok, false);
  assert.strictEqual(U.searchTerm("a").ok, false); assert.strictEqual(U.searchTerm("a".repeat(41)).ok, false);
  assert.strictEqual(U.searchTerm(" ab ").pattern, "%ab%");
  assert.strictEqual(U.searchTerm("a_b%c").pattern, "%a\\_b\\%c%");
  assert.strictEqual(U.isOpenValue("oui"), true);
  ["non", "", "OUI", "true", null, undefined, 1].forEach((v) => assert.strictEqual(U.isOpenValue(v), false, String(v)));
  assert.strictEqual(U.openValue(true), "oui"); assert.strictEqual(U.openValue(false), "non");
  const rows = [{ cle: "ouvert", valeur: "oui" }, { cle: "histoire", valeur: "H" }];
  assert.strictEqual(U.contentValue(rows, "histoire"), "H"); assert.strictEqual(U.contentValue(rows, "x"), undefined); assert.strictEqual(U.contentValue(null, "x"), undefined);
  const list = [{ statut: "en_attente" }, { statut: "validee" }, { statut: "en_attente" }, { statut: "refusee" }];
  assert.strictEqual(U.filterByStatut(list, "en_attente").length, 2); assert.strictEqual(U.filterByStatut(list, "").length, 4);
  assert.deepStrictEqual(U.countByStatut(list), { en_attente: 2, validee: 1, refusee: 1 });
  assert.deepStrictEqual([U.statutLabel("en_attente"), U.statutLabel("validee"), U.statutLabel("refusee")], ["En attente", "Validée", "Refusée"]);
  assert.strictEqual(U.lienLabel("parent"), "Parent"); assert.strictEqual(U.formationLabel("serigraphie"), "Sérigraphie");
  assert.strictEqual(U.formatDate("2026-11-18T10:00:00Z").length, 10); assert.strictEqual(U.formatDate("nimportequoi"), "—");
});

// ---------- institut-page.js dans un faux DOM ----------
function fakeDom() {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.parent = null; this._text = ""; this.className = ""; this.href = ""; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
    set textContent(v) { this.children.forEach((c) => { c.parent = null; }); this.children = []; this._text = String(v); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    querySelectorAll(sel) { const out = []; (function walk(n) { n.children.forEach((c) => { if (c.tagName === sel) out.push(c); walk(c); }); })(this); return out; }
  }
  const make = (tag, text) => { const n = new Node(tag); if (text) n._text = text; return n; };
  const section = make("section"); section.appendChild(make("h2", "Notre histoire")); section.appendChild(make("p", "STATIQUE 1")); section.appendChild(make("p", "STATIQUE 2"));
  const notice = make("p", "Projet en préparation"), zone = make("div"); const btn = make("button", "Demander un parrainage"); zone.appendChild(btn); zone.appendChild(make("p", "Bientôt disponible"));
  const body = make("main"); [notice, section, zone].forEach((n) => body.appendChild(n));
  const byId = { histoire: section, "notice-prepa": notice, "cta-zone": zone };
  const created = [];
  const document = { getElementById: (id) => byId[id] || null, createElement: (tag) => { const n = make(tag); created.push(n); return n; } };
  return { document, body, section, notice, zone, created };
}
async function runPage(result) {
  const dom = fakeDom();
  const calls = [];
  const client = { from: (t) => ({ select: (c) => { calls.push([t, c]); return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); } }) };
  const win = { InstitutUtils: U, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => client } };
  const sandbox = { window: win, document: dom.document };
  vm.runInNewContext(read("institut-page.js"), sandbox);
  await new Promise((r) => setImmediate(r));
  return Object.assign(dom, { calls });
}
const texts = (section) => section.querySelectorAll("p").map((p) => p.textContent);

test("institut-page.js : lit institut_contenus ; histoire modifiée → paragraphes en textContent ; 'oui' → cadre retiré et lien actif", async () => {
  const d = await runPage({ data: [{ cle: "histoire", valeur: "Premier.\n\nSecond." }, { cle: "ouvert", valeur: "oui" }], error: null });
  assert.deepStrictEqual(d.calls, [["institut_contenus", "cle, valeur"]]);
  assert.deepStrictEqual(texts(d.section), ["Premier.", "Second."]);
  assert.strictEqual(d.section.children[0].textContent, "Notre histoire", "le titre est conservé");
  assert.ok(!d.body.children.includes(d.notice), "cadre « Projet en préparation » retiré");
  assert.strictEqual(d.zone.children.length, 1);
  assert.deepStrictEqual([d.zone.children[0].tagName, d.zone.children[0].className, d.zone.children[0].href, d.zone.children[0].textContent], ["a", "cta", "institut-demande.html", "Demander un parrainage"]);
});

test("institut-page.js : 'non' ou absent → comportement d'origine (bouton grisé « Bientôt disponible », cadre conservé)", async () => {
  for (const rows of [[{ cle: "ouvert", valeur: "non" }], [{ cle: "histoire", valeur: "Texte" }], []]) {
    const d = await runPage({ data: rows, error: null });
    assert.ok(d.body.children.includes(d.notice), "cadre conservé"); assert.strictEqual(d.zone.children[0].tagName, "button"); assert.strictEqual(d.zone.children[1].textContent, "Bientôt disponible");
  }
});

test("institut-page.js : lecture en échec ou texte vide → la page GARDE son texte statique", async () => {
  for (const res of [{ data: null, error: { message: "hors ligne" } }, new Error("réseau"), { data: [{ cle: "histoire", valeur: "   \n\n  " }, { cle: "ouvert", valeur: "oui" }], error: null }, { data: "n'importe quoi", error: null }]) {
    let d; await assert.doesNotReject(async () => { d = await runPage(res); });
    if (!(res.data && Array.isArray(res.data))) {
      assert.deepStrictEqual(texts(d.section), ["STATIQUE 1", "STATIQUE 2"]);
      assert.ok(d.body.children.includes(d.notice), "cadre conservé"); assert.strictEqual(d.zone.children[0].tagName, "button");
    } else assert.deepStrictEqual(texts(d.section), ["STATIQUE 1", "STATIQUE 2"], "texte vide : texte d'origine");
  }
});

test("institut-page.js : un texte contenant du HTML reste du TEXTE (jamais interprété)", async () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const d = await runPage({ data: [{ cle: "histoire", valeur: evil }], error: null });
  assert.deepStrictEqual(texts(d.section), [evil]);
  assert.deepStrictEqual(d.created.map((n) => n.tagName).sort(), ["p"], "seul un <p> est créé : aucune balise issue du texte");
});

test("institut-page.js : sans configuration ou sans client Supabase, la page reste statique (aucune erreur)", () => {
  const dom = fakeDom();
  assert.doesNotThrow(() => vm.runInNewContext(read("institut-page.js"), { window: { InstitutUtils: U }, document: dom.document }));
  assert.doesNotThrow(() => vm.runInNewContext(read("institut-page.js"), { window: {}, document: dom.document }));
  assert.deepStrictEqual(texts(dom.section), ["STATIQUE 1", "STATIQUE 2"]);
});

// ---------- garde-fous statiques des pages et scripts ----------
const NEW_FILES = ["institut.html", "institut-demande.html", "admin/institut.html", "institut-page.js", "institut-demande.js", "institut-utils.js", "institut-demande-utils.js"];

// Code sans commentaires : les commentaires expliquent la règle (« jamais innerHTML ») sans l'enfreindre.
function code(f) {
  return read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}
test("aucun innerHTML (ni outerHTML, insertAdjacentHTML, document.write, eval) dans les pages et scripts de l'Institut", () => {
  NEW_FILES.forEach((f) => {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/.test(code(f)), f);
  });
  assert.ok(code("institut-page.js").length > 500 && code("admin/institut.html").length > 5000, "le contrôle lit bien du code");
});

test("institut.html garde son texte statique complet (sans JavaScript) : histoire, cadre, étapes, tarif, bouton « Bientôt disponible »", () => {
  const html = read("institut.html");
  assert.ok(/<section id="histoire">\s*<h2>Notre histoire<\/h2>\s*<p>L'Institut SAYÉ LOUIS a été créé par le fondateur de MAHOUTO\+, Mahouto Abdallah, en mémoire de son père, Sayé Louis\.<\/p>\s*<p>Très tôt/.test(html));
  assert.match(html, /id="notice-prepa"><strong>Projet en préparation\.<\/strong>/);
  assert.match(html, /<button type="button" class="cta" disabled aria-disabled="true"[^>]*>Demander un parrainage<\/button>/);
  assert.match(html, /<p class="cta-note" id="cta-note">Bientôt disponible<\/p>/);
  assert.ok(html.includes("250&nbsp;000&nbsp;FCFA") && html.includes("50&nbsp;000&nbsp;FCFA"));
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.ok(html.indexOf("institut-utils.js") < html.indexOf("institut-page.js"), "ordre de chargement");
});

test("index.html : la carte « Institut SAYÉ LOUIS » reste .disabled, « Bientôt disponible », non cliquable, sans lien", () => {
  const index = read("index.html");
  assert.ok(!/institut(-demande)?\.html/.test(index), "aucun lien vers les pages de l'Institut");
  const m = /<div class="card module-card disabled">((?:(?!<div class="card)[\s\S])*?<h2>Institut SAYÉ LOUIS<\/h2>[\s\S]*?<div class="go">Bientôt disponible<\/div>)\s*<\/div>/.exec(index);
  assert.ok(m, "carte .disabled");
  assert.ok(!/<a\b|onclick/.test(m[1]));
});

test("institut-demande.html : noindex, avertissement « prénom seulement », champs attendus, aucun champ de paiement ni de photo", () => {
  const html = read("institut-demande.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.ok(html.includes("Ne saisissez que le prénom de l'enfant.") && html.includes("Les informations restent privées."));
  ["f-prenom", "f-age", "f-lien", "f-formation", "f-motif", "f-fichier"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.ok(!/(f-nom\b|f-adresse|f-telephone|f-email|type="tel"|type="email"|capture=)/.test(html), "pas de nom de famille, adresse, téléphone, e-mail ni capture photo");
  assert.ok(!/(fedapay|paiement|payer|montant)/i.test(html), "rien de payant dans cette PR");
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ["config.js", "pseudo.js", "login-sheet.js", "institut-utils.js", "institut-demande-utils.js", "institut-demande.js"].forEach((f) => assert.ok(srcs.includes(f), f));
  assert.ok(srcs.indexOf("institut-utils.js") < srcs.indexOf("institut-demande-utils.js") && srcs.indexOf("institut-demande-utils.js") < srcs.indexOf("institut-demande.js"));
  assert.ok(!/<script>/.test(html), "aucun script en ligne");
});

test("institut-demande.js : justificatif envoyé AVANT la ligne, chemin <uid>/<id>/<aléatoire>.<ext>, nettoyage si l'insertion échoue, message « fermé »", () => {
  const js = read("institut-demande.js");
  assert.ok(js.indexOf("storage.from(D.BUCKET).upload(") < js.indexOf('from("institut_demandes").insert('), "fichier avant ligne");
  assert.match(js, /D\.storagePath\(user\.id, id, fileCheck\.ext, D\.randomName\(window\.crypto\)\)/);
  assert.match(js, /D\.newId\(window\.crypto\)/);
  assert.ok(!/Math\.random/.test(js));
  assert.match(js, /if \(path\) \{ try \{ await supabase\.storage\.from\(D\.BUCKET\)\.remove\(\[path\]\); \} catch/);
  assert.match(js, /upsert: false/);
  assert.match(js, /statut: "en_attente"/);
  assert.ok(!/console\./.test(js), "aucune donnée dans la console");
  assert.ok(read("institut-demande.html").includes("L'Institut n'est pas encore ouvert aux demandes."));
  assert.ok(read("institut-demande.html").includes("Vous êtes admis d'office au tarif Institut."));
  assert.match(js, /is_anonymous !== true/);
});

test("admin/institut.html : accès réservé (refusé sinon), 3 onglets, justificatif en URL signée de 60 s, confirmations, aucun e-mail affiché", () => {
  const html = read("admin/institut.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.ok(html.includes("Accès réservé aux administrateurs.") && html.includes('const ADMIN_ROLES = ["admin", "super_admin", "founder"]'));
  assert.match(html, /ADMIN_ROLES\.indexOf\(profile\.role\) === -1\)[\s\S]*access-denied/);
  ["tab-demandes", "tab-petits-fils", "tab-textes"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  assert.match(html, /createSignedUrl\(d\.justificatif_path, 60\)/);
  assert.ok((html.match(/confirm\(/g) || []).length >= 5, "confirmation avant chaque action");
  assert.ok(!/\.email|list-users|"email"/.test(html), "aucune adresse e-mail n'est lue ni affichée");
  assert.match(html, /select\("id, username"\)/, "seul le pseudo des profils est lu");
  assert.ok(!/full_name/.test(html), "le nom légal complet n'est jamais lu");
  assert.match(html, /U\.HISTOIRE_MAX/);
  ["Valider", "Refuser", "Voir le justificatif", "Marquer petit-fils", "Ouvrir l'Institut aux demandes"].forEach((t) => assert.ok(html.includes(t), t));
});

test("lien « Institut » ajouté dans les pages d'administration existantes", () => {
  ["formations", "produits", "rooms", "statistiques", "users", "signalements"].forEach((f) => {
    const html = read("admin/" + f + ".html");
    assert.strictEqual((html.match(/href="institut\.html"/g) || []).length, 1, f);
  });
  assert.match(read("admin/signalements.html"), /href="institut\.html" data-admin-only>Institut<\/a>/, "caché aux modérateurs non admins");
});

test("service worker : pages et scripts publics de l'Institut en cache hors ligne, version ≥ v110 ; page admin non mise en cache (convention)", () => {
  const sw = read("sw.js");
  const shell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  ["/institut.html", "/institut-demande.html", "/institut-page.js", "/institut-utils.js", "/institut-demande-utils.js", "/institut-demande.js"].forEach((f) => assert.ok(shell.includes('"' + f + '"'), f));
  assert.ok(!/admin\/institut/.test(shell), "les autres pages admin ne sont pas dans APP_SHELL");
  assert.ok(!/"\/admin\//.test(shell));
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 110);
});

test("orthographe : « SAYÉ LOUIS » / « Sayé Louis », jamais « Saint-Louis » ; aucune donnée personnelle réelle", () => {
  NEW_FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/saint[\s-]*louis/i.test(t.replace(/\/saint\[\\s-\]\*louis\/i|saint\[\\s-\]\*louis/g, "")), f);
    assert.ok(!/\bSAYE\b|\bSaye\b/.test(t), f + " : « Sayé » sans accent");
    (t.match(/Institut\s+SAY[ÉEé]\s+LOUIS|Institut\s+Sayé\s+Louis/gi) || []).forEach((m) => assert.strictEqual(m.replace(/\s+/g, " "), "Institut SAYÉ LOUIS", f + " : " + m));
    assert.ok(!/(\+\d{6,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|sk_(live|test)_|whsec_)/.test(t), f + " : donnée sensible");
  });
});
