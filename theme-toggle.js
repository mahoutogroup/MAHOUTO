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
       Gestion du thème
       ========================== */

    const themeBtn = document.getElementById(
        "theme-toggle-btn"
    );


    // récupération du thème
    let currentTheme = localStorage.getItem(
        "mahouto-theme"
    );


    // par défaut
    if(!currentTheme){

        currentTheme="premium-dark";

    }


    if(currentTheme==="light"){

        document.body.classList.add(
            "light-theme"
        );

        if(themeBtn){
            themeBtn.textContent="☀️";
        }

    }else{

        if(themeBtn){
            themeBtn.textContent="🌙";
        }

    }


    // changement du thème

    if(themeBtn){

        themeBtn.addEventListener("click",()=>{

            themeBtn.animate([
                { transform:"rotate(0deg)" },
                { transform:"rotate(360deg)" }
            ],{
                duration:400,
                easing:"ease"
            });

            document.body.classList.toggle(
                "light-theme"
            );


            if(

                document.body.classList.contains(
                    "light-theme"
                )

            ){

                localStorage.setItem(
                    "mahouto-theme",
                    "light"
                );


                themeBtn.textContent="☀️";

            }else{

                localStorage.setItem(
                    "mahouto-theme",
                    "premium-dark"
                );


                themeBtn.textContent="🌙";

            }


        });

    }


    console.log(
        "MAHOUTO+ Theme Manager chargé."
    );


});


/* =======================================================
   FIN DU FICHIER
   ======================================================= */
