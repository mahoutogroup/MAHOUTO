export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  let fileCount = 0;

  try {
    // ============================================================
    // 1. Lire le corps multipart/form-data sans bodyParser
    // ============================================================
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const bodyBuffer = Buffer.concat(chunks);

    // On transforme seulement en texte pour compter les fichiers.
    // Le contenu binaire n'est PAS utilisé pour l'instant.
    const bodyText = bodyBuffer.toString("latin1");

    fileCount = (bodyText.match(/filename="/g) || []).length;

    // Sécurité : maximum 10 fichiers
    if (fileCount > 10) {
      fileCount = 10;
    }
  } catch (error) {
    console.error("Erreur lecture multipart :", error);
    fileCount = 0;
  }

  // ============================================================
  // 2. Réponse HTML
  // ============================================================

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  return res.status(200).send(`
<!DOCTYPE html>

<html lang="fr">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
>

<title>Partager vers MAHOUTO+</title>

<script
  src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js">
</script>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100%;
}

body {
  background: #0a0a0a;
  color: #ffffff;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;

  padding: 20px;
}

.container {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}

h2 {
  color: #ffc107;
  margin-top: 10px;
  margin-bottom: 18px;
  font-size: 28px;
}

.file-count {
  font-size: 18px;
  color: #ffffff;
  margin-bottom: 18px;
}

input {
  width: 100%;
  padding: 15px;

  margin-top: 5px;

  border-radius: 12px;
  border: 1px solid #333;

  background: #1a1a1a;
  color: #ffffff;

  font-size: 16px;
  outline: none;
}

input:focus {
  border-color: #ffc107;
}

input::placeholder {
  color: #888;
}

h3 {
  margin-top: 28px;
  margin-bottom: 12px;
  font-size: 18px;
}

.dest-grid {
  display: grid;

  grid-template-columns: 1fr 1fr;

  gap: 10px;

  margin-top: 10px;

  max-height: 320px;

  overflow-y: auto;

  padding-right: 2px;
}

.dest-btn {
  padding: 14px 10px;

  background: #1a1a1a;

  border: 1px solid #333;

  border-radius: 12px;

  text-align: center;

  cursor: pointer;

  font-size: 14px;

  color: #ffffff;

  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
}

.dest-btn:active {
  transform: scale(0.98);
}

.dest-btn.active {
  border-color: #ffc107;

  background: #332200;

  color: #ffc107;
}

.loading {
  color: #999;

  padding: 15px 5px;

  text-align: center;

  grid-column: 1 / -1;
}

.no-room {
  color: #888;

  font-size: 13px;

  line-height: 1.5;

  margin-top: 8px;

  grid-column: 1 / -1;
}

.btn {
  background: #ffc107;

  color: #000000;

  padding: 16px;

  border: none;

  border-radius: 12px;

  width: 100%;

  font-weight: 700;

  margin-top: 25px;

  font-size: 16px;

  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;

  cursor: not-allowed;
}

#status {
  margin-top: 15px;

  color: #4caf50;

  text-align: center;

  font-size: 14px;

  line-height: 1.5;
}

.status-error {
  color: #ff5252 !important;
}

.status-info {
  color: #ffc107 !important;
}

</style>

</head>

<body>

<div class="container">

  <h2>📦 Partager vers MAHOUTO+</h2>

  <div class="file-count">
    ${fileCount}/10 fichiers reçus
  </div>

  <input
    id="caption"
    type="text"
    maxlength="500"
    placeholder="Ajouter une légende..."
    autocomplete="off"
  >

  <h3>DESTINATION</h3>

  <div
    class="dest-grid"
    id="dest-list"
  >
    <div class="loading">
      Chargement des salons...
    </div>
  </div>

  <button
    class="btn"
    id="send-btn"
    type="button"
  >
    Envoyer vers MAHOUTO+
  </button>

  <p id="status"></p>

</div>


<script>

/* ============================================================
   CONFIGURATION SUPABASE
   ============================================================ */

const SUPABASE_URL =
  "https://kbnhmddwiimkjaehiwyi.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu";


/* ============================================================
   INITIALISATION SUPABASE
   ============================================================ */

let supabaseClient = null;

try {

  if (
    window.supabase &&
    typeof window.supabase.createClient === "function"
  ) {

    supabaseClient =
      window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      );

  }

} catch (error) {

  console.error(
    "Erreur initialisation Supabase :",
    error
  );

}


/* ============================================================
   VARIABLES
   ============================================================ */

let selectedDest = "general";

const destList =
  document.getElementById("dest-list");

const sendButton =
  document.getElementById("send-btn");

const statusElement =
  document.getElementById("status");

const captionInput =
  document.getElementById("caption");


/* ============================================================
   AFFICHER LE STATUT
   ============================================================ */

function setStatus(message, type = "success") {

  statusElement.innerText = message;

  statusElement.classList.remove(
    "status-error",
    "status-info"
  );

  if (type === "error") {

    statusElement.classList.add(
      "status-error"
    );

  }

  if (type === "info") {

    statusElement.classList.add(
      "status-info"
    );

  }

}


/* ============================================================
   AJOUTER UN SALON
   ============================================================ */

function addDestination(id, name) {

  const button =
    document.createElement("div");

  button.className = "dest-btn";

  button.dataset.dest = id;

  button.innerText = name;

  button.addEventListener(
    "click",
    function () {

      document
        .querySelectorAll(".dest-btn")
        .forEach(function (item) {

          item.classList.remove("active");

        });

      button.classList.add("active");

      selectedDest = id;

      console.log(
        "Destination sélectionnée :",
        selectedDest
      );

    }
  );

  destList.appendChild(button);

}


/* ============================================================
   INITIALISATION DES DESTINATIONS
   ============================================================ */

async function init() {

  try {

    destList.innerHTML = "";

    /* --------------------------------------------------------
       1. Salons par défaut
       -------------------------------------------------------- */

    addDestination(
      "general",
      "🏠 Général"
    );

    addDestination(
      "support",
      "🆘 Support"
    );

    addDestination(
      "annonces",
      "📢 Annonces"
    );


    /* --------------------------------------------------------
       2. Vérifier Supabase
       -------------------------------------------------------- */

    if (!supabaseClient) {

      const warning =
        document.createElement("div");

      warning.className = "no-room";

      warning.innerText =
        "Les salons personnalisés ne peuvent pas être chargés.";

      destList.appendChild(warning);

    } else {

      /* ------------------------------------------------------
         CORRECTION IMPORTANTE :
         récupération correcte de l'utilisateur
         ------------------------------------------------------ */

      let user = null;

      try {

        const result =
          await supabaseClient.auth.getUser();

        if (
          result &&
          result.data
        ) {

          user = result.data.user || null;

        }

      } catch (authError) {

        console.error(
          "Erreur récupération utilisateur :",
          authError
        );

      }


      /* ------------------------------------------------------
         3. Charger les salons uniquement si connecté
         ------------------------------------------------------ */

      if (user) {

        try {

          const result =
            await supabaseClient
              .from("rooms")
              .select("id, name")
              .order("name", {
                ascending: true
              });


          if (
            result &&
            result.error
          ) {

            console.error(
              "Erreur chargement salons :",
              result.error
            );

          } else if (
            result &&
            Array.isArray(result.data)
          ) {

            result.data.forEach(
              function (room) {

                if (
                  room &&
                  room.id &&
                  room.name
                ) {

                  addDestination(
                    "room-" + room.id,
                    "👥 " + room.name
                  );

                }

              }
            );

          }

        } catch (roomError) {

          console.error(
            "Erreur lecture rooms :",
            roomError
          );

        }

      } else {

        const message =
          document.createElement("div");

        message.className = "no-room";

        message.innerText =
          "Connecte-toi dans MAHOUTO+ pour voir tes salons personnalisés.";

        destList.appendChild(message);

      }

    }


    /* --------------------------------------------------------
       4. Général sélectionné par défaut
       -------------------------------------------------------- */

    const generalButton =
      document.querySelector(
        '[data-dest="general"]'
      );

    if (generalButton) {

      generalButton.classList.add("active");

    }

    selectedDest = "general";

  } catch (error) {

    console.error(
      "Erreur initialisation partage :",
      error
    );

    destList.innerHTML = "";

    addDestination(
      "general",
      "🏠 Général"
    );

    addDestination(
      "support",
      "🆘 Support"
    );

    addDestination(
      "annonces",
      "📢 Annonces"
    );

    const generalButton =
      document.querySelector(
        '[data-dest="general"]'
      );

    if (generalButton) {

      generalButton.classList.add("active");

    }

    selectedDest = "general";

    setStatus(
      "Les salons par défaut sont disponibles.",
      "info"
    );

  }

}


/* ============================================================
   ENVOI
   ============================================================ */

sendButton.addEventListener(
  "click",
  async function () {

    try {

      if (!selectedDest) {

        setStatus(
          "❌ Choisis une destination.",
          "error"
        );

        return;

      }


      sendButton.disabled = true;

      setStatus(
        "Envoi en cours..."
      );


      const caption =
        captionInput.value.trim();


      console.log(
        "Destination :",
        selectedDest
      );

      console.log(
        "Légende :",
        caption
      );

      console.log(
        "Nombre de fichiers reçus :",
        ${fileCount}
      );


      /* ======================================================
         POUR L'INSTANT :
         confirmation de fonctionnement de l'interface.

         L'intégration réelle de l'upload sera ajoutée ensuite.
         ====================================================== */

      await new Promise(
        function (resolve) {

          setTimeout(
            resolve,
            1000
          );

        }
      );


      setStatus(
        "✅ Interface de partage fonctionnelle. Destination : " +
        selectedDest
      );


    } catch (error) {

      console.error(
        "Erreur envoi :",
        error
      );

      setStatus(
        "❌ Une erreur est survenue pendant l'envoi.",
        "error"
      );

    } finally {

      sendButton.disabled = false;

    }

  }
);


/* ============================================================
   LANCER L'APPLICATION
   ============================================================ */

init();

</script>

</body>

</html>
  `);
}
