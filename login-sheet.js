/* =========================================================
   login-sheet.js — connexion Google ou par e-mail depuis un lien de salon
   (chat.html, discussions.html) et retour au même salon.

   - Fenêtre en bas d'écran : « Continuer avec Google » et « adresse e-mail,
     puis code à saisir » (même fonctionnement que l'accueil : signInWithOtp
     puis verifyOtp ; code de CODE_LENGTH chiffres, comme dans index.html).
     Pas de connexion anonyme, pas de pseudo à saisir, pas de téléphone.
   - Messages d'erreur EXACTS selon la cause (réseau, code incorrect ou
     expiré, trop de demandes, adresse invalide, compte désactivé…), jamais
     de renvoi vers config.js. Le code technique est ajouté pour les cas
     inconnus, afin que le support puisse diagnostiquer.
   - Les messages d'envoi du code ne révèlent jamais si une adresse a déjà un
     compte (comme index.html).
   - Retour au salon : l'adresse de retour est celle de la page
     (redirectTo) ET une copie de secours en sessionStorage (10 minutes,
     usage unique, uniquement « chat.html?room=<identifiant> » : aucune
     redirection ouverte).
   Tout est écrit avec textContent ; aucun innerHTML ; aucun journal console
   d'adresse e-mail ni de code.
   ========================================================= */
(function (root) {
  "use strict";

  // Longueur du code reçu par e-mail : celle d'index.html (maxlength="6", slice(0, 6), « code à 6 chiffres »).
  // Un test compare cette valeur à celle de index.html.
  var CODE_LENGTH = 6;
  var RESEND_DELAY = 30; // secondes, comme index.html
  var RETURN_KEY = "mahouto:return-to";
  var RETURN_TTL_MS = 10 * 60 * 1000;
  var RETURN_RE = /^chat\.html\?room=[A-Za-z0-9_-]{1,64}$/;

  // ---------- Messages d'erreur ----------
  function isNetworkError(error) {
    if (!error) return false;
    var text = String(error.message || "") + " " + String(error.name || "");
    if (/failed to fetch|networkerror|network request failed|load failed|AuthRetryableFetchError|fetch failed/i.test(text)) return true;
    return root.navigator && root.navigator.onLine === false;
  }

  /**
   * Message exact pour une erreur d'authentification.
   * context : "send" (envoi du code), "verify" (saisie du code), "google" (connexion Google).
   */
  function authErrorMessage(error, context) {
    var code = String((error && (error.code || error.error_code)) || "");
    var status = Number(error && error.status);
    var text = String((error && error.message) || "");

    if (isNetworkError(error)) return "Pas de connexion internet. Vérifie ton réseau puis réessaie.";
    if (status === 429 || /rate_limit/i.test(code) || /rate limit|too many/i.test(text)) {
      return context === "verify"
        ? "Trop de tentatives. Attends quelques minutes avant de réessayer."
        : "Trop de demandes. Attends quelques minutes avant de redemander un code.";
    }
    if (code === "user_banned" || /user (is )?banned/i.test(text)) return "Ce compte est désactivé. Contacte-nous pour en savoir plus.";
    if (code === "otp_expired" || /token has expired|invalid.*(token|otp)|otp.*(expired|invalid)/i.test(text)) {
      return "Code incorrect ou expiré. Vérifie le code ou demande-en un nouveau.";
    }
    if (code === "email_address_invalid" || (code === "validation_failed" && context === "send" && /email/i.test(text))) {
      return "Cette adresse e-mail n'est pas valide.";
    }
    if (code === "email_address_not_authorized") return "Cette adresse e-mail ne peut pas recevoir de code pour le moment.";
    if (code === "provider_disabled" || code === "email_provider_disabled" || /provider is not enabled|unsupported provider|provider.*disabled/i.test(text)) {
      return context === "google"
        ? "La connexion Google n'est pas disponible pour le moment."
        : "La connexion par e-mail n'est pas disponible pour le moment.";
    }
    if (context === "verify" && (status === 400 || status === 403 || status === 422)) {
      return "Code incorrect ou expiré. Vérifie le code ou demande-en un nouveau.";
    }
    var detail = code || (isFinite(status) && status ? "HTTP " + status : "inconnu");
    // signup_disabled est volontairement traité comme une erreur générique : un message dédié révélerait
    // qu'une adresse n'a pas de compte.
    return "Connexion impossible (code : " + detail + "). Réessaie ; si ça continue, contacte-nous.";
  }

  // Erreur renvoyée par Google/Supabase dans l'adresse au retour (?error=… ou #error=…).
  function oauthErrorFromUrl(loc) {
    var params = {};
    [String((loc && loc.search) || "").replace(/^\?/, ""), String((loc && loc.hash) || "").replace(/^#/, "")].forEach(function (part) {
      part.split("&").forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf("=");
        var k = i === -1 ? kv : kv.slice(0, i);
        var v = i === -1 ? "" : kv.slice(i + 1);
        try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { /* ignoré */ }
      });
    });
    var err = params.error || params.error_code;
    if (!err) return null;
    var desc = String(params.error_description || "").slice(0, 160);
    if (err === "access_denied" || params.error_code === "access_denied") return "Connexion Google annulée.";
    if (params.error_code === "user_banned") return "Ce compte est désactivé. Contacte-nous pour en savoir plus.";
    return "La connexion Google a échoué" + (desc ? " (" + desc + ")" : " (code : " + err + ")") + ". Réessaie ; si ça continue, contacte-nous.";
  }

  // ---------- Destination de retour ----------
  function validateReturn(path) {
    return typeof path === "string" && RETURN_RE.test(path) ? path : null;
  }

  function rememberReturn(roomId, storage, now) {
    var path = validateReturn("chat.html?room=" + encodeURIComponent(roomId));
    if (!path) return false;
    try { storage.setItem(RETURN_KEY, JSON.stringify({ path: path, t: now || Date.now() })); return true; } catch (e) { return false; }
  }

  // Renvoie la destination mémorisée (une seule fois, 10 minutes au plus) ou null. Efface toujours la valeur.
  function consumeReturn(storage, now) {
    var raw = null;
    try { raw = storage.getItem(RETURN_KEY); storage.removeItem(RETURN_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data.t !== "number") return null;
      if ((now || Date.now()) - data.t > RETURN_TTL_MS || data.t > (now || Date.now()) + 60000) return null;
      return validateReturn(data.path);
    } catch (e) { return null; }
  }

  // ---------- Fenêtre de connexion ----------
  function el(doc, tag, props, children) {
    var node = doc.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k === "class") node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function injectStyle(doc) {
    if (doc.getElementById("ls-style")) return;
    var style = doc.createElement("style");
    style.id = "ls-style";
    style.textContent =
      ".ls-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:90;display:flex;align-items:flex-end;justify-content:center}" +
      ".ls-sheet{width:100%;max-width:480px;background:var(--bg-elevated);color:var(--white);border-radius:20px 20px 0 0;padding:18px 20px max(18px,env(safe-area-inset-bottom));max-height:90vh;overflow-y:auto}" +
      ".ls-sheet h3{color:var(--gold);margin:0 0 6px;font-size:18px}" +
      ".ls-text{font-size:13px;color:var(--text-muted);margin:0 0 12px;line-height:1.45}" +
      ".ls-google{width:100%;min-height:48px;border:none;border-radius:12px;background:#fff;color:#1f1f1f;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}" +
      ".ls-or{text-align:center;color:var(--text-dim);font-size:12px;margin:12px 0}" +
      ".ls-input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:16px;font-family:inherit}" +
      ".ls-code{letter-spacing:8px;text-align:center;font-size:22px}" +
      ".ls-error{min-height:18px;font-size:13px;color:#F87171;margin:8px 0}" +
      ".ls-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}" +
      ".ls-actions button{min-height:44px;padding:10px 18px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--white);font-size:14px;cursor:pointer}" +
      ".ls-actions button.ls-primary{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}" +
      ".ls-actions button:disabled,.ls-google:disabled{opacity:.55;cursor:not-allowed}" +
      ".ls-link{background:none;border:none;color:var(--gold-bright);font-size:13px;cursor:pointer;margin-top:10px;padding:8px 0}" +
      ".ls-hidden{display:none !important}";
    doc.head.appendChild(style);
  }

  /**
   * options : {
   *   doc, win (window : location, sessionStorage), supabase,
   *   roomId (facultatif : mémorisé pour revenir au salon après Google),
   *   redirectPath ("chat.html?room=x" ou "discussions.html" : page de retour de Google),
   *   title (facultatif), onSignedIn(user) : appelé après un code valide
   * }
   * Renvoie { overlay, close }.
   */
  function open(options) {
    var doc = options.doc || root.document;
    var win = options.win || root;
    var supabase = options.supabase;
    injectStyle(doc);

    var pendingEmail = "";
    var resendTimer = null;
    var busy = false;

    var googleBtn = el(doc, "button", { type: "button", class: "ls-google", text: "Continuer avec Google" });
    var googleError = el(doc, "p", { class: "ls-error", role: "alert" });

    var emailInput = el(doc, "input", { type: "email", class: "ls-input", inputmode: "email", autocomplete: "email", autocapitalize: "none", spellcheck: "false", placeholder: "toi@exemple.com", "aria-label": "Adresse e-mail" });
    var error1 = el(doc, "p", { class: "ls-error", role: "alert" });
    var cancelBtn = el(doc, "button", { type: "button", text: "Annuler" });
    var sendBtn = el(doc, "button", { type: "submit", class: "ls-primary", text: "Recevoir mon code" });
    var step1 = el(doc, "form", { novalidate: "novalidate" }, [emailInput, error1, el(doc, "div", { class: "ls-actions" }, [cancelBtn, sendBtn])]);

    var shown = el(doc, "strong", { text: "" });
    var codeInput = el(doc, "input", { type: "text", class: "ls-input ls-code", inputmode: "numeric", pattern: "[0-9]*", maxlength: String(CODE_LENGTH), autocomplete: "one-time-code", placeholder: "••••••", "aria-label": "Code à " + CODE_LENGTH + " chiffres" });
    var error2 = el(doc, "p", { class: "ls-error", role: "alert" });
    var resendBtn = el(doc, "button", { type: "button", text: "Renvoyer le code" });
    var verifyBtn = el(doc, "button", { type: "submit", class: "ls-primary", text: "Vérifier" });
    var changeBtn = el(doc, "button", { type: "button", class: "ls-link", text: "Changer d'adresse" });
    var step2 = el(doc, "form", { class: "ls-hidden", novalidate: "novalidate" }, [
      el(doc, "p", { class: "ls-text" }, [doc.createTextNode("Code envoyé à "), shown, doc.createTextNode(". Il est valable quelques minutes.")]),
      codeInput, error2, el(doc, "div", { class: "ls-actions" }, [resendBtn, verifyBtn]), changeBtn
    ]);

    var sheet = el(doc, "div", { class: "ls-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Se connecter" }, [
      el(doc, "h3", { text: options.title || "Se connecter pour écrire" }),
      el(doc, "p", { class: "ls-text", text: "Connecte-toi avec Google, ou avec ton adresse e-mail : nous t'envoyons un code à " + CODE_LENGTH + " chiffres. Si tu n'as pas encore de compte, il sera créé automatiquement." }),
      googleBtn, googleError,
      el(doc, "div", { class: "ls-or", text: "— ou —" }),
      step1, step2
    ]);
    var overlay = el(doc, "div", { class: "ls-overlay" }, [sheet]);

    function stopTimer() {
      if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
      resendBtn.disabled = false;
      resendBtn.textContent = "Renvoyer le code";
    }
    function startTimer() {
      stopTimer();
      var left = RESEND_DELAY;
      resendBtn.disabled = true;
      resendBtn.textContent = "Renvoyer (" + left + " s)";
      resendTimer = setInterval(function () {
        left--;
        if (left <= 0) stopTimer(); else resendBtn.textContent = "Renvoyer (" + left + " s)";
      }, 1000);
    }
    function close() {
      stopTimer();
      codeInput.value = "";   // le code n'est jamais conservé
      pendingEmail = "";
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function showStep(n) {
      step1.classList.toggle("ls-hidden", n !== 1);
      step2.classList.toggle("ls-hidden", n !== 2);
      error1.textContent = ""; error2.textContent = ""; googleError.textContent = "";
    }

    async function sendCode(email) {
      var res = await supabase.auth.signInWithOtp({ email: email });
      if (res.error) throw res.error;
    }

    googleBtn.addEventListener("click", async function () {
      if (busy) return;
      busy = true;
      googleError.textContent = "";
      googleBtn.disabled = true;
      googleBtn.textContent = "Redirection vers Google…";
      try {
        if (options.roomId) rememberReturn(options.roomId, win.sessionStorage);
        var res = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: win.location.origin + "/" + (options.redirectPath || "") }
        });
        if (res && res.error) throw res.error;
        // Sinon : le navigateur quitte la page vers Google.
      } catch (err) {
        googleError.textContent = authErrorMessage(err, "google");
        googleBtn.disabled = false;
        googleBtn.textContent = "Continuer avec Google";
      }
      busy = false;
    });

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    step1.addEventListener("submit", async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (busy) return;
      var email = String(emailInput.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error1.textContent = "Entre une adresse e-mail valide."; return; }
      error1.textContent = "";
      busy = true; sendBtn.disabled = true; sendBtn.textContent = "Envoi en cours…";
      try {
        await sendCode(email);
        pendingEmail = email;
        shown.textContent = email;
        codeInput.value = "";
        showStep(2);
        startTimer();
        if (codeInput.focus) codeInput.focus();
      } catch (err) {
        error1.textContent = authErrorMessage(err, "send");
      }
      busy = false; sendBtn.disabled = false; sendBtn.textContent = "Recevoir mon code";
    });

    codeInput.addEventListener("input", function () {
      codeInput.value = String(codeInput.value).replace(/\D/g, "").slice(0, CODE_LENGTH);
      error2.textContent = "";
    });

    step2.addEventListener("submit", async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (busy) return;
      var code = String(codeInput.value || "").trim();
      if (code.length !== CODE_LENGTH) { error2.textContent = "Entre le code à " + CODE_LENGTH + " chiffres reçu par e-mail."; return; }
      error2.textContent = "";
      busy = true; verifyBtn.disabled = true; verifyBtn.textContent = "Vérification…";
      try {
        var res = await supabase.auth.verifyOtp({ email: pendingEmail, token: code, type: "email" });
        if (res.error) throw res.error;
        var user = (res.data && (res.data.user || (res.data.session && res.data.session.user))) || null;
        close();
        if (options.onSignedIn) await options.onSignedIn(user);
      } catch (err) {
        error2.textContent = authErrorMessage(err, "verify");
        if (codeInput.focus) codeInput.focus();
      }
      busy = false; verifyBtn.disabled = false; verifyBtn.textContent = "Vérifier";
    });

    resendBtn.addEventListener("click", async function () {
      if (!pendingEmail || resendBtn.disabled || busy) return;
      error2.textContent = "";
      resendBtn.disabled = true;
      try { await sendCode(pendingEmail); codeInput.value = ""; startTimer(); }
      catch (err) { error2.textContent = authErrorMessage(err, "send"); stopTimer(); }
    });

    changeBtn.addEventListener("click", function () {
      stopTimer(); codeInput.value = ""; pendingEmail = "";
      showStep(1);
      if (emailInput.focus) emailInput.focus();
    });

    doc.body.appendChild(overlay);
    if (emailInput.focus) emailInput.focus();
    return { overlay: overlay, close: close, elements: { googleBtn: googleBtn, emailInput: emailInput, step1: step1, step2: step2, codeInput: codeInput, error1: error1, error2: error2, googleError: googleError, resendBtn: resendBtn } };
  }

  var api = {
    CODE_LENGTH: CODE_LENGTH, RESEND_DELAY: RESEND_DELAY, RETURN_KEY: RETURN_KEY, RETURN_TTL_MS: RETURN_TTL_MS,
    authErrorMessage: authErrorMessage, oauthErrorFromUrl: oauthErrorFromUrl,
    validateReturn: validateReturn, rememberReturn: rememberReturn, consumeReturn: consumeReturn, open: open
  };
  root.MahoutoLogin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
