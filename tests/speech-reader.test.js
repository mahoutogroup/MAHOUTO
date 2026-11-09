/* Bouton « écouter » : module speech-reader.js (voix intégrée, aucun envoi du texte).
   Exécution : node tests/speech-reader.test.js — aucune dépendance, aucun réseau. */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../speech-reader");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  OK  " + name); }
  catch (err) { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
}

// Faux navigateur : speechSynthesis qui garde les phrases ; on termine les lectures à la main.
function fakeWin(opts) {
  opts = opts || {};
  const w = { spoken: [], queue: [], cancels: 0, listeners: [], timers: [] };
  let voices = opts.voices || [];
  w.SpeechSynthesisUtterance = function (text) { this.text = text; };
  w.speechSynthesis = {
    getVoices: () => voices,
    get speaking() { return w.queue.length > 0; },
    get pending() { return false; },
    speak: (u) => { w.spoken.push(u); w.queue.push(u); },
    cancel: () => { w.cancels++; const q = w.queue.splice(0); q.forEach((u) => u.onerror && u.onerror({ error: "canceled" })); },
    addEventListener: (ev, fn) => { if (ev === "voiceschanged") w.listeners.push(fn); }
  };
  w.setVoices = (v) => { voices = v; w.listeners.slice().forEach((fn) => fn()); };
  w.setTimeout = (fn, ms) => { const t = { fn, ms }; w.timers.push(t); return t; };
  w.clearTimeout = (t) => { w.timers = w.timers.filter((x) => x !== t); };
  // Exécute les minuteries courtes (≤ maxMs) : par exemple la pause de 80 ms entre cancel() et speak().
  w.flush = (maxMs) => { const due = w.timers.filter((t) => t.ms <= maxMs); w.timers = w.timers.filter((t) => t.ms > maxMs); due.forEach((t) => t.fn()); };
  w.finish = () => { const u = w.queue.shift(); if (u && u.onend) u.onend(); return u; };
  return w;
}
const FR = { name: "Amélie", lang: "fr-FR", localService: true };

(async () => {
  await test("nettoyage : liens remplacés par « lien » (http, www, domaine), espaces réduits", () => {
    assert.strictEqual(S.cleanText("  Salut   à tous \n\n voici https://mahouto.com/p/abc?x=1 ok  "), "Salut à tous voici lien ok");
    assert.strictEqual(S.cleanText("va sur www.exemple.fr/page puis mahouto.com/r/vip"), "va sur lien puis lien");
    assert.strictEqual(S.cleanText("https://a.b/c"), "lien");
    assert.strictEqual(S.cleanText("Bonjour​ monde"), "Bonjour monde");
    assert.strictEqual(S.cleanText(null), "");
    assert.strictEqual(S.cleanText(42), "");
    assert.ok(!/https?:|www\./i.test(S.cleanText("x https://secret.example/token=abc y")));
  });

  await test("messages : supprimé, vide, sans texte (pièce jointe seule), espaces seuls → pas de bouton", () => {
    assert.strictEqual(S.canListen({ content: "Bonjour" }), true);
    assert.strictEqual(S.canListen({ content: "Bonjour", is_deleted: true }), false);
    assert.strictEqual(S.canListen({ content: "", attachment_url: "https://x/y.pdf" }), false);
    assert.strictEqual(S.canListen({ content: "   \n " }), false);
    assert.strictEqual(S.canListen({ content: null }), false);
    assert.strictEqual(S.canListen({}), false);
    assert.strictEqual(S.canListen(null), false);
    assert.strictEqual(S.canListen({ content: "https://a.b/c" }), true, "un lien seul se lit « lien »");
  });

  await test("découpage : phrases regroupées, chaque morceau ≤ CHUNK_MAX, rien de perdu", () => {
    assert.deepStrictEqual(S.splitChunks("Bonjour. Ça va ? Oui !"), ["Bonjour. Ça va ? Oui !"]);
    const long = "Première phrase assez longue. ".repeat(30);
    const chunks = S.splitChunks(long);
    assert.ok(chunks.length > 1);
    chunks.forEach((c) => assert.ok(c.length <= S.CHUNK_MAX, "morceau de " + c.length));
    assert.strictEqual(chunks.join(" ").replace(/\s+/g, " "), long.trim());
    assert.deepStrictEqual(S.splitChunks(""), []);
    assert.deepStrictEqual(S.splitChunks("   "), []);
  });

  await test("découpage : mot géant coupé net ; limite de 1 000 caractères puis arrêt propre", () => {
    const giant = S.splitChunks("x".repeat(500));
    giant.forEach((c) => assert.ok(c.length <= S.CHUNK_MAX));
    assert.strictEqual(giant.join("").length, 500);
    const all = S.splitChunks("Une phrase courte. ".repeat(200));
    const total = all.join(" ").length;
    assert.ok(total <= S.MAX_CHARS, "total " + total);
    assert.ok(/\.$/.test(all[all.length - 1]), "coupé en fin de phrase");
    assert.ok(S.splitChunks("m".repeat(5000)).join("").length <= S.MAX_CHARS);
    assert.strictEqual(S.MAX_CHARS, 1000);
  });

  await test("disponibilité de speechSynthesis", () => {
    assert.strictEqual(S.isAvailable(fakeWin()), true);
    assert.strictEqual(S.isAvailable({}), false);
    assert.strictEqual(S.isAvailable(null), false);
    assert.strictEqual(S.isAvailable({ speechSynthesis: {} , SpeechSynthesisUtterance: function () {} }), false);
    const w = fakeWin(); delete w.SpeechSynthesisUtterance;
    assert.strictEqual(S.isAvailable(w), false);
    const r = S.createReader({ win: {} });
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.speak("1", "Bonjour"), false);
    r.stop();   // sans erreur
  });

  await test("voix française : fr-FR avant fr-CA, locale avant réseau, fr_FR (Android) reconnu, sinon null", () => {
    const en = { lang: "en-US" }, frCA = { lang: "fr-CA", localService: true }, frNet = { lang: "fr-FR", localService: false }, frLocal = { lang: "fr-FR", localService: true };
    assert.strictEqual(S.pickFrenchVoice([en, frCA, frNet, frLocal]), frLocal);
    assert.strictEqual(S.pickFrenchVoice([en, frCA]), frCA);
    assert.strictEqual(S.pickFrenchVoice([{ lang: "fr_FR" }]).lang, "fr_FR");
    assert.strictEqual(S.pickFrenchVoice([{ lang: "fr" }]).lang, "fr");
    assert.strictEqual(S.pickFrenchVoice([en, { lang: "de-DE" }, { lang: "frisian" }]), null);
    assert.strictEqual(S.pickFrenchVoice([]), null);
    assert.strictEqual(S.pickFrenchVoice(undefined), null);
  });

  await test("lecture : langue fr-FR, voix française, morceaux lus l'un après l'autre, état remis à zéro à la fin", () => {
    const w = fakeWin({ voices: [{ lang: "en-US" }, FR] });
    const changes = [];
    const r = S.createReader({ win: w, onChange: (id) => changes.push(id) });
    assert.strictEqual(r.speak("m1", "Une phrase. ".repeat(40)), true);
    assert.strictEqual(r.currentId(), "m1");
    assert.strictEqual(w.spoken.length, 1, "un seul morceau en file à la fois");
    assert.strictEqual(w.spoken[0].lang, "fr-FR");
    assert.strictEqual(w.spoken[0].voice, FR);
    let guard = 0; while (w.queue.length && guard++ < 50) w.finish();
    assert.ok(w.spoken.length > 1);
    assert.strictEqual(r.currentId(), null);
    assert.deepStrictEqual(changes, ["m1", null]);
  });

  await test("un seul message à la fois : lire un autre arrête le précédent (rappels périmés ignorés)", () => {
    const w = fakeWin({ voices: [FR] });
    const changes = [];
    const r = S.createReader({ win: w, onChange: (id) => changes.push(id) });
    r.speak("a", "Premier message. ".repeat(30));
    r.speak("b", "Deuxième message.");
    assert.strictEqual(r.currentId(), "b");
    w.flush(S.CANCEL_GAP_MS);
    assert.strictEqual(w.spoken[w.spoken.length - 1].text, "Deuxième message.");
    assert.ok(w.cancels >= 1);
    w.finish();
    assert.strictEqual(r.currentId(), null);
    assert.deepStrictEqual(changes, ["a", "b", null]);
  });

  await test("stop() : arrête et vide ; un second stop ne fait rien de mal", () => {
    const w = fakeWin({ voices: [FR] });
    const r = S.createReader({ win: w });
    r.speak("a", "Bonjour tout le monde.");
    r.stop();
    assert.strictEqual(r.currentId(), null);
    assert.strictEqual(w.queue.length, 0);
    r.stop();
  });

  await test("voix chargées en retard (voiceschanged) : le premier clic attend puis lit avec la voix française", () => {
    const w = fakeWin({ voices: [] });
    const r = S.createReader({ win: w });
    r.speak("a", "Bonjour.");
    assert.strictEqual(w.spoken.length, 0, "en attente des voix");
    assert.strictEqual(r.currentId(), "a");
    w.setVoices([FR]);
    assert.strictEqual(w.spoken.length, 1);
    assert.strictEqual(w.spoken[0].voice, FR);
  });

  await test("aucune voix listée même après l'attente : on lit quand même (fr-FR), sans message ; arrêt pendant l'attente respecté", () => {
    const w = fakeWin({ voices: [] });
    let msg = 0;
    const r = S.createReader({ win: w, onNoFrenchVoice: () => msg++ });
    r.speak("a", "Bonjour.");
    w.timers[0].fn();
    assert.strictEqual(w.spoken.length, 1);
    assert.strictEqual(w.spoken[0].voice, undefined);
    assert.strictEqual(msg, 0);
    const w2 = fakeWin({ voices: [] });
    const r2 = S.createReader({ win: w2 });
    r2.speak("a", "Bonjour.");
    r2.stop();
    w2.setVoices([FR]);
    assert.strictEqual(w2.spoken.length, 0, "arrêtée pendant l'attente : rien n'est lu");
  });

  await test("voix présentes mais aucune française : message exact UNE seule fois, la lecture continue", () => {
    const w = fakeWin({ voices: [{ lang: "en-US" }, { lang: "de-DE" }] });
    const msgs = [];
    const r = S.createReader({ win: w, onNoFrenchVoice: (m) => msgs.push(m) });
    r.speak("a", "Bonjour."); w.finish();
    r.speak("b", "Encore."); 
    assert.deepStrictEqual(msgs, ["Aucune voix française n'est installée sur ton téléphone."]);
    assert.strictEqual(w.spoken.length, 2, "rien n'est bloqué");
    assert.strictEqual(w.spoken[0].lang, "fr-FR");
  });

  await test("erreur de lecture : état remis à zéro, aucune exception", () => {
    const w = fakeWin({ voices: [FR] });
    const r = S.createReader({ win: w });
    r.speak("a", "Bonjour. Deux.");
    w.queue[0].onerror({ error: "synthesis-failed" });
    w.queue.length = 0;   // le moteur a vidé sa file après l'erreur
    assert.strictEqual(r.currentId(), null);
    w.speechSynthesis.speak = () => { throw new Error("boom"); };
    r.speak("b", "Bonjour.");
    assert.strictEqual(r.currentId(), null);
  });

  await test("majuscules : MAHOUTO, MAJESTÉ, SÉRIGRAPHIE, PRESSE (3 lettres ou plus, accents compris) → minuscules, prononcés comme des mots", () => {
    assert.strictEqual(S.normalizeCaps("MAHOUTO"), "mahouto");
    assert.strictEqual(S.normalizeCaps("MAJESTÉ"), "majesté");
    assert.strictEqual(S.normalizeCaps("PRESSE"), "presse");
    assert.strictEqual(S.normalizeCaps("SÉRIGRAPHIE"), "sérigraphie");
    assert.strictEqual(S.normalizeCaps("ÉCOLE ÔTE ÇAVA"), "école ôte çava");
    assert.strictEqual(S.normalizeCaps("MAJESTÉ PRESSE et MAHOUTO"), "majesté presse et mahouto");
  });

  await test("sigles : IA, PDF, SMS, USB, TVA, IFU, RCCM, OAPI, URL, API, GPS, HTML, CSS, FCFA… restent en majuscules (épelés)", () => {
    ["IA", "PDF", "SMS", "USB", "QR", "CV", "TVA", "IFU", "RCCM", "OAPI", "URL", "PC", "TV", "RH", "ONG", "PME", "PNG", "JPG", "HTML", "CSS", "API", "GPS", "FCFA"].forEach((a) => {
      assert.strictEqual(S.normalizeCaps(a), a, a);
      assert.ok(S.SPELLED_ACRONYMS.includes(a), a + " dans la liste");
    });
    assert.strictEqual(S.normalizeCaps("Envoie le PDF par SMS, 5 000 FCFA TVA comprise"), "Envoie le PDF par SMS, 5 000 FCFA TVA comprise");
    assert.strictEqual(S.normalizeCaps("L'IA de MAHOUTO lit ton PDF"), "L'IA de mahouto lit ton PDF");
    assert.ok(S.SPELLED_ACRONYMS.every((a) => a === a.toUpperCase()), "liste en majuscules");
  });

  await test("mots de 1 ou 2 lettres en majuscules : inchangés ; « À » seul reste « À »", () => {
    assert.strictEqual(S.normalizeCaps("IA TV PC OK À Ô"), "IA TV PC OK À Ô");
    assert.strictEqual(S.normalizeCaps("ET"), "ET");
    assert.strictEqual(S.normalizeCaps("TOI"), "toi", "3 lettres : converti (hors liste)");
  });

  await test("mots mêlés, nombres, montants, ponctuation, « + » : inchangés ou traités sans casse", () => {
    assert.strictEqual(S.normalizeCaps("Mahouto iPhone WhatsApp WiFi FedaPay"), "Mahouto iPhone WhatsApp WiFi FedaPay");
    assert.strictEqual(S.normalizeCaps("5 000 FCFA, 12,50 € le 01/02/2026 !?"), "5 000 FCFA, 12,50 € le 01/02/2026 !?");
    assert.strictEqual(S.normalizeCaps("A4 COVID19 5G B2B 3D"), "A4 COVID19 5G B2B 3D", "mots avec chiffres : inchangés");
    assert.strictEqual(S.normalizeCaps("MAHOUTO+ est lancé"), "mahouto+ est lancé", "« + » conservé, le mot est prononcé");
    assert.strictEqual(S.normalizeCaps("SAINT-LOUIS, L'ONU"), "saint-louis, L'onu");
    assert.strictEqual(S.normalizeCaps("déjà en minuscules, Et Majuscule Initiale"), "déjà en minuscules, Et Majuscule Initiale");
    assert.strictEqual(S.normalizeCaps(""), "");
    assert.strictEqual(S.normalizeCaps(null), "");
  });

  await test("texte entièrement en majuscules : lu comme des mots (sauf sigles)", () => {
    assert.strictEqual(S.normalizeCaps("BONJOUR À TOUS, REJOIGNEZ MAHOUTO"), "bonjour À tous, rejoignez mahouto");
    assert.strictEqual(S.normalizeCaps("ENVOYEZ LE PDF À L'ONG AVANT DEMAIN !"), "envoyez LE PDF À L'ONG avant demain !");
  });

  await test("voix : le texte envoyé à speechSynthesis est converti ; le message (contenu affiché) n'est jamais modifié", () => {
    const w = fakeWin({ voices: [FR] });
    const r = S.createReader({ win: w });
    const msg = { id: "m1", content: "BONJOUR À TOUS, REJOIGNEZ MAHOUTO sur MAJESTÉ PRESSE. Envoie le PDF." };
    const before = msg.content;
    r.speak("m1", msg.content);
    assert.strictEqual(w.spoken[0].text, "bonjour À tous, rejoignez mahouto sur majesté presse. Envoie le PDF.");
    assert.strictEqual(msg.content, before, "le message n'est pas modifié");
    assert.strictEqual(S.canListen(msg), true);
    assert.strictEqual(S.cleanText("MAHOUTO"), "MAHOUTO", "cleanText ne change pas la casse");
  });

  await test("chat.html : l'affichage des messages n'utilise pas la conversion (elle ne sert qu'à la voix)", () => {
    const chat = read("chat.html");
    assert.ok(!/normalizeCaps|toLowerCase\(\)\s*;?\s*\/\/\s*voix/.test(chat));
    const code = strip(read("speech-reader.js"));
    assert.strictEqual((code.match(/normalizeCaps\(/g) || []).length, 2, "définie + appelée une seule fois (dans splitChunks)");
    assert.ok(/clean = normalizeCaps\(clean\);/.test(code));
  });

  // ---------- Incident « le bouton 🔊 ne fait rien » : diagnostic visible et robustesse ----------
  // Faux moteur « Chrome Android » : un speak() lancé dans la même milliseconde qu'un cancel() est rejeté (« interrupted »).
  function strictEngine() {
    const w = fakeWin({ voices: [FR] });
    let justCancelled = false;
    const origSpeak = w.speechSynthesis.speak, origCancel = w.speechSynthesis.cancel;
    w.speechSynthesis.cancel = () => { justCancelled = true; origCancel(); w.timers.push({ fn: () => { justCancelled = false; }, ms: 0 }); };
    w.speechSynthesis.speak = (u) => {
      if (justCancelled) { w.spoken.push(u); setTimeout(() => u.onerror && u.onerror({ error: "interrupted" }), 0); return; }
      origSpeak(u);
    };
    w.tick = () => { const t = w.timers.filter((x) => x.ms === 0); w.timers = w.timers.filter((x) => x.ms !== 0); t.forEach((x) => x.fn()); };
    return w;
  }

  await test("premier clic : aucun cancel() inutile juste avant speak() (rejeté par certains Chrome Android)", () => {
    const w = strictEngine();
    const fails = [];
    const r = S.createReader({ win: w, onFailure: (c) => fails.push(c) });
    r.speak("a", "Bonjour tout le monde.");
    assert.strictEqual(w.cancels, 0, "rien à annuler : pas de cancel()");
    assert.strictEqual(w.queue.length, 1);
    assert.strictEqual(r.currentId(), "a");
    assert.deepStrictEqual(fails, []);
  });

  await test("remplacer un message : cancel() puis speak() APRÈS une courte pause (80 ms), pas dans la même milliseconde", () => {
    const w = strictEngine();
    const fails = [];
    const r = S.createReader({ win: w, onFailure: (c) => fails.push(c) });
    r.speak("a", "Premier message.");
    r.speak("b", "Second message.");
    assert.strictEqual(w.cancels, 1);
    assert.strictEqual(w.spoken.length, 1, "le second message attend la pause");
    w.tick();            // le moteur est de nouveau prêt
    w.flush(S.CANCEL_GAP_MS);
    assert.strictEqual(w.spoken.length, 2);
    assert.strictEqual(w.spoken[1].text, "Second message.");
    assert.strictEqual(r.currentId(), "b");
    assert.deepStrictEqual(fails, []);
  });

  await test("diagnostic : erreur de l'appareil → bouton remis à zéro ET code d'erreur transmis", () => {
    for (const err of ["synthesis-failed", "language-unavailable", "not-allowed", "interrupted"]) {
      const w = fakeWin({ voices: [FR] });
      const fails = [];
      const r = S.createReader({ win: w, onFailure: (c, d) => fails.push(c) });
      r.speak("a", "Bonjour.");
      w.queue[0].onerror({ error: err });
      assert.strictEqual(r.currentId(), null);
      assert.deepStrictEqual(fails, ["error:" + err]);
    }
  });

  await test("diagnostic : speak() lève une exception → code speak-exception avec le nom de l'erreur", () => {
    const w = fakeWin({ voices: [FR] });
    w.speechSynthesis.speak = () => { const e = new Error("boom"); e.name = "InvalidStateError"; throw e; };
    const fails = [];
    const r = S.createReader({ win: w, onFailure: (c, d) => fails.push([c, d]) });
    r.speak("a", "Bonjour.");
    assert.strictEqual(r.currentId(), null);
    assert.deepStrictEqual(fails, [["speak-exception", "InvalidStateError"]]);
  });

  await test("diagnostic : aucun démarrage dans les 3 secondes → code no-start ; un démarrage à temps n'affiche rien", () => {
    const w = fakeWin({ voices: [FR] });
    Object.defineProperty(w.speechSynthesis, "pending", { get: () => true });   // le moteur garde la phrase « en attente »
    const fails = [];
    const r = S.createReader({ win: w, onFailure: (c) => fails.push(c) });
    r.speak("a", "Bonjour.");
    w.flush(S.CANCEL_GAP_MS);   // file « en attente » : le lecteur annule d'abord, puis relance après la pause
    const timer = w.timers.find((t) => t.ms === S.START_WAIT_MS);
    assert.ok(timer, "minuterie de 3 s armée");
    timer.fn();
    assert.deepStrictEqual(fails, ["no-start"]);
    assert.strictEqual(r.currentId(), null);

    const w2 = fakeWin({ voices: [FR] });
    const fails2 = [];
    const r2 = S.createReader({ win: w2, onFailure: (c) => fails2.push(c) });
    r2.speak("a", "Bonjour.");
    w2.queue[0].onstart();            // l'appareil a démarré
    assert.ok(!w2.timers.some((t) => t.ms === S.START_WAIT_MS), "minuterie annulée");
    assert.deepStrictEqual(fails2, []);
    assert.strictEqual(r2.currentId(), "a");
  });

  await test("diagnostic : rien à lire (code empty) ; speechSynthesis absent (code no-api)", () => {
    const w = fakeWin({ voices: [FR] });
    const fails = [];
    const r = S.createReader({ win: w, onFailure: (c) => fails.push(c) });
    assert.strictEqual(r.speak("a", "   "), false);
    const r2 = S.createReader({ win: {}, onFailure: (c) => fails.push(c) });
    assert.strictEqual(r2.speak("a", "Bonjour"), false);
    assert.deepStrictEqual(fails, ["empty", "no-api"]);
  });

  await test("textes réels (accents, apostrophes, émojis, très court, sauts de ligne, majuscules) : jamais d'exception, toujours au moins un morceau lu", () => {
    const samples = ["Bonjour à tous, c'est l'équipe MAHOUTO ! 🎉", "Ok", "🔥", "Voir https://mahouto.com/p/abc\nPuis écrire", "a\r\nb\r\n", "ÇA VA ? À BIENTÔT.", "l'été, l’œuvre — « citation » …", "5 000 FCFA (IA/PDF) 😀😀", "...", "?!", "A", "\u00a0\u00a0texte\u00a0", "ǅ ǈ ǋ", "ΕΛΛΗΝΙΚΑ ΚΕΙΜΕΝΟ", "İSTANBUL ÖĞRENCİ"];
    samples.forEach((t) => {
      const w = fakeWin({ voices: [FR] });
      const fails = [];
      const r = S.createReader({ win: w, onFailure: (c) => fails.push(c) });
      assert.doesNotThrow(() => r.speak("m", t), t);
      assert.ok(w.spoken.length >= 1, "rien lu pour : " + JSON.stringify(t));
      assert.deepStrictEqual(fails, [], JSON.stringify(t));
      assert.strictEqual(r.currentId(), "m");
    });
  });

  await test("chat.html : diagnostic « La lecture n'a pas démarré (code : … ) » affiché, clic protégé par try/catch", () => {
    const chat = read("chat.html"), code = strip(chat.slice(chat.indexOf("<script>")));
    assert.match(code, /onFailure: reportSpeechFailure/);
    assert.match(code, /setStatus\("La lecture n'a pas démarré \(code : " \+ code \+ \(detail \? " " \+ detail : ""\) \+ "\)", 10000\);/);
    assert.match(code, /try \{\s*speechReader\.speak\(id, msg\.content\);\s*\} catch \(err\) \{\s*speechReader\.stop\(\);\s*reportSpeechFailure\("exception"/);
    assert.match(chat, /<div id="status-message" role="status" aria-live="polite"><\/div>/);
  });

  await test("le module ne touche jamais le réseau ni le HTML ; aucun journal console", () => {
    const code = strip(read("speech-reader.js"));
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|innerHTML|insertAdjacentHTML|document\.write|console\./.test(code));
    assert.ok(!/https?:\/\/(?!\)\)\/)/.test(code.replace(/\(\?:https\?:\\\/\\\/\|www\\\.\)/g, "")), "aucune adresse externe");
  });

  await test("chat.html : bouton sous les messages texte, rendu sans innerHTML, arrêt en sortie, pas de bouton sans speechSynthesis", () => {
    const chat = read("chat.html"), code = strip(chat.slice(chat.indexOf("<script>")));
    assert.match(chat, /<script src="message-format\.js"><\/script>\s*<script src="speech-reader\.js"><\/script>/);
    assert.match(code, /if \(speechAvailable && MahoutoSpeechReader\.canListen\(msg\)\) bubble\.appendChild\(makeSpeakButton\(msg\)\);/);
    const block = code.slice(code.indexOf("function setSpeakButtonState"), code.indexOf("function showRoomState"));
    assert.ok(!/innerHTML/.test(block));
    assert.match(block, /btn\.textContent = playing \? "⏹" : "🔊"/);
    assert.match(block, /"Arrêter la lecture" : "Écouter ce message"/);
    assert.match(block, /btn\.title = label/);
    assert.match(block, /e\.stopPropagation\(\)/);
    assert.match(block, /addEventListener\("pagehide", stopSpeaking\)/);
    assert.match(block, /addEventListener\("beforeunload", stopSpeaking\)/);
    assert.match(block, /document\.hidden\) stopSpeaking\(\)/);
    const render = code.slice(code.indexOf("function renderMessage"), code.indexOf("async function loadHiddenMessageIds"));
    assert.match(render, /msg\.is_deleted \|\| hiddenMessageIds\.has\(msg\.id\) \|\| msg\.content !== speakingMessage\.content/);
    // le bouton est dans la branche « non supprimé » (jamais sur un message supprimé)
    assert.ok(render.indexOf("makeSpeakButton") > render.indexOf("} else {"));
    assert.match(chat, /\.bubble \.speak-btn \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  });

  await test("cache hors ligne : speech-reader.js ; version ≥ v102 ; toujours 12 fonctions Vercel", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/speech-reader\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 102);
    const fns = [];
    (function scan(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) return scan(p); if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(p); }); })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
