//=========================================================
// MAHOUTO+ - AUTH.JS
//=========================================================

// Protection : si ce fichier est chargé deux fois sur la même page
if (window.__MAHOUTO_AUTH_LOADED__) {
    console.warn("⚠️ auth.js déjà chargé — exécution ignorée.");
} else {
    window.__MAHOUTO_AUTH_LOADED__ = true;

    // Initialisation du client Supabase
    const supabase = window.supabase.createClient(
        window.MAHOUTO_CONFIG.SUPABASE_URL,
        window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY
    );

    // Rendre Supabase accessible partout
    window.supabase = supabase;

    console.log("✅ MAHOUTO+ connecté à Supabase!");
    console.log("URL :", window.MAHOUTO_CONFIG.SUPABASE_URL);

    //=========================================================
    // CONNEXION GOOGLE
    //=========================================================
    async function loginGoogle() {
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: window.location.origin
                }
            });
            if (error) throw error;
        } catch (error) {
            console.error("Erreur Google :", error.message);
            // Affiche l'erreur dans la modal si elle existe
            if(typeof showAuthError === 'function') showAuthError(error.message);
            else alert("La connexion Google a échoué: " + error.message);
        }
    }

    //=========================================================
    // DECONNEXION
    //=========================================================
    async function logout() {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error("Erreur :", error.message);
            throw new Error("Impossible de se déconnecter.");
        }
        window.location.href = "index.html";
    }

    //=========================================================
    // CREATION DU PROFIL
    //=========================================================
    async function ensureProfile(userId, username) {
        const { error } = await supabase
           .from("profiles")
           .upsert(
                { id: userId, username: username },
                { onConflict: "id" }
            );
        if (error) {
            console.error("Profil non enregistré :", error.message);
        }
    }

    //=========================================================
    // VERIFICATION DE SESSION
    //=========================================================
    async function checkUser() {
        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                console.log("Aucun utilisateur connecté.");
                return null;
            }

            const userName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Utilisateur";
            const userPhoto = user.user_metadata?.avatar_url || "";

            // Créer le profil si n'existe pas
            const { data: existingProfile } = await supabase
               .from("profiles")
               .select("username")
               .eq("id", user.id)
               .maybeSingle();

            if (!existingProfile) {
                await ensureProfile(user.id, userName);
            }

            // Mettre à jour le profil dans index.html
            if(typeof refreshIdentityUI === 'function') {
                const avatarEl = document.getElementById("profile-avatar");
                if(avatarEl) avatarEl.innerHTML = userPhoto? `<img src="${userPhoto}" alt="">` : userName.trim()[0].toUpperCase();
                document.getElementById("profile-name").textContent = userName;
                document.getElementById("auth-methods").classList.add("hidden-by-auth");
                document.getElementById("auth-guest-note").classList.add("hidden");
                document.getElementById("profile-summary").classList.add("visible");
            }

            console.log("Utilisateur connecté :", userName);
            return user;

        } catch (error) {
            console.error("Erreur de session :", error.message);
            return null;
        }
    }

    //=========================================================
    // RAFRAICHISSEMENT AUTOMATIQUE
    //=========================================================
    supabase.auth.onAuthStateChange((event, session) => {
        console.log("Etat de session :", event);
        checkUser();
    });

    //=========================================================
    // EXPORT DES FONCTIONS POUR LES BOUTONS HTML
    //=========================================================
    window.loginGoogle = loginGoogle;
    window.logout = logout;
    window.checkUser = checkUser;

    //=========================================================
    // LANCEMENT
    //=========================================================
    checkUser();
}
