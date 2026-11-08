/* Connexion depuis un lien de salon (Google ou e-mail) et retour au salon.
   Exécution : node tests/login-sheet.test.js — aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Login = require("../login-sheet");
const Pseudo = require("../pseudo");

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

// ---------- faux DOM ----------
function fakeDoc() {
  const ids = {};
  function node(tag) {
    const classes = new Set();
    const n = {
      tag, children: [], attrs: {}, listeners: {}, _text: "", value: "", disabled: false, parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") ids[v] = this; },
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      focus() {},
      classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      get className() { return [...classes].join(" "); }, set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    return n;
  }
  const head = node("head"), body = node("body");
  return { createElement: node, createTextNode: (t) => ({ tag: "#text", _text: t, get textContent() { return t; }, parentNode: null }), getElementById: (id) => ids[id] || null, head, body };
}
const walk = (n, fn) => { fn(n); (n.children || []).forEach((c) => walk(c, fn)); };
const hasClass = (n, c) => n.classList && n.classList.contains(c);
const findByText = (n, text) => { let r = null; walk(n, (x) => { if (!r && x.tag === "button" && x.textContent === text) r = x; }); return r; };
const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; };
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  // ---------- messages d'erreur exacts ----------
  await test("erreurs d'authentification : message exact selon la cause, jamais de renvoi vers config.js", () => {
    const m = Login.authErrorMessage;
    const cases = [
      [{ message: "Failed to fetch", name: "AuthRetryableFetchError" }, "send", /Pas de connexion internet/],
      [{ message: "NetworkError when attempting to fetch resource." }, "verify", /Pas de connexion internet/],
      [{ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "send", /Trop de demandes\. Attends quelques minutes avant de redemander un code\./],
      [{ status: 429, message: "Too many requests" }, "verify", /Trop de tentatives\. Attends quelques minutes/],
      [{ status: 403, code: "otp_expired", message: "Token has expired or is invalid" }, "verify", /^Code incorrect ou expiré\. Vérifie le code ou demande-en un nouveau\.$/],
      [{ status: 400, message: "Token has expired or is invalid" }, "verify", /^Code incorrect ou expiré/],
      [{ status: 400, code: "validation_failed", message: "Unable to validate email address: invalid format" }, "send", /^Cette adresse e-mail n'est pas valide\.$/],
      [{ code: "email_address_invalid", message: "Email address is invalid" }, "send", /^Cette adresse e-mail n'est pas valide\.$/],
      [{ code: "email_address_not_authorized", message: "x" }, "send", /ne peut pas recevoir de code/],
      [{ status: 400, code: "provider_disabled", message: "Unsupported provider: provider is not enabled" }, "google", /^La connexion Google n'est pas disponible pour le moment\.$/],
      [{ code: "email_provider_disabled", message: "Email logins are disabled" }, "send", /^La connexion par e-mail n'est pas disponible pour le moment\.$/],
      [{ status: 400, code: "user_banned", message: "User is banned" }, "verify", /^Ce compte est désactivé\./],
      [{ status: 500, code: "unexpected_failure", message: "boom" }, "send", /^Connexion impossible \(code : unexpected_failure\)\. Réessaie ; si ça continue, contacte-nous\.$/],
      [{ status: 502, message: "bad gateway" }, "send", /\(code : HTTP 502\)/],
      [{}, "send", /\(code : inconnu\)/],
      [null, "google", /\(code : inconnu\)/]
    ];
    cases.forEach(([err, ctx, re]) => assert.match(m(err, ctx), re, JSON.stringify(err) + " / " + ctx));
    cases.forEach(([err, ctx]) => assert.ok(!/config\.js|Supabase|configuration/i.test(m(err, ctx))));
  });

  await test("envoi du code : jamais d'indication sur l'existence d'un compte (signup_disabled reste générique)", () => {
    const msg = Login.authErrorMessage({ status: 422, code: "signup_disabled", message: "Signups not allowed for otp" }, "send");
    assert.match(msg, /^Connexion impossible \(code : signup_disabled\)/);
    assert.ok(!/compte|existe|inscri/i.test(msg.replace("signup_disabled", "")));
  });

  await test("retour de Google en erreur (?error= / #error=) : message exact, annulation reconnue", () => {
    assert.strictEqual(Login.oauthErrorFromUrl({ search: "", hash: "" }), null);
    assert.strictEqual(Login.oauthErrorFromUrl({ search: "?room=general", hash: "" }), null);
    assert.strictEqual(Login.oauthErrorFromUrl({ search: "?room=general&error=access_denied&error_code=access_denied&error_description=User+denied", hash: "" }), "Connexion Google annulée.");
    assert.strictEqual(Login.oauthErrorFromUrl({ search: "", hash: "#error=access_denied&error_description=x" }), "Connexion Google annulée.");
    assert.match(Login.oauthErrorFromUrl({ search: "?error=server_error&error_description=Unable+to+exchange+external+code", hash: "" }), /^La connexion Google a échoué \(Unable to exchange external code\)\. Réessaie/);
    assert.match(Login.oauthErrorFromUrl({ search: "?error=server_error", hash: "" }), /\(code : server_error\)/);
    assert.match(Login.oauthErrorFromUrl({ search: "?error_code=user_banned&error=forbidden", hash: "" }), /Ce compte est désactivé/);
    assert.ok(Login.oauthErrorFromUrl({ search: "?error=x&error_description=" + "a".repeat(500), hash: "" }).length < 260, "description tronquée");
  });

  await test("longueur du code : celle de index.html (maxlength, slice, contrôle, libellé), sans la figer à part", () => {
    const idx = read("index.html");
    const maxlen = Number(idx.match(/id="code-input"[\s\S]*?maxlength="(\d+)"/)[1]);
    const slice = Number(idx.match(/codeInput\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, (\d+)\)/)[1]);
    const check = Number(idx.match(/code\.length !== (\d+)/)[1]);
    assert.deepStrictEqual([maxlen, slice, check], [Login.CODE_LENGTH, Login.CODE_LENGTH, Login.CODE_LENGTH]);
    assert.match(idx, new RegExp("code à " + Login.CODE_LENGTH + " chiffres"));
  });

  // ---------- destination de retour ----------
  await test("destination de retour : seule « chat.html?room=<id> » est acceptée (aucune redirection ouverte)", () => {
    ["chat.html?room=general", "chat.html?room=salon-1700000000000", "chat.html?room=a_b-c"].forEach((p) => assert.strictEqual(Login.validateReturn(p), p));
    ["https://evil.test/", "//evil.test", "javascript:alert(1)", "/chat.html?room=x", "chat.html?room=a&x=1", "chat.html?room=", "chat.html?room=a b",
      "chat.html?room=../x", "index.html", "chat.html", "chat.html?room=" + "a".repeat(65), "chat.html?room=a#x", null, undefined, 5, "chat.html?room=<b>"]
      .forEach((p) => assert.strictEqual(Login.validateReturn(p), null, String(p)));
  });

  await test("destination de secours : mémorisée, valable 10 minutes, usage unique", () => {
    const st = memStorage();
    assert.strictEqual(Login.rememberReturn("general", st, 1000), true);
    assert.strictEqual(Login.consumeReturn(st, 1000 + 60000), "chat.html?room=general");
    assert.strictEqual(Login.consumeReturn(st, 1000 + 60000), null, "usage unique");
    Login.rememberReturn("general", st, 1000);
    assert.strictEqual(Login.consumeReturn(st, 1000 + Login.RETURN_TTL_MS + 1), null, "expirée");
    assert.strictEqual(st.getItem(Login.RETURN_KEY), null, "toujours effacée");
    assert.strictEqual(Login.rememberReturn("a&b=c", st, 1), false, "identifiant piégé refusé");
    st.setItem(Login.RETURN_KEY, JSON.stringify({ path: "https://evil.test/", t: Date.now() }));
    assert.strictEqual(Login.consumeReturn(st), null, "valeur falsifiée refusée");
    st.setItem(Login.RETURN_KEY, "pas du json");
    assert.strictEqual(Login.consumeReturn(st), null);
    const broken = { getItem() { throw new Error("stockage indisponible"); }, setItem() { throw new Error("x"); }, removeItem() {} };
    assert.strictEqual(Login.consumeReturn(broken), null);
    assert.strictEqual(Login.rememberReturn("general", broken), false);
  });

  // ---------- fenêtre ----------
  function fakeSupabase(over) {
    const calls = { otp: [], verify: [], oauth: [] };
    const o = over || {};
    return {
      calls,
      auth: {
        signInWithOtp: async (a) => { calls.otp.push(a); return o.otp ? o.otp() : { error: null }; },
        verifyOtp: async (a) => { calls.verify.push(a); return o.verify ? o.verify() : { data: { user: { id: "U1" }, session: { user: { id: "U1" } } }, error: null }; },
        signInWithOAuth: async (a) => { calls.oauth.push(a); return o.oauth ? o.oauth() : { data: {}, error: null }; }
      }
    };
  }
  const win = () => ({ location: { origin: "https://mahouto.com" }, sessionStorage: memStorage() });

  await test("fenêtre : adresse invalide refusée avant tout envoi ; envoi du code → étape du code (même fonctionnement que l'accueil)", async () => {
    const doc = fakeDoc(), sb = fakeSupabase(), w = win();
    const sheet = Login.open({ doc, win: w, supabase: sb, roomId: "general", redirectPath: "chat.html?room=general" });
    const e = sheet.elements;
    e.emailInput.value = "pas-une-adresse"; await e.step1.listeners.submit({ preventDefault() {} });
    assert.strictEqual(e.error1.textContent, "Entre une adresse e-mail valide.");
    assert.strictEqual(sb.calls.otp.length, 0);
    e.emailInput.value = " toi@exemple.com "; await e.step1.listeners.submit({ preventDefault() {} });
    assert.deepStrictEqual(sb.calls.otp, [{ email: "toi@exemple.com" }], "signInWithOtp({ email }) comme index.html");
    assert.ok(!hasClass(e.step2, "ls-hidden") && hasClass(e.step1, "ls-hidden"));
    assert.ok(e.resendBtn.disabled, "« Renvoyer » désactivé après l'envoi");
    sheet.close();
  });

  await test("fenêtre : échecs d'envoi et de vérification → message exact affiché dans la fenêtre", async () => {
    const doc = fakeDoc(), w = win();
    let sb = fakeSupabase({ otp: () => ({ error: { status: 429, code: "over_email_send_rate_limit", message: "rate" } }) });
    let sheet = Login.open({ doc, win: w, supabase: sb });
    sheet.elements.emailInput.value = "a@b.co"; await sheet.elements.step1.listeners.submit({ preventDefault() {} });
    assert.match(sheet.elements.error1.textContent, /^Trop de demandes\./);
    assert.ok(!hasClass(sheet.elements.step1, "ls-hidden"), "reste à l'étape de l'adresse");
    sheet.close();

    sb = fakeSupabase({ verify: () => ({ error: { status: 403, code: "otp_expired", message: "Token has expired or is invalid" } }) });
    sheet = Login.open({ doc, win: w, supabase: sb });
    sheet.elements.emailInput.value = "a@b.co"; await sheet.elements.step1.listeners.submit({ preventDefault() {} });
    sheet.elements.codeInput.value = "123456";
    await sheet.elements.step2.listeners.submit({ preventDefault() {} });
    assert.deepStrictEqual(sb.calls.verify, [{ email: "a@b.co", token: "123456", type: "email" }]);
    assert.strictEqual(sheet.elements.error2.textContent, "Code incorrect ou expiré. Vérifie le code ou demande-en un nouveau.");
    sheet.elements.codeInput.value = "12";
    await sheet.elements.step2.listeners.submit({ preventDefault() {} });
    assert.strictEqual(sheet.elements.error2.textContent, "Entre le code à " + Login.CODE_LENGTH + " chiffres reçu par e-mail.");
    assert.strictEqual(sb.calls.verify.length, 1, "pas d'appel avec un code trop court");
    sheet.close();

    sb = fakeSupabase({ otp: () => { throw Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError" }); } });
    sheet = Login.open({ doc, win: w, supabase: sb });
    sheet.elements.emailInput.value = "a@b.co"; await sheet.elements.step1.listeners.submit({ preventDefault() {} });
    assert.match(sheet.elements.error1.textContent, /^Pas de connexion internet/);
    sheet.close();
  });

  await test("fenêtre : code valide → onSignedIn(user), fenêtre fermée, code effacé", async () => {
    const doc = fakeDoc(), sb = fakeSupabase(), w = win();
    let signed = null;
    const sheet = Login.open({ doc, win: w, supabase: sb, onSignedIn: async (u) => { signed = u; } });
    const e = sheet.elements;
    e.emailInput.value = "toi@exemple.com"; await e.step1.listeners.submit({ preventDefault() {} });
    e.codeInput.listeners.input.call(null);
    e.codeInput.value = "12a3b4c5d6e7";
    e.codeInput.listeners.input();
    assert.strictEqual(e.codeInput.value, "123456", "chiffres seulement, " + Login.CODE_LENGTH + " au plus");
    await e.step2.listeners.submit({ preventDefault() {} });
    assert.deepStrictEqual(signed, { id: "U1" });
    assert.strictEqual(doc.body.children.length, 0, "fenêtre fermée");
    assert.strictEqual(e.codeInput.value, "", "le code n'est pas conservé");
  });

  await test("fenêtre : Google → destination mémorisée, redirectTo = la même page ; erreur Google → message exact", async () => {
    const doc = fakeDoc(), w = win(), sb = fakeSupabase();
    let sheet = Login.open({ doc, win: w, supabase: sb, roomId: "general", redirectPath: "chat.html?room=general" });
    await sheet.elements.googleBtn.listeners.click();
    assert.deepStrictEqual(sb.calls.oauth, [{ provider: "google", options: { redirectTo: "https://mahouto.com/chat.html?room=general" } }]);
    assert.strictEqual(Login.consumeReturn(w.sessionStorage), "chat.html?room=general");
    sheet.close();

    const sb2 = fakeSupabase({ oauth: () => ({ error: { status: 400, code: "provider_disabled", message: "Unsupported provider: provider is not enabled" } }) });
    sheet = Login.open({ doc, win: w, supabase: sb2, roomId: "general", redirectPath: "chat.html?room=general" });
    await sheet.elements.googleBtn.listeners.click();
    assert.strictEqual(sheet.elements.googleError.textContent, "La connexion Google n'est pas disponible pour le moment.");
    assert.ok(!sheet.elements.googleBtn.disabled, "le bouton redevient utilisable");
    sheet.close();
  });

  await test("fenêtre : ni innerHTML, ni journal console, ni stockage de l'adresse ou du code", () => {
    const lib = strip(read("login-sheet.js"));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\./.test(lib));
    assert.ok(!/localStorage|setItem\([^)]*(email|code)/i.test(lib));
    assert.ok(!/signInAnonymously|signInWithPassword|phone/i.test(lib), "ni anonyme, ni mot de passe, ni téléphone");
  });

  // ---------- profil du nouveau compte ----------
  function fakeProfiles({ row, readError, refuse }) {
    const writes = [];
    return {
      writes,
      from() {
        return {
          select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: row === undefined ? null : row, error: readError || null }); } }; } }; },
          upsert(payload, opts) { writes.push({ op: "upsert", payload, opts }); const e = refuse ? refuse(payload.username) : null; return Promise.resolve({ error: e || null }); },
          update(payload) { return { eq() { writes.push({ op: "update", payload }); return Promise.resolve({ error: null }); } }; }
        };
      }
    };
  }
  const reserved = { message: "PSEUDO_RESERVE: x", code: "23514" };

  await test("nouveau compte : nom Google, sinon « Membre xxxxxx », jamais une adresse e-mail", async () => {
    const id = "0b3b3de9-b835-40ec-b076-22fdc3c4ab02";
    let db = fakeProfiles({ row: null });
    let r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: { full_name: "Awa Google" } });
    assert.strictEqual(r.username, "Awa Google");
    assert.deepStrictEqual(db.writes.map((w) => w.payload.username), ["Awa Google"]);
    assert.strictEqual(db.writes[0].opts.ignoreDuplicates, true);
    db = fakeProfiles({ row: null });
    r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: {}, email: "awa@exemple.com" });
    assert.strictEqual(r.username, "Membre 0b3b3d");
    db = fakeProfiles({ row: null });
    r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: { full_name: "awa@exemple.com" } });
    assert.strictEqual(r.username, "Membre 0b3b3d");
    assert.ok(!JSON.stringify(db.writes).includes("@"));
  });

  await test("profil existant ou lecture en erreur : aucune écriture ; refus de la base : pseudo neutre", async () => {
    const id = "0b3b3de9-b835-40ec-b076-22fdc3c4ab02";
    let db = fakeProfiles({ row: { username: "Mon pseudo perso" } });
    let r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: { full_name: "Autre nom" } });
    assert.deepStrictEqual([db.writes.length, r.username, r.kept], [0, "Mon pseudo perso", true]);
    db = fakeProfiles({ readError: { code: "PGRST000", message: "Failed to fetch" } });
    r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: { full_name: "Awa" } });
    assert.strictEqual(db.writes.length, 0);
    assert.ok(r.error);
    db = fakeProfiles({ row: null, refuse: (u) => (u === "Admin" ? reserved : null) });
    r = await Pseudo.ensureProfileForUser(db, { id, user_metadata: { full_name: "Admin" } });
    assert.deepStrictEqual(db.writes.map((w) => w.payload.username), ["Admin", "Membre 0b3b3d"]);
    assert.strictEqual(r.username, "Membre 0b3b3d");
  });

  // ---------- pages ----------
  const chat = read("chat.html"), chatCode = strip(script(chat));
  const disc = read("discussions.html"), discCode = strip(script(disc));
  const idx = read("index.html");

  await test("chat.html : « Se connecter » ouvre la fenêtre (visiteur et salon payant), même salon au retour de Google, profil garanti", () => {
    assert.match(chat, /<script src="pseudo\.js"><\/script>\s*<script src="room-safe\.js"><\/script>\s*<script src="login-sheet\.js"><\/script>/);
    assert.match(chatCode, /MahoutoLogin\.open\(\{[\s\S]*roomId: ROOM_ID,\s*redirectPath: "chat\.html\?room=" \+ encodeURIComponent\(ROOM_ID\),/);
    assert.match(chatCode, /getElementById\("visitor-login"\)\.addEventListener\("click", \(e\) => \{\s*e\.preventDefault\(\);\s*openLogin\(/);
    assert.match(chatCode, /getElementById\("locked-login-link"\)\.addEventListener\("click", \(e\) => \{\s*e\.preventDefault\(\);\s*openLogin\(/);
    assert.match(chatCode, /if \(user\) await MahoutoPseudo\.ensureProfileForUser\(supabase, user\);\s*window\.location\.reload\(\);/);
    assert.match(chatCode, /await MahoutoPseudo\.ensureProfileForUser\(supabase, currentUser\);/, "profil garanti à la reprise de session (retour Google)");
    assert.match(chatCode, /MahoutoLogin\.oauthErrorFromUrl\(window\.location\)/);
    assert.match(chatCode, /MahoutoLogin\.consumeReturn\(window\.sessionStorage\)/);
    assert.ok(!/signInAnonymously|Vérifie (ta configuration|config\.js)/.test(chat));
  });

  await test("discussions.html : connexion par e-mail dans la même fenêtre ; erreur Google exacte (plus de texte brut)", () => {
    assert.match(disc, /<script src="login-sheet\.js"><\/script>/);
    assert.match(disc, /id="email-login-btn"/);
    assert.match(discCode, /MahoutoLogin\.open\(\{[\s\S]*redirectPath: "discussions\.html"/);
    assert.match(discCode, /MahoutoLogin\.authErrorMessage\(error, "google"\)/);
    assert.ok(!/Connexion Google indisponible : " \+ error\.message/.test(discCode));
    assert.match(discCode, /MahoutoLogin\.oauthErrorFromUrl\(window\.location\)/);
  });

  await test("index.html : reprise de la destination de secours après une connexion (usage unique, chat.html?room= seulement)", () => {
    assert.match(idx, /<script src="login-sheet\.js"><\/script>\s*<script src="auth\.js"><\/script>/);
    const code = strip(script(idx));
    assert.match(code, /onAuthStateChange\(\(event, session\) => \{\s*if \(event !== "SIGNED_IN" \|\| !session\) return;\s*const destination = MahoutoLogin\.consumeReturn\(window\.sessionStorage\);\s*if \(destination\) window\.location\.replace\(destination\);/);
  });

  await test("cache hors ligne : login-sheet.js dans l'App Shell, version ≥ v92", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/login-sheet\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 92);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
