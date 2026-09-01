export const config = {
  api: {
    bodyParser: false, // Important pour les fichiers
  },
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Ici tu reçois les fichiers
    // Exemple: les envoyer sur Cloudinary, S3, ou les sauver
    return res.status(200).json({ success: true, message: "Fichiers reçus" });
  }
  res.status(405).end();
}
