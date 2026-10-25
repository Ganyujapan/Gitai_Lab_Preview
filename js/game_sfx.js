/* Gitai Lab recorded SFX — independent of rainforest BGM and simulation RNG.
 * Decoded Web Audio buffers start inside the successful pointerdown handler;
 * preloaded native AAC/Opus players are the nonblocking Safari fallback.
 */
(() => {
  'use strict';
  const w = window;
  const GROUPS = Object.freeze({ capture: 4, poison: 4, death: 2 });
  // Relative gains, separate from the native rainforest BGM's volume/mute.
  const VOLUME = Object.freeze({ capture: 0.1935, poison: 0.1835, death: 0.64 });
  const MAX_VOICES = 8;
  const root = 'audio/sfx/';
  const AudioContextCtor = w.AudioContext || w.webkitAudioContext;
  const probe = document.createElement('audio');
  const oggPlayable = !!probe.canPlayType?.('audio/ogg; codecs="opus"');
  const formats = oggPlayable ? ['opus', 'aac'] : ['aac', 'opus'];
  const fileName = (kind, number, format) =>
    root + format + '/' + kind + '_' + String(number).padStart(2, '0')
      + (format === 'opus' ? '.ogg' : '.m4a');

  // Crypto RNG does not advance the evolution model's pseudorandom stream.
  function variantIndex(n) {
    try {
      const values = new Uint32Array(1);
      w.crypto.getRandomValues(values);
      return values[0] % n;
    } catch (_) {
      // Only for old insecure WebViews without crypto. Never touch the simulation generator.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    }
  }
  let seed = (Date.now() >>> 0) ^ 0x547a1b09;
  let context = null;
  let master = null;
  let preparing = null;
  const decoded = new Map();
  const native = new Map();
  const live = [];
  const liveNative = [];
  // On iPadOS WebKit the AudioContext can become "interrupted", or claim
  // "running" while its clock stops. Detect the frozen clock and switch
  // further taps to native media rather than silently playing into it.
  let preferNative = false;
  let previousClockMs = 0;
  let previousClockSec = 0;
  let pendingTouchSound = null;
  const touchDevice = Number(w.navigator?.maxTouchPoints || 0) > 0;
  // Mixed native media + Web Audio can silence subsequent taps on iPadOS.
  // Keep both BGM and recorded SFX on native HTMLMediaElements on iOS.
  const iosDevice = /iPad|iPhone|iPod/.test(w.navigator?.userAgent || '')
    || (w.navigator?.platform === 'MacIntel' && touchDevice);
  function contextHealthy() {
    const ctx = getContext();
    if (!ctx || ctx.state !== 'running' || preferNative) return false;
    if (typeof ctx.currentTime === 'number' && Number.isFinite(ctx.currentTime)) {
      const now = Date.now();
      if (previousClockMs && now - previousClockMs > 150
          && ctx.currentTime - previousClockSec < 0.015 && !document.hidden) {
        preferNative = true;
        return false;
      }
      previousClockMs = now;
      previousClockSec = ctx.currentTime;
    }
    return true;
  }
  function nativeOnNextGesture(kind, number) {
    if (touchDevice) pendingTouchSound = { kind, number };
    else playNative(kind, number);
  }
  function flushTouchSound() {
    // iOS user activation comes with pointerup/touchend, not pointerdown.
    // Retry interrupted WebAudio for future taps; play this tap natively.
    activate();
    const pending = pendingTouchSound;
    pendingTouchSound = null;
    if (pending) playNative(pending.kind, pending.number);
  }

  function key(kind, number) { return kind + '_' + number; }
  function getContext() {
    if (iosDevice || context || !AudioContextCtor) return context;
    try {
      context = new AudioContextCtor({ latencyHint: 'interactive' });
      // An iPad WebKit interruption can persist despite calling resume().
      // Don't feed a dead context; future sounds go through native AAC.
      context.addEventListener?.('statechange', () => {
        if (context?.state === 'interrupted') preferNative = true;
      });
      master = context.createDynamicsCompressor();
      master.threshold.value = -12;
      master.knee.value = 4;
      master.ratio.value = 8;
      master.attack.value = 0.003;
      master.release.value = 0.12;
      master.connect(context.destination);
    } catch (_) { context = null; master = null; }
    return context;
  }

  function ensureNative(kind, number) {
    const id = key(kind, number);
    if (native.has(id)) return native.get(id);
    // Native AAC is the most reliable iPad/iPhone media codec. Safari may
    // report Ogg support yet fail to play that codec in native <audio>.
    const format = touchDevice ? 'aac' : formats[0];
    const list = Array.from({ length: 2 }, () => {
      const player = document.createElement('audio');
      player.preload = 'auto';
      player.playsInline = true;
      player.src = fileName(kind, number, format);
      player.volume = VOLUME[kind];
      try { player.load(); } catch (_) {}
      return player;
    });
    native.set(id, { list, next: 0 });
    return native.get(id);
  }

  async function decodeOne(kind, number) {
    const audio = getContext();
    if (!audio || typeof w.fetch !== 'function') return;
    for (const format of formats) {
      try {
        const response = await w.fetch(fileName(kind, number, format), { cache: 'force-cache' });
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        const buffer = await audio.decodeAudioData(bytes);
        decoded.set(key(kind, number), buffer);
        return;
      } catch (_) {
        // Ogg Opus decode may be unsupported by this Safari version: try AAC.
      }
    }
  }

  function prepare() {
    if (preparing) return preparing;
    const tasks = [];
    for (const [kind, count] of Object.entries(GROUPS)) {
      for (let i = 1; i <= count; i += 1) {
        ensureNative(kind, i);
        if (!iosDevice) tasks.push(decodeOne(kind, i));
      }
    }
    preparing = Promise.all(tasks).catch(() => {});
    return preparing;
  }

  function activate() {
    if (iosDevice) return; // Do not create/switch to Web Audio on iOS.
    const ctx = getContext();
    if (ctx && ctx.state !== 'running') {
      try {
        const pending = ctx.resume();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
    }
  }

  function stopKind(kind) {
    for (const item of [...live]) {
      if (item.kind !== kind) continue;
      try { item.source.stop(); } catch (_) {}
      const i = live.indexOf(item);
      if (i !== -1) live.splice(i, 1);
    }
    for (const item of [...liveNative]) {
      if (item.kind !== kind) continue;
      try { item.player.pause(); } catch (_) {}
      const i = liveNative.indexOf(item);
      if (i !== -1) liveNative.splice(i, 1);
    }
  }

  function playBuffer(kind, buffer) {
    const ctx = getContext();
    if (!contextHealthy() || !master || !buffer) return false;
    try {
      if (live.length >= MAX_VOICES) {
        const oldest = live.shift();
        try { oldest.source.stop(); } catch (_) {}
      }
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = VOLUME[kind];
      source.connect(gain);
      gain.connect(master);
      const item = { source, kind };
      live.push(item);
      source.onended = () => {
        const i = live.indexOf(item);
        if (i !== -1) live.splice(i, 1);
        try { source.disconnect(); gain.disconnect(); } catch (_) {}
      };
      source.start(0); // No setTimeout, rendering, animation or network wait.
      return true;
    } catch (_) { return false; }
  }

  function playNative(kind, number) {
    try {
      const entry = ensureNative(kind, number);
      const player = entry.list[entry.next];
      entry.next = (entry.next + 1) % entry.list.length;
      const already = liveNative.findIndex(item => item.player === player);
      if (already !== -1) liveNative.splice(already, 1);
      if (liveNative.length >= MAX_VOICES) {
        const oldest = liveNative.shift();
        try { oldest.player.pause(); } catch (_) {}
      }
      try { player.pause(); player.currentTime = 0; } catch (_) {}
      const item = { player, kind };
      liveNative.push(item);
      const done = () => {
        const i = liveNative.indexOf(item);
        if (i !== -1) liveNative.splice(i, 1);
      };
      player.addEventListener('ended', done, { once: true });
      const attempt = player.play(); // Directly inside the caller's user gesture.
      if (attempt && typeof attempt.catch === 'function') attempt.catch(done);
    } catch (_) { /* Sound must never interrupt gameplay. */ }
  }

  function play(kind) {
    if (!Object.prototype.hasOwnProperty.call(GROUPS, kind)) return;
    try {
      if (!preparing) prepare();
      if (kind === 'death') stopKind('poison'); // Avoid overlap at lethal capture.
      const number = variantIndex(GROUPS[kind]) + 1;
      if (iosDevice) {
        // The next pointerup/touchend is the real Safari media gesture.
        nativeOnNextGesture(kind, number);
        return;
      }
      activate();
      if (!playBuffer(kind, decoded.get(key(kind, number)))) {
        nativeOnNextGesture(kind, number);
      }
    } catch (_) { /* Keep predation and progression independent of audio. */ }
  }

  document.addEventListener('pointerdown', activate, { capture: true, passive: true });
  document.addEventListener('pointerup', flushTouchSound, { capture: true, passive: true });
  document.addEventListener('touchend', flushTouchSound, { capture: true, passive: true });
  document.addEventListener('click', flushTouchSound, { capture: true });
  w.GitaiGameSfx = Object.freeze({ prepare, activate, play, volumes: VOLUME });
  // Start decoding before game-start and cache the files for future taps.
  prepare();
})();