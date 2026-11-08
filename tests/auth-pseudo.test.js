/* auth.js (connexion, création du profil) ne réécrit jamais un pseudo existant.
   Exécution : node tests/auth-pseudo.test.js — aucune dépendance, aucun réseau, aucune base :
   auth.js est exécuté dans un bac à sable avec un faux client Supabase qui enregistre toute écriture. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Pseudo = require("../pseudo");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

const UID = "0b3b3de9-b835-40ec-b076-22fdc3c4ab02";

/**
 * scenario : {
 *   user_metadata,                      // métadonnées Google (full_name, avatar_url…)
 *   row,                                // profil existant (objet) ou null
 *   reads: [..]                         // facultatif : résultats successifs des lectures [{data, error}]
 *   refuse(username) → error | null     // refus de la base sur une écriture de pseudo
 * }
 * Renvoie { writes, row } après l'exécution de auth.js (lancement automatique de checkUser).
 */
async function runAuth(scenario) {
  const writes = [];
  const state = { row: scenario.row === undefined ? null : scenario.row, readCount: 0 };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: UID, email: "awa@exemple.com", user_metadata: scenario.user_metadata || {} } } }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null })
    },
    from(table) {
      assert.strictEqual(table, "profiles");
      return {
        select() {
          return { eq() { return { maybeSingle() {
            const i = state.readCount++;
            if (scenario.reads && scenario.reads[i]) return Promise.resolve(scenario.reads[i]);
            return Promise.resolve({ data: state.row, error: null });
          } }; } };
        },
        upsert(payload, opts) {
          writes.push({ op: "upsert", payload, opts });
          const err = scenario.refuse ? scenario.refuse(payload.username) : null;
          if (err) return Promise.resolve({ error: err });
          if (!state.row || !(opts && opts.ignoreDuplicates)) state.row = Object.assign({}, state.row, payload);
          return Promise.resolve({ error: null });
        },
        update(payload) {
          return {
            eq() { return { is() { writes.push({ op: "update", payload }); return Promise.resolve({ error: null }); }, then(res) { writes.push({ op: "update", payload }); return Promise.resolve({ error: null }).then(res); } }; }
          };
        }
      };
    }
  };
  const sandbox = { MahoutoPseudo: Pseudo, console: { log() {}, warn() {}, error() {} }, setTimeout };
  sandbox.window = sandbox;
  sandbox.MAHOUTO_CONFIG = { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" };
  sandbox.supabase = { createClient: () => client };
  vm.runInNewContext(read("auth.js"), sandbox);
  await new Promise((r) => setTimeout(r, 30));   // laisse finir le checkUser lancé au chargement
  return { writes, row: state.row };
}

const usernameWrites = (w) => w.filter((x) => (x.payload && "username" in x.payload));
const reserved = { message: "PSEUDO_RESERVE: ce pseudo est reserve", code: "23514" };
const emailRefused = { message: "PSEUDO_EMAIL: le pseudo ne peut pas etre une adresse e-mail", code: "23514" };
const taken = { message: 'duplicate key value violates unique constraint "profiles_username_unique_idx"', code: "23505", details: "profiles_username_unique_idx" };

(async () => {
  await test("lecture du profil en erreur (réseau) : AUCUNE écriture, pseudo intact", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa Google", avatar_url: "https://p/x.png" }, row: { username: "Mon pseudo perso", avatar_url: null }, reads: [{ data: null, error: { code: "PGRST000", message: "Failed to fetch" } }] });
    assert.deepStrictEqual(r.writes, []);
    assert.strictEqual(r.row.username, "Mon pseudo perso");
  });

  await test("lecture en erreur puis profil absent côté base : toujours aucune écriture (on ne devine pas)", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa Google" }, row: null, reads: [{ data: null, error: { code: "57014", message: "timeout" } }] });
    assert.deepStrictEqual(r.writes, []);
  });

  await test("profil existant avec un pseudo personnalisé : AUCUNE écriture (photo déjà synchronisée)", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa Google", avatar_url: "https://p/x.png" }, row: { username: "Mon pseudo perso", avatar_url: "https://p/custom.png" } });
    assert.deepStrictEqual(r.writes, []);
  });

  await test("profil existant, photo vide : seule la photo est synchronisée, jamais le pseudo", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa Google", avatar_url: "https://p/x.png" }, row: { username: "Mon pseudo perso", avatar_url: null } });
    assert.strictEqual(usernameWrites(r.writes).length, 0);
    assert.deepStrictEqual(r.writes.map((w) => w.op), ["update"]);
    assert.strictEqual(JSON.stringify(r.writes[0].payload), JSON.stringify({ avatar_url: "https://p/x.png" }));
    assert.strictEqual(r.row.username, "Mon pseudo perso");
  });

  await test("profil existant : un nom Google différent ne remplace pas le pseudo (connexions successives)", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Nom Google Changé" }, row: { username: "Awa", avatar_url: "https://p/a.png" } });
    assert.deepStrictEqual(r.writes, []);
  });

  await test("pas de profil, compte Google : création avec le nom Google (sans écraser une ligne apparue entre-temps)", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa Google", avatar_url: "https://p/x.png" }, row: null });
    assert.strictEqual(r.writes.length, 1);
    assert.strictEqual(r.writes[0].op, "upsert");
    assert.deepStrictEqual(r.writes[0].payload, { avatar_url: "https://p/x.png", id: UID, username: "Awa Google" });
    assert.strictEqual(r.writes[0].opts.ignoreDuplicates, true);
  });

  await test("pas de profil, inscription par e-mail (aucun nom) : « Membre xxxxxx », jamais l'adresse", async () => {
    const r = await runAuth({ user_metadata: {}, row: null });
    assert.strictEqual(r.row.username, "Membre 0b3b3d");
    assert.ok(!JSON.stringify(r.writes).includes("@"));
  });

  await test("pas de profil, nom Google en forme d'e-mail : « Membre xxxxxx »", async () => {
    const r = await runAuth({ user_metadata: { full_name: "awa@exemple.com" }, row: null });
    assert.strictEqual(r.row.username, "Membre 0b3b3d");
  });

  await test("refus de la base — nom réservé : pseudo neutre", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Admin" }, row: null, refuse: (u) => (u === "Admin" ? reserved : null) });
    assert.deepStrictEqual(r.writes.map((w) => w.payload.username), ["Admin", "Membre 0b3b3d"]);
    assert.strictEqual(r.row.username, "Membre 0b3b3d");
  });

  await test("refus de la base — forme d'e-mail : pseudo neutre", async () => {
    const r = await runAuth({ user_metadata: { full_name: "x" }, row: null, refuse: (u) => (u === "x" ? emailRefused : null) });
    assert.strictEqual(r.row.username, "Membre 0b3b3d");
  });

  await test("refus de la base — déjà pris : pseudo neutre ; neutre aussi pris : 8 caractères", async () => {
    const r1 = await runAuth({ user_metadata: { full_name: "Awa" }, row: null, refuse: (u) => (u === "Awa" ? taken : null) });
    assert.strictEqual(r1.row.username, "Membre 0b3b3d");
    const r2 = await runAuth({ user_metadata: { full_name: "Awa" }, row: null, refuse: (u) => (u === "Awa" || u === "Membre 0b3b3d" ? taken : null) });
    assert.deepStrictEqual(r2.writes.map((w) => w.payload.username), ["Awa", "Membre 0b3b3d", "Membre 0b3b3de9"]);
    assert.strictEqual(r2.row.username, "Membre 0b3b3de9");
  });

  await test("erreur d'écriture qui n'est pas un refus de pseudo : on s'arrête (pas de nouvelles tentatives)", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa" }, row: null, refuse: () => ({ message: "boom", code: "XX000" }) });
    assert.strictEqual(r.writes.length, 1);
  });

  await test("seconde lecture (dans saveIfMissing) en erreur : aucune écriture", async () => {
    const r = await runAuth({ user_metadata: { full_name: "Awa" }, row: null, reads: [{ data: null, error: null }, { data: null, error: { code: "PGRST000", message: "Failed to fetch" } }] });
    assert.deepStrictEqual(r.writes, []);
  });

  // ---------- code ----------
  const auth = strip(read("auth.js"));
  await test("auth.js : plus aucun upsert direct sur profiles ; ensureProfile passe par saveIfMissing ; l'erreur de lecture est testée", () => {
    assert.ok(!/\.from\("profiles"\)\s*\.upsert\(/.test(auth.replace(/\s+/g, " ").replace(/\. /g, ".")), "pas de .from(\"profiles\").upsert(");
    assert.ok(!/\.upsert\(/.test(auth), "aucun .upsert( dans auth.js");
    assert.match(auth, /MahoutoPseudo\.saveIfMissing\(supabase, userId, candidate, extra\)/);
    assert.match(auth, /error: profileReadError/);
    assert.match(auth, /if \(profileReadError\) \{/);
  });

  await test("discussions.html (trySilentResume) : n'écrit pas après une lecture du profil en erreur", () => {
    const code = strip(read("discussions.html"));
    assert.match(code, /error: profileReadError/);
    assert.match(code, /if \(!profileReadError && !existingProfile\) \{/);
  });

  await test("inventaire : plus aucun upsert direct sur profiles hors profil.html et pseudo.js", () => {
    const files = fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f))
      .concat(fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js")).map((f) => "api/" + f));
    const upserts = [];
    files.forEach((f) => {
      const code = strip(read(f));
      // .from("profiles") suivi (sur la chaîne d'appels) d'un .upsert(
      const re = /\.from\(\s*["']profiles["']\s*\)\s*(?:\.\s*\w+\([^)]*\)\s*)*?\.upsert\(/g;
      if (re.test(code)) upserts.push(f);
    });
    assert.deepStrictEqual(upserts.sort(), ["profil.html", "pseudo.js"]);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
