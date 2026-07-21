// =========================================================
// /api/cloudinary-sign.js
// Génère les paramètres signés pour un envoi direct depuis le
// navigateur vers Cloudinary, sans jamais exposer la clé secrète.
//
// Variables d'environnement Vercel attendues :
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
// =========================================================

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Variables Cloudinary manquantes sur Vercel" });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = "mahoutoplus";

  // La signature Cloudinary est un SHA-1 des paramètres triés + la clé secrète
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

  return res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    folder,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`
  });
}
