// =========================================================
// push-notifications.js — Module réutilisable (24/09/2026)
//
// Usage :
//   <script src="config.js"></script>
//   <script src="push-notifications.js"></script>
//   ...
//   const result = await MahoutoPush.enable(supabase);
//   // result.ok === true si activé avec succès
//
// N'importe et ne modifie aucun autre fichier — ne fait que parler à
// sw.js (déjà enregistré par pwa-install.js) et à /api/push.js.
// =========================================================

window.MahoutoPush = (function () {
  function isSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  // Le navigateur attend la clé publique VAPID sous forme de tableau
  // d'octets, pas la chaîne base64url telle quelle.
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
    return output;
  }

  async function enable(supabase) {
    if (!isSupported()) {
      return { ok: false, reason: "unsupported" };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: "denied" };
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const vapidPublicKey = window.MAHOUTO_CONFIG.VAPID_PUBLIC_KEY;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }

    const subJson = subscription.toJSON();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!accessToken) return { ok: false, reason: "not_logged_in" };

    const resp = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
      body: JSON.stringify({ action: "subscribe", endpoint: subJson.endpoint, keys: subJson.keys })
    });

    if (!resp.ok) return { ok: false, reason: "server_error" };
    return { ok: true };
  }

  // À appeler après l'envoi réussi d'un message en DM, pour prévenir
  // l'autre personne si elle a activé les notifications. Échoue en
  // silence (n'importe jamais la réussite de l'envoi du message
  // lui-même) — un push manqué n'est jamais bloquant.
  async function notifyDm(supabase, { conversationId, title, body, url }) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
      if (!accessToken) return;

      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
        body: JSON.stringify({ action: "send", context: "dm", conversationId, title, body, url })
      });
    } catch (err) {
      console.warn("[PUSH] notifyDm a échoué (non bloquant) :", err);
    }
  }

  return { isSupported, enable, notifyDm };
})();
