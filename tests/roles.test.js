/* Tests du changement de rôle et du rôle modérateur — exécution : node tests/roles.test.js
   Aucune dépendance, aucun réseau, aucune base. La base est testée à part (copie PostgreSQL, voir la PR). */
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdminRoles = require("../admin-roles");
const Moderation = require("../moderation");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  OK  " + name); },
    (err) => { console.error("  ÉCHEC  " + name + "\n" + (err && err.stack || err)); process.exitCode = 1; }
  );
}

// api/_roles.js est un module ES (le dépôt n'a pas "type": "module") : copie temporaire en .mjs pour l'importer.
async function loadRoles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roles-test-"));
  const file = path.join(dir, "roles.mjs");
  fs.writeFileSync(file, read("api/_roles.js"));
  const mod = await import(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

// ---------- faux DOM : innerHTML interdit ----------
function fakeDoc() {
  const byId = {};
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, listeners: {}, className: "", _text: "", value: "", parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); }
    };
    Object.defineProperty(n, "innerHTML", { get() { return ""; }, set() { throw new Error("innerHTML interdit"); } });
    return n;
  }
  return { createElement: node, getElementById: (id) => byId[id] || null, head: node("head") };
}
function walk(n, fn) { fn(n); n.children.forEach((c) => walk(c, fn)); }
const findAll = (n, pred) => { const r = []; walk(n, (x) => { if (pred(x)) r.push(x); }); return r; };
const allText = (n) => { const o = []; walk(n, (x) => { if (x._text) o.push(x._text); }); return o.join("\n"); };

(async () => {
  const Roles = await loadRoles();
  const founder = { callerId: "F", callerRole: "founder" };
  const member = (over) => Object.assign({ id: "M", role: "user", is_moderator: false }, over);

  await test("seul le founder change un rôle (admin, super_admin, modérateur, membre : refusés)", () => {
    ["admin", "super_admin", "user", "premium", null, undefined].forEach((r) => {
      const res = Roles.planRoleChange({ callerId: "X", callerRole: r, target: member(), newRole: "admin" });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.status, 403);
    });
  });

  await test("le founder ne se cible pas lui-même, ni un founder, ni un super_admin", () => {
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member({ id: "F" }), newRole: "user" }).status, 403);
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member({ role: "founder" }), newRole: "user" }).status, 403);
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member({ role: "super_admin" }), newRole: "admin" }).status, 403);
  });

  await test("seuls user, moderateur, admin sont attribuables ; founder et super_admin ne le sont pas", () => {
    ["founder", "super_admin", "premium", "root", "", null, undefined, "ADMIN"].forEach((r) => {
      const res = Roles.planRoleChange({ ...founder, target: member(), newRole: r });
      assert.strictEqual(res.ok, false, String(r));
      assert.strictEqual(res.status, 400);
    });
    assert.deepStrictEqual(Roles.ASSIGNABLE_ROLES, ["user", "moderateur", "admin"]);
  });

  await test("cible inexistante : 404 ; aucun changement : 409", () => {
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: null, newRole: "admin" }).status, 404);
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member(), newRole: "user" }).status, 409);
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member({ is_moderator: true }), newRole: "moderateur" }).status, 409);
    assert.strictEqual(Roles.planRoleChange({ ...founder, target: member({ role: "admin" }), newRole: "admin" }).status, 409);
  });

  await test("« moderateur » est un drapeau : le rôle commercial (premium, business…) n'est jamais écrasé", () => {
    ["premium", "business", "organisation", "formateur", "user"].forEach((r) => {
      const res = Roles.planRoleChange({ ...founder, target: member({ role: r }), newRole: "moderateur" });
      assert.deepStrictEqual(res, { ok: true, role: r, moderator: true }, r);
      const back = Roles.planRoleChange({ ...founder, target: member({ role: r, is_moderator: true }), newRole: "user" });
      assert.deepStrictEqual(back, { ok: true, role: r, moderator: false }, r + " retiré");
    });
  });

  await test("admin : role = admin, drapeau remis à faux ; admin → user / moderateur : retombe user", () => {
    assert.deepStrictEqual(Roles.planRoleChange({ ...founder, target: member({ is_moderator: true }), newRole: "admin" }), { ok: true, role: "admin", moderator: false });
    assert.deepStrictEqual(Roles.planRoleChange({ ...founder, target: member({ role: "admin" }), newRole: "user" }), { ok: true, role: "user", moderator: false });
    assert.deepStrictEqual(Roles.planRoleChange({ ...founder, target: member({ role: "admin" }), newRole: "moderateur" }), { ok: true, role: "user", moderator: true });
  });

  await test("erreurs de la base → messages clairs (migration absente = 503), sans détail technique", () => {
    const cases = [
      [{ message: "ROLE_FOUNDER_REQUIS: x" }, 403], [{ message: "ROLE_SOI_MEME: x" }, 403], [{ message: "ROLE_CIBLE_PROTEGEE: x" }, 403],
      [{ message: "ROLE_CIBLE_INTROUVABLE: x" }, 404], [{ message: "ROLE_AUCUN_CHANGEMENT: x" }, 409],
      [{ message: "ROLE_MOTIF_TROP_LONG: x" }, 400], [{ message: "ROLE_VALEUR_INVALIDE: x" }, 400],
      [{ code: "PGRST202", message: "Could not find the function public.apply_role_change(...) in the schema cache" }, 503],
      [{ code: "42883", message: "function apply_role_change does not exist" }, 503],
      [{ code: "XX000", message: "boom interne avec détails sql" }, 500]
    ];
    cases.forEach(([err, status]) => {
      const m = Roles.mapRoleChangeError(err);
      assert.strictEqual(m.status, status, JSON.stringify(err));
      assert.ok(!/PGRST|42883|sql|boom|ROLE_|schema cache|apply_role_change/.test(m.error), m.error);
    });
  });

  // ---------- route serveur ----------
  const route = strip(read("api/admin/user-action.js"));
  await test("route : set_role fusionnée dans user-action.js ; aucune nouvelle fonction Vercel (12 fichiers, _roles.js est un module)", () => {
    const fns = [];
    (function scan(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return scan(p);
        if (/\.(js|mjs|ts)$/.test(e.name) && !e.name.startsWith("_")) fns.push(path.relative(path.join(root, "api"), p));
      });
    })(path.join(root, "api"));
    assert.strictEqual(fns.length, 12, "fonctions : " + fns.join(", "));
    assert.ok(fs.existsSync(path.join(root, "api", "_roles.js")));
    assert.match(route, /\["disable", "reactivate", "delete", "set_role"\]/);
  });

  await test("route : le founder est exigé AVANT la règle « admin », la cible est lue, apply_role_change est appelée avec la clé service", () => {
    const iSet = route.indexOf('if (action === "set_role")');
    const iAdminGate = route.indexOf('if (!["admin", "super_admin", "founder"].includes(callerRole))');
    assert.ok(iSet > 0 && iAdminGate > iSet, "set_role traité avant la règle admin");
    const fn = route.slice(route.indexOf("async function handleSetRole"));
    assert.ok(fn.indexOf('callerRole !== "founder"') < fn.indexOf('.from("profiles")'), "founder vérifié avant toute lecture");
    assert.match(fn, /planRoleChange\(/);
    assert.match(fn, /supabaseAdmin\.rpc\("apply_role_change"/);
    assert.ok(!/\.from\("profiles"\)\s*\.update|\.update\(\{[^}]*role/.test(route), "la route n'écrit jamais profiles.role directement");
    assert.match(route, /createClient\(supabaseUrl, serviceKey\)/);
  });

  await test("route : l'appelant vient du jeton de session vérifié, jamais du corps de la requête", () => {
    assert.match(route, /auth\.getUser\(token\)/);
    assert.match(route, /handleSetRole\(res, supabaseAdmin, userData\.user\.id, callerRole,/);
    assert.ok(!/callerId\s*=\s*req\.body|callerRole\s*=\s*req\.body/.test(route));
  });

  await test("list-users : renvoie is_moderator, tolère la migration 008 absente", () => {
    const code = strip(read("api/admin/list-users.js"));
    assert.match(code, /select\("id, username, role, is_moderator"\)/);
    assert.match(code, /profilesError/);
    assert.match(code, /is_moderator: !!p\.is_moderator/);
  });

  // ---------- interface ----------
  await test("bouton « Changer le rôle » : founder seulement, jamais soi-même, jamais founder ni super_admin", () => {
    const t = (o) => Object.assign({ id: "M", role: "user" }, o);
    assert.strictEqual(AdminRoles.canChangeRole("founder", "F", t()), true);
    assert.strictEqual(AdminRoles.canChangeRole("founder", "F", t({ id: "F" })), false);
    assert.strictEqual(AdminRoles.canChangeRole("founder", "F", t({ role: "founder" })), false);
    assert.strictEqual(AdminRoles.canChangeRole("founder", "F", t({ role: "super_admin" })), false);
    ["admin", "super_admin", "user", "premium", null, undefined].forEach((r) => assert.strictEqual(AdminRoles.canChangeRole(r, "A", t()), false, String(r)));
  });

  await test("options : celle que le membre a déjà n'est pas proposée ; avertissement pour admin", () => {
    assert.deepStrictEqual(AdminRoles.optionsFor({ role: "user" }).map((o) => o.value), ["moderateur", "admin"]);
    assert.deepStrictEqual(AdminRoles.optionsFor({ role: "premium", is_moderator: true }).map((o) => o.value), ["user", "admin"]);
    assert.deepStrictEqual(AdminRoles.optionsFor({ role: "admin" }).map((o) => o.value), ["user", "moderateur"]);
    assert.match(AdminRoles.OPTIONS.find((o) => o.value === "admin").warning, /accès à toute l'administration/);
    assert.strictEqual(AdminRoles.displayRole({ role: "premium", is_moderator: true }), "moderateur");
    assert.strictEqual(AdminRoles.displayRole({ role: "admin", is_moderator: true }), "admin");
  });

  await test("fenêtre : confirmation avant l'envoi, motif transmis, pseudo hostile en texte, aucun innerHTML", async () => {
    const doc = fakeDoc();
    const evil = '<img src=x onerror="alert(1)">';
    const sent = [];
    const confirms = [];
    const dlg = AdminRoles.buildDialog({
      doc, target: { id: "M", name: evil, role: "user", is_moderator: false },
      confirmFn: (t) => { confirms.push(t); return true; },
      send: async (role, reason) => { sent.push([role, reason]); return { ok: true, message: "ok" }; },
      onDone() {}
    });
    assert.ok(allText(dlg.overlay).includes(evil), "pseudo affiché comme texte");
    assert.strictEqual(findAll(dlg.overlay, (n) => ["img", "a", "script"].includes(n.tag)).length, 0);
    const radios = findAll(dlg.overlay, (n) => n.tag === "input");
    assert.deepStrictEqual(radios.map((r) => r.attrs.value), ["moderateur", "admin"]);
    assert.ok("disabled" in dlg.sendBtn.attrs, "Confirmer désactivé tant qu'aucun rôle n'est choisi");
    radios[1].listeners.change();
    assert.match(allText(dlg.overlay), /accès à toute l'administration/);
    dlg.reason.value = "  Fiable depuis 2 ans  ";
    dlg.sendBtn.listeners.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(confirms.length, 1);
    assert.match(confirms[0], /Administrateur/);
    assert.match(confirms[0], /accès à toute l'administration/);
    assert.deepStrictEqual(sent, [["admin", "Fiable depuis 2 ans"]]);
  });

  await test("fenêtre : refus de la confirmation → rien n'est envoyé ; erreur serveur affichée sans détail", async () => {
    const doc = fakeDoc();
    let sends = 0;
    const dlg = AdminRoles.buildDialog({
      doc, target: { id: "M", name: "Awa", role: "user" }, confirmFn: () => false,
      send: async () => { sends++; return { ok: false, message: AdminRoles.errorMessage(503, {}) }; }
    });
    findAll(dlg.overlay, (n) => n.tag === "input")[0].listeners.change();
    dlg.sendBtn.listeners.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sends, 0);
    assert.match(AdminRoles.errorMessage(503, { error: "x" }), /migration 008/);
    assert.match(AdminRoles.errorMessage(403, { error: "Seul le fondateur peut changer le rôle d'un membre." }), /fondateur/);
    assert.ok(!/TypeError|stack|undefined/.test(AdminRoles.errorMessage(500, { error: "TypeError stack" })));
  });

  const users = read("admin/users.html");
  await test("users.html : le bouton n'est ajouté que si canChangeRole ; aucun innerHTML avec des données de la fenêtre ; pas de journal du motif", () => {
    assert.match(users, /MahoutoAdminRoles\.canChangeRole\(callerRole, currentAdminId, u\)/);
    assert.match(users, /action: "set_role", userId: u\.id, newRole, reason/);
    const part = users.slice(users.indexOf("// -------- Changer le rôle (founder)"), users.indexOf("// -------- Voir le profil"));
    assert.ok(!/innerHTML/.test(part), "aucun innerHTML dans la partie « Changer le rôle »");
    assert.ok(!/console\.(log|error|warn)/.test(part));
    const lib = strip(read("admin-roles.js"));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\./.test(lib));
  });

  // ---------- page des signalements : modérateur ----------
  const page = read("admin/signalements.html");
  await test("moderation.js : canModerate = admin, super_admin, founder ou drapeau modérateur vrai (jamais autre chose)", () => {
    ["admin", "super_admin", "founder"].forEach((r) => assert.strictEqual(Moderation.canModerate(r, false), true));
    assert.strictEqual(Moderation.canModerate("user", true), true);
    assert.strictEqual(Moderation.canModerate("premium", true), true);
    [["user", false], ["premium", false], [null, undefined], ["user", "true"], ["moderateur", false], ["", 1]].forEach(([r, m]) =>
      assert.strictEqual(Moderation.canModerate(r, m), false, r + "/" + m));
    assert.strictEqual(Moderation.errorKind({ message: "MODERATOR_REQUIRED: x" }), "denied");
    assert.strictEqual(Moderation.errorKind({ message: "SIGNALEMENT_REQUIS: x" }), "denied");
  });

  await test("page : un modérateur passe par les fonctions de la base, jamais par profiles ni messages ; les autres onglets sont cachés", () => {
    const code = strip(page.slice(page.indexOf("<script>")));
    const start = code.search(/if \(moderatorOnly\) \{\s*const reportIds/);
    const end = code.search(/\} else \{\s*const ids/);
    assert.ok(start > 0 && end > start, "bloc modérateur trouvé");
    const mod = code.slice(start, end);
    assert.match(mod, /rpc\("moderator_report_people"/);
    assert.match(mod, /rpc\("moderator_room_messages"/);
    assert.ok(!/\.from\(/.test(mod), "aucun accès direct aux tables en mode modérateur");
    assert.match(page, /data-admin-only/);
    assert.match(code, /moderatorOnly = !isAdmin/);
    assert.match(code, /is_moderator/);
    assert.ok(!/dm_messages|dm_conversations/.test(code));
  });

  await test("page : colonne is_moderator absente (008 pas exécutée) → ignorée ; moderator_* absentes → notice claire", () => {
    const code = strip(page.slice(page.indexOf("<script>")));
    assert.match(code, /isModerator = !res\.error && !!res\.data && res\.data\.is_moderator === true/);
    assert.match(code, /showNotice\(M\.errorMessage\(people\.error\)\)/);
    assert.strictEqual(Moderation.errorKind({ code: "PGRST202", message: "Could not find the function public.moderator_room_messages" }), "unavailable");
    assert.strictEqual(Moderation.errorKind({ code: "42883", message: "function moderator_report_people does not exist" }), "unavailable");
  });

  await test("profil.html : lien « Signalements » du modérateur, erreur ignorée si la colonne manque", () => {
    const profil = read("profil.html");
    assert.match(profil, /id="moderator-reports-link"/);
    assert.match(profil, /select\("is_moderator"\)/);
    assert.match(profil, /res\.error \|\| !res\.data \|\| res\.data\.is_moderator !== true/);
  });

  await test("cache hors ligne : admin-roles.js ajouté, version incrémentée (≥ v87)", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/admin-roles\.js"/);
    assert.match(sw, /"\/moderation\.js"/);
    assert.ok(Number((sw.match(/mahoutoplus-shell-v(\d+)/) || [])[1]) >= 87);
  });

  console.log("\n" + passed + " test(s) réussi(s)");
})();
