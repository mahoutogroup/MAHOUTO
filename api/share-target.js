import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false, // IMPORTANT pour recevoir les fichiers
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const form = new IncomingForm({ multiples: true, keepExtensions: true });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erreur de parsing');
    }

    const uploadedFiles = [];
    if (files.files) {
      const fileArray = Array.isArray(files.files) ? files.files : [files.files];
      fileArray.forEach(file => {
        uploadedFiles.push({
          name: file.originalFilename,
          size: file.size,
          type: file.mimetype
        });
      });
    }

    // On renvoie la page HTML avec les fichiers dedans
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Partager vers MAHOUTO+</title>
<style>
body{background:#0A0A0A;color:#fff;font-family:sans-serif;padding:20px;margin:0}
h2{color:#FFC107}
input, .dest-btn, .send-btn{width:100%;padding:14px;margin-top:10px;border-radius:12px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:15px}
.dest-grid{display:flex;gap:10px;margin:15px 0}
.dest-btn{flex:1;text-align:center;cursor:pointer}
.dest-btn.active{border-color:#FFC107;background:#332200}
.send-btn{background:#FFC107;color:#000;border:none;font-weight:bold;cursor:pointer}
.file-count{color:#aaa}
</style>
</head>
<body>
  <h2>📦 Partager vers MAHOUTO+</h2>
  <p class="file-count">${uploadedFiles.length}/10 fichiers reçus</p>
  
  <div id="preview"></div>

  <input id="caption" placeholder="Ajouter une légende...">
  
  <h3>DESTINATION</h3>
  <div class="dest-grid">
    <div class="dest-btn active" data-dest="general">🏠 Général</div>
    <div class="dest-btn" data-dest="support">🆘 Support</div>
    <div class="dest-btn" data-dest="annonces">📢 Annonces</div>
  </div>

  <button class="send-btn">Envoyer vers MAHOUTO+</button>

<script>
  const files = ${JSON.stringify(uploadedFiles)};
  const preview = document.getElementById('preview');
  
  if(files.length > 0){
    preview.innerHTML = files.map(f => `<p>📄 ${f.name} - ${(f.size/1024).toFixed(1)} KB</p>`).join('');
  } else {
    preview.innerHTML = '<p style="color:red">Aucun fichier</p>';
  }

  document.querySelectorAll('.dest-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.dest-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });
</script>
</body>
</html>
    `);
  });
}
