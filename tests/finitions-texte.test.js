/* Finitions de texte : vouvoiement de la fenêtre de connexion (login-sheet.js) et précision « page publiée requise » dans la
   section « Qui a vu ma carte » de profil.html. Lecture statique des fichiers, aucun réseau. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Login = require("../login-sheet");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ---------- détecteur de tutoiement (sans faux positifs : « tutoriel », « tuile », « situation », « entre eux »…) ----------
const L = "\\p{L}";
const FORMES = [
  `ton`, `ta`, `tes`, `toi`, `tu`, `t'[${L}]+`, `[${L}]+-toi`, `[${L}]+-tu`, `connecte`, `connecte-[${L}]+`, `saisis`, `clique`, `cliques`, `vérifie`, `verifie`, `réessaie`, `reessaie`,
  `attends`, `contacte`, `contacte-[${L}]+`, `demande-en`, `choisis`, `appuie`, `essaie`, `patiente`, `reviens`, `retourne`, `regarde`, `ouvre-[${L}]+`,
];
const TUTOIEMENT = new RegExp(`(?<![${L}])(${FORMES.join("|")})(?![${L}])`, "iu");
const IMPERATIF_ENTRE = /(^|[.!?:]\s*)Entre\s+(une?|le|la|les|l'|des|du|ton|ta|tes|ce|cet|cette|ces)(?![\p{L}])/u;   // « Entre une adresse… » (impératif) ; « entre eux », « entre 2 et 5 » restent permis
const tutoie = (s) => TUTOIEMENT.test(s) || IMPERATIF_ENTRE.test(s);

// textes visibles de login-sheet.js : toutes les chaînes entre guillemets (hors commentaires)
const JS = read("login-sheet.js");
const noComments = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
const strings = [...noComments.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\p{L}{3}/u.test(s));

test("détecteur : repère le tutoiement, ignore les mots qui lui ressemblent", () => {
  ["Connecte-toi avec Google", "ton adresse e-mail", "Si tu n'as pas encore de compte", "nous t'envoyons un code", "Entre le code reçu", "Saisis le code", "Clique ici", "Vérifie le code", "Réessaie", "Attends quelques minutes", "Contacte-nous", "toi@exemple.com", "Demande-en un nouveau", "Choisis un forfait"]
    .forEach((s) => assert.ok(tutoie(s), "doit être repéré : " + s));
  ["Connectez-vous avec Google", "votre adresse e-mail", "Saisissez le code", "Vérifiez le code", "Réessayez", "Attendez quelques minutes", "Contactez-nous", "vous@exemple.com", "Demandez-en un nouveau", "tutoriel", "une tuile", "situation", "Entre eux, rien", "entre 2 et 5", "Se connecter pour créer votre carte", "Vérifier", "Continuer avec Google", "Changer d'adresse", "attention", "tâche", "stations"]
    .forEach((s) => assert.ok(!tutoie(s), "faux positif : " + s));
});

test("login-sheet.js : AUCUNE forme de tutoiement dans les textes visibles (titres, boutons, aide, erreurs, aria-label, placeholder)", () => {
  assert.ok(strings.length > 40, "chaînes lues : " + strings.length);
  const fautes = strings.filter(tutoie);
  assert.deepStrictEqual(fautes, [], "textes tutoyés restants");
  // les textes réellement produits (messages d'erreur, tous contextes) sont vouvoyés aussi
  const err = [[{ message: "Failed to fetch" }, "send"], [{ status: 429 }, "send"], [{ status: 429 }, "verify"], [{ code: "user_banned" }, "send"], [{ code: "otp_expired" }, "verify"], [{ status: 400 }, "verify"], [{ code: "x", status: 500 }, "send"], [{ code: "provider_disabled" }, "google"]];
  err.forEach(([e, c]) => { const m = Login.authErrorMessage(e, c); assert.ok(!tutoie(m), c + " : " + m); });
  ["error=access_denied", "error=server_error&error_description=x"].forEach((q) => { const m = Login.oauthErrorFromUrl({ search: "?" + q, hash: "" }); assert.ok(m && !tutoie(m), m); });
});

test("login-sheet.js : les textes vouvoyés attendus sont bien là (même sens, langage simple)", () => {
  const attendu = ["Connectez-vous avec Google, ou avec votre adresse e-mail : nous vous envoyons un code à ", "Si vous n'avez pas encore de compte, il sera créé automatiquement.", "Saisissez une adresse e-mail valide.", "Saisissez le code à ",
    "Vérifiez votre réseau puis réessayez.", "Attendez quelques minutes avant de réessayer.", "Attendez quelques minutes avant de redemander un code.", "Contactez-nous pour en savoir plus.", "Vérifiez le code ou demandez-en un nouveau.", "Réessayez ; si cela continue, contactez-nous.", "vous@exemple.com"];
  attendu.forEach((s) => assert.ok(JS.includes(s), "absent : " + s));
});

test("login-sheet.js : seuls les TEXTES ont changé — identifiants, classes, clés, noms de fonctions et logique inchangés", () => {
  assert.deepStrictEqual(Object.keys(Login).sort(), ["CODE_LENGTH", "RESEND_DELAY", "RETURN_KEY", "RETURN_TTL_MS", "authErrorMessage", "consumeReturn", "open", "oauthErrorFromUrl", "rememberReturn", "validateReturn"].sort());
  assert.strictEqual(Login.RETURN_KEY, "mahouto:return-to"); assert.strictEqual(Login.CODE_LENGTH, 6); assert.strictEqual(Login.RESEND_DELAY, 30);
  ["ls-overlay", "ls-sheet", "ls-text", "ls-google", "ls-or", "ls-input", "ls-code", "ls-error", "ls-actions", "ls-primary", "ls-link", "ls-hidden", "ls-style"].forEach((c) => assert.ok(JS.includes(c), "identifiant disparu : " + c));
  ["signInWithOtp", "verifyOtp", "signInWithOAuth", 'provider: "google"', 'type: "email"', 'role: "alert"', 'role: "dialog"', '"aria-modal": "true"', 'autocomplete: "one-time-code"', 'autocomplete: "email"', 'inputmode: "numeric"', "onSignedIn", "redirectPath", "options.title || \"Se connecter pour écrire\""]
    .forEach((s) => assert.ok(JS.includes(s), "logique ou attribut modifié : " + s));
  // classes et libellés d'accessibilité posés sur les éléments (pas seulement présents dans la feuille de style)
  [['class: "ls-google"', 1], ['class: "ls-error"', 3], ['class: "ls-input"', 1], ['class: "ls-input ls-code"', 1], ['class: "ls-actions"', 2], ['class: "ls-primary"', 2], ['class: "ls-link"', 1], ['class: "ls-text"', 2], ['class: "ls-or"', 1], ['class: "ls-sheet"', 1], ['class: "ls-overlay"', 1], ['class: "ls-hidden"', 1],
    ['"aria-label": "Adresse e-mail"', 1], ['"aria-label": "Code à " + CODE_LENGTH + " chiffres"', 1], ['"aria-label": "Se connecter"', 1]]
    .forEach(([s, n]) => assert.strictEqual(JS.split(s).length - 1, n, s + " : " + n + " occurrence(s) attendue(s)"));
  assert.ok(!/innerHTML/.test(noComments), "toujours aucun innerHTML");
  ["Continuer avec Google", "Recevoir mon code", "Renvoyer le code", "Changer d'adresse", "Annuler", "Vérifier"].forEach((s) => assert.ok(JS.includes('"' + s + '"'), "libellé neutre conservé : " + s));
});

test("pages qui passent un titre personnalisé : tous sont à l'infinitif ou au vouvoiement (rien à changer)", () => {
  [["creer-ma-carte.html", "Se connecter pour créer votre carte"], ["m.js", "Se connecter pour signaler une page"], ["institut-demande.js", "Se connecter pour demander un parrainage"], ["institut-place.js", "Se connecter avec le compte de l'élève"], ["discussions.html", "Se connecter"]]
    .forEach(([f, t]) => { assert.ok(read(f).includes('"' + t + '"'), f + " : " + t); assert.ok(!tutoie(t), t); });
  assert.ok(read("m.js").includes("Se connecter pour écrire à cette personne") && !tutoie("Se connecter pour écrire à cette personne"));
});

// ---------- profil.html ----------
const HTML = read("profil.html");
const sec = HTML.slice(HTML.indexOf('<section class="pp pv hidden" id="pv-section"'), HTML.indexOf("</section>", HTML.indexOf('id="pv-section"')));
test("profil.html : « Qui a vu ma carte » dit qu'il faut une page publiée pour recevoir des visites (une phrase, style existant, vouvoiement)", () => {
  assert.ok(sec.length > 500);
  const phrase = "Pour recevoir des visites dans cette liste, votre page publique doit être publiée.";
  assert.strictEqual((sec.match(/<p class="hint" id="pv-page-requise">([^<]*)<\/p>/g) || []).length, 1);
  assert.ok(sec.includes('<p class="hint" id="pv-page-requise">' + phrase + "</p>"));
  assert.strictEqual((HTML.match(/page publique doit être publiée/g) || []).length, 1, "une seule fois dans la page");
  assert.ok(sec.indexOf('id="pv-page-requise"') > sec.indexOf('id="pv-regles"') && sec.indexOf('id="pv-page-requise"') < sec.indexOf('id="pv-switch"'), "entre les règles et l'interrupteur : toujours visible, quel que soit l'état");
  assert.ok(!tutoie(phrase));
  assert.strictEqual((sec.match(/<li>/g) || []).length, 3, "les 3 lignes d'explication sont inchangées");
  // aucune nouvelle classe CSS : seule « hint » (déjà définie par .pp) est utilisée
  assert.ok(!/\.pv #pv-page-requise|pv-page-requise \{/.test(HTML), "aucun style ajouté pour cette phrase");
});

test("sw.js : cache v132 (main était à v131) ; aucun SQL, aucun fichier dans api/", () => {
  assert.match(read("sw.js"), /const CACHE_NAME = "mahoutoplus-shell-v(132|13[3-9]|1[4-9]\d)";/);
  const list = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("_")); assert.strictEqual(list("api").length + list("api/admin").length, 12);
});
