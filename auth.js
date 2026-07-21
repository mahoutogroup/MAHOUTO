// Initialisation de Supabase
const supabase = window.supabase.createClient(
  window.MAHOUTO_CONFIG.SUPABASE_URL,
  window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY
);

// Vérification de la connexion
console.log("MAHOUTO+ connecté à Supabase !");
console.log("URL :", window.MAHOUTO_CONFIG.SUPABASE_URL);
// Connexion avec Google
async function loginGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://mahouto.vercel.app"
    }
  });

  if (error) {
    console.error("Erreur de connexion Google :", error.message);
    alert("La connexion Google a échoué.");
  }
}
