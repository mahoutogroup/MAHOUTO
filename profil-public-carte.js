/* =========================================================
   profil-public-carte.js — « Télécharger ma carte (PNG) » : carte à imprimer de 1080 × 1350 px dessinée dans un canvas,
   côté navigateur, avec la pile de polices système. Contenu : logo de la marque, nom, métier, localisation, QR (grand, sur tuile
   blanche, marge de 4 modules), adresse lisible et « Scannez pour me contacter ».
   JAMAIS dessiné : numéro de téléphone, lien de contact, présentation, photo (aucune requête réseau, aucune contamination du
   canvas). Le logo est le fichier du site (même origine) ; s'il ne charge pas, la carte est dessinée sans logo.
   Fonctions pures : le contexte 2D est fourni par l'appelant (testé avec un faux contexte et avec un vrai canvas Chromium).
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./profil-public-utils"));
  else root.ProfilPublicCarte = factory(root.ProfilPublicUtils);
})(typeof window !== "undefined" ? window : globalThis, function (PU) {
  "use strict";

  var W = 1080, H = 1350;
  var FONT = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  var C = { fond: "#0A0A0A", fond2: "#17130A", or: "#D4AF37", orVif: "#FFD700", texte: "#FFFFFF", doux: "#C9C9C9", tuile: "#FFFFFF" };
  var MARGE_TEXTE = 120;                 // marge gauche et droite des textes
  var LARGEUR_TEXTE = W - 2 * MARGE_TEXTE;
  var NOM_FICHIER_FIN = "-carte.png";

  /** Nom du fichier : mahouto-<adresse>-carte.png ; null si l'adresse est invalide. */
  function cardFilename(adresse) { return typeof adresse === "string" && PU.ADRESSE_RE.test(adresse) ? "mahouto-" + adresse + NOM_FICHIER_FIN : null; }

  /**
   * Coupe un texte en lignes qui tiennent dans maxWidth (mesure par ctx.measureText), au plus maxLines lignes.
   * Un mot plus large que la ligne est coupé caractère par caractère ; le texte trop long finit par « … ». Jamais de débordement.
   */
  function fitLines(ctx, text, maxWidth, maxLines) {
    var words = String(text == null ? "" : text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    var w = function (t) { return ctx.measureText(t).width; };
    var lines = [], cur = "", i, k, chunk;
    for (i = 0; i < words.length; i++) {
      var word = words[i];
      while (w(word) > maxWidth) {                // mot géant : on en coupe un morceau qui tient
        var chars = Array.from(word); chunk = "";
        for (k = 0; k < chars.length && w(chunk + chars[k]) <= maxWidth; k++) chunk += chars[k];
        if (!chunk) chunk = chars[0];
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(chunk); word = chars.slice(Array.from(chunk).length).join("");
        if (!word) break;
      }
      if (!word) continue;
      if (!cur) cur = word;
      else if (w(cur + " " + word) <= maxWidth) cur += " " + word;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = Array.from(lines[maxLines - 1]);
      while (last.length && w(last.join("") + "…") > maxWidth) last.pop();
      lines[maxLines - 1] = last.join("").replace(/\s+$/, "") + "…";
    }
    return lines;
  }

  /** Plus grande taille de police (entre min et max) pour laquelle le texte tient sur UNE ligne dans maxWidth ; sinon min (puis tronqué). */
  function fitFontSize(ctx, text, weight, maxWidth, max, min) {
    var size = max;
    while (size > min) { ctx.font = weight + " " + size + "px " + FONT; if (ctx.measureText(text).width <= maxWidth) break; size -= 2; }
    ctx.font = weight + " " + size + "px " + FONT;
    return size;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  function drawLines(ctx, lines, cx, y, lineHeight) {
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lineHeight);
    return y + lines.length * lineHeight;
  }

  /**
   * Dessine la carte. o : { qr (objet qrcode-generator), adresse, nom, metier, localisation, brandName, logo (image chargée ou null) }
   * Renvoie { width, height, tuile:{x,y,size}, qr:{x,y,scale,px,quiet,modules} } (positions du QR, utiles aux tests), ou null si invalide.
   */
  function drawCard(ctx, o) {
    var opt = o || {};
    var url = PU.qrUrl(opt.adresse);
    if (!ctx || !opt.qr || !url) return null;
    var cx = W / 2, nom = PU.cleanLine(opt.nom, PU.LIMITS.nom) || "Mon profil";
    var brand = PU.cleanLine(opt.brandName, 30) || "MAHOUTO+";

    // Fond : noir de marque, halo or discret en haut, fines diagonales dorées
    ctx.fillStyle = C.fond; ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, W, 420); g.addColorStop(0, C.fond2); g.addColorStop(1, "#3A2D0A");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 330);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 330); ctx.clip();
    ctx.strokeStyle = "rgba(255,215,0,0.08)"; ctx.lineWidth = 2;
    for (var d = -340; d < W; d += 44) { ctx.beginPath(); ctx.moveTo(d, 330); ctx.lineTo(d + 330, 0); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = C.orVif; ctx.fillRect(0, 330, W, 6);

    // Logo (rond de marque) et nom de la marque
    var y = 86;
    if (opt.logo) { try { ctx.drawImage(opt.logo, cx - 55, y, 110, 110); } catch (e) { /* carte sans logo */ } }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.texte; ctx.font = "800 40px " + FONT;
    ctx.fillText(brand, cx, y + 110 + 50);

    // Nom, métier, localisation (coupés proprement)
    y = 410;
    ctx.fillStyle = C.texte; ctx.font = "800 68px " + FONT;
    y = drawLines(ctx, fitLines(ctx, nom, LARGEUR_TEXTE, 2), cx, y, 76);
    var metier = PU.cleanLine(opt.metier, PU.LIMITS.metier);
    if (metier) { ctx.fillStyle = C.orVif; ctx.font = "700 38px " + FONT; y = drawLines(ctx, fitLines(ctx, metier, LARGEUR_TEXTE, 2), cx, y + 14, 48); }
    var lieu = PU.cleanLine(opt.localisation, PU.LIMITS.localisation);
    if (lieu) {
      ctx.fillStyle = C.doux; ctx.font = "500 32px " + FONT;
      var ll = fitLines(ctx, lieu, LARGEUR_TEXTE - 60, 1)[0] || "", tw = ctx.measureText(ll).width, px = cx - (tw + 40) / 2, py = y + 14;
      // repère dessiné (pas d'emoji) : goutte + point
      ctx.strokeStyle = C.or; ctx.lineWidth = 3.5; ctx.beginPath();
      ctx.arc(px + 12, py + 16, 11, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(px + 12, py + 38); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + 12, py + 16, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.textAlign = "left"; ctx.fillText(ll, px + 40, py + 36); ctx.textAlign = "center";
      y = py + 52;
    }

    // QR : tuile blanche arrondie, échelle entière, marge de 4 modules incluse dans l'image du QR
    var n = opt.qr.getModuleCount(), L = PU.qrLayout(n, 1);
    var ty = Math.max(y + 40, 600), pad = 22;
    var scale = Math.max(2, Math.floor((Math.min(660, 1110 - ty) - 2 * pad) / L.size));   // tuile entière au-dessus de y = 1110
    var qrPx = L.size * scale, tuile = qrPx + 2 * pad;
    var tx = Math.round((W - tuile) / 2);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 36; ctx.shadowOffsetY = 12;
    ctx.fillStyle = C.tuile; roundRect(ctx, tx, ty, tuile, tuile, 34); ctx.fill(); ctx.restore();
    var Lq = { quiet: L.quiet, modules: L.modules, size: L.size, scale: scale, px: qrPx };
    PU.paintQr(ctx, opt.qr, Lq, tx + pad, ty + pad);

    // Adresse lisible et phrase d'appel
    var ay = ty + tuile + 70;
    ctx.fillStyle = C.orVif; fitFontSize(ctx, "mahouto.com/m/" + opt.adresse, "700", LARGEUR_TEXTE, 44, 26);
    ctx.fillText("mahouto.com/m/" + opt.adresse, cx, ay);
    ctx.fillStyle = C.texte; ctx.font = "600 42px " + FONT;
    ctx.fillText("Scannez pour me contacter", cx, ay + 66);
    return { width: W, height: H, tuile: { x: tx, y: ty, size: tuile }, qr: { x: tx + pad, y: ty + pad, scale: scale, px: qrPx, quiet: L.quiet, modules: L.modules } };
  }

  return { WIDTH: W, HEIGHT: H, cardFilename: cardFilename, fitLines: fitLines, fitFontSize: fitFontSize, drawCard: drawCard };
});
