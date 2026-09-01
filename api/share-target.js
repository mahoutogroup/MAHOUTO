export default async function handler(req, res) {
  // CAS 1: Android envoie en POST → on affiche direct la page + on traite
  if (req.method === 'POST') {
    // Pas de redirect. On affiche la page direct
  }

  // CAS 2: Afficher la page dans tous les cas
  res.status(200).send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MAHOUTO+</title>
<style>
body{background:#0A0A0A;color:#fff;padding:16px;font-family:system-ui;margin:0}
h2{color:#FFC107} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.item{background:#1A1A1A;padding:8px;border-radius:8px;text-align:center;font-size:12px;border:2px solid transparent}
.item img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px}
.icon{font-size:28px} button{width:100%;padding:16px;background:#FFC107;color:#000;border:0;border-radius:12px;font-weight:bold;font-size:16px}
textarea{width:100%;background:#1A1A1A;border:1px solid #333;color:#fff;border-radius:8px;padding:12px;box-sizing:border-box}
</style>
</head>
<body>
<h2>📦 Partager vers MAHOUTO+</h2>
<p id="count">Chargement...</p>
<div class="grid" id="preview"></div>
<textarea id="text" rows="2" placeholder="Ajouter une légende..."></textarea>
<h3>DESTINATION</h3>
<div onclick="select(this)" data-dest="general" class="item">Général</div>
<div onclick="select(this)" data-dest="support" class="item">Support</div>
<div onclick="select(this)" data-dest="annonces" class="item">Annonces</div>
<button onclick="envoyer()">Envoyer vers MAHOUTO+</button>

<script>
let fichiers = [];
let destination = null;
function select(el){ document.querySelectorAll('.item').forEach(i=>i.style.border='2px solid transparent'); el.style.border='2px solid #FFC107'; destination = el.dataset.dest; }

if ('launchQueue' in window) {
  launchQueue.setConsumer(async launchParams => {
    if (launchParams.files) {
      fichiers = await Promise.all(launchParams.files.map(f => f.getFile()));
      document.getElementById('count').textContent = fichiers.length + '/10 fichiers';
      const grid = document.getElementById('preview');
      fichiers.forEach(f => {
        let icone = '<div class="icon">📎</div>';
        if(f.type.startsWith('image/')) icone = '<img src="'+URL.createObjectURL(f)+'">';
        if(f.type === 'application/zip') icone = '<div class="icon">📦</div>';
        grid.innerHTML += \`<div class="item">\${icone}<div>\${f.name}</div></div>\`;
      });
    }
  });
} else {
  document.getElementById('count').textContent = 'Ouvre via Partager pour envoyer des fichiers';
}

async function envoyer(){
  if(fichiers.length === 0) return alert('Aucun fichier');
  if(!destination) return alert('Choisis une destination');
  const form = new FormData();
  form.append('destination', destination);
  form.append('text', document.getElementById('text').value);
  fichiers.forEach(f => form.append('files', f));
  const rep = await fetch('/api/upload', {method:'POST', body:form});
  alert(rep.ok ? 'Envoyé !' : 'Erreur');
  if(rep.ok) window.close();
}
</script>
</body>
</html>`);
}
