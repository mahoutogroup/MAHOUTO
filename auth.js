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
                // Réinitialise l'affichage à l'état "non connecté" — sans
                // ce bloc, une déconnexion (SIGNED_OUT) déclenchait bien
                // cet événement mais ne remettait jamais l'UI à jour : le
                // profil du compte précédent restait affiché jusqu'à un
                // rechargement manuel de la page.
                const authMethodsEl = document.getElementById("auth-methods");
                const guestNoteEl = document.getElementById("auth-guest-note");
                const profileSummaryEl = document.getElementById("profile-summary");
                const nameEl = document.getElementById("profile-name");
                const avatarEl = document.getElementById("profile-avatar");
                if (authMethodsEl) authMethodsEl.classList.remove("hidden-by-auth");
                if (guestNoteEl) guestNoteEl.classList.remove("hidden");
                if (profileSummaryEl) profileSummaryEl.classList.remove("visible");
                if (nameEl) nameEl.textContent = "";
                if (avatarEl) avatarEl.innerHTML = "";
                return null;
            }

            const userName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Utilisateur";

            // Créer le profil si n'existe pas
            const { data: existingProfile } = await supabase
               .from("profiles")
               .select("username")
               .eq("id", user.id)
               .maybeSingle();

            if (!existingProfile) {
                await ensureProfile(user.id, userName);
            }

            // Mettre à jour le profil dans index.html.
            //
            // CORRECTIF (diagnostic BUG 2) : ce bloc testait
            // "typeof refreshIdentityUI === 'function'", mais
            // refreshIdentityUI() est déclarée à l'intérieur de l'IIFE du
            // script inline d'index.html — elle n'a jamais été exposée
            // sur window, donc ce typeof valait toujours "undefined" et
            // ce bloc n'a JAMAIS pu s'exécuter depuis onAuthStateChange.
            // Seul l'appel unique et direct de refreshIdentityUI() au tout
            // premier chargement du script (index.html) affichait
            // correctement l'utilisateur — d'où l'ancien compte qui
            // restait affiché tant que la page n'était pas rechargée en
            // entier : la mise à jour réactive était du code mort.
            if (typeof window.refreshIdentityUI === 'function') {
                window.refreshIdentityUI();
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

    // Restauration depuis le cache "back-forward" (bfcache) du
    // navigateur : la page peut être réanimée avec un ancien état gelé
    // sans jamais ré-exécuter ce script. On revalide alors la session
    // réellement active à cet instant précis, pour ne jamais laisser
    // affiché le profil d'un compte précédent.
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) checkUser();
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
