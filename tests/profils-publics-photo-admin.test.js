/* Profil public, suite de la PR 1 : téléversement de la photo (profil-public.js, contrôles dans profil-public-utils.js), repli de l'image
   sur la page publique, page d'administration (admin/profils-publics.html + .js : interrupteur et liste). Aucun réseau : faux DOM,
   faux fetch, faux client Supabase. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PU = require("../profil-public-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

// ---------- faux DOM minimal ----------
function makeEl(id, startHidden) {
  const el = { id, value: "", checked: false, disabled: false, files: null, children: [], attrs: {}, listeners: {}, classes: new Set(startHidden ? ["hidden"] : []), style: {}, clicks: 0, _text: "",
    set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c), toggle: (c, on) => { if (on === undefined ? !el.classes.has(c) : on) el.classes.add(c); else el.classes.delete(c); } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); if (k === "src") this.src = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, click() { this.clicks++; if (this.listeners.click) return this.listeners.click(); }, select() {}, remove() {} };
  return el;
}
function makeDom(ids, hiddenIds) {
  const els = {};
  ids.forEach((i) => { els[i] = makeEl(i, (hiddenIds || []).includes(i)); });
  return { els, document: { getElementById: (i) => els[i] || null, createElement: (t) => Object.assign(makeEl(null), { tagName: t }), body: makeEl("body") } };
}
const idsOf = (file, prefix) => [...new Set([...read(file).matchAll(new RegExp('id="(' + (prefix || "") + '[\\w-]+)"', "g"))].map((m) => m[1]))];

// ---------- contrôles de fichier (logique pure) ----------
test("photo : seuls JPEG, PNG et WebP sont acceptés ; 5 Mo au maximum ; messages en français", () => {
  [["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["IMAGE/PNG", "png"]].forEach(([t, e]) => {
    const r = PU.validateAvatarFile({ type: t, size: 1000 }); assert.deepStrictEqual([r.ok, r.ext], [true, e], t);
  });
  ["image/gif", "image/heic", "image/svg+xml", "application/pdf", "text/html", "", null, undefined, "video/mp4"].forEach((t) => {
    const r = PU.validateAvatarFile({ type: t, size: 1000 }); assert.strictEqual(r.ok, false, String(t)); assert.match(r.error, /JPEG, PNG ou WebP/, String(t));
  });
  assert.strictEqual(PU.AVATAR_MAX_BYTES, 5 * 1024 * 1024);
  assert.strictEqual(PU.validateAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 }).ok, true, "5 Mo pile : accepté");
  const big = PU.validateAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }); assert.strictEqual(big.ok, false); assert.match(big.error, /5 Mo au maximum/);
  [0, -1, NaN, "x", null].forEach((n) => assert.strictEqual(PU.validateAvatarFile({ type: "image/png", size: n }).ok, false, String(n)));
  assert.strictEqual(PU.validateAvatarFile(null).ok, false); assert.strictEqual(PU.validateAvatarFile(undefined).ok, false);
});

test("nom envoyé à la signature : jamais le nom d'origine ; extension autorisée par /api/attachment ; URL Cloudinary https contrôlée (contrainte SQL : https, 500 caractères)", () => {
  assert.deepStrictEqual(["jpg", "png", "webp", "gif", undefined].map(PU.avatarFilename), ["photo-profil.jpg", "photo-profil.png", "photo-profil.webp", "photo-profil.jpg", "photo-profil.jpg"]);
  const att = read("api/attachment.js");
  assert.match(att, /\["jpg", "jpeg", "png", "webp", "gif"\]\.includes\(ext\)/, "le contexte avatar accepte jpg, png et webp");
  assert.match(att, /folder: "mahoutoplus\/avatars", accessType: "upload"/, "dossier public des avatars");
  const ok = "https://res.cloudinary.com/demo-cloud/image/upload/v1/mahoutoplus/avatars/abc123.jpg";
  assert.strictEqual(PU.cloudinaryImageUrl(ok), ok);
  ["http://res.cloudinary.com/x/a.jpg", "https://exemple.test/a.jpg", "https://res.cloudinary.com.pirate.test/a.jpg", "javascript:alert(1)", "https://user:mdp@res.cloudinary.com/a.jpg", "https://res.cloudinary.com/" + "a".repeat(500), null, ""].forEach((u) => assert.strictEqual(PU.cloudinaryImageUrl(u), null, String(u)));
  // contrainte SQL actuelle (bloc 5 de profils-publics.sql) : https, sans espace, 500 caractères au plus → l'URL type de Cloudinary passe
  const sql = read("profils-publics.sql");
  assert.match(sql, /avatar_url ~ '\^https:\/\/\[\^\[:space:\]\[:cntrl:\]\]\{4,\}\$' and char_length\(avatar_url\) <= 500/);
  assert.ok(/^https:\/\/[^\s\x00-\x1f]{4,}$/.test(ok) && ok.length <= 500);
  // CSP : images https autorisées, envoi vers api.cloudinary.com autorisé
  const csp = JSON.stringify(JSON.parse(read("vercel.json")).headers);
  assert.ok(/img-src 'self' data: blob: https:/.test(csp) && /connect-src[^;]*https:\/\/api\.cloudinary\.com/.test(csp));
});

// ---------- profil-public.js : téléversement ----------
async function runProfil(opts) {
  const o = opts || {};
  const ids = idsOf("profil.html", "pp-");
  const dom = makeDom(ids, ["pp-btn-depublier", "pp-liens", "pp-note-ferme", "pp-btn-photo-retirer", "pp-section"]);
  const calls = { fetch: [], from: [], rpc: [] };
  let pending = null;
  const fetchFn = async (url, init) => {
    calls.fetch.push({ url: String(url), init });
    if (String(url).startsWith("/api/attachment")) {
      if (o.signFail) return { ok: false, json: async () => ({ error: "Type de fichier non autorisé." }) };
      return { ok: true, json: async () => ({ apiKey: "cle-fictive", timestamp: 1700000000, signature: "sig-fictive", folder: "mahoutoplus/avatars", uploadUrl: "https://api.cloudinary.com/v1_1/demo-cloud/auto/upload" }) };
    }
    if (o.hold) await new Promise((r) => { pending = r; });
    if (o.uploadFail) return { ok: false, json: async () => ({ error: { message: "Fichier invalide" } }) };
    return { ok: true, json: async () => ({ secure_url: o.secureUrl || "https://res.cloudinary.com/demo-cloud/image/upload/v1/mahoutoplus/avatars/nouvelle.jpg" }) };
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jeton-fictif", user: { id: "u1", is_anonymous: false, app_metadata: { provider: "google" } } } } }) },
    from: (t) => { calls.from.push(t); return { update: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }; },
    rpc: async (n) => { calls.rpc.push(n); if (n === "profils_publics_ouvert") return { data: true, error: null }; if (n === "profil_public_mien") return { data: o.mine ? [o.mine] : [], error: null }; return { data: null, error: null }; }
  };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "cle-fictive" }, supabase: { createClient: () => client }, open() {} };
  vm.runInNewContext(read("profil-public.js"), { window: win, document: dom.document, fetch: fetchFn, FormData, URLSearchParams, Array, String, navigator: {}, confirm: () => true, setTimeout });
  await tick();
  return Object.assign(dom, { calls, release: () => pending && pending() });
}
const choose = async (d, file) => { d.els["pp-avatar-fichier"].files = [file]; d.els["pp-avatar-fichier"].listeners.change(); await tick(40); };

test("profil-public.js : 'Choisir une photo' ouvre le sélecteur d'images (JPEG, PNG, WebP) ; la photo du compte n'est jamais reprise", async () => {
  const h = read("profil.html");
  assert.match(h, /<input type="file" id="pp-avatar-fichier" class="hidden" accept="image\/jpeg,image\/png,image\/webp">/);
  assert.match(h, /<input type="text" id="pp-avatar" readonly/, "champ en lecture seule");
  const d = await runProfil({});
  d.els["pp-btn-photo"].click(); assert.strictEqual(d.els["pp-avatar-fichier"].clicks, 1);
  assert.ok(!/profiles/.test(code("profil-public.js")) && !/user_metadata|currentAvatarUrl/.test(code("profil-public.js")), "aucune reprise de la photo du compte");
  assert.strictEqual(d.els["pp-avatar"].value, "", "champ vide au départ : la photo reste un choix explicite");
});

test("profil-public.js : envoi réussi — signature par /api/attachment?context=avatar avec le jeton, envoi à Cloudinary, URL dans le champ, aperçu rond, rien enregistré avant « Enregistrer »", async () => {
  const d = await runProfil({});
  d.els["pp-nom"].value = "Atelier Test"; d.els["pp-metier"].value = "Couturier";
  await choose(d, { name: "IMG_20260101_NOM_PERSONNEL.JPG", type: "image/png", size: 2000 });
  const [sign, up] = d.calls.fetch;
  assert.strictEqual(sign.url, "/api/attachment?filename=photo-profil.png&context=avatar", "nom d'origine jamais envoyé");
  assert.strictEqual(JSON.stringify(sign.init.headers), JSON.stringify({ "Authorization": "Bearer jeton-fictif" }));
  assert.strictEqual(up.url, "https://api.cloudinary.com/v1_1/demo-cloud/auto/upload"); assert.strictEqual(up.init.method, "POST");
  const f = up.init.body; assert.ok(f instanceof FormData);
  assert.deepStrictEqual(["api_key", "timestamp", "signature", "folder"].map((k) => f.get(k)), ["cle-fictive", "1700000000", "sig-fictive", "mahoutoplus/avatars"]);
  assert.ok(f.get("file"));
  assert.strictEqual(d.els["pp-avatar"].value, "https://res.cloudinary.com/demo-cloud/image/upload/v1/mahoutoplus/avatars/nouvelle.jpg");
  const img = d.els["pp-avatar-apercu"].children[0];
  assert.deepStrictEqual([img.tagName, img.attrs.src, img.attrs.referrerpolicy, img.attrs.alt], ["img", d.els["pp-avatar"].value, "no-referrer", ""]);
  assert.ok(!d.els["pp-btn-photo-retirer"].classList.contains("hidden"), "« Retirer la photo » visible");
  assert.strictEqual(d.els["pp-btn-photo"].textContent, "Changer la photo");
  assert.match(d.els["pp-avatar-etat"].textContent, /enregistrez votre page/);
  assert.deepStrictEqual(d.calls.from, [], "aucun enregistrement automatique : la page passe ensuite par le flux existant");
  assert.strictEqual(d.els["pp-nom"].value, "Atelier Test"); assert.strictEqual(d.els["pp-metier"].value, "Couturier");
  assert.ok(Object.values(d.els).filter((e) => /^pp-btn-/.test(e.id)).every((e) => e.disabled === false), "boutons réactivés");
});

test("profil-public.js : contrôles AVANT l'envoi — mauvais type ou plus de 5 Mo : message clair, aucun appel réseau, formulaire intact", async () => {
  const d = await runProfil({}); d.els["pp-nom"].value = "Garde"; d.els["pp-avatar"].value = "https://res.cloudinary.com/demo-cloud/image/upload/ancienne.jpg";
  for (const [file, re] of [[{ name: "a.gif", type: "image/gif", size: 10 }, /JPEG, PNG ou WebP/], [{ name: "a.pdf", type: "application/pdf", size: 10 }, /JPEG, PNG ou WebP/], [{ name: "a.heic", type: "image/heic", size: 10 }, /JPEG, PNG ou WebP/], [{ name: "a.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }, /5 Mo au maximum/]]) {
    await choose(d, file);
    assert.match(d.els["pp-avatar-etat"].textContent, re); assert.strictEqual(d.calls.fetch.length, 0, "aucun appel réseau");
  }
  assert.strictEqual(d.els["pp-nom"].value, "Garde"); assert.strictEqual(d.els["pp-avatar"].value, "https://res.cloudinary.com/demo-cloud/image/upload/ancienne.jpg");
});

test("profil-public.js : échec de la signature, de l'envoi ou réponse inattendue → erreur claire, ancienne photo et reste du formulaire conservés, boutons réactivés", async () => {
  for (const [opts, re] of [[{ signFail: true }, /Type de fichier non autorisé/], [{ uploadFail: true }, /Fichier invalide/], [{ secureUrl: "http://exemple.test/a.jpg" }, /Réponse inattendue/], [{ secureUrl: "https://exemple.test/a.jpg" }, /Réponse inattendue/]]) {
    const d = await runProfil(opts); d.els["pp-nom"].value = "Garde"; d.els["pp-avatar"].value = "https://res.cloudinary.com/demo-cloud/image/upload/ancienne.jpg";
    await choose(d, { name: "a.jpg", type: "image/jpeg", size: 1000 });
    assert.match(d.els["pp-avatar-etat"].textContent, /L'envoi de la photo a échoué/); assert.match(d.els["pp-avatar-etat"].textContent, re);
    assert.strictEqual(d.els["pp-avatar"].value, "https://res.cloudinary.com/demo-cloud/image/upload/ancienne.jpg"); assert.strictEqual(d.els["pp-nom"].value, "Garde");
    assert.ok(Object.values(d.els).filter((e) => /^pp-btn-/.test(e.id)).every((e) => e.disabled === false));
  }
});

test("profil-public.js : pendant l'envoi les boutons sont désactivés et un second choix est ignoré (pas de double envoi)", async () => {
  const d = await runProfil({ hold: true });
  d.els["pp-avatar-fichier"].files = [{ name: "a.jpg", type: "image/jpeg", size: 1000 }]; d.els["pp-avatar-fichier"].listeners.change(); await tick(40);
  assert.match(d.els["pp-avatar-etat"].textContent, /Envoi de la photo/);
  ["pp-btn-photo", "pp-btn-photo-retirer", "pp-btn-enregistrer", "pp-btn-publier", "pp-btn-verifier"].forEach((i) => assert.strictEqual(d.els[i].disabled, true, i));
  const n = d.calls.fetch.length;
  d.els["pp-avatar-fichier"].files = [{ name: "b.jpg", type: "image/jpeg", size: 1000 }]; d.els["pp-avatar-fichier"].listeners.change(); await tick(40);
  d.els["pp-btn-photo"].click(); assert.strictEqual(d.els["pp-avatar-fichier"].clicks, 0, "le sélecteur ne s'ouvre pas pendant l'envoi");
  assert.strictEqual(d.calls.fetch.length, n, "aucun second envoi");
  d.release(); await tick(40);
  assert.ok(d.els["pp-btn-photo"].disabled === false && d.els["pp-avatar"].value.startsWith("https://res.cloudinary.com/"));
});

test("profil-public.js : « Retirer la photo » vide le champ et l'aperçu (lettre initiale) ; la photo existante de la page s'affiche au chargement", async () => {
  const d = await runProfil({ mine: { id: "p1", adresse: "mon-atelier", nom_affiche: "Atelier", avatar_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/a.jpg", publie: false, majeur_declare: false } });
  assert.strictEqual(d.els["pp-avatar"].value, "https://res.cloudinary.com/demo-cloud/image/upload/v1/a.jpg"); assert.strictEqual(d.els["pp-avatar-apercu"].children.length, 1);
  assert.ok(!d.els["pp-btn-photo-retirer"].classList.contains("hidden"));
  d.els["pp-btn-photo-retirer"].click();
  assert.strictEqual(d.els["pp-avatar"].value, ""); assert.strictEqual(d.els["pp-avatar-apercu"].children.length, 0); assert.strictEqual(d.els["pp-avatar-apercu"].textContent, "A");
  assert.ok(d.els["pp-btn-photo-retirer"].classList.contains("hidden")); assert.match(d.els["pp-avatar-etat"].textContent, /enregistrez votre page/);
  // le flux d'enregistrement existant reste la seule voie vers la base, avec les colonnes autorisées
  const js = code("profil-public.js");
  assert.match(js, /from\("profils_publics"\)\s*\.update\(value\)\.eq\("id", row\.id\)/);
  assert.strictEqual((js.match(/from\("profils_publics"\)/g) || []).length, 2, "update et insert seulement");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(js));
});

test("aperçu de la photo sur la page publique : rond, referrerpolicy no-referrer, loading lazy, alt vide, repli sur l'initiale si l'image ne charge pas", () => {
  const js = code("m.js"), h = read("m.html");
  assert.match(js, /img\.setAttribute\("alt", ""\)/); assert.match(js, /img\.setAttribute\("referrerpolicy", "no-referrer"\)/); assert.match(js, /img\.setAttribute\("loading", "lazy"\)/);
  assert.match(js, /img\.addEventListener\("error", function \(\) \{ box\.textContent = initial\(row\.nom_affiche\); \}\)/, "repli sur l'initiale");
  assert.match(h, /\.pub \.avatar \{[^}]*border-radius: 50%/);
  assert.ok(!/innerHTML/.test(js));
  // comportement : l'événement error remplace l'image par la lettre initiale
  const els = {}; ["bandeau", "chargement", "etat", "etat-titre", "profil", "avatar", "nom", "metier", "lieu", "presentation", "contact-zone"].forEach((i) => { els[i] = makeEl(i, true); });
  const row = { id: "p1", adresse: "mon-atelier", nom_affiche: "Zoé Test", avatar_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/a.jpg", metier: null, presentation: null, localisation: null, contact_type: null, contact_valeur: null };
  const client = { rpc: async (n) => ({ data: n === "profil_public_lire" ? [row] : null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } };
  vm.runInNewContext(read("m.js"), { window: { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, location: { pathname: "/m/mon-atelier", search: "" } }, document: { title: "", getElementById: (i) => els[i], createElement: (t) => Object.assign(makeEl(null), { tagName: t }) }, Array, String });
  return tick(30).then(() => {
    const img = els.avatar.children[0]; assert.ok(img && img.src === row.avatar_url);
    img.listeners.error(); assert.strictEqual(els.avatar.children.length, 0); assert.strictEqual(els.avatar.textContent, "Z");
  });
});

// ---------- page d'administration ----------
const ADMIN_ROW = (o) => Object.assign({ id: "p1", user_id: "00000000-0000-4000-8000-0000000000aa", adresse: "mon-atelier", nom_affiche: "Atelier <b>Test</b>", publie: true, majeur_declare: true, suspendu: false, publie_le: "2026-11-20T10:00:00Z", cree_le: "2026-11-19T10:00:00Z", modifie_le: "2026-11-20T10:00:00Z" }, o || {});
async function runAdmin(opts) {
  const o = Object.assign({ role: "admin", ouvert: "non", rows: [ADMIN_ROW()], session: true, confirmAnswer: true }, opts || {});
  const dom = makeDom(["loading-state", "access-denied", "dashboard", "etat-interrupteur", "btn-interrupteur", "msg-interrupteur", "btn-recharger", "msg-liste", "liste-pages", "msg-signalements", "liste-signalements"], ["access-denied", "dashboard"]);
  const log = { from: [], rpc: [], update: [], confirm: [], open: [], innerHTMLWrites: 0 };
  let valeur = o.ouvert;
  const client = {
    auth: { getSession: async () => ({ data: { session: o.session ? { user: { id: "u1" } } : null } }) },
    from: (t) => { log.from.push(t); const st = { f: {} };
      const api = { select: () => api, eq: (k, v) => { st.f[k] = v; return api; }, maybeSingle: async () => (t === "profiles" ? { data: { role: o.role }, error: null } : { data: o.readFail ? null : { valeur }, error: o.readFail ? { message: "x" } : null }),
        update: (p) => { st.upd = p; return api; }, then: (res, rej) => Promise.resolve((() => { if (!st.upd) return { data: [], error: null }; log.update.push([t, st.upd, st.f]); if (o.writeDenied) return { data: [], error: null }; valeur = st.upd.valeur; return { data: [{ valeur }], error: null }; })()).then(res, rej) };
      return api; },
    rpc: async (n, a) => { log.rpc.push([n, a]); if (n === "profils_publics_signalements_admin_lister") return { data: [], error: null }; if (n === "profils_publics_admin_lister") return o.listFail ? { data: null, error: { message: "x" } } : { data: o.rows, error: null };
      if (n === "profils_publics_admin_suspendre") { const r = o.rows.find((x) => x.id === a.p_id); if (r) r.suspendu = a.p_suspendu; return { data: !!r, error: null }; } return { data: null, error: { message: "inconnue" } }; }
  };
  const win = { ProfilPublicUtils: PU, MAHOUTO_CONFIG: { SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "k" }, supabase: { createClient: () => client }, open: (...a) => log.open.push(a) };
  vm.runInNewContext(read("admin/profils-publics.js"), { window: win, document: dom.document, confirm: (m) => { log.confirm.push(m); return o.confirmAnswer; }, Array, String });
  await tick(30);
  return Object.assign(dom, { log });
}
const allText = (e) => e.textContent;

test("admin/profils-publics.html : mêmes garde, structure et navigation que les autres pages admin ; lien depuis le menu admin existant ; noindex ; aucun innerHTML", () => {
  const h = read("admin/profils-publics.html");
  assert.match(h, /<meta name="robots" content="noindex">/);
  ["loading-state", "access-denied", "dashboard", "etat-interrupteur", "btn-interrupteur", "msg-interrupteur", "btn-recharger", "msg-liste", "liste-pages"].forEach((i) => assert.ok(h.includes('id="' + i + '"'), i));
  assert.match(h, /<a href="profils-publics\.html" class="active">Profils publics<\/a>/);
  ["formations", "users", "rooms", "statistiques", "signalements", "institut"].forEach((p) => assert.ok(h.includes('<a href="' + p + '.html"'), p));
  ["formations", "users", "rooms", "statistiques", "signalements", "produits", "institut"].forEach((p) => assert.ok(read("admin/" + p + ".html").includes('<a href="profils-publics.html">Profils publics</a>'), "lien depuis admin/" + p));
  const srcs = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.indexOf("../profil-public-utils.js") !== -1 && srcs.indexOf("../profil-public-utils.js") < srcs.indexOf("profils-publics.js"));
  assert.ok(!/<script>/.test(h));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(code("admin/profils-publics.js")), "aucun innerHTML avec des données dynamiques");
  assert.ok(!/console\./.test(code("admin/profils-publics.js")));
  assert.ok(!/user_id|\.email|e-mail/.test(code("admin/profils-publics.js")), "jamais d'identifiant de compte ni d'e-mail dans l'affichage");
  assert.ok(!read("sw.js").match(/APP_SHELL = \[[\s\S]*?\]/)[0].includes("admin/profils-publics"), "pages admin hors du cache (convention)");
});

test("admin : accès refusé sans session ou sans rôle administrateur (aucune lecture de l'interrupteur ni de la liste)", async () => {
  for (const o of [{ session: false }, { role: "user" }]) {
    const d = await runAdmin(o);
    assert.ok(!d.els["access-denied"].classList.contains("hidden") && d.els.dashboard.classList.contains("hidden"));
    assert.ok(!d.log.from.includes("profils_publics_reglages") && d.log.rpc.length === 0);
  }
});

test("admin : état de l'interrupteur affiché et bouton « Ouvrir au public » / « Fermer au public »", async () => {
  let d = await runAdmin({ ouvert: "non" });
  assert.match(d.els["etat-interrupteur"].textContent, /FERMÉE/); assert.strictEqual(d.els["btn-interrupteur"].textContent, "Ouvrir au public");
  d = await runAdmin({ ouvert: "oui" });
  assert.match(d.els["etat-interrupteur"].textContent, /OUVERTE/); assert.strictEqual(d.els["btn-interrupteur"].textContent, "Fermer au public");
  d = await runAdmin({ readFail: true });
  assert.match(d.els["etat-interrupteur"].textContent, /inconnu/); assert.strictEqual(d.els["btn-interrupteur"].disabled, true);
});

test("admin : OUVRIR demande la confirmation exacte (refus = rien n'est écrit) ; FERMER = un clic, sans confirmation", async () => {
  let d = await runAdmin({ ouvert: "non", confirmAnswer: false });
  d.els["btn-interrupteur"].click(); await tick(30);
  assert.deepStrictEqual(d.log.confirm, ["Cette action rend publiques toutes les pages publiées. Vérifiez que vous avez testé le signalement. Continuer ?"]);
  assert.strictEqual(d.log.update.length, 0, "confirmation refusée : aucune écriture"); assert.match(d.els["etat-interrupteur"].textContent, /FERMÉE/);
  d = await runAdmin({ ouvert: "non", confirmAnswer: true });
  d.els["btn-interrupteur"].click(); await tick(30);
  assert.strictEqual(d.log.confirm.length, 1);
  assert.strictEqual(JSON.stringify(d.log.update), JSON.stringify([["profils_publics_reglages", { valeur: "oui" }, { cle: "ouvert" }]]));
  assert.match(d.els["etat-interrupteur"].textContent, /OUVERTE/); assert.strictEqual(d.els["btn-interrupteur"].textContent, "Fermer au public");
  d.els["btn-interrupteur"].click(); await tick(30);
  assert.strictEqual(d.log.confirm.length, 1, "fermer : aucune confirmation");
  assert.strictEqual(JSON.stringify(d.log.update[1]), JSON.stringify(["profils_publics_reglages", { valeur: "non" }, { cle: "ouvert" }]));
  assert.match(d.els["etat-interrupteur"].textContent, /FERMÉE/);
  const js = read("admin/profils-publics.js");
  assert.ok(js.indexOf("confirm(CONFIRM_OUVRIR)") !== -1 && js.indexOf('target === "oui" && !confirm(CONFIRM_OUVRIR)') !== -1, "la confirmation précède l'écriture, seulement pour l'ouverture");
});

test("admin : écriture refusée par la base (pas administrateur) → message d'erreur, état inchangé", async () => {
  const d = await runAdmin({ ouvert: "non", writeDenied: true });
  d.els["btn-interrupteur"].click(); await tick(30);
  assert.match(d.els["msg-interrupteur"].textContent, /refusée ou impossible/); assert.match(d.els["etat-interrupteur"].textContent, /FERMÉE/);
});

test("admin : liste des pages — adresse, nom (texte brut), publiée / suspendue oui-non, date de publication ; jamais user_id ni e-mail", async () => {
  const d = await runAdmin({ rows: [ADMIN_ROW(), ADMIN_ROW({ id: "p2", adresse: "autre-page", nom_affiche: "Brouillon", publie: false, publie_le: null }), ADMIN_ROW({ id: "p3", adresse: "page-suspendue", suspendu: true })] });
  const cards = d.els["liste-pages"].children; assert.strictEqual(cards.length, 3);
  const t = (c) => c.textContent;
  assert.match(t(cards[0]), /Atelier <b>Test<\/b>/); assert.match(t(cards[0]), /\/m\/mon-atelier/); assert.match(t(cards[0]), /Publiée : oui · Suspendue : non · Date de publication : \d{2}\/\d{2}\/2026/);
  assert.match(t(cards[1]), /Publiée : non · Suspendue : non · Date de publication : —/);
  assert.match(t(cards[2]), /Suspendue : oui/);
  const all = allText(d.els["liste-pages"]);
  assert.ok(!all.includes("00000000-0000-4000-8000-0000000000aa") && !/user_id|@/.test(all), "ni identifiant de compte ni e-mail");
  assert.strictEqual(JSON.stringify(d.log.rpc.filter((r) => r[0] === "profils_publics_admin_lister")), JSON.stringify([["profils_publics_admin_lister", undefined]]));
  const bad = await runAdmin({ listFail: true }); assert.match(bad.els["msg-liste"].textContent, /Impossible de charger la liste/);
  const vide = await runAdmin({ rows: [] }); assert.match(vide.els["liste-pages"].textContent, /Aucune page/);
});

test("admin : « Voir » ouvre /m/<adresse> dans un nouvel onglet (aperçu administrateur, même fonction fermée) ; adresse invalide : pas de bouton", async () => {
  const d = await runAdmin({ ouvert: "non", rows: [ADMIN_ROW(), ADMIN_ROW({ id: "p9", adresse: "<script>", nom_affiche: "X" })] });
  const btn = (card, label) => card.children[card.children.length - 1].children.find((b) => b.textContent === label);
  btn(d.els["liste-pages"].children[0], "Voir").click();
  assert.strictEqual(JSON.stringify(d.log.open), JSON.stringify([["/m/mon-atelier", "_blank", "noopener"]]));
  assert.strictEqual(btn(d.els["liste-pages"].children[1], "Voir"), undefined, "adresse invalide : pas de lien");
  assert.match(code("m.js"), /profils_publics_admin_lire/, "l'aperçu administrateur de m.js fonctionne interrupteur fermé");
});

test("admin : Suspendre / Réactiver avec confirmation, par la fonction profils_publics_admin_suspendre, puis liste rechargée", async () => {
  const d = await runAdmin({ rows: [ADMIN_ROW()], confirmAnswer: false });
  const find = (label) => d.els["liste-pages"].children[0].children[d.els["liste-pages"].children[0].children.length - 1].children.find((b) => b.textContent === label);
  find("Suspendre").click(); await tick(30);
  assert.match(d.log.confirm[0], /Suspendre la page \/m\/mon-atelier/); assert.strictEqual(d.log.rpc.filter((r) => r[0] === "profils_publics_admin_suspendre").length, 0, "refus : rien n'est envoyé");
  const d2 = await runAdmin({ rows: [ADMIN_ROW()], confirmAnswer: true });
  const find2 = (label) => { const c = d2.els["liste-pages"].children[0]; return c.children[c.children.length - 1].children.find((b) => b.textContent === label); };
  find2("Suspendre").click(); await tick(40);
  assert.strictEqual(JSON.stringify(d2.log.rpc.filter((r) => r[0] === "profils_publics_admin_suspendre")), JSON.stringify([["profils_publics_admin_suspendre", { p_id: "p1", p_suspendu: true }]]));
  assert.strictEqual(d2.log.rpc.filter((r) => r[0] === "profils_publics_admin_lister").length, 2, "liste rechargée");
  assert.match(d2.els["liste-pages"].children[0].textContent, /Suspendue : oui/); assert.match(d2.els["msg-liste"].textContent, /Page suspendue/);
  find2("Réactiver").click(); await tick(40);
  assert.match(d2.log.confirm[1], /Réactiver la page/); assert.match(d2.els["liste-pages"].children[0].textContent, /Suspendue : non/);
});

test("sw.js : la version du cache a changé (v117 ou plus) ; les fichiers modifiés de l'application y figurent", () => {
  const sw = read("sw.js");
  assert.ok(Number(/mahoutoplus-shell-v(\d+)/.exec(sw)[1]) >= 117);
  ["/profil.html", "/profil-public.js", "/profil-public-utils.js", "/m.html", "/m.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
});

test("aucun SQL nécessaire : la contrainte et les politiques existantes suffisent ; aucune nouvelle fonction api/", () => {
  const sql = read("profils-publics.sql");
  assert.match(sql, /create policy "profils_publics_reglages_admin_update" on public\.profils_publics_reglages\s+for update to authenticated using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  assert.match(sql, /grant select on public\.profils_publics_reglages to anon, authenticated;\s+grant insert, update on public\.profils_publics_reglages to authenticated;/);
  assert.ok(!fs.existsSync(path.join(root, "profils-publics-photo-admin.sql")));
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.strictEqual(list("api").length + list("api/admin").length, 12);
});
