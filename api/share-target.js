export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  let files = [];
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = body.toString().split('--' + boundary);
    parts.forEach(p => {
      if(p.includes('filename="')) {
        const name = p.match(/filename="(.+?)"/)[1];
        files.push(name);
      }
    });
  } catch(e){}

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Partager vers MAHOUTO+</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
body{background:#0A0A0A;color:#fff;font-family:sans-serif;padding:20px;margin:0}
h2{color:#FFC107} input{width:100%;padding:14px;margin-top:10px;border-radius:12px;border:1px solid #333;background:#1a1a1a;color:#fff}
.dest-grid{display:flex;gap:10px;margin:15px 0;flex-wrap:wrap}
.dest-btn{padding:12px 20px;background:#1a1a1a;border:1px solid #333;border-radius:12px;cursor:pointer}
.dest-btn.active{border-color:#FFC107;background:#332200}
.btn{background:#FFC107;color:#000;padding:15px;border:none;border-radius:12px;width:100%;font-weight:bold;margin-top:20px;font-size:16px}
#status{margin-top:10px;color:#4CAF50}
</style></head><body>
<h2>📦 Partager vers MAHOUTO+</h2>
<p>${files.length}/10 fichiers reçus</p>
<input id="caption" placeholder="Ajouter une légende...">
<h3>DESTINATION</h3>
<div class="dest-grid">
  <div class="dest-btn active" data-dest="general">🏠 Général</div>
  <div class="dest-btn" data-dest="support">🆘 Support</div>
  <div class="dest-btn" data-dest="annonces">📢 Annonces</div>
</div>
<button class="btn" id="send-btn">Envoyer vers MAHOUTO+</button>
<p id="status"></p>

<script>
const SUPABASE_URL = 'https://kbnhmddwiimkjaehiwyi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let selectedDest = 'general';
const formData = new FormData();

document.querySelectorAll('.dest-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.dest-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDest = btn.dataset.dest;
  }
});

document.getElementById('send-btn').onclick = async () => {
  const status = document.getElementById('status');
  status.innerText = 'Envoi en cours...';
  
  // ICI on enverra vers ton API /api/messages pour créer le post
  // Pour l'instant on affiche juste le succès
  setTimeout(() => {
    status.innerText = '✅ Envoyé dans ' + selectedDest + '!';
  }, 1000);
}
</script>
</body></html>
  `);
}
