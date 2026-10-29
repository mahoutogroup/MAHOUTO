/* =========================================================
   MAHOUTO+ / MAJESTÉ PRESSE — Calculateur de devis et de bénéfice
   Moteur de calcul : fonctions pures, sans accès au DOM,
   sans réseau et sans Supabase. Utilisé par
   admin/serigraphie-calculateur.html et testé sous Node.

   Tous les montants sont en FCFA. Aucune donnée n'est stockée.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SerigraphieCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Saisie ---------- */

  // Lit un nombre saisi par l'utilisateur ("11 000", "11000", "2,5").
  // Retourne { empty, value, error }.
  function parseAmount(raw, opts) {
    opts = opts || {};
    if (raw === null || raw === undefined) return { empty: true, value: null, error: null };
    if (typeof raw === "number") {
      if (!isFinite(raw)) return { empty: false, value: null, error: "Nombre invalide." };
      raw = String(raw);
    }
    var s = String(raw).replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
    if (s === "") return { empty: true, value: null, error: null };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { empty: false, value: null, error: "Nombre invalide." };
    var v = Number(s);
    if (!isFinite(v)) return { empty: false, value: null, error: "Nombre invalide." };
    if (v < 0) return { empty: false, value: null, error: "Une valeur négative n'est pas autorisée." };
    if (opts.integer && Math.floor(v) !== v) return { empty: false, value: null, error: "Entrez un nombre entier." };
    if (opts.min !== undefined && v < opts.min) {
      return { empty: false, value: null, error: "La valeur doit être au moins " + opts.min + "." };
    }
    if (opts.max !== undefined && v > opts.max) {
      return { empty: false, value: null, error: "La valeur doit être au plus " + opts.max + "." };
    }
    return { empty: false, value: v, error: null };
  }

  /* ---------- Affichage ---------- */

  // Formate un nombre entier avec espaces insécables ("1 500"). Jamais NaN/Infinity.
  function fmtNum(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    var r = Math.round(n);
    if (r === 0) r = 0; // évite « -0 »
    var neg = r < 0;
    var s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
    return (neg ? "−" : "") + s;
  }
  function fmtMoney(n) {
    var s = fmtNum(n);
    return s === "—" ? s : s + "\u00A0FCFA";
  }
  function fmtPct(p) {
    if (typeof p !== "number" || !isFinite(p)) return "—";
    return (Math.round(p * 10) / 10).toString().replace(".", ",") + "\u00A0%";
  }

  /* ---------- Calcul principal ---------- */

  var DEFAULTS = {
    order: { client: "", phone: "", ref: "", date: "", designation: "", qty: "", unitPrice: "", notes: "", conditions: "", contact: "" },
    garments: { type: "T-shirt", quality: "", mode: "lot", unitPrice: "", lotPrice: "", lotSize: "12", boughtQty: "", transport: "" },
    dtf: { logosPerGarment: "0", personalizeQty: "", spareLogos: "", extraFees: "", sheets: [{ format: "A4", capacity: "", price: "", logos: "" }] },
    serigraphie: [{ label: "Consommables (encre, émulsion, solvant…)", kind: "consommable", amount: "" }],
    other: [
      { label: "Livraison", amount: "" },
      { label: "Emballage", amount: "" },
      { label: "Électricité / frais de production", amount: "" },
      { label: "Commission", amount: "" }
    ],
    target: { mode: "margin", value: "30" },
    method: "prorata",
    roundTo: "25"
  };

  function ceilDiv(a, b) { return Math.ceil(a / b - 1e-9); }

  /**
   * compute(state) -> {
   *   ready: bool,        // true si tous les calculs essentiels sont possibles
   *   errors: { chemin: message },
   *   warnings: [message],
   *   r: { ...résultats, null si non calculable }
   * }
   */
  function compute(state) {
    var errors = {};
    var warnings = [];
    var r = {};
    function pa(path, raw, opts) {
      var p = parseAmount(raw, opts);
      if (p.error) errors[path] = p.error;
      return p;
    }

    var o = state.order || {}, g = state.garments || {}, d = state.dtf || {};

    /* ---- A. Commande ---- */
    var qtyP = pa("order.qty", o.qty, { integer: true, min: 1 });
    if (qtyP.empty) errors["order.qty"] = "Indiquez la quantité de vêtements.";
    var qty = qtyP.value;
    var priceP = pa("order.unitPrice", o.unitPrice, {});
    var salePrice = priceP.value; // null si vide

    /* ---- B. Achat des vêtements ---- */
    var mode = g.mode === "unit" ? "unit" : "lot";
    var gTransportP = pa("garments.transport", g.transport, {});
    var gTransport = gTransportP.value || 0;
    var boughtP = pa("garments.boughtQty", g.boughtQty, { integer: true, min: 1 });
    var bought = null, lots = null, garmentsCost = null, lotSize = null;

    if (mode === "lot") {
      var lotPriceP = pa("garments.lotPrice", g.lotPrice, {});
      var lotSizeP = pa("garments.lotSize", g.lotSize, { integer: true, min: 1 });
      if (lotSizeP.empty) errors["garments.lotSize"] = "Indiquez le nombre de pièces par lot.";
      lotSize = lotSizeP.value;
      if (qty && lotSize && !errors["order.qty"] && !errors["garments.lotSize"] && !errors["garments.boughtQty"]) {
        var piecesWanted = qty;
        if (boughtP.value !== null) {
          if (boughtP.value < qty) {
            errors["garments.boughtQty"] = "La quantité achetée ne peut pas être inférieure à la quantité commandée.";
          } else piecesWanted = boughtP.value;
        }
        if (!errors["garments.boughtQty"]) {
          lots = ceilDiv(piecesWanted, lotSize);
          bought = lots * lotSize;
          if (boughtP.value !== null && bought !== boughtP.value) {
            warnings.push("Achat par lots de " + lotSize + " : " + boughtP.value + " pièces demandées, " + bought + " pièces achetées (" + lots + " lot(s)).");
          }
          if (lotPriceP.empty) warnings.push("Aucun prix de lot saisi : le coût des vêtements est compté à 0 FCFA.");
          garmentsCost = lots * (lotPriceP.value || 0);
        }
      }
    } else {
      var unitP = pa("garments.unitPrice", g.unitPrice, {});
      if (qty && !errors["order.qty"] && !errors["garments.boughtQty"]) {
        if (boughtP.value !== null && boughtP.value < qty) {
          errors["garments.boughtQty"] = "La quantité achetée ne peut pas être inférieure à la quantité commandée.";
        } else {
          bought = boughtP.value !== null ? boughtP.value : qty;
          if (unitP.empty) warnings.push("Aucun prix d'achat saisi : le coût des vêtements est compté à 0 FCFA.");
          garmentsCost = bought * (unitP.value || 0);
        }
      }
    }
    var remaining = bought !== null && qty ? bought - qty : null;

    /* ---- C. DTF ---- */
    var logosPerP = pa("dtf.logosPerGarment", d.logosPerGarment, { integer: true, min: 0 });
    var logosPer = logosPerP.empty ? 0 : logosPerP.value;
    var persoP = pa("dtf.personalizeQty", d.personalizeQty, { integer: true, min: 0 });
    var persoQty = persoP.empty ? qty : persoP.value;
    var spareP = pa("dtf.spareLogos", d.spareLogos, { integer: true, min: 0 });
    var spare = spareP.value || 0;
    var dtfExtraP = pa("dtf.extraFees", d.extraFees, {});
    var dtfExtra = dtfExtraP.value || 0;

    var totalLogos = null, dtfSheetsCost = 0, dtfSheetsTotal = 0, sheetLines = [];
    if (persoQty !== null && persoQty !== undefined && !errors["dtf.logosPerGarment"] && !errors["dtf.personalizeQty"] && !errors["dtf.spareLogos"]) {
      totalLogos = persoQty * logosPer + (logosPer > 0 ? spare : 0);
      if (bought !== null && persoQty > bought) {
        errors["dtf.personalizeQty"] = "On ne peut pas personnaliser plus de vêtements que ceux achetés (" + bought + ").";
      }
    }
    if (totalLogos > 0 && !errors["dtf.personalizeQty"]) {
      var sheets = d.sheets || [];
      var parsed = sheets.map(function (s, i) {
        var base = "dtf.sheets." + i + ".";
        var cap = pa(base + "capacity", s.capacity, { integer: true, min: 1 });
        var price = pa(base + "price", s.price, {});
        var lg = pa(base + "logos", s.logos, { integer: true, min: 0 });
        if (cap.empty) errors[base + "capacity"] = "Indiquez combien de logos tiennent sur cette feuille.";
        return { format: s.format || ("Feuille " + (i + 1)), cap: cap.value, price: price.value || 0, logosExplicit: lg.empty ? null : lg.value, idx: i };
      });
      if (!sheets.length) errors["dtf.sheets"] = "Ajoutez au moins un format de feuille DTF.";
      var explicitSum = parsed.reduce(function (a, s) { return a + (s.logosExplicit || 0); }, 0);
      var blank = parsed.filter(function (s) { return s.logosExplicit === null; });
      var remainder = totalLogos - explicitSum;
      if (remainder < 0) {
        errors["dtf.sheets"] = "Vous avez réparti " + explicitSum + " logos, alors que " + totalLogos + " sont nécessaires.";
      } else if (!blank.length && remainder > 0) {
        errors["dtf.sheets"] = remainder + " logo(s) ne sont attribués à aucune feuille. Laissez une ligne vide pour recevoir le reste.";
      } else if (blank.length > 1) {
        warnings.push("Plusieurs formats sans nombre de logos : le premier reçoit tous les logos restants, les autres reçoivent 0.");
      }
      if (!errors["dtf.sheets"]) {
        var firstBlank = true;
        parsed.forEach(function (s) {
          var alloc = s.logosExplicit;
          if (alloc === null) { alloc = firstBlank ? remainder : 0; firstBlank = false; }
          var nbSheets = 0, cost = 0;
          if (alloc > 0 && s.cap) { nbSheets = ceilDiv(alloc, s.cap); cost = nbSheets * s.price; }
          sheetLines.push({ format: s.format, capacity: s.cap, price: s.price, logos: alloc, sheets: nbSheets, cost: cost });
          dtfSheetsTotal += nbSheets;
          dtfSheetsCost += cost;
        });
      }
    }
    var dtfTotal = null;
    var dtfBlocked = Object.keys(errors).some(function (k) { return k.indexOf("dtf.") === 0; });
    if (!dtfBlocked) dtfTotal = dtfSheetsCost + dtfExtra;

    /* ---- D. Sérigraphie ---- */
    var serLines = [], serTotal = 0, serHasSub = false, serHasCons = false;
    (state.serigraphie || []).forEach(function (l, i) {
      var p = pa("serigraphie." + i + ".amount", l.amount, {});
      var amt = p.value || 0;
      serTotal += amt;
      if (amt > 0 && l.kind === "soustraitance") serHasSub = true;
      if (amt > 0 && l.kind === "consommable") serHasCons = true;
      serLines.push({ label: l.label || "Dépense", kind: l.kind || "autre", amount: amt });
    });
    if (serHasSub && serHasCons) {
      warnings.push("Sous-traitance et consommables sont tous deux renseignés : vérifiez que vous ne comptez pas deux fois la même dépense (le sous-traitant facture souvent ses consommables).");
    }

    /* ---- E. Autres dépenses ---- */
    var otherLines = [], otherTotal = 0;
    (state.other || []).forEach(function (l, i) {
      var p = pa("other." + i + ".amount", l.amount, {});
      var amt = p.value || 0;
      otherTotal += amt;
      otherLines.push({ label: l.label || "Dépense", amount: amt });
    });

    /* ---- Objectif ---- */
    var t = state.target || {};
    var tmode = t.mode === "total" || t.mode === "perGarment" ? t.mode : "margin";
    var tP = pa("target.value", t.value, tmode === "margin" ? { min: 0, max: 99.9 } : {});
    var roundToP = pa("roundTo", state.roundTo, { integer: true, min: 1 });
    var roundTo = roundToP.value || 1;

    /* ---- Résultats ---- */
    var ready = !errors["order.qty"] && qty !== null && garmentsCost !== null && dtfTotal !== null && Object.keys(errors).length === 0;

    r.qty = qty;
    r.mode = mode;
    r.lots = lots;
    r.lotSize = lotSize;
    r.bought = bought;
    r.remaining = remaining;
    r.garmentsCost = garmentsCost;                 // 1. coût d'achat des vêtements (hors transport)
    r.purchaseTransport = gTransport;
    r.totalLogos = totalLogos;
    r.sheetLines = sheetLines;
    r.dtfSheets = dtfSheetsTotal;
    r.dtfExtra = dtfExtra;
    r.dtfTotal = dtfTotal;                         // 4
    r.serLines = serLines;
    r.serTotal = serTotal;                         // 5
    r.otherLines = otherLines;
    r.otherTotal = otherTotal;                     // 6

    var method = state.method === "full" ? "full" : "prorata";
    r.method = method;

    if (ready) {
      var acq = garmentsCost + gTransport;          // coût d'acquisition des vêtements
      r.acquisition = acq;
      r.totalCash = acq + dtfTotal + serTotal + otherTotal; // 7. total décaissé
      var allocatedAcq, stockValue;
      if (method === "prorata") {
        allocatedAcq = acq * qty / bought;          // 2. vêtements correspondant à la quantité commandée
        stockValue = acq - allocatedAcq;            // 3. valeur du stock restant
      } else {
        allocatedAcq = acq;
        stockValue = 0;
      }
      r.garmentsAllocated = allocatedAcq;
      r.stockValue = stockValue;
      r.imputedCost = allocatedAcq + dtfTotal + serTotal + otherTotal; // 8
      r.unitCost = r.imputedCost / qty;             // 12. coût de revient unitaire
      r.unitCash = r.totalCash / qty;               // 13. prix de revient unitaire (tout décaissé / pièces livrées)
      r.breakEvenPrice = r.unitCost;                // 14. seuil de rentabilité
      r.breakEvenCashPrice = r.unitCash;

      if (salePrice !== null && !errors["order.unitPrice"]) {
        r.salePrice = salePrice;
        r.revenue = salePrice * qty;                // 9
        r.profit = r.revenue - r.imputedCost;       // 10
        r.margin = r.revenue > 0 ? r.profit / r.revenue * 100 : null; // 11
        r.profitPerGarment = r.profit / qty;        // 16
        r.cashDiff = r.revenue - r.totalCash;       // trésorerie dégagée
        if (salePrice < r.unitCost) {
          warnings.push("Le prix de vente (" + fmtMoney(salePrice) + ") est inférieur au coût de revient (" + fmtMoney(r.unitCost) + ") : la commande est déficitaire.");
        } else if (salePrice < r.unitCash) {
          warnings.push("Le prix de vente est inférieur à tout ce que vous décaissez par pièce livrée (" + fmtMoney(r.unitCash) + ") : la trésorerie sera négative tant que les pièces restantes ne sont pas vendues.");
        }
      } else {
        r.salePrice = null; r.revenue = null; r.profit = null; r.margin = null; r.profitPerGarment = null; r.cashDiff = null;
      }

      // 15. Prix conseillé selon l'objectif choisi (un seul objectif à la fois)
      r.targetMode = tmode;
      r.recommendedRaw = null; r.recommended = null;
      if (!errors["target.value"] && !tP.empty) {
        var raw;
        if (tmode === "margin") raw = r.unitCost / (1 - tP.value / 100);
        else if (tmode === "perGarment") raw = r.unitCost + tP.value;
        else raw = (r.imputedCost + tP.value) / qty;
        if (isFinite(raw)) {
          r.recommendedRaw = raw;
          r.recommended = Math.ceil(raw / roundTo - 1e-9) * roundTo;
          r.recommendedRevenue = r.recommended * qty;
          r.recommendedProfit = r.recommendedRevenue - r.imputedCost;
          r.recommendedMargin = r.recommendedRevenue > 0 ? r.recommendedProfit / r.recommendedRevenue * 100 : null;
          r.recommendedProfitPerGarment = r.recommendedProfit / qty;
        }
      }
      r.roundTo = roundTo;
    }

    return { ready: ready, errors: errors, warnings: warnings, r: r };
  }

  /** Date « 2026-10-28 » -> « 28/10/2026 » ; sinon renvoie le texte tel quel. */
  function fmtDateFr(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || "");
  }

  return {
    DEFAULTS: DEFAULTS,
    parseAmount: parseAmount,
    compute: compute,
    fmtNum: fmtNum,
    fmtMoney: fmtMoney,
    fmtPct: fmtPct,
    fmtDateFr: fmtDateFr
  };
});
