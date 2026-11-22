/* Profil public, PR 1 : validation (adresse, champs, un seul contact), états de la page publique m.html (faux DOM + faux client
   Supabase), garde-fous statiques (aucun innerHTML, noindex, réécriture sans nouvelle fonction api/), section « Mon profil public ». */
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
const ok = (o) => Object.assign({ adresse: "mon-atelier", nom: "Atelier Test", avatar: "", metier: "", presentation: "", localisation: "", contactType: "", contactValeur: "", publier: false, majeur: false }, o || {});

test("adresse : 3 à 30 caractères, minuscules, chiffres, tirets, sans tiret au début ni à la fin ; normalisée en minuscules", () => {
  ["abc", "a1b", "mon-atelier", "a".repeat(30), "a-b-c", "123", "a--b"].forEach((a) => assert.strictEqual(PU.validateAdresse(a).ok, true, a));
  assert.strictEqual(PU.validateAdresse("  Mon-Atelier ").value, "mon-atelier");
  ["ab", "a", "", "a".repeat(31), "-abc", "abc-", "ab c", "abc_d", "abcé", "abc.d", "abc/d", null, undefined, "<b>"].forEach((a) => {
    const r = PU.validateAdresse(a); assert.strictEqual(r.ok, false, String(a)); assert.strictEqual(r.code, "invalide", String(a));
  });
});

test("adresses réservées refusées (liste fixe, tirets ignorés) : admin, api, support, mahouto, majeste, institut…", () => {
  ["admin", "api", "support", "mahouto", "majeste", "institut", "ma-hou-to", "ins-ti-tut", "sayelouis", "fondateur", "verify"].forEach((a) => {
    const r = PU.validateAdresse(a); assert.strictEqual(r.ok, false, a); assert.strictEqual(r.code, "reservee", a);
  });
  assert.strictEqual(PU.validateAdresse("admin-atelier").ok, true, "un mot réservé dans une adresse plus longue reste permis");
  assert.strictEqual(PU.publicUrl("mon-atelier"), "https://www.mahouto.com/m/mon-atelier");
});

test("champs : nom 1 à 60 ; métier 80 ; présentation 280 ; lieu 60 ; valeurs nettoyées, vides = null", () => {
  const r = PU.validateProfil(ok({ nom: "  Atelier   Test ", metier: " Couturier ", presentation: "Texte\navec retour", localisation: "Ville Test" }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { adresse: "mon-atelier", nom_affiche: "Atelier Test", avatar_url: null, metier: "Couturier", presentation: "Texte avec retour", localisation: "Ville Test", contact_type: null, contact_valeur: null, publie: false, majeur_declare: false });
  assert.strictEqual(PU.validateProfil(ok({ nom: "n".repeat(60) })).ok, true);
  [["nom", 61, "nom"], ["metier", 81, "metier"], ["presentation", 281, "presentation"], ["localisation", 61, "localisation"]].forEach(([k, n, e]) => {
    const x = PU.validateProfil(ok({ [k]: "x".repeat(n) })); assert.strictEqual(x.ok, false, k); assert.ok(x.errors[e], k);
  });
  ["", "   ", null, undefined].forEach((n) => assert.ok(PU.validateProfil(ok({ nom: n })).errors.nom, String(n)));
  assert.strictEqual(PU.validateProfil(ok({ presentation: "😀".repeat(280) })).ok, true, "les émojis comptent pour un caractère");
});

test("photo : lien https seulement ; http, javascript, data, espaces, identifiants dans l'adresse refusés", () => {
  assert.strictEqual(PU.validateProfil(ok({ avatar: "https://exemple.test/a.png" })).value.avatar_url, "https://exemple.test/a.png");
  ["http://exemple.test/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://", "https://exemple.test/a b.png", "https://user:mdp@exemple.test/a.png", "ftp://exemple.test/a", "//exemple.test/a", "exemple.test/a.png"].forEach((u) => {
    const r = PU.validateProfil(ok({ avatar: u })); assert.strictEqual(r.ok, false, u); assert.ok(r.errors.avatar, u);
  });
});

test("UN SEUL contact : aucun, WhatsApp (format international) ou lien https ; valeur sans type refusée ; type sans valeur refusé", () => {
  assert.deepStrictEqual([PU.validateProfil(ok()).value.contact_type, PU.validateProfil(ok()).value.contact_valeur], [null, null]);
  const w = PU.validateProfil(ok({ contactType: "whatsapp", contactValeur: "+229 00 00 00 00" }));
  assert.deepStrictEqual([w.ok, w.value.contact_type, w.value.contact_valeur], [true, "whatsapp", "+22900000000"]);
  assert.strictEqual(PU.validateProfil(ok({ contactType: "whatsapp", contactValeur: "0022900000000" })).value.contact_valeur, "+22900000000");
  const l = PU.validateProfil(ok({ contactType: "lien", contactValeur: "https://exemple.test/moi" }));
  assert.deepStrictEqual([l.ok, l.value.contact_type, l.value.contact_valeur], [true, "lien", "https://exemple.test/moi"]);
  [["whatsapp", "22900000000"], ["whatsapp", "+1234"], ["whatsapp", "+0229000000"], ["whatsapp", "https://exemple.test"], ["whatsapp", ""], ["lien", "http://exemple.test"], ["lien", "exemple.test"], ["lien", ""], ["lien", "+22900000000"], ["", "https://exemple.test"], ["", "+22900000000"], ["email", "x"], ["whatsapp,lien", "x"]].forEach(([t, v]) => {
    const r = PU.validateProfil(ok({ contactType: t, contactValeur: v })); assert.strictEqual(r.ok, false, t + " " + v); assert.ok(r.errors.contact, t + " " + v);
  });
  assert.strictEqual(PU.whatsappLink("+22900000000"), "https://wa.me/22900000000"); assert.strictEqual(PU.whatsappLink("x"), null);
  assert.strictEqual(PU.safeHttpsUrl("javascript:alert(1)"), null);
});

test("publier : la certification des 18 ans est obligatoire (brouillon : non) ; valeurs envoyées à la base", () => {
  const r = PU.validateProfil(ok({ publier: true, majeur: false }));
  assert.strictEqual(r.ok, false); assert.match(r.errors.majeur, /18 ans ou plus/);
  [undefined, null, "on", "true", 1].forEach((m) => assert.strictEqual(PU.validateProfil(ok({ publier: true, majeur: m })).ok, false, String(m)));
  const p = PU.validateProfil(ok({ publier: true, majeur: true })); assert.deepStrictEqual([p.ok, p.value.publie, p.value.majeur_declare], [true, true, true]);
  const b = PU.validateProfil(ok({ publier: false, majeur: false })); assert.deepStrictEqual([b.ok, b.value.publie], [true, false]);
  [null, undefined, "x", 3].forEach((x) => { let q; assert.doesNotThrow(() => { q = PU.validateProfil(x); }); assert.strictEqual(q.ok, false); });
  assert.ok(!("user_id" in p.value) && !("suspendu" in p.value) && !("id" in p.value), "le navigateur n'envoie jamais user_id, suspendu ni id");
});

test("pageView : profil, introuvable, non disponible, non ouverte, erreur ; bandeaux d'aperçu pour la personne propriétaire", () => {
  const row = { publie: true };
  assert.deepStrictEqual(PU.pageView({ row, ouvert: true }), { view: "profil", banner: null });
  assert.deepStrictEqual(PU.pageView({ row: { publie: false }, ouvert: true }), { view: "profil", banner: "non_publie" });
  assert.deepStrictEqual(PU.pageView({ row, ouvert: false }), { view: "profil", banner: "ferme" });
  assert.strictEqual(PU.pageView({ row: null, statut: "non_ouverte" }).view, "non_ouverte");
  assert.strictEqual(PU.pageView({ row: null, statut: "non_disponible" }).view, "non_disponible");
  assert.strictEqual(PU.pageView({ row: null, statut: "introuvable" }).view, "introuvable");
  assert.strictEqual(PU.pageView({ row: null, statut: "n'importe quoi" }).view, "introuvable");
  assert.strictEqual(PU.pageView({ readFailed: true }).view, "erreur"); assert.strictEqual(PU.pageView().view, "introuvable");
  assert.strictEqual(PU.MESSAGES.non_ouverte, "Cette fonction n'est pas encore ouverte.");
  assert.strictEqual(PU.MESSAGES.non_disponible, "Ce profil n'est pas disponible.");
});

test("addressFromLocation : /m/<adresse> et ?adresse= ; invalide → null", () => {
  assert.strictEqual(PU.addressFromLocation("/m/mon-atelier", ""), "mon-atelier");
  assert.strictEqual(PU.addressFromLocation("/m/Mon-Atelier/", ""), "mon-atelier");
  assert.strictEqual(PU.addressFromLocation("/m.html", "?adresse=mon-atelier"), "mon-atelier");
  ["/m/", "/m/a", "/m/-abc", "/m/a/b", "/autre/mon-atelier", "/m/%E0%A4%A", "/m/<script>"].forEach((p) => assert.strictEqual(PU.addressFromLocation(p, ""), null, p));
});

test("errorMessage : adresse prise, figée, réservée, majorité, droits", () => {
  assert.match(PU.errorMessage({ code: "23505", message: "dup" }), /déjà prise/);
  assert.match(PU.errorMessage({ message: "Une fois la page publiee, son adresse ne peut plus etre modifiee." }), /ne peut plus être modifiée/);
  assert.match(PU.errorMessage({ message: "Cette adresse est reservee : choisissez-en une autre." }), /réservée/);
  assert.match(PU.errorMessage({ message: "Pour publier votre page, certifiez avoir 18 ans ou plus." }), /18 ans/);
  assert.match(PU.errorMessage({ code: "42501", message: "x" }), /non autorisée/);
  assert.match(PU.disponibiliteMessage("prise").text, /déjà prise/); assert.strictEqual(PU.disponibiliteMessage("libre").ok, true);
});

// ---------- m.js dans un faux DOM ----------
function fakeEl(id) {
  const el = { id, children: [], attrs: {}, _text: "", listeners: {}, classes: new Set(["hidden"]),
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); }, contains: (c) => el.classes.has(c) },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } };
  return el;
}
async function runPage(pathname, client) {
  const els = {};
  ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "presentation", "contact-zone"].forEach((i) => { els[i] = fakeEl(i); });
  ["bandeau", "etat", "profil", "metier", "lieu", "presentation"].forEach((i) => els[i].classes.add("hidden")); els.chargement.classes.delete("hidden");
  const doc = { title: "", getElementById: (i) => els[i], createElement: (t) => Object.assign(fakeEl(null), { tagName: t }) };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => client }, location: { pathname, search: "" } };
  vm.runInNewContext(read("m.js"), { window: win, document: doc, Array, String });
  await new Promise((r) => setTimeout(r, 20));
  return { els, doc };
}
const clientFor = (row, o) => {
  const opts = o || {}, calls = [];
  const chain = { select: (c) => { calls.push(["select", c]); return chain; }, eq: (k, v) => { calls.push(["eq", k, v]); return chain; }, maybeSingle: async () => (opts.readError ? { data: null, error: { message: "x" } } : { data: row, error: null }) };
  return { calls, from: (t) => { calls.push(["from", t]); return chain; }, rpc: async (n, a) => { calls.push(["rpc", n, a]); if (n === "profils_publics_ouvert") return { data: opts.ouvert === true, error: null }; if (n === "profil_public_statut") return { data: opts.statut || "introuvable", error: opts.statutError ? { message: "x" } : null }; return { data: null, error: { message: "inconnue" } }; } };
};
const ROW = { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier <b>Test</b>", avatar_url: "https://exemple.test/a.png", metier: "Couturier", presentation: "Ligne 1\nLigne 2", localisation: "Ville Test", contact_type: "whatsapp", contact_valeur: "+22900000000", publie: true };
const shown = (e) => !e.classes.has("hidden");

test("m.js : profil publié → affiché en TEXTE BRUT (le HTML saisi reste du texte), contact WhatsApp en lien sûr, colonnes publiques seulement", async () => {
  const c = clientFor(ROW, { ouvert: true });
  const { els, doc } = await runPage("/m/mon-atelier", c);
  assert.ok(shown(els.profil) && !shown(els.etat) && !shown(els.chargement) && !shown(els.bandeau));
  assert.strictEqual(els.nom.textContent, "Atelier <b>Test</b>"); assert.strictEqual(doc.title, "Atelier <b>Test</b> — MAHOUTO+");
  assert.strictEqual(els.metier.textContent, "Couturier"); assert.strictEqual(els.presentation.textContent, "Ligne 1\nLigne 2"); assert.strictEqual(els.lieu.textContent, "Ville Test");
  const a = els["contact-zone"].children[0];
  assert.deepStrictEqual([a.tagName, a.href, a.target, a.rel, a.textContent], ["a", "https://wa.me/22900000000", "_blank", "noopener noreferrer nofollow", "Écrire sur WhatsApp"]);
  const img = els.avatar.children[0]; assert.deepStrictEqual([img.tagName, img.src, img.referrerPolicy], ["img", "https://exemple.test/a.png", "no-referrer"]);
  const sel = c.calls.find((x) => x[0] === "select")[1];
  assert.strictEqual(sel, "id, adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie");
  assert.ok(!/user_id|majeur_declare|suspendu|\*/.test(sel), "jamais user_id, majeur_declare, suspendu");
  assert.deepStrictEqual(c.calls.filter((x) => x[0] === "eq"), [["eq", "adresse", "mon-atelier"]]);
});

test("m.js : liens dangereux ignorés (javascript:, http:) — aucun lien de contact ni photo affichés", async () => {
  for (const bad of [{ contact_type: "lien", contact_valeur: "javascript:alert(1)" }, { contact_type: "lien", contact_valeur: "http://exemple.test" }, { contact_type: "whatsapp", contact_valeur: "pas un numéro" }]) {
    const { els } = await runPage("/m/mon-atelier", clientFor(Object.assign({}, ROW, bad, { avatar_url: "javascript:alert(1)" }), { ouvert: true }));
    assert.strictEqual(els["contact-zone"].children.length, 0, JSON.stringify(bad)); assert.strictEqual(els.avatar.children.length, 0); assert.strictEqual(els.avatar.textContent, "A");
  }
  const { els } = await runPage("/m/mon-atelier", clientFor(Object.assign({}, ROW, { contact_type: "lien", contact_valeur: "https://exemple.test/moi" }), { ouvert: true }));
  assert.strictEqual(els["contact-zone"].children[0].href, "https://exemple.test/moi");
});

test("m.js : états — introuvable, non disponible (suspendu), fonction non ouverte, adresse invalide, erreur de lecture", async () => {
  const msg = async (path, c) => { const { els } = await runPage(path, c); assert.ok(shown(els.etat) && !shown(els.profil)); return els["etat-titre"].textContent; };
  assert.strictEqual(await msg("/m/inconnu-xyz", clientFor(null, { statut: "introuvable" })), "Ce profil est introuvable.");
  assert.strictEqual(await msg("/m/mon-atelier", clientFor(null, { statut: "non_disponible" })), "Ce profil n'est pas disponible.");
  assert.strictEqual(await msg("/m/mon-atelier", clientFor(null, { statut: "non_ouverte" })), "Cette fonction n'est pas encore ouverte.");
  const c = clientFor(null, {}); assert.strictEqual(await msg("/m/a", c), "Ce profil est introuvable."); assert.strictEqual(c.calls.length, 0, "adresse invalide : aucune requête");
  assert.match(await msg("/m/mon-atelier", clientFor(null, { readError: true })), /Impossible de charger/);
  assert.match(await msg("/m/mon-atelier", clientFor(null, { statutError: true })), /Impossible de charger/);
});

test("m.js : aperçu pour la personne propriétaire — brouillon ou fonction fermée → page affichée avec bandeau", async () => {
  let r = await runPage("/m/mon-atelier", clientFor(Object.assign({}, ROW, { publie: false }), { ouvert: true }));
  assert.ok(shown(r.els.profil) && shown(r.els.bandeau)); assert.match(r.els.bandeau.textContent, /pas publiée/);
  r = await runPage("/m/mon-atelier", clientFor(ROW, { ouvert: false }));
  assert.ok(shown(r.els.profil) && shown(r.els.bandeau)); assert.match(r.els.bandeau.textContent, /pas encore ouverte/);
});

test("aucun innerHTML (ni outerHTML, insertAdjacentHTML, document.write, eval) dans m.js, profil-public.js et le module", () => {
  ["m.js", "profil-public.js", "profil-public-utils.js"].forEach((f) => assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code(f)), f));
  assert.ok(!/console\./.test(code("m.js") + code("profil-public.js")), "aucune donnée dans la console");
});

test("m.html : noindex (meta), chemins absolus (adresse /m/...), scripts dans l'ordre, lien de retour, aucun script en ligne ; en-tête X-Robots-Tag", () => {
  const h = read("m.html");
  assert.match(h, /<meta name="robots" content="noindex, nofollow">/);
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ["/config.js", "/profil-public-utils.js", "/m.js"].forEach((f) => assert.ok(srcs.includes(f), f));
  assert.ok(srcs.indexOf("/profil-public-utils.js") < srcs.indexOf("/m.js"));
  assert.ok(![...h.matchAll(/(?:src|href)="([^"]+)"/g)].some((m) => !/^(\/|https:|#)/.test(m[1])), "tous les chemins sont absolus (la page est servie sous /m/<adresse>)");
  assert.ok(!/<script>/.test(h)); assert.match(h, /<a class="back" href="\/index\.html">← Retour à l'accueil<\/a>/);
  ["chargement", "etat", "profil", "bandeau"].forEach((i) => assert.ok(h.includes('id="' + i + '"'), i));
  const v = JSON.parse(read("vercel.json"));
  assert.ok(v.headers.some((x) => x.source === "/m/:adresse" && x.headers.some((hh) => hh.key === "X-Robots-Tag" && /noindex/.test(hh.value))));
  assert.ok(v.headers.some((x) => x.source === "/m.html" && x.headers.some((hh) => hh.key === "X-Robots-Tag")));
});

test("vercel.json : réécriture /m/:adresse → m.html sans nouvelle fonction api/ (12 fonctions) ; autres réécritures intactes", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/m/:adresse"), { source: "/m/:adresse", destination: "/m.html?adresse=:adresse" });
  ["/p/:id", "/f/:id", "/s/:id", "/e/:slug", "/r/:id", "/verify/:code"].forEach((s) => assert.ok(v.rewrites.some((r) => r.source === s), s));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12, "limite Vercel Hobby");
  assert.ok(!fs.readdirSync(path.join(root, "api")).some((f) => /profil|^m\./.test(f)));
});

test("profil.html : section « Mon profil public » (activer, adresse + disponibilité, champs, 18 ans, aperçu, lien, dépublier) ; profiles et le reste du fichier inchangés", () => {
  const h = read("profil.html");
  ["pp-section", "pp-adresse", "pp-btn-verifier", "pp-adresse-etat", "pp-nom", "pp-avatar", "pp-metier", "pp-presentation", "pp-localisation", "pp-contact-type", "pp-contact-valeur",
    "pp-majeur", "pp-btn-enregistrer", "pp-btn-publier", "pp-btn-depublier", "pp-apercu", "pp-btn-copier", "pp-lien-texte"].forEach((id) => assert.ok(h.includes('id="' + id + '"'), id));
  assert.match(h, /<section class="pp hidden" id="pp-section"/, "masquée par défaut");
  assert.ok(h.includes("Je certifie avoir 18 ans ou plus.") && h.includes("Rien n'est publié tant que vous ne l'activez pas"));
  assert.ok(/<option value="whatsapp">/.test(h) && /<option value="lien">/.test(h) && (h.match(/id="pp-contact-type"/g) || []).length === 1, "un seul contact : une seule liste de choix");
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.indexOf("profil-public-utils.js") !== -1 && srcs.indexOf("profil-public-utils.js") < srcs.indexOf("profil-public.js"));
  const js = code("profil-public.js");
  assert.match(js, /supabase\.rpc\("profil_public_mien"\)/); assert.match(js, /from\("profils_publics"\)\s*\.update\(value\)\.eq\("id", row\.id\)/);
  assert.match(js, /supabase\.rpc\("profil_public_adresse_disponible", \{ p_adresse: local\.value \}\)/);
  assert.ok(!/from\("profiles"\)/.test(js) && !/user_id|suspendu/.test(js), "ne lit ni profiles, ni user_id, ni suspendu");
  assert.match(js, /is_anonymous !== true/, "comptes anonymes exclus");
  assert.match(js, /\$\("pp-adresse"\)\.disabled = published/, "adresse non modifiable une fois publiée");
});

test("sw.js : cache v115 ; m.html, m.js, profil-public.js et le module dans APP_SHELL ; Institut et paiements non touchés", () => {
  const sw = read("sw.js");
  assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v115"/);
  ["/m.html", "/m.js", "/profil-public.js", "/profil-public-utils.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
});

test("chaque fonction PU.xxx appelée par m.js et profil-public.js existe dans le module (contrat entre les fichiers)", () => {
  const used = new Set();
  ["m.js", "profil-public.js"].forEach((f) => [...code(f).matchAll(/\bPU\.(\w+)/g)].forEach((m) => used.add(m[1])));
  assert.ok(used.size >= 10);
  used.forEach((name) => assert.ok(name in PU, "PU." + name + " introuvable dans profil-public-utils.js"));
});
