export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  let fileCount = 0;

  /*
   * ============================================================
   * 1. RÉCEPTION DU SHARE TARGET
   * ============================================================
   *
   * On ne convertit plus tout le fichier en grosse chaîne de
   * caractères. On lit uniquement les chunks pour permettre à
   * la requête POST d'être consommée proprement.
   */

  if (req.method === "POST") {
    try {
      let totalSize = 0;
      const MAX_SAFE_SIZE = 4 * 1024 * 1024; // 4 Mo

      for await (const chunk of req) {
        totalSize += chunk.length;

        /*
         * On évite de conserver tout le fichier en mémoire.
         * On cherche seulement les signatures filename=".
         */
        const text = chunk.toString("latin1");

        const matches = text.match(/filename="/g);

        if (matches) {
          fileCount += matches.length;
        }

        /*
         * On continue de consommer la requête mais on ne garde
         * jamais les fichiers en mémoire.
         */
      }

      /*
       * Le navigateur peut envoyer plusieurs fichiers.
       * Le nombre réel sera également contrôlé côté client.
       */
      if (fileCount > 10) {
        fileCount = 10;
      }

      /*
       * Information indicative uniquement.
       * L'upload réel sera effectué dans une prochaine étape.
       */
      if (totalSize > MAX_SAFE_SIZE) {
        // Ne pas provoquer d'erreur ici.
        // La page sera quand même affichée.
      }
    } catch (error) {
      console.error("Share Target reception error:", error);
    }
  }

  /*
   * ============================================================
   * 2. RÉPONSE HTML
   * ============================================================
   */

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  res.status(200).send(`
<!DOCTYPE html>
<html lang="fr">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <meta
    name="theme-color"
    content="#FFC107"
  >

  <title>Partager vers MAHOUTO+</title>

  <script
    src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js">
  </script>

  <style>

    * {
      box-sizing: border-box;
    }

    body {
      background: #0A0A0A;
      color: #FFFFFF;
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      min-height: 100vh;
    }

    .container {
      width: 100%;
      max-width: 700px;
      margin: 0 auto;
    }

    h2 {
      color: #FFC107;
      margin-top: 10px;
      margin-bottom: 8px;
      font-size: 25px;
    }

    .file-info {
      color: #BBBBBB;
      font-size: 15px;
      margin-bottom: 20px;
    }

    input {
      width: 100%;
      padding: 15px;
      margin-top: 5px;
      border-radius: 12px;
      border: 1px solid #333333;
      background: #181818;
      color: #FFFFFF;
      font-size: 16px;
      outline: none;
    }

    input:focus {
      border-color: #FFC107;
    }

    h3 {
      margin-top: 30px;
      margin-bottom: 12px;
      font-size: 18px;
    }

    .dest-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
      max-height: 350px;
      overflow-y: auto;
    }

    .dest-btn {
      padding: 14px 10px;
      background: #181818;
      border: 1px solid #333333;
      border-radius: 12px;
      color: #FFFFFF;
      text-align: center;
      cursor: pointer;
      font-size: 14px;
      min-height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: 0.2s;
    }

    .dest-btn:active {
      transform: scale(0.98);
    }

    .dest-btn.active {
      border-color: #FFC107;
      background: #332600;
      color: #FFC107;
      box-shadow: 0 0 0 1px #FFC107 inset;
    }

    .loading {
      grid-column: 1 / -1;
      padding: 20px;
      text-align: center;
      color: #AAAAAA;
    }

    .empty {
      grid-column: 1 / -1;
      padding: 20px;
      text-align: center;
      color: #888888;
      font-size: 14px;
    }

    .btn {
      background: #FFC107;
      color: #000000;
      padding: 16px;
      border: none;
      border-radius: 12px;
      width: 100%;
      font-weight: bold;
      margin-top: 25px;
      font-size: 17px;
      cursor: pointer;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #status {
      margin-top: 15px;
      text-align: center;
      min-height: 24px;
      font-size: 14px;
    }

    .success {
      color: #4CAF50;
    }

    .error {
      color: #F44336;
    }

    .warning {
      color: #FFC107;
    }

  </style>

</head>

<body>

<div class="container">

  <h2>📦 Partager vers MAHOUTO+</h2>

  <div class="file-info">
    <span id="file-count">
      ${fileCount}/10 fichiers reçus
    </span>
  </div>

  <input
    id="caption"
    type="text"
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
    disabled
  >
    Envoyer vers MAHOUTO+
  </button>

  <div id="status"></div>

</div>


<script>

/*
 * ============================================================
 * CONFIGURATION SUPABASE
 * ============================================================
 */

const SUPABASE_URL =
  "https://kbnhmddwiimkjaehiwyi.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu";


/*
 * Création du client Supabase
 */

const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );


/*
 * Destination sélectionnée
 */

let selectedDest = "general";


/*
 * Éléments HTML
 */

const destList =
  document.getElementById("dest-list");

const sendButton =
  document.getElementById("send-btn");

const status =
  document.getElementById("status");

const caption =
  document.getElementById("caption");


/*
 * ============================================================
 * AFFICHER UN MESSAGE
 * ============================================================
 */

function showStatus(message, type = "") {

  status.className = type;

  status.textContent = message;

}


/*
 * ============================================================
 * AJOUTER UN SALON
 * ============================================================
 */

function addDestination(id, name) {

  const button =
    document.createElement("div");

  button.className = "dest-btn";

  button.dataset.dest = id;

  button.textContent = name;


  /*
   * Sélection du salon
   */

  button.addEventListener("click", () => {

    document
      .querySelectorAll(".dest-btn")
      .forEach((btn) => {
        btn.classList.remove("active");
      });

    button.classList.add("active");

    selectedDest = id;

    sendButton.disabled = false;

    showStatus("");

  });


  destList.appendChild(button);

}


/*
 * ============================================================
 * INITIALISATION
 * ============================================================
 */

async function init() {

  try {

    /*
     * --------------------------------------------------------
     * Vérification de la session Supabase
     * --------------------------------------------------------
     */

    const {
      data: sessionData,
      error: sessionError
    } = await supabaseClient.auth.getSession();


    if (sessionError) {

      console.error(
        "Supabase session error:",
        sessionError
      );

    }


    const session =
      sessionData?.session || null;

    const user =
      session?.user || null;


    /*
     * --------------------------------------------------------
     * Nettoyage
     * --------------------------------------------------------
     */

    destList.innerHTML = "";


    /*
     * --------------------------------------------------------
     * SALONS PAR DÉFAUT
     * --------------------------------------------------------
     */

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


    /*
     * --------------------------------------------------------
     * SALONS SUPABASE
     * --------------------------------------------------------
     */

    if (user) {

      try {

        const {
          data: rooms,
          error: roomsError
        } = await supabaseClient
          .from("rooms")
          .select("id, name")
          .order("name", {
            ascending: true
          });


        if (roomsError) {

          console.error(
            "Erreur chargement rooms:",
            roomsError
          );

        } else if (
          Array.isArray(rooms)
        ) {

          rooms.forEach((room) => {

            if (!room?.id) {
              return;
            }

            addDestination(
              `room-${room.id}`,
              `👥 ${room.name || "Salon"}`
            );

          });

        }

      } catch (error) {

        console.error(
          "Erreur rooms:",
          error
        );

      }

    } else {

      const message =
        document.createElement("div");

      message.className = "empty";

      message.textContent =
        "Connecte-toi dans MAHOUTO+ pour voir tes salons.";

      destList.appendChild(message);

    }


    /*
     * --------------------------------------------------------
     * SÉLECTIONNER GÉNÉRAL PAR DÉFAUT
     * --------------------------------------------------------
     */

    const generalButton =
      document.querySelector(
        '[data-dest="general"]'
      );


    if (generalButton) {

      generalButton.classList.add("active");

      selectedDest = "general";

      sendButton.disabled = false;

    }


    /*
     * --------------------------------------------------------
     * FIN CHARGEMENT
     * --------------------------------------------------------
     */

    console.log(
      "MAHOUTO+ Share Target initialisé"
    );

    console.log(
      "Utilisateur:",
      user?.id || "non connecté"
    );

    console.log(
      "Destination:",
      selectedDest
    );

  } catch (error) {

    console.error(
      "Erreur initialisation Share Target:",
      error
    );


    destList.innerHTML = `
      <div class="empty">
        Impossible de charger les salons.
        <br>
        Vérifie ta connexion Internet.
      </div>
    `;

    /*
     * Général reste disponible
     */

    selectedDest = "general";

    sendButton.disabled = false;

    showStatus(
      "⚠️ Les salons personnalisés ne sont pas disponibles.",
      "warning"
    );

  }

}


/*
 * ============================================================
 * ENVOI
 * ============================================================
 *
 * IMPORTANT :
 * Pour cette première version, nous ne faisons PAS encore
 * l'upload réel des fichiers.
 *
 * Nous allons ajouter l'upload direct dans l'étape suivante.
 * ============================================================
 */

sendButton.addEventListener(
  "click",
  async () => {

    if (!selectedDest) {

      showStatus(
        "❌ Choisis une destination.",
        "error"
      );

      return;
    }


    sendButton.disabled = true;

    showStatus(
      "Envoi en préparation..."
    );


    try {

      const text =
        caption.value.trim();


      /*
       * Pour l'instant, on prépare seulement les informations.
       */

      console.log(
        "Destination:",
        selectedDest
      );

      console.log(
        "Légende:",
        text
      );


      /*
       * Simulation temporaire.
       *
       * CETTE PARTIE SERA REMPLACÉE par le vrai upload
       * Cloudinary/Supabase.
       */

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 1000)
      );


      showStatus(
        "✅ Destination sélectionnée : " +
        selectedDest,
        "success"
      );


    } catch (error) {

      console.error(
        "Erreur envoi:",
        error
      );

      showStatus(
        "❌ Une erreur est survenue.",
        "error"
      );

    } finally {

      sendButton.disabled = false;

    }

  }
);


/*
 * ============================================================
 * LANCEMENT
 * ============================================================
 */

init();

</script>

</body>
</html>
  `);
}
