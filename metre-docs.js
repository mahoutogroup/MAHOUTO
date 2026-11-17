/* =========================================================
   MAHOUTO+ / MAJESTÉ PRESSE — Documents Word du Métré construction
   Deux documents :
     1. Devis estimatif  -> matériaux par groupe, prix, sous-totaux, main-d'œuvre, imprévus, total
     2. Métré détaillé   -> dimensions, surfaces, volumes de béton, quantités, hypothèses, avertissements

   Module PUR : il reçoit toutes les données en paramètres (input = { state, prices, labour, contingency, project },
   opts = { now }), appelle lui-même MetreCalc.compute puis MetreCalc.budget, et renvoie { bytes, filename }
   ou { error }. Jamais d'exception pour une saisie invalide. Aucun accès au DOM, au réseau ou au stockage.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./metre-calc"), require("./docx-lite"));
  } else root.MetreDocs = factory(root.MetreCalc, root.DocxLite);
})(typeof self !== "undefined" ? self : this, function (Calc, Docx) {
  "use strict";

  var W = 9638; // largeur utile A4 (twips)
  var GOLD = "D4AF37", GOLD_LIGHT = "F6EBC0", GREY = "F2F2F2", INK = "1A1A1A";
  var NBSP = "\u00A0";
  var ROOM_TYPES = { salon: "Salon", chambre: "Chambre", cuisine: "Cuisine", autre: "Autre" };
  var PLURALS = { "pièce": "pièces", "sac": "sacs", "barre": "barres" };

  /* ---------- Texte et formats ---------- */

  // Texte saisi : caractères de contrôle retirés, espaces réduits, longueur bornée. L'échappement XML est fait par docx-lite.
  function clean(s, max) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 200);
  }
  // Nom de fichier : sans accents ni caractères spéciaux.
  function slug(s) {
    return clean(s, 40).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  // Espaces ordinaires et fines insécables -> espace insécable (U+00A0), pour qu'un montant ne soit jamais coupé en fin de ligne.
  function nb(s) { return String(s).replace(/[ \u202F]/g, NBSP); }
  function M(n) { return nb(Calc.fmtMoney(n)); }
  function N(n, d) { return nb(Calc.fmtNum(n, d)); }
  function qtyText(qty, unit) {
    var u = qty > 1 && PLURALS[unit] ? PLURALS[unit] : unit;
    return N(qty, Number.isInteger(qty) ? 0 : 1) + NBSP + u;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dateFr(now) {
    var d = new Date(now === undefined || now === null ? Date.now() : now);
    if (isNaN(d.getTime())) d = new Date();
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function h2(text) { return Docx.p(text, { bold: true, size: 12.5, color: INK, before: 10, after: 4, keepNext: true, borderBottom: GOLD }); }
  function kv(rows) {
    return Docx.table({
      widths: [4200, W - 4200],
      rows: rows.map(function (r) {
        return { cells: [{ text: r[0], bold: true, fill: GREY }, { text: r[1], bold: !!r[2] }] };
      })
    });
  }
  function headerOf(project, date, subtitle) {
    return { title: "MAJESTÉ PRESSE", subtitle: subtitle, contact: project + "  ·  " + date };
  }

  /* ---------- Préparation commune : calcul + budget, ou erreur ---------- */

  function prepare(input) {
    if (!input || typeof input !== "object") return { error: "Aucune donnée à exporter." };
    var state = input.state;
    if (!state || typeof state !== "object") return { error: "Aucune donnée à exporter." };
    var result = Calc.compute(state);
    if (!result.ready) {
      var first = null;
      Object.keys(result.errors || {}).some(function (k) { first = result.errors[k]; return true; });
      return { error: "Corrigez les champs en erreur avant d'exporter" + (first ? " (" + first + ")" : "") + "." };
    }
    var cp = Calc.parseNum(input.contingency);
    if (cp.error) return { error: "Imprévus : " + cp.error };
    var pct = cp.empty ? 0 : cp.value;
    var bd = Calc.budget(result, input.prices || {}, input.labour, pct);
    if (!bd.ok) {
      var ids = Object.keys(bd.errors);
      var label = function (id) {
        if (id === "labour") return "main-d'œuvre";
        var row = bd.rows.filter(function (r) { return r.id === id; })[0];
        return row ? row.label : id;
      };
      return { error: "Un prix saisi n'est pas un nombre valide : " + ids.slice(0, 3).map(label).join(", ") + (ids.length > 3 ? "…" : "") + "." };
    }
    return {
      result: result, bd: bd, pct: pct, val: Calc.validate(state).v,
      project: clean(input.project, 80) || "Projet sans nom"
    };
  }

  function groupsOf(rows) {
    var groups = [];
    rows.forEach(function (row) {
      var g = groups.filter(function (x) { return x.name === row.group; })[0];
      if (!g) { g = { name: row.group, rows: [] }; groups.push(g); }
      g.rows.push(row);
    });
    return groups;
  }

  /* ---------- 1. Devis estimatif ---------- */

  function buildQuoteDoc(input, opts) {
    try {
      var prep = prepare(input);
      if (prep.error) return { error: prep.error };
      var bd = prep.bd, date = dateFr(opts && opts.now), project = prep.project;
      var body = [];
      body.push(Docx.p("Devis estimatif de construction", { bold: true, size: 20, color: INK, after: 2 }));
      body.push(Docx.p("Projet : " + project + "  ·  Établi le " + date, { size: 10.5, color: "555555", after: 8 }));

      body.push(h2("Matériaux"));
      var HEAD = { bold: true, fill: GOLD, color: "0A0A0A" };
      var rows = [{ header: true, cells: [
        Object.assign({ text: "Désignation" }, HEAD),
        Object.assign({ text: "Quantité", align: "center" }, HEAD),
        Object.assign({ text: "Prix unitaire", align: "right" }, HEAD),
        Object.assign({ text: "Total", align: "right" }, HEAD)] }];
      groupsOf(bd.rows).forEach(function (g) {
        rows.push({ cells: [{ text: g.name, bold: true, fill: GREY, span: 4 }] });
        var missing = 0;
        g.rows.forEach(function (row) {
          var priced = row.price !== null;
          if (!priced) missing++;
          var paras = [Docx.p(row.label, { size: 10, after: 0 })];
          if (row.detail) paras.push(Docx.p(row.detail, { size: 8.5, color: "666666", after: 0 }));
          rows.push({ cells: [
            { paras: paras },
            { text: qtyText(row.qty, row.unit), align: "center" },
            { text: priced ? M(row.price) : "à chiffrer", align: "right", color: priced ? undefined : "9B1C1C" },
            { text: priced ? M(row.total) : "à chiffrer", align: "right", color: priced ? undefined : "9B1C1C" }] });
        });
        var sub = bd.groups[g.name];
        var subText = sub === undefined ? "à chiffrer" : M(sub) + (missing ? " (partiel)" : "");
        rows.push({ cells: [{ text: "Sous-total " + g.name, bold: true, span: 3, align: "right" }, { text: subText, bold: true, align: "right" }] });
      });
      body.push(Docx.table({ widths: [4138, 1700, 1900, 1900], rows: rows }));
      body.push(Docx.spacer(6));

      var pctText = N(prep.pct, Number.isInteger(prep.pct) ? 0 : 1) + NBSP + "%";
      var partial = !bd.complete;
      var totalLabel = partial ? "TOTAL PARTIEL" : "TOTAL";
      body.push(h2("Récapitulatif"));
      body.push(Docx.table({
        widths: [6838, 2800],
        rows: [
          { cells: [{ text: "Sous-total matériaux" + (partial ? " (lignes chiffrées seulement)" : ""), bold: true }, { text: M(bd.materials), align: "right", bold: true }] },
          { cells: [{ text: "Main-d'œuvre (montant forfaitaire)" }, { text: M(bd.labour), align: "right" }] },
          { cells: [{ text: "Imprévus (" + pctText + ")" }, { text: M(bd.contingency), align: "right" }] },
          { cells: [{ text: totalLabel, bold: true, fill: GOLD_LIGHT, size: 11 }, { text: M(bd.total), bold: true, fill: GOLD_LIGHT, align: "right", size: 11 }] }
        ]
      }));
      body.push(Docx.spacer(4));
      if (partial) {
        var n = bd.missing.length;
        body.push(Docx.p(n + " ligne" + (n > 1 ? "s" : "") + " sans prix (« à chiffrer ») : le total est partiel tant que tous les prix ne sont pas renseignés.",
          { bold: true, size: 10, color: "9B1C1C", after: 6 }));
      }
      body.push(Docx.p("Montants exprimés en francs CFA (FCFA).", { italic: true, size: 9, color: "666666", after: 2 }));
      body.push(Docx.p("Estimation à faire valider par un professionnel du bâtiment.", { italic: true, bold: true, size: 9.5, color: "666666", after: 2 }));

      var bytes = Docx.createDocument({
        header: headerOf(project, date, "Devis estimatif · Construction"),
        footerText: "Devis estimatif — " + project, title: "Devis estimatif " + project, body: body
      });
      return { bytes: bytes, filename: "Devis-estimatif-" + (slug(project) || "projet") + ".docx" };
    } catch (e) {
      return { error: "Impossible de produire le devis." };
    }
  }

  /* ---------- 2. Métré détaillé ---------- */

  function buildMetreDoc(input, opts) {
    try {
      var prep = prepare(input);
      if (prep.error) return { error: prep.error };
      var r = prep.result.r, v = prep.val, date = dateFr(opts && opts.now), project = prep.project;
      var body = [];
      body.push(Docx.p("Métré détaillé", { bold: true, size: 20, color: INK, after: 2 }));
      body.push(Docx.p("Projet : " + project + "  ·  Établi le " + date, { size: 10.5, color: "555555", after: 8 }));

      // --- Dimensions saisies ---
      body.push(h2("Dimensions saisies"));
      var roomRows = [{ header: true, cells: [
        { text: "Pièce", bold: true, fill: GREY }, { text: "Type", bold: true, fill: GREY },
        { text: "Longueur", bold: true, fill: GREY, align: "right" }, { text: "Carrelage", bold: true, fill: GREY, align: "center" }] }];
      v.rooms.forEach(function (rm, i) {
        roomRows.push({ cells: [
          { text: clean(rm.name, 60) || "Pièce " + (i + 1) }, { text: ROOM_TYPES[rm.type] || "Autre" },
          { text: N(rm.length) + NBSP + "cm", align: "right" }, { text: rm.tiled ? "Oui" : "Non", align: "center" }] });
      });
      body.push(Docx.table({ widths: [3800, 2300, 2000, 1538], rows: roomRows }));
      body.push(Docx.spacer(4));
      body.push(kv([
        ["Longueur totale (pièces côte à côte)", N(r.totalLength) + NBSP + "cm"],
        ["Profondeur extérieure", N(v.depth) + NBSP + "cm"],
        ["Hauteur des murs", N(v.wallHeight) + NBSP + "cm"],
        ["Épaisseur des parpaings", N(v.blockThickness) + NBSP + "cm"],
        ["Portes", N(v.doors) + " (" + N(v.doorW) + NBSP + "×" + NBSP + N(v.doorH) + NBSP + "cm)"],
        ["Fenêtres", N(v.windows) + " (" + N(v.windowW) + NBSP + "×" + NBSP + N(v.windowH) + NBSP + "cm)"],
        ["Toiture", (v.roofType === "dalle" ? "Dalle en béton" : "Tôle sur charpente") + " · débord " + N(v.roofOverhang) + NBSP + "cm · pente " + N(v.roofSlope) + NBSP + "%"]
      ]));

      // --- Surfaces et longueurs ---
      body.push(h2("Surfaces et longueurs"));
      body.push(kv([
        ["Surface bâtie", N(r.footprint, 1) + NBSP + "m²"],
        ["Surface intérieure", N(r.innerArea, 1) + NBSP + "m²"],
        ["Longueur des murs (refends compris)", N(r.wallLength, 1) + NBSP + "m"],
        ["Surface brute des murs", N(r.grossArea, 1) + NBSP + "m²"],
        ["Surface des ouvertures", N(r.openArea, 1) + NBSP + "m²"],
        ["Surface nette des murs", N(r.netArea, 1) + NBSP + "m²", true],
        ["Surface de toiture", N(r.roofArea, 1) + NBSP + "m²"]
      ]));

      // --- Volumes de béton ---
      body.push(h2("Volumes de béton"));
      var cp = r.concreteParts, parts = [
        ["Semelle de fondation", cp.footing],
        ["Dalle de sol", cp.slab],
        ["Chaînages (bas et haut)", cp.ties],
        ["Poteaux (" + N(r.postCount) + ")", cp.posts],
        ["Linteaux", cp.lintels]
      ];
      if (cp.roofSlab > 0) parts.push(["Dalle de toiture (pertes comprises)", cp.roofSlab]);
      var vrows = [{ header: true, cells: [{ text: "Poste", bold: true, fill: GREY }, { text: "Volume", bold: true, fill: GREY, align: "right" }] }];
      parts.forEach(function (x) { vrows.push({ cells: [{ text: x[0] }, { text: N(x[1], 2) + NBSP + "m³", align: "right" }] }); });
      vrows.push({ cells: [{ text: "Total béton (volumes nets + 5 % de pertes)", bold: true, fill: GOLD_LIGHT }, { text: N(r.concrete, 2) + NBSP + "m³", bold: true, fill: GOLD_LIGHT, align: "right" }] });
      body.push(Docx.table({ widths: [6838, 2800], rows: vrows }));
      body.push(Docx.spacer(4));
      body.push(kv([
        ["Mortier de pose", N(r.mortar, 2) + NBSP + "m³"],
        ["Enduit", N(r.plaster, 2) + NBSP + "m³"],
        ["Chape (carrelage)", N(r.screed, 2) + NBSP + "m³"]
      ]));

      // --- Quantités ---
      body.push(h2("Liste complète des quantités"));
      var qrows = [{ header: true, cells: [
        { text: "Désignation", bold: true, fill: GOLD, color: "0A0A0A" },
        { text: "Quantité", bold: true, fill: GOLD, color: "0A0A0A", align: "right" },
        { text: "Détail", bold: true, fill: GOLD, color: "0A0A0A" }] }];
      groupsOf(prep.result.lines).forEach(function (g) {
        qrows.push({ cells: [{ text: g.name, bold: true, fill: GREY, span: 3 }] });
        g.rows.forEach(function (ln) {
          qrows.push({ cells: [{ text: ln.label }, { text: qtyText(ln.qty, ln.unit), align: "right" }, { text: ln.detail || "", size: 9, color: "555555" }] });
        });
      });
      body.push(Docx.table({ widths: [3700, 1700, 4238], rows: qrows }));

      // --- Hypothèses ---
      body.push(h2("Hypothèses de calcul"));
      var hyp = [
        ["Parpaing", N(v.blockLength) + NBSP + "×" + NBSP + N(v.blockHeight) + NBSP + "×" + NBSP + N(v.blockThickness) + NBSP + "cm"],
        ["Joints (vertical / horizontal)", N(v.jointLength, 1) + NBSP + "/" + NBSP + N(v.jointHeight, 1) + NBSP + "cm"],
        ["Casse et pertes de parpaings", N(v.breakage, 1) + NBSP + "%"],
        ["Fondations (profondeur de tranchée)", N(v.foundationDepth) + NBSP + "cm"],
        ["Semelle (largeur × épaisseur)", N(v.footingWidth) + NBSP + "×" + NBSP + N(v.footingThickness) + NBSP + "cm"],
        ["Rangs de parpaings du soubassement", N(v.baseRows)],
        ["Espacement des poteaux", N(v.postSpacing) + NBSP + "cm"],
        ["Dalle de sol (épaisseur)", N(v.slabThickness) + NBSP + "cm"],
        ["Enduit sur les deux faces", v.plaster ? "Oui, " + N(v.plasterThickness, 1) + NBSP + "cm" : "Non"],
        ["Remblai saisi", N(v.fill, 1) + NBSP + "m³"],
        ["Marge sur ciment, sable et gravier", N(v.bulkMargin, 1) + NBSP + "%"],
        ["Imprévus du budget", N(prep.pct, 1) + NBSP + "%"]
      ];
      if (v.makeBlocks) {
        var perBag = r.blockMakingCement > 0 ? Math.round(r.blocks / r.blockMakingCement * 100) / 100 : 0;
        var perBagText = v.blocksPerBag > 0 ? N(perBag, perBag % 1 ? 1 : 0) + " (saisi)"
          : N(perBag, perBag % 1 ? 1 : 0) + " (valeur automatique pour " + N(v.blockThickness) + NBSP + "cm)";
        hyp.push(["Parpaings fabriqués sur place par le maçon", "Oui"]);
        hyp.push(["Parpaings par sac de ciment", perBagText]);
        hyp.push(["Ciment de fabrication (avant marge)", N(r.blockMakingCement, 1) + NBSP + "sacs"]);
        hyp.push(["Sable de fabrication (avant marge)", N(r.blockMakingSand, 1) + NBSP + "m³"]);
      } else hyp.push(["Parpaings fabriqués sur place par le maçon", "Non (parpaings achetés)"]);
      body.push(kv(hyp));

      // --- Avertissements ---
      body.push(h2("Avertissements"));
      if (prep.result.warnings.length) prep.result.warnings.forEach(function (w) { body.push(Docx.bullet(w)); });
      else body.push(Docx.p("Aucun avertissement particulier.", { italic: true, size: 10 }));
      body.push(Docx.spacer(6));
      body.push(Docx.p("Estimation à faire valider par un professionnel du bâtiment : les quantités sont arrondies avec une marge et ne remplacent ni un plan, ni l'avis d'un maçon ou d'un ingénieur pour les fondations et la charpente.",
        { italic: true, size: 9, color: "666666" }));

      var bytes = Docx.createDocument({
        header: headerOf(project, date, "Métré détaillé · Construction"),
        footerText: "Métré détaillé — " + project, title: "Métré détaillé " + project, body: body
      });
      return { bytes: bytes, filename: "Metre-detaille-" + (slug(project) || "projet") + ".docx" };
    } catch (e) {
      return { error: "Impossible de produire le métré." };
    }
  }

  return { buildQuoteDoc: buildQuoteDoc, buildMetreDoc: buildMetreDoc, slug: slug };
});
