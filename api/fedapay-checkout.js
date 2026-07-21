// =========================================================
// /api/fedapay-checkout.js
// Crée une transaction FedaPay et renvoie l'URL de paiement.
//
// Variables d'environnement Vercel attendues :
//   FEDAPAY_SECRET_KEY   (clé secrète FedaPay)
//   FEDAPAY_ENV          ("sandbox" ou "live", défaut : "sandbox")
//   PUBLIC_SITE_URL      (ex: https://mahoutoplus.vercel.app) — pour le retour après paiement
// =========================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { courseId, courseName, amount, customerEmail, customerFirstname, userId } = req.body;

    if (!courseId || !courseName || !amount) {
      return res.status(400).json({ error: "courseId, courseName et amount sont requis" });
    }

    const secretKey = process.env.FEDAPAY_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: "FEDAPAY_SECRET_KEY manquant dans les variables d'environnement Vercel" });
    }

    const env = (process.env.FEDAPAY_ENVIRONMENT || process.env.FEDAPAY_ENV) === "live" ? "live" : "sandbox";
    const baseUrl = env === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
    const siteUrl = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;

    // 1. Créer la transaction
    const createResp = await fetch(`${baseUrl}/transactions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transaction: {
          description: `MAHOUTO School — ${courseName}`,
          amount: Math.round(Number(amount)),
          currency: { iso: "XOF" },
          callback_url: `${siteUrl}/school.html?payment=return&course=${encodeURIComponent(courseId)}`,
          customer: {
            firstname: customerFirstname || "Client",
            email: customerEmail || undefined
          }
        }
      })
    });

    const createData = await createResp.json();
    if (!createResp.ok) {
      console.error("Erreur création transaction FedaPay :", createData);
      return res.status(502).json({ error: "Impossible de créer la transaction FedaPay" });
    }

    const transactionId = createData.transaction && createData.transaction.id || createData["v1/transaction"] && createData["v1/transaction"].id;
    if (!transactionId) {
      return res.status(502).json({ error: "Réponse FedaPay inattendue" });
    }

    // 2. Générer le token/lien de paiement
    const tokenResp = await fetch(`${baseUrl}/transactions/${transactionId}/token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      }
    });

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok) {
      console.error("Erreur génération token FedaPay :", tokenData);
      return res.status(502).json({ error: "Impossible de générer le lien de paiement" });
    }

    const checkoutUrl = tokenData.url || (tokenData.token && tokenData.token.url);
    if (!checkoutUrl) {
      return res.status(502).json({ error: "URL de paiement introuvable dans la réponse FedaPay" });
    }

    // 3. Enregistrer l'achat en attente dans Supabase (si les clés serveur sont configurées)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && userId) {
      const { createClient } = await import("@supabase/supabase-js");
      const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await supabaseAdmin.from("purchases").insert({
        user_id: userId,
        course_id: courseId,
        course_name: courseName,
        amount: Math.round(Number(amount)),
        fedapay_transaction_id: transactionId,
        status: "pending"
      });
    }

    return res.status(200).json({ checkoutUrl, transactionId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur lors de la création du paiement" });
  }
}
