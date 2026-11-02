/* Standalone exhibition audio diagnostic. Does not import the game, SFX,
 * IndexedDB or the production ambient controller. All logs are local.
 */
(() => {
  'use strict';
  const audio = document.getElementById('player');
  const status = document.getElementById('status');
  const warning = document.getElementById('alert');
  const logText = document.getElementById('log-text');
  const recent = document.getElementById('recent');
  const copyState = document.getElementById('copy-status');
  const source = 'audio/gitailab_rainforest_ios_seamless_loop_48k.m4a';
  let mode = 'stopped';
  let lastPosition = NaN;
  let lastSampleAt = 0;
  let wraps = 0;
  let oddWraps = 0;
  let loopsRequested = 0;
  let lastLoggedSecond = -1;
  let generation = 0;
  const entries = [];
  const readable = number => Number.isFinite(number) ? number.toFixed(3) : '-';
  const sessionType = () => {
    try { return navigator.audioSession?.type || 'unavailable'; }
    catch (_) { return 'error'; }
  };
  const buffer = () => {
    try {
      const ranges = audio.buffered;
      if (!ranges?.length) return 'none';
      return Array.from({ length: Math.min(4, ranges.length) },
        (_, i) => readable(ranges.start(i)) + '-' + readable(ranges.end(i))).join(',');
    } catch (_) { return 'error'; }
  };
  const snapshot = () => 't=' + readable(audio.currentTime) + '/' + readable(audio.duration)
    + ' paused=' + audio.paused + ' ended=' + audio.ended
    + ' ready=' + audio.readyState + ' network=' + audio.networkState
    + ' seeking=' + audio.seeking + ' buffer=' + buffer()
    + ' hidden=' + document.hidden + ' audioSession=' + sessionType();
  function log(message) {
    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    entries.push(timestamp + ' [' + mode + '] ' + message);
    if (entries.length > 400) entries.shift();
    recent.textContent = entries.slice(-16).join('\n');
    recent.scrollTop = recent.scrollHeight;
  }
  function updateStatus() {
    status.textContent = 'モード: ' + mode
      + '\n再生位置: ' + readable(audio.currentTime) + ' / ' + readable(audio.duration) + ' 秒'
      + '\n正常な終端ループ: ' + wraps + ' 回'
      + '\n途中での巻き戻り: ' + oddWraps + ' 回'
      + '\n手動再生開始: ' + loopsRequested + ' 回'
      + '\npaused=' + audio.paused + ' / readyState=' + audio.readyState
      + '\naudioSession=' + sessionType()
      + '\n画面表示中=' + !document.hidden;
  }
  function checkPosition() {
    if (mode === 'stopped') return;
    const current = Number(audio.currentTime);
    const duration = Number(audio.duration);
    if (!Number.isFinite(current)) return;
    // A normal native loop wraps close to the END of the 45s recording.
    // A 4s->0s backward jump must be recorded as an abnormal short loop.
    if (Number.isFinite(lastPosition) && current < lastPosition - 0.45) {
      if (Number.isFinite(duration) && duration > 10 && lastPosition >= duration - 2.5) {
        wraps++;
        log('NORMAL_END_WRAP ' + readable(lastPosition) + ' -> ' + readable(current) + ' ' + snapshot());
      } else {
        oddWraps++;
        warning.hidden = false;
        log('UNEXPECTED_EARLY_WRAP ' + readable(lastPosition) + ' -> ' + readable(current)
          + ' [possible short audio loop] ' + snapshot());
      }
    }
    lastPosition = current;
    const now = Date.now();
    if (now - lastSampleAt >= 1000) {
      lastSampleAt = now;
      const second = Math.floor(current);
      if (lastLoggedSecond !== second) {
        lastLoggedSecond = second;
        log('sample ' + snapshot());
      }
    }
    updateStatus();
  }

  async function start(selected) {
    generation++;
    const runId = generation;
    mode = selected;
    lastPosition = NaN;
    lastSampleAt = 0;
    lastLoggedSecond = -1;
    wraps = 0;
    oddWraps = 0;
    loopsRequested = 0;
    warning.hidden = true;
    audio.pause();
    audio.loop = selected === 'native';
    audio.src = source;
    audio.load();
    try {
      const session = navigator.audioSession;
      if (session) session.type = 'playback';
    } catch (_) {}
    log('START mode=' + selected + ' source=' + source + ' loop=' + audio.loop
      + ' userAgent=' + navigator.userAgent + ' ' + snapshot());
    try {
      await audio.play();
      if (runId === generation) log('start.play resolved ' + snapshot());
    } catch (err) {
      if (runId === generation) log('start.play rejected ' + (err?.name || err) + ' ' + snapshot());
    }
    updateStatus();
  }
  function stop() {
    generation++;
    log('STOP ' + snapshot());
    mode = 'stopped';
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    lastPosition = NaN;
    updateStatus();
  }
  document.getElementById('native').addEventListener('click', () => { void start('native'); });
  document.getElementById('manual').addEventListener('click', () => { void start('manual'); });
  document.getElementById('stop').addEventListener('click', stop);
  for (const event of [
    'loadstart', 'loadedmetadata', 'durationchange', 'canplay',
    'canplaythrough', 'playing', 'pause', 'waiting', 'stalled',
    'suspend', 'seeking', 'seeked', 'ended', 'emptied', 'error',
    'ratechange', 'abort'
  ]) {
    audio.addEventListener(event, () => {
      log(event + ' ' + snapshot()
        + (event === 'error' ? ' err=' + audio.error?.code : ''));
      if (event === 'ended' && mode === 'manual') {
        // Only used in the explicit manual mode: compare WebKit's native
        // looping with ending+seeking+replay, never start two players.
        loopsRequested++;
        try { audio.currentTime = 0; } catch (e) { log('seek rejected ' + e); }
        audio.play().then(() => log('manual restart succeeded ' + snapshot()))
          .catch(e => log('manual restart rejected ' + (e?.name || e) + ' ' + snapshot()));
      }
      updateStatus();
    });
  }
  audio.addEventListener('timeupdate', checkPosition);
  document.addEventListener('visibilitychange', () => log('VISIBILITY_CHANGE ' + snapshot()));
  window.addEventListener('pagehide', () => log('PAGE_HIDE ' + snapshot()));
  window.addEventListener('pageshow', () => log('PAGE_SHOW ' + snapshot()));
  // Not required for playback; records position drift/abnormal wraps even
  // when WebKit doesn't issue a timeupdate at the problematic transition.
  setInterval(checkPosition, 250);

  document.getElementById('copy').addEventListener('click', async () => {
    const report = [
      'GITAI_LAB_BGM_LOOP_DIAGNOSTIC_V1',
      'URL=' + location.pathname,
      'mode=' + mode,
      'normal_wraps=' + wraps,
      'unexpected_early_wraps=' + oddWraps,
      'sound_source=' + source,
      'current=' + snapshot(),
      ...entries
    ].join('\n');
    logText.value = report;
    logText.focus();
    logText.select();
    try {
      await navigator.clipboard.writeText(report);
      copyState.textContent = 'ログをコピーしました。ChatGPTへ貼り付けてください。';
    } catch (_) {
      copyState.textContent = '自動コピーできません。下のテキストを長押ししてコピーしてください。';
    }
  });
  updateStatus();
  log('READY (this page does not open or modify game saves)');
})();