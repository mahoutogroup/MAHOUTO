/* Partage d'un salon payant : texte de partage (room-share.js, chat.html), aperçu du lien (api/_room-og.js, api/produit-og.js) et
   messages d'API vouvoyés (api/fedapay-checkout.js, api/_salon-abonnement.js). Aucun réseau, aucune base. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const A = require("../salon-accroche");
const Share = require("../room-share");
const Og = require("../api/_room-og.js");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const L = "\\p{L}";
const TUT = new RegExp(`(?<![${L}])(ton|ta|tes|toi|tu|t'[${L}]+|[${L}]+-toi|connecte|connecte-[${L}]+|rejoins|choisis|réessaie|copie-le|saisis|clique|vérifie|attends)(?![${L}])`, "iu");
const FCFA = (n) => Number(n).toLocaleString("fr-FR") + " FCFA";
const ACC = "Conseils, devis et entraide entre sérigraphes du Bénin";

// ====================== texte de partage ======================
test("le texte de partage VOUVOIE (« Rejoignez ») dans tous les cas, et la marque reste MAHOUTO+", () => {
  [{ name: "Bassam YACOUBOU", is_paid: true, price: 500 }, { name: "S", is_paid: true, abonnement: true, forfait_min: 200 }, { name: "G", is_paid: false }, {}, { is_paid: true }, { name: "X", is_paid: true, accroche: ACC }]
    .forEach((room) => { const m = Share.buildMessage(room); assert.ok(m.includes("Rejoignez « "), m); assert.ok(!TUT.test(m), "tutoiement : " + m); assert.ok(m.includes("sur MAHOUTO+"), m); assert.ok(!/MAJEST/i.test(m)); });
  assert.strictEqual(Share.buildMessage({ name: "Bassam YACOUBOU", is_paid: true, price: 500 }), "Rejoignez « Bassam YACOUBOU » sur MAHOUTO+ (communauté payante : " + FCFA(500) + ").");
});

test("mode ABONNEMENT : « à partir de » le plus petit forfait actif ; jamais le prix à vie ; sans forfait connu, aucun prix chiffré", () => {
  const m = Share.buildMessage({ name: "Salon", is_paid: true, price: 2000, abonnement: true, forfait_min: 200 });
  assert.strictEqual(m, "Rejoignez « Salon » sur MAHOUTO+ (communauté payante : à partir de " + FCFA(200) + ").");
  assert.ok(!m.includes(FCFA(2000)) && !m.includes("2000"), "le prix à vie n'est jamais annoncé en mode abonnement");
  [undefined, null, 0, -5, 1.5, "abc", NaN].forEach((v) => { const t = Share.buildMessage({ name: "Salon", is_paid: true, price: 2000, abonnement: true, forfait_min: v }); assert.strictEqual(t, "Rejoignez « Salon » sur MAHOUTO+ (communauté payante, sur abonnement).", String(v)); assert.ok(!/\d/.test(t), "aucun prix chiffré : " + t); });
  assert.strictEqual(Share.priceText({ is_paid: true, abonnement: true, forfait_min: 200 }), "à partir de " + FCFA(200));
});

test("mode PRIX À VIE (comme avant) et salon GRATUIT : le prix à vie, ou aucun prix", () => {
  assert.strictEqual(Share.buildMessage({ name: "VIP", is_paid: true, price: 2000 }), "Rejoignez « VIP » sur MAHOUTO+ (communauté payante : " + FCFA(2000) + ").");
  assert.strictEqual(Share.buildMessage({ name: "VIP", is_paid: true, price: 2000, abonnement: false, forfait_min: 200 }), "Rejoignez « VIP » sur MAHOUTO+ (communauté payante : " + FCFA(2000) + ").", "le forfait n'intervient jamais hors abonnement");
  assert.strictEqual(Share.buildMessage({ name: "VIP", is_paid: true, price: null }), "Rejoignez « VIP » sur MAHOUTO+.");
  assert.strictEqual(Share.buildMessage({ name: "Libre", is_paid: false, price: 500, forfait_min: 200 }), "Rejoignez « Libre » sur MAHOUTO+.", "aucun prix pour un salon gratuit");
});

test("l'accroche vient EN PREMIER ; absente → rien ; un lien dans l'accroche est ignoré ; le texte reste court", () => {
  const room = { name: "Salon", is_paid: true, abonnement: true, forfait_min: 200, accroche: ACC };
  assert.strictEqual(Share.buildMessage(room), ACC + "\nRejoignez « Salon » sur MAHOUTO+ (communauté payante : à partir de " + FCFA(200) + ").");
  assert.ok(Share.buildMessage(room).startsWith(ACC));
  [undefined, null, "", "  \n "].forEach((v) => assert.ok(!Share.buildMessage(Object.assign({}, room, { accroche: v })).includes("\n")));
  assert.ok(!Share.buildMessage(Object.assign({}, room, { accroche: "Voir https://piege.test" })).includes("piege"), "lien ignoré");
  assert.strictEqual(Share.buildMessage(Object.assign({}, room, { accroche: "Une\nphrase   sur\tdeux lignes" })).split("\n")[0], "Une phrase sur deux lignes", "texte nettoyé : une ligne");
  // longueur : nom de 80 caractères + accroche de 120 : coupée avec « … », jamais plus de MAX_TEXT, la phrase d'invitation reste entière
  const long = Share.buildMessage({ name: "N".repeat(300), is_paid: true, abonnement: true, forfait_min: 200, accroche: "a".repeat(120) });
  assert.ok(Array.from(long).length <= Share.MAX_TEXT, "longueur " + Array.from(long).length); assert.ok(long.endsWith("sur abonnement)." ) === false); assert.ok(long.includes("(communauté payante : à partir de " + FCFA(200) + ")."));
  const tight = Share.buildMessage({ name: "N".repeat(80), is_paid: true, abonnement: true, forfait_min: 200, accroche: "é".repeat(120) });
  assert.ok(Array.from(tight).length <= 260 && tight.includes("Rejoignez « " + "N".repeat(80) + " »"), "au plus 260 caractères : " + Array.from(tight).length);
  assert.ok(Array.from(Share.buildMessage({ name: "Salon", is_paid: true, accroche: ACC })).length < 200, "texte habituel : court");
});

test("sans salon-accroche.js (discussions.html) : aucune accroche, le reste du texte est inchangé", () => {
  const ctx = { globalThis: {}, window: undefined, module: { exports: {} } }; ctx.globalThis = ctx;
  vm.runInNewContext(read("room-share.js"), Object.assign(ctx, { encodeURIComponent, Number, String, Array, Math, Object, RegExp, Promise }));
  const S = ctx.module.exports;
  assert.strictEqual(S.buildMessage({ name: "Salon", is_paid: true, price: 500, accroche: ACC }), "Rejoignez « Salon » sur MAHOUTO+ (communauté payante : " + FCFA(500) + ").");
});

test("partage natif et WhatsApp : le texte, puis le lien à la fin ; la fenêtre de repli protège le nom de marque (data-brand-fixed) et vouvoie", async () => {
  const room = { id: "s-1", name: "Salon", is_paid: true, abonnement: true, forfait_min: 200, accroche: ACC };
  const calls = []; const win = { navigator: { share: async (a) => { calls.push(a); } } };
  assert.strictEqual(await Share.share({ room, win, doc: {} }), "native");
  assert.deepStrictEqual(calls, [{ title: "Salon", text: Share.buildMessage(room), url: "https://mahouto.com/r/s-1" }]);
  const u = Share.whatsappUrl(calls[0].text, calls[0].url); assert.ok(decodeURIComponent(u.split("text=")[1]).endsWith("\nhttps://mahouto.com/r/s-1"), "finit par le lien");
  const src = read("room-share.js"); assert.ok(src.includes('el(doc, "p", { class: "rs-text", "data-brand-fixed": "", text: text })'), "texte de la fenêtre protégé");
  assert.ok(src.includes('"Copie automatique impossible : le lien est sélectionné, copiez-le à la main."') && !src.includes("copie-le"), "message de repli vouvoyé");
  assert.ok(!TUT.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1").split('"').filter((_, i) => i % 2 === 1).filter((s) => /\p{L}{4}/u.test(s)).join(" | ")), "aucune chaîne tutoyée dans room-share.js");
});

// ====================== chat.html : plus petit forfait actif ======================
const CHAT = read("chat.html");
function prefetch(room, rep) {
  const log = [];
  const q = { select(c) { log.push(["select", c]); return q; }, order(k, o) { log.push(["order", k, o && o.ascending]); return q; },
    then(res, rej) { log.push(["await"]); return Promise.resolve(rep).then(res, rej); } };
  const supabase = { from: (t) => { log.push(["from", t]); return q; } };
  const src = CHAT.slice(CHAT.indexOf("let plansPromise = null;"), CHAT.indexOf("// Salon en abonnement, personne sans forfait")) + CHAT.slice(CHAT.indexOf("let forfaitMin = null;"), CHAT.indexOf("function shareRoom()"));
  const f = new Function("supabase", "room", "MahoutoSalonAbonnement", src + "\nreturn { run: () => prefetchForfaitMin(room), get min() { return forfaitMin; } };");
  const o = f(supabase, room, require("../salon-abonnement")); return { o, log, room };
}
const PLANS = [{ code: "jour", libelle: "Jour", jours: 1, montant: 500, ordre: 1 }, { code: "semaine", libelle: "Semaine", jours: 7, montant: 200, ordre: 2 }];
test("chat.html : le plus petit forfait ACTIF est lu à l'avance (lecture publique, aucune écriture), seulement pour un salon payant en abonnement", async () => {
  let t = prefetch({ is_paid: true, abonnement: true }, { data: PLANS, error: null }); await t.o.run();
  assert.strictEqual(JSON.stringify(t.log), JSON.stringify([["from", "salon_forfaits"], ["select", "code, libelle, jours, montant, ordre"], ["order", "ordre", true], ["await"]]));
  assert.strictEqual(t.o.min, 200, "le plus petit PRIX, pas le premier forfait");
  for (const room of [{ is_paid: false, abonnement: true }, { is_paid: true, abonnement: false }, { is_paid: true }, null]) { const x = prefetch(room, { data: PLANS, error: null }); await x.o.run(); assert.deepStrictEqual(x.log, [], "aucune requête"); assert.strictEqual(x.o.min, null); }
  for (const rep of [{ data: null, error: { message: "x" } }, { data: [], error: null }, { data: [{ code: "x", libelle: "X", jours: 1, montant: "abc" }], error: null }, { data: [{ code: "x", libelle: "X", jours: 1, montant: 0 }], error: null }, { data: [{ code: "x", libelle: "X", jours: 1, montant: 1.5 }], error: null }]) { const x = prefetch({ is_paid: true, abonnement: true }, rep); await x.o.run(); assert.strictEqual(x.o.min, null, JSON.stringify(rep)); }
  const bad = prefetch({ is_paid: true, abonnement: true }, Promise.reject(new Error("réseau"))); await assert.doesNotReject(bad.o.run()); assert.strictEqual(bad.o.min, null);
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(CHAT.slice(CHAT.indexOf("let plansPromise = null;"), CHAT.indexOf("function shareRoom()"))), "lecture seule");
  assert.ok(/forfait_min: forfaitMin/.test(CHAT) && /currentRoom = room;\s*prefetchForfaitMin\(room\);/.test(CHAT));
});

// ====================== aperçu du lien ======================
const meta = (html, key) => { const m = html.match(new RegExp('<meta (?:property|name)="' + key + '" content="([^"]*)"')); return m ? m[1] : null; };
const desc = (row) => Og.buildRoomPreview(row, "s-1").description;

test("aperçu : l'accroche devient la description (payant et gratuit) ; sinon une phrase par défaut VOUVOYÉE", () => {
  assert.strictEqual(desc({ name: "S", is_paid: true, price: 2000, accroche: ACC }), ACC + " — Communauté payante : " + FCFA(2000));
  assert.strictEqual(desc({ name: "S", is_paid: false, accroche: ACC }), ACC);
  assert.strictEqual(desc({ name: "S", is_paid: true, price: 2000 }), "Communauté payante : " + FCFA(2000) + " — Rejoignez cette communauté sur MAHOUTO+");
  assert.strictEqual(desc({ name: "S", is_paid: false }), "Rejoignez ce salon sur MAHOUTO+");
  [null, undefined, "", "  \n  "].forEach((v) => assert.ok(desc({ name: "S", is_paid: false, accroche: v }).startsWith("Rejoignez ce salon")));
  ["S", "T"].forEach((n) => assert.ok(!TUT.test(desc({ name: n, is_paid: true, price: 5 })) && !TUT.test(desc({ name: n, is_paid: false }))));
  assert.ok(!/Rejoins\b/.test(read("api/_room-og.js")), "plus aucun « Rejoins » dans _room-og.js");
});

test("aperçu : même règle de prix que le texte de partage (à partir de en abonnement, prix à vie sinon, rien si inconnu)", () => {
  assert.strictEqual(desc({ name: "S", is_paid: true, price: 2000, abonnement: true, forfait_min: 200 }), "Communauté payante : à partir de " + FCFA(200) + " — Rejoignez cette communauté sur MAHOUTO+");
  assert.strictEqual(desc({ name: "S", is_paid: true, price: 2000, abonnement: true, forfait_min: 200, accroche: ACC }), ACC + " — Communauté payante : à partir de " + FCFA(200));
  const sans = desc({ name: "S", is_paid: true, price: 2000, abonnement: true, forfait_min: null }); assert.strictEqual(sans, "Communauté payante, sur abonnement — Rejoignez cette communauté sur MAHOUTO+"); assert.ok(!/\d/.test(sans) && !sans.includes("2"), "jamais le prix à vie en abonnement");
  assert.strictEqual(desc({ name: "S", is_paid: true, price: 2000, abonnement: false, forfait_min: 200 }), "Communauté payante : " + FCFA(2000) + " — Rejoignez cette communauté sur MAHOUTO+");
  assert.ok(!/\d/.test(desc({ name: "S", is_paid: false, price: 500, forfait_min: 200 })), "aucun prix pour un salon gratuit");
  for (const room of [{ is_paid: true, price: 2000, abonnement: true, forfait_min: 200 }, { is_paid: true, price: 2000 }, { is_paid: true, abonnement: true }, { is_paid: false, price: 500 }]) assert.strictEqual(Og.roomPriceText(room), Share.priceText(room), "même règle des deux côtés : " + JSON.stringify(room));
});

test("aperçu : l'accroche est ÉCHAPPÉE pour le HTML et les attributs (guillemets, chevrons, esperluette, apostrophe), jamais interprétée", () => {
  const evil = "Conseils \"premium\" <b>gras</b> & 'x' \"><script>alert(1)</script>";
  const p = Og.buildRoomPreview({ name: "Salon", is_paid: false, accroche: evil }, "s-1");
  const html = Og.renderRoomPreviewPage(p);
  const sortie = "Conseils &quot;premium&quot; &lt;b&gt;gras&lt;/b&gt; &amp; &#39;x&#39; &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;";
  ["description", "og:description", "twitter:description"].forEach((k) => { const v = meta(html, k); assert.strictEqual(v, sortie, k); assert.ok(!/[<>"]/.test(v), "aucun caractère actif dans l'attribut " + k); });
  assert.ok(!html.includes("<script>alert(1)</script>") && !html.includes("<b>gras</b>") && !/content="[^"]*"[^>]*><script>alert/.test(html), "rien d'interprété");
  assert.strictEqual((html.match(/<script>/g) || []).length, 1, "un seul script : la redirection de la page");
  assert.ok(html.includes("<script>window.location.replace(" + JSON.stringify(p.targetUrl) + ");</script>"));
  assert.strictEqual(p.description, evil.replace(/\s+/g, " ").trim(), "la description brute reste du texte (échappé seulement à l'affichage)");
  // accroche « classique » avec esperluette
  assert.strictEqual(meta(Og.renderRoomPreviewPage(Og.buildRoomPreview({ name: "S", is_paid: false, accroche: "Devis & impression" }, "s-1")), "og:description"), "Devis &amp; impression");
});

test("aperçu : accroche coupée à 120 caractères, une seule ligne, sans lien ; l'aperçu ne montre rien de plus que l'écran verrouillé", () => {
  const d = desc({ name: "S", is_paid: false, accroche: "x".repeat(400) }); assert.strictEqual(Array.from(d).length, 120);
  assert.strictEqual(desc({ name: "S", is_paid: false, accroche: "a\n\nb\r\n\tc" }), "a b c");
  assert.strictEqual(Array.from(desc({ name: "S", is_paid: false, accroche: "é😀".repeat(100) })).length, 120, "caractères comptés, pas octets");
  ["https://piege.test", "voir www.exemple.fr", "mahouto.com/x"].forEach((l) => assert.strictEqual(desc({ name: "S", is_paid: false, accroche: l }), "Rejoignez ce salon sur MAHOUTO+", "lien ignoré : " + l));
  const html = Og.renderRoomPreviewPage(Og.buildRoomPreview({ name: "S", is_paid: true, price: 500, accroche: ACC, created_by: "00000000-0000-4000-8000-0000000000aa", user_id: "u", messages: "secret" }, "s-1"));
  assert.ok(!/0000000000aa|created_by|user_id|secret/.test(html), "aucune donnée privée");
});

test("api/produit-og.js : l'aperçu lit rooms (colonnes avec repli) puis le plus petit forfait ACTIF, avec la clé publique seulement", async () => {
  const og = read("api/produit-og.js");
  const src = og.slice(og.indexOf("async function fetchRoomForPreview"), og.indexOf("// ---------------------------------------------------------\n// Vitrines"));
  assert.ok(!/SERVICE_ROLE|service_role/i.test(src) && src.includes("process.env.SUPABASE_ANON_KEY"));
  const calls = [];
  const mk = (roomsRes, forfaitsRes) => ({ createClient: () => ({ from: (t) => { const st = { t }; const q = { select(c) { st.c = c; return q; }, eq() { return q; }, maybeSingle() { calls.push(["rooms", st.c]); return Promise.resolve(roomsRes(st.c)); }, gt() { return q; }, order() { return q; }, limit() { calls.push(["forfaits"]); return Promise.resolve(forfaitsRes); } }; return q; } }) });
  const run = (roomsRes, forfaitsRes) => { calls.length = 0; const f = new Function("createClient", "ROOM_FIELD_SETS", "process", src + "\nreturn fetchRoomForPreview;")(mk(roomsRes, forfaitsRes).createClient, Og.ROOM_FIELD_SETS, { env: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" } }); return f("s-1"); };
  let r = await run(() => ({ data: { name: "S", is_paid: true, price: 2000, abonnement: true, accroche: ACC }, error: null }), { data: [{ montant: 200 }], error: null });
  assert.strictEqual(r.row.forfait_min, 200); assert.strictEqual(r.row.accroche, ACC); assert.deepStrictEqual(calls.map((c) => c[0]), ["rooms", "forfaits"]);
  r = await run(() => ({ data: { name: "S", is_paid: true, price: 2000, abonnement: false }, error: null }), { data: [{ montant: 200 }], error: null });
  assert.strictEqual(r.row.forfait_min, null); assert.deepStrictEqual(calls.map((c) => c[0]), ["rooms"], "aucune lecture des forfaits hors abonnement");
  r = await run(() => ({ data: { name: "G", is_paid: false }, error: null }), null); assert.deepStrictEqual(calls.map((c) => c[0]), ["rooms"]);
  r = await run((c) => /accroche/.test(c) ? { data: null, error: { message: "column accroche does not exist" } } : { data: { name: "S", is_paid: true, abonnement: true }, error: null }, { data: [{ montant: 300 }], error: null });
  assert.strictEqual(r.row.forfait_min, 300); assert.deepStrictEqual(calls.filter((c) => c[0] === "rooms").map((c) => c[1]), Og.ROOM_FIELD_SETS.slice(0, 2), "repli : colonne accroche absente");
  r = await run(() => ({ data: { name: "S", is_paid: true, abonnement: true }, error: null }), { data: null, error: { message: "refusé" } }); assert.strictEqual(r.row.forfait_min, null, "forfaits illisibles : aucun prix chiffré");
  r = await run(() => ({ data: null, error: { message: "réseau" } }), null); assert.strictEqual(r.row, null); assert.ok(r.error);
});

// ====================== messages d'API vouvoyés ======================
test("API : les 6 messages tutoyés sont vouvoyés (avant → après), la logique est inchangée", () => {
  const co = read("api/fedapay-checkout.js"), sa = read("api/_salon-abonnement.js");
  [[co, "Connectez-vous avec Google ou votre e-mail pour acheter.", "Connecte-toi avec Google ou ton e-mail pour acheter."],
    [sa, "Choisissez un forfait.", "Choisis un forfait."], [sa, "Vous avez déjà accès à ce salon.", "Tu as déjà accès à ce salon."], [sa, "Vous avez déjà accès à vie à ce salon : aucun abonnement n'est nécessaire.", "Tu as déjà accès à vie à ce salon : aucun abonnement n'est nécessaire."],
    [sa, "Impossible d'enregistrer le paiement. Réessayez dans un instant.", "Impossible d'enregistrer le paiement. Réessaie dans un instant."]]
    .forEach(([f, apres, avant]) => { assert.ok(f.includes(apres), "absent : " + apres); assert.ok(!f.includes(avant), "tutoiement resté : " + avant); });
  assert.strictEqual((sa.match(/Vous avez déjà accès à ce salon\./g) || []).length, 2, "deux endroits (créateur, rôle privilégié)");
  assert.ok(co.includes('code: "ANONYMOUS_NOT_ALLOWED"') && /return res\.status\(403\)\.json\(\{\s*error: "Connectez-vous avec Google ou votre e-mail pour acheter\.",/.test(co), "même code, même statut");
  [co, sa].forEach((f) => { const chaines = [...f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1").matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\p{L}{4}/u.test(s) && /\s/.test(s)); assert.deepStrictEqual(chaines.filter((s) => TUT.test(s)), [], "chaînes tutoyées"); });
  assert.ok(sa.includes('fail(res, 409,') && sa.includes('fail(res, 400, "Choisissez un forfait.")'));
});

test("limites : aucun nouveau fichier dans api/ (12 fonctions), cache v138, aucune clé", () => {
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, "api")).filter((f) => f.startsWith("_")).sort(), ["_attachment-rules.js", "_brand.js", "_cloudinary-og.js", "_entreprise-abonnement.js", "_entreprise-og.js", "_institut-paiement.js", "_profil-og.js", "_roles.js", "_room-og.js", "_salon-abonnement.js", "_serigraphie.js"], "mêmes assistants qu'avant");
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(138|13[9]|1[4-9]\d)";/);
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci/.test(read("room-share.js") + read("salon-accroche.js")));
});
