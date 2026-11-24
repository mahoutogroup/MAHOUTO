/* Page de présentation « Créez votre carte de visite » (creer-ma-carte.html), sa réécriture et son en-tête noindex (vercel.json), son
   entrée dans profil.html et sw.js. Aucun réseau, aucune base. L'exemple de carte est FICTIF : aucun lien vers une vraie page. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PAGE = read("creer-ma-carte.html");
const body = PAGE.slice(PAGE.indexOf("<body>"));
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const TEXT = textOf(body);
const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 10));

test("la page existe, est en noindex (balise meta ET en-tête), avec réécriture /creer-ma-carte → /creer-ma-carte.html", () => {
  assert.ok(fs.existsSync(path.join(root, "creer-ma-carte.html")));
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  const v = JSON.parse(read("vercel.json"));
  assert.deepStrictEqual(v.rewrites.find((r) => r.source === "/creer-ma-carte"), { source: "/creer-ma-carte", destination: "/creer-ma-carte.html" });
  ["/creer-ma-carte", "/creer-ma-carte.html"].forEach((s) => assert.ok(v.headers.some((h) => h.source === s && h.headers.some((x) => x.key === "X-Robots-Tag" && /noindex/.test(x.value))), s + " : X-Robots-Tag noindex"));
  ["/p/:id", "/f/:id", "/s/:id", "/e/:slug", "/r/:id", "/verify/:code", "/m/:adresse", "/pro", "/regles-pages-publiques"].forEach((s) => assert.ok(v.rewrites.some((r) => r.source === s), s + " intacte"));
  ["/m/:adresse", "/m.html", "/pro", "/pro.html"].forEach((s) => assert.ok(v.headers.some((h) => h.source === s), s + " : en-têtes existants intacts"));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12, "12 fonctions, aucun nouveau fichier api/");
  assert.ok(!fs.readdirSync(root).some((f) => /\.sql$/.test(f) && /creer-ma-carte/.test(f)), "aucun SQL");
  ["robots.txt", "sitemap.xml"].forEach((f) => { if (fs.existsSync(path.join(root, f))) assert.ok(!/creer-ma-carte/.test(read(f)), f + " non touché"); });
});

test("contenu : titre, sous-titre, 4 avantages, 3 étapes, « Vos règles, votre contrôle », deux boutons, vouvoiement", () => {
  assert.match(PAGE, /<title>Créez votre carte de visite en ligne — MAHOUTO\+<\/title>/);
  assert.match(PAGE, /<h1 id="titre">Créez votre carte de visite en ligne<\/h1>/); assert.match(PAGE, /<html lang="fr">/);
  assert.ok(TEXT.includes("Une page à vous, avec une adresse facile à retenir, un QR code et un lien à partager sur WhatsApp."));
  assert.deepStrictEqual([...PAGE.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ["Exemple", "Ce que vous obtenez", "Comment ça marche", "Vos règles, votre contrôle"]);
  assert.strictEqual((PAGE.match(/<ul class="avantages">[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length, 4); assert.strictEqual((PAGE.match(/<ol class="etapes">[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length, 3);
  ["Une page prête en quelques minutes", "Une adresse personnalisée", "Un QR code et une carte à imprimer", "Un partage facile sur WhatsApp", "Créez ou ouvrez votre compte", "Remplissez votre carte", "Publiez et partagez"].forEach((t) => assert.ok(TEXT.includes(t), t));
  assert.strictEqual((PAGE.match(/<h1[ >]/g) || []).length, 1);
  assert.ok(!/\b(tu|toi|ton|ta|tes|connecte-toi)\b/i.test(TEXT), "vouvoiement");
  assert.ok(!/gratuit|garanti|offert|certifi[ée]e?s?\b|v[ée]rifi[ée]e?s?\b|meilleur|n°\s*1|promo/i.test(TEXT.replace("Certifiez avoir 18 ans ou plus", "")), "aucune promesse inventée, aucun faux badge");
});

test("deux boutons « CRÉER MA CARTE DE VISITE » (haut et bas) vers profil.html, zone tactile ≥ 48 px, focus visible", () => {
  const ctas = [...PAGE.matchAll(/<a class="btn-cta" id="(cta-\w+)" href="([^"]+)" data-cta>CRÉER MA CARTE DE VISITE<\/a>/g)];
  assert.deepStrictEqual(ctas.map((m) => [m[1], m[2]]), [["cta-haut", "/profil.html"], ["cta-bas", "/profil.html"]]);
  assert.ok(PAGE.indexOf('id="cta-haut"') < PAGE.indexOf('id="titre-exemple"') && PAGE.indexOf('id="cta-bas"') > PAGE.indexOf('id="titre-etapes"'));
  const css = PAGE.match(/<style>([\s\S]*?)<\/style>/)[1]; assert.match(css, /\.btn-cta \{[^}]*min-height: 56px/); assert.match(css, /\.lien \{[^}]*min-height: 48px/); assert.match(css, /:focus-visible \{ outline: 3px solid var\(--cm-focus\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("lien vers les règles : « Lire les règles des pages publiques » (page existante)", () => {
  assert.match(PAGE, /<a class="lien" href="\/regles-pages-publiques\.html">Lire les règles des pages publiques<\/a>/);
  assert.ok(fs.existsSync(path.join(root, "regles-pages-publiques.html")));
  assert.ok(TEXT.includes("Vous gardez la main : vous pouvez dépublier votre page à tout moment, choisir d'accepter ou non les messages, bloquer un membre dans la messagerie privée et signaler une page qui ne respecte pas les règles."));
});

test("EXEMPLE de carte : étiqueté « Exemple », contenu fictif, aucun lien (ni vers une vraie page /m/<adresse>), aucun élément cliquable", () => {
  assert.ok(TEXT.includes("Exemple") && TEXT.includes("Exemple Atelier") && TEXT.includes("Sérigraphe — Imprimeur") && TEXT.includes("mahouto.com/m/votre-nom"));
  assert.ok(TEXT.includes("Ceci est un exemple fictif : ce n'est pas la page d'un vrai membre."));
  const carte = PAGE.match(/<div class="carte"[\s\S]*?<p class="exemple-note">[^<]*<\/p>/)[0];
  assert.ok(!/<a\b|<button\b|<input\b|onclick|href=/i.test(carte), "la carte d'exemple ne contient ni lien ni bouton");
  const hrefs = [...PAGE.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!hrefs.some((h) => /(^|\/)m\/|m\.html|\/m$/.test(h)), "aucun lien vers /m/<adresse> : " + hrefs.filter((h) => /m\//.test(h)));
  assert.ok(!/mahouto\.com\/m\/(?!votre-nom)/.test(PAGE) && !/majestepresse\.com\/m\//.test(PAGE), "aucune adresse réelle");
  assert.deepStrictEqual(PAGE.match(/mahouto\.com\/m\/[a-z-]+/g), ["mahouto.com/m/votre-nom"]);
  assert.match(PAGE, /<div class="carte" role="group" aria-label="Exemple de carte de visite, avec un contenu fictif">/);
  assert.ok(!/api\/|fetch\(|rpc\(|profil_public_lire/.test(carte), "aucune donnée de membre, aucun appel serveur");
});

test("aucun script ni ressource externe au chargement ; la bibliothèque Supabase (même adresse que le reste du site) n'est chargée qu'AU CLIC", () => {
  assert.deepStrictEqual([...PAGE.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ["/brand.js", "/theme-toggle.js", "/config.js", "/pseudo.js", "/login-sheet.js"], "scripts locaux seulement");
  assert.ok(!/<script[^>]+src="https?:/i.test(PAGE), "aucune balise script externe");
  assert.ok(!/(src|href)="https?:\/\//i.test(PAGE), "aucune ressource externe (script, image, feuille de style, lien)");
  assert.ok(!/@import|url\(\s*["']?https?:|fonts\.(googleapis|gstatic)|<link[^>]+(\.woff|fonts)/i.test(PAGE), "aucune police externe");
  assert.ok(read("m.html").includes(CDN) && read("index.html").includes(CDN), "c'est la bibliothèque DÉJÀ utilisée par les autres pages");
  assert.ok(PAGE.includes('SUPABASE_LIB = "' + CDN + '"') && (PAGE.match(/cdn\.jsdelivr\.net/g) || []).length === 1, "une seule mention, dans le script qui la charge au clic");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(PAGE));
});

test("aucun cookie, aucun stockage nouveau, aucun suivi : ni analytics.js, ni page_views, ni écriture dans le stockage", () => {
  assert.ok(!/analytics\.js|page_views|document\.cookie|setItem|sessionStorage|indexedDB|sendBeacon|gtag|fbq|pixel/i.test(PAGE));
  assert.ok(!/\?ref=|[?&]ref=|parrain|referral/i.test(PAGE), "ni parrainage ni paramètre ref");
  assert.ok(!/pwa-install/.test(PAGE), "pas de bannière d'installation ajoutée");
});

test("style et marque : en-tête de marque, thème, pied avec la phrase de liaison protégée (data-brand-fixed), logos 128 px", () => {
  assert.match(PAGE, /<a class="marque" href="\/index\.html" aria-label="MAHOUTO\+, retour à l'accueil">/); assert.match(PAGE, /<button type="button" id="theme-toggle-btn" class="theme-toggle-fab" aria-label="Changer de thème/);
  assert.match(PAGE, /<link rel="stylesheet" href="\/theme\.css">/);
  assert.match(PAGE, /<span data-brand-fixed>Une plateforme MAHOUTO\+, par <span class="nw">MAJESTÉ PRESSE<\/span><\/span>/);
  assert.ok(!/MAHOUTO\+/.test(TEXT.replace("Une plateforme MAHOUTO+, par MAJESTÉ PRESSE", "").replace(/^\s*MAHOUTO\+/, "")), "aucune autre mention du nom de marque dans le texte (brand.js réécrirait le texte sous l'autre marque)");
  assert.deepStrictEqual([...PAGE.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]), ["/assets/logo-mahouto-plus-128.png", "/assets/logo-mahouto-plus-128.png"]);
  ["conditions-vente.html", "mentions-legales.html", "regles-pages-publiques.html"].forEach((f) => { assert.ok(PAGE.includes('href="/' + f + '"') && fs.existsSync(path.join(root, f)), f); });
  assert.match(read("brand.js"), /p\.closest\("\[data-brand-fixed\]"\)\) return NodeFilter\.FILTER_REJECT/);
});

test("une seule entrée discrète dans l'application : le menu « Mon compte » de profil.html ; aucune autre page modifiée", () => {
  const h = read("profil.html"); assert.strictEqual((h.match(/creer-ma-carte/g) || []).length, 1);
  assert.match(h, /<a class="card menu-item" id="creer-carte-item" href="creer-ma-carte\.html"><span class="emoji">🪪<\/span><span class="label">Créer ma carte de visite<\/span><span class="sub">→<\/span><\/a>/);
  assert.ok(h.indexOf("creer-carte-item") < h.indexOf("QR Code") && h.indexOf("creer-carte-item") > h.indexOf("mes-achats.html"));
  fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f) && !["profil.html", "creer-ma-carte.html", "sw.js"].includes(f)).forEach((f) => assert.ok(!/creer-ma-carte/.test(read(f)) || f.startsWith("tests"), f + " ne mentionne pas la page"));
  assert.ok(h.includes('<label class="check" for="pp-majeur"><input type="checkbox" id="pp-majeur"><span>Je certifie avoir 18 ans ou plus.</span></label>'), "profil.html : le reste est intact");
});

test("sw.js : cache v129 ou plus, page dans APP_SHELL (comme les pages comparables), nom du cache de partage inchangé", () => {
  const sw = read("sw.js"); assert.match(sw, /CACHE_NAME = "mahoutoplus-shell-v(129|1[3-9]\d)"/); assert.match(sw, /SHARE_CACHE_NAME = "mahoutoplus-share-v1"/);
  assert.strictEqual((sw.match(/"\/creer-ma-carte\.html"/g) || []).length, 1); assert.ok(sw.includes('"/regles-pages-publiques.html"') && sw.includes('"/m.html"'), "les pages comparables sont dans le pré-cache");
});

// ====================== les promesses, une par une (fichier qui les prouve) ======================
test("promesse 1 « page prête en quelques minutes » : le formulaire de profil.html n'a que des champs courts (adresse, nom, métier, ville, présentation, photo, un contact) et un bouton Publier", () => {
  const h = read("profil.html"); ["pp-adresse", "pp-nom", "pp-avatar", "pp-metier", "pp-presentation", "pp-localisation", "pp-contact-type", "pp-contact-valeur", "pp-majeur", "pp-btn-publier"].forEach((id) => assert.ok(h.includes('id="' + id + '"'), id));
  assert.match(h, /id="pp-btn-publier">Publier ma page<\/button>/);
});
test("promesse 2 « adresse personnalisée » : champ d'adresse et vérification de disponibilité (profil_public_adresse_disponible)", () => {
  assert.ok(read("profil.html").includes('id="pp-btn-verifier">Vérifier la disponibilité</button>')); assert.match(read("profil-public.js"), /rpc\("profil_public_adresse_disponible"/);
});
test("promesse 3 « QR code et carte à imprimer » : boutons PNG, SVG et carte (profil.html), module de la carte 1080 × 1350", () => {
  const h = read("profil.html"); ["pp-qr-png", "pp-qr-svg", "pp-qr-carte"].forEach((id) => assert.ok(h.includes('id="' + id + '"'), id)); assert.ok(h.includes("Télécharger ma carte (PNG)"));
  const c = read("profil-public-carte.js"); assert.match(c, /var W = 1080, H = 1350;/); assert.match(read("profil-public.js"), /downloadCarte/);
});
test("promesse 4 « partage facile sur WhatsApp » : feuille « Partager » (partage natif, copie du lien, QR) et bouton WhatsApp des visiteurs ; aperçu de partage avec le nom", () => {
  const m = read("m.js"), h = read("m.html"); assert.match(m, /navigator\.share\(payload\)/); assert.ok(m.includes("Copier le lien") || h.includes("Partager"), "copie et partage"); assert.match(m, /Copier le lien/);
  assert.match(read("profil-public-utils.js"), /Contacter sur WhatsApp/); assert.ok(fs.existsSync(path.join(root, "api/_profil-og.js")), "aperçu de partage avec nom, métier, photo");
});
test("promesse « Vos règles, votre contrôle » : dépublier (profil.html), accepter ou non les messages (case), bloquer (messagerie), signaler (page publique)", () => {
  const h = read("profil.html"); assert.ok(h.includes('id="pp-btn-depublier"')); assert.ok(h.includes("Autoriser les membres à m'écrire depuis ma page")); assert.ok(read("m.html").includes("Signaler cette page"));
  assert.match(read("messagerie-blocage.js"), /menuBloquer: "Bloquer ce membre"/); assert.ok(read("dm-chat.html").includes("Bloquer ce membre"));
});
test("étapes : compte Google ou e-mail + code (login-sheet.js), 18 ans (case de profil.html), publier puis partager", () => {
  const l = read("login-sheet.js"); assert.match(l, /Continuer avec Google/); assert.match(l, /Recevoir mon code/); assert.ok(read("profil.html").includes("Je certifie avoir 18 ans ou plus."));
});

// ====================== comportement du bouton (faux DOM) ======================
const SCRIPT = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("memberConnected"));
function run(o) {
  const opts = Object.assign({ storage: {}, storageThrows: false, login: true, config: true, cdn: "ok" }, o || {});
  const ctas = [0, 1].map(() => ({ listeners: {}, attrs: {}, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } }));
  const scripts = [], opened = [], ensured = [], loc = { href: "creer-ma-carte.html" };
  const keys = Object.keys(opts.storage);
  const localStorage = opts.storageThrows ? { get length() { throw new Error("bloqué"); }, key() { throw new Error("bloqué"); }, getItem() { throw new Error("bloqué"); } } : { length: keys.length, key: (i) => keys[i], getItem: (k) => opts.storage[k] };
  const win = { location: loc, MAHOUTO_CONFIG: opts.config ? { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" } : undefined };
  if (opts.login) win.MahoutoLogin = { open: (o2) => { opened.push(o2); return {}; } };
  win.MahoutoPseudo = { ensureProfileForUser: async (sb, u) => { ensured.push(u.id); } };
  const doc = { body: { appendChild: (n) => { scripts.push(n); } }, createElement: () => ({ setAttribute(k, v) { this[k] = v; } }), querySelectorAll: () => ctas };
  vm.runInNewContext(SCRIPT, { window: win, document: doc, localStorage, Array, JSON, Promise, Error, RegExp });
  const click = (i) => { const ev = { prevented: false, currentTarget: ctas[i || 0], preventDefault() { this.prevented = true; } }; const p = ctas[i || 0].listeners.click(ev); return { ev, p }; };
  const loadCdn = async () => { await tick(); const s = scripts[scripts.length - 1]; if (!s) return null; if (opts.cdn === "ok") { win.supabase = { createClient: (u, k) => ({ u, k }) }; s.onload(); } else s.onerror(); await tick(20); return s; };
  return { ctas, scripts, opened, ensured, loc, win, click, loadCdn };
}
const TOKEN = (u) => JSON.stringify({ access_token: "x", user: u });

test("bouton : membre déjà connecté → lien direct vers profil.html (aucun script chargé, aucune fenêtre de connexion)", async () => {
  const r = run({ storage: { "sb-abc-auth-token": TOKEN({ id: "u1", app_metadata: { provider: "google" } }) } }); const { ev, p } = r.click(0); await p;
  assert.strictEqual(ev.prevented, false, "le lien /profil.html suit son cours"); assert.strictEqual(r.scripts.length, 0); assert.strictEqual(r.opened.length, 0);
});
test("bouton : visiteur non connecté → bibliothèque chargée AU CLIC (même adresse que le site), puis fenêtre de connexion avec retour sur profil.html ; après le code, ouverture de profil.html", async () => {
  const r = run(); const { ev, p } = r.click(0); assert.strictEqual(ev.prevented, true, "le lien est intercepté");
  await r.loadCdn(); await p;
  assert.strictEqual(r.scripts.length, 1); assert.ok(r.scripts[0].src === CDN, "adresse de la bibliothèque : " + r.scripts[0].src);
  assert.strictEqual(r.opened.length, 1); const o = r.opened[0]; assert.strictEqual(o.redirectPath, "profil.html"); assert.strictEqual(o.title, "Se connecter pour créer votre carte"); assert.ok(o.supabase && o.supabase.u === "https://x.test");
  await o.onSignedIn({ id: "u9" }); assert.deepStrictEqual(r.ensured, ["u9"]); assert.strictEqual(r.loc.href, "profil.html");
});
test("bouton : compte anonyme, stockage bloqué ou jeton illisible = non connecté", async () => {
  for (const o of [{ storage: { "sb-abc-auth-token": TOKEN({ id: "u1", is_anonymous: true }) } }, { storage: { "sb-abc-auth-token": TOKEN({ id: "u1", app_metadata: { provider: "anonymous" } }) } }, { storageThrows: true }, { storage: { "sb-abc-auth-token": "pas du json" } }, { storage: { autre: TOKEN({ id: "u1" }) } }]) {
    const r = run(o); const { ev } = r.click(1); assert.strictEqual(ev.prevented, true, JSON.stringify(Object.keys(o))); await r.loadCdn(); assert.strictEqual(r.opened.length, 1);
  }
});
test("bouton : repli — bibliothèque indisponible (hors ligne) → ouverture de profil.html ; sans fenêtre de connexion ni configuration → lien normal ; double clic ignoré", async () => {
  let r = run({ cdn: "ko" }); let c = r.click(0); await r.loadCdn(); await c.p; assert.strictEqual(r.loc.href, "profil.html"); assert.strictEqual(r.opened.length, 0);
  r = run({ login: false }); c = r.click(0); assert.strictEqual(c.ev.prevented, false); assert.strictEqual(r.scripts.length, 0);
  r = run({ config: false }); c = r.click(0); assert.strictEqual(c.ev.prevented, false);
  r = run(); const first = r.click(0); const second = r.click(1); assert.strictEqual(second.ev.prevented, true); await r.loadCdn(); await first.p; assert.strictEqual(r.scripts.length, 1, "une seule bibliothèque chargée"); assert.strictEqual(r.opened.length, 1);
});

// ====================== contrastes AA dans les deux thèmes ======================
const hex = (s) => { let h = s.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const theme = read("theme.css"), decl = (t, n) => { const m = new RegExp(n + ":\\s*(#[0-9a-fA-F]{3,6})").exec(t); assert.ok(m, n); return m[1]; };
const dark = theme.match(/:root \{([^}]*)\}/)[1], light = theme.match(/body\.light-theme\{([^}]*)\}/)[1];
const TH = { sombre: { fond: decl(dark, "--bg"), carte: decl(dark, "--bg-card"), texte: decl(dark, "--white"), doux: decl(dark, "--text-muted"), accent: decl(dark, "--gold") }, clair: { fond: decl(light, "--bg"), carte: decl(light, "--bg-card"), texte: decl(light, "--white"), doux: decl(light, "--text-muted"), accent: decl(theme, "--gold-text") } };
test("contrastes AA (≥ 4,5) calculés dans les thèmes sombre et clair : textes, titres et liens dorés, bouton, étiquette « Exemple »", () => {
  assert.match(PAGE, /:root \{ --cm-accent: var\(--gold\)/); assert.match(PAGE, /body\.light-theme \{ --cm-accent: var\(--gold-text, #856500\)/);
  assert.ok(!/color: var\(--text-dim\)/.test(PAGE.match(/<style>([\s\S]*?)<\/style>/)[1]), "--text-dim interdit pour du texte");
  for (const [n, t] of Object.entries(TH)) [["titres blancs sur le fond", t.texte, t.fond], ["texte atténué sur le fond", t.doux, t.fond], ["texte atténué sur une carte", t.doux, t.carte], ["texte sur une carte", t.texte, t.carte], ["étiquette « Exemple » et titres dorés sur le fond", t.accent, t.fond], ["doré sur une carte", t.accent, t.carte]]
    .forEach(([l, a, b]) => { const r = ratio(a, b); assert.ok(r >= 4.5, n + " — " + l + " : " + r.toFixed(2)); });
  [["#0A0A0A", "#FFD700"], ["#0A0A0A", "#D4AF37"]].forEach(([a, b]) => assert.ok(ratio(a, b) >= 4.5, "bouton or " + b));
});
