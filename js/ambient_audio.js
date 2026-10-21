/* Quiet rainforest ambience from the user's original Ogg/Opus recording.
 * Independent of gameplay, evolution RNG, saved generations, and capture SE.
 * The source recording averages only -46.7 dBFS: never attenuate it by 0.10. */
(function (root) {
  'use strict';
  const toggle = document.getElementById('ambientAudioToggle');
  if (!toggle) return;
  const STORAGE_KEY = 'gitai-ambient-audio-enabled-v1';
  const SOURCE_PATH = 'audio/gitailab_rainforest_soft_48k.ogg';
  const SOURCE_TYPE = 'audio/ogg; codecs="opus"';
  // Original Ogg has max sample ~-29.8 dBFS and mean ~-46.7 dBFS.
  // +14dB gain gives a quiet but audible ambience with ample peak headroom.
  const PLAYBACK_GAIN = 5.0;
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) {}

  const audio = document.createElement('audio');
  audio.src = new URL(SOURCE_PATH, document.baseURI).href;
  audio.loop = true;
  audio.preload = 'none';
  audio.playsInline = true;
  audio.setAttribute('aria-hidden', 'true');
  let context = null;
  let gainNode = null;
  let attemptedByGesture = false;
  let playState = 'idle';
  let errorReason = typeof audio.canPlayType === 'function'
    && audio.canPlayType(SOURCE_TYPE) === '' ? 'unsupported' : null;

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
    toggle.title = errorReason === 'unsupported'
      ? 'このブラウザはOgg Opusに対応していません。'
      : errorReason === 'unavailable'
        ? '音源ファイルが読み込めません。再読み込みしてお試しください。'
        : !enabled ? '熱帯雨林の環境音をオンにする'
        : playState === 'playing' ? '熱帯雨林の環境音をオフにする'
        : '押すと環境音の再生を試します';
  }

  function ensureAudioGraph() {
    if (context) return;
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    if (!AudioCtx) {
      // Safari may ignore HTMLMediaElement.volume; keep its full native
      // output rather than silently attenuating an already quiet recording.
      audio.volume = 1;
      return;
    }
    try {
      const graph = new AudioCtx();
      const node = graph.createMediaElementSource(audio);
      const gain = graph.createGain();
      gain.gain.value = PLAYBACK_GAIN;
      node.connect(gain);
      gain.connect(graph.destination);
      context = graph;
      gainNode = gain;
      audio.volume = 1;
    } catch (_) {
      // Some embedded WebViews disallow AudioContext; the native media
      // element may still be audible at its original low volume.
      audio.volume = 1;
    }
  }

  function playFromUserGesture() {
    if (!enabled || errorReason || document.hidden) return;
    attemptedByGesture = true;
    ensureAudioGraph();
    playState = 'loading';
    render();
    if (context && context.state === 'suspended') {
      context.resume().catch(() => {
        // A genuine additional gesture may unlock Web Audio in WebKit.
        if (enabled) {
          playState = 'blocked';
          render();
        }
      });
    }
    try {
      // Call play synchronously within the trusted pointer/click event:
      // deferring it until an audio fetch or setTimeout would break iOS.
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => {
          if (!enabled) return;
          if (error?.name === 'NotSupportedError') {
            errorReason = 'unsupported';
          } else if (error?.name !== 'AbortError') {
            playState = 'blocked';
          }
          render();
        });
      }
    } catch (_) {
      playState = 'blocked';
      render();
    }
  }

  function stop() {
    audio.pause();
    playState = 'idle';
    render();
  }
  audio.addEventListener('playing', () => {
    if (!enabled) return;
    // This is a playback event, unlike an ON setting which proves nothing.
    playState = context && context.state !== 'running' ? 'blocked' : 'playing';
    render();
  });
  audio.addEventListener('waiting', () => {
    if (enabled) {
      playState = 'loading';
      render();
    }
  });
  audio.addEventListener('error', () => {
    errorReason = 'unavailable';
    stop();
    render();
  });

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (errorReason) return;
    // If "ON" was silent (policy, loading, or interrupted playback), tapping
    // retries first rather than confusingly muting an already silent source.
    if (enabled && playState !== 'playing') {
      playFromUserGesture();
      return;
    }
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
    if (enabled) playFromUserGesture();
    else stop();
    render();
  });

  // The first gesture unlocks on Safari and Android. Further taps permit
  // recovery after iOS WebView interruption, but not duplicate active audio.
  function unlock(event) {
    if (event?.target === toggle || !enabled || errorReason) return;
    if (playState === 'playing' && (!context || context.state === 'running')) return;
    playFromUserGesture();
  }
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('click', unlock, { capture: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    // Resume only from a real user gesture; browsers may reject autoplay on
    // visibility restore. A later pointer/click then retries playback.
  });
  root.addEventListener('pagehide', stop);

  render();
  root.GitaiAmbientAudio = Object.freeze({
    isEnabled: () => enabled,
    isAvailable: () => !errorReason,
    isPlaying: () => playState === 'playing',
  });
})(window);
