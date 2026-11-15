/* Tests de l'abonnement par forfaits des salons payants (aucun SQL exécuté, aucun appel réseau, aucune clé réelle).
   Exécution : node tests/salon-abonnement.test.js
   Les modules « fedapay » et « @supabase/supabase-js » sont remplacés par de faux modules dans un dossier
   temporaire ; la base est une maquette en mémoire qui reproduit le contrat des fonctions SQL. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const SA = require("../salon-abonnement");

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
const ROOM = "salon-essai-fictif";
const USER = "user-membre-1";

// ---------- maquette en mémoire ----------
function makeDb(seed) {
  const db = Object.assign({ rooms: [], profiles: [], purchases: [], salon_forfaits: [], salon_paiements: [], salon_abonnements: [], rpcCalls: [], inserts: [], now: NOW }, seed || {});
  let n = 0;
  function builder(table) {
    const st = { f: [], op: "select", payload: null, head: false, order: null, cols: null };
    const api = {
      select(cols, opts) { st.cols = cols && cols !== "*" ? cols.split(",").map((c) => c.trim()) : null; st.head = !!(opts && opts.head); return api; },
      eq(c, v) { st.f.push(["eq", c, v]); return api; },
      gte(c, v) { st.f.push(["gte", c, v]); return api; },
      gt(c, v) { st.f.push(["gt", c, v]); return api; },
      order(c, o) { st.order = [c, o && o.ascending !== false]; return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; },
      update(p) { st.op = "update"; st.payload = p; return api; },
      maybeSingle() { st.single = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    const cmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    function match(r) { return st.f.every(([k, c, v]) => (k === "eq" ? r[c] === v : k === "gte" ? cmp(r[c], v) >= 0 : cmp(r[c], v) > 0)); }
    function project(r) { if (!st.cols) return Object.assign({}, r); const o = {}; st.cols.forEach((c) => { o[c] = r[c]; }); return o; }
    function run() {
      const rows = db[table] = db[table] || [];
      if (st.op === "insert") {
        db.inserts.push({ table, row: st.payload });
        if (db.failInsert === table) return { data: null, error: { message: "insert échoué" } };
        rows.push(Object.assign({ id: "row-" + (++n) }, st.payload));
        return { data: null, error: null };
      }
      if (st.op === "update") { rows.filter(match).forEach((r) => Object.assign(r, st.payload)); return { data: null, error: null }; }
      let out = rows.filter(match);
      if (st.order) { const [c, asc] = st.order; out = out.slice().sort((a, b) => cmp(a[c], b[c]) * (asc ? 1 : -1)); }
      if (st.head) return { data: null, count: out.length, error: null };
      if (st.single) return { data: out[0] ? project(out[0]) : null, error: null };
      return { data: out.map(project), error: null };
    }
    return api;
  }
  // Reproduit salon_confirmer_paiement / salon_echouer_paiement (voir salons-abonnement.sql)
  function rpc(name, args) {
    db.rpcCalls.push({ name, args });
    const p = db.salon_paiements.find((x) => x.fedapay_transaction_id === args.p_transaction_id);
    if (name === "salon_echouer_paiement") {
      const ok = !!p && p.statut === "en_attente"; if (ok) p.statut = "echoue";
      return Promise.resolve({ data: ok, error: null });
    }
    if (name === "salon_confirmer_paiement") {
      if (!p) return Promise.resolve({ data: { resultat: "introuvable" }, error: null });
      if (p.statut === "confirme") return Promise.resolve({ data: { resultat: "deja_confirme" }, error: null });
      if (p.statut !== "en_attente") return Promise.resolve({ data: { resultat: "ignore" }, error: null });
      if (p.montant !== args.p_montant) { p.statut = "echoue"; return Promise.resolve({ data: { resultat: "montant_incoherent" }, error: null }); }
      p.statut = "confirme"; p.confirme_le = iso(db.now);
      let a = db.salon_abonnements.find((x) => x.user_id === p.user_id && x.room_id === p.room_id);
      const base = a ? Math.max(Date.parse(a.expire_le), db.now) : db.now;
      if (!a) { a = { user_id: p.user_id, room_id: p.room_id }; db.salon_abonnements.push(a); }
      a.expire_le = iso(base + p.jours * DAY);
      return Promise.resolve({ data: { resultat: "confirme", expire_le: a.expire_le }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: "fonction inconnue" } });
  }
  db.user = { id: USER, email: "membre@exemple.test" };
  db.client = { from: builder, rpc, auth: { getUser: async (t) => (t === "jeton-valide" ? { data: { user: db.user }, error: null } : { data: null, error: { message: "jeton invalide" } }) } };
  return db;
}
const fakeRes = () => ({ headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const FORFAITS = [
  { code: "test-1-jour", libelle: "Test 1 jour", jours: 1, montant: 100, actif: true, ordre: 0 },
  { code: "1-mois", libelle: "1 mois", jours: 30, montant: 1111, actif: true, ordre: 1 },
  { code: "3-mois", libelle: "3 mois", jours: 90, montant: 2999, actif: true, ordre: 2 },
  { code: "ancien", libelle: "Ancien forfait", jours: 15, montant: 5000, actif: false, ordre: 3 }
];
const roomAbo = (extra) => Object.assign({ id: ROOM, name: "Salon fictif", is_paid: true, abonnement: true, price: null, created_by: "createur-1" }, extra || {});
const seedDb = (extra) => makeDb(Object.assign({
  rooms: [roomAbo()], profiles: [{ id: USER, username: "Membre", role: "user" }], salon_forfaits: FORFAITS.map((f) => ({ ...f }))
}, extra || {}));

(async () => {
  // ---------- règles d'accès affichées (module partagé) ----------
  const abo = roomAbo();
  await test("accès : salon gratuit, créateur, admin, membre à vie, abonné en cours → entrent directement", () => {
    assert.strictEqual(SA.accessDecision({ room: { is_paid: false }, userId: USER }).allowed, true);
    assert.strictEqual(SA.accessDecision({ room: abo, userId: "createur-1" }).reason, "createur");
    for (const role of ["admin", "super_admin", "founder"]) assert.strictEqual(SA.accessDecision({ room: abo, userId: USER, role }).reason, "admin");
    assert.strictEqual(SA.accessDecision({ room: abo, userId: USER, lifetime: true }).reason, "vie");
    assert.strictEqual(SA.accessDecision({ room: abo, userId: USER, subscription: { expire_le: iso(NOW + DAY) }, now: NOW }).reason, "abonne");
  });
  await test("accès : MEMBRE À VIE dans un salon passé en abonnement → entre, jamais de forfaits (même avec un abonnement expiré à côté)", () => {
    const d = SA.accessDecision({ room: abo, userId: USER, lifetime: true, subscription: { expire_le: iso(NOW - DAY) }, now: NOW });
    assert.deepStrictEqual([d.allowed, d.reason, d.mode], [true, "vie", null]);
    // et dans chat.html l'achat à vie est contrôlé AVANT l'affichage des forfaits
    const page = read("chat.html");
    assert.ok(page.indexOf("const lifetime = await hasPaidPurchase();") < page.indexOf("await showSubscriptionPlans("));
    assert.ok(/const lifetime = await hasPaidPurchase\(\);\s+if \(lifetime\) return true;/.test(page));
  });
  await test("accès : abonnement expiré ou absent → verrouillé en mode abonnement ; salon payant ordinaire → mode achat (inchangé)", () => {
    let d = SA.accessDecision({ room: abo, userId: USER, subscription: { expire_le: iso(NOW - 1) }, now: NOW });
    assert.deepStrictEqual([d.allowed, d.mode, d.expired], [false, "abonnement", true]);
    d = SA.accessDecision({ room: abo, userId: USER, subscription: null, now: NOW });
    assert.deepStrictEqual([d.allowed, d.mode, d.expired], [false, "abonnement", false]);
    d = SA.accessDecision({ room: abo, userId: USER, subscription: { expire_le: iso(NOW) }, now: NOW });
    assert.strictEqual(d.allowed, false, "expire pile maintenant : plus d'accès");
    d = SA.accessDecision({ room: { is_paid: true, abonnement: false, price: 2000 }, userId: USER });
    assert.deepStrictEqual([d.allowed, d.mode], [false, "achat"]);
    d = SA.accessDecision({ room: { is_paid: true, price: 2000 }, userId: USER });   // colonne absente (SQL pas encore exécuté)
    assert.strictEqual(d.mode, "achat");
  });
  await test("durée restante et minuteur d'expiration", () => {
    assert.strictEqual(SA.remainingLabel(iso(NOW + 3 * DAY - 1000), NOW), "il reste 3 jours");
    assert.strictEqual(SA.remainingLabel(iso(NOW + DAY + 1000), NOW), "il reste 2 jours");
    assert.strictEqual(SA.remainingLabel(iso(NOW + 3600000), NOW), "il reste moins d'un jour");
    assert.strictEqual(SA.remainingLabel(iso(NOW - 1), NOW), "expiré");
    assert.strictEqual(SA.msUntilExpiry({ expire_le: iso(NOW - 1) }, NOW), null);
    assert.strictEqual(SA.msUntilExpiry(null, NOW), null);
    assert.ok(SA.msUntilExpiry({ expire_le: iso(NOW + 5000) }, NOW) >= 5000);
    assert.ok(SA.msUntilExpiry({ expire_le: iso(NOW + 400 * DAY) }, NOW) <= 2147000000, "plafonné pour setTimeout");
  });

  // ---------- CONTRAT : la vraie lecture des forfaits traverse le filtre de la page ----------
  await test("CONTRAT : la lecture des forfaits actifs, avec les colonnes demandées par la page, traverse plansFromRows sans rien perdre", async () => {
    // Même requête que chat.html : colonnes = FORFAIT_COLUMNS ; la base (RLS) ne renvoie que les actifs.
    const db = seedDb();
    db.salon_forfaits = db.salon_forfaits.filter((f) => f.actif === true);
    const { data } = await db.client.from("salon_forfaits").select(SA.FORFAIT_COLUMNS).order("ordre", { ascending: true });
    assert.strictEqual(data.length, 3);
    assert.ok(data.every((r) => !("actif" in r)), "le champ « actif » n'est PAS demandé : le filtre ne doit pas l'exiger");
    const plans = SA.plansFromRows(data);
    assert.deepStrictEqual(plans.map((p) => p.code), ["test-1-jour", "1-mois", "3-mois"], "aucun forfait rejeté par le filtre de la page");
    assert.strictEqual(SA.planLabel(plans[1]), "1 mois — " + Number(1111).toLocaleString("fr-FR") + " FCFA");
    // la page utilise bien ce filtre et ces colonnes
    const page = read("chat.html");
    assert.ok(page.includes(".select(MahoutoSalonAbonnement.FORFAIT_COLUMNS)") && page.includes("MahoutoSalonAbonnement.plansFromRows(data)"));
    assert.ok(!/isPurchasable|\.actif\b|actif ===/.test(page.slice(page.indexOf("async function showSubscriptionPlans"), page.indexOf("async function checkRoomAccess"))), "la page ne dépend pas d'un champ « actif »");
  });
  await test("filtre d'affichage : champs invalides écartés, tri par ordre puis durée", () => {
    const bad = [null, {}, { code: "x", libelle: "a", jours: 1, montant: 1 }, { code: "ok-1", libelle: "", jours: 1, montant: 1 },
      { code: "ok-2", libelle: "a", jours: 0, montant: 1 }, { code: "ok-3", libelle: "a", jours: 1, montant: 1.5 }, { code: "ok-4", libelle: "a", jours: 1, montant: -3 }, { code: "A B", libelle: "a", jours: 1, montant: 1 }];
    assert.deepStrictEqual(SA.plansFromRows(bad), []);
    assert.deepStrictEqual(SA.plansFromRows(null), []);
    const sorted = SA.plansFromRows([{ code: "b-b", libelle: "b", jours: 90, montant: 5, ordre: 2 }, { code: "a-a", libelle: "a", jours: 30, montant: 5, ordre: 1 }]);
    assert.deepStrictEqual(sorted.map((p) => p.code), ["a-a", "b-b"]);
  });

  // ---------- modules serveur (faux modules dans un dossier temporaire) ----------
  process.env.FEDAPAY_SECRET_KEY = "cle-fictive-pour-les-tests"; process.env.FEDAPAY_ENVIRONMENT = "sandbox";
  process.env.PUBLIC_SITE_URL = "https://exemple.test"; process.env.SUPABASE_URL = "https://x.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-fictive"; process.env.SUPABASE_ANON_KEY = "anon-fictive";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "salon-abonnement-test-"));
  fs.cpSync(path.join(root, "api"), path.join(tmp, "api"), { recursive: true });
  fs.copyFileSync(path.join(root, "brand.js"), path.join(tmp, "brand.js"));
  const mk = (name, code) => { const d = path.join(tmp, "node_modules", ...name.split("/")); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" })); fs.writeFileSync(path.join(d, "index.js"), code); };
  mk("fedapay", `
    exports.FedaPay = { setApiKey(){}, setEnvironment(){} };
    exports.Webhook = { constructEvent(raw, sig) { if (sig !== 'signature-valide') throw new Error('signature invalide'); const b = JSON.parse(raw); return { name: 'transaction.approved', entity: { id: b.id } }; } };
    exports.Transaction = { retrieve: async (id) => { const t = globalThis.__FEDAPAY[String(id)]; if (!t) throw new Error('introuvable'); return t; } };`);
  mk("@supabase/supabase-js", `exports.createClient = () => globalThis.__DB.client;`);
  const mod = await import(pathToFileURL(path.join(tmp, "api", "_salon-abonnement.js")).href);
  const checkout = (await import(pathToFileURL(path.join(tmp, "api", "fedapay-checkout.js")).href)).default;
  const webhook = (await import(pathToFileURL(path.join(tmp, "api", "fedapay-webhook.js")).href)).default;
  const rules = await import(pathToFileURL(path.join(tmp, "api", "_attachment-rules.js")).href);

  const fedapayCalls = [];
  const fakeFetch = async (url, init) => { fedapayCalls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => ({ "v1/transaction": { id: 4242, payment_url: "https://paiement.exemple.test/abc" } }) }; };
  globalThis.fetch = fakeFetch;   // utilisé par fedapay-checkout.js (ancien chemin)
  const helperCtx = (db) => ({ supabaseAdmin: db.client, user: db.user, room: db.rooms[0], brandName: "MAHOUTO+", siteUrl: "https://exemple.test", fetch: fakeFetch, now: NOW });
  const callHelper = async (db, body) => { fedapayCalls.length = 0; const res = fakeRes(); await mod.handleSalonCheckout({ method: "POST", headers: { host: "exemple.test" }, body }, res, helperCtx(db)); return res; };
  const callEndpoint = async (db, body, token) => {
    globalThis.__DB = db; fedapayCalls.length = 0;
    const res = fakeRes();
    await checkout({ method: "POST", headers: { host: "exemple.test", authorization: "Bearer " + (token || "jeton-valide") }, body }, res);
    return res;
  };

  // ---------- checkout d'abonnement ----------
  await test("checkout abonnement : montant et jours relus en base (jamais du navigateur), instantané enregistré, AUCUNE ligne purchases", async () => {
    const db = seedDb();
    const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois", montant: 1, amount: 1, jours: 999 });
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body, { checkoutUrl: "https://paiement.exemple.test/abc", transactionId: 4242 });
    const create = fedapayCalls.find((c) => /\/transactions$/.test(c.url));
    assert.strictEqual(create.url, "https://sandbox-api.fedapay.com/v1/transactions");
    assert.strictEqual(create.body.amount, 1111, "prix du forfait en base");
    assert.strictEqual(create.body.callback_url, "https://exemple.test/chat.html?room=" + ROOM + "&payment=return");
    assert.deepStrictEqual(db.salon_paiements.map((p) => [p.user_id, p.room_id, p.forfait_code, p.jours, p.montant, p.fedapay_transaction_id, p.statut]), [[USER, ROOM, "1-mois", 30, 1111, "4242", "en_attente"]]);
    assert.strictEqual(db.purchases.length, 0, "jamais de ligne purchases : ce ne serait plus un abonnement mais un accès à vie");
    assert.strictEqual(db.salon_abonnements.length, 0, "le checkout ne prolonge rien");
  });
  await test("checkout abonnement : forfait inactif, inconnu ou code invalide refusé, sans appel FedaPay ni écriture", async () => {
    for (const code of ["ancien", "inconnu-123", "A B", "", undefined, 42]) {
      const db = seedDb(); const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: code });
      assert.strictEqual(res.code, 400, String(code)); assert.strictEqual(fedapayCalls.length, 0); assert.strictEqual(db.inserts.length, 0);
    }
  });
  await test("checkout abonnement : MEMBRE À VIE refusé (409) — aucun paiement d'abonnement créé, aucun appel FedaPay", async () => {
    const db = seedDb({ purchases: [{ id: 1, user_id: USER, course_id: ROOM, product_type: "salon", status: "paid", amount: 2000 }] });
    const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
    assert.strictEqual(res.code, 409); assert.match(res.body.error, /accès à vie/);
    assert.strictEqual(fedapayCalls.length, 0); assert.strictEqual(db.salon_paiements.length, 0); assert.strictEqual(db.inserts.length, 0);
  });
  await test("checkout abonnement : un achat à vie seulement « pending » ou « failed » ne dispense pas de payer", async () => {
    for (const status of ["pending", "failed"]) {
      const db = seedDb({ purchases: [{ id: 1, user_id: USER, course_id: ROOM, product_type: "salon", status }] });
      assert.strictEqual((await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" })).code, 200, status);
    }
  });
  await test("checkout abonnement : créateur du salon et administrateurs refusés (409) : ils ont déjà accès", async () => {
    let db = seedDb(); db.user = { id: "createur-1", email: "c@exemple.test" };
    assert.strictEqual((await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" })).code, 409);
    for (const role of ["admin", "super_admin", "founder"]) {
      db = seedDb(); db.profiles[0].role = role;
      const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
      assert.strictEqual(res.code, 409, role); assert.strictEqual(fedapayCalls.length, 0);
    }
  });
  await test("checkout abonnement : un abonné en cours PEUT renouveler (les jours se cumulent) ; plafond de paiements en attente (429)", async () => {
    let db = seedDb({ salon_abonnements: [{ user_id: USER, room_id: ROOM, expire_le: iso(NOW + 2 * DAY) }] });
    assert.strictEqual((await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" })).code, 200);
    db = seedDb({ salon_paiements: Array.from({ length: mod.MAX_PENDING_PER_HOUR }, (_, i) => ({ id: "p" + i, user_id: USER, room_id: ROOM, statut: "en_attente", cree_le: iso(NOW - 60000), fedapay_transaction_id: "9" + i })) });
    const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
    assert.strictEqual(res.code, 429); assert.strictEqual(fedapayCalls.length, 0);
  });
  await test("checkout abonnement : FedaPay refuse ou orphelin → aucune promesse d'accès", async () => {
    const db = seedDb(); db.failInsert = "salon_paiements";
    const res = await callHelper(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
    assert.strictEqual(res.code, 500); assert.strictEqual(res.body.checkoutUrl, undefined);
  });

  // ---------- aiguillage dans fedapay-checkout.js (le vrai point d'entrée) ----------
  await test("point d'entrée : salon en mode abonnement → branche abonnement (salon_paiements, jamais purchases) ; sans jeton → 401", async () => {
    const db = seedDb();
    let res = await callEndpoint(db, { courseId: ROOM, productType: "salon", forfaitCode: "3-mois" });
    assert.strictEqual(res.code, 200);
    assert.strictEqual(fedapayCalls.find((c) => /\/transactions$/.test(c.url)).body.amount, 2999);
    assert.strictEqual(db.purchases.length, 0); assert.strictEqual(db.salon_paiements.length, 1);
    res = await callEndpoint(seedDb(), { courseId: ROOM, productType: "salon", forfaitCode: "3-mois" }, "jeton-forge");
    assert.strictEqual(res.code, 401);
  });
  await test("point d'entrée : MEMBRE À VIE dans un salon en abonnement refusé (409), aucune transaction FedaPay, aucun paiement", async () => {
    const db = seedDb({ purchases: [{ id: 1, user_id: USER, course_id: ROOM, product_type: "salon", status: "paid", amount: 2000 }] });
    const res = await callEndpoint(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
    assert.strictEqual(res.code, 409);
    assert.strictEqual(fedapayCalls.length, 0); assert.strictEqual(db.salon_paiements.length, 0); assert.strictEqual(db.purchases.length, 1);
  });
  await test("point d'entrée : salon payant ORDINAIRE (abonnement = false) → ancien chemin inchangé : achat « pending » au prix à vie, forfaitCode ignoré", async () => {
    const db = seedDb({ rooms: [roomAbo({ abonnement: false, price: 2000 })] });
    const res = await callEndpoint(db, { courseId: ROOM, productType: "salon", forfaitCode: "1-mois" });
    assert.strictEqual(res.code, 200);
    assert.strictEqual(fedapayCalls.find((c) => /\/transactions$/.test(c.url)).body.amount, 2000);
    assert.deepStrictEqual(db.purchases.map((p) => [p.user_id, p.course_id, p.product_type, p.amount, p.status]), [[USER, ROOM, "salon", 2000, "pending"]]);
    assert.strictEqual(db.salon_paiements.length, 0);
  });
  await test("point d'entrée : colonne « abonnement » absente (code déployé avant le SQL) → ancien chemin, rien ne casse", async () => {
    const room = roomAbo({ price: 2000 }); delete room.abonnement;
    const db = seedDb({ rooms: [room] });
    assert.strictEqual((await callEndpoint(db, { courseId: ROOM, productType: "salon" })).code, 200);
    assert.strictEqual(db.purchases.length, 1); assert.strictEqual(db.salon_paiements.length, 0);
  });

  // ---------- webhook réel ----------
  process.env.FEDAPAY_WEBHOOK_SECRET = "secret-fictif";
  async function send(body, signature) {
    const { EventEmitter } = require("node:events");
    const req = new EventEmitter(); req.method = "POST"; req.headers = signature === null ? {} : { "x-fedapay-signature": signature };
    const res = fakeRes(); const p = webhook(req, res);
    setImmediate(() => { req.emit("data", JSON.stringify(body)); req.emit("end"); });
    await p; return res;
  }
  const webhookDb = (extra) => {
    const db = seedDb(Object.assign({
      salon_paiements: [
        { id: "p1", user_id: USER, room_id: ROOM, forfait_code: "1-mois", jours: 30, montant: 1111, fedapay_transaction_id: "1001", statut: "en_attente" },
        { id: "p2", user_id: USER, room_id: ROOM, forfait_code: "3-mois", jours: 90, montant: 2999, fedapay_transaction_id: "1002", statut: "en_attente" }]
    }, extra || {}));
    db.now = Date.now();
    globalThis.__DB = db; globalThis.__FEDAPAY = { "1001": { status: "approved", amount: 1111 }, "1002": { status: "approved", amount: 2999 } };
    return db;
  };
  const LOG = () => { const l = []; const f = (level, msg, extra) => l.push({ level, msg, extra }); f.entries = l; return f; };

  await test("webhook : signature invalide ou absente refusée (400), aucune lecture ni écriture en base", async () => {
    const db = webhookDb();
    let res = await send({ id: 1001 }, "signature-forgee"); assert.strictEqual(res.code, 400); assert.match(res.body.error, /Signature invalide/);
    res = await send({ id: 1001 }, null); assert.strictEqual(res.code, 400);
    assert.strictEqual(db.rpcCalls.length, 0); assert.strictEqual(db.salon_abonnements.length, 0);
    assert.ok(db.salon_paiements.every((p) => p.statut === "en_attente"));
  });
  await test("webhook : montant officiel falsifié (≠ forfait enregistré) refusé → « echoue », aucun abonnement", async () => {
    const db = webhookDb(); globalThis.__FEDAPAY["1001"] = { status: "approved", amount: 1 };
    const res = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(res.code, 400); assert.strictEqual(db.salon_abonnements.length, 0); assert.strictEqual(db.salon_paiements[0].statut, "echoue");
    assert.ok(!db.rpcCalls.some((c) => c.name === "salon_confirmer_paiement"));
  });
  await test("webhook : paiement confirmé → abonnement créé (maintenant + jours) ; JAMAIS de ligne purchases (pas d'accès à vie)", async () => {
    const db = webhookDb(); const before = Date.now();
    const res = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(res.code, 200); assert.deepStrictEqual(res.body, { received: true, status: "confirme" });
    assert.strictEqual(db.salon_abonnements.length, 1);
    assert.ok(Math.abs(Date.parse(db.salon_abonnements[0].expire_le) - (before + 30 * DAY)) < 5000);
    assert.strictEqual(db.purchases.length, 0); assert.ok(!db.inserts.some((i) => i.table === "purchases"));
  });
  await test("webhook : le même événement reçu deux fois ne prolonge qu'une fois (idempotent)", async () => {
    const db = webhookDb();
    await send({ id: 1001 }, "signature-valide");
    const expire = db.salon_abonnements[0].expire_le;
    const again = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(again.code, 200); assert.strictEqual(again.body.already_confirmed, true);
    assert.strictEqual(db.salon_abonnements[0].expire_le, expire);
    assert.strictEqual(db.rpcCalls.filter((c) => c.name === "salon_confirmer_paiement").length, 1);
  });
  await test("webhook : deux paiements cumulent leurs jours (30 + 90 = 120 jours)", async () => {
    const db = webhookDb(); const before = Date.now();
    await send({ id: 1001 }, "signature-valide"); await send({ id: 1002 }, "signature-valide");
    assert.strictEqual(db.salon_abonnements.length, 1, "une seule ligne par (membre, salon)");
    assert.ok(Math.abs(Date.parse(db.salon_abonnements[0].expire_le) - (before + 120 * DAY)) < 5000);
  });
  await test("webhook : renouvellement après expiration → repart de maintenant, pas de l'ancienne date", async () => {
    const db = webhookDb({ salon_abonnements: [{ user_id: USER, room_id: ROOM, expire_le: iso(Date.now() - 10 * DAY) }] }); const before = Date.now();
    await send({ id: 1001 }, "signature-valide");
    assert.ok(Math.abs(Date.parse(db.salon_abonnements[0].expire_le) - (before + 30 * DAY)) < 5000);
  });
  await test("webhook : paiement refusé → aucune prolongation ; transaction inconnue → 404", async () => {
    const db = webhookDb(); globalThis.__FEDAPAY["1001"] = { status: "declined", amount: 1111 };
    let res = await send({ id: 1001 }, "signature-valide");
    assert.strictEqual(res.code, 200); assert.strictEqual(db.salon_abonnements.length, 0); assert.strictEqual(db.salon_paiements[0].statut, "echoue");
    globalThis.__FEDAPAY["7777"] = { status: "approved", amount: 1111 };
    res = await send({ id: 7777 }, "signature-valide"); assert.strictEqual(res.code, 404);
  });
  await test("webhook : un achat à vie classique (purchases) reste traité par l'ancien chemin, sans toucher aux abonnements", async () => {
    const db = webhookDb({ purchases: [{ id: 5, user_id: USER, course_id: "autre-salon", product_type: "salon", status: "pending", amount: 2000, fedapay_transaction_id: "3003" }] });
    globalThis.__FEDAPAY["3003"] = { status: "approved", amount: 2000 };
    const res = await send({ id: 3003 }, "signature-valide");
    assert.strictEqual(res.code, 200); assert.strictEqual(db.purchases[0].status, "paid", "ancien chemin : l'achat à vie est confirmé");
    assert.strictEqual(db.salon_abonnements.length, 0); assert.ok(!db.rpcCalls.some((c) => /^salon_/.test(c.name)));
  });

  // ---------- pièces jointes : même règle d'accès côté serveur ----------
  await test("pièces jointes (canAccessRoom) : abonné en cours, membre à vie, salon libre autorisés ; abonnement expiré ou absent refusé", async () => {
    const admin = (db) => db.client;
    let db = seedDb({ salon_abonnements: [{ user_id: USER, room_id: ROOM, expire_le: new Date(Date.now() + DAY).toISOString() }] });
    assert.strictEqual((await rules.canAccessRoom(admin(db), USER, ROOM, "user")).allowed, true, "abonné en cours");
    db = seedDb({ salon_abonnements: [{ user_id: USER, room_id: ROOM, expire_le: new Date(Date.now() - DAY).toISOString() }] });
    assert.strictEqual((await rules.canAccessRoom(admin(db), USER, ROOM, "user")).allowed, false, "abonnement expiré");
    assert.strictEqual((await rules.canAccessRoom(seedDb().client, USER, ROOM, "user")).allowed, false, "aucun abonnement");
    db = seedDb({ purchases: [{ id: 1, user_id: USER, course_id: ROOM, product_type: "salon", status: "paid" }] });
    assert.strictEqual((await rules.canAccessRoom(admin(db), USER, ROOM, "user")).allowed, true, "membre à vie");
    db = seedDb({ salon_abonnements: [{ user_id: "autre", room_id: ROOM, expire_le: new Date(Date.now() + DAY).toISOString() }] });
    assert.strictEqual((await rules.canAccessRoom(admin(db), USER, ROOM, "user")).allowed, false, "l'abonnement d'un autre ne compte pas");
    db = seedDb({ rooms: [{ id: ROOM, is_paid: false, created_by: "x" }] });
    assert.strictEqual((await rules.canAccessRoom(admin(db), USER, ROOM, "user")).allowed, true, "salon gratuit");
    assert.strictEqual((await rules.canAccessRoom(seedDb().client, USER, ROOM, "admin")).allowed, true, "admin");
  });

  // ---------- câblage et contraintes de la plateforme ----------
  await test("câblage : aiguillage du checkout AVANT le prix à vie ; webhook = signature → relecture FedaPay → purchases → serigraphie → entreprise → salon", () => {
    const co = read("api/fedapay-checkout.js");
    assert.ok(co.indexOf("article.abonnement === true") > co.indexOf('article.is_paid !== true'));
    assert.ok(co.indexOf("article.abonnement === true") < co.indexOf("const officialAmount = productType"));
    assert.ok(co.includes('await import("./_salon-abonnement.js")'));
    const wh = read("api/fedapay-webhook.js");
    const order = ["Webhook.constructEvent(", "Transaction.retrieve(", "handleSerigraphieWebhook(supabaseAdmin", "handleEntrepriseWebhook(supabaseAdmin", "handleSalonWebhook(supabaseAdmin"].map((t) => wh.indexOf(t));
    assert.ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || order[i - 1] < v), "ordre : " + order.join(","));
  });
  await test("plateforme : toujours ≤ 12 fonctions Vercel (le nouveau fichier api/ commence par « _ »)", () => {
    const fns = [...fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js") && !f.startsWith("_")),
      ...fs.readdirSync(path.join(root, "api", "admin")).filter((f) => f.endsWith(".js") && !f.startsWith("_"))];
    assert.ok(fns.length <= 12, fns.length + " fonctions : " + fns.join(", "));
    assert.ok(fs.existsSync(path.join(root, "api", "_salon-abonnement.js")));
  });
  await test("service worker : version de cache relevée et nouveau fichier mis en cache", () => {
    const sw = read("sw.js");
    assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 105);
    assert.ok(sw.includes('"/salon-abonnement.js"'));
    ["chat.html", "discussions.html"].forEach((p) => assert.ok(read(p).includes('<script src="salon-abonnement.js"></script>'), p));
  });
  await test("pages : DOM construit sans innerHTML pour les forfaits (admin et salon), aucune clé ni donnée réelle", () => {
    const admin = read("admin/rooms.html");
    const part = admin.slice(admin.indexOf("function forfaitField"), admin.indexOf("async function init()"));
    assert.ok(part.length > 500 && !/innerHTML/.test(part), "écran des forfaits sans innerHTML");
    const page = read("chat.html");
    assert.ok(!/innerHTML/.test(page.slice(page.indexOf("async function showSubscriptionPlans"), page.indexOf("async function checkRoomAccess"))));
    for (const f of ["api/_salon-abonnement.js", "salon-abonnement.js", "salons-abonnement.sql", "salons-abonnement-rollback.sql", "salons-abonnement-verification.sql"]) {
      const txt = read(f);
      assert.ok(!/(sk_(live|test)_|whsec_|\+?\d{9,})/.test(txt.replace(/10000000|2147000000|1798[0-9]+/g, "")), f);
    }
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
