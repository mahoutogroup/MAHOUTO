/* =========================================================
   payment-return.js — retour d'un paiement de salon (chat.html?room=<salon>&payment=return)

   L'accès à un salon payant ne dépend JAMAIS d'un paramètre d'adresse (payment=return, status=… ajouté
   par FedaPay) : seul un achat « paid » enregistré en base par le webhook ouvre le salon. Ce module ne
   fait que décider quoi afficher et quand réessayer pendant que le webhook arrive.

   - paid    : l'achat est confirmé → la page entre dans le salon ;
   - wait    : achat encore « pending » (le webhook n'est pas arrivé) → « Paiement en cours de vérification »,
               nouvel essai après DELAY_MS, MAX_ATTEMPTS fois au plus ;
   - timeout : toujours rien après les essais → message d'attente et bouton « Vérifier maintenant » ;
   - failed  : paiement échoué ou annulé → message clair, le bouton d'achat redevient disponible.
   Aucun journal console ; aucune donnée privée.
   ========================================================= */
(function (root) {
  "use strict";

  var MAX_ATTEMPTS = 10;     // 10 essais, 3 s d'écart : environ 30 secondes
  var DELAY_MS = 3000;
  var MSG_PENDING = "Paiement en cours de vérification… Ne ferme pas cette page.";
  var MSG_TIMEOUT = "Ton paiement n'est pas encore confirmé. Cela peut prendre quelques minutes : réessaie dans un instant.";
  var MSG_FAILED = "Le paiement a échoué ou a été annulé. Tu peux réessayer.";
  var MSG_PAID = "✅ Paiement confirmé ! Bienvenue dans le salon.";
  var MSG_LOST_SESSION = "Reconnecte-toi avec le compte utilisé pour payer : ton achat sera retrouvé automatiquement.";

  // Vrai si l'adresse porte payment=return (retour du prestataire de paiement).
  function isPaymentReturn(search) {
    return /(?:^|[?&])payment=return(?:&|$)/.test(String(search || ""));
  }

  /**
   * status : état de l'achat le plus récent du compte pour ce salon ('paid' | 'pending' | 'failed' | null/autre).
   * attempt : nombre d'essais déjà faits (0 au premier).
   * Renvoie { kind: 'paid' | 'wait' | 'timeout' | 'failed', message, delayMs? }.
   */
  function decide(status, attempt) {
    if (status === "paid") return { kind: "paid", message: MSG_PAID };
    if (status === "failed") return { kind: "failed", message: MSG_FAILED };
    if (Number(attempt) < MAX_ATTEMPTS) return { kind: "wait", message: MSG_PENDING, delayMs: DELAY_MS };
    return { kind: "timeout", message: MSG_TIMEOUT };
  }

  // État de l'achat le plus récent (lecture de SES propres achats : politique « Lecture achats personnels »).
  // Renvoie { status, error } ; status null s'il n'y a aucun achat.
  async function latestPurchaseStatus(supabase, userId, roomId) {
    var res = await supabase
      .from("purchases")
      .select("status")
      .eq("user_id", userId)
      .eq("course_id", roomId)
      .eq("product_type", "salon")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) return { status: null, error: res.error };
    return { status: res.data ? res.data.status : null, error: null };
  }

  // Adresse du salon sans les paramètres de retour (payment, et ceux ajoutés par le prestataire).
  function cleanPath(pathname, roomId) {
    return String(pathname || "chat.html") + "?room=" + encodeURIComponent(roomId);
  }

  var api = {
    MAX_ATTEMPTS: MAX_ATTEMPTS, DELAY_MS: DELAY_MS,
    MSG_PENDING: MSG_PENDING, MSG_TIMEOUT: MSG_TIMEOUT, MSG_FAILED: MSG_FAILED, MSG_PAID: MSG_PAID, MSG_LOST_SESSION: MSG_LOST_SESSION,
    isPaymentReturn: isPaymentReturn, decide: decide, latestPurchaseStatus: latestPurchaseStatus, cleanPath: cleanPath
  };
  root.MahoutoPaymentReturn = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
