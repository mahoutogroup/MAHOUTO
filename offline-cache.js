/* =========================================================
   MAHOUTO+ — Cache local léger (IndexedDB) pour la lecture hors
   connexion des pages "ce que je possède" (certificats, achats).
   =========================================================
   Principe volontairement simple : on ne réplique PAS toute la base
   de données côté appareil (ça, c'est un vrai chantier à part —
   voir la discussion sur le hors-connexion façon WhatsApp). On stocke
   juste, par page, le dernier résultat déjà assemblé et prêt à
   afficher (ex: la liste finale des certificats). Dès qu'il y a du
   réseau, la page redemande les vraies données et met à jour ce
   cache — hors connexion, elle affiche ce qui a été vu la dernière
   fois, plutôt qu'un écran vide ou bloqué sur "Chargement...".
   ========================================================= */

window.MahoutoOfflineCache = (function () {
  const DB_NAME = "mahoutoplus-offline";
  const STORE_NAME = "snapshots";
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB non disponible sur ce navigateur"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Enregistre les données (déjà prêtes à afficher) sous une clé de
  // page (ex: "certificates", "mes-achats"), avec la date d'enregistrement.
  async function save(key, data) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({ key, data, savedAt: new Date().toISOString() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      // Le cache est une amélioration, jamais un prérequis — une
      // écriture qui échoue ne doit jamais casser la page.
      console.warn("[OFFLINE CACHE] écriture impossible :", err.message);
    }
  }

  // Renvoie { data, savedAt } ou null si rien n'est encore en cache
  // pour cette clé (ou si IndexedDB est indisponible).
  async function load(key) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ? { data: req.result.data, savedAt: req.result.savedAt } : null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("[OFFLINE CACHE] lecture impossible :", err.message);
      return null;
    }
  }

  return { save, load };
})();
