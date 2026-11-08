/* Lien de salon : un visiteur sans compte lit un salon gratuit en lecture seule ; plus de parcours « pseudo sans compte ».
   Exécution : node tests/salon-visiteur.test.js — aucune dépendance, aucun réseau, aucune base.
   (Le comportement réel — lecture, temps réel, écrans — est vérifié dans Chromium, voir la description de la PR.) */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const script = (html) => html.slice(html.indexOf("<script>"));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

const chat = read("chat.html");
const chatCode = strip(script(chat));
const disc = read("discussions.html");
const discCode = strip(script(disc));

test("plus aucun parcours anonyme dans le dépôt : signInAnonymously a disparu (connexions anonymes désactivées)", () => {
  const files = fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f)).concat(fs.readdirSync(path.join(root, "admin")).filter((f) => f.endsWith(".html")).map((f) => "admin/" + f));
  files.forEach((f) => assert.ok(!/signInAnonymously/.test(strip(read(f))), f + " : signInAnonymously"));
});

test("chat.html et discussions.html : plus de formulaire de pseudo ni de message « Vérifie config.js »", () => {
  [["chat.html", chat], ["discussions.html", disc]].forEach(([f, html]) => {
    assert.ok(!/username-input|join-btn|joinChat/.test(html), f + " : formulaire de pseudo");
    assert.ok(!/Vérifie (ta configuration Supabase|config\.js)/.test(html), f + " : renvoi vers config.js");
  });
  assert.ok(!/id="login-screen"/.test(chat), "chat.html : plus d'écran de pseudo");
  assert.match(disc, /id="google-btn"/, "discussions.html garde la connexion Google");
});

test("chat.html : le nom du salon vient de la base, jamais du paramètre « name » de l'adresse", () => {
  assert.ok(!/params\.get\("name"\)|ROOM_NAME/.test(chatCode));
  assert.match(chatCode, /document\.getElementById\("room-title"\)\.textContent = "💬 " \+ room\.name;/);
  assert.match(chat, /<h1 id="room-title">💬 Salon<\/h1>/);
});

test("chat.html : un visiteur sans session peut afficher les messages (rien ne suppose currentUser)", () => {
  assert.match(chatCode, /\(currentUser && msg\.user_id === currentUser\.id \? " mine" : ""\)/, "renderMessage");
  assert.match(chatCode, /const isMine = !!currentUser && msg\.user_id === currentUser\.id;/, "menu d'actions");
  // les autres usages de currentUser.id sont gardés par une session
  assert.match(chatCode, /async function loadHiddenMessageIds\(\) \{\s*if \(!currentUser\) return;/);
  assert.match(chatCode, /async function markAsRead\(\) \{\s*if \(!currentUser\) return;/);
  assert.match(chatCode, /if \(!content \|\| !currentUser\) return;/, "envoi d'un message");
  assert.match(chatCode, /if \(queueSending \|\| !currentUser\) return;/, "envoi de pièces jointes");
});

test("chat.html : sans session, trySilentResume entre quand même dans le salon (lecture seule)", () => {
  const fn = chatCode.slice(chatCode.indexOf("async function trySilentResume"), chatCode.indexOf("composer.addEventListener"));
  assert.match(fn, /await enterRoom\(\);\s*\}\s*$/, "enterRoom est appelé aussi sans session");
  assert.ok(!/if \(data && data\.session && data\.session\.user\) \{[\s\S]*await enterRoom\(\);\s*\}\s*\}\s*$/.test(fn), "enterRoom n'est pas réservé aux comptes connectés");
});

test("chat.html : visiteur = barre « lecture seule » et pas de zone de saisie ; connecté = zone de saisie", () => {
  assert.match(chat, /<div id="visitor-bar" class="hidden">[\s\S]*Tu lis ce salon en lecture seule\. Connecte-toi pour écrire\.[\s\S]*<a id="visitor-login" href="index\.html">Se connecter<\/a>/);
  assert.match(chatCode, /if \(currentUser\) composer\.classList\.remove\("hidden"\);\s*else visitorBar\.classList\.remove\("hidden"\);/);
  assert.match(chatCode, /if \(currentUser\) messageInput\.focus\(\);/);
});

test("chat.html : visiteur — copier et partager seulement (masquer pour moi, signaler, modifier, supprimer exigent un compte)", () => {
  assert.match(chatCode, /\[data-action="delete-me"\]'\)\.style\.display = currentUser \? "flex" : "none";/);
  assert.match(chatCode, /\[data-action="report"\]'\)\.style\.display = currentUser && !isMine \? "flex" : "none";/);
});

test("chat.html : salon payant sans session → présentation (nom, prix), pas de bouton d'achat, invitation à se connecter, aucun message chargé", () => {
  const fn = chatCode.slice(chatCode.indexOf("async function checkRoomAccess"), chatCode.indexOf("async function buyRoomAccess"));
  const iVisitor = fn.indexOf("if (!currentUser) {");
  assert.ok(iVisitor > 0, "branche visiteur");
  assert.ok(iVisitor < fn.indexOf("currentUser.id"), "la branche visiteur précède tout usage de currentUser.id");
  assert.match(fn, /locked-buy-btn"\)\.classList\.add\("hidden"\)/);
  assert.match(fn, /locked-login-link"\)\.classList\.remove\("hidden"\)/);
  assert.match(fn, /document\.getElementById\("locked-screen"\)\.classList\.remove\("hidden"\);\s*return false;/);
  assert.match(chat, /<a id="locked-login-link" class="hidden" href="index\.html"/);
  assert.match(chatCode, /const hasAccess = await checkRoomAccess\(room\);\s*if \(!hasAccess\) return;/, "pas d'historique ni d'abonnement sans accès");
});

test("chat.html : salon introuvable → message clair ; erreur réseau → on entre quand même (historique de l'appareil)", () => {
  assert.match(chatCode, /async function loadRoom\(\) \{[\s\S]*return \{ room: data \|\| null, error: error \|\| null \};/);
  assert.match(chatCode, /if \(!roomError && !room\) \{\s*showRoomState\("Salon introuvable"/);
  assert.match(chat, /id="room-state"/);
  assert.match(chat, /<div id="status-message" role="status" aria-live="polite"><\/div>/, "l'élément du message bref existe");
});

test("chat.html : lecture publique — historique et temps réel ne demandent aucune session", () => {
  const fn = chatCode.slice(chatCode.indexOf("async function enterRoom"), chatCode.indexOf("async function trySilentResume"));
  assert.match(fn, /await loadHistory\(\);\s*subscribeToNewMessages\(\);/);
  assert.match(chatCode, /\.channel\("room:" \+ ROOM_ID\)/);
  assert.match(chatCode, /filter: "room_id=eq\." \+ ROOM_ID/);
});

test("chat.html : toujours aucun innerHTML avec une donnée de salon ou de message", () => {
  assert.ok(!/innerHTML\s*=\s*`/.test(chatCode));
  assert.ok(!/innerHTML[^;]*(room\.|msg\.)/.test(chatCode));
});

test("cache hors ligne : version ≥ v91 (chat.html et discussions.html ont changé)", () => {
  assert.ok(Number((read("sw.js").match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 91);
});

console.log("\n" + passed + " test(s) réussi(s)");
