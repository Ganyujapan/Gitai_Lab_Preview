/* Quiet, single-source rainforest recording. This ambience is entirely
 * independent of the predation sound effects and evolutionary algorithm.
 * Ship audio/gitailab_rainforest_soft_48k.ogg with this runtime script. */
(function (root) {
  'use strict';
  const toggle = document.getElementById('ambientAudioToggle');
  if (!toggle) return;

  const STORAGE_KEY = 'gitai-ambient-audio-enabled-v1';
  const SOURCE_PATH = 'audio/gitailab_rainforest_soft_48k.ogg';
  const SOURCE_TYPE = 'audio/ogg; codecs="opus"';
  const VOLUME = 0.10;

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
  // iPadOS / Safari 18.4+ supports Ogg Opus; older WebKit does not.
  // Detect incompatibility up front so an unsupported iPad never crashes.
  let errorReason = typeof audio.canPlayType === 'function'
    && audio.canPlayType(SOURCE_TYPE) === ''
    ? 'unsupported' : null;

  function render() {
    toggle.setAttribute('aria-pressed', String(enabled && !errorReason));
    toggle.setAttribute('aria-disabled', String(Boolean(errorReason)));
    toggle.textContent = errorReason === 'unsupported'
      ? '♪ 音声非対応'
      : errorReason === 'unavailable'
        ? '♪ 音源未設定'
        : enabled ? '♪ 環境音 ON' : '♪ 環境音 OFF';
    toggle.title = errorReason === 'unsupported'
      ? 'このブラウザはOgg Opusに対応していません。iPadOS 18.4以降をお試しください。'
      : errorReason === 'unavailable'
        ? '環境音を読み込めません。通信または音源ファイルをご確認ください。'
        : '熱帯雨林の環境音を' + (enabled ? 'オフ' : 'オン') + 'にする';
  }

  function ensureAudioGraph() {
    if (context || gainNode) return;
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    if (!AudioCtx) {
      audio.volume = VOLUME;
      return;
    }
    try {
      const graph = new AudioCtx();
      const source = graph.createMediaElementSource(audio);
      const gain = graph.createGain();
      gain.gain.value = VOLUME;
      source.connect(gain);
      gain.connect(graph.destination);
      context = graph;
      gainNode = gain;
      audio.volume = 1;
    } catch (_) {
      // Keep the rest of the game playable even if Web Audio is unavailable.
      audio.volume = VOLUME;
    }
  }

  function playFromUserGesture() {
    if (!enabled || errorReason || document.hidden) return;
    attemptedByGesture = true;
    ensureAudioGraph();
    if (context && context.state === 'suspended') {
      context.resume().catch(() => {});
    }
    try {
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => {
          if (error?.name === 'NotSupportedError') {
            errorReason = 'unsupported';
            render();
          }
          // An autoplay-policy failure may recover at the next user gesture.
        });
      }
    } catch (_) {}
  }

  function stop() {
    audio.pause();
  }

  audio.addEventListener('error', () => {
    errorReason = 'unavailable';
    stop();
    render();
  });

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (errorReason === 'unsupported') {
      render();
      return;
    }
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
    if (enabled) {
      errorReason = null;
      playFromUserGesture();
    } else {
      stop();
    }
    render();
  });

  // Browsers prohibit autoplay before the first real user gesture. Keep the
  // first start gesture audible, but never start from a timer or page load.
  function unlock(event) {
    if (event?.target === toggle) return;
    playFromUserGesture();
  }
  document.addEventListener('pointerdown', unlock, { capture: true, once: true });
  document.addEventListener('click', unlock, { capture: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (attemptedByGesture && enabled && !errorReason) playFromUserGesture();
  });
  root.addEventListener('pagehide', stop);

  render();
  root.GitaiAmbientAudio = Object.freeze({
    isEnabled: () => enabled,
    isAvailable: () => !errorReason,
  });
})(window);
