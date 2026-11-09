/* =========================================================
   speech-reader.js — lecture à voix haute d'un message texte (bouton 🔊 de chat.html)

   Utilise UNIQUEMENT la voix intégrée à l'appareil (Web Speech API, speechSynthesis).
   Aucun appel réseau, aucune clé, aucune API externe : le texte ne quitte jamais l'appareil.

   - Le texte lu est celui du message seulement (jamais un nom de fichier ni une adresse) ;
     un lien est dit « lien ».
   - Un seul message à la fois ; lire un autre message arrête le précédent.
   - Texte découpé en morceaux (phrases) lus l'un après l'autre : certains navigateurs
     coupent sans bruit les longs textes. Au plus MAX_CHARS caractères lus, puis arrêt propre.
   - Langue fr-FR, voix française choisie si l'appareil en propose une.
   - Aucune lecture, aucun bouton si speechSynthesis est absent (navigateurs intégrés, anciens navigateurs).
   - Rien dans ce fichier n'écrit du HTML (pas d'innerHTML) ; aucun journal console.
   ========================================================= */
(function (root) {
  "use strict";

  var MAX_CHARS = 1000;      // au plus 1 000 caractères lus
  var CHUNK_MAX = 180;       // taille maximale d'un morceau
  var LANG = "fr-FR";
  var VOICES_WAIT_MS = 1500; // attente maximale des voix (événement voiceschanged)
  var LINK_WORD = "lien";
  var MSG_NO_FRENCH_VOICE = "Aucune voix française n'est installée sur ton téléphone.";

  // Adresses : http(s)://…, www.…, et domaines courants « mahouto.com/… ».
  var URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|app|me|fr|co|tg|bj|ci|sn|cm)\b(?:\/[^\s<>"']*)?/gi;

  // Texte à lire : liens remplacés par « lien », espaces réduits, bords nettoyés.
  function cleanText(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(URL_RE, LINK_WORD)
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2028\u2029\ufeff]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Sigles gardés EN MAJUSCULES : la voix les épelle (« I A », « P D F »). Liste simple, à compléter au besoin
  // (en majuscules, sans accent obligatoire). Les mots de 1 ou 2 lettres (IA, TV, PC, CV, QR, RH…) restent de toute façon tels quels.
  var SPELLED_ACRONYMS = [
    "IA", "PDF", "SMS", "MMS", "USB", "QR", "CV", "TVA", "TTC", "IFU", "RCCM", "OAPI", "NIF", "RIB", "SARL", "SIM",
    "URL", "API", "GPS", "HTML", "CSS", "PNG", "JPG", "JPEG", "SVG", "EPS", "GIF", "FAQ", "VIP", "SOS",   // WiFi (casse normale) n'a pas besoin d'être listé
    "PC", "TV", "RH", "ONG", "PME", "CEO", "LED", "PVC", "MDR", "PTDR",
    "FCFA", "CFA", "XOF", "XAF", "EUR", "USD",
    "CMJN", "CMYK", "RVB", "RGB", "DTF", "DTG", "PAO", "PLV", "BAT"
  ];
  var SPELLED_SET = {};
  SPELLED_ACRONYMS.forEach(function (a) { SPELLED_SET[a] = true; });

  // Un mot « tout en majuscules » : au moins 1 lettre, uniquement des lettres (accentuées comprises), toutes majuscules.
  var WORD_RE = /[\p{L}\p{N}_]+/gu;
  function isAllCapsWord(w) {
    return /^\p{Lu}+$/u.test(w);
  }

  /**
   * Texte envoyé à la voix : un mot tout en majuscules de 3 lettres ou plus est mis en minuscules pour être
   * prononcé comme un mot (MAHOUTO → mahouto, MAJESTÉ → majesté), sauf s'il est dans SPELLED_ACRONYMS (épelé).
   * 1 ou 2 lettres : inchangé. Mots mêlés (Mahouto, iPhone, WhatsApp), mots avec chiffres (A4), nombres,
   * ponctuation et « + » : inchangés. Ne sert QU'À la voix : le message affiché n'est jamais modifié.
   */
  function normalizeCaps(text) {
    if (typeof text !== "string") return "";
    return text.replace(WORD_RE, function (w) {
      if (w.length < 3 || !isAllCapsWord(w) || SPELLED_SET[w]) return w;
      return w.toLowerCase();
    });
  }

  // Un message a-t-il un bouton ? Pas s'il est supprimé, sans texte, ou vide une fois nettoyé.
  function canListen(msg) {
    if (!msg || msg.is_deleted === true) return false;
    return cleanText(msg.content).length > 0;
  }

  // Coupe un texte trop long à MAX_CHARS, de préférence en fin de phrase ou de mot.
  function limitText(text, max) {
    var limit = max || MAX_CHARS;
    if (text.length <= limit) return text;
    var cut = text.slice(0, limit);
    var sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (sentence > limit * 0.5) return cut.slice(0, sentence + 1);
    var space = cut.lastIndexOf(" ");
    return (space > limit * 0.5 ? cut.slice(0, space) : cut).trim();
  }

  // Morceaux de texte (phrases regroupées jusqu'à maxLen). Un mot plus long que maxLen est coupé net.
  function splitChunks(text, maxLen) {
    var max = maxLen || CHUNK_MAX;
    var clean = cleanText(text);
    if (!clean) return [];
    clean = normalizeCaps(clean);
    clean = limitText(clean, MAX_CHARS);
    var sentences = clean.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) || [clean];
    var chunks = [];
    var current = "";
    function push() { var c = current.trim(); if (c) chunks.push(c); current = ""; }
    sentences.forEach(function (s) {
      s = s.replace(/\s+/g, " ");
      if (s.trim() === "") return;
      if (s.length > max) {
        push();
        s.split(" ").forEach(function (w) {
          while (w.length > max) { if (current) push(); chunks.push(w.slice(0, max)); w = w.slice(max); }
          if ((current + " " + w).trim().length > max) push();
          current = current ? current + " " + w : w;
        });
        push();
        return;
      }
      if ((current + s).trim().length > max) push();
      current += s;
    });
    push();
    return chunks;
  }

  // speechSynthesis et SpeechSynthesisUtterance utilisables ?
  function isAvailable(win) {
    try {
      return !!(win && win.speechSynthesis && typeof win.speechSynthesis.speak === "function" &&
        typeof win.speechSynthesis.cancel === "function" && typeof win.SpeechSynthesisUtterance === "function");
    } catch (e) { return false; }
  }

  function normLang(l) { return String(l || "").toLowerCase().replace(/_/g, "-"); }

  // Voix française : fr-FR d'abord (locale à l'appareil en premier), puis fr-xx / fr. null s'il n'y en a aucune.
  function pickFrenchVoice(voices) {
    var list = Array.prototype.slice.call(voices || []);
    function best(filter) {
      var found = list.filter(filter);
      var local = found.filter(function (v) { return v.localService === true; });
      return (local[0] || found[0] || null);
    }
    return best(function (v) { return normLang(v.lang) === "fr-fr"; }) ||
           best(function (v) { return /^fr(-|$)/.test(normLang(v.lang)); });
  }

  var START_WAIT_MS = 3000;   // sans démarrage après 3 s : message de diagnostic
  var CANCEL_GAP_MS = 80;     // pause entre cancel() et speak() (speak() collé à cancel() est rejeté par certains Chrome Android)

  /**
   * Lecteur. options : { win, onChange(id | null), onNoFrenchVoice(message), onFailure(code, detail) }
   * Renvoie { available, speak(id, text), stop(), currentId() }.
   * Rien n'est lu en dehors de speak() ; speak() arrête toujours la lecture précédente.
   *
   * onFailure(code, detail) : la lecture n'a pas pu démarrer (rien n'est envoyé hors de l'appareil). Codes :
   *   no-api            speechSynthesis absent ;
   *   empty             rien à lire dans ce message ;
   *   speak-exception   speak() a levé une exception (detail : nom de l'erreur) ;
   *   error:<nom>       l'appareil a signalé une erreur (synthesis-failed, language-unavailable, not-allowed,
   *                     interrupted, canceled…) ;
   *   no-start          aucun démarrage dans les 3 secondes.
   */
  function createReader(options) {
    var win = (options && options.win) || root;
    var available = isAvailable(win);
    var onChange = (options && options.onChange) || function () {};
    var onNoFrenchVoice = (options && options.onNoFrenchVoice) || function () {};
    var onFailure = (options && options.onFailure) || function () {};
    var synth = available ? win.speechSynthesis : null;
    var session = 0;          // change à chaque lecture/arrêt : les rappels d'une lecture périmée sont ignorés
    var current = null;
    var warned = false;       // message « aucune voix française » : une seule fois
    var voices = [];
    var active = null;        // référence gardée sur la phrase en cours (Chrome peut sinon la libérer avant « end »)
    var startTimer = null;

    function refreshVoices() { try { voices = synth.getVoices() || []; } catch (e) { voices = []; } }
    if (available) {
      refreshVoices();
      try { if (synth.addEventListener) synth.addEventListener("voiceschanged", refreshVoices); else synth.onvoiceschanged = refreshVoices; } catch (e) { /* ignoré */ }
    }

    function clearStartTimer() { if (startTimer) { win.clearTimeout(startTimer); startTimer = null; } }
    function setCurrent(id) { if (current !== id) { current = id; try { onChange(id); } catch (e) { /* ignoré */ } } }
    function fail(code, detail) { try { onFailure(code, detail || ""); } catch (e) { /* ignoré */ } }

    // La lecture de la session « mine » a échoué : on remet le bouton à zéro ET on dit pourquoi.
    function failSession(mine, code, detail) {
      if (mine !== session) return;
      session++;
      clearStartTimer();
      active = null;
      setCurrent(null);
      fail(code, detail);
    }

    // Attend les voix (chargées en retard) au plus VOICES_WAIT_MS ; rappelle toujours.
    function whenVoicesReady(cb) {
      refreshVoices();
      if (voices.length) return cb();
      var done = false;
      var timer = null;
      function finish() { if (done) return; done = true; if (timer) win.clearTimeout(timer); refreshVoices(); cb(); }
      try { if (synth.addEventListener) synth.addEventListener("voiceschanged", finish); } catch (e) { /* ignoré */ }
      timer = win.setTimeout(finish, VOICES_WAIT_MS);
    }

    function stop() {
      session++;
      clearStartTimer();
      active = null;
      if (available) { try { synth.cancel(); } catch (e) { /* ignoré */ } }
      setCurrent(null);
    }

    function speak(id, text) {
      if (!available) { fail("no-api"); return false; }
      var chunks = splitChunks(text);
      if (!chunks.length) { fail("empty"); return false; }

      // cancel() seulement si quelque chose est en cours ou en attente : sur certains Chrome Android,
      // speak() lancé juste après un cancel() inutile est rejeté (« interrupted ») sans un mot.
      var busy = current !== null;
      try { busy = busy || synth.speaking === true || synth.pending === true; } catch (e) { /* ignoré */ }
      session++;
      var mine = session;
      clearStartTimer();
      active = null;
      if (busy) { try { synth.cancel(); } catch (e) { /* ignoré */ } }
      setCurrent(id);

      function begin() {
        if (mine !== session) return;                       // arrêtée ou remplacée pendant l'attente
        whenVoicesReady(function () {
          if (mine !== session) return;
          var voice = null;
          try { voice = pickFrenchVoice(voices); } catch (e) { voice = null; }
          if (!voice && voices.length && !warned) { warned = true; try { onNoFrenchVoice(MSG_NO_FRENCH_VOICE); } catch (e) { /* ignoré */ } }
          var i = 0;
          function next() {
            if (mine !== session) return;
            if (i >= chunks.length) { clearStartTimer(); active = null; setCurrent(null); return; }
            var u;
            try {
              u = new win.SpeechSynthesisUtterance(chunks[i++]);
              u.lang = LANG;
              if (voice) u.voice = voice;
            } catch (e) { return failSession(mine, "speak-exception", e && e.name); }
            u.onstart = clearStartTimer;
            u.onend = next;
            u.onerror = function (ev) { failSession(mine, "error:" + ((ev && ev.error) || "unknown")); };
            active = u;
            try { synth.speak(u); } catch (e) { return failSession(mine, "speak-exception", e && e.name); }
            if (i === 1) {
              // Aucun « start » dans les 3 s (et rien en cours de lecture) : on le dit au lieu de rester muet.
              startTimer = win.setTimeout(function () {
                startTimer = null;
                if (mine !== session) return;
                // Le moteur dit-il lire vraiment (et non « en attente ») ? Alors pas de faux message, même sans événement « start ».
                var reading = false;
                try { reading = synth.speaking === true && synth.pending !== true; } catch (e) { /* ignoré */ }
                if (!reading) failSession(mine, "no-start");
              }, START_WAIT_MS);
            }
          }
          next();
        });
      }

      if (busy) win.setTimeout(begin, CANCEL_GAP_MS); else begin();
      return true;
    }

    return { available: available, speak: speak, stop: stop, currentId: function () { return current; } };
  }

  var api = {
    MAX_CHARS: MAX_CHARS, CHUNK_MAX: CHUNK_MAX, LANG: LANG, VOICES_WAIT_MS: VOICES_WAIT_MS, START_WAIT_MS: START_WAIT_MS, CANCEL_GAP_MS: CANCEL_GAP_MS,
    MSG_NO_FRENCH_VOICE: MSG_NO_FRENCH_VOICE,
    SPELLED_ACRONYMS: SPELLED_ACRONYMS, normalizeCaps: normalizeCaps,
    cleanText: cleanText, canListen: canListen, limitText: limitText, splitChunks: splitChunks,
    isAvailable: isAvailable, pickFrenchVoice: pickFrenchVoice, createReader: createReader
  };
  root.MahoutoSpeechReader = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
