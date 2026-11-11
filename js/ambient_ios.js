/* Exhibition-only rainforest ambience: one gapless AAC player.
 * iPhone/iPad native AAC loop avoids the two-Ogg-player overlap handoff
 * that can silently fail after the first playback. No Web Audio graph and
 * no interaction with the simulator, SFX, IndexedDB, or genetic RNG.
 */
(function (root) {
  'use strict';
  const toggle = document.getElementById('ambientAudioToggle');
  if (!toggle) return;
  const STORAGE_KEY = 'gitai-ambient-audio-enabled-v1';
  const ROUTE_RESUME_KEY = 'gitai-ambient-route-resume-v1';
  const SOURCE_PATH = 'audio/gitailab_rainforest_ios_seamless_loop_48k.m4a';
  const FORMAT = 'audio/mp4; codecs="mp4a.40.2"';
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) {}
  let player = null;
  let playingRequested = false;
  let pending = false;
  let pendingStartedAt = 0;
  let playTicket = 0;
  let state = 'idle';
  let errorReason = null;
  let lastPosition = NaN;
  let lastProgressAt = Date.now();
  let lastAttemptAt = 0;
  let interruptedByVisibility = false;

  function activatePlaybackSession() {
    try {
      const session = root.navigator?.audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
      return session?.type === 'playback';
    } catch (_) { return false; }
  }

  function render() {
    toggle.setAttribute('aria-pressed', String(enabled && !errorReason));
    toggle.setAttribute('aria-disabled', String(errorReason === 'unsupported'));
    toggle.textContent = errorReason === 'unsupported' ? '♪ 音声非対応'
      : errorReason === 'unavailable' ? '♪ 音源エラー・再試行'
      : !enabled ? '♪ 環境音 OFF'
      : state === 'playing' ? '♪ 再生中'
      : state === 'loading' ? '♪ 読み込み中'
      : state === 'blocked' ? '♪ 再生を試す'
      : '♪ 環境音 ON';
    toggle.title = !enabled ? '熱帯雨林の環境音をオンにする'
      : '熱帯雨林の環境音をオフにする';
  }

  function observePosition() {
    const p = player;
    if (!p) return;
    const position = Number(p.currentTime);
    if (!Number.isFinite(position)) return;
    if (!Number.isFinite(lastPosition)
        || position > lastPosition + 0.06
        || position < lastPosition - 0.5) {
      lastPosition = position;
      lastProgressAt = Date.now();
    }
  }

  function makePlayer() {
    const p = document.createElement('audio');
    p.src = new URL(SOURCE_PATH, document.baseURI).href;
    p.loop = true; // Native AAC gapless looping: no second iOS media element.
    p.preload = 'auto';
    p.playsInline = true;
    p.volume = 1;
    p.setAttribute('aria-hidden', 'true');
    p.addEventListener('playing', () => {
      if (p !== player || !enabled || !playingRequested) return;
      state = 'playing';
      observePosition();
      render();
    });
    p.addEventListener('timeupdate', () => {
      if (p !== player || !enabled) return;
      observePosition();
      checkPlayback();
    });
    p.addEventListener('ended', () => {
      if (p !== player || !enabled || !playingRequested) return;
      // loop=true ordinarily suppresses ended; some WebKit builds still
      // dispatch it. Rewind the same authorized AAC media element.
      attemptPlayback(true);
    });
    p.addEventListener('pause', () => {
      if (p !== player || !enabled || !playingRequested) return;
      if (state === 'playing') { state = 'blocked'; render(); }
    });
    p.addEventListener('error', () => {
      if (p !== player) return;
      pending = false;
      state = 'blocked';
      errorReason = p.error?.code === 4 ? 'unsupported' : 'unavailable';
      render();
    });
    p.addEventListener('waiting', () => {
      if (p !== player || !enabled || !playingRequested) return;
      if (state === 'playing') { state = 'loading'; render(); }
    });
    return p;
  }
  function replaceFailedPlayer() {
    if (player) {
      try { player.pause(); } catch (_) {}
    }
    ++playTicket;
    player = makePlayer();
    errorReason = null;
    lastPosition = NaN;
    lastProgressAt = Date.now();
    pending = false;
    lastAttemptAt = 0;
    state = 'idle';
  }
  replaceFailedPlayer();
  if (!player.canPlayType?.(FORMAT)) errorReason = 'unsupported';
  activatePlaybackSession();

  function attemptPlayback(rewind = false, userGesture = false) {
    if (!enabled || errorReason || document.hidden) return;
    if (pending && Date.now() - pendingStartedAt < 2500) return;
    pending = false;
    if (Date.now() - lastAttemptAt < 250 && !rewind && !userGesture) return;
    lastAttemptAt = Date.now();
    playingRequested = true;
    activatePlaybackSession();
    if (rewind || player.ended) {
      try { player.currentTime = 0; } catch (_) {}
    }
    const ticket = ++playTicket;
    state = 'loading';
    pending = true;
    pendingStartedAt = Date.now();
    render();
    try {
      // Play occurs synchronously in a real tap when there is one. Native
      // looping, once unlocked, does not need another JavaScript gesture.
      const result = player.play();
      Promise.resolve(result).then(() => {
        if (ticket !== playTicket || !enabled) return;
        pending = false;
        state = 'playing';
        observePosition();
        render();
      }).catch(error => {
        if (ticket !== playTicket || !enabled) return;
        pending = false;
        state = 'blocked';
        if (error?.name === 'NotSupportedError') errorReason = 'unsupported';
        render();
      });
    } catch (error) {
      if (ticket !== playTicket) return;
      pending = false;
      state = 'blocked';
      if (error?.name === 'NotSupportedError') errorReason = 'unsupported';
      render();
    }
  }

  function checkPlayback() {
    if (!enabled || !playingRequested || errorReason || document.hidden) return;
    const now = Date.now();
    const expired = pending && now - pendingStartedAt > 3000;
    if (expired) { pending = false; ++playTicket; }
    observePosition();
    const stalled = !pending && now - lastProgressAt > 2800;
    // AAC loop=true should handle the boundary without script timing.
    // If Safari reaches EOF and stalls, restore the same permitted player.
    if (player.paused || player.ended || stalled) {
      if (now - lastAttemptAt < 2200) return;
      const atEnd = player.ended
        || (Number.isFinite(player.duration) && player.duration > 1
          && player.currentTime >= player.duration - 0.6);
      if (stalled && !player.paused && !atEnd) {
        try { player.pause(); } catch (_) {}
      }
      lastPosition = NaN;
      lastProgressAt = now;
      attemptPlayback(atEnd);
    }
  }
  // Native AAC loops without a timer. This watchdog is only recovery,
  // not the engine that starts the next recording.
  const watchdog = setInterval(checkPlayback, 550);
  void watchdog;

  function resumeFromGesture() {
    if (!enabled || document.hidden) return;
    activatePlaybackSession();
    if (errorReason === 'unavailable') replaceFailedPlayer();
    if (errorReason) return;
    checkPlayback();
    if (pending && Date.now() - pendingStartedAt <= 2500) return;
    if (player.paused || player.ended || !playingRequested || state !== 'playing') {
      attemptPlayback(player.ended, true);
    }
  }

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (errorReason === 'unsupported') return;
    if (errorReason === 'unavailable') {
      replaceFailedPlayer();
      resumeFromGesture();
      return;
    }
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
    if (!enabled) {
      playingRequested = false;
      ++playTicket;
      pending = false;
      try { player.pause(); player.currentTime = 0; } catch (_) {}
      state = 'idle';
      render();
      return;
    }
    resumeFromGesture();
    render();
  });

  function unlock(event) {
    if (event?.target === toggle) return;
    if (event?.type === 'pointerdown' && event.pointerType !== 'mouse') return;
    resumeFromGesture();
  }
  document.addEventListener('pointerup', unlock, { capture: true });
  document.addEventListener('touchend', unlock, { capture: true });
  document.addEventListener('click', unlock, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      interruptedByVisibility = playingRequested;
      playingRequested = false;
      ++playTicket;
      pending = false;
      try { player.pause(); } catch (_) {}
      state = 'idle';
      render();
    } else if (interruptedByVisibility) {
      interruptedByVisibility = false;
      resumeFromGesture(); // Best effort. A real tap can unlock if blocked.
    }
  });
  root.addEventListener('pagehide', () => {
    try {
      if (enabled && playingRequested) {
        sessionStorage.setItem(ROUTE_RESUME_KEY, String(Date.now()));
      } else sessionStorage.removeItem(ROUTE_RESUME_KEY);
    } catch (_) {}
    ++playTicket;
    playingRequested = false;
    pending = false;
    try { player.pause(); } catch (_) {}
  });
  root.addEventListener('pageshow', () => {
    if (interruptedByVisibility && !document.hidden) {
      interruptedByVisibility = false;
      resumeFromGesture();
    }
  });
  let resumeIntent = false;
  try {
    const at = Number(sessionStorage.getItem(ROUTE_RESUME_KEY) || 0);
    sessionStorage.removeItem(ROUTE_RESUME_KEY);
    resumeIntent = at > 0 && Date.now() - at < 20000;
  } catch (_) {}
  if (resumeIntent && enabled) state = 'blocked';
  render();
  root.GitaiAmbientAudio = Object.freeze({
    isEnabled: () => enabled,
    isAvailable: () => !errorReason,
    isPlaying: () => enabled && !player.paused && state === 'playing',
    resumeFromGesture,
    activatePlaybackSession
  });
})(window);
