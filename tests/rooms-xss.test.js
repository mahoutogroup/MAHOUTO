/* XSS stockée dans la liste des salons : color, emoji et photo_url ne doivent jamais atteindre du HTML.
   Exécution : node tests/rooms-xss.test.js — aucune dépendance, aucun réseau, aucune base. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Safe = require("../room-safe");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

// ---------- faux DOM : innerHTML interdit ----------
function fakeDoc() {
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, className: "", _text: "", style: { cssText: "" },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
      set src(v) { this.attrs.src = String(v); }, get src() { return this.attrs.src; },
      set alt(v) { this.attrs.alt = String(v); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    return n;
  }
  return { createElement: node };
}

const TRAP_COLOR = 'red" onmouseover="window.__x=1" style="background:url(http://evil.test/c.png)';
const TRAP_EMOJI = '<img src=x onerror="window.__x=2"><svg onload="window.__x=3">';

test("color : hexadécimal accepté (3, 4, 6, 8 chiffres, toutes les valeurs du code) ; le reste donne la couleur par défaut", () => {
  ["#22C55E", "#FFD700", "#38BDF8", "#fff", "#FFFF", "#aabbccdd", " #38BDF8 "].forEach((v) => assert.strictEqual(Safe.color(v), v.trim()));
  [TRAP_COLOR, "red", "rgb(1,2,3)", "#12", "#GGGGGG", "#22C55E;background:url(x)", "", null, undefined, 12, {}, "22C55E", "#22C55E\n", "url(http://x)", "var(--gold)"]
    .forEach((v) => assert.strictEqual(Safe.color(v), "#22C55E", String(v)));
  assert.strictEqual(Safe.color("nimporte quoi", "rgba(212,175,55,.12)"), "rgba(212,175,55,.12)", "couleur de repli personnalisée");
});

test("emoji : court et sans < > \" ' & ni contrôle ; le reste donne 💬", () => {
  ["💬", "📣", "🛠️", "🔥", "été", "👨‍👩‍👧‍👦"].forEach((v) => assert.strictEqual(Safe.emoji(v), v));
  [TRAP_EMOJI, "<", ">", 'a"b', "a'b", "a&b", "a\tb", "a\nb", "a\u2028b", "a\u0000b", "x".repeat(17), "", "   ", null, undefined, 5]
    .forEach((v) => assert.strictEqual(Safe.emoji(v), "💬", JSON.stringify(v)));
  assert.strictEqual(Safe.emoji("x".repeat(16)), "x".repeat(16), "16 caractères : limite incluse");
});

test("photoUrl : https seulement, sans espace ni guillemet ni < > ` \\ ; sinon null", () => {
  ["https://res.cloudinary.com/demo/image/upload/a.jpg", "HTTPS://res.cloudinary.com/x.png"].forEach((v) => assert.strictEqual(Safe.photoUrl(v), v));
  ["javascript:alert(1)", "http://x.com/a.png", "data:text/html,<script>1</script>", "https://a b", 'https://a.com/" onerror="x', "https://a.com/<b>",
    "https://a.com/`x", "https://a.com/\\x", "//evil.test/a.png", "", null, undefined, 3, "https://a.com/" + "a".repeat(2050)]
    .forEach((v) => assert.strictEqual(Safe.photoUrl(v), null, String(v)));
});

test("buildAvatar : salon piégé → couleur par défaut, émoji par défaut, aucun élément injecté ; photo valide → une seule image", () => {
  const doc = fakeDoc();
  const bad = Safe.buildAvatar(doc, { color: TRAP_COLOR, emoji: TRAP_EMOJI, photo_url: "javascript:alert(1)" }, { tag: "span" });
  assert.strictEqual(bad.tag, "span");
  assert.strictEqual(bad.style.background, "#22C55E");
  assert.strictEqual(bad.textContent, "💬");
  assert.strictEqual(bad.children.length, 0, "aucun enfant : pas de balise injectée");
  assert.ok(!JSON.stringify(bad.attrs).includes("onerror"));

  const photo = Safe.buildAvatar(doc, { color: "#38BDF8", emoji: "x", photo_url: "https://res.cloudinary.com/demo/a.jpg" }, { imgStyle: "width:100%" });
  assert.strictEqual(photo.children.length, 1);
  assert.strictEqual(photo.children[0].tag, "img");
  assert.strictEqual(photo.children[0].attrs.src, "https://res.cloudinary.com/demo/a.jpg");
  assert.strictEqual(photo.children[0].style.cssText, "width:100%");
  assert.strictEqual(photo.textContent, "");

  const photoTrap = Safe.buildAvatar(doc, { color: "#38BDF8", emoji: "🔥", photo_url: '" onerror="alert(1)' });
  assert.strictEqual(photoTrap.children.length, 0);
  assert.strictEqual(photoTrap.textContent, "🔥");
  assert.strictEqual(Safe.buildAvatar(doc, null).textContent, "💬");
});

// ---------- pages ----------
// Instructions « innerHTML = `…` » (gabarits) d'un fichier, avec leurs interpolations ${…}.
function templateAssignments(code) {
  const out = [];
  const re = /(?:innerHTML|outerHTML)\s*=\s*`/g;
  let m;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length, depth = 0, buf = "";
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "\\") { buf += c + code[i + 1]; i++; continue; }
      if (c === "$" && code[i + 1] === "{") { depth++; buf += "${"; i++; continue; }
      if (c === "}" && depth > 0) { depth--; buf += c; continue; }
      if (c === "`" && depth === 0) break;
      buf += c;
    }
    out.push(buf);
  }
  return out;
}
const interpolations = (tpl) => tpl.match(/\$\{[^}]*\}/g) || [];
const ROOM_FIELD = /\b(?:room|r|rooms?[A-Za-z]*)\.(?:color|emoji|photo_url|name|course_name|lastMessage)\b|purchase\.course_name/;

["discussions.html", "mes-achats.html", "admin/rooms.html"].forEach((file) => {
  test(file + " : aucun champ de salon (nom, couleur, émoji, photo, aperçu) dans un gabarit innerHTML sans échappement", () => {
    let code = strip(read(file));
    // mes-achats.html : seule la ligne d'un SALON est concernée ; les lignes de formations et de produits
    // (noms saisis par les admins) sont signalées dans la PR, pas corrigées ici.
    if (file === "mes-achats.html") {
      const start = code.indexOf("function renderRoomRow");
      code = code.slice(start, code.indexOf("async function fetchData", start));
      assert.ok(start > 0 && code.length > 0, "renderRoomRow trouvée");
    }
    templateAssignments(code).forEach((tpl) => {
      interpolations(tpl).forEach((expr) => {
        if (ROOM_FIELD.test(expr)) {
          assert.ok(/^\$\{escapeHtml\(/.test(expr), file + " : interpolation de salon non échappée : " + expr);
          assert.ok(!/color|emoji|photo_url/.test(expr), file + " : couleur/émoji/photo dans du HTML : " + expr);
        }
      });
    });
  });

  test(file + " : couleur, émoji et photo d'un salon passent par MahoutoRoomSafe", () => {
    const code = strip(read(file));
    assert.match(code, /MahoutoRoomSafe\.(buildAvatar|color|emoji|photoUrl)\(/);
    assert.ok(!/style="background:\$\{/.test(code), 'style="background:${…}" interdit');
    assert.match(read(file), /<script src="(?:\.\.\/)?room-safe\.js"><\/script>/);
  });
});

test("discussions.html : la liste et la cible d'envoi n'utilisent plus innerHTML pour une ligne de salon", () => {
  const code = strip(read("discussions.html"));
  assert.ok(!/row\.innerHTML\s*=/.test(code), "row.innerHTML interdit (renderRooms et cible d'envoi)");
  assert.ok(!/\.avatar"\)\.appendChild\(img\)/.test(code));
});

test("garde-fou global : aucune page n'interpole room/r .color, .emoji ou .photo_url dans un gabarit HTML", () => {
  const files = fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f)).concat(fs.readdirSync(path.join(root, "admin")).filter((f) => f.endsWith(".html")).map((f) => "admin/" + f));
  files.forEach((f) => {
    const code = strip(read(f));
    templateAssignments(code).forEach((tpl) => {
      interpolations(tpl).forEach((expr) => {
        assert.ok(!/\b(?:room|r|rooms?[A-Za-z]*)\.(?:color|emoji|photo_url)\b/.test(expr), f + " : " + expr);
      });
    });
  });
});

test("chat.html : la photo du salon passe par la même validation (https seulement)", () => {
  const code = strip(read("chat.html"));
  assert.match(code, /MahoutoRoomSafe\.photoUrl\(room\.photo_url\)/);
  assert.match(read("chat.html"), /<script src="room-safe\.js"><\/script>/);
});

test("cache hors ligne : room-safe.js dans l'App Shell, version ≥ v90", () => {
  const sw = read("sw.js");
  assert.match(sw, /"\/room-safe\.js"/);
  assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 90);
});

console.log("\n" + passed + " test(s) réussi(s)");
