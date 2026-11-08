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
    // Ne réécrit JAMAIS un pseudo existant : MahoutoPseudo.saveIfMissing relit le profil et n'écrit
    // que s'il n'a pas de pseudo (création, ou pseudo vide). Si la lecture échoue (réseau coupé),
    // RIEN n'est écrit. Le pseudo ne se change que dans « Mon profil ».
    async function ensureProfile(userId, username, avatarUrl) {
        const extra = avatarUrl ? { avatar_url: avatarUrl } : null;
        // Pseudo refusé par la base (réservé, forme d'adresse e-mail, déjà pris : migrations 002 et
        // 004) : le pseudo ne vient pas ici d'un choix de la personne mais du nom Google. On crée le
        // profil avec un pseudo neutre plutôt que de laisser le compte sans profil ; elle pourra le
        // changer dans « Mon profil ». En cas de collision (très improbable), plus de caractères.
        const candidates = [username, MahoutoPseudo.neutralName(userId), MahoutoPseudo.neutralName(userId, 8)];
        let result = null;
        for (const candidate of candidates) {
            result = await MahoutoPseudo.saveIfMissing(supabase, userId, candidate, extra);
            if (!MahoutoPseudo.refusal(result.error)) break;
        }
        if (result && result.error) {
            console.error("Profil non enregistré :", result.error.code || "erreur");
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

            // Jamais l'adresse e-mail comme pseudo : sans nom (inscription par e-mail), pseudo neutre.
            let userName = user.user_metadata?.full_name || user.user_metadata?.name || "";
            if (!userName || MahoutoPseudo.looksLikeEmail(userName)) userName = MahoutoPseudo.neutralName(user.id);
            const userPhoto = user.user_metadata?.avatar_url || "";

            // Créer le profil si n'existe pas
            const { data: existingProfile, error: profileReadError } = await supabase
               .from("profiles")
               .select("username, avatar_url")
               .eq("id", user.id)
               .maybeSingle();

            if (profileReadError) {
                // Lecture impossible (réseau coupé…) : on n'écrit RIEN. Sans cette garde, un profil
                // « introuvable » faute de réseau aurait vu son pseudo réécrit par le nom Google.
                console.error("Profil illisible, aucune écriture :", profileReadError.code || "erreur");
            } else if (!existingProfile) {
                await ensureProfile(user.id, userName, userPhoto);
            } else if (!existingProfile.avatar_url && userPhoto) {
                // Synchronise la photo Google vers profiles.avatar_url
                // UNIQUEMENT si la colonne est encore vide : ne remplace
                // jamais une photo personnalisée déjà choisie par l'utilisateur.
                const { error: avatarSyncError } = await supabase
                    .from("profiles")
                    .update({ avatar_url: userPhoto })
                    .eq("id", user.id)
                    .is("avatar_url", null);
                if (avatarSyncError) {
                    console.error("Synchronisation avatar Google échouée :", avatarSyncError.message);
                }
            }

            // Mettre à jour le profil dans index.html
            if(typeof refreshIdentityUI === 'function') {
                const avatarEl = document.getElementById("profile-avatar");
                if(avatarEl) {
                    avatarEl.textContent = "";
                    if (userPhoto) {
                        // DOM (pas innerHTML) : l'URL ne doit jamais être injectée dans du HTML
                        const photoImg = document.createElement("img");
                        photoImg.alt = "";
                        photoImg.src = userPhoto;
                        avatarEl.appendChild(photoImg);
                    } else {
                        avatarEl.textContent = userName.trim()[0].toUpperCase();
                    }
                }
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
