// Initialisation de Supabase
const supabase = window.supabase.createClient(
  window.MAHOUTO_CONFIG.SUPABASE_URL,
  window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY
);

// Vérification de la connexion
console.log("MAHOUTO+ connecté à Supabase !");
console.log("URL :", window.MAHOUTO_CONFIG.SUPABASE_URL);
