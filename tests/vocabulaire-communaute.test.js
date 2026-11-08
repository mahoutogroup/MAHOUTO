/* Vocabulaire : un salon PAYANT s'appelle une « communauté payante » dans tous les textes affichés ;
   les salons gratuits restent des « salons ». Rien ne change dans les noms techniques.
   Exécution : node tests/vocabulaire-communaute.test.js — aucune dépendance, aucun réseau. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

// Enlève les commentaires (le vocabulaire ne concerne que les textes affichés).
function stripComments(code) {
  return code.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// Fichiers qui contiennent des textes affichés : pages, modules du navigateur, fonctions api/.
function listDisplayFiles() {
  const out = [];
  (function scan(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (["node_modules", ".git", "tests", "migrations"].includes(e.name)) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return scan(p);
      if (!/\.(html|js)$/.test(e.name)) return;
      out.push(path.relative(root, p));
    });
  })(root);
  return out;
}

// Les conditions de vente (et les pages juridiques) ne sont modifiées qu'après relecture du cabinet.
const LEGAL = new Set(["conditions-vente.html", "conditions-vendeurs.html", "mentions-legales.html"]);

test("aucun « salon payant » / « salons payants » (toutes casses) dans un texte affiché, hors pages juridiques", () => {
  const bad = [];
  listDisplayFiles().filter((f) => !LEGAL.has(f)).forEach((f) => {
    stripComments(read(f)).split("\n").forEach((line, i) => {
      if (/salons?\s+payante?s?/i.test(line)) bad.push(f + ":" + (i + 1) + " " + line.trim().slice(0, 120));
    });
  });
  assert.deepStrictEqual(bad, []);
});

test("textes de l'écran d'une communauté payante (chat.html)", () => {
  const chat = read("chat.html");
  assert.match(chat, /<h2 id="locked-room-name">Communauté payante<\/h2>/);
  assert.match(chat, /<p>Rejoins cette communauté pour lire et écrire les messages\.<\/p>/);
  assert.match(chat, /🔗 Partager cette communauté<\/button>/);
  assert.match(chat, /Connecte-toi pour débloquer cette communauté\./);
  assert.match(chat, /openLogin\("Se connecter pour débloquer cette communauté"\)/);
  assert.ok(!/débloquer ce salon/i.test(chat));
});

test("salon GRATUIT : textes inchangés (lecture seule, en-tête, introuvable)", () => {
  const chat = read("chat.html");
  assert.match(chat, /Tu lis ce salon en lecture seule\. Connecte-toi pour écrire\./);
  assert.match(chat, /aria-label="Partager ce salon" title="Partager ce salon"/);
  assert.match(chat, /Ce salon n'existe pas ou n'existe plus\./);
});

test("retour de paiement, liste des discussions, achats, administration", () => {
  assert.match(read("payment-return.js"), /Bienvenue dans la communauté\./);
  const disc = read("discussions.html");
  assert.match(disc, /🔒 Communauté payante/);
  assert.match(disc, /Paiement confirmé ! Communauté débloquée\./);
  assert.match(disc, /room\.is_paid \? "Partager cette communauté" : "Partager ce salon"/);
  assert.match(read("mes-achats.html"), /"🔒 Mes communautés"/);
  const admin = read("admin/rooms.html");
  assert.strictEqual((admin.match(/Communauté payante \(accès sur achat\)/g) || []).length, 2);
  assert.match(admin, /Indique un prix valide pour une communauté payante\./);
  assert.match(admin, /Crée des communautés payantes/);
  assert.match(admin, /gère le prix des salons existants/);
});

test("« Mes communautés » : la liste ne contient que des achats de communautés payantes", () => {
  const m = read("mes-achats.html");
  assert.match(m, /const roomPurchases = purchases\.filter\(\(p\) => p\.product_type === "salon"\);/);
  assert.ok(!/Mes salons/.test(m));
});

test("paiement : libellé FedaPay et nom par défaut d'une communauté", () => {
  const api = read("api/fedapay-checkout.js");
  assert.match(api, /platformLabel = `\$\{brandName\} Communautés`;/);
  assert.match(api, /article\.name \|\| `Communauté \$\{brandName\}`/);
  assert.match(api, /Ce salon n'est pas payant\./, "message sur un salon gratuit : inchangé");
});

test("aperçu de lien et message de partage : payante / gratuit", () => {
  const Og = require("../api/_room-og.js");
  const Share = require("../room-share.js");
  const paid = Og.buildRoomPreview({ name: "VIP", is_paid: true, price: 5000 }, "vip");
  assert.strictEqual(paid.description, "Communauté payante : " + Number(5000).toLocaleString("fr-FR") + " FCFA — Rejoins cette communauté sur MAHOUTO+");
  assert.strictEqual(paid.redirectLabel, "Ouverture de la communauté…");
  const free = Og.buildRoomPreview({ name: "Général", is_paid: false }, "general");
  assert.strictEqual(free.description, "Rejoins ce salon sur MAHOUTO+");
  assert.strictEqual(free.redirectLabel, "Ouverture du salon…");
  assert.strictEqual(Share.buildMessage({ name: "VIP", is_paid: true, price: 5000 }), "Rejoins « VIP » sur MAHOUTO+ (communauté payante : " + Number(5000).toLocaleString("fr-FR") + " FCFA).");
  assert.strictEqual(Share.buildMessage({ name: "Général", is_paid: false }), "Rejoins « Général » sur MAHOUTO+.");
  assert.strictEqual(Share.buildMessage({ is_paid: true, price: 5000 }).startsWith("Rejoins « cette communauté » "), true);
  assert.strictEqual(Share.buildMessage({}), "Rejoins « ce salon » sur MAHOUTO+.");
});

test("noms techniques inchangés : product_type « salon », table rooms, lien /r/<salon>, classes CSS", () => {
  assert.match(read("api/fedapay-checkout.js"), /productType === "salon"/);
  assert.match(read("chat.html"), /productType: "salon"/);
  assert.match(read("vercel.json"), /\/r\/:id/);
  assert.match(read("room-share.js"), /"\/r\/"/);
  assert.match(read("chat.html"), /id="locked-room-name"/);
});

console.log("\n" + passed + " test(s) réussi(s)");
