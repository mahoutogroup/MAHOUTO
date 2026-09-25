/* =========================================================
   MAHOUTO+ — Génération de certificat PDF (100% côté client)
   =========================================================
   Choix délibéré : générer le PDF dans le navigateur (jsPDF) plutôt
   que côté serveur, pour ne créer AUCUNE nouvelle fonction Vercel —
   le projet est déjà à 12 fonctions (limite du plan Hobby). Le
   contenu du certificat ne dépend que de données déjà en base
   (nom, formation, date, code) — aucune génération lourde
   nécessaire côté serveur pour ce cas d'usage.
   ========================================================= */

window.MahoutoCertificatePdf = (function () {
  let jsPDFLoaded = null;

  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jsPDFLoaded) return jsPDFLoaded;
    jsPDFLoaded = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("jsPDF n'a pas pu être chargé"));
      document.head.appendChild(script);
    });
    return jsPDFLoaded;
  }

  // Petit utilitaire : espace les lettres d'un mot en insérant des
  // espaces fines — jsPDF n'a pas de vrai letter-spacing fiable en
  // v2, cette astuce donne un rendu "titre gravé" sans dépendance
  // supplémentaire.
  function spaced(text) {
    return String(text || "").split("").join("\u2009");
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

    // -------- Fond ivoire (plus élégant qu'un blanc pur à l'impression) --------
    doc.setFillColor(...ivory);
    doc.rect(0, 0, pageW, pageH, "F");

    // -------- Cadre double avec coins ornementaux --------
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

    // -------- En-tête --------
    doc.setTextColor(...gold);
    doc.setFont("times", "bold");
    doc.setFontSize(26);
    doc.text(spaced("MAJESTÉ PRESSE"), cx, 34, { align: "center" });

    doc.setDrawColor(...gold);
    doc.setLineWidth(0.4);
    doc.line(cx - 30, 39, cx + 30, 39);
    doc.setFillColor(...gold);
    doc.circle(cx, 39, 0.8, "F");

    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(11.5);
    doc.text(spaced("CERTIFICAT DE RÉUSSITE"), cx, 48, { align: "center" });

    // -------- Corps --------
    doc.setTextColor(...ink);
    doc.setFont("times", "italic");
    doc.setFontSize(12.5);
    doc.text("Ce certificat est décerné avec fierté à", cx, 66, { align: "center" });

    const nameText = certificate.userName || "—";
    doc.setFont("times", "bold");
    doc.setFontSize(30);
    doc.setTextColor(...goldDark);
    doc.text(nameText, cx, 80, { align: "center" });

    const nameWidth = doc.getTextWidth(nameText);
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(cx - nameWidth / 2 - 4, 84, cx + nameWidth / 2 + 4, 84);

    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(12.5);
    doc.text("pour avoir suivi et validé avec succès la formation", cx, 96, { align: "center" });

    doc.setFont("times", "bolditalic");
    doc.setFontSize(18);
    doc.setTextColor(...goldDark);
    doc.text(certificate.formationTitle || "—", cx, 108, { align: "center" });

    // -------- Sceau doré avec ruban --------
    const sealX = cx;
    const sealY = pageH - 46;
    doc.setFillColor(...gold);
    doc.triangle(sealX - 7, sealY + 6, sealX - 1, sealY + 22, sealX - 10, sealY + 18, "F");
    doc.triangle(sealX + 7, sealY + 6, sealX + 1, sealY + 22, sealX + 10, sealY + 18, "F");
    doc.setFillColor(...gold);
    doc.circle(sealX, sealY, 9, "F");
    doc.setDrawColor(...ivory);
    doc.setLineWidth(0.6);
    doc.circle(sealX, sealY, 6.8);
    doc.setTextColor(...ivory);
    doc.setFont("times", "bold");
    doc.setFontSize(13);
    doc.text("M+", sealX, sealY + 3.2, { align: "center" });

    // -------- Date (gauche) et signature (droite) --------
    const dateStr = certificate.issuedAt
      ? new Date(certificate.issuedAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })
      : "";
    const blockY = pageH - 40;

    doc.setDrawColor(...muted);
    doc.setLineWidth(0.3);
    doc.line(38, blockY, 88, blockY);
    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(10.5);
    doc.text(dateStr, 63, blockY - 2, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFontSize(9);
    doc.text("Date de délivrance", 63, blockY + 5, { align: "center" });

    doc.setDrawColor(...muted);
    doc.line(pageW - 88, blockY, pageW - 38, blockY);
    doc.setTextColor(...ink);
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    doc.text("MAHOUTO+", pageW - 63, blockY - 2, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text("Direction", pageW - 63, blockY + 5, { align: "center" });

    // -------- Code de vérification --------
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Code de vérification : " + (certificate.code || ""), cx, pageH - 15, { align: "center" });

    const safeName = (certificate.formationTitle || "certificat").replace(/[^a-zA-Z0-9 _-]/g, "_");
    doc.save("Certificat MAHOUTO+ - " + safeName + ".pdf");
  }

  return { download };
})();
