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
  let pendingFastSound = null;
  let lastPointer = null;
  const TOUCH_SOUND_MAX_AGE_MS = 2500;
  // PF02 / SFX-L02: gesture expiry and async resume expiry are separate.
  // A valid long press can reach pointerup, but a resume that resolves
  // seconds later must never emit a surprise delayed capture.
  const RESUME_SOUND_MAX_AGE_MS = 450;
  let audioVisibilityEpoch = 0;
  let gestureSerial = 0;
  const pendingResumes = new Set();
  // A new document gets a NEW AudioContext. In iOS, auto-start's synthetic
  // click after a generation reload does not grant playback activation.
  // Arm the fast audio graph from a *trusted* pointerup/touchend before
  // claiming that subsequent pointerdown buffer starts are audible.
  let fastUnlocked = false;
  const touchDevice = Number(w.navigator?.maxTouchPoints || 0) > 0;
  // Mixed native media + Web Audio can silence subsequent taps on iPadOS.
  // Keep both BGM and recorded SFX on native HTMLMediaElements on iOS.
  const iosDevice = /iPad|iPhone|iPod/.test(w.navigator?.userAgent || '')
    || (w.navigator?.platform === 'MacIntel' && touchDevice);
  // The verified AAC-native route remains the iOS default. Opt in to a
  // low-latency experiment with ?sfx=fast: decode AAC before gameplay and
  // start AudioBufferSourceNode on the successful pointerdown. A suspended,
  // interrupted or frozen context falls back to AAC on pointerup.
  // Never alter the rainforest BGM's independent native media elements.
  const lowLatencyIOS = iosDevice && /(?:^|[?&])sfx=fast(?:&|$)/.test(w.location?.search || '');
  // SFX-L03: the capture itself happens on pointerdown, so ask the native
  // AAC player to start at that instant. Keep an explicit opt-out for Safari
  // devices where BGM + native audio behaves differently (?sfx=release).
  // This does NOT enable mixed WebAudio/BGM on every iPad.
  const instantNativeIOS = iosDevice && !lowLatencyIOS
    && !/(?:^|[?&])sfx=release(?:&|$)/.test(w.location?.search || '');
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
    if (touchDevice) pendingTouchSound = {
      kind, number, pointerId: lastPointer?.id ?? null, createdAt: Date.now()
    };
    else playNative(kind, number);
  }
  function queueFastSound(kind, number) {
    pendingFastSound = {
      kind, number, pointerId: lastPointer?.id ?? null, createdAt: Date.now()
    };
  }
  function flushTouchSound(event) {
    // Do not treat a synthetic click or an unrelated input as permission
    // to play an old hit. The default native iOS path remains unchanged.
    if (event?.type === 'click' || event?.isTrusted === false) return;
    if (lowLatencyIOS) {
      const sound = pendingFastSound;
      if (sound && (document.hidden
          || Date.now() - sound.createdAt > TOUCH_SOUND_MAX_AGE_MS)) {
        pendingFastSound = null;
        return;
      }
      if (sound?.pointerId != null && event?.type === 'pointerup'
          && event.pointerId !== sound.pointerId) return;
      if (sound?.pointerId != null && event?.type === 'touchend'
          && typeof w.PointerEvent !== 'undefined') return;

      pendingFastSound = null;
      const startedAt = Date.now();
      const epoch = audioVisibilityEpoch;
      const ticket = sound
        ? { ...sound, startedAt, epoch, gestureSerial, cancelled: false, played: false }
        : null;
      if (ticket) pendingResumes.add(ticket);
      const valid = () => ticket
        && !ticket.cancelled && !ticket.played
        && !document.hidden && epoch === audioVisibilityEpoch
        && ticket.gestureSerial === gestureSerial
        && Date.now() - startedAt <= RESUME_SOUND_MAX_AGE_MS
        && Date.now() - ticket.createdAt <= TOUCH_SOUND_MAX_AGE_MS;
      const playOnce = callback => {
        if (!valid()) return;
        ticket.played = true;
        pendingResumes.delete(ticket);
        callback();
      };
      const finish = () => {
        if (ticket) pendingResumes.delete(ticket);
      };
      const ctx = getContext();
      if (!ctx) {
        playOnce(() => playNative(sound.kind, sound.number));
        finish();
        return;
      }
      const recover = () => {
        if (ctx !== context || document.hidden || epoch !== audioVisibilityEpoch
            || (ticket && !valid())) {
          finish();
          return;
        }
        if (ctx.state !== 'running') {
          playOnce(() => playNative(sound.kind, sound.number));
          finish();
          return;
        }
        fastUnlocked = true;
        preferNative = false;
        previousClockMs = 0;
        previousClockSec = 0;
        playOnce(() => {
          if (!playBuffer(sound.kind, decoded.get(key(sound.kind, sound.number)))) {
            playNative(sound.kind, sound.number);
          }
        });
        finish();
      };
      // Continue to resume synchronously inside the real user gesture.
      // Its asynchronous result may unlock the graph, but only a still
      // valid ticket may play the sound once.
      if (!fastUnlocked || preferNative || ctx.state !== 'running') {
        try {
          const attempt = ctx.resume();
          if (attempt && typeof attempt.then === 'function') {
            attempt.then(recover).catch(() => {
              if (ctx === context && epoch === audioVisibilityEpoch
                  && (!ticket || valid())) fastUnlocked = false;
              playOnce(() => playNative(sound.kind, sound.number));
              finish();
            });
          } else recover();
        } catch (_) {
          if (ctx === context && epoch === audioVisibilityEpoch
              && (!ticket || valid())) fastUnlocked = false;
          playOnce(() => playNative(sound.kind, sound.number));
          finish();
        }
      } else {
        playOnce(() => {
          if (!playBuffer(sound.kind, decoded.get(key(sound.kind, sound.number)))) {
            playNative(sound.kind, sound.number);
          }
        });
        finish();
      }
      return;
    }
    const pending = pendingTouchSound;
    if (pending && (document.hidden || Date.now() - pending.createdAt > TOUCH_SOUND_MAX_AGE_MS)) {
      pendingTouchSound = null;
      return;
    }
    if (pending?.pointerId != null && event?.type === 'pointerup'
        && event.pointerId !== pending.pointerId) return;
    if (pending?.pointerId != null && event?.type === 'touchend'
        && typeof w.PointerEvent !== 'undefined') return;
    activate();
    pendingTouchSound = null;
    if (pending) {
      if (instantNativeIOS && pending.voice) {
        if (liveNative.includes(pending.voice)) {
          // Same element, same sound, no currentTime reset or second voice.
          pending.voice.retry();
        } else if (pending.voice.failed) {
          // Browser rejected pointerdown activation: retry only on this
          // gesture's matching trusted pointerup (or legacy touchend).
          playNative(pending.kind, pending.number);
        }
      } else {
        playNative(pending.kind, pending.number);
      }
    }
  }

  function key(kind, number) { return kind + '_' + number; }
  function getContext() {
    if ((iosDevice && !lowLatencyIOS) || context || !AudioContextCtor) return context;
    try {
      context = new AudioContextCtor({ latencyHint: 'interactive' });
      // An iPad WebKit interruption can persist despite calling resume().
      // Don't feed a dead context; future sounds go through native AAC.
      context.addEventListener?.('statechange', () => {
        if (context?.state === 'interrupted' || context?.state === 'suspended') {
          preferNative = true;
          if (lowLatencyIOS) fastUnlocked = false;
        }
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
    for (const format of (lowLatencyIOS ? ['aac', 'opus'] : formats)) {
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
        if (!iosDevice || lowLatencyIOS) tasks.push(decodeOne(kind, i));
      }
    }
    preparing = Promise.all(tasks).catch(() => {});
    return preparing;
  }

  function activate() {
    if (iosDevice && !lowLatencyIOS) return; // Preserve the verified AAC-native default.
    const ctx = getContext();
    if (ctx && ctx.state !== 'running') {
      try {
        const pending = ctx.resume();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
    }
  }

  function releaseNative(item) {
    // A voice can be interrupted, reused, or rejected before 'ended' fires.
    // Detach its own handler, never one belonging to a newer playback.
    if (item.onEnded) item.player.removeEventListener?.('ended', item.onEnded);
    const index = liveNative.indexOf(item);
    if (index !== -1) liveNative.splice(index, 1);
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
      releaseNative(item);
      try { item.player.pause(); } catch (_) {}
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
      const previous = liveNative.find(item => item.player === player);
      if (previous) releaseNative(previous);
      if (liveNative.length >= MAX_VOICES) {
        const oldest = liveNative[0];
        releaseNative(oldest);
        try { oldest.player.pause(); } catch (_) {}
      }
      try { player.pause(); player.currentTime = 0; } catch (_) {}
      const item = { player, kind, onEnded: null, requestId: 0,
        retry: null, failed: false, ended: false };
      const done = () => releaseNative(item);
      item.onEnded = () => { item.ended = true; done(); };
      // The first play() call is made immediately on pointerdown. On iPad,
      // a second request on the SAME element at pointerup is an activation
      // fallback, not a new sound or a seek to the beginning.
      item.retry = () => {
        const requestId = ++item.requestId;
        try {
          const attempt = player.play();
          if (attempt && typeof attempt.catch === 'function') {
            attempt.catch(() => {
              if (item.requestId === requestId) {
                item.failed = true;
                done();
              }
            });
          }
        } catch (_) {
          if (item.requestId === requestId) {
            item.failed = true;
            done();
          }
        }
      };
      liveNative.push(item);
      player.addEventListener('ended', item.onEnded, { once: true });
      item.retry();
      return item;
    } catch (_) { /* Sound must never interrupt gameplay. */ }
    return null;
  }

  function play(kind) {
    if (!Object.prototype.hasOwnProperty.call(GROUPS, kind)) return;
    try {
      if (!preparing) prepare();
      if (kind === 'death') stopKind('poison'); // Avoid overlap at lethal capture.
      const number = variantIndex(GROUPS[kind]) + 1;
      if (iosDevice && !lowLatencyIOS) {
        if (instantNativeIOS) {
          // The game's successful hit callback already runs on pointerdown.
          // Make the first audio request *now*, instead of waiting for release.
          const voice = playNative(kind, number);
          if (touchDevice) pendingTouchSound = {
            kind, number, voice, pointerId: lastPointer?.id ?? null,
            createdAt: Date.now()
          };
        } else {
          // Explicit compatibility route: original pointerup-only AAC.
          nativeOnNextGesture(kind, number);
        }
        return;
      }
      if (lowLatencyIOS && !fastUnlocked) {
        // First tap of a freshly navigated generation: do not start a buffer
        // into a context that Safari has not unlocked. Resume on pointerup,
        // then play THIS SAME tap once the graph reports running.
        queueFastSound(kind, number);
        return;
      }
      activate();
      if (!playBuffer(kind, decoded.get(key(kind, number)))) {
        if (lowLatencyIOS) {
          fastUnlocked = false;
          queueFastSound(kind, number);
        } else {
          nativeOnNextGesture(kind, number);
        }
      }
    } catch (_) { /* Keep predation and progression independent of audio. */ }
  }

  document.addEventListener('pointerdown', event => {
    gestureSerial += 1;
    // New gesture supersedes any delayed resume from the prior tap.
    for (const ticket of pendingResumes) ticket.cancelled = true;
    pendingResumes.clear();
    lastPointer = event?.isTrusted === false ? null : {
      id: event?.pointerId ?? null, createdAt: Date.now()
    };
    activate();
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', event => {
    if (pendingTouchSound && (pendingTouchSound.pointerId == null
        || pendingTouchSound.pointerId === event.pointerId)) pendingTouchSound = null;
    if (pendingFastSound && (pendingFastSound.pointerId == null
        || pendingFastSound.pointerId === event.pointerId)) pendingFastSound = null;
    for (const ticket of pendingResumes) {
      if (ticket.pointerId == null || ticket.pointerId === event.pointerId) {
        ticket.cancelled = true;
        pendingResumes.delete(ticket);
      }
    }
  }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      audioVisibilityEpoch += 1;
      pendingTouchSound = null;
      pendingFastSound = null;
      fastUnlocked = false;
      for (const ticket of pendingResumes) ticket.cancelled = true;
      pendingResumes.clear();
    }
  });
  document.addEventListener('pointerup', flushTouchSound, { capture: true, passive: true });
  document.addEventListener('touchend', flushTouchSound, { capture: true, passive: true });
  document.addEventListener('click', flushTouchSound, { capture: true });
  w.GitaiGameSfx = Object.freeze({ prepare, activate, play, volumes: VOLUME });
  // Start decoding before game-start and cache the files for future taps.
  prepare();
})();