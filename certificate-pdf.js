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

  // certificate = { userName, formationTitle, issuedAt (ISO string), code }
  async function download(certificate) {
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const gold = [212, 175, 55];
    const dark = [10, 10, 10];

    // Cadre
    doc.setDrawColor(...gold);
    doc.setLineWidth(1.2);
    doc.rect(10, 10, pageW - 20, pageH - 20);
    doc.setLineWidth(0.4);
    doc.rect(13, 13, pageW - 26, pageH - 26);

    doc.setTextColor(...gold);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.text("MAJESTÉ PRESSE", pageW / 2, 34, { align: "center" });

    doc.setTextColor(...dark);
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text("Certificat de réussite", pageW / 2, 46, { align: "center" });

    doc.setFontSize(11);
    doc.text("Ce certificat est décerné à", pageW / 2, 62, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(certificate.userName || "—", pageW / 2, 76, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("pour avoir terminé avec succès la formation", pageW / 2, 90, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(certificate.formationTitle || "—", pageW / 2, 102, { align: "center" });

    const dateStr = certificate.issuedAt
      ? new Date(certificate.issuedAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })
      : "";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Délivré le " + dateStr, pageW / 2, 116, { align: "center" });

    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Code de vérification : " + (certificate.code || ""), pageW / 2, pageH - 18, { align: "center" });

    const safeName = (certificate.formationTitle || "certificat").replace(/[^a-zA-Z0-9 _-]/g, "_");
    doc.save("Certificat MAHOUTO+ - " + safeName + ".pdf");
  }

  return { download };
})();
