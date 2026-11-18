/* Tests serveur du paiement de l'Institut (PR 4) : api/_institut-paiement.js, branches de fedapay-checkout.js et fedapay-webhook.js.
   Aucun SQL exécuté, aucun appel réseau, aucune clé réelle. Les modules « fedapay » et « @supabase/supabase-js » sont de faux
   modules dans un dossier temporaire ; la base est une maquette en mémoire qui reproduit le contrat des fonctions SQL
   (institut_confirmer_paiement / institut_echouer_paiement : voir institut-paiements.sql). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const NOW = Date.parse("2026-12-01T10:00:00Z");
const USER = "user-parrain-1", OTHER = "user-autre-2", PF = "user-petit-fils-3", ADMIN = "user-admin-4";
const D1 = "11111111-1111-4111-8111-111111111111", D2 = "22222222-2222-4222-8222-222222222222", D3 = "33333333-3333-4333-8333-333333333333";
const FORM = "formation-fictive", FORM2 = "formation-fictive-2", PRICE = 1234;
const ENFANT = "Prenom-Enfant-Fictif";

function makeDb(extra) {
  const db = Object.assign({
    institut_contenus: [{ cle: "ouvert", valeur: "oui" }],
    institut_formations: [{ formation_id: FORM, prix_institut: PRICE, actif: true }, { formation_id: FORM2, prix_institut: 500, actif: false }],
    formations: [{ id: FORM, nom: "Formation fictive" }],
    institut_demandes: [
      { id: D1, parrain_id: USER, statut: "validee", prenom: ENFANT, formation: FORM },
      { id: D2, parrain_id: USER, statut: "en_attente", prenom: ENFANT, formation: FORM },
      { id: D3, parrain_id: OTHER, statut: "validee", prenom: ENFANT, formation: FORM }],
    institut_places: [], institut_petits_fils: [{ user_id: PF }], purchases: [],
    profiles: [{ id: USER, username: "Parrain", role: "user" }, { id: OTHER, username: "Autre", role: "user" }, { id: PF, username: "PF", role: "user" }, { id: ADMIN, username: "Adm", role: "admin" }],
    institut_paiements: [], rpcCalls: [], inserts: []
  }, extra || {});
  let n = 0;
  const users = { "jeton-parrain": { id: USER, email: "p@exemple.test" }, "jeton-autre": { id: OTHER, email: "a@exemple.test" }, "jeton-pf": { id: PF, email: "f@exemple.test" },
    "jeton-admin": { id: ADMIN, email: "m@exemple.test" }, "jeton-anonyme": { id: "anon-1", is_anonymous: true } };
  function builder(table) {
    const st = { f: [], op: "select", payload: null, head: false };
    const api = {
      select(cols, opts) { st.head = !!(opts && opts.head); return api; },
      eq(c, v) { st.f.push(["eq", c, v]); return api; },
      gte(c, v) { st.f.push(["gte", c, v]); return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; },
      maybeSingle() { st.single = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    const match = (r) => st.f.every(([k, c, v]) => (k === "eq" ? r[c] === v : String(r[c]) >= String(v)));
    function run() {
      if (db.failRead === table) return { data: null, error: { message: "lecture échouée" } };
      const rows = db[table] = db[table] || [];
      if (st.op === "insert") {
        db.inserts.push({ table, row: st.payload });
        if (db.failInsert === table) return { data: null, error: { message: "insert échoué" } };
        rows.push(Object.assign({ id: "row-" + (++n), cree_le: new Date(db.now || NOW).toISOString() }, st.payload));
        return { data: null, error: null };
      }
      const out = rows.filter(match);
      if (st.head) return { data: null, count: out.length, error: null };
      if (st.single) return { data: out[0] ? Object.assign({}, out[0]) : null, error: null };
      return { data: out.map((r) => Object.assign({}, r)), error: null };
    }
    return api;
  }
  // Reproduit institut-paiements.sql (confirmer / échouer / fonctions internes)
  function rpc(name, a) {
    db.rpcCalls.push({ name, args: a });
    const p = db.institut_paiements.find((x) => x.fedapay_transaction_id === a.p_transaction_id);
    if (name === "institut_echouer_paiement") { const ok = !!p && p.statut === "en_attente"; if (ok) p.statut = "echoue"; return Promise.resolve({ data: ok, error: null }); }
    if (db.failRpc) return Promise.resolve({ data: null, error: { message: "panne" } });
    if (!p) return Promise.resolve({ data: { resultat: "introuvable" }, error: null });
    if (p.statut === "paye") return Promise.resolve({ data: { resultat: "deja_confirme" }, error: null });
    if (p.statut !== "en_attente") return Promise.resolve({ data: { resultat: "ignore" }, error: null });
    if (p.montant !== a.p_montant) { p.statut = "echoue"; p.note = "montant_incoherent"; return Promise.resolve({ data: { resultat: "montant_incoherent" }, error: null }); }
    let r = "ok";
    if (p.type === "parrain") {
      const d = db.institut_demandes.find((x) => x.id === p.demande_id);
      if (!d || d.statut !== "validee") r = "demande_non_validee";
      else if (db.institut_places.some((x) => x.demande_id === p.demande_id)) r = "place_deja_existante";
      else { const pl = { id: "pl-" + (++n), demande_id: p.demande_id, formation_id: p.formation_id, source: "payee", don_id: null, code: "ABCD2345" }; db.institut_places.push(pl); p.place_id = pl.id; }
    } else if (db.purchases.some((x) => x.user_id === p.user_id && x.course_id === p.formation_id && x.product_type === "formation" && x.status === "paid")) r = "deja_possedee";
    else db.purchases.push({ user_id: p.user_id, course_id: p.formation_id, amount: p.montant, status: "paid", product_type: "formation", fedapay_transaction_id: p.fedapay_transaction_id });
    p.statut = "paye"; p.note = r === "ok" ? null : r;
    return Promise.resolve({ data: { resultat: "confirme", type: p.type, anomalie: r === "ok" ? null : r }, error: null });
  }
  db.client = { from: builder, rpc, auth: { getUser: async (t) => (users[t] ? { data: { user: users[t] }, error: null } : { data: null, error: { message: "jeton invalide" } }) } };
  return db;
}
const fakeRes = () => ({ headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

let ctx;
function setup() {
  if (ctx) return ctx;
  ctx = (async () => {
    Object.assign(process.env, { FEDAPAY_SECRET_KEY: "cle-fictive-pour-les-tests", FEDAPAY_ENVIRONMENT: "sandbox", PUBLIC_SITE_URL: "https://exemple.test",
      SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "service-fictive", SUPABASE_ANON_KEY: "anon-fictive", FEDAPAY_WEBHOOK_SECRET: "secret-fictif" });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "institut-paiement-test-"));
    fs.cpSync(path.join(root, "api"), path.join(tmp, "api"), { recursive: true });
    fs.copyFileSync(path.join(root, "brand.js"), path.join(tmp, "brand.js"));
    const mk = (name, code) => { const d = path.join(tmp, "node_modules", ...name.split("/")); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" })); fs.writeFileSync(path.join(d, "index.js"), code); };
    mk("fedapay", `exports.FedaPay = { setApiKey(){}, setEnvironment(){} };
      exports.Webhook = { constructEvent(raw, sig) { if (sig !== 'signature-valide') throw new Error('signature invalide'); const b = JSON.parse(raw); return { name: 'transaction.approved', entity: { id: b.id } }; } };
      exports.Transaction = { retrieve: async (id) => { const t = globalThis.__FEDAPAY[String(id)]; if (!t) throw new Error('introuvable'); return t; } };`);
    mk("@supabase/supabase-js", `exports.createClient = () => globalThis.__DB.client;`);
    const checkout = (await import(pathToFileURL(path.join(tmp, "api", "fedapay-checkout.js")).href)).default;
    const webhook = (await import(pathToFileURL(path.join(tmp, "api", "fedapay-webhook.js")).href)).default;
    const helper = await import(pathToFileURL(path.join(tmp, "api", "_institut-paiement.js")).href);
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => ({ "v1/transaction": { id: 7001 + calls.length, payment_url: "https://paiement.exemple.test/abc" } }) }; };
    const call = async (db, body, token) => {
      globalThis.__DB = db; calls.length = 0;
      const res = fakeRes();
      await checkout({ method: "POST", headers: { host: "exemple.test", authorization: "Bearer " + (token === undefined || token === null ? "jeton-parrain" : token) }, body }, res);
      return res;
    };
    const send = async (db, body, signature) => {
      globalThis.__DB = db;
      const req = new EventEmitter(); req.method = "POST"; req.headers = signature === null ? {} : { "x-fedapay-signature": signature || "signature-valide" };
      const res = fakeRes(); const p = webhook(req, res);
      setImmediate(() => { req.emit("data", JSON.stringify(body)); req.emit("end"); });
      await p; return res;
    };
    return { call, send, calls, helper };
  })();
  return ctx;
}
const PARRAIN = (extra) => Object.assign({ productType: "institut", cas: "parrain", demandeId: D1, formationId: FORM }, extra || {});
const PETIT = (extra) => Object.assign({ productType: "institut", cas: "petit_fils", formationId: FORM }, extra || {});

test("checkout parrain : prix relu en base (le montant du navigateur est IGNORÉ), instantané enregistré, aucun nom d'enfant envoyé à FedaPay", async () => {
  const { call, calls } = await setup(); const db = makeDb();
  const res = await call(db, PARRAIN({ montant: 1, amount: 1, prix: 1, prix_institut: 1 }));
  assert.strictEqual(res.code, 200); assert.strictEqual(res.body.checkoutUrl, "https://paiement.exemple.test/abc");
  assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].body.amount, PRICE);
  assert.ok(!JSON.stringify(calls[0].body).includes(ENFANT), "aucun prénom d'enfant chez FedaPay");
  assert.strictEqual(calls[0].body.callback_url, "https://exemple.test/institut-retour.html");
  assert.strictEqual(db.institut_paiements.length, 1);
  const p = db.institut_paiements[0];
  assert.deepStrictEqual([p.type, p.user_id, p.demande_id, p.formation_id, p.montant, p.statut], ["parrain", USER, D1, FORM, PRICE, "en_attente"]);
  assert.strictEqual(db.purchases.length, 0, "aucun accès avant le webhook"); assert.strictEqual(db.institut_places.length, 0);
});

test("checkout petit-fils : prix de la base, formation du catalogue, aucune ligne purchases avant le webhook", async () => {
  const { call, calls } = await setup(); const db = makeDb();
  const res = await call(db, PETIT({ montant: 5 }), "jeton-pf");
  assert.strictEqual(res.code, 200); assert.strictEqual(calls[0].body.amount, PRICE);
  assert.deepStrictEqual([db.institut_paiements[0].type, db.institut_paiements[0].demande_id, db.institut_paiements[0].montant], ["petit_fils", null, PRICE]);
  assert.strictEqual(db.purchases.length, 0);
});

test("checkout : cas interdits refusés SANS appel FedaPay ni écriture", async () => {
  const { call, calls } = await setup();
  const cases = [
    ["sans jeton", {}, PARRAIN(), "", 401],
    ["jeton invalide", {}, PARRAIN(), "jeton-faux", 401],
    ["compte anonyme", {}, PARRAIN(), "jeton-anonyme", 403],
    ["type inconnu", {}, PARRAIN({ cas: "autre" }), null, 400],
    ["formation invalide", {}, PARRAIN({ formationId: "a b" }), null, 400],
    ["demande invalide", {}, PARRAIN({ demandeId: "x" }), null, 400],
    ["demande d'un AUTRE parrain", {}, PARRAIN({ demandeId: D3 }), null, 404],
    ["demande inexistante", {}, PARRAIN({ demandeId: "99999999-9999-4999-8999-999999999999" }), null, 404],
    ["demande non validée", {}, PARRAIN({ demandeId: D2 }), null, 409],
    ["place déjà existante", { institut_places: [{ id: "pl", demande_id: D1 }] }, PARRAIN(), null, 409],
    ["formation inactive", {}, PARRAIN({ formationId: FORM2 }), null, 400],
    ["formation hors catalogue", {}, PARRAIN({ formationId: "inconnue" }), null, 400],
    ["prix absent / invalide", { institut_formations: [{ formation_id: FORM, prix_institut: 0, actif: true }] }, PARRAIN(), null, 400],
    ["prix non entier", { institut_formations: [{ formation_id: FORM, prix_institut: 12.5, actif: true }] }, PARRAIN(), null, 400],
    ["Institut fermé (parrain)", { institut_contenus: [{ cle: "ouvert", valeur: "non" }] }, PARRAIN(), null, 403],
    ["Institut fermé : réglage absent", { institut_contenus: [] }, PARRAIN(), null, 403],
    ["petit-fils non marqué", {}, PETIT(), "jeton-autre", 403],
    ["petit-fils : déjà possédée", { purchases: [{ user_id: PF, course_id: FORM, product_type: "formation", status: "paid" }] }, PETIT(), "jeton-pf", 409],
    ["trop de paiements en attente", { institut_paiements: Array.from({ length: 5 }, (_, i) => ({ id: "x" + i, user_id: USER, statut: "en_attente", cree_le: new Date(NOW).toISOString(), fedapay_transaction_id: "t" + i })) }, PARRAIN(), null, 429]
  ];
  for (const [nom, extra, body, token, code] of cases) {
    const db = makeDb(Object.assign({ now: NOW }, extra)); const before = db.institut_paiements.length;
    const res = await call(db, body, token);
    assert.strictEqual(res.code, code, nom);
    assert.strictEqual(calls.length, 0, nom + " : aucun appel FedaPay"); assert.strictEqual(db.institut_paiements.length, before, nom + " : rien d'écrit");
  }
});

test("checkout : l'administrateur peut tester même Institut fermé ; transaction orpheline si l'enregistrement échoue → refus", async () => {
  const { call } = await setup();
  let db = makeDb({ institut_contenus: [{ cle: "ouvert", valeur: "non" }], institut_demandes: [{ id: D1, parrain_id: ADMIN, statut: "validee", formation: FORM }] });
  assert.strictEqual((await call(db, PARRAIN(), "jeton-admin")).code, 200);
  db = makeDb({ failInsert: "institut_paiements" });
  const res = await call(db, PARRAIN()); assert.strictEqual(res.code, 500); assert.match(res.body.error, /Réessaie/);
});

test("checkout : pas de clé FedaPay → 500 propre ; la méthode du helper n'est appelée que pour productType « institut »", async () => {
  const { call } = await setup(); const key = process.env.FEDAPAY_SECRET_KEY;
  delete process.env.FEDAPAY_SECRET_KEY;
  try { assert.strictEqual((await call(makeDb(), PARRAIN())).code, 500); } finally { process.env.FEDAPAY_SECRET_KEY = key; }
  assert.match(read("api/fedapay-checkout.js"), /productType === "institut"/);
});

function pending(db, extra) { db.institut_paiements.push(Object.assign({ id: "p1", type: "parrain", user_id: USER, demande_id: D1, formation_id: FORM, montant: PRICE, fedapay_transaction_id: "9001", statut: "en_attente" }, extra || {})); return db; }
const OFFICIAL = (extra) => { globalThis.__FEDAPAY = Object.assign({ "9001": { status: "approved", amount: PRICE } }, extra || {}); };

test("webhook parrain : crée UNE place « payee » avec code ; reçu deux fois → une seule place (idempotence)", async () => {
  const { send } = await setup(); const db = pending(makeDb()); OFFICIAL();
  let res = await send(db, { id: 9001 }); assert.strictEqual(res.code, 200); assert.strictEqual(res.body.status, "confirme");
  assert.strictEqual(db.institut_places.length, 1);
  assert.deepStrictEqual([db.institut_places[0].source, db.institut_places[0].don_id, db.institut_places[0].demande_id], ["payee", null, D1]);
  assert.match(db.institut_places[0].code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  res = await send(db, { id: 9001 }); assert.strictEqual(res.code, 200); assert.strictEqual(res.body.already_confirmed, true);
  assert.strictEqual(db.institut_places.length, 1); assert.strictEqual(db.institut_paiements[0].statut, "paye");
});

test("webhook petit-fils : crée UN accès (purchases paid, montant = prix) ; deux fois → un seul achat", async () => {
  const { send } = await setup(); const db = pending(makeDb(), { type: "petit_fils", demande_id: null, user_id: PF }); OFFICIAL();
  await send(db, { id: 9001 }); await send(db, { id: 9001 });
  assert.strictEqual(db.purchases.length, 1);
  assert.deepStrictEqual([db.purchases[0].user_id, db.purchases[0].course_id, db.purchases[0].amount, db.purchases[0].status, db.purchases[0].product_type], [PF, FORM, PRICE, "paid", "formation"]);
  assert.strictEqual(db.institut_places.length, 0, "pas de code pour un petit-fils");
});

test("webhook : montant officiel ≠ prix enregistré → rejeté (400), paiement « echoue », RIEN créé", async () => {
  const { send } = await setup();
  for (const amount of [PRICE - 1, PRICE + 1, 1, 0, NaN]) {
    const db = pending(makeDb()); OFFICIAL({ "9001": { status: "approved", amount } });
    const res = await send(db, { id: 9001 });
    assert.strictEqual(res.code, 400, String(amount)); assert.strictEqual(db.institut_places.length, 0); assert.strictEqual(db.purchases.length, 0);
    assert.strictEqual(db.institut_paiements[0].statut, "echoue");
  }
});

test("webhook : même un prix catalogue modifié entre-temps ne change pas le paiement (instantané du checkout)", async () => {
  const { send } = await setup(); const db = pending(makeDb()); db.institut_formations[0].prix_institut = 99999; OFFICIAL();
  assert.strictEqual((await send(db, { id: 9001 })).code, 200); assert.strictEqual(db.institut_places.length, 1);
});

test("webhook : refusé/annulé → « echoue » sans accès ; en attente → rien ; signature invalide → 400 sans écriture ; transaction inconnue → 404", async () => {
  const { send } = await setup();
  for (const status of ["declined", "canceled"]) {
    const db = pending(makeDb()); OFFICIAL({ "9001": { status, amount: PRICE } });
    const res = await send(db, { id: 9001 }); assert.strictEqual(res.body.status, "echoue"); assert.strictEqual(db.institut_places.length, 0);
    assert.strictEqual(db.institut_paiements[0].statut, "echoue");
  }
  let db = pending(makeDb()); OFFICIAL({ "9001": { status: "pending", amount: PRICE } });
  assert.strictEqual((await send(db, { id: 9001 })).body.status, "en_attente"); assert.strictEqual(db.institut_paiements[0].statut, "en_attente");
  db = pending(makeDb()); OFFICIAL();
  assert.strictEqual((await send(db, { id: 9001 }, "signature-forgee")).code, 400); assert.strictEqual(db.rpcCalls.length, 0); assert.strictEqual(db.institut_places.length, 0);
  db = makeDb(); OFFICIAL({ "5555": { status: "approved", amount: PRICE } });
  assert.strictEqual((await send(db, { id: 5555 })).code, 404, "transaction inconnue : comportement d'origine");
});

test("webhook : anomalie (demande plus validée / place déjà là / formation déjà possédée) → payé avec NOTE, rien de doublé", async () => {
  const { send } = await setup();
  let db = pending(makeDb()); db.institut_demandes[0].statut = "refusee"; OFFICIAL();
  assert.strictEqual((await send(db, { id: 9001 })).code, 200); assert.strictEqual(db.institut_places.length, 0); assert.strictEqual(db.institut_paiements[0].note, "demande_non_validee");
  db = pending(makeDb(), { type: "parrain" }); db.institut_places.push({ id: "pl0", demande_id: D1, source: "offerte" }); OFFICIAL();
  await send(db, { id: 9001 }); assert.strictEqual(db.institut_places.length, 1); assert.strictEqual(db.institut_paiements[0].note, "place_deja_existante");
  db = pending(makeDb({ purchases: [{ user_id: PF, course_id: FORM, product_type: "formation", status: "paid" }] }), { type: "petit_fils", demande_id: null, user_id: PF }); OFFICIAL();
  await send(db, { id: 9001 }); assert.strictEqual(db.purchases.length, 1); assert.strictEqual(db.institut_paiements[0].note, "deja_possedee");
});

test("webhook : panne technique de la confirmation → 500 (FedaPay réessaiera), paiement toujours « en attente »", async () => {
  const { send } = await setup(); const db = pending(makeDb()); db.failRpc = true; OFFICIAL();
  const res = await send(db, { id: 9001 }); assert.strictEqual(res.code, 500); assert.strictEqual(db.institut_paiements[0].statut, "en_attente");
});

test("branches : checkout et webhook n'ont QUE la délégation ; ordre du webhook inchangé ; le helper ne lit jamais le montant du corps", () => {
  const w = read("api/fedapay-webhook.js");
  assert.ok(w.indexOf("handleSerigraphieWebhook(supabaseAdmin") < w.indexOf("handleEntrepriseWebhook(supabaseAdmin") && w.indexOf("handleEntrepriseWebhook(supabaseAdmin") < w.indexOf("handleSalonWebhook(supabaseAdmin") && w.indexOf("handleSalonWebhook(supabaseAdmin") < w.indexOf("handleInstitutWebhook(supabaseAdmin"));
  const h = read("api/_institut-paiement.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.ok(!/body\.(montant|amount|prix|price)/i.test(h));
  assert.ok(!/innerHTML/.test(h));
});

test("helper seul (base trop laxiste simulée) : montant différent → AUCUN appel de confirmation ; déjà payé → AUCUN appel", async () => {
  const { helper } = await setup();
  const log = () => {};
  const lax = (statut) => { const calls = []; return { calls, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p", statut, montant: PRICE }, error: null }) }) }) }), rpc: async (n) => { calls.push(n); return { data: { resultat: "confirme" }, error: null }; } }; };
  let db = lax("en_attente");
  let r = await helper.handleInstitutWebhook(db, { transactionId: 1, officialStatus: "approved", officialAmount: PRICE - 1, log });
  assert.strictEqual(r.status, 400); assert.deepStrictEqual(db.calls, ["institut_echouer_paiement"], "jamais de confirmation");
  db = lax("paye");
  r = await helper.handleInstitutWebhook(db, { transactionId: 1, officialStatus: "approved", officialAmount: PRICE, log });
  assert.strictEqual(r.body.already_confirmed, true); assert.deepStrictEqual(db.calls, []);
  db = lax("en_attente");
  r = await helper.handleInstitutWebhook(db, { transactionId: 1, officialStatus: "approved", officialAmount: PRICE, log });
  assert.deepStrictEqual(db.calls, ["institut_confirmer_paiement"]); assert.strictEqual(r.body.status, "confirme");
});
