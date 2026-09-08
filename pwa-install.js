/*
 * pwa-install.js — MAHOUTO+
 * -------------------------------------------------------
 * Module partagé par TOUTES les pages de l'app :
 *   1. Enregistre le service worker (une seule fois, un
 *      seul chemin correct : /sw.js).
 *   2. Affiche une bannière "📲 Installer" dès que Chrome
 *      signale que le site est installable, pour éviter
 *      que l'utilisateur passe par le menu ⋮ ambigu
 *      ("Installer l'application" vs "Ajouter à l'écran
 *      d'accueil").
 *
 * Utilisation : ajouter une seule ligne avant </body> :
 *   <script src="pwa-install.js"></script>
 * (depuis un sous-dossier comme /admin/, utiliser
 *  "../pwa-install.js")
 * -------------------------------------------------------
 */
(function () {

  // ===== ENREGISTREMENT SERVICE WORKER =====
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js")
        .then(reg => console.log("SW enregistré:", reg.scope))
        .catch(err => console.log("SW erreur:", err));
    });
  }

  // Déjà installée (mode standalone) : rien de plus à faire.
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  // ===== BANNIÈRE D'INSTALLATION (créée dynamiquement) =====
  let banner = null;
  let deferredPrompt = null;

  function injectBanner() {
    const style = document.createElement("style");
    style.textContent = `
      #pwa-install-banner{position:fixed;left:12px;right:12px;bottom:12px;
        z-index:99998;margin:0;padding:14px 16px;border-radius:16px;
        background:#1A1A1A;border:1px solid #2A2A2A;display:flex;
        align-items:center;justify-content:space-between;gap:12px;
        box-shadow:0 10px 30px rgba(0,0,0,0.4);
        font-family:inherit;}
      #pwa-install-banner.hidden{display:none;}
      #pwa-install-banner .pwa-install-text{display:flex;flex-direction:column;gap:2px;}
      #pwa-install-banner strong{font-size:14px;color:#FFFFFF;}
      #pwa-install-banner span{font-size:11.5px;color:#9A9A9A;}
      #pwa-install-banner button{white-space:nowrap;padding:10px 14px;
        border:none;border-radius:12px;background:#FFD700;color:#0A0A0A;
        font-weight:bold;cursor:pointer;font-size:13px;}
    `;
    document.head.appendChild(style);

    const el = document.createElement("div");
    el.id = "pwa-install-banner";
    el.className = "hidden";
    el.innerHTML = `
      <div class="pwa-install-text">
        <strong>Installer MAHOUTO+</strong>
        <span>Accès rapide depuis ton écran d'accueil, même hors ligne.</span>
      </div>
      <button id="btn-pwa-install">📲 Installer</button>
    `;
    document.body.appendChild(el);

    document.getElementById("btn-pwa-install").addEventListener("click", async () => {
      if (!deferredPrompt) return;
      el.classList.add("hidden");
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log("Choix installation :", outcome);
      deferredPrompt = null;
    });

    return el;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!banner) banner = injectBanner();
    banner.classList.remove("hidden");
    console.log("PWA prête à installer");
  });

  window.addEventListener("appinstalled", () => {
    if (banner) banner.classList.add("hidden");
    console.log("MAHOUTO+ installée ✅");
  });

})();
