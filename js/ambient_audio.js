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
    if (!enabled || errorReason || document.hidden || pending || playState === 'playing') return;
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
  audio.addEventListener('error', () => {
    errorReason = 'unavailable';
    stop();
  });

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (errorReason) return;
    if (enabled && playState !== 'playing') {
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
    if (enabled && !pending && playState !== 'playing') playFromUserGesture();
  }
  // The initial click comes from a real human gesture. No autoplay on load.
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('click', unlock, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  root.addEventListener('pagehide', stop);
  render();

  root.GitaiAmbientAudio = Object.freeze({
    isEnabled: () => enabled,
    isAvailable: () => !errorReason,
    isPlaying: () => playState === 'playing',
    activatePlaybackSession,
  });
})(window);
