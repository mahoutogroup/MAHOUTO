/* Parcours d'achat depuis un lien de salon payant : retour de paiement dans le salon, refus des comptes anonymes.
   Exécution : node tests/payment-return.test.js — aucune dépendance, aucun réseau, aucune base.
   La fonction api/fedapay-checkout.js est exécutée pour de vrai avec un faux client Supabase et un faux fetch. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Pay = require("../payment-return");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const script = (html) => html.slice(html.indexOf("<script>"));

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

// ---------- fonction de paiement réelle, avec un faux Supabase ----------
function setupCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkout-test-"));
  fs.cpSync(path.join(root, "api"), path.join(dir, "api"), { recursive: true });
  fs.copyFileSync(path.join(root, "brand.js"), path.join(dir, "brand.js"));
  const mod = path.join(dir, "node_modules", "@supabase", "supabase-js");
  fs.mkdirSync(mod, { recursive: true });
  fs.writeFileSync(path.join(mod, "package.json"), '{"name":"@supabase/supabase-js","version":"0.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(mod, "index.js"), `
const USERS = {
  "tok-real": { id: "user-real", email: "vrai@exemple.com", is_anonymous: false },
  "tok-anon": { id: "user-anon", email: null, is_anonymous: true },
  "tok-meta": { id: "user-meta", email: null, app_metadata: { provider: "anonymous" } }
};
exports.createClient = (url, key) => {
  const isAdmin = key === "SERVICE-KEY";
  return {
    auth: { getUser: async (t) => { global.__calls.push({ op: "getUser" }); return USERS[t] ? { data: { user: USERS[t] }, error: null } : { data: null, error: { message: "invalide" } }; } },
    from: (table) => {
      const q = { table, admin: isAdmin };
      const api = {
        select() { return api; }, eq() { return api; }, gte() { return api; },
        maybeSingle: async () => { global.__calls.push({ op: "read", table }); return { data: (global.__tables[table] || {}).row || null, error: null }; },
        insert: async (row) => { global.__calls.push({ op: "insert", table, row }); return { error: null }; },
        then(res) { global.__calls.push({ op: "count", table }); return Promise.resolve({ count: 0, error: null }).then(res); }
      };
      return api;
    }
  };
};`);
  return dir;
}

function fakeRes() {
  return { headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

(async () => {
  // ---------- module de retour de paiement ----------
  await test("retour de paiement : payment=return reconnu (et seulement lui)", () => {
    ["?room=vip&payment=return", "?payment=return", "?room=vip&payment=return&id=12&status=approved"].forEach((s) => assert.strictEqual(Pay.isPaymentReturn(s), true, s));
    ["", "?room=vip", "?payment=returned", "?mypayment=return", "?payment=cancel", undefined, null].forEach((s) => assert.strictEqual(Pay.isPaymentReturn(s), false, String(s)));
  });

  await test("décision : paid → entrer ; failed → message ; pending ou rien → attendre, puis délai dépassé", () => {
    assert.strictEqual(Pay.decide("paid", 0).kind, "paid");
    assert.strictEqual(Pay.decide("failed", 3).kind, "failed");
    assert.match(Pay.decide("failed", 3).message, /échoué ou a été annulé/);
    for (const st of ["pending", null, undefined, "bizarre"]) {
      const d = Pay.decide(st, 0);
      assert.strictEqual(d.kind, "wait");
      assert.strictEqual(d.message, "Paiement en cours de vérification… Ne ferme pas cette page.");
      assert.strictEqual(d.delayMs, Pay.DELAY_MS);
    }
    assert.strictEqual(Pay.decide("pending", Pay.MAX_ATTEMPTS - 1).kind, "wait");
    assert.strictEqual(Pay.decide("pending", Pay.MAX_ATTEMPTS).kind, "timeout");
    assert.match(Pay.decide("pending", Pay.MAX_ATTEMPTS).message, /pas encore confirmé/);
    const total = Pay.MAX_ATTEMPTS * Pay.DELAY_MS;
    assert.ok(total >= 20000 && total <= 60000, "délai total raisonnable : " + total + " ms");
  });

  await test("simulation : le webhook arrive au 4e essai → l'accès s'ouvre ; jamais d'accès sans « paid »", () => {
    const statuses = ["pending", "pending", "pending", "paid"];
    const log = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = Pay.decide(statuses[Math.min(attempt, 3)], attempt);
      log.push(d.kind);
      if (d.kind !== "wait") break;
    }
    assert.deepStrictEqual(log, ["wait", "wait", "wait", "paid"]);
    const never = []; for (let a = 0; a <= Pay.MAX_ATTEMPTS + 2; a++) { const d = Pay.decide("pending", a); never.push(d.kind); if (d.kind !== "wait") break; }
    assert.ok(!never.includes("paid"));
    assert.strictEqual(never[never.length - 1], "timeout");
  });

  await test("lecture de l'achat le plus récent : statut ou erreur, ses propres achats de salon seulement", async () => {
    const calls = [];
    const mk = (res) => ({ from(t) { calls.push(["from", t]); const api = { select() { return api; }, eq(c, v) { calls.push([c, v]); return api; }, order(c, o) { calls.push(["order", c, o.ascending]); return api; }, limit(n) { calls.push(["limit", n]); return api; }, maybeSingle: async () => res }; return api; } });
    assert.deepStrictEqual(await Pay.latestPurchaseStatus(mk({ data: { status: "pending" }, error: null }), "U", "vip"), { status: "pending", error: null });
    assert.deepStrictEqual(calls.filter((c) => c[0] === "eq" || ["user_id", "course_id", "product_type"].includes(c[0])).map((c) => c.join("=")), ["user_id=U", "course_id=vip", "product_type=salon"]);
    assert.ok(calls.some((c) => c[0] === "order" && c[1] === "created_at" && c[2] === false) && calls.some((c) => c[0] === "limit" && c[1] === 1));
    assert.deepStrictEqual(await Pay.latestPurchaseStatus(mk({ data: null, error: null }), "U", "vip"), { status: null, error: null });
    const err = await Pay.latestPurchaseStatus(mk({ data: null, error: { code: "x" } }), "U", "vip");
    assert.strictEqual(err.status, null);
    assert.ok(err.error);
    assert.strictEqual(Pay.cleanPath("/chat.html", "vip"), "/chat.html?room=vip");
  });

  // ---------- api/fedapay-checkout.js : exécution réelle ----------
  const dir = setupCheckout();
  Object.assign(process.env, {
    SUPABASE_URL: "https://x.supabase.test", SUPABASE_ANON_KEY: "ANON-KEY", SUPABASE_SERVICE_ROLE_KEY: "SERVICE-KEY",
    FEDAPAY_SECRET_KEY: "sk_test_x", FEDAPAY_ENVIRONMENT: "sandbox", PUBLIC_SITE_URL: "https://mahouto.com"
  });
  const { default: checkout } = await import(pathToFileURL(path.join(dir, "api", "fedapay-checkout.js")).href);
  const realFetch = global.fetch;
  function reset(tables) {
    global.__calls = []; global.__tables = tables || {};
    global.__fedapay = [];
    global.fetch = async (url, init) => {
      global.__fedapay.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ "v1/transaction": { id: 4242, payment_url: "https://pay.test/checkout" } }) };
    };
  }
  const post = async (body, token, extra) => {
    const res = fakeRes();
    await checkout({ method: "POST", headers: Object.assign({ authorization: token ? "Bearer " + token : "", host: "mahouto.com" }, extra || {}), body }, res);
    return res;
  };
  const VIP = { id: "vip", name: "Salon VIP", is_paid: true, price: 2000 };

  await test("compte anonyme (is_anonymous) : 403 et message exact, AUCUNE lecture d'article, AUCUN appel FedaPay", async () => {
    reset({ rooms: { row: VIP } });
    const res = await post({ courseId: "vip", productType: "salon" }, "tok-anon");
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.body, { error: "Connecte-toi avec Google ou ton e-mail pour acheter.", code: "ANONYMOUS_NOT_ALLOWED" });
    assert.deepStrictEqual(global.__calls.map((c) => c.op), ["getUser"], "seul le jeton est vérifié");
    assert.strictEqual(global.__fedapay.length, 0);
  });

  await test("compte anonyme repéré par app_metadata.provider : refusé aussi ; tous les types d'achat sont concernés", async () => {
    for (const productType of ["salon", "formation", "digital_product"]) {
      reset({ rooms: { row: VIP } });
      const res = await post({ courseId: "vip", productType }, "tok-meta");
      assert.strictEqual(res.statusCode, 403, productType);
      assert.strictEqual(res.body.code, "ANONYMOUS_NOT_ALLOWED");
      assert.strictEqual(global.__fedapay.length, 0);
    }
  });

  await test("compte réel, salon payant : retour de paiement DANS le salon (chat.html?room=<salon>&payment=return)", async () => {
    reset({ rooms: { row: VIP }, purchases: { row: null }, profiles: { row: { username: "Awa" } } });
    const res = await post({ courseId: "vip", productType: "salon" }, "tok-real");
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { checkoutUrl: "https://pay.test/checkout", transactionId: 4242 });
    const create = global.__fedapay.find((c) => /\/transactions$/.test(c.url));
    assert.strictEqual(create.body.callback_url, "https://mahouto.com/chat.html?room=vip&payment=return");
    assert.ok(!/discussions\.html/.test(create.body.callback_url));
  });

  await test("le montant vient toujours du serveur : un montant envoyé par le navigateur est ignoré", async () => {
    reset({ rooms: { row: VIP }, purchases: { row: null }, profiles: { row: { username: "Awa" } } });
    await post({ courseId: "vip", productType: "salon", amount: 1, price: 1, montant: 1 }, "tok-real");
    const create = global.__fedapay.find((c) => /\/transactions$/.test(c.url));
    assert.strictEqual(create.body.amount, 2000);
    const insert = global.__calls.find((c) => c.op === "insert" && c.table === "purchases");
    assert.strictEqual(insert.row.amount, 2000);
    assert.strictEqual(insert.row.status, "pending");
    assert.strictEqual(insert.row.user_id, "user-real", "l'acheteur vient du jeton, pas de la requête");
  });

  await test("salon non payant : refusé (404) ; salon introuvable : 404", async () => {
    reset({ rooms: { row: { id: "general", name: "Général", is_paid: false, price: null } } });
    let res = await post({ courseId: "general", productType: "salon" }, "tok-real");
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.error, "Ce salon n'est pas payant.");
    assert.strictEqual(global.__fedapay.length, 0);
    reset({ rooms: { row: null } });
    res = await post({ courseId: "nimporte-quoi", productType: "salon" }, "tok-real");
    assert.strictEqual(res.statusCode, 404);
  });

  await test("identifiant de salon invalide : 400 avant toute authentification ou requête ; sans jeton : 401", async () => {
    for (const bad of ["a b", "../x", "a&b", "x".repeat(65), "é", "a#b", "<b>"]) {
      reset({ rooms: { row: VIP } });
      const res = await post({ courseId: bad, productType: "salon" }, "tok-real");
      assert.strictEqual(res.statusCode, 400, bad);
      assert.strictEqual(global.__calls.length, 0, "aucune requête pour : " + bad);
      assert.strictEqual(global.__fedapay.length, 0);
    }
    reset({ rooms: { row: VIP } });
    assert.strictEqual((await post({ courseId: "vip", productType: "salon" }, null)).statusCode, 401);
    assert.strictEqual((await post({ courseId: "vip", productType: "salon" }, "tok-inconnu")).statusCode, 401);
  });

  await test("formations et produits numériques : page de retour inchangée", async () => {
    reset({ formations: { row: { id: "f1", nom: "Formation", prix: 5000, promotion: null, provider: null } }, purchases: { row: null }, profiles: { row: { username: "Awa" } } });
    await post({ courseId: "f1" }, "tok-real");
    const create = global.__fedapay.find((c) => /\/transactions$/.test(c.url));
    assert.strictEqual(create.body.callback_url, "https://mahouto.com/school.html?payment=return&course=f1&type=formation");
    assert.strictEqual(create.body.amount, 5000);
  });

  global.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });

  // ---------- chat.html ----------
  const chat = read("chat.html"), code = strip(script(chat));

  await test("chat.html : le retour de paiement n'ouvre JAMAIS l'accès par le paramètre ; seul enterRoom() (donc un achat « paid » en base) le fait", () => {
    assert.match(chat, /<script src="room-share\.js"><\/script>\s*<script src="payment-return\.js"><\/script>/);
    const verify = code.slice(code.indexOf("async function verifyPaymentReturn"), code.indexOf("async function buyRoomAccess"));
    assert.match(verify, /MahoutoPaymentReturn\.latestPurchaseStatus\(supabase, currentUser\.id, ROOM_ID\)/);
    assert.match(verify, /MahoutoPaymentReturn\.decide\(error \? "pending" : status, attempt\+\+\)/);
    assert.match(verify, /await enterRoom\(\);\s*return;/);
    assert.ok(!/composer\.classList\.remove|messagesEl\.classList\.remove|loadHistory|subscribeToNewMessages/.test(verify), "la vérification n'ouvre rien elle-même");
    // enterRoom → checkRoomAccess → hasPaidPurchase (achat « paid » en base) avant d'ouvrir le salon
    assert.match(code, /if \(await hasPaidPurchase\(\)\) return true;/);
    assert.match(code, /\.eq\("status", "paid"\)\s*\.maybeSingle\(\);\s*return !!purchase;/);
    assert.match(code, /const hasAccess = await checkRoomAccess\(room\);\s*if \(!hasAccess\) return;/);
    // aucune lecture du paramètre payment pour décider de l'accès
    const access = code.slice(code.indexOf("async function checkRoomAccess"), code.indexOf("async function verifyPaymentReturn"));
    const uses = access.split("\n").filter((l) => /paymentReturn/.test(l));
    assert.ok(uses.every((l) => !/return true/.test(l)), "paymentReturn ne sert qu'à l'affichage : " + uses.join(" | "));
  });

  await test("chat.html : paiement en attente → message « en cours de vérification » et nouvel essai ; échec → message et bouton d'achat ; délai dépassé → « Vérifier maintenant »", () => {
    const verify = code.slice(code.indexOf("async function verifyPaymentReturn"), code.indexOf("async function buyRoomAccess"));
    assert.match(verify, /decision\.kind === "wait"\) \{\s*setLockedStatus\(decision\.message, false\);\s*setTimeout\(step, decision\.delayMs\);/);
    assert.match(verify, /decision\.kind === "failed"[\s\S]*buyBtn\.classList\.remove\("hidden"\)/);
    assert.match(verify, /checkBtn\.classList\.remove\("hidden"\);\s*checkBtn\.onclick/);
    assert.match(chat, /<button id="locked-check-btn" type="button" class="hidden">Vérifier maintenant<\/button>/);
    assert.match(code, /if \(paymentReturn && !paymentVerifying\) verifyPaymentReturn\(\);/);
  });

  await test("chat.html : compte anonyme → pas de bouton d'achat, « Connecte-toi avec Google ou ton e-mail pour acheter. » et fenêtre de connexion ; refus du serveur géré", () => {
    assert.match(code, /if \(currentUser\.is_anonymous === true\) \{\s*buyBtn\.classList\.add\("hidden"\);[\s\S]*Connecte-toi avec Google ou ton e-mail pour acheter\.[\s\S]*return false;/);
    assert.match(code, /resp\.status === 403 && data\.code === "ANONYMOUS_NOT_ALLOWED"[\s\S]*openLogin\("Se connecter pour acheter"\)/);
    const buy = code.slice(code.indexOf("async function buyRoomAccess"), code.indexOf("async function enterRoom"));
    assert.ok(!/alert\(/.test(buy), "message dans la page, plus de alert");
    assert.match(buy, /body: JSON\.stringify\(\{ courseId: ROOM_ID, productType: "salon" \}\)/, "jamais de montant côté navigateur");
    assert.ok(!/amount|price|montant/i.test(buy.slice(buy.indexOf("JSON.stringify"), buy.indexOf("JSON.stringify") + 90)));
  });

  await test("chat.html : visiteur au retour de paiement (déconnecté) → invitation à se connecter, aucun message ni achat lu", () => {
    assert.match(code, /if \(paymentReturn\) setLockedStatus\(MahoutoPaymentReturn\.MSG_LOST_SESSION, false\);/);
    const visitor = code.slice(code.indexOf("if (!currentUser) {"), code.indexOf("if (room.created_by === currentUser.id)"));
    assert.ok(!/from\("purchases"\)|from\("messages"\)/.test(visitor));
  });

  await test("chat.html : une fois l'accès confirmé, l'écran du salon payant disparaît ; l'adresse est nettoyée du paramètre de retour", () => {
    assert.match(code, /document\.getElementById\("locked-screen"\)\.classList\.add\("hidden"\);\s*chatHeader\.classList\.remove\("hidden"\);/);
    assert.match(code, /window\.history\.replaceState\(null, "", MahoutoPaymentReturn\.cleanPath\(window\.location\.pathname, ROOM_ID\)\);/);
  });

  await test("api/fedapay-checkout.js : refus des comptes anonymes avant toute lecture, callback vers le salon, montant serveur, identifiant validé", () => {
    const api = strip(read("api/fedapay-checkout.js"));
    assert.ok(api.indexOf("authenticatedUser.is_anonymous === true") > api.indexOf("auth.getUser(token)"));
    assert.ok(api.indexOf("authenticatedUser.is_anonymous === true") < api.indexOf('.from(tableName)'), "refus avant la lecture de l'article");
    assert.match(api, /code: "ANONYMOUS_NOT_ALLOWED"/);
    assert.match(api, /callbackUrl = `\$\{siteUrl\}\/chat\.html\?room=\$\{encodeURIComponent\(courseId\)\}&payment=return`;/);
    assert.match(api, /productType === "salon" && !\/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(courseId\)/);
    assert.match(api, /const officialAmount = productType === "salon"\s*\? Math\.round\(Number\(article\.price\)\)/);
    assert.ok(!/req\.body\.(amount|price)|const \{[^}]*(amount|price)[^}]*\} = req\.body/.test(api), "aucun montant lu dans la requête");
  });

  await test("discussions.html : le retour des anciens paiements (discussions.html?payment=return) est conservé", () => {
    const disc = strip(script(read("discussions.html")));
    assert.match(disc, /params\.get\("payment"\) !== "return" \|\| params\.get\("type"\) !== "salon"/);
  });

  await test("pas de nouvelle fonction Vercel (12 routes) ; cache hors ligne : payment-return.js, version ≥ v95", () => {
    const fns = [];
    (function scan(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return scan(p);
        if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(path.relative(path.join(root, "api"), p));
      });
    })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12, fns.join(", "));
    const sw = read("sw.js");
    assert.match(sw, /"\/payment-return\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 95);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
