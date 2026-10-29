/* =========================================================
   MAHOUTO+ — Générateur de documents Word (.docx) léger
   Sans dépendance : écrit directement un vrai fichier
   Office Open XML dans une archive ZIP (méthode « stockée »).
   Fonctionne dans le navigateur et sous Node (tests).

   Ce n'est PAS un fichier HTML renommé : le résultat s'ouvre
   et se modifie dans Microsoft Word, LibreOffice et Google Docs.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocxLite = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var encoder = new TextEncoder();
  var NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  /* ---------- ZIP (stocké, sans compression) ---------- */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = encoder.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += local.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var rec = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      chunks.push(new Uint8Array(rec), c.name);
      cdSize += rec.length + c.name.length;
    });
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0));
    chunks.push(new Uint8Array(end));
    var total = chunks.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* ---------- XML ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function halfPoints(pt) { return Math.round((pt || 11) * 2); }

  function runXml(run) {
    if (typeof run === "string") run = { text: run };
    var props = "";
    if (run.bold) props += "<w:b/><w:bCs/>";
    if (run.italic) props += "<w:i/><w:iCs/>";
    if (run.color) props += '<w:color w:val="' + esc(run.color) + '"/>';
    if (run.size) props += '<w:sz w:val="' + halfPoints(run.size) + '"/><w:szCs w:val="' + halfPoints(run.size) + '"/>';
    var parts = String(run.text === null || run.text === undefined ? "" : run.text).split("\n");
    var inner = parts.map(function (part, i) {
      return (i > 0 ? "<w:br/>" : "") + '<w:t xml:space="preserve">' + esc(part) + "</w:t>";
    }).join("");
    return "<w:r>" + (props ? "<w:rPr>" + props + "</w:rPr>" : "") + inner + "</w:r>";
  }

  /** Paragraphe. content : texte, ou tableau de runs ({text,bold,italic,size,color}). */
  function p(content, o) {
    o = o || {};
    var runs = Array.isArray(content) ? content : [content];
    var base = { bold: o.bold, italic: o.italic, size: o.size, color: o.color };
    var runsXml = runs.map(function (r) {
      if (typeof r === "string") r = { text: r };
      return runXml({ text: r.text, bold: r.bold !== undefined ? r.bold : base.bold, italic: r.italic !== undefined ? r.italic : base.italic,
        size: r.size || base.size, color: r.color || base.color });
    }).join("");
    var ppr = "";
    if (o.keepNext) ppr += "<w:keepNext/>";
    if (o.borderBottom) ppr += '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="' + esc(o.borderBottom) + '"/></w:pBdr>';
    if (o.shade) ppr += '<w:shd w:val="clear" w:color="auto" w:fill="' + esc(o.shade) + '"/>';
    ppr += '<w:spacing w:before="' + Math.round((o.before || 0) * 20) + '" w:after="' + Math.round((o.after === undefined ? 6 : o.after) * 20) + '"/>';
    if (o.indent) ppr += '<w:ind w:left="' + Math.round(o.indent * 567) + '" w:hanging="283"/>';
    if (o.align) ppr += '<w:jc w:val="' + esc(o.align) + '"/>';
    return { xml: "<w:p><w:pPr>" + ppr + "</w:pPr>" + runsXml + "</w:p>" };
  }

  /** Puce simple (tiret). */
  function bullet(text, o) {
    o = o || {};
    return p([{ text: "•\u00A0\u00A0" }, { text: text }], { indent: 0.9, after: o.after === undefined ? 2 : o.after, size: o.size });
  }

  function spacer(pt) { return p("", { after: pt === undefined ? 4 : pt, size: 4 }); }

  /**
   * Tableau.
   * opts : { widths:[largeurs en twips], borderColor, rows:[ { header:bool, cells:[ {text|runs, bold, color, fill, align, span, size} ] } ] }
   * Largeur totale conseillée : 9638 twips (A4 avec marges de 2 cm).
   */
  function table(opts) {
    var widths = opts.widths;
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var bc = esc(opts.borderColor || "BFBFBF");
    var borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) {
      return "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="' + bc + '"/>';
    }).join("");
    var x = '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:tblBorders>' + borders + "</w:tblBorders>" +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>";
    opts.rows.forEach(function (row) {
      x += "<w:tr>" + (row.header ? "<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>");
      var col = 0;
      row.cells.forEach(function (cell) {
        var span = cell.span || 1, w = 0;
        for (var i = 0; i < span; i++) w += widths[col + i] || 0;
        col += span;
        var tcpr = '<w:tcW w:w="' + w + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : "") +
          (cell.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + esc(cell.fill) + '"/>' : "") + '<w:vAlign w:val="center"/>';
        var paras;
        if (cell.paras) paras = cell.paras;
        else paras = [p(cell.runs || (cell.text === undefined ? "" : cell.text), { bold: cell.bold, color: cell.color, align: cell.align, size: cell.size || 10, after: 0 })];
        x += "<w:tc><w:tcPr>" + tcpr + "</w:tcPr>" + paras.map(function (q) { return q.xml; }).join("") + "</w:tc>";
      });
      x += "</w:tr>";
    });
    x += "</w:tbl>";
    return { xml: x };
  }

  /* ---------- Document ---------- */

  function headerXml(h) {
    var xs = [];
    xs.push(p(h.title || "", { bold: true, size: 18, color: "1A1A1A", after: 0 }).xml);
    if (h.subtitle) xs.push(p(h.subtitle, { size: 9.5, color: "7A6A1E", after: 0 }).xml);
    xs.push(p(h.contact || "", { size: 9, color: "555555", after: 2, borderBottom: "D4AF37" }).xml);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '">' + xs.join("") + "</w:hdr>";
  }
  function footerXml(text) {
    var page = '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>';
    var pages = '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>';
    var left = '<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">' + esc(text || "") + "   —   Page </w:t></w:r>";
    var mid = '<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      left + page + mid + pages + "</w:p></w:ftr>";
  }
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + NS_W + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

  /**
   * createDocument({ header:{title,subtitle,contact}, footerText, title, author, body:[blocs] }) -> Uint8Array (.docx)
   */
  function createDocument(opts) {
    var bodyXml = (opts.body || []).map(function (b) { return b.xml; }).join("");
    var sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:body>' + bodyXml + sect + "</w:body></w:document>";
    var created = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    var files = [
      { name: "[Content_Types].xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
      { name: "_rels/.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
      { name: "word/_rels/document.xml.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>' },
      { name: "word/document.xml", text: documentXml },
      { name: "word/styles.xml", text: STYLES },
      { name: "word/header1.xml", text: headerXml(opts.header || {}) },
      { name: "word/footer1.xml", text: footerXml(opts.footerText) },
      { name: "docProps/core.xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        "<dc:title>" + esc(opts.title || "") + "</dc:title><dc:creator>" + esc(opts.author || "MAJESTÉ PRESSE") + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + created + "</dcterms:created></cp:coreProperties>" },
      { name: "docProps/app.xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MAHOUTO+</Application></Properties>' }
    ];
    return zip(files.map(function (f) { return { name: f.name, data: encoder.encode(f.text) }; }));
  }

  /** Télécharge un fichier dans le navigateur (aucun envoi réseau). */
  function download(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  return { createDocument: createDocument, p: p, bullet: bullet, spacer: spacer, table: table, download: download, _zip: zip, _crc32: crc32 };
});
