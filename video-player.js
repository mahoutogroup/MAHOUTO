/* =========================================================
   MAHOUTO+ — Lecteur vidéo global avec playlist automatique
   =========================================================
   Indépendant du lecteur audio (audio-player.js) : registre
   propre, instance <video> propre, jamais mélangé avec les
   audios dans une même playlist.

   NAVIGATION : comme pour l'audio, MAHOUTO+ est multi-pages —
   une vraie navigation détruit tout le JS de la page, donc la
   vidéo ne peut pas continuer PENDANT la navigation elle-même.
   Contrairement à l'audio, on ne tente PAS de reprendre
   automatiquement la vidéo après une navigation (ça n'aurait
   pas de sens pour un contenu visuel qu'on doit activement
   regarder) : le minimum demandé est respecté — la vidéo est
   proprement coupée avant que la page ne se décharge.
   ========================================================= */

window.MahoutoVideoPlayer = (function () {
  let video = null;
  let overlay = null;
  let els = {};
  let current = null; // { id, title, url }

  // -------- Registre / playlist (indépendant de l'audio) --------
  const registry = new Map(); // id(String) -> { id, title, url }
  let currentIndex = -1;
  let onRegistryChange = null;

  function getOrderedTracks() {
    return Array.from(registry.values());
  }

  function registerVideo(track) {
    registry.set(String(track.id), track);
    console.log("[VIDEO] registered", track.id, track.title, "| playlist length:", registry.size);
    if (onRegistryChange) onRegistryChange(registry.size);
  }

  function unregisterVideo(id) {
    const key = String(id);
    if (!registry.has(key)) return;
    const idx = getOrderedTracks().findIndex((t) => String(t.id) === key);
    registry.delete(key);
    if (idx !== -1 && idx <= currentIndex) currentIndex = Math.max(-1, currentIndex - 1);
    console.log("[VIDEO] removed", id, "| playlist length:", registry.size);
    if (onRegistryChange) onRegistryChange(registry.size);
  }

  function getTrackCount() { return registry.size; }
  function setOnRegistryChange(cb) { onRegistryChange = cb; }

  // ---------- Google Cast ----------
  // Repose entièrement sur le Default Media Receiver de Google (aucun
  // récepteur personnalisé nécessaire) — validé le 24/09/2026 via
  // cast-prototype.html : le récepteur lit correctement aussi bien les
  // URLs Cloudinary publiques QUE "authenticated" (signées) telles que
  // notre système les produit déjà. Le Cast envoie l'URL de LECTURE
  // COURANTE (celle déjà résolue avec succès par le lecteur local) —
  // jamais construite séparément — donc les mêmes règles d'accès
  // (RLS, signature Cloudinary) s'appliquent sans rien dupliquer.
  let castContext = null;
  let castAvailable = false;
  let remotePlayer = null;
  let remotePlayerController = null;
  let isCasting = false; // reflète l'état réel du RemotePlayer — source de vérité pour aiguiller local vs TV
  let castMedia = null; // objet chrome.cast.media.Media courant, pour détecter la fin naturelle
  let hasStartedPlayingRemote = false; // évite un faux déclenchement du secours juste après connexion
  let advanceGuard = 0; // anti-double-déclenchement entre les deux mécanismes de détection de fin

  // Point d'entrée unique pour avancer suite à une fin détectée côté
  // Cast, quel que soit le mécanisme qui l'a repérée — si les deux
  // (idleReason FINISHED et le secours RemotePlayer) se déclenchent
  // pour le même évènement, un seul advanceVideo() part réellement.
  function triggerAdvanceOnce(source) {
    const guard = ++advanceGuard;
    console.log("[VIDEO] Cast : fin détectée via", source);
    setTimeout(() => {
      if (guard !== advanceGuard) return; // un autre déclenchement a déjà pris le relais entre-temps
      advanceVideo();
    }, 150); // courte fenêtre pour laisser l'autre mécanisme, s'il arrive, être ignoré au lieu de doublonner
  }

  window["__onGCastApiAvailable"] = function (isAvailable) {
    if (!isAvailable) { console.log("[VIDEO] Google Cast indisponible sur ce navigateur."); return; }
    castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    castAvailable = true;
    if (els.castBtn) els.castBtn.classList.remove("hidden");
    console.log("[VIDEO] Cast prêt (Default Media Receiver).");

    castContext.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (e) => {
        const connected = e.sessionState === cast.framework.SessionState.SESSION_STARTED
          || e.sessionState === cast.framework.SessionState.SESSION_RESUMED;
        if (els.castBtn) els.castBtn.classList.toggle("mvid-cast-active", connected);
      }
    );

    // RemotePlayer/RemotePlayerController : pilote play/pause/seek de la
    // TV et reçoit ses changements d'état (y compris une pause faite
    // depuis la télécommande physique de la TV, pas seulement depuis
    // le téléphone) — c'est le mécanisme standard du SDK pour ça.
    remotePlayer = new cast.framework.RemotePlayer();
    remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      () => {
        isCasting = remotePlayer.isConnected;
        console.log("[VIDEO] Cast connecté :", isCasting);
        if (!isCasting) {
          castMedia = null;
          hasStartedPlayingRemote = false;
          if (els.position) updatePositionLabel(); // réaffiche X/Y en mode local si une playlist existe
        }
      }
    );

    // Mécanisme de SECOURS (en plus de attachCastMediaListener ci-dessous,
    // pas à sa place) : si, pour une raison quelconque, l'objet Media
    // (chrome.cast.media.Media) ne signale pas idleReason=FINISHED de
    // façon fiable sur certains récepteurs, on surveille aussi le
    // statut exposé directement par RemotePlayer — dès qu'il repasse à
    // IDLE APRÈS avoir réellement joué (jamais juste après connexion,
    // pour ne pas déclencher un enchaînement au moment où on se
    // connecte simplement à la TV sans rien lire).
    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
      () => {
        if (!isCasting) return;
        console.log("[VIDEO] Cast playerState (RemotePlayer) :", remotePlayer.playerState);
        if (remotePlayer.playerState === chrome.cast.media.PlayerState.PLAYING) {
          hasStartedPlayingRemote = true;
        } else if (remotePlayer.playerState === chrome.cast.media.PlayerState.IDLE && hasStartedPlayingRemote) {
          triggerAdvanceOnce("RemotePlayer IDLE (secours)");
        }
      }
    );

    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
      () => {
        if (!isCasting || !els.playBtn) return;
        els.playBtn.textContent = remotePlayer.isPaused ? "▶" : "⏸";
      }
    );

    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
      () => {
        if (!isCasting || !els.seek || !remotePlayer.duration) return;
        els.seek.value = String((remotePlayer.currentTime / remotePlayer.duration) * 100);
        els.cur.textContent = fmtTime(remotePlayer.currentTime);
      }
    );

    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.DURATION_CHANGED,
      () => {
        if (!isCasting || !els.dur) return;
        els.dur.textContent = fmtTime(remotePlayer.duration);
      }
    );
  };

  // Envoie une piste précise à la TV (utilisée aussi bien par le
  // bouton 📺 que par nextVideo()/previousVideo()/playAllVideos(),
  // puisque tout passe par play(track) ci-dessous).
  function castTrack(track) {
    const session = castContext.getCurrentSession();
    if (!session || !track) return;

    hasStartedPlayingRemote = false; // repart de zéro pour cette nouvelle vidéo — évite un faux déclenchement du secours

    const mediaInfo = new chrome.cast.media.MediaInfo(track.url, "video/mp4");
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = track.title || "Vidéo MAHOUTO+";

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    session.loadMedia(request).then(
      () => {
        console.log("[VIDEO] Cast : lecture envoyée à la TV —", track.title);
        if (video) video.pause(); // évite de lire le son en local ET sur la TV en même temps
        attachCastMediaListener(session);
      },
      (err) => {
        console.error("[VIDEO] Cast : échec de l'envoi à la TV", err);
        // Ne bloque jamais toute la playlist — on tente proprement la suivante.
        advanceVideo();
      }
    );
  }

  // Mécanisme PRINCIPAL de détection de fin naturelle : le statut IDLE
  // du média avec idleReason = FINISHED, exposé sur l'objet Media de
  // la session (chrome.cast.media.Media, pas RemotePlayer). C'est le
  // mécanisme documenté par Google pour ce cas précis. Doublé par un
  // secours (PLAYER_STATE_CHANGED, voir plus haut) au cas où ce
  // premier mécanisme ne se déclencherait pas de façon fiable sur
  // certains récepteurs/TV.
  function attachCastMediaListener(session) {
    const media = session.getMediaSession();
    if (!media) return;
    castMedia = media;

    function onMediaUpdate(isAlive) {
      if (!isAlive || media !== castMedia) { media.removeUpdateListener(onMediaUpdate); return; }
      if (media.playerState === chrome.cast.media.PlayerState.IDLE
        && media.idleReason === chrome.cast.media.IdleReason.FINISHED) {
        media.removeUpdateListener(onMediaUpdate);
        triggerAdvanceOnce("Media.idleReason=FINISHED (principal)");
      }
    }
    media.addUpdateListener(onMediaUpdate);
  }

  function onCastButtonClick() {
    if (!castAvailable || !castContext) return;
    const session = castContext.getCurrentSession();
    if (session) {
      castTrack(current);
    } else {
      castContext.requestSession().then(
        () => castTrack(current),
        (err) => console.log("[VIDEO] Cast : sélection de la TV annulée ou échouée", err)
      );
    }
  }

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

  function buildOverlay() {
    const el = document.createElement("div");
    el.id = "mahouto-video-overlay";
    el.className = "mahouto-video-overlay hidden";
    el.innerHTML =
      '<video class="mvid-video" playsinline></video>' +
      '<div class="mvid-bar">' +
        '<button type="button" class="mvid-prev hidden" aria-label="Précédente">⏮</button>' +
        '<button type="button" class="mvid-play" aria-label="Lecture/Pause">▶</button>' +
        '<button type="button" class="mvid-next hidden" aria-label="Suivante">⏭</button>' +
        '<button type="button" class="mvid-cast hidden" aria-label="Caster sur une TV">📺</button>' +
        '<div class="mvid-info">' +
          '<div class="mvid-title"></div>' +
          '<div class="mvid-progress-row">' +
            '<span class="mvid-time mvid-time-cur">0:00</span>' +
            '<input type="range" class="mvid-seek" min="0" max="100" value="0">' +
            '<span class="mvid-time mvid-time-dur">0:00</span>' +
            '<span class="mvid-position"></span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="mvid-close" aria-label="Fermer">✕</button>' +
      '</div>';
    document.body.appendChild(el);

    els = {
      video: el.querySelector(".mvid-video"),
      prevBtn: el.querySelector(".mvid-prev"),
      playBtn: el.querySelector(".mvid-play"),
      nextBtn: el.querySelector(".mvid-next"),
      castBtn: el.querySelector(".mvid-cast"),
      title: el.querySelector(".mvid-title"),
      seek: el.querySelector(".mvid-seek"),
      cur: el.querySelector(".mvid-time-cur"),
      dur: el.querySelector(".mvid-time-dur"),
      position: el.querySelector(".mvid-position"),
      close: el.querySelector(".mvid-close")
    };

    video = els.video;

    // Le SDK Cast peut devenir disponible AVANT que ce lecteur ne soit
    // construit (il ne l'est qu'à la première ouverture d'une vidéo) —
    // sans ce rattrapage, le bouton resterait caché indéfiniment même
    // une fois le SDK prêt.
    if (castAvailable) els.castBtn.classList.remove("hidden");

    els.playBtn.addEventListener("click", () => toggle());
    els.prevBtn.addEventListener("click", () => previousVideo());
    els.nextBtn.addEventListener("click", () => nextVideo());
    els.close.addEventListener("click", () => stopAndHide());
    els.castBtn.addEventListener("click", () => onCastButtonClick());
    els.seek.addEventListener("input", () => {
      if (isCasting) {
        if (remotePlayer && remotePlayer.duration) {
          remotePlayer.currentTime = (els.seek.value / 100) * remotePlayer.duration;
          remotePlayerController.seek();
        }
        return;
      }
      if (video && video.duration) video.currentTime = (els.seek.value / 100) * video.duration;
    });

    video.addEventListener("timeupdate", () => {
      if (video.duration) {
        els.seek.value = String((video.currentTime / video.duration) * 100);
        els.cur.textContent = fmtTime(video.currentTime);
      }
    });
    video.addEventListener("loadedmetadata", () => {
      els.dur.textContent = fmtTime(video.duration);
    });
    video.addEventListener("play", () => {
      els.playBtn.textContent = "⏸";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    });
    video.addEventListener("pause", () => {
      els.playBtn.textContent = "▶";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    });
    // Seule une fin NATURELLE avance la playlist — une pause manuelle
    // ne déclenche jamais "ended".
    video.addEventListener("ended", () => {
      console.log("[VIDEO] ended", current && current.id, "| current index", currentIndex);
      advanceVideo();
    });
    video.addEventListener("error", () => {
      console.log("[VIDEO] error", current && current.id);
      advanceVideo();
    });

    return el;
  }

  function setupMediaSession() {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title || "Vidéo",
      artist: "MAHOUTO+"
    });
    navigator.mediaSession.setActionHandler("play", () => play(current));
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => { if (video) video.currentTime = Math.max(0, video.currentTime - 10); });
    navigator.mediaSession.setActionHandler("seekforward", () => { if (video) video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); });
    navigator.mediaSession.setActionHandler("previoustrack", getTrackCount() > 1 ? () => previousVideo() : null);
    navigator.mediaSession.setActionHandler("nexttrack", getTrackCount() > 1 ? () => nextVideo() : null);
  }

  function showOverlay() {
    if (!overlay) overlay = buildOverlay();
    overlay.classList.remove("hidden");
  }

  function stopAndHide() {
    if (video) { video.pause(); video.src = ""; }
    current = null;
    currentIndex = -1;
    if (overlay) overlay.classList.add("hidden");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  }

  // Empêche audio + vidéo simultanés — modification minimale côté
  // audio (une ligne dans audio-player.js) fait le chemin inverse.
  function pauseOtherPlayers() {
    if (window.MahoutoAudioPlayer && typeof window.MahoutoAudioPlayer.pause === "function") {
      window.MahoutoAudioPlayer.pause();
    }
  }

  function play(track) {
    pauseOtherPlayers();
    showOverlay();
    console.log("[VIDEO] play", track.id, track.title);

    const isSameTrack = current && current.id === track.id;
    current = track;
    currentIndex = getOrderedTracks().findIndex((t) => String(t.id) === String(track.id));
    els.title.textContent = track.title || "Vidéo";
    setupMediaSession();
    updatePositionLabel();

    // Une session Cast active est la SEULE différence : la playlist,
    // l'index courant, le titre, X/Y restent gérés exactement comme en
    // local (ci-dessus) — seule la façon de "jouer" change.
    if (isCasting) {
      castTrack(track);
      return;
    }

    if (!isSameTrack || !video.src || video.src !== track.url) {
      video.src = track.url;
      video.currentTime = 0;
    }
    video.play().catch((err) => {
      // Politique d'autoplay du navigateur — on ne force jamais, on
      // laisse l'utilisateur reprendre via le bouton ▶ visible.
      console.warn("[VIDEO] lecture bloquée par le navigateur :", err);
      els.playBtn.textContent = "▶";
    });
  }

  function playVideoById(id) {
    console.log("[VIDEO] playVideoById", id, "| playlist length:", registry.size);
    const tracks = getOrderedTracks();
    const idx = tracks.findIndex((t) => String(t.id) === String(id));
    if (idx === -1) return; // vidéo inconnue/supprimée — on ignore proprement
    play(tracks[idx]);
  }

  function playAllVideos() {
    const tracks = getOrderedTracks();
    if (!tracks.length) return;
    play(tracks[0]);
  }

  function advanceVideo() {
    const tracks = getOrderedTracks();
    console.log("[VIDEO] next | current index", currentIndex, "| playlist length:", tracks.length);
    if (currentIndex === -1 || currentIndex + 1 >= tracks.length) {
      console.log("[VIDEO] fin de playlist");
      return;
    }
    play(tracks[currentIndex + 1]);
  }

  function nextVideo() {
    const tracks = getOrderedTracks();
    if (currentIndex + 1 < tracks.length) play(tracks[currentIndex + 1]);
  }

  function previousVideo() {
    console.log("[VIDEO] previous | current index", currentIndex);
    if (currentIndex - 1 >= 0) play(getOrderedTracks()[currentIndex - 1]);
  }

  function toggle() {
    if (isCasting) {
      if (remotePlayerController) remotePlayerController.playOrPause();
      return;
    }
    if (!video) return;
    if (video.paused) play(current); else pause();
  }

  function pause() {
    console.log("[VIDEO] pause", current && current.id);
    if (isCasting) {
      if (remotePlayerController && !remotePlayer.isPaused) remotePlayerController.playOrPause();
      return;
    }
    if (video) video.pause();
  }

  // Minimum garanti à la navigation (section 16 du cahier des
  // charges) : couper proprement, sans tenter de reprendre après —
  // contrairement à l'audio, aucune promesse de continuité ici.
  window.addEventListener("pagehide", () => { if (video) video.pause(); });

  return {
    play, pause, toggle, stop: stopAndHide,
    playVideoById, playAllVideos, nextVideo, previousVideo,
    registerVideo, unregisterVideo, getTrackCount, setOnRegistryChange
  };
})();
