/* =======================================================
   MAHOUTO+
   Theme Manager officiel
   ======================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* ==========================
       Animation des cartes
       ========================== */

    const cards = document.querySelectorAll(".card");

    cards.forEach((card) => {

        card.addEventListener("touchstart", () => {
            card.style.transform = "scale(.98)";
        });

        card.addEventListener("touchend", () => {
            card.style.transform = "";
        });

    });


    /* ==========================
       Animation des boutons
       ========================== */

    const buttons = document.querySelectorAll(
        ".btn-gold, .btn-outline"
    );

    buttons.forEach((button)=>{

        button.addEventListener("click",()=>{

            button.animate([
                {
                    transform:"scale(1)"
                },
                {
                    transform:"scale(.95)"
                },
                {
                    transform:"scale(1)"
                }

            ],{

                duration:250

            });

        });

    });



    /* ==========================
       Animation du logo
       ========================== */

    const logo = document.querySelector(".logo-badge");

    if(logo){

        logo.animate([

            {
                transform:"scale(1)"
            },

            {
                transform:"scale(1.03)"
            },

            {
                transform:"scale(1)"
            }

        ],{

            duration:4000,
            iterations:Infinity

        });

    }



    /* ==========================
       Animation du slogan
       ========================== */

    const slogan = document.querySelector(".slogan");

    if(slogan){

        slogan.animate([

            {
                opacity:.85
            },

            {
                opacity:1
            },

            {
                opacity:.85
            }

        ],{

            duration:5000,
            iterations:Infinity

        });

    }



    /* ==========================
       Détection PWA installée
       ========================== */

    if(window.matchMedia("(display-mode: standalone)").matches){

        console.log("MAHOUTO+ installé.");

    }



    /* ==========================
       Effet premium des modules
       ========================== */

    const modules = document.querySelectorAll(".module-card");

    modules.forEach((module)=>{

        module.addEventListener("mouseenter",()=>{

            module.style.boxShadow =
            "0 0 25px rgba(255,215,0,.12)";

        });


        module.addEventListener("mouseleave",()=>{

            module.style.boxShadow = "";

        });

    });



    /* ==========================
       Sauvegarde des préférences
       ========================== */

    localStorage.setItem(
        "mahouto-theme",
        "premium-dark"
    );


    console.log(
        "MAHOUTO+ Premium Theme chargé."
    );


});


/* =======================================================
   FIN DU FICHIER
   ======================================================= */
