/* Rainforest Ogg/Opus with pre-rendered overlapping fades, played on two
 * alternating native HTML media elements as in crossfade_test.html.
 * Do not pipe an HTMLMediaElement into Web Audio: on some iOS/WebViews its
 * 'playing' event fires while the graph produces no audible output.
 * Capture SE remains independent of this audio and of the ON/OFF preference. */
(function (root) {
  'use strict';
  const toggle = document.getElementById('ambientAudioToggle');
  if (!toggle) return;
  const STORAGE_KEY = 'gitai-ambient-audio-enabled-v1';
  // The warning-color tutorial ends with a same-origin navigation to a
  // different game configuration. A new page gets a new media element.
  // Preserve only the user's intent to keep ambience playing, never a
  // stale audio object or the evolution state.
  const ROUTE_RESUME_KEY = 'gitai-ambient-route-resume-v1';
  const SOURCE_PATH = 'audio/gitailab_rainforest_overlap_test_48k.ogg';
  const OVERLAP_SECONDS = 4.0;
  const SOURCE_TYPE = 'audio/ogg; codecs="opus"';

  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) {}

  // Match audio/crossfade_test.html: two native players, with the 4-second
  // fades already embedded in the Ogg. Avoid Web Audio and volume automation.
  const players = [0, 1].map(() => {
    const element = document.createElement('audio');
    element.src = new URL(SOURCE_PATH, document.baseURI).href;
    element.loop = false;
    element.preload = 'auto';
    element.playsInline = true;
    element.volume = 1;
    element.setAttribute('aria-hidden', 'true');
    return element;
  });
  let active = 0;
  let switching = false;
  let running = false;
  let loopTimer = null;
  let playbackEpoch = 0;
  let secondElementPrimed = false;
  const currentAudio = () => players[active];

  function primeSecondPlayerInGesture() {
    // iOS WebKit's native media permission is per element, not per page.
    // load() on the standby element must be called inside a real user gesture
    // so the later crossfade play() is permitted without another tap.
    if (secondElementPrimed) return;
    try {
      players[1 - active].load();
      secondElementPrimed = true;
    } catch (error) {
      console.warn('Could not preload standby ambience:', error);
    }
  }

  function stopLoopTimer() {
    if (loopTimer !== null) { clearInterval(loopTimer); loopTimer = null; }
  }
  function tickLoop() {
    if (!running || switching || !enabled || errorReason || document.hidden) return;
    const oldIndex = active;
    const old = players[oldIndex];
    const duration = old.duration;
    if (!Number.isFinite(duration) || duration <= OVERLAP_SECONDS + 1 ||
        old.paused || old.currentTime < duration - OVERLAP_SECONDS) return;
    switching = true;
    const epoch = playbackEpoch;
    const nextIndex = 1 - oldIndex;
    const next = players[nextIndex];
    try { next.currentTime = 0; } catch (_) {}
    try {
      Promise.resolve(next.play()).then(() => {
        if (!running || epoch !== playbackEpoch || !enabled) {
          next.pause();
          return;
        }
        active = nextIndex;
        switching = false;
        playState = 'playing';
        render();
      }).catch(error => {
        if (epoch !== playbackEpoch) return;
        switching = false;
        // Preserve continuous sound if iOS blocks a second native player.
        old.loop = true;
        running = false;
        stopLoopTimer();
        console.warn('Ambient overlap failed:', error?.name || error);
      });
    } catch (error) {
      switching = false;
      old.loop = true;
      running = false;
      stopLoopTimer();
      console.warn('Ambient overlap failed:', error?.name || error);
    }
  }
  function startLoopTimer() {
    if (loopTimer !== null) return;
    loopTimer = setInterval(tickLoop, 80);
  }

  let playState = 'idle';
  let pending = false;
  let interruptedByVisibility = false;
  let resumeAfterRoute = false;
  try {
    const savedAt = Number(sessionStorage.getItem(ROUTE_RESUME_KEY) || 0);
    sessionStorage.removeItem(ROUTE_RESUME_KEY);
    resumeAfterRoute = savedAt > 0 && Date.now() - savedAt < 20000;
  } catch (_) {}
  let errorReason = typeof currentAudio().canPlayType === 'function'
    && currentAudio().canPlayType(SOURCE_TYPE) === '' ? 'unsupported' : null;

  function activatePlaybackSession() {
    try {
      const session = root.navigator?.audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
      return session?.type === 'playback';
    } catch (_) { return false; }
  }
  activatePlaybackSession();

  function render() {
    toggle.setAttribute('aria-pressed', String(enabled && !errorReason));
    toggle.setAttribute('aria-disabled', String(Boolean(errorReason)));
    toggle.textContent = errorReason === 'unsupported' ? '♪ 音声非対応'
      : errorReason === 'unavailable' ? '♪ 音源エラー'
      : !enabled ? '♪ 環境音 OFF'
      : playState === 'playing' ? '♪ 再生中'
      : playState === 'loading' ? '♪ 読み込み中'
      : playState === 'blocked' ? '♪ 再生を試す'
      : '♪ 環境音 ON';
    toggle.title = errorReason === 'unsupported' ? 'このブラウザはOgg Opusに対応していません。'
      : errorReason === 'unavailable' ? '熱帯雨林の音源ファイルを読み込めません。'
      : enabled ? '熱帯雨林の環境音をオフにする' : '熱帯雨林の環境音をオンにする';
  }

  function playFromUserGesture() {
    // Do not trust cached playState: iOS may pause native media when a
    // tutorial/dialog changes or when a page is backgrounded.
    if (!enabled || errorReason || document.hidden || pending) return;
    if (running && currentAudio().paused === false && !currentAudio().ended) return;
    activatePlaybackSession();
    primeSecondPlayerInGesture();
    playState = 'loading';
    pending = true;
    render();
    try {
      // Crucially synchronous with the pointer/click, as in the audio test.
      running = true;
      startLoopTimer();
      const attempt = currentAudio().play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => {
          pending = false;
        }).catch(error => {
          pending = false;
          if (!enabled) return;
          running = false;
          stopLoopTimer();
          if (error?.name === 'NotSupportedError') errorReason = 'unsupported';
          else if (error?.name !== 'AbortError') playState = 'blocked';
          render();
        });
      } else {
        pending = false;
      }
    } catch (_) {
      pending = false;
      running = false;
      stopLoopTimer();
      playState = 'blocked';
      render();
    }
  }

  function stop() {
    pending = false;
    running = false;
    switching = false;
    playbackEpoch += 1;
    stopLoopTimer();
    for (const player of players) {
      player.pause();
      player.loop = false;
      try { player.currentTime = 0; } catch (_) {}
    }
    active = 0;
    playState = 'idle';
    render();
  }

  players.forEach((player, index) => {
    player.addEventListener('playing', () => {
      if (!enabled || !running) { player.pause(); return; }
      if (index !== active && !switching) return;
      pending = false;
      playState = 'playing';
      render();
    });
    player.addEventListener('waiting', () => {
      if (enabled && index === active) { playState = 'loading'; render(); }
    });
    player.addEventListener('pause', () => {
      if (index !== active || switching || !running) return;
      pending = false;
      if (playState !== 'idle') { playState = 'idle'; render(); }
    });
    player.addEventListener('ended', () => {
      if (running && index !== active) {
        try { player.currentTime = 0; } catch (_) {}
      }
    });
    player.addEventListener('error', () => {
      errorReason = 'unavailable';
      stop();
    });
  });

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (errorReason) return;
    if (enabled) primeSecondPlayerInGesture();
    if (enabled && (playState !== 'playing' || currentAudio().paused === true)) {
      pending = false;
      playFromUserGesture();
      return;
    }
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
    if (enabled) playFromUserGesture();
    else stop();
    render();
  });

  function unlock(event) {
    if (event?.target === toggle) return;
    activatePlaybackSession();
    if (enabled && !errorReason && !document.hidden) primeSecondPlayerInGesture();
    if (enabled && !pending
        && (playState !== 'playing' || currentAudio().paused === true || currentAudio().ended)) {
      playFromUserGesture();
    }
  }
  // Handle the click AFTER Skip's handler opens the habitat picker, so an
  // interruption from that UI transition is detectable before this retry.
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('click', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      interruptedByVisibility = enabled && !errorReason
        && (playState === 'playing' || pending || players.some(a => !a.paused));
      stop();
    } else if (interruptedByVisibility) {
      interruptedByVisibility = false;
      // Best effort on foreground; Safari may require the next real tap.
      playFromUserGesture();
    }
  });
  root.addEventListener('pagehide', () => {
    // HTML audio cannot physically survive a full document navigation.
    // Request a best-effort resume in the next same-origin page load.
    try {
      if (enabled && !errorReason &&
          (playState === 'playing' || pending || interruptedByVisibility
           || players.some(a => !a.paused))) {
        sessionStorage.setItem(ROUTE_RESUME_KEY, String(Date.now()));
      } else {
        sessionStorage.removeItem(ROUTE_RESUME_KEY);
      }
    } catch (_) {}
    stop();
  });
  root.addEventListener('pageshow', () => {
    if (interruptedByVisibility && !document.hidden) {
      interruptedByVisibility = false;
      playFromUserGesture();
    }
  });
  render();
  if (resumeAfterRoute && enabled && !errorReason) {
    // A new document may reject unprompted play() under iOS restrictions.
    // Never bypass those rules: catch NotAllowedError and retry on a tap.
    playFromUserGesture();
  }

  root.GitaiAmbientAudio = Object.freeze({
    isEnabled: () => enabled,
    isAvailable: () => !errorReason,
    isPlaying: () => playState === 'playing',
    activatePlaybackSession,
  });
})(window);
