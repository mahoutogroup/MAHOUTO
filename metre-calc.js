/* =========================================================
   MAHOUTO+ — Métré construction (estimation de matériaux et de budget)
   Moteur de calcul : fonctions pures, sans accès au DOM, sans réseau
   et sans Supabase. Utilisé par metre.html et testé sous Node.

   Tous les montants sont en FCFA, toutes les dimensions saisies en cm.
   Ce sont des ESTIMATIONS : elles ne remplacent ni le plan d'un technicien,
   ni l'avis d'un maçon ou d'un ingénieur pour les fondations et la charpente.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MetreCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Saisie ---------- */

  // Lit un nombre saisi ("1 200", "1200", "2,5"). Retourne { empty, value, error }.
  function parseNum(raw, opts) {
    opts = opts || {};
    if (raw === null || raw === undefined) return { empty: true, value: null, error: null };
    if (typeof raw === "number") {
      if (!isFinite(raw)) return { empty: false, value: null, error: "Nombre invalide." };
      raw = String(raw);
    }
    var s = String(raw).replace(/[\s  ]/g, "").replace(",", ".");
    if (s === "") return { empty: true, value: null, error: null };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { empty: false, value: null, error: "Nombre invalide." };
    var v = Number(s);
    if (!isFinite(v)) return { empty: false, value: null, error: "Nombre invalide." };
    if (v < 0) return { empty: false, value: null, error: "Une valeur négative n'est pas autorisée." };
    if (opts.integer && Math.floor(v) !== v) return { empty: false, value: null, error: "Entrez un nombre entier." };
    if (opts.min !== undefined && v < opts.min) return { empty: false, value: null, error: "La valeur doit être au moins " + opts.min + "." };
    if (opts.max !== undefined && v > opts.max) return { empty: false, value: null, error: "La valeur doit être au plus " + opts.max + "." };
    return { empty: false, value: v, error: null };
  }

  /* ---------- Affichage ---------- */

  function fmtNum(n, decimals) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    var d = decimals || 0;
    var f = Math.pow(10, d);
    var r = Math.round(n * f) / f;
    if (r === 0) r = 0; // évite « -0 »
    var neg = r < 0;
    var parts = Math.abs(r).toFixed(d).split(".");
    var s = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (d > 0) s += "," + parts[1];
    return (neg ? "−" : "") + s;
  }
  function fmtMoney(n) {
    var s = fmtNum(n, 0);
    return s === "—" ? s : s + " FCFA";
  }

  /* ---------- Hypothèses par défaut (modifiables dans la page) ---------- */

  var DEFAULTS = {
    rooms: [
      { name: "Salon", type: "salon", length: "600", tiled: false },
      { name: "Chambre", type: "chambre", length: "300", tiled: false },
      { name: "Cuisine", type: "cuisine", length: "300", tiled: true }
    ],
    depth: "400",            // profondeur du bâtiment, extérieur (cm)
    wallHeight: "210",       // hauteur des murs au-dessus du sol (cm)
    blockThickness: "15",    // épaisseur du parpaing : 15 ou 20 cm
    blockLength: "40",
    blockHeight: "20",
    jointLength: "2",        // joint vertical (cm)
    jointHeight: "1",        // joint horizontal (cm)
    breakage: "8",           // casse et pertes de parpaings (%)
    foundationDepth: "80",   // profondeur de la tranchée (cm)
    footingWidth: "40",      // largeur de la semelle (cm)
    footingThickness: "20",  // épaisseur de la semelle (cm)
    baseRows: "3",           // rangs de parpaings du soubassement
    postSpacing: "300",      // espacement approximatif des poteaux (cm)
    slabThickness: "10",     // épaisseur de la dalle de sol (cm)
    doors: "3", doorW: "90", doorH: "200",
    windows: "4", windowW: "120", windowH: "120",
    plaster: true,           // enduit sur les deux faces des murs
    plasterThickness: "1.5", // cm
    roofType: "tole",        // "tole" ou "dalle"
    roofOverhang: "40",      // débord de toit (cm)
    roofSlope: "10",         // pente (%)
    sockets: "10", switches: "4", lights: "4",
    pvcLength: "10",         // évacuation de la cuisine (m)
    fill: "0",               // remblai (m³), à saisir si le sol doit être surélevé
    bulkMargin: "5",         // marge sur ciment, sable et gravier (%)
    contingency: "10"        // imprévus sur le budget (%)
  };

  /* ---------- Constantes de dosage et de pose ---------- */

  var BAG_KG = 50;
  var CONCRETE = { cementKg: 350, sand: 0.45, gravel: 0.8 };   // par m³ de béton
  var MORTAR = { cementKg: 300, sand: 1.1 };                   // par m³ de mortier
  var PLASTER = { cementKg: 350, sand: 1.1 };                  // par m³ d'enduit ou de chape
  var BAR_LENGTH = 12;       // m, barre de fer commerciale
  var BAR_WASTE = 1.10;      // recouvrements et chutes
  var LASHING_KG_PER_100M = 1.0;
  var CABLE_PER_POINT = 8;   // m de câble 2,5 mm par point (prise, interrupteur, lumière)
  var SCREWS_PER_M2 = 8;
  var SHEET_OVERLAP = 1.10;
  var SLAB_ROOF_STEEL = 20;  // m de fer de 8 mm par m² de dalle de toiture
  var SLAB_ROOF_THICKNESS = 0.12;
  var TILE_WASTE = 1.10;
  var TILE_GLUE_KG_PER_M2 = 5;
  var GLUE_BAG_KG = 25;
  var SCREED_THICKNESS = 0.03;
  var MAX_SPAN_TOLE_CM = 400; // au-delà, une charpente légère demande des appuis ou des fermes

  /* ---------- Calcul ---------- */

  function ceilTo(x, step) { return Math.ceil(x / step - 1e-9) * step; }
  function ceilInt(x) { return Math.ceil(x - 1e-9); }

  function validate(s) {
    var errors = {};
    var v = {};
    // Champs que l'on peut laisser vides : ils comptent alors pour 0.
    var OPTIONAL = {
      jointLength: 1, jointHeight: 1, breakage: 1, baseRows: 1, doors: 1, windows: 1,
      roofOverhang: 1, roofSlope: 1, sockets: 1, switches: 1, lights: 1,
      pvcLength: 1, fill: 1, bulkMargin: 1, contingency: 1
    };
    function num(key, label, opts) {
      var p = parseNum(s[key], opts);
      if (p.empty && OPTIONAL[key]) { v[key] = 0; return; }
      if (p.empty) { errors[key] = label + " : à renseigner."; return; }
      if (p.error) { errors[key] = p.error; return; }
      v[key] = p.value;
    }

    var rooms = Array.isArray(s.rooms) ? s.rooms : [];
    if (rooms.length < 1) errors.rooms = "Ajoutez au moins une pièce.";
    if (rooms.length > 12) errors.rooms = "12 pièces au maximum.";
    v.rooms = [];
    rooms.forEach(function (rm, i) {
      var p = parseNum(rm && rm.length, { min: 150, max: 2500 });
      if (p.empty) errors["rooms." + i + ".length"] = "Longueur à renseigner.";
      else if (p.error) errors["rooms." + i + ".length"] = p.error;
      else v.rooms.push({
        name: String((rm && rm.name) || "").slice(0, 60),
        type: String((rm && rm.type) || "autre"),
        length: p.value,
        tiled: !!(rm && rm.tiled)
      });
    });

    num("depth", "Profondeur", { min: 150, max: 2000 });
    num("wallHeight", "Hauteur des murs", { min: 200, max: 400 });
    var bt = parseNum(s.blockThickness);
    if (bt.empty || bt.error || (bt.value !== 10 && bt.value !== 15 && bt.value !== 20)) errors.blockThickness = "Choisissez 10, 15 ou 20 cm.";
    else v.blockThickness = bt.value;
    num("blockLength", "Longueur du parpaing", { min: 20, max: 60 });
    num("blockHeight", "Hauteur du parpaing", { min: 10, max: 30 });
    num("jointLength", "Joint vertical", { max: 5 });
    num("jointHeight", "Joint horizontal", { max: 5 });
    num("breakage", "Casse", { max: 30 });
    num("foundationDepth", "Profondeur des fondations", { min: 30, max: 200 });
    num("footingWidth", "Largeur de la semelle", { min: 20, max: 100 });
    num("footingThickness", "Épaisseur de la semelle", { min: 10, max: 50 });
    num("baseRows", "Rangs de soubassement", { integer: true, max: 10 });
    num("postSpacing", "Espacement des poteaux", { min: 150, max: 600 });
    num("slabThickness", "Épaisseur de la dalle de sol", { min: 5, max: 30 });
    num("doors", "Portes", { integer: true, max: 30 });
    num("doorW", "Largeur de porte", { min: 60, max: 200 });
    num("doorH", "Hauteur de porte", { min: 150, max: 300 });
    num("windows", "Fenêtres", { integer: true, max: 40 });
    num("windowW", "Largeur de fenêtre", { min: 40, max: 300 });
    num("windowH", "Hauteur de fenêtre", { min: 40, max: 250 });
    num("plasterThickness", "Épaisseur d'enduit", { min: 0.5, max: 5 });
    if (s.roofType !== "tole" && s.roofType !== "dalle") errors.roofType = "Choisissez tôle ou dalle.";
    else v.roofType = s.roofType;
    num("roofOverhang", "Débord de toit", { max: 150 });
    num("roofSlope", "Pente", { max: 60 });
    num("sockets", "Prises", { integer: true, max: 100 });
    num("switches", "Interrupteurs", { integer: true, max: 100 });
    num("lights", "Points lumineux", { integer: true, max: 100 });
    num("pvcLength", "Tuyau PVC", { max: 200 });
    num("fill", "Remblai", { max: 500 });
    num("bulkMargin", "Marge", { max: 30 });
    num("contingency", "Imprévus", { max: 50 });
    v.plaster = !!s.plaster;
    return { errors: errors, v: v };
  }

  function compute(state) {
    var val = validate(state || {});
    if (Object.keys(val.errors).length) return { ready: false, errors: val.errors, r: null, lines: [], warnings: [] };
    var v = val.v;
    var warnings = [];

    // --- Géométrie (mètres) ---
    var n = v.rooms.length;
    var totalLen = v.rooms.reduce(function (a, rm) { return a + rm.length; }, 0);
    var L = totalLen / 100, D = v.depth / 100, H = v.wallHeight / 100, e = v.blockThickness / 100;
    var extLen = 2 * (L + D);
    var partLen = (n - 1) * D;
    var wallLen = extLen + partLen;
    var blockPitch = (v.blockLength + v.jointLength) / 100;
    var rowPitch = (v.blockHeight + v.jointHeight) / 100;
    var density = 1 / (blockPitch * rowPitch);
    var grossArea = wallLen * H;
    var openArea = v.doors * (v.doorW / 100) * (v.doorH / 100) + v.windows * (v.windowW / 100) * (v.windowH / 100);
    var netArea = grossArea - openArea;
    if (netArea <= 0) return { ready: false, errors: { doors: "Les ouvertures dépassent la surface des murs." }, r: null, lines: [], warnings: [] };

    // --- Parpaings ---
    var blocksWalls = netArea * density;
    var blocksBase = (wallLen / blockPitch) * v.baseRows;
    var blocks = ceilInt((blocksWalls + blocksBase) * (1 + v.breakage / 100));

    // --- Béton (m³) ---
    var fd = v.foundationDepth / 100;
    var footing = wallLen * (v.footingWidth / 100) * (v.footingThickness / 100);
    var innerArea = Math.max(0, (L - 2 * e) * (D - 2 * e) - (n - 1) * e * (D - 2 * e));
    var slab = innerArea * (v.slabThickness / 100);
    var ties = 2 * wallLen * e * 0.20;                      // chaînage bas + haut : section épaisseur × 20 cm
    var posts = ceilInt(wallLen / (v.postSpacing / 100));
    if (posts < 4) posts = 4;
    var postVol = posts * e * e * (H + fd);
    var lintels = (v.doors * (v.doorW / 100 + 0.4) + v.windows * (v.windowW / 100 + 0.4)) * e * 0.20;
    var concrete = (footing + slab + ties + postVol + lintels) * 1.05;   // 5 % de pertes

    // --- Toiture (tôle ou dalle) ---
    var roofArea = 0, roofSlabConcrete = 0, roofSlabSteel = 0;
    var sheetArea = 0, screws = 0, rafterM = 0, purlinM = 0, rafters = 0, purlinRows = 0;
    var overhang = v.roofOverhang / 100;
    var roofL = L + 2 * overhang, roofD = D + 2 * overhang;
    var slopeFactor = Math.sqrt(1 + Math.pow(v.roofSlope / 100, 2));
    if (v.roofType === "tole") {
      roofArea = roofL * roofD * slopeFactor;
      sheetArea = ceilInt(roofArea * SHEET_OVERLAP);
      screws = ceilInt(roofArea * SCREWS_PER_M2);
      rafters = ceilInt(roofL / 0.6) + 1;
      rafterM = rafters * roofD * slopeFactor;
      purlinRows = ceilInt(roofD / 1.0) + 1;
      purlinM = purlinRows * roofL;
      var maxSpan = Math.max.apply(null, v.rooms.map(function (rm) { return rm.length; }));
      if (maxSpan > MAX_SPAN_TOLE_CM) {
        warnings.push("Une pièce mesure " + fmtNum(maxSpan / 100, 1) + " m de long : la charpente demande des appuis intermédiaires ou des fermes. Faites-la calculer par un charpentier.");
      }
    } else {
      roofArea = roofL * roofD;
      roofSlabConcrete = roofArea * SLAB_ROOF_THICKNESS * 1.05;
      roofSlabSteel = roofArea * SLAB_ROOF_STEEL;
      concrete += roofSlabConcrete;
      warnings.push("Une dalle de toiture demande un coffrage, des étais et un calcul de structure : faites-la valider par un ingénieur ou un technicien.");
    }

    // --- Mortier de pose et enduit ---
    var laidArea = netArea + wallLen * v.baseRows * rowPitch;
    var mortar = laidArea * e * 0.13;                       // joints + pertes
    var plasterVol = v.plaster ? 2 * netArea * (v.plasterThickness / 100) : 0;

    // --- Carrelage (pièces cochées) et chape ---
    var tileNet = 0;
    v.rooms.forEach(function (rm) {
      if (rm.tiled) tileNet += Math.max(0, (rm.length / 100 - e) * (D - 2 * e));
    });
    var tileArea = tileNet * TILE_WASTE;
    var screed = tileNet * SCREED_THICKNESS;
    var glueBags = tileNet > 0 ? ceilInt(tileNet * TILE_GLUE_KG_PER_M2 / GLUE_BAG_KG) : 0;

    // --- Fer ---
    var steel8 = 2 * wallLen * 4 + posts * (H + fd) * 4 + wallLen * 3 + roofSlabSteel;
    var stirrupTie = 2 * (v.blockThickness + 10) / 100;     // périmètre d'un cadre de chaînage
    var stirrupPost = 4 * (e - 0.05);
    var steel6 = (2 * wallLen / 0.20) * stirrupTie + posts * ((H + fd) / 0.20) * stirrupPost;
    var bars8 = ceilInt(steel8 * BAR_WASTE / BAR_LENGTH);
    var bars6 = ceilInt(steel6 * BAR_WASTE / BAR_LENGTH);
    var lashing = ceilInt((steel8 + steel6) / 100 * LASHING_KG_PER_100M);

    // --- Ciment, sable, gravier ---
    var bulk = 1 + v.bulkMargin / 100;
    var cementBagsRaw =
      concrete * CONCRETE.cementKg / BAG_KG +
      mortar * MORTAR.cementKg / BAG_KG +
      (plasterVol + screed) * PLASTER.cementKg / BAG_KG;
    var cementBags = ceilInt(cementBagsRaw * bulk);
    var sandRaw = concrete * CONCRETE.sand + mortar * MORTAR.sand + (plasterVol + screed) * PLASTER.sand;
    var sand = ceilTo(sandRaw * bulk, 0.5);
    var gravel = ceilTo(concrete * CONCRETE.gravel * bulk, 0.5);

    // --- Électricité ---
    var points = v.sockets + v.switches + v.lights;
    var cable = ceilTo(points * CABLE_PER_POINT, 10);

    // --- Cuisine ---
    var hasKitchen = v.rooms.some(function (rm) { return rm.type === "cuisine"; });

    var r = {
      totalLength: totalLen, depth: v.depth, rooms: n,
      footprint: L * D, innerArea: innerArea,
      wallLength: wallLen, grossArea: grossArea, openArea: openArea, netArea: netArea,
      density: density, blocksWalls: blocksWalls, blocksBase: blocksBase, blocks: blocks,
      concrete: concrete,
      concreteParts: { footing: footing, slab: slab, ties: ties, posts: postVol, lintels: lintels, roofSlab: roofSlabConcrete },
      postCount: posts, mortar: mortar, plaster: plasterVol, screed: screed,
      steel8: steel8, steel6: steel6, bars8: bars8, bars6: bars6, lashing: lashing,
      cementBags: cementBags, sand: sand, gravel: gravel,
      roofArea: roofArea, sheetArea: sheetArea, screws: screws,
      rafters: rafters, rafterM: rafterM, purlinRows: purlinRows, purlinM: purlinM,
      tileNet: tileNet, tileArea: tileArea, glueBags: glueBags,
      cable: cable, points: points, hasKitchen: hasKitchen
    };

    // --- Lignes de matériaux ---
    var lines = [];
    function add(id, group, label, unit, qty, detail) {
      if (qty > 0) lines.push({ id: id, group: group, label: label, unit: unit, qty: qty, detail: detail || "" });
    }
    var G1 = "Gros œuvre", G2 = "Toiture", G3 = "Ouvertures et équipements", G4 = "Cuisine et sols";

    add("blocks", G1, "Parpaings " + v.blockLength + " × " + v.blockHeight + " × " + v.blockThickness + " cm", "pièce", blocks,
      fmtNum(blocksWalls) + " pour les murs, " + fmtNum(blocksBase) + " pour le soubassement, casse " + v.breakage + " %");
    add("cement", G1, "Ciment (sac de 50 kg)", "sac", cementBags, "Béton, mortier de pose, enduit et chape, marge " + v.bulkMargin + " %");
    add("sand", G1, "Sable", "m³", sand, "Arrondi au demi-m³");
    add("gravel", G1, "Gravier", "m³", gravel, "Arrondi au demi-m³");
    add("steel8", G1, "Fer de 8 mm (barre de 12 m)", "barre", bars8, "Chaînages, poteaux, semelles" + (v.roofType === "dalle" ? " et dalle de toiture" : ""));
    add("steel6", G1, "Fer de 6 mm (barre de 12 m)", "barre", bars6, "Cadres des chaînages et des poteaux");
    add("lashing", G1, "Fil de ligature", "kg", lashing);
    add("fill", G1, "Remblai", "m³", v.fill, "Saisi par vos soins");

    if (v.roofType === "tole") {
      add("sheet", G2, "Tôle de toiture", "m²", sheetArea, "Surface du toit " + fmtNum(roofArea, 1) + " m², recouvrement 10 %");
      add("rafters", G2, "Chevrons (bois ou métal)", "m linéaire", ceilInt(rafterM), fmtNum(rafters) + " chevrons, à valider par un charpentier");
      add("purlins", G2, "Pannes (bois ou métal)", "m linéaire", ceilInt(purlinM), fmtNum(purlinRows) + " rangées, à valider par un charpentier");
      add("screws", G2, "Vis ou clous à tôle", "pièce", screws);
    } else {
      // Le béton de la dalle de toiture est déjà compté dans le ciment, le sable et le gravier.
      warnings.push("Dalle de toiture de 12 cm : " + fmtNum(roofSlabConcrete, 1) + " m³ de béton, déjà inclus dans le ciment, le sable et le gravier. Prévoyez aussi le coffrage et les étais.");
    }

    add("doors", G3, "Portes " + v.doorW + " × " + v.doorH + " cm, avec cadre", "pièce", v.doors);
    add("windows", G3, "Fenêtres " + v.windowW + " × " + v.windowH + " cm", "pièce", v.windows);
    add("cable", G3, "Câble 2,5 mm et gaines", "m", cable, fmtNum(points) + " points (prises, interrupteurs, lumières)");
    add("sockets", G3, "Prises", "pièce", v.sockets);
    add("switches", G3, "Interrupteurs", "pièce", v.switches);
    add("lights", G3, "Points lumineux", "pièce", v.lights);
    add("breaker", G3, "Boîtier de protection électrique", "pièce", points > 0 ? 1 : 0);

    add("tiles", G4, "Carrelage", "m²", Math.round(tileArea * 10) / 10, fmtNum(tileNet, 1) + " m² posés, pertes 10 %");
    add("tileGlue", G4, "Colle à carrelage (sac de 25 kg)", "sac", glueBags);
    add("sink", G4, "Évier avec robinet", "pièce", hasKitchen ? 1 : 0);
    add("pvc", G4, "Tuyau PVC d'évacuation", "m", v.pvcLength);

    return { ready: true, errors: {}, r: r, lines: lines, warnings: warnings, contingency: v.contingency };
  }

  /* ---------- Budget ---------- */

  // prices : { id: "texte saisi" }. Une ligne sans prix n'est pas comptée et est signalée.
  // labour : montant forfaitaire de main-d'œuvre saisi (texte).
  function budget(result, prices, labour, contingencyPct) {
    prices = prices || {};
    var rows = [], groups = {}, subtotal = 0, missing = [], errors = {};
    (result.lines || []).forEach(function (ln) {
      var p = parseNum(prices[ln.id]);
      var price = null, total = null;
      if (p.error) errors[ln.id] = p.error;
      else if (!p.empty) { price = p.value; total = Math.round(ln.qty * price); }
      if (price === null) missing.push(ln.id);
      else { subtotal += total; groups[ln.group] = (groups[ln.group] || 0) + total; }
      rows.push({ id: ln.id, group: ln.group, label: ln.label, unit: ln.unit, qty: ln.qty, detail: ln.detail, price: price, total: total });
    });
    var lab = parseNum(labour);
    var labourAmount = 0;
    if (lab.error) errors.labour = lab.error;
    else if (!lab.empty) labourAmount = Math.round(lab.value);
    var base = subtotal + labourAmount;
    var pct = typeof contingencyPct === "number" ? contingencyPct : (result.contingency || 0);
    var contingency = Math.round(base * pct / 100);
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors, rows: rows, groups: groups,
      materials: subtotal, labour: labourAmount, contingencyPct: pct, contingency: contingency,
      total: base + contingency, missing: missing, complete: missing.length === 0
    };
  }

  return {
    DEFAULTS: DEFAULTS, parseNum: parseNum, fmtNum: fmtNum, fmtMoney: fmtMoney,
    validate: validate, compute: compute, budget: budget
  };
});
