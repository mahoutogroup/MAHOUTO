export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MAHOUTO+</title>
<style>
body{background:#0A0A0A;color:#fff;padding:16px;font-family:system-ui;margin:0}
h2{color:#FFC107;margin:0 0 8px 0}
p{color:#AAA;margin:0 0 16px 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.item{background:#1A1A1A;padding:8px;border-radius:8px;text-align:center;font-size:12px;border:2px solid #333;cursor:pointer}
.item.selected{border:2px solid #FFC107}
.item img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px}
.icon{font-size:28px;padding:12px 0}
button{width:100%;padding:16px;background:#FFC107;color:#000;border:0;border-radius:12px;font-weight:bold;font-size:16px;margin-top:16px}
textarea{width:100%;background:#1A1A1A;border:1px solid #333;color:#fff;border-radius:8px;padding:12px;box-sizing:border-box}
</style>
</head>
<body>
<h2>📦 Partager vers MAHOUTO+</h2>
<p id="count">Chargement des fichiers...</p>
<div class="grid" id="preview"></div>
<textarea id="text" rows="2" placeholder="Ajouter une légende..."></textarea>
<h3 style="margin-top:16px">DESTINATION</h3>
<div class="grid">
  <div onclick="selectDest(this)" data-dest="general" class="item"><div class="icon">🏠</div>Général</div>
  <div onclick="selectDest(this)" data-dest="support" class="item"><div class="icon">🆘</div>Support</div>
  <div onclick="selectDest(this)" data-dest="annonces" class="item"><div class="icon">📢</div>Annonces</div>
</div>
<button onclick="envoyer()">Envoyer vers MAHOUTO+</button>

<script>
let fichiers = [];
let destination = null;
function selectDest(el){ 
  document.querySelectorAll('.grid .item').forEach(i=>i.classList.remove('selected')); 
  el.classList.add('selected'); 
  destination = el.dataset.dest; 
}

if ('launchQueue' in window) {
  launchQueue.setConsumer(async launchParams => {
    if (launchParams.files && launchParams.files.length > 0) {
      fichiers = await Promise.all(launchParams.files.map(f => f.getFile()));
      document.getElementById('count').textContent = fichiers.length + '/10 fichiers sélectionnés';
      const grid = document.getElementById('preview'); grid.innerHTML='';
      fichiers.forEach(f => {
        let icone = '<div class="icon">📎</div>';
        if(f.type.startsWith('image/')) icone = '<img src="'+URL.createObjectURL(f)+'">';
        if(f.type === 'application/zip') icone = '<div class="icon">📦</div>';
        if(f.type === 'application/pdf') icone = '<div class="icon">📄</div>';
        grid.innerHTML += \`<div class="item">\${icone}<div>\${f.name.substring(0,15)}</div></div>\`;
      });
    } else {
      document.getElementById('count').textContent = 'Aucun fichier reçu';
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
  alert(rep.ok ? '✅ Envoyé !' : '❌ Erreur: '+rep.status);
  if(rep.ok) window.close();
}
</script>
</body>
</html>`);
}
