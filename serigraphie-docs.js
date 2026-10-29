/* =========================================================
   MAHOUTO+ / MAJESTÉ PRESSE — Documents Word du calculateur
   Deux documents distincts :
     1. Devis client      -> prix de vente seulement (jamais de coûts)
     2. Fiche interne     -> dépenses, coût de revient, bénéfice estimé

   SÉCURITÉ : le devis client est construit uniquement à partir
   d'une « vue client » (liste blanche de champs de vente). Les
   coûts ne lui sont jamais transmis, donc ils ne peuvent pas fuiter.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./serigraphie-calc"), require("./docx-lite"));
  } else root.SerigraphieDocs = factory(root.SerigraphieCalc, root.DocxLite);
})(typeof self !== "undefined" ? self : this, function (Calc, Docx) {
  "use strict";

  var W = 9638; // largeur utile A4 (twips)
  var GOLD = "D4AF37", GOLD_LIGHT = "F6EBC0", GREY = "F2F2F2", INK = "1A1A1A";
  var KIND_LABELS = { consommable: "Consommable", main_oeuvre: "Main-d'œuvre", soustraitance: "Sous-traitance", autre: "Autre" };

  function clean(s, max) { return String(s === null || s === undefined ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500); }
  function slug(s) { return clean(s, 40).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function h2(text) { return Docx.p(text, { bold: true, size: 12.5, color: INK, before: 10, after: 4, keepNext: true, borderBottom: GOLD }); }
  function kv(rows) {
    return Docx.table({
      widths: [3200, W - 3200],
      rows: rows.map(function (r) {
        return { cells: [{ text: r[0], bold: true, fill: GREY }, { text: r[1], bold: !!r[2] }] };
      })
    });
  }
  function headerOf(state) {
    return {
      title: "MAJESTÉ PRESSE",
      subtitle: "Sérigraphe Imprimeur · Impression et personnalisation textile",
      contact: clean(state.order.contact, 160) || "Cotonou, Bénin"
    };
  }

  /* ---------- 1. Vue client (liste blanche) ---------- */

  /**
   * Retourne la seule information transmise au devis client, ou
   * { error } si le devis ne peut pas être produit.
   */
  function clientView(state) {
    var o = state.order || {}, g = state.garments || {}, d = state.dtf || {};
    var qty = Calc.parseAmount(o.qty, { integer: true, min: 1 });
    var price = Calc.parseAmount(o.unitPrice, {});
    if (qty.error || qty.empty) return { error: "Indiquez une quantité valide (nombre entier, au moins 1)." };
    if (price.error || price.empty) return { error: "Indiquez le prix de vente unitaire pour produire le devis client." };
    var logos = Calc.parseAmount(d.logosPerGarment, { integer: true, min: 0 });
    var serHasAmount = (state.serigraphie || []).some(function (l) { return (Calc.parseAmount(l.amount, {}).value || 0) > 0; });
    var garment = [clean(g.type, 40), clean(g.quality, 60)].filter(Boolean).join(" ");
    return {
      ref: clean(o.ref, 40), date: Calc.fmtDateFr(o.date), client: clean(o.client, 120), phone: clean(o.phone, 40),
      designation: clean(o.designation, 200), garment: garment, qty: qty.value, unitPrice: price.value, total: qty.value * price.value,
      logosPerGarment: logos.value || 0, serigraphie: serHasAmount, notes: clean(o.notes, 1500), conditions: clean(o.conditions, 1500),
      header: headerOf(state)
    };
  }

  function buildClientDoc(state) {
    var v = clientView(state);
    if (v.error) return { error: v.error };
    var body = [];
    body.push(Docx.p("Devis de personnalisation textile", { bold: true, size: 20, color: INK, after: 2 }));
    body.push(Docx.p("Devis n° " + (v.ref || "—") + "  ·  " + (v.date || "—"), { size: 10.5, color: "555555", after: 8 }));

    body.push(h2("Client"));
    var info = [["Client", v.client || "À compléter"]];
    if (v.phone) info.push(["Téléphone", v.phone]);
    info.push(["Date du devis", v.date || "—"]);
    body.push(kv(info));
    body.push(Docx.spacer(6));

    body.push(h2("Détail de la commande"));
    var desig = v.designation || ("Personnalisation de " + (v.garment || "vêtements"));
    var descParas = [Docx.p(desig, { bold: true, size: 10, after: 0 })];
    if (v.garment) descParas.push(Docx.p(v.garment, { size: 9, color: "666666", after: 0 }));
    body.push(Docx.table({
      widths: [4338, 1300, 2000, 2000],
      rows: [
        { header: true, cells: [
          { text: "Désignation", bold: true, fill: GOLD, color: "0A0A0A" },
          { text: "Quantité", bold: true, fill: GOLD, color: "0A0A0A", align: "center" },
          { text: "Prix unitaire", bold: true, fill: GOLD, color: "0A0A0A", align: "right" },
          { text: "Montant", bold: true, fill: GOLD, color: "0A0A0A", align: "right" }] },
        { cells: [
          { paras: descParas },
          { text: Calc.fmtNum(v.qty), align: "center" },
          { text: Calc.fmtMoney(v.unitPrice), align: "right" },
          { text: Calc.fmtMoney(v.total), align: "right" }] },
        { cells: [
          { text: "TOTAL DU DEVIS", bold: true, span: 3, fill: GOLD_LIGHT, align: "right", size: 11 },
          { text: Calc.fmtMoney(v.total), bold: true, fill: GOLD_LIGHT, align: "right", size: 11 }] }
      ]
    }));
    body.push(Docx.spacer(4));
    body.push(Docx.p("Montants exprimés en francs CFA (FCFA).", { italic: true, size: 9, color: "666666", after: 6 }));

    var services = [];
    if (v.garment) services.push("Fourniture de " + Calc.fmtNum(v.qty) + " vêtement(s) : " + v.garment);
    if (v.logosPerGarment > 0) services.push("Personnalisation par transfert DTF : " + v.logosPerGarment + " logo(s) par vêtement");
    if (v.serigraphie) services.push("Impression par sérigraphie");
    if (services.length) {
      body.push(h2("Prestations incluses"));
      services.forEach(function (s) { body.push(Docx.bullet(s)); });
    }
    if (v.notes) { body.push(h2("Observations")); body.push(Docx.p(v.notes, { size: 10 })); }
    if (v.conditions) { body.push(h2("Conditions")); body.push(Docx.p(v.conditions, { size: 10 })); }

    body.push(Docx.spacer(10));
    body.push(Docx.table({
      widths: [W / 2, W / 2],
      rows: [
        { header: true, cells: [{ text: "Pour MAJESTÉ PRESSE", bold: true, fill: GREY }, { text: "Le client (lu et approuvé)", bold: true, fill: GREY }] },
        { cells: [
          { paras: [Docx.p("Nom, date, signature et cachet :", { size: 9, color: "666666", after: 0 }), Docx.p("", { after: 30 }), Docx.p("", { after: 30 })] },
          { paras: [Docx.p("Nom, date et signature :", { size: 9, color: "666666", after: 0 }), Docx.p("", { after: 30 }), Docx.p("", { after: 30 })] }] }
      ]
    }));

    var bytes = Docx.createDocument({ header: v.header, footerText: "Devis " + (v.ref || "") + " — MAJESTÉ PRESSE", title: "Devis " + (v.ref || ""), body: body });
    return { bytes: bytes, filename: "Devis-" + (slug(v.ref) || slug(v.client) || "client") + ".docx" };
  }

  /* ---------- 2. Fiche interne ---------- */

  function buildInternalDoc(state, res) {
    if (!res || !res.ready) return { error: "Complétez les champs en erreur avant d'exporter la fiche interne." };
    var r = res.r, o = state.order || {}, g = state.garments || {}, d = state.dtf || {};
    var M = Calc.fmtMoney, N = Calc.fmtNum;
    var body = [];
    body.push(Docx.p("Fiche interne de rentabilité", { bold: true, size: 20, color: INK, after: 2 }));
    body.push(Docx.p("DOCUMENT INTERNE — CONFIDENTIEL — NE PAS REMETTRE AU CLIENT", { bold: true, size: 10, color: "9B1C1C", shade: "FDE8E8", after: 8 }));

    body.push(h2("Commande"));
    body.push(kv([
      ["Référence", clean(o.ref, 40) || "—"], ["Date", Calc.fmtDateFr(o.date) || "—"],
      ["Client", clean(o.client, 120) || "—"], ["Désignation", clean(o.designation, 200) || "—"],
      ["Quantité commandée", N(r.qty) + " pièce(s)"],
      ["Prix de vente unitaire", r.salePrice !== null ? M(r.salePrice) : "Non renseigné"]
    ]));
    body.push(Docx.spacer(4));

    body.push(h2("Achat des vêtements"));
    var buy = [["Vêtement", [clean(g.type, 40), clean(g.quality, 60)].filter(Boolean).join(" ") || "—"]];
    if (r.mode === "lot") { buy.push(["Achat par lot", N(r.lots) + " lot(s) de " + N(r.lotSize) + " pièces"]); }
    else buy.push(["Achat", "À l'unité"]);
    buy.push(["Quantité achetée", N(r.bought) + " pièce(s)"]);
    buy.push(["Quantité restante en stock", N(r.remaining) + " pièce(s)"]);
    buy.push(["Coût d'achat des vêtements (hors transport)", M(r.garmentsCost)]);
    buy.push(["Transport lié à l'achat", M(r.purchaseTransport)]);
    body.push(kv(buy));
    body.push(Docx.spacer(4));

    body.push(h2("Personnalisation DTF"));
    if (r.sheetLines.length || r.dtfExtra > 0) {
      body.push(Docx.p("Logos par vêtement : " + (Calc.parseAmount(d.logosPerGarment, {}).value || 0) + " · Logos nécessaires au total : " + N(r.totalLogos || 0), { size: 10 }));
      if (r.sheetLines.length) {
        var rows = [{ header: true, cells: ["Format", "Logos", "Capacité", "Feuilles", "Prix / feuille", "Coût"].map(function (t, i) {
          return { text: t, bold: true, fill: GREY, align: i === 0 ? "left" : "right" };
        }) }];
        r.sheetLines.forEach(function (s) {
          rows.push({ cells: [{ text: s.format }, { text: N(s.logos), align: "right" }, { text: N(s.capacity), align: "right" },
            { text: N(s.sheets), align: "right" }, { text: M(s.price), align: "right" }, { text: M(s.cost), align: "right" }] });
        });
        body.push(Docx.table({ widths: [2300, 1100, 1300, 1300, 1800, 1838], rows: rows }));
      }
      body.push(Docx.p("Autres frais DTF : " + M(r.dtfExtra) + "   ·   Coût total DTF : " + M(r.dtfTotal), { bold: true, size: 10, before: 4 }));
    } else body.push(Docx.p("Aucune personnalisation DTF.", { size: 10, italic: true }));

    body.push(h2("Sérigraphie"));
    if (r.serLines.some(function (l) { return l.amount > 0; })) {
      var srows = [{ header: true, cells: [{ text: "Désignation", bold: true, fill: GREY }, { text: "Nature", bold: true, fill: GREY }, { text: "Montant", bold: true, fill: GREY, align: "right" }] }];
      r.serLines.forEach(function (l) { srows.push({ cells: [{ text: l.label }, { text: KIND_LABELS[l.kind] || "Autre" }, { text: M(l.amount), align: "right" }] }); });
      body.push(Docx.table({ widths: [5238, 2400, 2000], rows: srows }));
      body.push(Docx.p("Coût total de sérigraphie : " + M(r.serTotal), { bold: true, size: 10, before: 4 }));
    } else body.push(Docx.p("Aucune dépense de sérigraphie saisie.", { size: 10, italic: true }));

    body.push(h2("Autres dépenses"));
    if (r.otherLines.some(function (l) { return l.amount > 0; })) {
      var orows = [{ header: true, cells: [{ text: "Désignation", bold: true, fill: GREY }, { text: "Montant", bold: true, fill: GREY, align: "right" }] }];
      r.otherLines.forEach(function (l) { orows.push({ cells: [{ text: l.label }, { text: M(l.amount), align: "right" }] }); });
      body.push(Docx.table({ widths: [7638, 2000], rows: orows }));
      body.push(Docx.p("Total des autres dépenses : " + M(r.otherTotal), { bold: true, size: 10, before: 4 }));
    } else body.push(Docx.p("Aucune autre dépense saisie.", { size: 10, italic: true }));

    body.push(h2("Synthèse financière (estimation)"));
    var methodLabel = r.method === "prorata"
      ? "Prorata : les vêtements restants en stock ne sont pas comptés comme consommés par cette commande."
      : "Prudente : toutes les dépenses sont imputées à la commande, le stock restant n'est pas valorisé.";
    var synth = [
      ["1. Coût d'achat total des vêtements (hors transport)", M(r.garmentsCost)],
      ["2. Vêtements imputés à la quantité commandée (achat + transport d'achat)", M(r.garmentsAllocated)],
      ["3. Valeur des pièces restantes en stock", M(r.stockValue)],
      ["4. Coût total DTF", M(r.dtfTotal)],
      ["5. Coût total de sérigraphie", M(r.serTotal)],
      ["6. Total des autres dépenses", M(r.otherTotal)],
      ["7. Coût total décaissé pour la commande", M(r.totalCash), true],
      ["8. Coût total imputé à la quantité livrée", M(r.imputedCost), true],
      ["9. Chiffre d'affaires prévisionnel", r.revenue !== null ? M(r.revenue) : "—"],
      ["10. Bénéfice prévisionnel (estimation)", r.profit !== null ? M(r.profit) : "—", true],
      ["11. Marge bénéficiaire", r.margin !== null ? Calc.fmtPct(r.margin) : "—"],
      ["12. Coût de revient unitaire (imputé)", M(r.unitCost)],
      ["13. Prix de revient unitaire (tout le décaissé ÷ pièces livrées)", M(r.unitCash)],
      ["14. Prix de vente minimal (seuil de rentabilité)", M(r.breakEvenPrice)],
      ["15. Prix de vente conseillé", r.recommended !== null ? M(r.recommended) : "—"],
      ["16. Bénéfice estimé par vêtement", r.profitPerGarment !== null ? M(r.profitPerGarment) : "—"]
    ];
    body.push(Docx.table({ widths: [6838, 2800], rows: synth.map(function (s) {
      return { cells: [{ text: s[0], bold: !!s[2], fill: s[2] ? GOLD_LIGHT : undefined }, { text: s[1], align: "right", bold: !!s[2], fill: s[2] ? GOLD_LIGHT : undefined }] };
    }) }));
    body.push(Docx.spacer(4));
    if (r.cashDiff !== null) {
      body.push(Docx.p("Trésorerie dégagée (chiffre d'affaires − dépenses décaissées) : " + M(r.cashDiff), { bold: true, size: 10.5 }));
      if (r.method === "prorata") {
        body.push(Docx.p("Bénéfice imputé (" + M(r.profit) + ") = trésorerie dégagée (" + M(r.cashDiff) + ") + valeur du stock restant (" + M(r.stockValue) + ").", { size: 10 }));
      }
    }
    body.push(Docx.p("Méthode utilisée : " + methodLabel, { size: 10 }));

    if (res.warnings.length) {
      body.push(h2("Points d'attention"));
      res.warnings.forEach(function (w) { body.push(Docx.bullet(w)); });
    }
    body.push(Docx.spacer(6));
    body.push(Docx.p("Ces chiffres sont des estimations fondées sur les dépenses saisies. Ils ne remplacent pas votre comptabilité : d'autres frais peuvent exister (loyer, temps de travail non saisi, pertes, impôts).", { italic: true, size: 9, color: "666666" }));

    var bytes = Docx.createDocument({ header: headerOf(state), footerText: "Fiche interne — confidentiel", title: "Fiche interne de rentabilité " + (clean(o.ref, 40)), body: body });
    return { bytes: bytes, filename: "Fiche-interne-" + (slug(o.ref) || slug(o.client) || "commande") + ".docx" };
  }

  return { clientView: clientView, buildClientDoc: buildClientDoc, buildInternalDoc: buildInternalDoc };
});
