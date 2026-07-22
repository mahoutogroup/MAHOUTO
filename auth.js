//=========================================================
// MAHOUTO+ - AUTH.JS
//=========================================================

// Initialisation du client Supabase
const supabase = window.supabase.createClient(
    window.MAHOUTO_CONFIG.SUPABASE_URL,
    window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY
);

// Rendre Supabase accessible partout
window.supabase = supabase;

console.log("✅ MAHOUTO+ connecté à Supabase !");
console.log("URL :", window.MAHOUTO_CONFIG.SUPABASE_URL);


//=========================================================
// CONNEXION GOOGLE
//=========================================================

async function loginGoogle() {

    const { error } = await supabase.auth.signInWithOAuth({

        provider: "google",

        options: {
            redirectTo: window.location.origin
        }

    });

    if (error) {

        console.error("Erreur Google :", error.message);

        throw new Error(
            "La connexion Google a échoué."
        );

    }

}


//=========================================================
// DECONNEXION
//=========================================================

async function logout() {

    const { error } = await supabase.auth.signOut();

    if (error) {

        console.error("Erreur :", error.message);

        throw new Error(
            "Impossible de se déconnecter."
        );

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

            {
                id: userId,
                username: username
            },

            {
                onConflict: "id"
            }

        );


    if (error) {

        console.error(
            "Profil non enregistré :",
            error.message
        );

    }

}



//=========================================================
// VERIFICATION DE SESSION
//=========================================================

async function checkUser() {

    try {

        const {

            data: { user }

        } = await supabase.auth.getUser();


        if (!user) {

            console.log(
                "Aucun utilisateur connecté."
            );

            return null;

        }


        const userName =

            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email ||
            "Utilisateur";


        const userPhoto =

            user.user_metadata?.avatar_url ||
            "";


        // Vérifier si le profil existe déjà

        const {

            data: existingProfile

        } = await supabase

            .from("profiles")
            .select("username")
            .eq("id", user.id)
            .maybeSingle();



        // Le créer uniquement si nécessaire

        if (!existingProfile) {

            await ensureProfile(
                user.id,
                userName
            );

        }


        // Compatibilité avec les anciennes pages

        const googleButton =
            document.getElementById(
                "google-login-button"
            );


        if (googleButton) {

            googleButton.innerHTML = `

            <img src="${userPhoto}"
            style="
            width:24px;
            height:24px;
            border-radius:50%;
            vertical-align:middle;
            margin-right:8px;
            ">

            ${existingProfile ?
            existingProfile.username :
            userName}

            `;


            googleButton
            .removeAttribute("onclick");

        }


        console.log(
            "Utilisateur connecté :",
            userName
        );


        return user;


    } catch (error) {

        console.error(
            "Erreur de session :",
            error.message
        );

        return null;

    }

}



//=========================================================
// RAFRAICHISSEMENT AUTOMATIQUE
//=========================================================

supabase.auth.onAuthStateChange(
    (event, session) => {

        console.log(
            "Etat de session :",
            event
        );

        checkUser();

    }
);


//=========================================================
// EXPORT DES FONCTIONS
//=========================================================

window.loginGoogle = loginGoogle;

window.logout = logout;

window.checkUser = checkUser;


//=========================================================
// LANCEMENT
//=========================================================

checkUser();
