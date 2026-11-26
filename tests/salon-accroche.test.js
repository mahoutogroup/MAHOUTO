/* Phrase d'accroche d'un salon payant (salon-accroche.sql + rollback + vérification, salon-accroche.js, chat.html écran verrouillé,
   admin/rooms.html réglages) et vouvoiement de l'écran verrouillé. Lecture statique des fichiers SQL (jamais exécutés ici) et
   exécution réelle des fonctions d'affichage dans un faux DOM. Les scénarios SQL réels (17 contrôles avec les vraies politiques
   de la table rooms) ont été joués sur une base PostgreSQL locale jetable : voir la description de la PR. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const A = require("../salon-accroche");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ====================== SQL (lecture de fichiers uniquement) ======================
const FILES = ["salon-accroche.sql", "salon-accroche-rollback.sql", "salon-accroche-verification.sql"];
const raw = read(FILES[0]), rawRb = read(FILES[1]), rawVf = read(FILES[2]);
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(raw), sqlRb = strip(rawRb), sqlVf = strip(rawVf);
const blocs = (t) => { const parts = t.split(/^-- BLOC (\d+) - /m), out = {}; for (let i = 1; i < parts.length; i += 2) out[Number(parts[i])] = parts[i + 1]; return out; };
const B = blocs(raw), BR = blocs(rawRb);
const squash = (t) => t.replace(/\s+/g, " ").trim();

test("SQL : 4 petits blocs numérotés, un seul sujet chacun ; rollback en 2 blocs (contraintes, puis colonne avec confirmation)", () => {
  assert.deepStrictEqual(Object.keys(B).map(Number), [1, 2, 3, 4]); assert.deepStrictEqual(Object.keys(BR).map(Number), [1, 2]);
  assert.ok(!/create |insert |update |delete |drop |alter /i.test(strip(B[1])) || /raise exception/.test(B[1]), "le bloc 1 ne modifie rien");
  assert.ok(!/\b(alter|create|drop|insert|update|delete)\b/i.test(B[1].replace(/raise exception '[^']*'/g, "")), "bloc 1 : verification seulement");
  assert.strictEqual(squash(strip(B[2].split("\n").slice(1).join("\n"))), "alter table public.rooms add column if not exists accroche text;");
  assert.match(squash(strip(B[3])), /drop constraint if exists rooms_accroche_longueur_check; alter table public\.rooms add constraint rooms_accroche_longueur_check check \(accroche is null or char_length\(accroche\) <= 120\);/);
  assert.match(squash(strip(B[4])), /rooms_accroche_une_ligne_check check \(accroche is null or \(position\(chr\(10\) in accroche\) = 0 and position\(chr\(13\) in accroche\) = 0 and position\(chr\(9\) in accroche\) = 0\)\);/);
  assert.ok(/drop constraint if exists rooms_accroche_une_ligne_check/.test(BR[1]) && /drop constraint if exists rooms_accroche_longueur_check/.test(BR[1]) && !/drop column/.test(BR[1]));
  assert.ok(/confirmation constant text := 'NON'/.test(BR[2]) && /raise exception 'Retour arriere NON confirme/.test(BR[2]) && /alter table public\.rooms drop column if exists accroche;/.test(BR[2]));
  assert.ok(!/confirmation/.test(BR[1].split("\n").slice(1).join("\n")), "le retrait des contraintes est sans confirmation");
});

test("SQL : colonne texte NULLABLE sans valeur par défaut (les salons existants ne changent pas) ; contraintes idempotentes", () => {
  assert.ok(!/accroche text (not null|default)/i.test(sql), "ni not null ni default");
  assert.strictEqual((sql.match(/add column if not exists/g) || []).length, 1);
  assert.strictEqual((sql.match(/drop constraint if exists/g) || []).length, 2, "chaque contrainte est retirée avant d'être recréée : relançable");
  assert.ok(!/not valid/i.test(sql), "les salons existants (accroche vide) respectent la contrainte");
  [3, 4].forEach((k) => { const m = /drop constraint if exists (\w+);\s*alter table public\.rooms\s+add constraint (\w+)\s+check/.exec(strip(B[k])); assert.ok(m && m[1] === m[2], "bloc " + k + " : la contrainte retirée est celle qui est recréée (idempotent)"); });
  assert.ok(sqlRb.includes("drop constraint if exists rooms_accroche_une_ligne_check") && sqlRb.includes("drop constraint if exists rooms_accroche_longueur_check") && sqlVf.includes("rooms_accroche_longueur_check") && sqlVf.includes("rooms_accroche_une_ligne_check"), "mêmes noms dans le rollback et la vérification");
});

test("SQL : AUCUN droit élargi — ni politique, ni fonction, ni grant, ni revoke, ni trigger : la lecture et l'écriture suivent les politiques existantes", () => {
  [sql, sqlRb].forEach((s) => assert.ok(!/create (or replace )?(policy|function|trigger|view)|\bgrant\b|\brevoke\b|alter policy|drop policy|enable row level|security definer/i.test(s), "aucun droit touché"));
  assert.ok(!/anon|authenticated|public\.rooms to /i.test(sql), "anon et authenticated ne sont jamais cités");
  assert.ok(!/alter table\s+(?!public\.rooms\s)/i.test(sql + sqlRb), "seule la table rooms est modifiée");
  assert.ok(!/drop table|truncate|delete from|update public/i.test(sql + sqlRb));
  assert.match(raw, /rooms_public_read/); assert.match(raw, /rooms_update_own_or_admin/);
});

test("SQL : règles de l'éditeur mobile ($$, pas de %rowtype, LIKE, regex ni POSIX, lignes courtes, commentaires sans apostrophe et AVANT les instructions)", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t) && !/%rowtype|%type/i.test(t), f);
    const s = strip(t); assert.ok(!/\blike\b|\bilike\b|similar to/i.test(s) && !/ ~\*? |\[\[:|regexp_/i.test(s), f + " : LIKE ou regex");
    t.split("\n").forEach((l, i) => { assert.ok(l.length <= 105, f + ":" + (i + 1) + " ligne de " + l.length); if (l.trim().startsWith("--")) assert.ok(!/'/.test(l), f + ":" + (i + 1) + " apostrophe dans un commentaire"); });
  });
  [B, BR].forEach((bl) => Object.keys(bl).forEach((k) => { const body = bl[k].split("\n").slice(1); const firstCode = body.findIndex((l) => l.trim() && !l.trim().startsWith("--")); const lastComment = body.map((l, i) => (l.trim().startsWith("--") ? i : -1)).filter((i) => i >= 0).pop(); assert.ok(lastComment === undefined || lastComment < firstCode, "bloc " + k + " : commentaire après une instruction"); }));
});

test("vérification : UNE requête, UNE ligne de booléens, lecture seule (colonne, longueur, lecture publique, écriture réservée, rien d'élargi)", () => {
  assert.ok((sqlVf.match(/;/g) || []).length === 1 && /^\s*select\b/i.test(sqlVf));
  assert.ok(!/\b(insert|update|delete|drop|create|alter|grant|revoke)\b/i.test(sqlVf.replace(/'[^']*'/g, "''")), "lecture seule");
  const cols = [...sqlVf.matchAll(/\bas\s+([a-z0-9_]+)(?:,|\s*;)/g)].map((m) => m[1]);
  assert.deepStrictEqual(cols, ["colonne_presente_texte_facultatif", "contrainte_longueur_120_presente", "contrainte_une_ligne_presente", "lecture_publique_comme_le_nom_et_le_prix", "ecriture_reservee_createur_ou_administrateur", "aucune_ecriture_sans_controle_donc_rien_pour_anon"]);
});

// ====================== salon-accroche.js : fonctions pures ======================
test("longueur maximale : 120 caractères (émojis et accents comptés comme un caractère), refus au-delà", () => {
  assert.strictEqual(A.MAX, 120);
  assert.strictEqual(A.validate("é".repeat(120)).ok, true); assert.strictEqual(A.validate("é".repeat(121)).ok, false); assert.strictEqual(A.validate("é".repeat(121)).error, "L'accroche ne doit pas dépasser 120 caractères.");
  assert.strictEqual(A.validate("😀".repeat(120)).ok, true, "un émoji compte pour un caractère"); assert.strictEqual(A.validate("😀".repeat(121)).ok, false);
  assert.strictEqual(A.length("😀é"), 2); assert.strictEqual(A.counterText("abc"), "3 / 120"); assert.strictEqual(A.counterText(""), "0 / 120");
  assert.strictEqual(A.display("a".repeat(500)).length, 120, "même une valeur trop longue venue de la base est coupée à 120");
  assert.match(raw, /char_length\(accroche\) <= 120/); assert.ok(read("admin/rooms.html").includes('class="r-accroche" maxlength="120"'));
});

test("texte propre : une seule ligne, espaces multiples réduits, bords rognés ; vide → null (champ facultatif)", () => {
  assert.strictEqual(A.clean("  Conseils \n\n  et\tentraide   \r\n entre   pairs  "), "Conseils et entraide entre pairs");
  assert.strictEqual(A.clean("a b\u0085c\u0000d"), "a b c d"); assert.strictEqual(A.clean(null), ""); assert.strictEqual(A.clean(undefined), ""); assert.strictEqual(A.clean(42), "42");
  assert.deepStrictEqual(A.validate("   \n  "), { ok: true, value: null, error: null }); assert.deepStrictEqual(A.validate(null), { ok: true, value: null, error: null });
  assert.deepStrictEqual(A.validate("  Bienvenue  \n chez nous "), { ok: true, value: "Bienvenue chez nous", error: null });
});

test("liens et adresses web : refusés à l'enregistrement avec un message clair ; la ponctuation ordinaire reste permise", () => {
  ["Visitez https://exemple.test", "http://x.test", "www.exemple.fr", "Retrouvez-nous sur mahouto.com", "écrivez à moi@mail.com", "wa.me/22900000000", "bit.ly/abc", "ftp://x", "mailto:a@b.c", "//exemple.test", "MAHOUTO.COM", "vente.shop", "a.b.co"]
    .forEach((s) => { const r = A.validate(s); assert.strictEqual(r.ok, false, s); assert.strictEqual(r.error, "L'accroche ne peut pas contenir de lien ni d'adresse web. Retirez-le, puis réessayez.", s); assert.strictEqual(A.hasLink(s), true, s); });
  ["Conseils et entraide entre sérigraphes", "Bonjour.Merci de votre visite", "Salon des artisans. Bienvenue !", "Version 2.0 du salon", "Prix : 5.000 FCFA", "Tél +229 00 00 00 00", "Nous contacter : par message", "<b>gras</b>", "Rejoignez-nous, c'est simple…"]
    .forEach((s) => assert.strictEqual(A.validate(s).ok, true, s));
});

test("affichage : accroche absente → texte par défaut vouvoyé ; accroche présente → affichée ; un lien venu d'ailleurs est ignoré", () => {
  assert.strictEqual(A.DEFAULT_TEXT, "Rejoignez cette communauté pour lire et écrire les messages.");
  [null, undefined, "", "   ", "\n\t"].forEach((v) => assert.strictEqual(A.display(v), A.DEFAULT_TEXT, JSON.stringify(v)));
  assert.strictEqual(A.display("  Conseils,\n devis et entraide  "), "Conseils, devis et entraide");
  ["Visitez https://x.test", "www.x.fr", "vente.com"].forEach((v) => assert.strictEqual(A.display(v), A.DEFAULT_TEXT, "lien ignoré : " + v));
});

// ====================== chat.html : écran verrouillé ======================
const CHAT = read("chat.html");
const el = () => { const e = { _t: "", children: [], set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t; }, set innerHTML(v) { throw new Error("innerHTML interdit"); }, appendChild(c) { this.children.push(c); } }; return e; };
function lockedIntro(room) {
  const intro = el(), doc = { getElementById: (i) => { assert.strictEqual(i, "locked-intro"); return intro; } };
  const src = CHAT.slice(CHAT.indexOf("function renderLockedIntro"), CHAT.indexOf("// ---------- fin de l'accroche ----------"));
  vm.runInNewContext(src + "\nrenderLockedIntro(room);", { document: doc, MahoutoSalonAccroche: A, room });
  return intro;
}

test("écran verrouillé : accroche absente → texte par défaut vouvoyé (HTML et exécution)", () => {
  assert.match(CHAT, /<p id="locked-intro">Rejoignez cette communauté pour lire et écrire les messages\.<\/p>/);
  [{ name: "S", is_paid: true }, { accroche: null }, { accroche: "" }, { accroche: "  \n " }, null].forEach((room) => assert.strictEqual(lockedIntro(room).textContent, "Rejoignez cette communauté pour lire et écrire les messages.", JSON.stringify(room)));
});

test("écran verrouillé : accroche présente → affichée sous le nom, avant le prix, en texte brut", () => {
  assert.strictEqual(lockedIntro({ accroche: "Conseils, devis et entraide entre sérigraphes" }).textContent, "Conseils, devis et entraide entre sérigraphes");
  const i = (s) => CHAT.indexOf(s);
  assert.ok(i('id="locked-room-name"') < i('id="locked-intro"') && i('id="locked-intro"') < i('id="locked-price"'), "nom, puis accroche, puis prix");
  assert.ok(i("document.getElementById(\"locked-room-name\").textContent = room.name;\n    renderLockedIntro(room);") > 0, "affichée avec le nom du salon payant");
});

test("écran verrouillé : AUCUN HTML interprété (textContent, jamais d'innerHTML), une seule ligne, 120 caractères, pas de lien cliquable", () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">clic</a>';
  const e = lockedIntro({ accroche: evil }); assert.strictEqual(e.children.length, 0, "aucun noeud créé : texte brut"); assert.strictEqual(e.textContent, evil.replace(/\s+/g, " "), "le HTML saisi reste du texte");
  assert.strictEqual(lockedIntro({ accroche: "ligne 1\nligne 2\r\nligne 3" }).textContent, "ligne 1 ligne 2 ligne 3");
  assert.strictEqual(lockedIntro({ accroche: "x".repeat(300) }).textContent.length, 120);
  assert.strictEqual(lockedIntro({ accroche: "Allez sur https://piege.test" }).textContent, A.DEFAULT_TEXT, "un lien écrit hors de l'application n'est pas affiché");
  const src = CHAT.slice(CHAT.indexOf("function renderLockedIntro"), CHAT.indexOf("// ---------- fin de l'accroche ----------"));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|createElement\("a"\)|href/.test(src), "aucun HTML ni lien construit");
  assert.ok(src.includes(".textContent = MahoutoSalonAccroche.display("));
});

test("chat.html : l'accroche est lue par le MÊME chemin que le nom et le prix (table rooms, lecture publique), avec repli si la colonne n'existe pas encore", () => {
  const f = CHAT.slice(CHAT.indexOf("async function loadRoom()"), CHAT.indexOf("// ---------- Accroche du salon"));
  assert.ok(f.includes('"name, is_paid, price, created_by, photo_url, abonnement, accroche"') && f.indexOf("abonnement, accroche") < f.indexOf('"name, is_paid, price, created_by, photo_url, abonnement",') && f.includes('"name, is_paid, price, created_by, photo_url"\n'), "trois jeux de colonnes, du plus complet au plus ancien");
  assert.ok(f.includes('.from("rooms")') && !/rpc\(/.test(f), "lecture directe de rooms comme le nom et le prix, aucune nouvelle fonction");
  assert.ok(/<script src="salon-accroche\.js"><\/script>/.test(CHAT) && CHAT.indexOf("salon-accroche.js") < CHAT.indexOf("<script>\n"), "module chargé avant le script de la page");
});

// ====================== vouvoiement ======================
const L = "\\p{L}";
const TUT = new RegExp(`(?<![${L}])(ton|ta|tes|toi|tu|t'[${L}]+|[${L}]+-toi|connecte|connecte-[${L}]+|saisis|clique|vérifie|réessaie|reconnecte-toi|renouvelle-le|rejoins|entre|attends|essaie|choisis|indique|reviens|retrouve|contacte)(?![${L}])`, "iu");
test("AUCUN tutoiement sur l'écran verrouillé (texte HTML et messages de la logique de l'écran)", () => {
  const html = CHAT.slice(CHAT.indexOf('<div id="locked-screen"'), CHAT.indexOf('<div id="media-viewer"')).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(!TUT.test(html), "HTML : " + html);
  const js = CHAT.slice(CHAT.indexOf("// ---------- Salon payant : accès, achat, retour de paiement"), CHAT.indexOf("async function enterRoom()")).replace(/\/\/[^\n]*/g, "");
  const chaines = [...js.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\p{L}{4}/u.test(s));
  assert.ok(chaines.length > 10, "chaînes lues : " + chaines.length);
  assert.deepStrictEqual(chaines.filter((s) => TUT.test(s)), [], "chaînes tutoyées restantes");
});

test("textes vouvoyés de l'écran verrouillé : liste exacte (avant → après)", () => {
  [["Rejoignez cette communauté pour lire et écrire les messages.", "Rejoins cette communauté pour lire et écrire les messages."], ["Connectez-vous pour débloquer cette communauté.", "Connecte-toi pour débloquer cette communauté."],
    ["Votre abonnement a expiré. Renouvelez-le pour retrouver l'accès : vos messages sont conservés.", "Ton abonnement a expiré. Renouvelle-le pour retrouver l'accès : tes messages sont conservés."], ["Impossible de charger les forfaits. Réessayez dans un instant.", "Impossible de charger les forfaits. Réessaie dans un instant."],
    ["Connectez-vous avec Google ou votre e-mail pour acheter.", "Connecte-toi avec Google ou ton e-mail pour acheter."], ["Votre session a expiré. Reconnectez-vous puis réessayez.", "Ta session a expiré. Reconnecte-toi puis réessaie."], ['"réessayez dans un instant."', '"réessaie dans un instant."']]
    .forEach(([apres, avant]) => { assert.ok(CHAT.includes(apres), "absent : " + apres); assert.ok(!CHAT.includes(avant), "tutoiement resté : " + avant); });
  assert.match(CHAT, /En payant, vous acceptez les <a href="conditions-vente\.html"[^>]*>conditions de vente et retours<\/a>\./, "la phrase sur les conditions de vente était déjà vouvoyée");
});

test("textes laissés de côté (hors écran verrouillé ou partagés avec d'autres pages) : inchangés", () => {
  assert.ok(CHAT.includes("Tu lis ce salon en lecture seule. Connecte-toi pour écrire."), "barre du visiteur : autre écran");
  assert.ok(read("payment-return.js").includes("Ton paiement n'est pas encore confirmé."), "module partagé avec d'autres pages");
  assert.ok(read("api/fedapay-checkout.js").includes("Connecte-toi avec Google ou ton e-mail pour acheter."), "message de l'API : redéploiement séparé");
  assert.ok(read("api/_salon-abonnement.js").includes("Choisis un forfait."), "message de l'API : redéploiement séparé");
});

// ====================== admin/rooms.html : réglages du salon ======================
const ADM = read("admin/rooms.html");
test("réglages du salon : champ « Phrase d'accroche (facultatif) » avec compteur, limité à 120, aide, enregistré par le même chemin que les autres réglages", () => {
  assert.ok(ADM.includes("<label>Phrase d'accroche (facultatif)</label>"));
  assert.ok(ADM.includes('<input type="text" class="r-accroche" maxlength="120" autocomplete="off"'));
  assert.ok(ADM.includes("Cette phrase s'affiche sur l'écran verrouillé de la communauté, sous le nom et avant le prix"), "texte d'aide : où elle s'affiche");
  assert.ok(ADM.includes('${"accroche" in r ? `'), "champ présent seulement si la colonne existe (SQL exécuté)");
  assert.ok(ADM.includes("MahoutoSalonAccroche.counterText(accrocheInput.value)") && ADM.includes('accrocheInput.addEventListener("input", majCompteur)'), "compteur en direct");
  assert.ok(ADM.includes("accrocheInput.value = MahoutoSalonAccroche.clean(r.accroche);"), "valeur posée en texte, jamais dans du HTML");
  assert.ok(!/accroche[^\n]*innerHTML|\$\{[^}]*accroche[^}]*\}/.test(ADM.replace('${"accroche" in r ? `', "")), "aucune insertion de l'accroche dans un gabarit HTML");
  assert.ok(ADM.includes("const check = MahoutoSalonAccroche.validate(accrocheInput.value);\n          if (!check.ok) { alert(check.error); return; }"), "lien ou longueur : enregistrement refusé avec un message");
  assert.ok(ADM.includes("if (accrocheInput) payload.accroche = accrocheValue;\n        const { error } = await supabase\n          .from(\"rooms\")\n          .update(payload)"), "même update que le prix et le mode payant");
  assert.ok(ADM.indexOf("check.error") < ADM.indexOf("payload.accroche"), "validation avant envoi");
  assert.ok(/<script src="\.\.\/salon-accroche\.js"><\/script>/.test(ADM));
});

test("réglages du salon : textes vouvoyés (prix, mode abonnement, création) ; autres zones de la page inchangées", () => {
  assert.strictEqual((ADM.match(/Indiquez un prix valide pour une communauté payante\./g) || []).length, 2, "modification (alerte) et création (message)");
  assert.ok(ADM.includes("Vérifiez que « Test 1 jour » est désactivé") && !ADM.includes("Indique un prix valide") && !ADM.includes("Vérifie que « Test 1 jour »"));
  assert.ok(ADM.includes("désactive-le après ton essai") && ADM.includes("Connecte-toi avec un compte administrateur pour accéder à cette page."), "autres zones (forfaits, accès) non touchées");
});

test("sw.js : cache v136 (main était à v135), salon-accroche.js pré-caché comme room-safe.js ; aucun fichier dans api/ ; aucune clé", () => {
  const sw = read("sw.js"); assert.match(sw, /const CACHE_NAME = "mahoutoplus-shell-v(136|13[7-9]|1[4-9]\d)";/); assert.strictEqual((sw.match(/"\/salon-accroche\.js"/g) || []).length, 1); assert.ok(sw.indexOf('"/salon-accroche.js"') > sw.indexOf('"/room-safe.js"'));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions : aucun fichier ajouté dans api/");
  assert.ok(!/service_role|sk_live|sk_test|eyJhbGci|BEGIN (RSA )?PRIVATE KEY/.test([raw, rawRb, rawVf, read("salon-accroche.js")].join("\n")));
});
