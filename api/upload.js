export const config = {
  api: {
    bodyParser: false, // Important pour recevoir les fichiers
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  console.log("Fichiers reçus sur /api/upload");
  // TODO: Ici on va traiter les fichiers avec formidable ou multer
  
  return res.status(200).json({ success: true, message: "Fichiers reçus" });
}
