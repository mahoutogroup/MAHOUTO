/* Bouton « Partager » d'un salon. Exécution : node tests/room-share.test.js
   Aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Share = require("../room-share");

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

function fakeDoc() {
  const ids = {};
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, listeners: {}, className: "", _text: "", value: "", readOnly: false, parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") ids[v] = this; },
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      select() { this.selected = true; },
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    return n;
  }
  return { createElement: node, getElementById: (id) => ids[id] || null, head: node("head"), body: node("body") };
}
const walk = (n, fn) => { fn(n); (n.children || []).forEach((c) => walk(c, fn)); };
const button = (root, text) => { let r = null; walk(root, (x) => { if (!r && x.tag === "button" && x.textContent === text) r = x; }); return r; };
const PRICE = Number(2000).toLocaleString("fr-FR") + " FCFA";   // l'espace de milliers dépend de l'environnement (U+202F possible)
const win = (nav, origin) => ({ location: { origin: origin || "https://mahouto.com" }, navigator: nav, open(...a) { this.opened = a; } });

(async () => {
  await test("lien partagé : TOUJOURS https://mahouto.com/r/<salon> ; identifiant non partageable refusé", () => {
    assert.strictEqual(Share.buildUrl("general"), "https://mahouto.com/r/general");
    assert.strictEqual(Share.buildUrl("salon-170"), "https://mahouto.com/r/salon-170");
    assert.strictEqual(Share.SITE, "https://mahouto.com");
    ["", null, undefined, "a b", "a&b=c", "../x", "x".repeat(65), "é", "a#b", "<b>", 5].forEach((id) => assert.strictEqual(Share.buildUrl(id), null, String(id)));
    assert.strictEqual(Share.isValidRoomId("a_b-C9"), true);
    assert.strictEqual(Share.isValidRoomId("x".repeat(64)), true);
  });

  await test("depuis un autre domaine (majestepresse.com, localhost) : le lien partagé reste https://mahouto.com/r/<salon>", async () => {
    for (const origin of ["https://majestepresse.com", "https://www.mahouto.com", "http://localhost:3000"]) {
      const calls = [];
      await Share.share({ room: { id: "general", name: "G" }, win: win({ share: async (a) => calls.push(a) }, origin), doc: fakeDoc() });
      assert.strictEqual(calls[0].url, "https://mahouto.com/r/general", origin);
      assert.match(calls[0].text, /sur MAHOUTO\+\.$/);
    }
  });

  await test("texte d'accompagnement : nom du salon, marque ; prix pour un salon payant ; nom tronqué", () => {
    assert.strictEqual(Share.buildMessage({ name: "Les Sérigraphes", is_paid: false }), "Rejoins « Les Sérigraphes » sur MAHOUTO+.");
    assert.strictEqual(Share.buildMessage({ name: "VIP", is_paid: true, price: 2000 }), "Rejoins « VIP » sur MAHOUTO+ (communauté payante : " + PRICE + ").");
    assert.strictEqual(Share.buildMessage({ name: "  Salon \n  gratuit  ", is_paid: false, price: 500 }), "Rejoins « Salon gratuit » sur MAHOUTO+.");
    assert.ok(Share.buildMessage({ name: "a".repeat(300) }).length < 140);
    assert.match(Share.buildMessage({}), /^Rejoins « ce salon » sur MAHOUTO\+\.$/);
    // La marque est fixe : elle ne dépend plus du domaine ni d'un argument.
    assert.strictEqual(Share.buildMessage({ name: "X" }, "MAJESTÉ PRESSE"), "Rejoins « X » sur MAHOUTO+.");
  });

  await test("lien WhatsApp : https://wa.me/?text= + texte et adresse encodés", () => {
    const u = Share.whatsappUrl("Rejoins « A&B » sur X.", "https://mahouto.com/r/a");
    assert.strictEqual(u, "https://wa.me/?text=" + encodeURIComponent("Rejoins « A&B » sur X.\nhttps://mahouto.com/r/a"));
    assert.ok(!/[ \n«]/.test(u));
  });

  await test("partage natif : navigator.share({ title, text, url }) ; aucun repli quand il aboutit", async () => {
    const calls = [];
    const w = win({ share: async (a) => { calls.push(a); } });
    const doc = fakeDoc();
    const res = await Share.share({ room: { id: "general", name: "Général", is_paid: false }, win: w, doc });
    assert.strictEqual(res, "native");
    assert.deepStrictEqual(calls, [{ title: "Général", text: "Rejoins « Général » sur MAHOUTO+.", url: "https://mahouto.com/r/general" }]);
    assert.strictEqual(doc.body.children.length, 0, "pas de fenêtre de repli");
  });

  await test("partage annulé (AbortError) : aucune erreur, aucune fenêtre", async () => {
    const w = win({ share: async () => { const e = new Error("annulé"); e.name = "AbortError"; throw e; } });
    const doc = fakeDoc();
    assert.strictEqual(await Share.share({ room: { id: "general", name: "G" }, win: w, doc }), "cancelled");
    assert.strictEqual(doc.body.children.length, 0);
  });

  await test("autre échec du partage natif, ou pas de partage natif : fenêtre de repli avec le lien", async () => {
    for (const nav of [{ share: async () => { throw new Error("NotAllowedError"); } }, {}, undefined]) {
      const doc = fakeDoc();
      const res = await Share.share({ room: { id: "general", name: "Général" }, win: win(nav), doc });
      assert.strictEqual(res, "sheet");
      const overlay = doc.body.children[0];
      let input = null; walk(overlay, (x) => { if (x.tag === "input") input = x; });
      assert.strictEqual(input.value, "https://mahouto.com/r/general");
      assert.ok(input.readOnly);
      assert.ok(button(overlay, "Copier le lien") && button(overlay, "WhatsApp") && button(overlay, "Fermer"));
    }
  });

  await test("fenêtre de repli : copie réussie, copie impossible (lien sélectionné), WhatsApp, fermeture", async () => {
    const written = [];
    let w = win({ clipboard: { writeText: async (t) => { written.push(t); } } });
    let doc = fakeDoc();
    await Share.share({ room: { id: "vip", name: "VIP", is_paid: true, price: 2000 }, win: w, doc });
    let overlay = doc.body.children[0];
    let status = null; walk(overlay, (x) => { if (x.attrs.role === "status") status = x; });
    await button(overlay, "Copier le lien").listeners.click();
    assert.deepStrictEqual(written, ["https://mahouto.com/r/vip"]);
    assert.strictEqual(status.textContent, "Lien copié ✅");

    button(overlay, "WhatsApp").listeners.click();
    assert.strictEqual(w.opened[0], "https://wa.me/?text=" + encodeURIComponent("Rejoins « VIP » sur MAHOUTO+ (communauté payante : " + PRICE + ").\nhttps://mahouto.com/r/vip"));
    assert.deepStrictEqual(w.opened.slice(1), ["_blank", "noopener"]);

    button(overlay, "Fermer").listeners.click();
    assert.strictEqual(doc.body.children.length, 0);

    w = win({ clipboard: { writeText: async () => { throw new Error("refusé"); } } });
    doc = fakeDoc();
    await Share.share({ room: { id: "vip", name: "VIP" }, win: w, doc });
    overlay = doc.body.children[0]; let input = null; walk(overlay, (x) => { if (x.tag === "input") input = x; walk(x, (y) => { if (y.attrs.role === "status") status = y; }); });
    await button(overlay, "Copier le lien").listeners.click();
    assert.ok(input.selected, "le lien est sélectionné");
    assert.match(status.textContent, /Copie automatique impossible/);
  });

  await test("nom de salon hostile : écrit en texte, jamais interprété ; identifiant invalide : rien n'est partagé", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const doc = fakeDoc();
    await Share.share({ room: { id: "x", name: evil }, win: win({}), doc });
    let found = false; walk(doc.body, (n) => { if (n._text && n._text.includes(evil)) found = true; if (["img", "a", "script"].includes(n.tag)) throw new Error("balise injectée"); });
    assert.ok(found, "le nom est affiché comme texte");
    const calls = [];
    const res = await Share.share({ room: { id: "a&b", name: "X" }, win: win({ share: async (a) => calls.push(a) }), doc: fakeDoc() });
    assert.strictEqual(res, "invalid");
    assert.strictEqual(calls.length, 0);
  });

  await test("room-share.js : ni innerHTML, ni journal console", () => {
    const lib = strip(read("room-share.js"));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\./.test(lib));
  });

  // ---------- pages ----------
  const chat = read("chat.html"), chatCode = strip(script(chat));
  const disc = read("discussions.html"), discCode = strip(script(disc));

  await test("chat.html : bouton 🔗 dans l'en-tête (salon connu) et sur l'écran d'un salon payant ; même fonction de partage", () => {
    assert.match(chat, /<script src="login-sheet\.js"><\/script>\s*<script src="room-share\.js"><\/script>/);
    assert.match(chat, /<button type="button" id="share-room-btn" class="hidden" aria-label="Partager ce salon"/);
    assert.match(chat, /<button id="locked-share-btn" type="button">🔗 Partager cette communauté<\/button>/);
    assert.match(chatCode, /MahoutoRoomShare\.share\(\{\s*room: Object\.assign\(\{ name: "Salon" \}, currentRoom \|\| \{\}, \{ id: ROOM_ID \}\),\s*win: window, doc: document\s*\}\);/);
    assert.ok(!/brandName|MAHOUTO_BRAND/.test(chatCode.slice(chatCode.indexOf("function shareRoom"), chatCode.indexOf("function shareRoom") + 400)), "plus de marque selon le domaine");
    assert.match(chatCode, /getElementById\("share-room-btn"\)\.addEventListener\("click", shareRoom\)/);
    assert.match(chatCode, /getElementById\("locked-share-btn"\)\.addEventListener\("click", shareRoom\)/);
    assert.match(chatCode, /currentRoom = room;\s*const hasAccess = await checkRoomAccess\(room\);/, "salon connu avant l'écran payant");
    assert.match(chatCode, /if \(room\) document\.getElementById\("share-room-btn"\)\.classList\.remove\("hidden"\);/);
  });

  await test("discussions.html : bouton 🔗 sur chaque salon (tout le monde, salons payants compris), sans ouvrir le salon", () => {
    assert.match(disc, /<script src="login-sheet\.js"><\/script>\s*<script src="room-share\.js"><\/script>/);
    assert.match(discCode, /shareBtn\.className = "room-share-btn";/);
    assert.match(discCode, /shareBtn\.addEventListener\("click", \(e\) => \{\s*e\.stopPropagation\(\);\s*MahoutoRoomShare\.share\(\{ room: room, win: window, doc: document \}\);/);
    assert.ok(!/brandName/.test(discCode));
    assert.match(discCode, /e\.target\.closest\("\.room-manage-btn"\) \|\| e\.target\.closest\("\.room-share-btn"\)/);
    assert.ok(!/innerHTML\s*=\s*`/.test(discCode.slice(discCode.indexOf("function renderRooms"), discCode.indexOf("async function buyRoom"))), "liste des salons toujours sans innerHTML");
  });

  await test("cache hors ligne : room-share.js dans l'App Shell, version ≥ v94", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/room-share\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 94);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
