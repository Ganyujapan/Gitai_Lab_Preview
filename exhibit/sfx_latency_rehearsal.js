/* iPad sound-latency comparison: isolated from all game and browser storage. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const route = params.get('sfx') === 'fast' ? 'fast'
    : params.get('sfx') === 'release' ? 'release' : 'native';
  const labels = {
    native: '旧標準AAC（タップ時に再生要求）',
    fast: '展示版標準Web Audio（最初のタップで準備）',
    release: '比較AAC（指を離す時に要求）'
  };
  const ids = { native: 'routeNative', fast: 'routeFast', release: 'routeRelease' };
  document.getElementById(ids[route]).setAttribute('aria-current', 'page');
  const routeStatus = document.getElementById('routeStatus');
  const status = document.getElementById('status');
  const report = document.getElementById('report');
  const bgmToggle = document.getElementById('bgmToggle');
  const copyStatus = document.getElementById('copyStatus');
  let bgm = null;
  let bgmEnabled = false;
  const taps = { capture: 0, poison: 0, death: 0 };
  const started = new Date().toISOString();

  function selectAudioSession() {
    try {
      const session = navigator.audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch (_) {}
  }
  // Match the production game's audio-session helper without importing
  // ambient_audio.js (which normally reads/writes the player's preference).
  window.GitaiAmbientAudio = Object.freeze({
    activatePlaybackSession: selectAudioSession
  });

  function reportText() {
    return [
      'ギタイラボ・iPad効果音比較（隔離テスト）',
      '確認開始: ' + started,
      '再生方式: ' + labels[route],
      'BGM同時再生: ' + (bgmEnabled ? 'ON' : 'OFF'),
      '捕食タップ: ' + taps.capture,
      '毒タップ: ' + taps.poison,
      '死亡タップ: ' + taps.death,
      '聞こえ方: 即時 / 少し遅い / 明らかに遅い / 無音（開発スレッドで追記）',
      '注意: タップ回数は音声出力の成功数ではありません'
    ].join('\n');
  }
  function redraw() { report.textContent = reportText(); }
  function statusText(message) { status.textContent = message; }
  routeStatus.textContent = '現在の方式：' + labels[route];
  redraw();

  const sfx = window.GitaiGameSfx;
  if (!sfx) {
    statusText('効果音コードを読み込めませんでした。');
    document.querySelectorAll('[data-sfx]').forEach(b => b.disabled = true);
    return;
  }
  statusText('音源を準備中…');
  Promise.resolve(sfx.prepare()).then(() => {
    statusText('準備完了。各ボタンをタップして聞こえ方を比較してください。');
  }).catch(() => { statusText('一部の音声を準備できませんでした。'); });

  // The production listener stores the pointer in document capture phase,
  // before this target pointerdown. Do NOT await or debounce the sound:
  // the real game calls play() synchronously on a successful capture.
  document.querySelectorAll('[data-sfx]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || (typeof event.button === 'number' && event.button > 0)) return;
      const kind = button.dataset.sfx;
      if (!(kind in taps)) return;
      taps[kind] += 1;
      sfx.play(kind);
      redraw();
    });
  });

  bgmToggle.addEventListener('click', () => {
    if (!bgm) {
      bgm = document.createElement('audio');
      bgm.src = 'audio/gitailab_rainforest_overlap_test_48k.ogg';
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.playsInline = true;
      bgm.volume = 1;
    }
    if (bgmEnabled) {
      bgm.pause();
      bgmEnabled = false;
      bgmToggle.textContent = '熱帯雨林BGM：OFF';
      bgmToggle.setAttribute('aria-pressed', 'false');
      statusText('BGMを停止しました。');
      redraw();
      return;
    }
    selectAudioSession();
    // Direct click, without await: preserve Safari user-gesture activation.
    try {
      const attempt = bgm.play();
      bgmEnabled = true;
      bgmToggle.textContent = '熱帯雨林BGM：ON';
      bgmToggle.setAttribute('aria-pressed', 'true');
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          bgmEnabled = false;
          bgmToggle.textContent = '熱帯雨林BGM：OFF（再生失敗）';
          bgmToggle.setAttribute('aria-pressed', 'false');
          statusText('BGMを再生できませんでした。');
          redraw();
        });
      }
      redraw();
    } catch (_) {
      bgmEnabled = false;
      statusText('BGMを再生できませんでした。');
    }
  });
  window.addEventListener('pagehide', () => { if (bgm) bgm.pause(); });

  document.getElementById('copy').addEventListener('click', async () => {
    const text = reportText();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = '記録をコピーしました。実際の聞こえ方も追記してください。';
    } catch (_) {
      copyStatus.textContent = 'コピーできない場合は、画面の記録を選択して共有してください。';
    }
  });
})();
