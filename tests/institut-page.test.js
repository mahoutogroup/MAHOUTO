/* Page de présentation de l'Institut SAYÉ LOUIS (institut.html) : page statique, sans formulaire, sans base de données,
   sans paiement. Exécution : node --test tests/institut-page.test.js — aucune dépendance, aucun réseau. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const page = read("institut.html");
const index = read("index.html");
const sw = read("sw.js");
// Texte visible approximatif : balises retirées, entités courantes décodées (&nbsp; -> espace)
const text = page.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

test("la page existe, avec le bon titre, la bonne description et la structure du modèle (entrepreneur.html)", () => {
  assert.ok(fs.existsSync(path.join(root, "institut.html")));
  assert.match(page, /<title>Institut SAYÉ LOUIS — MAHOUTO\+<\/title>/);
  assert.match(page, /<html lang="fr">/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  assert.match(page, /<meta name="description" content="Institut SAYÉ LOUIS/);
  ["brand.js", "theme-toggle.js"].forEach((f) => assert.ok(page.includes('<script src="' + f + '"></script>'), f));
  assert.ok(page.includes('<link rel="stylesheet" href="theme.css">') && page.includes('<link rel="manifest" href="manifest.json">'));
  assert.ok(page.includes('<link rel="icon" href="assets/favicon.png">'));
  assert.match(page, /\.guide \{ max-width: 720px; margin: 0 auto;/);
  assert.match(page, /<a class="back" href="index\.html">/);
  assert.match(page, /id="theme-toggle-btn"/);
});

test("orthographe : « SAYÉ LOUIS » pour l'institut, « Sayé Louis » pour le père, jamais « Saint-Louis »", () => {
  assert.ok(page.includes("SAYÉ LOUIS") && page.includes("Sayé Louis"));
  assert.ok(!/saint[\s-]*louis/i.test(page), "« Saint-Louis » interdit");
  assert.ok(!/\bSAYE\b|\bSaye\b|\bsaye\b/.test(page), "« Sayé » sans accent");
  // chaque « Institut Sayé Louis » est écrit exactement « Institut SAYÉ LOUIS »
  const mentions = page.match(/Institut\s+SAY[ÉEé]\s+LOUIS|Institut\s+Sayé\s+Louis/gi) || [];
  assert.ok(mentions.length >= 2);
  mentions.forEach((m) => assert.strictEqual(m.replace(/\s+/g, " "), "Institut SAYÉ LOUIS", m));
  // « Sayé Louis » (père) : toujours avec accent et capitales initiales seulement
  (text.match(/sayé louis/gi) || []).forEach((m) => assert.ok(m === "SAYÉ LOUIS" || m === "Sayé Louis", "casse : " + m));
  assert.ok(/en mémoire de son père, Sayé Louis/.test(text));
  assert.ok(/Mahouto Abdallah/.test(text));
});

test("sections demandées présentes, dans l'ordre, avec l'accroche et 4 étapes numérotées", () => {
  const heads = ["Notre histoire", "Pour qui ?", "Comment ça marche", "Un exemple de tarif", "Soutenir l'Institut", "Protection des enfants"];
  let last = -1;
  heads.forEach((h) => { const i = page.indexOf("<h2>" + h + "</h2>"); assert.ok(i > last, "section absente ou hors ordre : " + h); last = i; });
  assert.strictEqual((page.match(/<h1>/g) || []).length, 1);
  assert.ok(text.includes("Une formation à tarif social pour les orphelins."));
  const ol = /<ol>([\s\S]*?)<\/ol>/.exec(page);
  assert.ok(ol, "liste numérique");
  assert.strictEqual((ol[1].match(/<li>/g) || []).length, 4);
  assert.ok(/parrain dépose une demande/.test(ol[1]) && /examinée/.test(ol[1]) && /validée/.test(ol[1]) && /place à tarif Institut est ouverte/.test(ol[1]) && /certificat/.test(ol[1]));
  assert.ok(/dont les petits-fils de Sayé Louis/.test(text) && /après validation d'une demande de parrainage/.test(text));
  assert.ok(/D'autres formations \(informatique, graphisme…\) viendront ensuite\./.test(text));
  assert.ok(/Les modalités seront annoncées prochainement\./.test(text));
  assert.ok(/Les justificatifs resteront privés/.test(text) && /Aucune photo et aucun nom d'enfant/.test(text));
});

test("exemple de tarif : 250 000 FCFA à l'Académie, 50 000 FCFA à l'Institut, dans des cellules identifiables", () => {
  assert.ok(text.includes("250 000 FCFA") && text.includes("50 000 FCFA"));
  assert.match(page, /<td class="price" id="tarif-academie">250&nbsp;000&nbsp;FCFA<\/td>/);
  assert.match(page, /<td class="price" id="tarif-institut">50&nbsp;000&nbsp;FCFA<\/td>/);
  assert.ok(text.includes("Sérigraphie") && text.includes("Académie Majesté Presse"));
  // les montants ne sont écrits qu'à cet endroit : une seule modification suffit
  assert.strictEqual((text.match(/250 000/g) || []).length, 1);
  assert.strictEqual((text.match(/(?<!2)50 000/g) || []).length, 1);
});

test("la page n'est pas indexable : meta robots noindex", () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
});

test("le bouton « Demander un parrainage » est désactivé (disabled + aria-disabled) avec « Bientôt disponible »", () => {
  const btn = /<button\b[^>]*>Demander un parrainage<\/button>/.exec(page);
  assert.ok(btn, "bouton présent");
  assert.match(btn[0], /\bdisabled\b/);
  assert.match(btn[0], /aria-disabled="true"/);
  assert.match(btn[0], /type="button"/);
  assert.ok(!/\b(onclick|href|formaction)\b/.test(btn[0]));
  assert.match(page, /aria-describedby="cta-note"[^>]*>Demander un parrainage/);
  assert.match(page, /<p class="cta-note" id="cta-note">Bientôt disponible<\/p>/);
  assert.strictEqual((page.match(/<button\b/g) || []).length, 2, "uniquement le bouton de thème et le bouton désactivé");
});

test("page sans formulaire, sans paiement, sans innerHTML ; seuls scripts autorisés : lecture publique des textes, compteurs et formations (PR 2 et 3)", () => {
  assert.ok(!/<form\b|<input\b|<textarea\b|<select\b/i.test(page), "aucun champ de saisie");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(page));
  assert.ok(!/\b(XMLHttpRequest|fedapay|localStorage|sessionStorage)\b/i.test(page));
  assert.ok(!/<script>/.test(page) && !/<script\b(?![^>]*\bsrc=)/.test(page), "aucun script en ligne");
  // PR 2 : la page lit institut_contenus (lecture publique) avec le client Supabase, comme les autres pages.
  const srcs = [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(srcs, [
    "brand.js", "config.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
    "institut-page.js", "institut-place-utils.js", "institut-utils.js", "pwa-install.js", "theme-toggle.js"
  ]);
  const external = [...page.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(external, ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"], "seule ressource externe : le client Supabase");
});

test("données publiques : aucun téléphone, e-mail, lien de paiement ni donnée personnelle", () => {
  assert.ok(!/(tel:|mailto:|wa\.me|whatsapp)/i.test(page));
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(page), "adresse e-mail");
  assert.ok(!/(\+\d[\d .-]{6,}|\b\d{2}[ .-]\d{2}[ .-]\d{2}[ .-]\d{2}\b|\b\d{8,}\b)/.test(page.replace(/&nbsp;/g, " ")), "numéro de téléphone");
  assert.ok(!/(sk_(live|test)_|whsec_|api[_-]?key)/i.test(page));
});

test("service worker : institut.html dans APP_SHELL à côté de metre.html, cache v109 ou plus", () => {
  const shell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  assert.ok(shell.includes('"/institut.html"'));
  assert.ok(shell.indexOf('"/institut.html"') - shell.indexOf('"/metre.html"') < 40 && shell.indexOf('"/institut.html"') > shell.indexOf('"/metre.html"'), "à côté de metre.html");
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 109);
});

test("index.html : la carte « Institut SAYÉ LOUIS » reste désactivée, non cliquable, sans lien vers institut.html", () => {
  assert.ok(!/institut\.html/.test(index), "aucun lien vers institut.html");
  const m = /<div class="card module-card disabled">((?:(?!<div class="card)[\s\S])*?<h2>Institut SAYÉ LOUIS<\/h2>[\s\S]*?<div class="go">Bientôt disponible<\/div>)\s*<\/div>/.exec(index);
  assert.ok(m, "carte .disabled avec « Bientôt disponible »");
  assert.ok(!/<a\b|onclick/.test(m[1]), "carte non cliquable : ni lien ni gestionnaire");
  assert.ok([...m[1].matchAll(/href="([^"]*)"/g)].every((h) => h[1].startsWith("#")), "seul le symbole SVG (#...) porte un href");
});
