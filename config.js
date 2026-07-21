// =========================================================
// MAHOUTO+ — Configuration Supabase (Client)
// 
// À remplir avec tes vraies valeurs depuis Supabase:
// Project Settings > API > Project URL et anon key
// 
// ⚠️ IMPORTANT:
// - Cette clé (SUPABASE_ANON_KEY) est PUBLIQUE par design
// - Elle est protégée par les policies RLS Supabase
// - Ne JAMAIS mettre SUPABASE_SERVICE_ROLE_KEY ici
// =========================================================

// Configuration Supabase (à remplir)
window.MAHOUTO_CONFIG = {
  SUPABASE_URL: "https://kbnhmddwiimkjaehiwyi.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu"
};

// =========================================================
// Validation de la configuration au démarrage
// =========================================================

(function validateConfig() {
  const requiredKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
  const placeholders = ["TON-PROJET", "TON-ANON-KEY"];
  
  // Vérifier que la configuration existe
  if (!window.MAHOUTO_CONFIG) {
    console.error("❌ MAHOUTO_CONFIG non défini dans config.js");
    showConfigError("Configuration manquante");
    return false;
  }
  
  // Vérifier que toutes les clés requises sont présentes
  for (const key of requiredKeys) {
    if (!window.MAHOUTO_CONFIG[key]) {
      console.error(`❌ ${key} manquant dans MAHOUTO_CONFIG`);
      showConfigError(`${key} manquant`);
      return false;
    }
  }
  
  // Vérifier qu'aucun placeholder n'est encore en place
  for (const placeholder of placeholders) {
    for (const key of requiredKeys) {
      if (window.MAHOUTO_CONFIG[key].includes(placeholder)) {
        console.error(`❌ ${key} contient encore un placeholder: ${placeholder}`);
        showConfigError(`${key} non configuré (placeholder détecté)`);
        return false;
      }
    }
  }
  
  // Vérifier le format de l'URL
  try {
    new URL(window.MAHOUTO_CONFIG.SUPABASE_URL);
  } catch (e) {
    console.error(`❌ SUPABASE_URL invalide: ${window.MAHOUTO_CONFIG.SUPABASE_URL}`);
    showConfigError("SUPABASE_URL invalide");
    return false;
  }
  
  // Vérifier que la clé anon a une longueur raisonnable
  if (window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY.length < 20) {
    console.error("❌ SUPABASE_ANON_KEY semble invalide (trop court)");
    showConfigError("SUPABASE_ANON_KEY invalide");
    return false;
  }
  
  console.log("✅ Configuration Supabase valide");
  return true;
})();

// =========================================================
// Afficher une erreur de configuration
// =========================================================

function showConfigError(message) {
  // Créer un overlay d'erreur
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  `;
  
  const content = document.createElement("div");
  content.style.cssText = `
    background: #1A1A1A;
    border: 2px solid #F87171;
    border-radius: 16px;
    padding: 32px;
    max-width: 500px;
    color: #FFFFFF;
    text-align: center;
  `;
  
  content.innerHTML = `
    <h1 style="color: #F87171; margin-bottom: 16px; font-size: 24px;">⚠️ Erreur de Configuration</h1>
    <p style="margin-bottom: 24px; font-size: 16px; color: #A3A3A3;">
      ${message}
    </p>
    <div style="background: #0A0A0A; border-radius: 10px; padding: 16px; margin-bottom: 24px; text-align: left; font-family: 'Courier New', monospace; font-size: 12px; color: #FFD700;">
      <p style="margin: 0; margin-bottom: 8px;"><strong>À faire:</strong></p>
      <ol style="margin: 0; padding-left: 20px; color: #A3A3A3;">
        <li>Ouvrir <code>config.js</code></li>
        <li>Remplacer <code>TON-PROJET</code> par ton URL Supabase réelle</li>
        <li>Remplacer <code>TON-ANON-KEY</code> par ta clé anon réelle</li>
        <li>Rafraîchir la page</li>
      </ol>
    </div>
    <p style="font-size: 12px; color: #6B6B6B;">
      Voir <code>README.md</code> pour les instructions détaillées.
    </p>
  `;
  
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  
  // Empêcher l'app de charger
  document.body.style.overflow = "hidden";
}

// =========================================================
// Exporter pour utilisation dans les modules
// =========================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = window.MAHOUTO_CONFIG;
}
