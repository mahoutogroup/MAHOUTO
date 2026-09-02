export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  let fileCount = 0;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    fileCount = (body.match(/filename="/g) || []).length;
  } catch(e){}

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Partager vers MAHOUTO+</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
body{background:#0A0A0A;color:#fff;font-family:sans-serif;padding:20px;margin:0}
h2{color:#FFC107} input{width:100%;padding:14px;margin-top:10px;border-radius:12px;border:1px solid #333;background:#1a1a1a;color:#fff}
.dest-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0;max-height:300px;overflow-y:auto}
.dest-btn{padding:12px;background:#1a1a1a;border:1px solid #333;border-radius:12px;text-align:center;cursor:pointer;font-size:14px}
.dest-btn.active{border-color:#FFC107;background:#332200}
.btn{background:#FFC107;color:#000;padding:15px;border:none;border-radius:12px;width:100%;font-weight:bold;margin-top:20px;font-size:16px}
#status{margin-top:10px;color:#4CAF50;text-align:center}
</style></head><body>
<h2>📦 Partager vers MAHOUTO+</h2>
<p>${fileCount}/10 fichiers reçus</p>
<input id="caption" placeholder="Ajouter une légende...">
<h3>DESTINATION</h3>
<div class="dest-grid" id="dest-list">Chargement des salons...</div>
<button class="btn" id="send-btn">Envoyer vers MAHOUTO+</button>
<p id="status"></p>

<script>
const SUPABASE_URL = 'https://kbnhmddwiimkjaehiwyi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let selectedDest = null;

async function init() {
  const { data: { user } = await supabase.auth.getUser();
  const destList = document.getElementById('dest-list');
  destList.innerHTML = '';

  // 1. Ajouter les salons par défaut
  [['general','🏠 Général'],['support','🆘 Support'],['annonces','📢 Annonces']].forEach(([id,name]) => {
    destList.innerHTML += \`<div class="dest-btn" data-dest="\${id}">\${name}</div>\`;
  });

  // 2. Charger les vrais salons depuis Supabase si connecté
  if(user){
    const { data: rooms } = await supabase.from('rooms').select('id, name');
    if(rooms) rooms.forEach(r => {
      destList.innerHTML += \`<div class="dest-btn" data-dest="room-\${r.id}">👥 \${r.name}</div>\`;
    });
  } else {
    destList.innerHTML += '<p style="font-size:12px;color:#888">Connecte-toi dans l\'app pour voir tes salons</p>';
  }

  // 3. Gestion du clic
  document.querySelectorAll('.dest-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.dest-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDest = btn.dataset.dest;
    }
  });
  // Sélectionner Général par défaut
  document.querySelector('.dest-btn').classList.add('active');
  selectedDest = 'general';
}
init();

document.getElementById('send-btn').onclick = async () => {
  const status = document.getElementById('status');
  const caption = document.getElementById('caption').value;
  if(!selectedDest){ status.innerText = '❌ Choisis une destination'; return; }
  
  status.innerText = 'Envoi en cours...';
  
  // Ici on appelle ton API pour créer le message
  // Pour l'instant on simule
  setTimeout(() => {
    status.innerText = '✅ Envoyé avec succès dans ' + selectedDest;
  }, 1500);
}
</script>
</body></html>
  `);
}
