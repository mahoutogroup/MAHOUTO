/* Garde-fous statiques de institut-regles.sql, de son retour arrière et de son SQL de vérification (PR 6 : règlement de l'Institut).
   Lecture de fichiers UNIQUEMENT : aucun SQL n'est exécuté. Le comportement réel est éprouvé sur un PostgreSQL local jetable. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const FILES = ["institut-regles.sql", "institut-regles-rollback.sql", "institut-regles-verification.sql"];
const strip = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = read(FILES[0]), sql = strip(raw);
const rbRaw = read(FILES[1]), rb = strip(rbRaw);
const vRaw = read(FILES[2]), v = strip(vRaw);

function blocks(text) {
  const parts = text.split(/^-- BLOC (\d+) - /m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), body: parts[i + 1] });
  return out;
}

test("blocs numérotés 1 à 8, courts, listés dans la note de tête ; rollback 1 à 3", () => {
  const b = blocks(raw);
  assert.deepStrictEqual(b.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  b.forEach((x) => assert.ok(x.body.split("\n").length <= 70, "bloc " + x.n + " trop long"));
  const head = raw.slice(0, raw.indexOf("-- BLOC 1 - "));
  for (let n = 1; n <= 8; n++) assert.ok(new RegExp("--   BLOC " + n + " -").test(head), "note de tête : bloc " + n);
  assert.deepStrictEqual(blocks(rbRaw).map((x) => x.n), [1, 2, 3]);
});

test("collage mobile : $$ jamais $function$, aucun %rowtype / %type, aucune apostrophe dans les commentaires, commentaires avant les instructions", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/\$function\$/.test(t), f + " : $function$");
    assert.ok(!/%rowtype|%type/i.test(t), f + " : %rowtype / %type");
    t.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("--")) assert.ok(!/['’]/.test(line), f + ":" + (i + 1) + " apostrophe dans un commentaire");
      else assert.ok(!/\S.*\s--\s/.test(line.replace(/'[^']*'/g, "''")), f + ":" + (i + 1) + " commentaire en fin de ligne ou au milieu d'une instruction");
    });
  });
  // aucun commentaire au milieu de la fonction de garde
  const fn = /create or replace function public\.institut_demandes_garde\(\)[\s\S]*?\n\$\$;/.exec(raw)[0];
  assert.ok(!/--/.test(fn), "aucun commentaire dans le corps de la fonction");
  assert.ok(/as \$\$\n/.test(fn));
});

test("aucun secret, e-mail, numéro ni nom réel ; jamais « Saint-Louis »", () => {
  FILES.forEach((f) => {
    const t = read(f);
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(t), f + " : e-mail");
    assert.ok(!/\+?\d[\d ]{8,}\d/.test(t), f + " : numéro");
    assert.ok(!/Saint-Louis/i.test(t));
    assert.ok(!/(sk_live|sk_sandbox|eyJ)/.test(t));
  });
});

test("additif : seule institut_demandes est touchée ; rien sur paiements, places, purchases, formations", () => {
  [sql, rb].forEach((t) => {
    const targets = [...t.matchAll(/(?:alter table|update|insert into|delete from|grant [^;]*? on|revoke [^;]*? on)\s+(?:only\s+)?(public\.\w+)/gi)].map((m) => m[1]);
    assert.deepStrictEqual([...new Set(targets)], ["public.institut_demandes"]);
    assert.ok(!/institut_paiements|institut_places|public\.purchases|public\.formations/.test(t));
  });
});

test("règle d'âge : 14 à 25 (ancienne contrainte supprimée puis recréée, NOT VALID puis validation sûre)", () => {
  assert.match(sql, /drop constraint if exists institut_demandes_age_check;/);
  assert.match(sql, /add constraint institut_demandes_age_check check \(age between 14 and 25\) not valid;/);
  assert.match(sql, /validate constraint institut_demandes_age_check;\s+exception when check_violation then/);
  assert.ok(!/between 3 and 35/.test(sql));
  assert.ok(!/lui_meme/.test(sql), "la règle lui_meme (18 ans ou plus) n'est pas touchée");
});

test("situation : colonne obligatoire, trois valeurs, lignes existantes remplies avant le NOT NULL", () => {
  assert.match(sql, /add column if not exists situation text;/);
  assert.ok(sql.indexOf("update public.institut_demandes set situation = 'pere' where situation is null;") < sql.indexOf("alter column situation set not null;"));
  assert.match(sql, /check \(situation in \('pere', 'mere', 'deux_parents'\)\)/);
});

test("parrain_majeur : boolean not null default false ; contrainte (age >= 18 ou parrain_majeur) validée sans casser", () => {
  assert.match(sql, /add column if not exists parrain_majeur boolean not null default false;/);
  assert.match(sql, /check \(age >= 18 or parrain_majeur = true\) not valid;/);
  assert.match(sql, /validate constraint institut_demandes_parrain_majeur_check;\s+exception when check_violation then/);
});

test("droit d'insertion : situation et parrain_majeur ajoutés ; aucun droit de mise à jour ni sur traite_le / traite_par / raison_refus", () => {
  const g = /grant insert \(([^)]*)\)\s+on public\.institut_demandes to authenticated;/.exec(sql);
  assert.ok(g);
  const cols = g[1].split(",").map((x) => x.trim());
  assert.deepStrictEqual(cols, ["id", "parrain_id", "prenom", "age", "lien", "formation", "motif", "justificatif_path", "statut", "situation", "parrain_majeur"]);
  assert.ok(!/grant update/.test(sql));
});

test("garde : situation et parrain_majeur figés après dépôt, comme les autres champs ; reste inchangée (5 en attente, traitement admin)", () => {
  const fn = /create or replace function public\.institut_demandes_garde\(\)[\s\S]*?\n\$\$;/.exec(sql)[0];
  ["new.id", "new.parrain_id", "new.prenom", "new.age", "new.lien", "new.formation", "new.motif", "new.justificatif_path", "new.situation", "new.parrain_majeur", "new.cree_le"].forEach((c) => {
    assert.ok(fn.includes(c + " is distinct from old." + c.slice(4)), c + " figé");
  });
  assert.match(fn, /security|set search_path = public, pg_temp/);
  assert.ok(fn.includes("v_en_attente >= 5") && fn.includes("Seul un administrateur peut traiter une demande."));
  assert.ok(!/security definer/.test(fn), "la garde n'est pas security definer (comme avant)");
  assert.match(sql, /drop trigger if exists institut_demandes_garde_trg on public\.institut_demandes;\s+create trigger institut_demandes_garde_trg\s+before insert or update on public\.institut_demandes\s+for each row execute function public\.institut_demandes_garde\(\);/);
  assert.ok(!/begin\s+if tg_op = 'INSERT'[\s\S]*parrain_majeur := /.test(fn), "la garde ne réécrit pas la déclaration");
});

test("retour arrière : confirmation 'NON', avertissement de perte, garde et droits d'origine, âge 3 à 35, colonnes supprimées", () => {
  assert.match(rb, /confirmation constant text := 'NON'/);
  assert.match(rb, /raise exception 'Retour arriere NON confirme/);
  assert.match(rbRaw, /DEFINITIVEMENT PERDUES/);
  assert.match(rb, /check \(age between 3 and 35\)/);
  assert.match(rb, /drop column if exists parrain_majeur;/);
  assert.match(rb, /drop column if exists situation;/);
  assert.match(rb, /grant insert \(id, parrain_id, prenom, age, lien, formation, motif, justificatif_path, statut\)/);
  assert.ok(!/new\.situation|new\.parrain_majeur/.test(rb), "la garde d'origine ne cite plus les colonnes");
  assert.ok(rb.indexOf("create or replace function") < rb.indexOf("drop column if exists parrain_majeur"), "garde avant la suppression des colonnes");
});

test("vérification : lecture seule, couvre colonnes, contraintes, droits, garde, déclencheur et lignes hors règle", () => {
  assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(v.replace(/'[^']*'/g, "''")), "lecture seule");
  ["information_schema.columns", "pg_constraint", "convalidated", "has_column_privilege", "pg_proc", "pg_trigger"].forEach((k) => assert.ok(v.includes(k), k));
  assert.match(v, /where age not between 14 and 25 or \(age < 18 and not parrain_majeur\)/);
});
