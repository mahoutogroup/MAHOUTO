/* profil.html : aucune boîte positionnée (absolute) ne doit avoir pour bloc conteneur la page entière.
   Cause d'un grand espace vide défilant sous le contenu (appli installée, Android) : la case cachée de l'interrupteur
   « Qui a vu ma carte » était en position: absolute dans un libellé NON positionné ; .page-content est le conteneur défilant
   (overflow-y: auto) mais n'est pas positionné, donc il ne la contenait pas : sa position (en bas du contenu défilé) agrandissait
   la zone défilable de TOUT le document. Test statique : chaque règle position: absolute de profil.html doit être contenue
   par un ancêtre dont la règle déclare position: relative. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "profil.html"), "utf8");
const STYLE = HTML.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
const decl = (body, prop) => { const m = new RegExp("(?:^|[;\\s])" + prop + "\\s*:\\s*([^;]+)", "i").exec(body); return m ? m[1].trim() : null; };
const find = (sel) => rules.filter((r) => r.sel === sel);

// règle absolue -> règle de l'ancêtre qui la contient (doit déclarer position: relative)
const CONTENEURS = {
  ".avatar-edit-badge": ".avatar-wrap",
  ".pv .pv-regles li::before": ".pv .pv-regles li",
  ".inv .inv-regles li::before": ".inv .inv-regles li",
  ".pv .pv-interrupteur input": ".pv .pv-interrupteur",
  ".pv .pv-piste::after": ".pv .pv-piste",
};

test("chaque règle position: absolute de profil.html est répertoriée et contenue par un ancêtre en position: relative", () => {
  const absolues = rules.filter((r) => /^absolute|^fixed/.test(decl(r.body, "position") || "")).map((r) => r.sel);
  const hors = absolues.filter((s) => !(s in CONTENEURS) && !["#edit-modal"].includes(s) && !/^#edit-modal/.test(s));
  assert.deepStrictEqual(hors, [], "règle positionnée sans conteneur déclaré : ajoutez-lui un ancêtre en position: relative, puis répertoriez-le ici");
  Object.entries(CONTENEURS).forEach(([abs, cont]) => {
    assert.ok(find(abs).length >= 1 && /^absolute/.test(decl(find(abs)[0].body, "position")), abs + " : règle absolue attendue");
    const c = find(cont);
    assert.ok(c.length >= 1, cont + " : règle du conteneur introuvable");
    assert.ok(c.some((r) => /^relative|^absolute|^fixed|^sticky/.test(decl(r.body, "position") || "")), cont + " doit déclarer position: relative (sinon " + abs + " s'échappe de .page-content et agrandit le document)");
  });
});

test("la case cachée de l'interrupteur « Qui a vu ma carte » est contenue dans son libellé (cause de l'espace vide)", () => {
  const lib = find(".pv .pv-interrupteur")[0];
  assert.match(decl(lib.body, "position"), /^relative$/);
  assert.match(decl(find(".pv .pv-interrupteur input")[0].body, "position"), /^absolute$/);
  assert.ok(!/position:\s*(fixed|absolute)/.test(HTML.slice(HTML.indexOf('<div class="page-content">'), HTML.indexOf("</style>", HTML.indexOf('<div class="page-content">')) === -1 ? HTML.length : undefined).replace(/<style>[\s\S]*?<\/style>/g, "")), "aucun style en ligne positionné dans le contenu");
});

test("aucune hauteur liée à la fenêtre (vh, dvh, svh) dans la zone de contenu de profil.html", () => {
  assert.ok(!/\d\s*(d|s|l)?vh\b/.test(STYLE.replace(/#edit-modal[^{]*\{[^}]*\}/g, "")), "aucune hauteur en vh/dvh");
});
