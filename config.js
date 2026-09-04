// =========================================================
// MAHOUTO+ — Configuration Supabase + Cloudinary
//
// Supabase :
// Project Settings > API > Project URL et Publishable/Anon Key
//
// Cloudinary :
// - CLOUDINARY_CLOUD_NAME : public
// - CLOUDINARY_UPLOAD_PRESET : public si preset unsigned
//
// ⚠️ IMPORTANT :
// - SUPABASE_ANON_KEY est publique par design.
// - CLOUDINARY_CLOUD_NAME est public.
// - CLOUDINARY_UPLOAD_PRESET est public pour un preset unsigned.
// - NE JAMAIS mettre SUPABASE_SERVICE_ROLE_KEY ici.
// - NE JAMAIS mettre CLOUDINARY_API_SECRET ici.
// =========================================================


// =========================================================
// CONFIGURATION PRINCIPALE
// =========================================================

window.MAHOUTO_CONFIG = {

  // -------------------------------------------------------
  // SUPABASE
  // -------------------------------------------------------

  SUPABASE_URL:
    "https://kbnhmddwiimkjaehiwyi.supabase.co",

  SUPABASE_ANON_KEY:
    "sb_publishable_NGzIuUtP2T-uamuMq5rdSA_RBVfNZWu",


  // -------------------------------------------------------
  // CLOUDINARY
  // -------------------------------------------------------
  //
  // Ces deux valeurs servent à l'upload direct depuis
  // share.html vers Cloudinary.
  //
  // ⚠️ Aucun secret Cloudinary ici.
  //

  CLOUDINARY_CLOUD_NAME:
    "hefa5gqf",

  CLOUDINARY_UPLOAD_PRESET:
    "mahouto_share"
};


// =========================================================
// VALIDATION DE LA CONFIGURATION AU DÉMARRAGE
// =========================================================

(function validateConfig() {

  const requiredKeys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_UPLOAD_PRESET"
  ];

  const placeholders = [
    "TON-PROJET",
    "TON-ANON-KEY",
    "TON_PRESET_UNSIGNED"
  ];


  // -------------------------------------------------------
  // Vérifier que MAHOUTO_CONFIG existe
  // -------------------------------------------------------

  if (!window.MAHOUTO_CONFIG) {

    console.error(
      "❌ MAHOUTO_CONFIG non défini dans config.js"
    );

    showConfigError(
      "Configuration manquante"
    );

    return false;
  }


  // -------------------------------------------------------
  // Vérifier les clés obligatoires
  // -------------------------------------------------------

  for (const key of requiredKeys) {

    if (!window.MAHOUTO_CONFIG[key]) {

      console.error(
        `❌ ${key} manquant dans MAHOUTO_CONFIG`
      );

      showConfigError(
        `${key} manquant`
      );

      return false;
    }
  }


  // -------------------------------------------------------
  // Vérifier les placeholders
  // -------------------------------------------------------

  for (const placeholder of placeholders) {

    for (const key of requiredKeys) {

      const value =
        window.MAHOUTO_CONFIG[key];

      if (
        typeof value === "string" &&
        value.includes(placeholder)
      ) {

        console.error(
          `❌ ${key} contient encore un placeholder : ${placeholder}`
        );

        showConfigError(
          `${key} non configuré`
        );

        return false;
      }
    }
  }


  // -------------------------------------------------------
  // Vérifier l'URL Supabase
  // -------------------------------------------------------

  try {

    const url =
      new URL(
        window.MAHOUTO_CONFIG.SUPABASE_URL
      );

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {

      throw new Error(
        "Protocole invalide"
      );
    }

  } catch (error) {

    console.error(
      "❌ SUPABASE_URL invalide :",
      window.MAHOUTO_CONFIG.SUPABASE_URL
    );

    showConfigError(
      "SUPABASE_URL invalide"
    );

    return false;
  }


  // -------------------------------------------------------
  // Vérifier la clé Supabase
  // -------------------------------------------------------

  if (
    typeof window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY !==
    "string" ||
    window.MAHOUTO_CONFIG.SUPABASE_ANON_KEY.length < 20
  ) {

    console.error(
      "❌ SUPABASE_ANON_KEY semble invalide"
    );

    showConfigError(
      "SUPABASE_ANON_KEY invalide"
    );

    return false;
  }


  // -------------------------------------------------------
  // Vérifier Cloudinary Cloud Name
  // -------------------------------------------------------

  if (
    typeof window.MAHOUTO_CONFIG.CLOUDINARY_CLOUD_NAME !==
    "string" ||
    window.MAHOUTO_CONFIG.CLOUDINARY_CLOUD_NAME.trim()
      .length < 2
  ) {

    console.error(
      "❌ CLOUDINARY_CLOUD_NAME semble invalide"
    );

    showConfigError(
      "CLOUDINARY_CLOUD_NAME invalide"
    );

    return false;
  }


  // -------------------------------------------------------
  // Vérifier le preset Cloudinary
  // -------------------------------------------------------

  if (
    typeof window.MAHOUTO_CONFIG.CLOUDINARY_UPLOAD_PRESET !==
    "string" ||
    window.MAHOUTO_CONFIG.CLOUDINARY_UPLOAD_PRESET.trim()
      .length < 2
  ) {

    console.error(
      "❌ CLOUDINARY_UPLOAD_PRESET semble invalide"
    );

    showConfigError(
      "CLOUDINARY_UPLOAD_PRESET invalide"
    );

    return false;
  }


  // -------------------------------------------------------
  // Configuration valide
  // -------------------------------------------------------

  console.log(
    "✅ Configuration MAHOUTO+ valide"
  );

  console.log(
    "✅ Supabase configuré"
  );

  console.log(
    "✅ Cloudinary configuré"
  );

  return true;

})();


// =========================================================
// AFFICHER UNE ERREUR DE CONFIGURATION
// =========================================================

function showConfigError(message) {

  // -------------------------------------------------------
  // Éviter de créer plusieurs overlays
  // -------------------------------------------------------

  if (
    document.getElementById(
      "mahouto-config-error"
    )
  ) {

    return;
  }


  // -------------------------------------------------------
  // Overlay
  // -------------------------------------------------------

  const overlay =
    document.createElement("div");

  overlay.id =
    "mahouto-config-error";

  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;

    background: rgba(0, 0, 0, 0.92);

    display: flex;
    align-items: center;
    justify-content: center;

    z-index: 99999;

    padding: 20px;

    font-family:
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      Arial,
      sans-serif;

    box-sizing: border-box;
  `;


  // -------------------------------------------------------
  // Contenu
  // -------------------------------------------------------

  const content =
    document.createElement("div");

  content.style.cssText = `
    background: #1A1A1A;

    border:
      2px solid #F87171;

    border-radius: 16px;

    padding: 32px;

    width: 100%;
    max-width: 500px;

    color: #FFFFFF;

    text-align: center;

    box-sizing: border-box;

    box-shadow:
      0 20px 60px rgba(0, 0, 0, 0.5);
  `;


  // -------------------------------------------------------
  // HTML erreur
  // -------------------------------------------------------

  content.innerHTML = `

    <div
      style="
        font-size: 42px;
        margin-bottom: 12px;
      "
    >
      ⚠️
    </div>

    <h1
      style="
        color: #F87171;
        margin:
          0 0 16px 0;
        font-size: 24px;
      "
    >
      Erreur de configuration
    </h1>

    <p
      style="
        margin:
          0 0 24px 0;
        font-size: 16px;
        line-height: 1.6;
        color: #A3A3A3;
      "
    >
      ${escapeHtml(message)}
    </p>

    <div
      style="
        background: #0A0A0A;
        border-radius: 10px;
        padding: 16px;
        margin-bottom: 24px;
        text-align: left;
        font-family:
          'Courier New',
          monospace;
        font-size: 12px;
        color: #A3A3A3;
        line-height: 1.7;
      "
    >

      <p
        style="
          margin:
            0 0 8px 0;
          color: #FFD700;
        "
      >
        <strong>À vérifier :</strong>
      </p>

      <ol
        style="
          margin: 0;
          padding-left: 20px;
        "
      >

        <li>
          Ouvrir
          <code>config.js</code>
        </li>

        <li>
          Vérifier
          <code>SUPABASE_URL</code>
        </li>

        <li>
          Vérifier
          <code>SUPABASE_ANON_KEY</code>
        </li>

        <li>
          Vérifier
          <code>CLOUDINARY_CLOUD_NAME</code>
        </li>

        <li>
          Vérifier
          <code>CLOUDINARY_UPLOAD_PRESET</code>
        </li>

        <li>
          Vérifier que le preset Cloudinary
          <strong>mahouto_share</strong>
          est bien configuré en
          <strong>Unsigned</strong>
        </li>

      </ol>

    </div>

    <p
      style="
        margin: 0;
        font-size: 12px;
        color: #6B6B6B;
      "
    >
      MAHOUTO+ — Configuration
    </p>

  `;


  // -------------------------------------------------------
  // Ajouter au DOM
  // -------------------------------------------------------

  overlay.appendChild(content);

  document.body.appendChild(overlay);


  // -------------------------------------------------------
  // Bloquer le scroll
  // -------------------------------------------------------

  document.body.style.overflow =
    "hidden";
}


// =========================================================
// ÉCHAPPEMENT HTML
// =========================================================

function escapeHtml(value) {

  return String(value)

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );
}


// =========================================================
// EXPORT NODE / COMMONJS
// =========================================================
//
// Permet à certains scripts Node.js de récupérer
// la configuration si nécessaire.
//
// ⚠️ Attention : cette configuration ne contient
// volontairement aucun secret serveur.
// =========================================================

if (
  typeof module !== "undefined" &&
  module.exports
) {

  module.exports =
    window.MAHOUTO_CONFIG;
}
