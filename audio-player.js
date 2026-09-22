/* =========================================================
   MAHOUTO+ — Lecteur audio global et persistant
   =========================================================
   RÉALITÉ DE L'ARCHITECTURE (à lire avant de modifier ce fichier) :
   MAHOUTO+ est un site MULTI-PAGES (chat.html, dm-chat.html,
   discussions.html, etc. sont des documents HTML indépendants,
   chargés par de VRAIES navigations de navigateur). Quand on
   quitte une page, TOUT son JavaScript — y compris un éventuel
   <audio> en cours de lecture — est détruit par le navigateur.
   Aucun code ne peut empêcher ça sans transformer le site en
   SPA/iframe-shell (hors périmètre demandé).

   Ce module ne prétend donc PAS faire jouer l'audio PENDANT la
   navigation elle-même (impossible ici). Il fait la meilleure
   approximation possible sans refonte :
     1. Une SEULE instance <audio> pour toute la page courante —
        jamais deux lectures simultanées.
     2. Juste avant que la page se décharge (evt "pagehide"), et à
        intervalles réguliers pendant la lecture, l'état exact
        (piste, position, lecture en cours ou non, volume) est
        sauvegardé dans localStorage (partagé par toutes les pages
        du même site).
     3. Au chargement de CHAQUE page qui inclut ce script, si un
        état sauvegardé existe, la barre réapparaît immédiatement
        avec le bon titre et la bonne position. Si la lecture était
        en cours, une tentative de reprise automatique est faite —
        mais les navigateurs bloquent souvent la lecture automatique
        avec son après un rechargement de document (politique
        d'autoplay), donc si ça échoue, la barre affiche simplement
        "▶ Reprendre" au lieu de rester silencieusement bloquée.
   Résultat honnête : une micro-coupure pendant la navigation
   elle-même, puis reprise immédiate (auto ou en un tap) à la bonne
   position sur la page suivante — PAS une lecture strictement
   ininterrompue, qui n'est pas possible avec cette architecture.
   ========================================================= */

window.MahoutoAudioPlayer = (function () {
  const STORAGE_KEY = "mahouto-audio-state-v1";
  const SAVE_INTERVAL_MS = 3000;

  let audio = null;
  let bar = null;
  let els = {};
  let current = null; // { id, title, url, contextLabel }
  let saveTimer = null;

  // -------- Registre de la playlist (nouveau) --------
  // Rempli par attachments.js (registerTrack) au fur et à mesure que
  // les cartes audio d'un salon/DM sont rendues, DANS L'ORDRE
  // D'AFFICHAGE (Map = ordre d'insertion préservé en JS). Un Map
  // repart à zéro à chaque chargement de page — donc toujours limité
  // au contexte actuellement ouvert (salon ou conversation), jamais
  // mélangé entre deux salons.
  const registry = new Map(); // id(String) -> { id, title, url }
  let currentIndex = -1; // position de `current` dans getOrderedTracks(), -1 si hors playlist
  let onRegistryChange = null; // callback optionnel (chat.html/dm-chat.html)

  function getOrderedTracks() {
    return Array.from(registry.values());
  }

  function registerTrack(track) {
    registry.set(String(track.id), track);
    console.log("[AUDIO] registerTrack", track.id, track.title, "| playlist length:", registry.size);
    // Si la piste restaurée depuis localStorage (après navigation)
    // correspond à celle qu'on vient d'enregistrer, on retrouve sa
    // position dans CETTE playlist pour que "suivant" refonctionne.
    if (current && String(current.id) === String(track.id) && currentIndex === -1) {
      currentIndex = getOrderedTracks().findIndex((t) => String(t.id) === String(track.id));
      updatePositionLabel();
    }
    if (onRegistryChange) onRegistryChange(registry.size);
  }

  function unregisterTrack(id) {
    const key = String(id);
    if (!registry.has(key)) return;
    const idx = getOrderedTracks().findIndex((t) => String(t.id) === key);
    registry.delete(key);
    // Si la piste retirée était la piste en cours ou précédait l'index
    // courant, on recale currentIndex pour ne pas décaler "suivant".
    if (idx !== -1 && idx <= currentIndex) currentIndex = Math.max(-1, currentIndex - 1);
    if (current && String(current.id) === key) {
      // La piste en cours a été supprimée : on la laisse terminer son
      // rendu (l'utilisateur l'écoute peut-être encore) mais elle ne
      // fait plus partie du registre pour "suivant"/"précédent".
    }
    if (onRegistryChange) onRegistryChange(registry.size);
  }

  function getTrackCount() { return registry.size; }

  function setOnRegistryChange(cb) { onRegistryChange = cb; }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function updatePositionLabel() {
    if (!els.position) return;
    const total = registry.size;
    if (currentIndex < 0 || total < 2) {
      els.position.textContent = "";
      els.prevBtn.classList.add("hidden");
      els.nextBtn.classList.add("hidden");
    } else {
      els.position.textContent = (currentIndex + 1) + " / " + total;
      els.prevBtn.classList.remove("hidden");
      els.nextBtn.classList.remove("hidden");
    }
  }

  function buildBar() {
    const el = document.createElement("div");
    el.id = "mahouto-audio-bar";
    el.className = "mahouto-audio-bar hidden";
    el.innerHTML =
      '<button type="button" class="maud-prev hidden" aria-label="Précédent">⏮</button>' +
      '<button type="button" class="maud-play" aria-label="Lecture/Pause">▶</button>' +
      '<button type="button" class="maud-next hidden" aria-label="Suivant">⏭</button>' +
      '<div class="maud-info">' +
        '<div class="maud-title"></div>' +
        '<div class="maud-progress-row">' +
          '<span class="maud-time maud-time-cur">0:00</span>' +
          '<input type="range" class="maud-seek" min="0" max="100" value="0">' +
          '<span class="maud-time maud-time-dur">0:00</span>' +
          '<span class="maud-position"></span>' +
        '</div>' +
      '</div>' +
      '<input type="range" class="maud-volume" min="0" max="100" value="100" title="Volume">' +
      '<button type="button" class="maud-close" aria-label="Fermer">✕</button>';
    document.body.appendChild(el);

    els = {
      prevBtn: el.querySelector(".maud-prev"),
      playBtn: el.querySelector(".maud-play"),
      nextBtn: el.querySelector(".maud-next"),
      title: el.querySelector(".maud-title"),
      seek: el.querySelector(".maud-seek"),
      cur: el.querySelector(".maud-time-cur"),
      dur: el.querySelector(".maud-time-dur"),
      position: el.querySelector(".maud-position"),
      volume: el.querySelector(".maud-volume"),
      close: el.querySelector(".maud-close")
    };

    els.playBtn.addEventListener("click", () => toggle());
    els.prevBtn.addEventListener("click", () => previous());
    els.nextBtn.addEventListener("click", () => next());
    els.close.addEventListener("click", () => stopAndHide());
    els.seek.addEventListener("input", () => {
      if (audio && audio.duration) audio.currentTime = (els.seek.value / 100) * audio.duration;
    });
    els.volume.addEventListener("input", () => {
      if (audio) audio.volume = els.volume.value / 100;
    });

    return el;
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "metadata";

    audio.addEventListener("timeupdate", () => {
      if (audio.duration) {
        els.seek.value = String((audio.currentTime / audio.duration) * 100);
        els.cur.textContent = fmtTime(audio.currentTime);
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      els.dur.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("play", () => {
      els.playBtn.textContent = "⏸";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      scheduleSave();
    });
    audio.addEventListener("pause", () => {
      els.playBtn.textContent = "▶";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      persistState();
    });
    // Seul un "ended" naturel déclenche l'enchaînement automatique —
    // une mise en pause manuelle (par l'utilisateur, ou setPlaybackState
    // depuis l'écran verrouillé) ne déclenche JAMAIS "ended", donc la
    // playlist reste bien en pause tant que l'audio n'est pas terminé.
    audio.addEventListener("ended", () => {
      console.log("[AUDIO] ended", current && current.id, "| current index", currentIndex);
      persistState(true);
      advance();
    });
    audio.addEventListener("error", () => {
      if (current) console.warn("Lecture impossible pour:", current.title);
      // Cas limite demandé : piste suivante inaccessible -> on
      // n'bloque pas la playlist, on tente proprement la suivante.
      advance();
    });

    return audio;
  }

  function setupMediaSession() {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title || "Message vocal",
      artist: "MAHOUTO+",
      album: current.contextLabel || ""
    });
    navigator.mediaSession.setActionHandler("play", () => play(current));
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (audio && details.seekTime != null) audio.currentTime = details.seekTime;
    });
    navigator.mediaSession.setActionHandler("previoustrack", getTrackCount() > 1 ? () => previous() : null);
    navigator.mediaSession.setActionHandler("nexttrack", getTrackCount() > 1 ? () => next() : null);
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setInterval(persistState, SAVE_INTERVAL_MS);
  }

  function stopSaveTimer() {
    if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  }

  // Sécurité : on ne sauvegarde JAMAIS la clé/le secret Cloudinary —
  // uniquement l'URL déjà signée qui a été fournie par attachments.js
  // via /api/attachment (POST), exactement la même que celle utilisée
  // à l'écran. Rien de plus n'est exposé qu'au moment de la lecture.
  // NB : seule la piste EN COURS est persistée (pas toute la
  // playlist) — voir restoreFromStorage() pour la raison.
  function persistState(ended) {
    if (!current || !audio) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: current.id,
        title: current.title,
        url: current.url,
        contextLabel: current.contextLabel || "",
        position: ended ? 0 : audio.currentTime,
        paused: ended ? true : audio.paused,
        volume: audio.volume,
        savedAt: Date.now()
      }));
    } catch (e) { /* stockage indisponible — pas bloquant */ }
  }

  function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function showBar() {
    if (!bar) bar = buildBar();
    bar.classList.remove("hidden");
  }

  function stopAndHide() {
    if (audio) { audio.pause(); audio.src = ""; }
    stopSaveTimer();
    clearState();
    current = null;
    currentIndex = -1;
    if (bar) bar.classList.add("hidden");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  }

  // Point d'entrée par piste unique (compatibilité — inchangé pour
  // tout appelant existant). `track` = { id, title, url, contextLabel }.
  function play(track) {
    // Modification minimale strictement nécessaire pour éviter un
    // audio + une vidéo simultanés (voir video-player.js). N'a aucun
    // effet si video-player.js n'est pas chargé sur la page.
    if (window.MahoutoVideoPlayer && typeof window.MahoutoVideoPlayer.pause === "function") {
      window.MahoutoVideoPlayer.pause();
    }
    ensureAudio();
    showBar();

    const isSameTrack = current && current.id === track.id;
    current = track;
    currentIndex = getOrderedTracks().findIndex((t) => String(t.id) === String(track.id));
    els.title.textContent = track.title || "Message vocal";
    setupMediaSession();
    updatePositionLabel();

    if (!isSameTrack || !audio.src || audio.src !== track.url) {
      audio.src = track.url;
      audio.currentTime = 0;
    }
    audio.play().catch((err) => {
      console.warn("Lecture audio bloquée par le navigateur :", err);
    });
  }

  // Nouveau point d'entrée utilisé par attachments.js et le bouton
  // « Lire tous » : joue la piste `id` en la resituant dans la
  // playlist actuelle (ordre d'affichage), pour que "suivant"
  // fonctionne ensuite automatiquement, y compris quand on démarre
  // directement sur le 3e, 4e... fichier.
  function playById(id) {
    console.log("[AUDIO] playById", id, "| playlist length:", registry.size);
    const tracks = getOrderedTracks();
    const idx = tracks.findIndex((t) => String(t.id) === String(id));
    console.log("[AUDIO] current index", idx);
    if (idx === -1) return; // piste inconnue/plus disponible (ex: supprimée) — on ignore proprement
    play(tracks[idx]);
  }

  // Bouton « Lire tous » : commence au premier audio du salon/DM.
  function playAll() {
    const tracks = getOrderedTracks();
    if (!tracks.length) return;
    play(tracks[0]);
  }

  function advance() {
    const tracks = getOrderedTracks();
    console.log("[AUDIO] advance | current index", currentIndex, "| playlist length:", tracks.length);
    if (currentIndex === -1 || currentIndex + 1 >= tracks.length) {
      console.log("[AUDIO] advance: fin de playlist, rien à enchaîner");
      return; // dernier audio atteint : on s'arrête proprement
    }
    console.log("[AUDIO] next track", tracks[currentIndex + 1].id, tracks[currentIndex + 1].title);
    play(tracks[currentIndex + 1]);
  }

  function next() {
    const tracks = getOrderedTracks();
    if (currentIndex + 1 < tracks.length) play(tracks[currentIndex + 1]);
  }

  function previous() {
    if (currentIndex - 1 >= 0) play(getOrderedTracks()[currentIndex - 1]);
  }

  function toggle() {
    if (!audio) return;
    if (audio.paused) play(current); else pause();
  }

  function pause() {
    if (audio) audio.pause();
  }

  // Reprise au chargement d'une nouvelle page (voir note d'architecture
  // en haut du fichier : ne relance PAS automatiquement le son sans
  // tentative — les navigateurs bloquent souvent l'autoplay après un
  // rechargement de document ; si bloqué, la barre reste visible en
  // pause, prête pour un tap.
  //
  // IMPORTANT : seule la piste qui jouait est restaurée, jamais toute
  // la playlist — un nouveau chargement de page reconstruit son propre
  // registre (nouveau salon/DM, ou même salon avec de nouveaux
  // messages), donc rejouer un ancien "currentIndex" n'aurait plus de
  // sens. La piste restaurée rejoindra automatiquement la nouvelle
  // playlist dès qu'elle sera réenregistrée par attachments.js (même
  // logique que playById), pour que "suivant" fonctionne à nouveau.
  function restoreFromStorage() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { return; }
    if (!saved || !saved.url) return;

    ensureAudio();
    showBar();
    current = { id: saved.id, title: saved.title, url: saved.url, contextLabel: saved.contextLabel };
    currentIndex = -1; // recalculé dès que le registre de cette page enregistre cette piste (voir registerTrack)
    els.title.textContent = saved.title || "Message vocal";
    audio.src = saved.url;
    audio.volume = typeof saved.volume === "number" ? saved.volume : 1;
    els.volume.value = String(Math.round(audio.volume * 100));
    audio.currentTime = saved.position || 0;
    setupMediaSession();
    updatePositionLabel();

    if (!saved.paused) {
      audio.play().catch(() => {
        // Autoplay bloqué par le navigateur — comportement attendu et
        // documenté ci-dessus, pas une erreur du code. La barre reste
        // visible, en pause, prête pour un tap de l'utilisateur.
        els.playBtn.textContent = "▶";
      });
    }
  }

  window.addEventListener("pagehide", () => persistState());

  document.addEventListener("DOMContentLoaded", restoreFromStorage);

  return {
    play, pause, toggle, stop: stopAndHide,
    playById, playAll, next, previous,
    registerTrack, unregisterTrack, getTrackCount, setOnRegistryChange
  };
})();
