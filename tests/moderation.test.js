/* Tests de la page de modération des signalements — exécution : node tests/moderation.test.js
   Aucune dépendance, aucun réseau, aucune base. Un faux DOM refuse tout innerHTML. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../moderation");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ---------- faux DOM : innerHTML / outerHTML / insertAdjacentHTML interdits ----------
function fakeDoc() {
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, listeners: {}, className: "", _text: "",
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); },
      insertAdjacentHTML() { throw new Error("insertAdjacentHTML interdit"); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    Object.defineProperty(n, "outerHTML", { set() { throw new Error("outerHTML interdit"); } });
    return n;
  }
  return { createElement: node };
}
function walk(n, fn) { fn(n); n.children.forEach((c) => walk(c, fn)); }
function allText(n) { const out = []; walk(n, (x) => { if (x._text) out.push(x._text); }); return out.join("\n"); }
function find(n, pred) { let r = null; walk(n, (x) => { if (!r && pred(x)) r = x; }); return r; }
function findAll(n, pred) { const r = []; walk(n, (x) => { if (pred(x)) r.push(x); }); return r; }

const rows = [
  { id: 1, kind: "room", message_id: 10, reporter_id: "u1", reason: "spam", created_at: "2026-11-01T10:00:00Z", reported_user_id: "bad", message_text: null, status: "open", admin_note: null },
  { id: 2, kind: "room", message_id: 10, reporter_id: "u2", reason: "spam", created_at: "2026-11-02T10:00:00Z", reported_user_id: "bad", message_text: null, status: "open", admin_note: null },
  { id: 3, kind: "dm", message_id: 5, reporter_id: "u1", reason: "harcelement", created_at: "2026-11-03T10:00:00Z", reported_user_id: "bad", message_text: "copie du message", status: "open", admin_note: null },
  { id: 4, kind: "room", message_id: 11, reporter_id: "u3", reason: "autre", created_at: "2026-11-04T10:00:00Z", reported_user_id: "bad", message_text: null, status: "dismissed", admin_note: "RAS" }
];

(async () => {
  await test("groupReports : un groupe par message, nombre de signalants distincts, ouverts d'abord", () => {
    const g = M.groupReports(rows);
    assert.strictEqual(g.length, 3);
    assert.deepStrictEqual(g.map((x) => x.key), ["dm:5", "room:10", "room:11"]);
    assert.strictEqual(g[0].hasOpen && g[1].hasOpen, true);
    assert.strictEqual(g[2].hasOpen, false, "les groupes classés viennent après");
    const room10 = g.find((x) => x.key === "room:10");
    assert.strictEqual(room10.count, 2);
    assert.deepStrictEqual(room10.openIds, [1, 2]);
    assert.strictEqual(room10.reasons.spam, 2);
    assert.strictEqual(g.find((x) => x.key === "room:11").status, "dismissed");
  });

  await test("groupReports : un même signalant n'est compté qu'une fois ; le plus récent d'abord parmi les ouverts", () => {
    const dup = rows.concat([{ id: 9, kind: "room", message_id: 10, reporter_id: "u1", reason: "autre", created_at: "2026-11-05T00:00:00Z", status: "open" }]);
    const g = M.groupReports(dup);
    assert.strictEqual(g.find((x) => x.key === "room:10").count, 2);
    assert.strictEqual(g[0].key, "room:10", "dernier signalement le plus récent en tête");
  });

  await test("filtres Ouverts / Classés et décompte de la pastille", () => {
    const g = M.groupReports(rows);
    assert.strictEqual(M.filterGroups(g, "open").length, 2);
    assert.strictEqual(M.filterGroups(g, "closed").length, 1);
    assert.strictEqual(M.countOpenReports(rows), 3);
    assert.strictEqual(M.countOpenReports([{ status: "dismissed" }, {}]), 1, "sans statut = ouvert");
  });

  await test("rôles : seuls founder, admin, super_admin", () => {
    ["founder", "admin", "super_admin"].forEach((r) => assert.strictEqual(M.isAdminRole(r), true));
    ["user", "", null, undefined, "moderator", "ADMIN"].forEach((r) => assert.strictEqual(M.isAdminRole(r), false));
  });

  await test("erreurs : migration 006 absente → message clair, sans détail technique", () => {
    const cases = [
      { code: "42703", message: 'column message_reports.status does not exist' },
      { code: "PGRST205", message: "Could not find the table 'public.message_reports' in the schema cache" },
      { code: "PGRST202", message: "Could not find the function public.admin_hide_room_message(p_message_id) in the schema cache" },
      { code: "42P01", message: 'relation "public.message_reports" does not exist' }
    ];
    cases.forEach((e) => {
      assert.strictEqual(M.errorKind(e), "unavailable");
      const msg = M.errorMessage(e);
      assert.match(msg, /pas encore activée/);
      assert.ok(!/42703|PGRST|relation|column|schema cache/.test(msg));
    });
    assert.strictEqual(M.errorKind({ code: "42501", message: "permission denied for table message_reports" }), "denied");
    assert.strictEqual(M.errorKind({ code: "42501", message: "ADMIN_REQUIRED: reserve" }), "denied");
    assert.strictEqual(M.errorKind({ code: "500", message: "boom" }), "other");
    assert.strictEqual(M.errorKind(null), null);
  });

  await test("pastille : fetchOpenCount renvoie null (jamais d'exception) si la migration 006 manque", async () => {
    const failing = { from() { return { select() { return { eq() { return Promise.resolve({ error: { code: "42703" }, count: null }); } }; } }; } };
    assert.strictEqual(await M.fetchOpenCount(failing), null);
    const throwing = { from() { throw new Error("réseau"); } };
    assert.strictEqual(await M.fetchOpenCount(throwing), null);
    const ok = { from() { return { select() { return { eq() { return Promise.resolve({ error: null, count: 4 }); } }; } }; } };
    assert.strictEqual(await M.fetchOpenCount(ok), 4);
  });

  await test("describeMessage : message privé = copie du signalement uniquement ; salon = lecture admin ; masqué = copie gardée", () => {
    const g = M.groupReports(rows);
    const dm = g.find((x) => x.kind === "dm");
    assert.strictEqual(M.describeMessage(dm, { content: "NE DOIT PAS ÊTRE LU" }).text, "copie du message");
    const dmNoCopy = M.groupReports([{ id: 7, kind: "dm", message_id: 8, reporter_id: "u", reason: "spam", created_at: "2026-11-01", status: "open", message_text: null }])[0];
    assert.strictEqual(M.describeMessage(dmNoCopy, { content: "secret" }).text, "", "jamais le message d'une autre source pour un dm");
    const room = g.find((x) => x.key === "room:10");
    assert.strictEqual(M.describeMessage(room, { content: "texte du salon", is_deleted: false }).text, "texte du salon");
    assert.match(M.describeMessage(room, { content: "", is_deleted: true }).note, /déjà supprimé/);
    assert.strictEqual(M.describeMessage(room, { is_deleted: true, content: "" }).text, "");
    const masked = M.groupReports([{ id: 1, kind: "room", message_id: 3, reporter_id: "u", reason: "spam", created_at: "2026-11-01", status: "actioned", message_text: "texte gardé" }])[0];
    assert.strictEqual(M.describeMessage(masked, { is_deleted: true, content: "" }).text, "texte gardé");
  });

  await test("échappement : pseudos et messages hostiles sont écrits en textContent, jamais interprétés", () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const doc = fakeDoc();
    const groups = M.groupReports([
      { id: 1, kind: "room", message_id: 1, reporter_id: "r", reason: "spam", created_at: "2026-11-01T00:00:00Z", reported_user_id: "bad", status: "open", admin_note: evil },
      { id: 2, kind: "dm", message_id: 2, reporter_id: "r", reason: "autre", created_at: "2026-11-01T00:00:00Z", reported_user_id: "bad", status: "open", message_text: evil }
    ]);
    groups.forEach((g) => {
      const card = M.buildCard(g, {
        doc, names: { r: evil, bad: '"><b>x</b>' },
        roomMessages: { 1: { content: evil, is_deleted: false, attachment_type: "image", attachment_url: "https://x/y.png" } },
        onHide() {}, onDismiss() {}, onAction() {}
      });
      const text = allText(card);
      assert.ok(text.includes(evil), "le contenu hostile est affiché tel quel, comme texte");
      assert.strictEqual(findAll(card, (n) => ["img", "a", "script", "iframe", "video", "audio"].includes(n.tag)).length, 0, "aucun lien, image ni script");
      walk(card, (n) => Object.keys(n.attrs).forEach((k) => assert.ok(!/^on/i.test(k) && k !== "href" && k !== "src", "attribut interdit : " + k)));
    });
  });

  await test("boutons : « Masquer » seulement pour un salon ouvert ; confirmation et note transmises ; rien pour un classé", () => {
    const doc = fakeDoc();
    const calls = [];
    const ctx = { doc, names: {}, roomMessages: {}, onHide: (g, n) => calls.push(["hide", g.key, n]), onDismiss: (g, n) => calls.push(["dismiss", g.key, n]), onAction: (g, n) => calls.push(["action", g.key, n]) };
    const g = M.groupReports(rows);
    const labels = (card) => findAll(card, (n) => n.tag === "button").map((b) => b.textContent);
    assert.deepStrictEqual(labels(M.buildCard(g.find((x) => x.key === "room:10"), ctx)), ["Masquer le message", "Classer sans suite", "Marquer traité"]);
    assert.deepStrictEqual(labels(M.buildCard(g.find((x) => x.key === "dm:5"), ctx)), ["Classer sans suite", "Marquer traité"], "aucun bouton de masquage pour un message privé");
    assert.deepStrictEqual(labels(M.buildCard(g.find((x) => x.key === "room:11"), ctx)), []);
    const card = M.buildCard(g.find((x) => x.key === "dm:5"), ctx);
    const ta = find(card, (n) => n.tag === "textarea");
    assert.strictEqual(ta.attrs.maxlength, String(M.MAX_NOTE));
    ta.textContent = "";
    ta.value = "ma note";
    findAll(card, (n) => n.tag === "button")[0].listeners.click();
    assert.deepStrictEqual(calls[0], ["dismiss", "dm:5", "ma note"]);
  });

  // ---------- Contrôles statiques de la page ----------
  const page = read("admin/signalements.html");
  const js = read("moderation.js");
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  await test("page et module : ni innerHTML, ni insertAdjacentHTML, ni document.write, ni eval", () => {
    [stripComments(js), stripComments(page.slice(page.indexOf("<script>")))].forEach((code) => {
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code));
    });
  });

  await test("page : aucune lecture de dm_messages / dm_conversations, aucune écriture hors message_reports et la fonction de masquage", () => {
    const code = stripComments(page.slice(page.indexOf("<script>")));
    assert.ok(!/dm_messages|dm_conversations/.test(code));
    const tables = (code.match(/\.from\("([a-z_]+)"\)/g) || []).map((m) => m.slice(7, -2));
    assert.deepStrictEqual(Array.from(new Set(tables)).sort(), ["message_reports", "messages", "profiles"]);
    const writes = code.match(/\.from\("[a-z_]+"\)\s*\.(update|insert|delete|upsert)/g) || [];
    writes.forEach((w) => assert.ok(w.includes("message_reports"), w));
    assert.ok(!/\.delete\(/.test(code));
    assert.ok(/rpc\("admin_hide_room_message"/.test(code));
    assert.ok(!/handled_by|handled_at/.test(code.replace(/\/\/.*$/gm, "")), "handled_by / handled_at jamais envoyés par la page");
  });

  await test("page : aucun contenu de message ou de pseudo dans les journaux console", () => {
    const code = stripComments(page.slice(page.indexOf("<script>")) + js);
    const logs = code.match(/console\.[a-z]+\([^;]*\);/g) || [];
    assert.ok(logs.length > 0);
    logs.forEach((l) => assert.ok(/logError|\[signalements\]/.test(l) || /error\.code|\.code/.test(l), l));
    assert.ok(/function logError[\s\S]*?error\.code/.test(code), "logError n'écrit que le code d'erreur");
  });

  await test("page : accès réservé aux admins (vérification du rôle, message et redirection pour les autres)", () => {
    assert.match(page, /M\.isAdminRole\(profile\.role\)/);
    assert.match(page, /Accès réservé aux administrateurs/);
    assert.match(page, /window\.location\.href = redirectTo/);
    assert.match(page, /\.\.\/profil\.html/);
  });

  await test("page : migration 006 absente → notice claire (errorMessage), le tableau de bord n'est pas touché", () => {
    assert.match(page, /showNotice\(M\.errorMessage\(error\)\)/);
    const dash = read("admin/formations.html");
    assert.match(dash, /MahoutoModeration\.fetchOpenCount\(supabase\)\.then/);
    const profil = read("profil.html");
    assert.match(profil, /MahoutoModeration\.fetchOpenCount\(supabase\)\.then/);
  });

  await test("navigation : onglet Signalements sur les pages d'administration, pastille sur le lien du tableau de bord", () => {
    ["formations", "produits", "users", "rooms", "statistiques", "signalements"].forEach((n) =>
      assert.match(read("admin/" + n + ".html"), /href="signalements\.html"/, n));
    assert.match(read("profil.html"), /id="admin-report-badge"/);
    assert.match(read("admin/formations.html"), /id="tab-report-badge"/);
  });

  await test("cache hors ligne : moderation.js dans l'App Shell, version incrémentée", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/moderation\.js"/);
    const v = Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]);
    assert.ok(v >= 86, "version >= v86 : " + v);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
