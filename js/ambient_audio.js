/* Original rainforest Ogg/Opus: play it as native HTML media, exactly like
 * the standalone diagnostic page that succeeded on the user's iPhone.
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
  const SOURCE_PATH = 'audio/gitailab_rainforest_soft_48k.ogg';
  const SOURCE_TYPE = 'audio/ogg; codecs="opus"';

  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) {}

  const audio = document.createElement('audio');
  audio.src = new URL(SOURCE_PATH, document.baseURI).href;
  audio.loop = true;
  audio.preload = 'metadata';
  audio.playsInline = true;
  audio.volume = 1; // Direct media playback; do NOT route through AudioContext.
  audio.setAttribute('aria-hidden', 'true');

  let playState = 'idle';
  let pending = false;
  let interruptedByVisibility = false;
  let resumeAfterRoute = false;
  try {
    const savedAt = Number(sessionStorage.getItem(ROUTE_RESUME_KEY) || 0);
    sessionStorage.removeItem(ROUTE_RESUME_KEY);
    resumeAfterRoute = savedAt > 0 && Date.now() - savedAt < 20000;
  } catch (_) {}
  let errorReason = typeof audio.canPlayType === 'function'
    && audio.canPlayType(SOURCE_TYPE) === '' ? 'unsupported' : null;

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
    if (playState === 'playing' && audio.paused === false && !audio.ended) return;
    activatePlaybackSession();
    playState = 'loading';
    pending = true;
    render();
    try {
      // Crucially synchronous with the pointer/click, as in the audio test.
      const attempt = audio.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => {
          pending = false;
        }).catch(error => {
          pending = false;
          if (!enabled) return;
          if (error?.name === 'NotSupportedError') errorReason = 'unsupported';
          else if (error?.name !== 'AbortError') playState = 'blocked';
          render();
        });
      } else {
        pending = false;
      }
    } catch (_) {
      pending = false;
      playState = 'blocked';
      render();
    }
  }

  function stop() {
    pending = false;
    audio.pause();
    playState = 'idle';
    render();
  }

  audio.addEventListener('playing', () => {
    pending = false;
    if (!enabled) { audio.pause(); return; }
    // Playback status cannot prove a user's output route is audible.
    playState = 'playing';
    render();
  });
  audio.addEventListener('waiting', () => {
    if (enabled) { playState = 'loading'; render(); }
  });
  audio.addEventListener('pause', () => {
    // WebKit can interrupt media without our stop() being called. Reset the
    // UI state, so a tutorial Skip / following click can actually resume it.
    pending = false;
    if (playState !== 'idle') {
      playState = 'idle';
      render();
    }
  });
  audio.addEventListener('error', () => {
    errorReason = 'unavailable';
    stop();
  });

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (errorReason) return;
    if (enabled && (playState !== 'playing' || audio.paused === true)) {
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
    if (enabled && !pending
        && (playState !== 'playing' || audio.paused === true || audio.ended)) {
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
        && (playState === 'playing' || pending || audio.paused === false);
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
           || audio.paused === false)) {
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
