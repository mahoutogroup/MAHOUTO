/* Règlement de l'Institut (PR 6) : formulaire (champ situation, case de majorité), admin (situation visible, tri deux parents
   d'abord), textes. Aucun réseau. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const U = require("../institut-utils");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("sortDemandes : « deux_parents » d'abord, ordre d'origine conservé dans chaque groupe, liste d'origine intacte", () => {
  const l = [{ id: 1, situation: "pere" }, { id: 2, situation: "deux_parents" }, { id: 3, situation: "mere" }, { id: 4, situation: "deux_parents" }, { id: 5, situation: "pere" }];
  const copy = JSON.stringify(l);
  assert.deepStrictEqual(U.sortDemandes(l, "deux_parents").map((d) => d.id), [2, 4, 1, 3, 5]);
  assert.deepStrictEqual(U.sortDemandes(l, "").map((d) => d.id), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(U.sortDemandes(l, undefined).map((d) => d.id), [1, 2, 3, 4, 5]);
  assert.strictEqual(JSON.stringify(l), copy, "la liste reçue n'est pas modifiée");
  assert.deepStrictEqual(U.sortDemandes(null, "deux_parents"), []);
  assert.deepStrictEqual(U.sortDemandes([{ id: 1 }, null, { id: 2, situation: "deux_parents" }], "deux_parents").map((d) => d && d.id), [2, 1, null]);
});

test("institut-demande.html : champ situation, case « Je certifie être majeur » masquée par défaut, textes du règlement", () => {
  const h = read("institut-demande.html");
  assert.match(h, /<select id="f-situation"><\/select>/);
  assert.match(h, /id="champ-majeur"/); assert.match(h.slice(h.indexOf('id="champ-majeur"') - 30, h.indexOf('id="champ-majeur"')), /class="field hidden"/);
  assert.match(h, /<input type="checkbox" id="f-parrainMajeur">/);
  assert.ok(h.includes("Je certifie être majeur (18 ans ou plus)."));
  assert.ok(h.includes("De 14 à 25 ans.") && h.includes("l'Institut accueille les orphelins de 14 à 25 ans") && h.includes("servis en priorité"));
  assert.ok(!/3 à 35|35 ans/.test(h));
  ["e-situation", "e-parrainMajeur"].forEach((id) => assert.ok(h.includes('id="' + id + '"'), id));
});

test("institut-demande.js : case visible seulement sous 18 ans, envoyée au validateur, valeurs enregistrées ; aucun innerHTML", () => {
  const js = code("institut-demande.js");
  assert.match(js, /fillSelect\(\$\("f-situation"\), U\.SITUATIONS, "Choisir…"\)/);
  assert.match(js, /\$\("f-age"\)\.addEventListener\("input", syncMajeur\)/);
  assert.match(js, /parseInt\(t, 10\) < U\.AGE_MAJEUR/);
  assert.match(js, /\$\("champ-majeur"\)\.classList\.toggle\("hidden", !minor\)/);
  assert.match(js, /situation: \$\("f-situation"\)\.value, parrainMajeur: \$\("f-parrainMajeur"\)\.checked/);
  assert.match(js, /Object\.assign\(\{ id: id, parrain_id: user\.id, justificatif_path: path, statut: "en_attente" \}, check\.value\)/, "situation et parrain_majeur partent avec la ligne");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(js));
  // le comportement réel de syncMajeur (vm, faux DOM minimal)
  const body = /function syncMajeur\(\) \{[\s\S]*?\n  \}/.exec(js)[0];
  const els = { "f-age": { value: "" }, "f-parrainMajeur": { checked: true }, "champ-majeur": { hidden: true, classList: { toggle(c, on) { els["champ-majeur"].hidden = !!on; } } } };
  const sb = { $: (id) => els[id], U }; vm.runInNewContext(body + "; this.run = syncMajeur;", sb);
  [["17", false, true], ["14", false, true], ["18", true, false], ["25", true, false], ["", true, false], ["abc", true, false], ["9", false, true]].forEach(([age, hidden, checkedKept]) => {
    els["f-age"].value = age; els["f-parrainMajeur"].checked = true; sb.run();
    assert.strictEqual(els["champ-majeur"].hidden, hidden, "âge " + age + " : case masquée = " + hidden);
    assert.strictEqual(els["f-parrainMajeur"].checked, checkedKept, "âge " + age + " : coche conservée = " + checkedKept);
  });
});

test("admin : situation affichée sur chaque carte, badge de priorité deux parents, sélecteur de tri, colonnes lues, aucun nom ni téléphone", () => {
  const h = read("admin/institut.html"), c = code("admin/institut.html");
  assert.match(h, /<select id="tri-demandes" aria-label="Ordre des demandes">/);
  assert.ok(h.includes("Orphelins des deux parents d'abord") && h.includes('<option value="deux_parents">'));
  assert.match(c, /U\.sortDemandes\(U\.filterByStatut\(demandes, \$\("filtre-statut"\)\.value\), \$\("tri-demandes"\)\.value\)/);
  assert.match(c, /"Situation : " \+ U\.situationLabel\(d\.situation\)/);
  assert.match(c, /d\.situation === "deux_parents" \? el\("span", \{ class: "badge prio", text: "Priorité : deux parents" \}\) : null/);
  assert.match(c, /\$\("tri-demandes"\)\.addEventListener\("change", renderDemandes\)/);
  assert.match(c, /\.select\("id, parrain_id, prenom, age, situation, parrain_majeur, lien,/);
  assert.ok(!/nom_famille|telephone|phone|\.email/.test(c.slice(c.indexOf("function renderDemandes"), c.indexOf("function placeInfo"))), "aucun nom de famille, téléphone ni e-mail");
  assert.ok(!/innerHTML/.test(c));
});

test("textes : plus d'ancienne fourchette d'âge ni de « dont les petits-fils » ; petits-fils orphelins ou non ; textes en base non touchés", () => {
  ["institut.html", "institut-demande.html", "institut-place.html", "institut-page.js", "institut-demande.js", "institut-utils.js", "institut-demande-utils.js"].forEach((f) => {
    const t = read(f);
    assert.ok(!/de 3 à 35|3 à 35 ans|entre 3 et 35|dont les petits-fils/.test(t), f);
    assert.ok(!/Saint-Louis/i.test(t), f);
  });
  assert.ok(read("institut.html").includes("orphelins ou non, bénéficient du tarif Institut"));
  assert.ok(!/institut_contenus|insert into/i.test(read("institut-regles.sql")), "aucun texte éditable écrasé");
});

test("sw.js : cache v114 ; fichiers publics inchangés (aucun nouveau fichier)", () => {
  assert.match(read("sw.js"), /CACHE_NAME = "mahoutoplus-shell-v(11[4-9]|1[2-9]\d)"/);
});
