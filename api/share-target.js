export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Vercel parse déjà le multipart dans req.body
  const files = req.body.files || [];
  const fileCount = Array.isArray(files) ? files.length : 1;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MAHOUTO+</title><style>
body{background:#0A0A0A;color:#fff;font-family:sans-serif;padding:20px}
.btn{background:#FFC107;color:#000;padding:15px;border:none;border-radius:12px;width:100%;font-weight:bold;font-size:16px;margin-top:20px}
</style></head><body>
<h2 style="color:#FFC107">📦 Partager vers MAHOUTO+</h2>
<p>${fileCount}/10 fichiers reçus</p>
<input placeholder="Ajouter une légende..." style="width:100%;padding:12px;background:#222;border:1px solid #444;color:#fff;border-radius:8px">
<h3>DESTINATION</h3>
<button class="btn">Envoyer vers Général</button>
<script>console.log("Fichiers reçus:", ${fileCount})</script>
</body></html>
  `);
}
