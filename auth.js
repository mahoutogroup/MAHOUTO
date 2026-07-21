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
// Vérifier si un utilisateur est connecté
async function checkUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const userName = user.user_metadata.full_name || "Utilisateur";
    const userPhoto = user.user_metadata.avatar_url || "";

    // Masquer le bouton Google
    const googleButton = document.getElementById("google-login-button");
    if (googleButton) {
      googleButton.innerHTML = `
        <img src="${userPhoto}" 
             style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;">
        ${userName}
      `;
      googleButton.removeAttribute("onclick");
    }

    console.log("Utilisateur connecté :", userName);
  }
}

// Exécuter la vérification au chargement
checkUser();
