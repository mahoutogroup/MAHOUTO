/* Abonnement des vitrines d'entreprise : visibilité, cumul des jours, paiement (checkout) et webhook FedaPay.
   Exécution : node tests/entreprise-abonnement.test.js — aucune dépendance, aucun réseau, aucune base.
   Le webhook réel (api/fedapay-webhook.js) est exécuté avec de FAUX modules « fedapay » et « @supabase/supabase-js »
   (dossier temporaire) ; la base est une maquette en mémoire qui reproduit le contrat des fonctions SQL
   (les fonctions SQL elles-mêmes sont vérifiées statiquement dans tests/entreprise-abonnement-sql.test.js).
   Toutes les valeurs sont FICTIVES. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const AB = require("../entreprise-abonnement");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

const NOW = Date.parse("2026-12-01T10:00:00Z");
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const ID = "123e4567-e89b-42d3-a456-426614174000";

// ---------- maquette en mémoire (contrat des fonctions SQL) ----------
function makeDb(seed) {
  const db = { entreprises: [], entreprise_forfaits: [], entreprise_paiements: [], purchases: [], serigraphie_orders: [], rpcCalls: [], inserts: [], now: NOW };
  Object.assign(db, seed || {});
  let n = 0;
  function builder(table) {
    const st = { f: [], op: "select", payload: null, head: false, count: false, order: null };
    const api = {
      select(cols, opts) { st.head = !!(opts && opts.head); st.count = !!(opts && opts.count); return api; },
      eq(c, v) { st.f.push(["eq", c, v]); return api; },
      gte(c, v) { st.f.push(["gte", c, v]); return api; },
      order(c, o) { st.order = [c, o && o.ascending !== false]; return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; },
      maybeSingle() { st.single = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function match(r) { return st.f.every(([k, c, v]) => (k === "eq" ? r[c] === v : String(r[c]) >= String(v))); }
    function run() {
      const rows = db[table] = db[table] || [];
      if (st.op === "insert") {
        db.inserts.push({ table, row: st.payload });
        if (db.failInsert === table) return { data: null, error: { message: "insert échoué" } };
        rows.push(Object.assign({ id: "row-" + (++n) }, st.payload));
        return { data: null, error: null };
      }
      let out = rows.filter(match);
      if (st.order) { const [c, asc] = st.order; out = out.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
      if (st.head) return { data: null, count: out.length, error: null };
      if (st.single) return { data: out[0] ? Object.assign({}, out[0]) : null, error: null };
      return { data: out.map((r) => Object.assign({}, r)), error: null };
    }
    return api;
  }
  // Reproduit entreprise_confirmer_paiement / entreprise_echouer_paiement (voir le SQL)
  function rpc(name, args) {
    db.rpcCalls.push({ name, args });
    if (db.failRpc === name) return Promise.resolve({ data: null, error: { message: "rpc échouée" } });
    const p = db.entreprise_paiements.find((x) => x.fedapay_transaction_id === args.p_transaction_id && x.source === "fedapay");
    if (name === "entreprise_echouer_paiement") {
      const ok = !!p && p.statut === "en_attente"; if (ok) p.statut = "echoue";
      return Promise.resolve({ data: ok, error: null });
    }
    if (name === "entreprise_confirmer_paiement") {
      if (!p) return Promise.resolve({ data: { resultat: "introuvable" }, error: null });
      if (p.statut === "confirme") return Promise.resolve({ data: { resultat: "deja_confirme" }, error: null });
      if (p.statut !== "en_attente") return Promise.resolve({ data: { resultat: "ignore" }, error: null });
      if (p.montant !== args.p_montant) { p.statut = "echoue"; return Promise.resolve({ data: { resultat: "montant_incoherent" }, error: null }); }
      p.statut = "confirme"; p.confirme_le = iso(db.now);
      const e = db.entreprises.find((x) => x.id === p.entreprise_id);
      e.expire_le = AB.extendExpiry(e.expire_le, p.jours, db.now);
      return Promise.resolve({ data: { resultat: "confirme", expire_le: e.expire_le }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: "fonction inconnue" } });
  }
  db.client = { from: builder, rpc };
  return db;
}
const fakeRes = () => ({ headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const FORFAITS = [
  { code: "1-jour", libelle: "1 jour", jours: 1, montant: 500, actif: true, ordre: 1 },
  { code: "7-jours", libelle: "7 jours", jours: 7, montant: 3000, actif: true, ordre: 2 },
  { code: "30-jours", libelle: "30 jours", jours: 30, montant: 10000, actif: true, ordre: 3 },
  { code: "ancien", libelle: "Ancien forfait", jours: 15, montant: 5000, actif: false, ordre: 4 }
];

(async () => {
  // ---------- visibilité ----------
  await test("visibilité : publiée+payée, expirée, offerte, non publiée", () => {
    const f = DAY;
    assert.strictEqual(AB.isVisible({ published: true, offerte: false, expire_le: iso(NOW + f) }, NOW), true, "publiée + payée");
    assert.strictEqual(AB.isVisible({ published: true, offerte: false, expire_le: iso(NOW - f) }, NOW), false, "expirée");
    assert.strictEqual(AB.isVisible({ published: true, offerte: false, expire_le: iso(NOW) }, NOW), false, "expire pile maintenant : plus visible");
    assert.strictEqual(AB.isVisible({ published: true, offerte: false, expire_le: null }, NOW), false, "jamais payée");
    assert.strictEqual(AB.isVisible({ published: true, offerte: true, expire_le: null }, NOW), true, "offerte sans date");
    assert.strictEqual(AB.isVisible({ published: true, offerte: true, expire_le: iso(NOW - f) }, NOW), true, "offerte même si ancienne date");
    assert.strictEqual(AB.isVisible({ published: false, offerte: true, expire_le: iso(NOW + f) }, NOW), false, "non publiée : jamais visible");
    assert.strictEqual(AB.isVisible({ published: false, offerte: false, expire_le: null }, NOW), false);
    assert.strictEqual(AB.isVisible(null, NOW), false);
  });
  await test("statut d'abonnement et temps restant affichés dans l'administration", () => {
    assert.strictEqual(AB.subscriptionStatus({ offerte: true }, NOW), "offerte");
    assert.strictEqual(AB.subscriptionStatus({ expire_le: iso(NOW + DAY) }, NOW), "active");
    assert.strictEqual(AB.subscriptionStatus({ expire_le: iso(NOW - 1) }, NOW), "expiree");
    assert.strictEqual(AB.subscriptionStatus({ expire_le: null }, NOW), "jamais_payee");
    assert.strictEqual(AB.remainingLabel({ expire_le: iso(NOW + 3 * DAY + 4 * 3600000) }, NOW), "Il reste 3 jours 4 heures");
    assert.strictEqual(AB.remainingLabel({ expire_le: iso(NOW + 90 * 60000) }, NOW), "Il reste 1 heure 30 minutes");
    assert.strictEqual(AB.remainingLabel({ expire_le: iso(NOW - 2 * DAY) }, NOW), "Expirée depuis 2 jours");
    assert.strictEqual(AB.remainingLabel({}, NOW), "Jamais payée");
  });

  // ---------- cumul des jours ----------
  await test("cumul : deux paiements successifs s'additionnent ; expirée → repart de maintenant", () => {
    const first = AB.extendExpiry(null, 7, NOW);
    assert.strictEqual(first, iso(NOW + 7 * DAY), "jamais payée : maintenant + 7 jours");
    const second = AB.extendExpiry(first, 30, NOW + 2 * DAY);
    assert.strictEqual(second, iso(NOW + 37 * DAY), "7 jours + 30 jours cumulés (à partir de l'ancienne date, pas de maintenant)");
    const third = AB.extendExpiry(second, 1, NOW + 2 * DAY);
    assert.strictEqual(third, iso(NOW + 38 * DAY));
    assert.strictEqual(AB.extendExpiry(iso(NOW - 10 * DAY), 7, NOW), iso(NOW + 7 * DAY), "expirée : repart de maintenant, pas de l'ancienne date");
    ["0", 0, -1, 1.5, 3651, "x", null].forEach((j) => assert.throws(() => AB.extendExpiry(null, j, NOW), /invalide/, String(j)));
  });

  // ---------- forfaits et liens ----------
  await test("forfaits : un forfait doit avoir des jours et un montant entiers > 0 ; achetable seulement si actif", () => {
    const ok = { code: "7-jours", libelle: "7 jours", jours: 7, montant: 3000, ordre: 1 };
    assert.strictEqual(AB.forfaitProblem(ok), null);
    [{ ...ok, code: "A B" }, { ...ok, libelle: "x" }, { ...ok, jours: 0 }, { ...ok, jours: 1.5 }, { ...ok, jours: 4000 }, { ...ok, montant: 0 }, { ...ok, montant: -5 }, { ...ok, montant: 12.5 }]
      .forEach((f) => assert.ok(AB.forfaitProblem(f), JSON.stringify(f)));
    assert.strictEqual(AB.isPurchasable({ ...ok, actif: true }), true);
    assert.strictEqual(AB.isPurchasable({ ...ok, actif: false }), false);
    assert.strictEqual(AB.isPurchasable({ ...ok, actif: true, montant: 0 }), false);
  });
  await test("lien de paiement : <site>/abonnement.html?v=<uuid>[&f=<code>] ; identifiant invalide refusé", () => {
    assert.strictEqual(AB.paymentLink("https://exemple.test/", ID, "7-jours"), "https://exemple.test/abonnement.html?v=" + ID + "&f=7-jours");
    assert.strictEqual(AB.paymentLink("https://exemple.test/", ID), "https://exemple.test/abonnement.html?v=" + ID);
    assert.strictEqual(AB.paymentLink("https://exemple.test/", ID, "Mauvais Code"), "https://exemple.test/abonnement.html?v=" + ID);
    assert.strictEqual(AB.paymentLink("https://exemple.test/", "pas-un-uuid"), null);
    assert.strictEqual(AB.paymentLink("https://exemple.test/", "' or 1=1"), null);
    const msg = AB.shareMessage("Boutique Fictive", "https://exemple.test/abonnement.html?v=" + ID);
    assert.match(AB.whatsappShareLink(msg), /^https:\/\/wa\.me\/\?text=/);
  });

  // ---------- paiement (checkout) ----------
  process.env.FEDAPAY_SECRET_KEY = "cle-fictive-pour-les-tests"; process.env.FEDAPAY_ENVIRONMENT = "sandbox";
  process.env.PUBLIC_SITE_URL = "https://exemple.test"; process.env.SUPABASE_URL = "https://x.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service-fictive";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abonnement-test-"));
  fs.cpSync(path.join(root, "api"), path.join(tmp, "api"), { recursive: true });
  fs.copyFileSync(path.join(root, "brand.js"), path.join(tmp, "brand.js"));
  const mk = (name, code) => { const d = path.join(tmp, "node_modules", ...name.split("/")); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" })); fs.writeFileSync(path.join(d, "index.js"), code); };
  mk("fedapay", `
    exports.FedaPay = { setApiKey(){}, setEnvironment(){} };
    exports.Webhook = { constructEvent(raw, sig) { if (sig !== 'signature-valide') throw new Error('signature invalide'); const b = JSON.parse(raw); return { name: 'transaction.approved', entity: { id: b.id } }; } };
    exports.Transaction = { retrieve: async (id) => { const t = globalThis.__FEDAPAY[String(id)]; if (!t) throw new Error('introuvable'); return t; } };`);
  mk("@supabase/supabase-js", `exports.createClient = () => globalThis.__DB.client;`);
  const mod = await import(pathToFileURL(path.join(tmp, "api", "_entreprise-abonnement.js")).href);
  const webhook = (await import(pathToFileURL(path.join(tmp, "api", "fedapay-webhook.js")).href)).default;

  function checkoutEnv(opts) {
    const db = makeDb({ entreprises: [{ id: ID, nom_commercial: "Boutique Fictive", offerte: false, expire_le: null }], entreprise_forfaits: FORFAITS.map((f) => ({ ...f })) });
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (opts && opts.fedapayFails) return { ok: false, json: async () => ({ message: "refusé" }) };
      return { ok: true, json: async () => ({ "v1/transaction": { id: 4242, payment_url: "https://paiement.exemple.test/abc" } }) };
    };
    return { db, calls, deps: { supabaseAdmin: db.client, fetch, now: NOW } };
  }
  const call = async (env, body, ip) => { const res = fakeRes(); await mod.handleEntrepriseCheckout({ method: "POST", headers: { "x-forwarded-for": ip || "203.0.113.7", host: "exemple.test" }, body }, res, env.deps); return res; };

  await test("checkout : le montant et les jours viennent de la base, pas du navigateur ; instantané enregistré ; retour sur la page d'abonnement", async () => {
    mod._resetRateLimitsForTests();
    const env = checkoutEnv();
    const res = await call(env, { productType: "entreprise", entrepriseId: ID, forfaitCode: "7-jours", montant: 1, amount: 1, jours: 999, prix: 1 });
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body, { checkoutUrl: "https://paiement.exemple.test/abc", transactionId: 4242 });
    const create = env.calls.find((c) => /\/transactions$/.test(c.url));
    assert.strictEqual(create.url, "https://sandbox-api.fedapay.com/v1/transactions");
    assert.strictEqual(create.body.amount, 3000, "montant du forfait en base, jamais celui du navigateur");
    assert.strictEqual(create.body.callback_url, "https://exemple.test/abonnement.html?v=" + ID + "&retour=1");
    assert.deepStrictEqual(env.db.entreprise_paiements.map((p) => [p.forfait_code, p.jours, p.montant, p.fedapay_transaction_id, p.statut, p.source]), [["7-jours", 7, 3000, "4242", "en_attente", "fedapay"]]);
    assert.strictEqual(env.db.entreprises[0].expire_le, null, "le checkout ne prolonge jamais l'abonnement");
  });
  await test("checkout : mode live commandé par la variable FEDAPAY_ENVIRONMENT", async () => {
    mod._resetRateLimitsForTests();
    process.env.FEDAPAY_ENVIRONMENT = "live";
    const env = checkoutEnv(); await call(env, { entrepriseId: ID, forfaitCode: "1-jour" });
    process.env.FEDAPAY_ENVIRONMENT = "sandbox";
    assert.strictEqual(env.calls[0].url, "https://api.fedapay.com/v1/transactions");
  });
  await test("checkout : forfait inactif ou inconnu refusé, sans aucun appel à FedaPay ni écriture", async () => {
    mod._resetRateLimitsForTests();
    for (const code of ["ancien", "inconnu-123"]) {
      const env = checkoutEnv(); const res = await call(env, { entrepriseId: ID, forfaitCode: code });
      assert.strictEqual(res.code, 400, code); assert.match(res.body.error, /pas disponible/);
      assert.strictEqual(env.calls.length, 0); assert.strictEqual(env.db.entreprise_paiements.length, 0);
    }
  });
  await test("checkout : forfait désactivé dans la base après affichage → refusé (jamais pris du navigateur)", async () => {
    mod._resetRateLimitsForTests();
    const env = checkoutEnv(); env.db.entreprise_forfaits.find((f) => f.code === "7-jours").actif = false;
    const res = await call(env, { entrepriseId: ID, forfaitCode: "7-jours" });
    assert.strictEqual(res.code, 400); assert.strictEqual(env.calls.length, 0);
  });
  await test("checkout : entrées invalides refusées AVANT toute lecture (identifiant, code) ; vitrine inconnue → 404", async () => {
    mod._resetRateLimitsForTests();
    let env = checkoutEnv(); let res = await call(env, { entrepriseId: "pas-un-uuid", forfaitCode: "7-jours" });
    assert.strictEqual(res.code, 400);
    res = await call(env, { entrepriseId: ID, forfaitCode: "Code Invalide!" }); assert.strictEqual(res.code, 400);
    res = await call(env, { entrepriseId: ID }); assert.strictEqual(res.code, 400);
    res = await call(env, { entrepriseId: "00000000-0000-4000-8000-000000000000", forfaitCode: "7-jours" }); assert.strictEqual(res.code, 404);
    assert.strictEqual(env.calls.length, 0);
  });
  await test("checkout : échec FedaPay → 502, aucune ligne enregistrée ; échec d'écriture → 500 (on n'envoie pas le commerçant payer)", async () => {
    mod._resetRateLimitsForTests();
    let env = checkoutEnv({ fedapayFails: true }); let res = await call(env, { entrepriseId: ID, forfaitCode: "7-jours" });
    assert.strictEqual(res.code, 502); assert.strictEqual(env.db.entreprise_paiements.length, 0);
    env = checkoutEnv(); env.db.failInsert = "entreprise_paiements"; res = await call(env, { entrepriseId: ID, forfaitCode: "7-jours" });
    assert.strictEqual(res.code, 500); assert.ok(!res.body.checkoutUrl);
  });
  await test("checkout : limites — par adresse IP et nombre de paiements en attente par vitrine", async () => {
    mod._resetRateLimitsForTests();
    const env = checkoutEnv();
    for (let i = 0; i < mod.MAX_PENDING_PER_HOUR; i++) env.db.entreprise_paiements.push({ id: "p" + i, entreprise_id: ID, statut: "en_attente", cree_le: iso(NOW - 60000) });
    let res = await call(env, { entrepriseId: ID, forfaitCode: "7-jours" });
    assert.strictEqual(res.code, 429); assert.strictEqual(env.calls.length, 0);
    mod._resetRateLimitsForTests();
    const env2 = checkoutEnv(); let last;
    for (let i = 0; i < mod.RATE_LIMITS.checkout.max + 1; i++) last = await call(env2, { entrepriseId: ID, forfaitCode: "1-jour" }, "198.51.100.9");
    assert.strictEqual(last.code, 429); assert.ok(last.headers["Retry-After"]);
  });
  await test("info : seulement les forfaits ACTIFS (code, libellé, jours, montant) ; status : UN SEUL booléen, sans date", async () => {
    mod._resetRateLimitsForTests();
    const env = checkoutEnv();
    let res = await call(env, { entrepriseId: ID, action: "info" });
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body.forfaits.map((f) => f.code), ["1-jour", "7-jours", "30-jours"]);
    assert.deepStrictEqual(Object.keys(res.body.forfaits[0]).sort(), ["code", "jours", "libelle", "montant"]);
    assert.deepStrictEqual(res.body.entreprise, { nom_commercial: "Boutique Fictive" });
    res = await call(env, { entrepriseId: ID, action: "status" });
    assert.deepStrictEqual(res.body, { actif: false });
    env.db.entreprises[0].expire_le = iso(NOW + DAY);
    assert.deepStrictEqual((await call(env, { entrepriseId: ID, action: "status" })).body, { actif: true });
    env.db.entreprises[0].expire_le = iso(NOW - DAY); env.db.entreprises[0].offerte = true;
    assert.deepStrictEqual((await call(env, { entrepriseId: ID, action: "status" })).body, { actif: true });
    assert.strictEqual(env.calls.length, 0, "aucun appel FedaPay pour info/status");
  });

  // ---------- webhook : assistant seul ----------
  const LOG = () => { const l = []; const f = (level, msg, extra) => l.push({ level, msg, extra }); f.entries = l; return f; };
  await test("webhook (assistant) : montant falsifié refusé → paiement « echoue », aucune prolongation", async () => {
    const db = makeDb({ entreprises: [{ id: ID, expire_le: null }], entreprise_paiements: [{ id: "p1", entreprise_id: ID, jours: 7, montant: 3000, fedapay_transaction_id: "555", statut: "en_attente", source: "fedapay" }] });
    const r = await mod.handleEntrepriseWebhook(db.client, { transactionId: 555, officialStatus: "approved", officialAmount: 100, log: LOG() });
    assert.strictEqual(r.status, 400); assert.strictEqual(db.entreprises[0].expire_le, null); assert.strictEqual(db.entreprise_paiements[0].statut, "echoue");
    assert.ok(!db.rpcCalls.some((c) => c.name === "entreprise_confirmer_paiement"), "jamais de confirmation avec un montant faux");
  });
  await test("webhook (assistant) : aucun paiement correspondant → null (le webhook répond 404) ; paiement manuel ignoré", async () => {
    const db = makeDb({ entreprises: [{ id: ID }], entreprise_paiements: [{ id: "m1", entreprise_id: ID, jours: 7, montant: 0, fedapay_transaction_id: null, statut: "confirme", source: "manuel" }] });
    assert.strictEqual(await mod.handleEntrepriseWebhook(db.client, { transactionId: 9, officialStatus: "approved", officialAmount: 1, log: LOG() }), null);
  });
  await test("webhook (assistant) : refusé / annulé → « echoue » ; en attente → rien ; erreur de base → 5xx (FedaPay réessaiera)", async () => {
    const seed = () => makeDb({ entreprises: [{ id: ID, expire_le: null }], entreprise_paiements: [{ id: "p1", entreprise_id: ID, jours: 7, montant: 3000, fedapay_transaction_id: "555", statut: "en_attente", source: "fedapay" }] });
    let db = seed(); let r = await mod.handleEntrepriseWebhook(db.client, { transactionId: 555, officialStatus: "declined", officialAmount: 3000, log: LOG() });
    assert.strictEqual(r.status, 200); assert.strictEqual(db.entreprise_paiements[0].statut, "echoue"); assert.strictEqual(db.entreprises[0].expire_le, null);
    db = seed(); r = await mod.handleEntrepriseWebhook(db.client, { transactionId: 555, officialStatus: "pending", officialAmount: 3000, log: LOG() });
    assert.strictEqual(r.status, 200); assert.strictEqual(db.entreprise_paiements[0].statut, "en_attente");
    db = seed(); db.failRpc = "entreprise_confirmer_paiement"; r = await mod.handleEntrepriseWebhook(db.client, { transactionId: 555, officialStatus: "approved", officialAmount: 3000, log: LOG() });
    assert.strictEqual(r.status, 500);
  });

  // ---------- webhook réel (api/fedapay-webhook.js) : modules importés depuis le dossier temporaire (faux modules) ----------
  process.env.FEDAPAY_WEBHOOK_SECRET = "secret-fictif";

  async function send(body, signature) {
    const { EventEmitter } = require("node:events");
    const req = new EventEmitter(); req.method = "POST"; req.headers = signature === null ? {} : { "x-fedapay-signature": signature };
    const res = fakeRes(); const p = webhook(req, res);
    setImmediate(() => { req.emit("data", JSON.stringify(body)); req.emit("end"); });
    await p; return res;
  }
  const webhookDb = () => { const db = makeDb({ entreprises: [{ id: ID, nom_commercial: "Boutique Fictive", expire_le: null, offerte: false }],
    entreprise_paiements: [
      { id: "p1", entreprise_id: ID, forfait_code: "7-jours", jours: 7, montant: 3000, fedapay_transaction_id: "1001", statut: "en_attente", source: "fedapay" },
      { id: "p2", entreprise_id: ID, forfait_code: "30-jours", jours: 30, montant: 10000, fedapay_transaction_id: "1002", statut: "en_attente", source: "fedapay" } ] });
    globalThis.__DB = db; globalThis.__FEDAPAY = { "1001": { status: "approved", amount: 3000 }, "1002": { status: "approved", amount: 10000 } }; return db; };

  await test("webhook réel : signature invalide ou absente refusée (400), aucune écriture ni lecture en base", async () => {
    const db = webhookDb();
    let res = await send({ id: 1001 }, "signature-forgee"); assert.strictEqual(res.code, 400); assert.match(res.body.error, /Signature invalide/);
    res = await send({ id: 1001 }, null); assert.strictEqual(res.code, 400);
    assert.strictEqual(db.rpcCalls.length, 0); assert.strictEqual(db.entreprises[0].expire_le, null);
    assert.strictEqual(db.entreprise_paiements.every((p) => p.statut === "en_attente"), true);
  });
  await test("webhook réel : montant officiel FedaPay falsifié (≠ forfait enregistré) refusé, abonnement inchangé", async () => {
    const db = webhookDb(); globalThis.__FEDAPAY["1001"] = { status: "approved", amount: 1 };
    const res = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(res.code, 400); assert.strictEqual(db.entreprises[0].expire_le, null); assert.strictEqual(db.entreprise_paiements[0].statut, "echoue");
  });
  await test("webhook réel : paiement confirmé prolonge UNE fois ; le même événement reçu deux fois ne prolonge qu'une fois (idempotent)", async () => {
    const db = webhookDb(); db.now = Date.now();
    const before = Date.now();
    let res = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(res.code, 200); assert.deepStrictEqual(res.body, { received: true, status: "confirme" });
    const expire = Date.parse(db.entreprises[0].expire_le);
    assert.ok(Math.abs(expire - (before + 7 * DAY)) < 5000, "maintenant + 7 jours");
    const again = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(again.code, 200); assert.strictEqual(again.body.already_confirmed, true);
    assert.strictEqual(Date.parse(db.entreprises[0].expire_le), expire, "aucune seconde prolongation");
    assert.strictEqual(db.rpcCalls.filter((c) => c.name === "entreprise_confirmer_paiement").length, 1, "un seul appel de confirmation");
  });
  await test("webhook réel : deux paiements distincts se cumulent (7 jours puis 30 jours = 37 jours)", async () => {
    const db = webhookDb(); db.now = Date.now(); const before = Date.now();
    await send({ id: 1001 }, "signature-valide"); await send({ id: 1002 }, "signature-valide");
    const expire = Date.parse(db.entreprises[0].expire_le);
    assert.ok(Math.abs(expire - (before + 37 * DAY)) < 5000, "7 + 30 jours cumulés, pas 30");
  });
  await test("webhook réel : paiement refusé → aucune prolongation ; transaction inconnue → 404 ; la visibilité ne dépend que du webhook", async () => {
    const db = webhookDb(); globalThis.__FEDAPAY["1001"] = { status: "declined", amount: 3000 };
    let res = await send({ id: 1001 }, "signature-valide"); assert.strictEqual(res.code, 200); assert.strictEqual(db.entreprises[0].expire_le, null);
    globalThis.__FEDAPAY["7777"] = { status: "approved", amount: 3000 };
    res = await send({ id: 7777 }, "signature-valide"); assert.strictEqual(res.code, 404);
    // le checkout et l'action « status » n'écrivent jamais expire_le
    const src = read("api/_entreprise-abonnement.js").replace(/\/\/.*$/gm, "");
    assert.ok(!/expire_le\s*[:=]/.test(src.replace(/select\("[^"]*expire_le[^"]*"\)/g, "")), "le helper ne modifie jamais expire_le lui-même (fonctions SQL)");
  });

  // ---------- câblage et sécurité ----------
  await test("câblage : checkout et webhook délèguent au helper (aucune nouvelle fonction Vercel : 12 fichiers non préfixés)", () => {
    assert.match(read("api/fedapay-checkout.js"), /productType === "entreprise"[\s\S]*import\("\.\/_entreprise-abonnement\.js"\)[\s\S]*handleEntrepriseCheckout\(req, res\)/);
    const wh = read("api/fedapay-webhook.js");
    assert.match(wh, /handleEntrepriseWebhook\(supabaseAdmin, \{ transactionId, officialStatus, officialAmount, log \}\)/);
    assert.ok(wh.indexOf("event = Webhook.constructEvent(") < wh.indexOf("officialTransaction = await Transaction.retrieve(") && wh.indexOf("officialTransaction = await Transaction.retrieve(") < wh.indexOf("await handleEntrepriseWebhook("), "signature, puis relecture FedaPay, puis abonnement");
    const fns = [];
    (function scan(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) return scan(p); if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(path.relative(path.join(root, "api"), p)); }); })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12, fns.join(", "));
  });
  await test("pages : aucun innerHTML ; la page de paiement n'écrit rien en base et n'ouvre rien ; retour = « en cours de confirmation »", () => {
    const pay = read("abonnement.html"), admin = read("admin/vitrines.html");
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(pay + admin));
    assert.ok(!/supabase|createClient|\.insert\(|\.update\(|expire_le/.test(pay), "la page de paiement ne touche pas la base");
    assert.match(pay, /Paiement en cours de confirmation/);
    assert.match(pay, /call\(\{ action: "status" \}\)/);
    assert.match(pay, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(pay, /body: JSON\.stringify\(Object\.assign\(\{ productType: "entreprise", entrepriseId: entrepriseId \}, body\)\)/);
    assert.ok(!/montant|amount/.test(pay.slice(pay.indexOf('call({ action: "checkout"') - 60, pay.indexOf('call({ action: "checkout"') + 80)), "aucun montant envoyé par le navigateur");
  });
  await test("administration : jamais d'écriture directe de expire_le ; gratuité et prolongation manuelle ; forfaits ; lien de paiement", () => {
    const admin = read("admin/vitrines.html");
    assert.ok(!/expire_le\s*:/.test(admin.replace(/\s+/g, " ")), "aucun payload n'écrit expire_le");
    assert.match(admin, /update\(\{ offerte: next \}\)/);
    assert.match(admin, /supabase\.rpc\("entreprise_prolonger_manuel", \{ p_entreprise_id: current\.id, p_jours: jours \}\)/);
    assert.match(admin, /Générer le lien de paiement/);
    assert.match(admin, /Prolonger manuellement/);
    assert.match(admin, /Offrir la gratuité/);
    assert.match(admin, /from\("entreprise_forfaits"\)\.update\(/);
    assert.match(admin, /AB\.paymentLink\(site, current\.id, code\)/);
    assert.match(admin, /new URL\("\.\.\/", window\.location\.href\)/);
    // le formulaire d'enregistrement d'une vitrine n'inclut pas les champs d'abonnement
    const payload = admin.slice(admin.indexOf("const payload = {\n      slug:"), admin.indexOf("$(\"save-btn\").disabled = true;"));
    assert.ok(!/expire_le|offerte/.test(payload));
  });
  await test("aperçu WhatsApp : une vitrine expirée (invisible par la RLS) donne le 404 générique, sans aucune donnée", async () => {
    const og = await import(pathToFileURL(path.join(root, "api", "_entreprise-og.js")).href);
    const res = fakeRes(); res.send = function (b) { this.body = b; return this; };
    await og.handleEntreprisePreview({ query: { slug: "boutique-fictive" } }, res, { fetchEntreprise: async () => ({ row: null, error: null }) });   // la RLS ne renvoie aucune ligne
    assert.strictEqual(res.code, 404);
    assert.ok(!/Boutique Fictive|boutique-fictive/.test(res.body), "aucune donnée d'une vitrine expirée");
    assert.match(res.body, /Vitrine introuvable/);
    assert.match(read("api/produit-og.js"), /\.from\("entreprises"\)\.select\(ENTREPRISE_FIELDS\)\.eq\("slug", slug\)\.eq\("published", true\)/);
  });
  await test("aucune donnée réelle ni secret dans les nouveaux fichiers (numéros, e-mails, clés)", () => {
    ["entreprise-abonnement.js", "abonnement.html", "api/_entreprise-abonnement.js", "entreprises-abonnement.sql", "entreprises-abonnement-rollback.sql", "entreprises-abonnement-offrir-existantes.sql"].forEach((f) => {
      const t = read(f);
      assert.ok(!/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/.test(t), f + " : e-mail");
      assert.ok(!/(?:\+?229|\b01)[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}[ .]?\d{2}\b/.test(t), f + " : numéro");
      assert.ok(!/sk_(live|test)_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}\./.test(t), f + " : clé");
    });
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n" + passed + " test(s) réussi(s)");
})();
