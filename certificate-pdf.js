/* =========================================================
   MAHOUTO+ — Génération de certificat PDF (100% côté client)
   =========================================================
   Toujours généré dans le navigateur (jsPDF) — aucune nouvelle
   fonction Vercel, le projet reste à 12 (limite plan Hobby).

   Nouveautés de cette version :
   - Logo officiel MAHOUTO+ (assets/logo-mahouto-plus.png — fichier
     EXISTANT du dépôt, jamais recréé/redessiné ici).
   - QR code pointant vers la page publique de vérification
     (verify.html), généré localement (librairie "qrcode", chargée
     depuis un CDN) — jamais une simple donnée encodée en dur, une
     vraie URL de vérification.
   - Emplacement pour la signature du fondateur : assets/signature-
     fondateur.png. Si ce fichier n'existe pas encore, la signature
     graphique est simplement omise (repli propre sur le texte seul),
     rien ne casse.
   ========================================================= */

window.MahoutoCertificatePdf = (function () {
  let jsPDFLoaded = null;
  let qrLoaded = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossible de charger " + src));
      document.head.appendChild(script);
    });
  }

  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jsPDFLoaded) return jsPDFLoaded;
    jsPDFLoaded = loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
      .catch(() => loadScript("https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js"));
    return jsPDFLoaded;
  }

  // Deux CDN pour LE MÊME paquet npm "qrcode" (donc la même API
  // QRCode.toDataURL) : si le premier échoue (blocage réseau
  // ponctuel, lenteur mobile...), on retente automatiquement avec le
  // second avant d'abandonner. Ne jamais mélanger avec une autre
  // librairie QR (API différente, ex. davidshimjs/qrcodejs).
  function loadQrLib() {
    if (window.QRCode && window.QRCode.toDataURL) return Promise.resolve();
    if (qrLoaded) return qrLoaded;
    qrLoaded = loadScript("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js")
      .catch(() => loadScript("https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js"));
    return qrLoaded;
  }

  // La version précompilée navigateur de "qrcode" exige un callback
  // explicite (elle ne renvoie pas toujours une Promise selon le
  // build) — on l'enveloppe nous-mêmes pour garder un await propre,
  // sans dépendre d'un comportement Promise non garanti.
  function qrToDataURL(text, options) {
    return new Promise((resolve, reject) => {
      window.QRCode.toDataURL(text, options, (err, url) => {
        if (err) reject(err); else resolve(url);
      });
    });
  }

  // Charge une image (même origine) et la renvoie en data URL PNG,
  // avec ses dimensions naturelles pour préserver le ratio et ne
  // jamais déformer le logo ou la signature.
  function loadImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        try {
          resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("Image introuvable : " + url));
      img.src = url;
    });
  }

  function spaced(text) {
    return String(text || "").split("").join("\u2009");
  }

  // Place une image en la faisant tenir dans une boîte maxW x maxH
  // (mm), centrée horizontalement autour de cx, sans jamais déformer
  // le ratio d'origine.
  function drawImageFit(doc, img, cx, y, maxW, maxH) {
    const ratio = img.width / img.height;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    doc.addImage(img.dataUrl, "PNG", cx - w / 2, y, w, h);
    return h;
  }

  // certificate = { userName, formationTitle, issuedAt (ISO string), code }
  async function download(certificate) {
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const cx = pageW / 2;

    const gold = [197, 160, 60];
    const goldDark = [140, 110, 30];
    const ink = [30, 26, 18];
    const muted = [120, 112, 96];
    const ivory = [253, 250, 242];

    // -------- Fond + cadre ornemental (inchangé) --------
    doc.setFillColor(...ivory);
    doc.rect(0, 0, pageW, pageH, "F");
    doc.setDrawColor(...gold);
    doc.setLineWidth(1);
    doc.rect(9, 9, pageW - 18, pageH - 18);
    doc.setLineWidth(0.3);
    doc.rect(13, 13, pageW - 26, pageH - 26);
    function corner(x, y, sx, sy) {
      doc.setDrawColor(...gold);
      doc.setLineWidth(0.6);
      doc.line(x, y, x + 14 * sx, y);
      doc.line(x, y, x, y + 14 * sy);
    }
    corner(13, 13, 1, 1);
    corner(pageW - 13, 13, -1, 1);
    corner(13, pageH - 13, 1, -1);
    corner(pageW - 13, pageH - 13, -1, -1);

    // -------- Logo officiel MAHOUTO+ (fichier existant du dépôt) --------
    try {
      const logo = await loadImageAsDataUrl("assets/logo-mahouto-plus.png");
      drawImageFit(doc, logo, cx, 15, 26, 22);
    } catch (err) {
      console.warn("[CERTIFICAT] logo introuvable, poursuite sans logo :", err.message);
    }

    // -------- Titre --------
    doc.setTextColor(...gold);
    doc.setFont("times", "bold");
    doc.setFontSize(18);
    doc.text(spaced("CERTIFICAT DE RÉUSSITE"), cx, 46, { align: "center" });
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.4);
    doc.line(cx - 30, 50, cx + 30, 50);
    doc.setFillColor(...gold);
    doc.circle(cx, 50, 0.8, "F");

    // -------- Corps --------
    doc.setTextColor(...ink);
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.text("Décerné à", cx, 62, { align: "center" });

    const nameText = certificate.userName || "—";
    doc.setFont("times", "bold");
    doc.setFontSize(27);
    doc.setTextColor(...goldDark);
    doc.text(nameText, cx, 75, { align: "center" });
    const nameWidth = doc.getTextWidth(nameText);
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(cx - nameWidth / 2 - 4, 79, cx + nameWidth / 2 + 4, 79);

    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.text("Pour avoir réussi avec succès la formation :", cx, 90, { align: "center" });

    doc.setFont("times", "bolditalic");
    doc.setFontSize(16);
    doc.setTextColor(...goldDark);
    doc.text(certificate.formationTitle || "—", cx, 100, { align: "center" });

    const dateStr = certificate.issuedAt
      ? new Date(certificate.issuedAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })
      : "";
    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(10.5);
    doc.text("Date d'obtention : " + dateStr, cx, 110, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFontSize(9);
    doc.text("Code : " + (certificate.code || ""), cx, 116, { align: "center" });

    // -------- QR code (bas gauche) — pointe vers la vraie page de
    // vérification publique, jamais les infos encodées directement. --------
    const qrY = 128;
    const qrSize = 26;
    const qrX = 46;
    try {
      await loadQrLib();
      const verifyUrl = window.location.origin + "/verify/" + encodeURIComponent(certificate.code || "");
      console.log("[CERTIFICAT] génération QR pour :", verifyUrl);
      const qrDataUrl = await qrToDataURL(verifyUrl, { margin: 1, width: 300, color: { dark: "#1E1A12", light: "#FDFAF2" } });
      doc.addImage(qrDataUrl, "PNG", qrX - qrSize / 2, qrY, qrSize, qrSize);
      console.log("[CERTIFICAT] QR code inséré avec succès");
    } catch (err) {
      console.error("[CERTIFICAT] QR code NON généré :", err);
      // Diagnostic temporaire : affiche l'erreur directement à l'écran
      // (pratique sur Android, sans PC ni chrome://inspect). À retirer
      // une fois le QR code confirmé fonctionnel.
      alert("[Diagnostic QR code] " + (err && err.message ? err.message : String(err)));
    }
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text("Scanner pour vérifier", qrX, qrY + qrSize + 6, { align: "center" });
    doc.text("l'authenticité", qrX, qrY + qrSize + 10.5, { align: "center" });

    // -------- Signature du fondateur (bas droite) --------
    const sigCenterX = pageW - 46;
    let sigLineY = qrY + 16;
    try {
      const sig = await loadImageAsDataUrl("assets/signature-fondateur.png");
      const h = drawImageFit(doc, sig, sigCenterX, qrY, 34, 16);
      sigLineY = qrY + h + 2;
    } catch (err) {
      // Fichier pas encore fourni — repli propre sur le texte seul,
      // rien ne casse (voir instructions de dépôt du fichier).
      sigLineY = qrY + 12;
    }
    doc.setDrawColor(...muted);
    doc.setLineWidth(0.3);
    doc.line(sigCenterX - 26, sigLineY, sigCenterX + 26, sigLineY);
    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(10.5);
    doc.text("Mahouto Abdallah", sigCenterX, sigLineY + 5, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text("Fondateur — MAHOUTO+", sigCenterX, sigLineY + 9.5, { align: "center" });

    // -------- Pied de page --------
    doc.setTextColor(...gold);
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.text("MAHOUTO+", cx, pageH - 26, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.text("L'Intelligence Artificielle, la Formation et le Business réunis dans une seule application.", cx, pageH - 20, { align: "center" });
    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.text("MAJESTÉ PRESSE", cx, pageH - 15, { align: "center" });

    const safeName = (certificate.formationTitle || "certificat").replace(/[^a-zA-Z0-9 _-]/g, "_");
    doc.save("Certificat MAHOUTO+ - " + safeName + ".pdf");
  }

  return { download };
})();
