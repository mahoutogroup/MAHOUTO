/* Page statique « Règles des pages publiques » (regles-pages-publiques.html), ses liens depuis profil.html et m.html, vercel.json, sw.js.
   Aucun réseau, aucune base. Le texte est celui fourni : il ne doit ni s'enrichir ni changer sans décision. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PAGE = read("regles-pages-publiques.html");
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const TEXT = text(PAGE.slice(PAGE.indexOf("<body>")));   // texte visible de la page (sans l'en-tête HTML)
const body = (re) => re.exec(PAGE)[1];

const PHRASES = [
  "Règles des pages publiques",
  "Votre page publique est votre carte de visite sur MAHOUTO+. Ces règles protègent les membres et les personnes qui visitent les pages.",
  "Ce que vous pouvez faire", "Présenter votre activité, votre métier et votre ville.", "Ajouter une photo de vous ou de votre marque.",
  "Recevoir des contacts par WhatsApp, ou par message dans MAHOUTO+ si vous l'avez autorisé.",
  "Ce qui est interdit", "Se faire passer pour une autre personne ou une autre entreprise.", "Annoncer des diplômes, des certifications ou des garanties que vous n'avez pas.",
  "Proposer des arnaques, de fausses offres ou des demandes d'argent trompeuses.", "Publier du contenu illégal, violent, haineux ou à caractère sexuel.",
  "Utiliser la photo d'une autre personne sans son accord.", "Publier les coordonnées d'une autre personne sans son accord.",
  "Conditions", "Avoir 18 ans ou plus.", "Être responsable de ce que contient votre page.",
  "Signaler une page", "Tout membre connecté peut signaler une page depuis le lien « Signaler cette page ». Les signalements sont examinés par l'équipe MAHOUTO+, qui vise une réponse sous 48 heures. Aucune page n'est suspendue automatiquement : chaque décision est prise après examen. Le nom de la personne qui signale n'est jamais montré.",
  "Suspension", "Une page qui ne respecte pas ces règles peut être suspendue. Quand c'est possible et que le cas n'est pas grave, vous êtes d'abord invité à corriger votre page.",
  "Bloquer un membre", "Dans la messagerie privée, vous pouvez bloquer un membre depuis le menu de la conversation. Vous pouvez le débloquer à tout moment dans la liste « Membres bloqués ».",
  "Qui a vu ma carte",
  "Cette fonction est facultative et désactivée par défaut : rien n'est enregistré sur vous tant que vous ne l'avez pas activée.",
  "Si vous l'activez, votre nom peut apparaître dans la liste « Qui a vu ma carte » des membres dont vous consultez la carte, à condition qu'ils l'aient eux aussi activée. Ils voient votre nom, le nombre de vos visites et le jour de votre dernier passage, jamais l'heure.",
  "Pour voir cette liste, vous devez avoir activé le réglage vous-même. Les personnes sans compte restent anonymes.",
  "Les visites sont gardées 30 jours au maximum. Si vous désactivez le réglage, votre historique de visites est effacé immédiatement.",
  "Un membre que vous avez bloqué, ou qui vous a bloqué, n'apparaît pas dans la liste.",
  "Compteur de visites",
  "Comme les pages des membres, la page de présentation « Créez votre carte de visite » compte des visites anonymes (jamais de nom ni d'identité), et le paramètre ?src= du lien sert uniquement à savoir de quel support (facture, affiche, etc.) vient la visite.",
  "Dernière mise à jour : 24 novembre 2026."
];

test("la page contient TOUTES les phrases demandées, mot pour mot, dans l'ordre", () => {
  let from = 0;
  PHRASES.forEach((p) => { const i = TEXT.indexOf(p, from); assert.ok(i >= 0, "phrase absente ou déplacée : " + p.slice(0, 60)); from = i; });
});

test("structure : 1 h1, 8 sections h2 dans l'ordre, listes de 3, 6, 2 et 5 puces, rien d'autre de rédigé", () => {
  assert.strictEqual((PAGE.match(/<h1[ >]/g) || []).length, 1);
  assert.deepStrictEqual([...PAGE.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ["Ce que vous pouvez faire", "Ce qui est interdit", "Conditions", "Signaler une page", "Suspension", "Bloquer un membre", "Qui a vu ma carte", "Compteur de visites"]);
  assert.deepStrictEqual([...PAGE.matchAll(/<ul>([\s\S]*?)<\/ul>/g)].map((m) => (m[1].match(/<li>/g) || []).length), [3, 6, 2, 5]);
  assert.strictEqual((PAGE.match(/<section aria-labelledby="r-\w+">/g) || []).length, 8);
  assert.ok([...PAGE.matchAll(/<h2 id="(r-\w+)"/g)].every((m) => PAGE.includes('aria-labelledby="' + m[1] + '"')), "chaque section est reliée à son titre");
  // tout le texte visible = les phrases fournies + l'en-tête et le lien de retour (rien d'ajouté)
  let rest = TEXT; PHRASES.forEach((p) => { rest = rest.replace(p, ""); });
  assert.strictEqual(rest.replace(/\s+/g, " ").trim(), "MAHOUTO+ ← Retour à l'accueil", "aucun texte en plus (promesse, référence juridique…)");
});

test("aucun numéro de téléphone, aucune adresse e-mail, aucun nom de personne, aucun faux « vérifié / certifié »", () => {
  assert.ok(!/@/.test(TEXT + PAGE.replace(/<style[\s\S]*?<\/style>/, "")), "aucun e-mail");
  assert.ok(!/(\+|00)?\d[\d .\-()]{6,}\d/.test(TEXT), "aucun numéro");
  assert.ok(!/mailto:|tel:|wa\.me|whatsapp\.com/i.test(PAGE), "aucun lien de contact");
  assert.ok(!/v[ée]rifi[ée]|certifi[ée]\b|verified|certified/i.test(PAGE), "aucun badge");
  assert.strictEqual((TEXT.match(/certification/gi) || []).length, 1, "« certifications » seulement dans la phrase d'interdiction");
  assert.ok(!/AKLOMBESSIKPE|Mahouto Florentin|Abdallah|Majest/.test(PAGE), "aucun nom de personne");
  assert.ok(!/\b(loi|décret|article \d|code pénal|RGPD|juridiq)/i.test(TEXT), "aucune référence juridique inventée");
});

test("page statique et sobre : aucun innerHTML, aucune ressource externe (police, image, script), un seul petit script, pas de noindex", () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(PAGE));
  const ext = [...PAGE.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]; assert.deepStrictEqual(ext, [], "aucune ressource externe");
  assert.ok(!/@import|url\(\s*["']?https?:|fonts\.(googleapis|gstatic)|<link[^>]+(\.woff|fonts)/i.test(PAGE));
  assert.deepStrictEqual([...PAGE.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ["/brand.js", "/theme-toggle.js"], "seulement les scripts de marque et de thème existants");
  assert.strictEqual((PAGE.match(/<script>/g) || []).length, 1, "un seul script en ligne (logo de la marque), sans réseau");
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|supabase/i.test(body(/<script>([\s\S]*?)<\/script>/)));
  assert.ok(!/noindex/i.test(PAGE), "page publique et utile : indexable");
  assert.match(PAGE, /<html lang="fr">/); assert.match(PAGE, /<title>Règles des pages publiques — MAHOUTO\+<\/title>/); assert.match(PAGE, /<meta name="description" content="[^"]{20,200}">/);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(PAGE.replace(/<style[\s\S]*?<\/style>/, "")), "aucun emoji");
  assert.ok(!/<img[^>]+src="https?:/.test(PAGE) && (PAGE.match(/<img /g) || []).length === 1 && /-128\.png/.test(body(/<img [^>]*src="([^"]+)"/)), "un seul logo, version légère");
});

test("en-tête de marque, lien de retour vers l'accueil et bouton de thème, comme les autres pages", () => {
  assert.match(PAGE, /<a class="marque" href="\/index\.html" aria-label="MAHOUTO\+, retour à l'accueil">/);
  assert.match(PAGE, /<a class="retour" href="\/index\.html">← Retour à l'accueil<\/a>/);
  assert.match(PAGE, /<button type="button" id="theme-toggle-btn" class="theme-toggle-fab" aria-label="Changer de thème/);
  assert.ok(PAGE.indexOf('class="marque"') < PAGE.indexOf('class="retour"') && PAGE.indexOf('class="retour"') < PAGE.indexOf("<h1"));
  const srcs = [...PAGE.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]); assert.ok(srcs.indexOf("/brand.js") < srcs.indexOf("/theme-toggle.js"));
  assert.match(PAGE, /<link rel="stylesheet" href="\/theme\.css">/);
});

test("lien depuis « Mon profil public » : « Lire les règles des pages publiques », même onglet, case des 18 ans et logique de publication inchangées", () => {
  const h = read("profil.html");
  assert.match(h, /<a class="pp-regles" id="pp-lien-regles" href="\/regles-pages-publiques\.html">Lire les règles des pages publiques<\/a>/);
  assert.ok(!/id="pp-lien-regles"[^>]*target=/.test(h), "même onglet");
  assert.ok(h.indexOf('id="pp-e-majeur"') < h.indexOf('id="pp-lien-regles"') && h.indexOf('id="pp-lien-regles"') < h.indexOf('id="pp-btn-enregistrer"'), "sous la case des 18 ans, avant les boutons");
  assert.ok(h.includes('<label class="check" for="pp-majeur"><input type="checkbox" id="pp-majeur"><span>Je certifie avoir 18 ans ou plus.</span></label>'), "case des 18 ans inchangée");
  assert.ok(h.includes('<div class="err" id="pp-e-majeur" role="alert"></div>'));
  assert.ok(h.includes('<button type="button" class="pp-btn" id="pp-btn-publier">Publier ma page</button>'));
  const js = read("profil-public.js"); assert.ok(!/regles|pp-lien-regles/.test(js), "profil-public.js n'est pas modifié");
  assert.ok(js.includes('$("pp-btn-publier").addEventListener("click", function () { save(true); });')); assert.ok(js.includes('majeur: $("pp-majeur").checked'));
  assert.match(read("profil-public-utils.js"), /Pour publier votre page, certifiez avoir 18 ans ou plus\./);
  assert.match(h, /\.pp a\.pp-regles \{[^}]*min-height: 44px/); assert.match(h, /body\.light-theme \.pp a\.pp-regles \{ color: var\(--gold-text/);
});

test("lien depuis la page publique : « Règles » dans le pied de carte, pour TOUS les visiteurs (hors zone de signalement)", () => {
  const h = read("m.html");
  assert.match(h, /<p class="regles-lien"><a id="lien-regles" href="\/regles-pages-publiques\.html">Règles<\/a><\/p>/);
  const foot = h.slice(h.indexOf('<footer class="pied">'), h.indexOf("</footer>"));
  assert.ok(foot.includes('id="lien-regles"') && foot.indexOf("Créer ma page") < foot.indexOf('id="lien-regles"') && foot.indexOf('id="lien-regles"') < foot.indexOf('id="signalement-zone"'), "dans le pied, après « Créer ma page », avant « Signaler »");
  const zone = foot.slice(foot.indexOf('id="signalement-zone"')); assert.ok(!zone.includes("lien-regles"), "pas dans la zone masquée selon le visiteur");
  assert.ok(!/<p class="regles-lien"[^>]*hidden/.test(h) && !/id="lien-regles"[^>]*(hidden|target=)/.test(h));
  assert.match(h, /\.regles-lien a \{[^}]*min-height: 44px/);
  assert.ok(!/lien-regles|regles-pages/.test(read("m.js")), "m.js n'est pas modifié : le lien est statique, donc visible même sans connexion ni script");
  assert.ok(h.includes('<a href="/profil.html">Créer ma page</a>') && h.includes('id="btn-signaler">Signaler cette page</button>'), "les liens existants du pied sont intacts");
});

test("adresse /regles-pages-publiques : réécriture correcte, vercel.json valide, autres réécritures et en-têtes intacts, pas de noindex", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/regles-pages-publiques"), { source: "/regles-pages-publiques", destination: "/regles-pages-publiques.html" });
  ["/p/:id", "/f/:id", "/s/:id", "/e/:slug", "/r/:id", "/verify/:code", "/m/:adresse", "/pro"].forEach((s) => assert.ok(v.rewrites.some((r) => r.source === s), s + " intacte"));
  assert.ok(!v.headers.some((h) => /regles/.test(h.source)), "aucun en-tête noindex pour la page des règles");
  assert.ok(fs.existsSync(path.join(root, "regles-pages-publiques.html")));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions");
  assert.ok(!fs.readdirSync(root).some((f) => /\.sql$/.test(f) && /regles-pages/.test(f)), "aucun SQL");
});

test("sw.js : cache v125 ou plus et page des règles dans APP_SHELL ; nom du cache de partage inchangé", () => {
  const sw = read("sw.js"); assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v(12[5-9]|1[3-9]\d)"/); assert.match(sw, /SHARE_CACHE_NAME = "mahoutoplus-share-v1"/);
  assert.strictEqual((sw.match(/"\/regles-pages-publiques\.html"/g) || []).length, 1);
});

// ====================== contrastes AA calculés dans les deux thèmes ======================
const hex = (s) => { let h = s.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const theme = read("theme.css"), decl = (t, n) => { const m = new RegExp(n + ":\\s*(#[0-9a-fA-F]{3,6})").exec(t); assert.ok(m, n); return m[1]; };
const dark = theme.match(/:root \{([^}]*)\}/)[1], light = theme.match(/body\.light-theme\{([^}]*)\}/)[1];
const TH = { sombre: { fond: decl(dark, "--bg"), carte: decl(dark, "--bg-card"), texte: decl(dark, "--white"), doux: decl(dark, "--text-muted"), accent: decl(dark, "--gold") },
  clair: { fond: decl(light, "--bg"), carte: decl(light, "--bg-card"), texte: decl(light, "--white"), doux: decl(light, "--text-muted"), accent: decl(theme, "--gold-text") } };
test("contrastes AA (≥ 4,5) calculés dans les deux thèmes : texte, texte atténué, titres et liens dorés, en-tête", () => {
  assert.match(PAGE, /:root \{ --reg-accent: var\(--gold\)/); assert.match(PAGE, /body\.light-theme \{ --reg-accent: var\(--gold-text, #856500\)/);
  const css = body(/<style>([\s\S]*?)<\/style>/); assert.ok(!/color: var\(--text-dim\)/.test(css), "--text-dim interdit pour du texte");
  for (const [n, t] of Object.entries(TH)) {
    [["texte courant (h1) sur la carte", t.texte, t.carte], ["texte des listes et paragraphes sur la carte", t.doux, t.carte], ["titres h2 dorés sur la carte", t.accent, t.carte],
      ["lien « Retour » doré sur le fond de page", t.accent, t.fond], ["nom de la marque sur le fond de page", t.texte, t.fond]].forEach(([l, a, b]) => { const r = ratio(a, b); assert.ok(r >= 4.5, n + " — " + l + " : " + r.toFixed(2)); });
  }
  assert.ok(ratio("#D4AF37", "#FFFFFF") < 4.5, "garde du test : l'or de marque sur blanc ne passerait pas (d'où --gold-text)");
});

test("accessibilité et mise en page (statique) : interligne 1,65, ≈ 60 caractères, 44 px, focus visible, reduced-motion, pas de débordement", () => {
  const css = body(/<style>([\s\S]*?)<\/style>/);
  assert.match(css, /\.panneau p, \.panneau li \{[^}]*max-width: 62ch[^}]*font-size: 16px; line-height: 1\.65/); assert.match(css, /\.intro \{[^}]*max-width: 62ch[^}]*line-height: 1\.65/);
  assert.match(css, /\.retour \{[^}]*min-height: 44px/); assert.match(css, /\.marque \{[^}]*min-height: 44px/); assert.match(css, /\.mh \.theme-toggle-fab \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--reg-focus\)/); assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*animation: none !important/);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /\.regles \{[^}]*max-width: 600px/); assert.match(css, /body \{ overflow-x: hidden;/);
});
