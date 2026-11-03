/* Exhibition landing: read-only evolution theater for the two isolated Runs.
   Only an explicit visitor nickname submission may write one namespaced
   metadata record. Never alter generations, genomes, frames or images. */
(() => {
  'use strict';
  const MODES = Object.freeze({
    cryptic: {
      name: '隠れるギタイ',
      db: 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic',
      generationElement: 'exhibitGenerationCryptic'
    },
    warning: {
      name: '目立つギタイ',
      db: 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2',
      generationElement: 'exhibitGenerationWarning'
    }
  });
  const dialog = document.getElementById('exhibitTheaterDialog');
  if (!dialog) return;
  const title = document.getElementById('exhibitTheaterTitle');
  const meta = document.getElementById('exhibitTheaterMeta');
  // A single persistent canvas is painted atomically only after the new
  // snapshot has finished decoding. Never remove the visible old frame.
  const canvas = document.getElementById('exhibitTheaterCanvas');
  const picture = canvas.getContext('2d', { alpha: false });
  picture.imageSmoothingEnabled = false;
  const stage = dialog.querySelector('.exhibit-theater-stage');
  const playedLabel = document.getElementById('exhibitTheaterPlayed');
  const markers = document.getElementById('exhibitTheaterMarkers');
  const handoverFinished = document.getElementById('exhibitHandoverFinished');
  const handoverFinishNext = document.getElementById('exhibitHandoverFinishNext');
  const nicknameInput = document.getElementById('exhibitVisitorNickname');
  const nicknameStatus = document.getElementById('exhibitVisitorNicknameStatus');
  const NAME_PREFIX = 'exhibit_visitor_nickname_v1:';
  const HANDOVER_KEY = 'gitai-exhibit-handover-v1';
  const VISIT_KEY = 'gitai-exhibit-visit-start-v1';
  const empty = document.getElementById('exhibitTheaterEmpty');
  const slider = document.getElementById('exhibitTheaterSlider');
  const counter = document.getElementById('exhibitTheaterProgress');
  const closeButton = document.getElementById('exhibitTheaterClose');
  const previous = document.getElementById('exhibitTheaterPrev');
  const next = document.getElementById('exhibitTheaterNext');
  const play = document.getElementById('exhibitTheaterPlay');
  let frames = [];
  let cursor = 0;
  let activeMode = null;
  let frameLoadId = 0;
  let pendingFrameIndex = null;
  let loadedImages = new Map();
  let frameUrls = [];
  let handoverData = null;
  let visitorRecords = [];
  let leavingForNextVisitor = false;
  let finalTimer = null;
  let playback = null;
  let resumeHandoverOnPageshow = false;
  let token = 0;
  let focusReturn = null;
  let originalOverflow = '';

  // indexedDB.open() normally creates an empty database when one does not
  // exist. ABORT that versionchange transaction; a visitor must not produce
  // even an empty database simply by looking at the exhibition landing.
  function openExisting(name) {
    return new Promise((resolve, reject) => {
      let absent = false;
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        absent = true;
        request.transaction.abort();
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        if (absent) resolve(null);
        else reject(request.error || Error('進化データの読み込みに失敗しました'));
      };
      request.onblocked = () => reject(Error('進化データを別のタブで使用中です'));
    });
  }

  async function readMode(mode) {
    const db = await openExisting(mode.db);
    if (!db) return { generation: null, frames: [], nicknames: [] };
    try {
      if (!db.objectStoreNames.contains('meta')) {
        throw Error('進化データの保存形式を確認できません');
      }
      const hasTheater = db.objectStoreNames.contains('theater_frames');
      const stores = hasTheater ? ['meta', 'theater_frames'] : ['meta'];
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readonly');
        let generation = null;
        const savedFrames = [];
        const nicknames = [];
        const metaStore = tx.objectStore('meta');
        const get = metaStore.get('current_generation_id');
        get.onsuccess = () => { generation = get.result; };
        // Prefix cursor: do not scan 60 genomes per historical generation.
        // This is a READONLY view. Saved names are optional and validated.
        const named = metaStore.openCursor(IDBKeyRange.bound(NAME_PREFIX, NAME_PREFIX + '\uffff'));
        named.onsuccess = () => {
          const entry = named.result;
          if (!entry) return;
          const value = entry.value;
          if (value && value.schema === 1
              && Number.isSafeInteger(value.start) && value.start >= 1
              && Number.isSafeInteger(value.end) && value.end >= value.start
              && value.end - value.start <= 4
              && typeof value.name === 'string' && value.name.length <= 24
              && value.name.trim() && !/[<>\u0000-\u001f\u007f]/u.test(value.name)) {
            nicknames.push({ start: value.start, end: value.end, name: value.name });
          }
          entry.continue();
        };
        if (hasTheater) {
          // Read keys ONLY: hundreds of full images must not be loaded
          // into iPad RAM just to list all historical generations.
          const request = tx.objectStore('theater_frames').openKeyCursor();
          request.onsuccess = () => {
            const c = request.result;
            if (!c) return;
            const generationId = String(c.key || '');
            if (/^gen(?:\d{5}|[1-9]\d{5,})$/.test(generationId)) {
              savedFrames.push({ generation_id: generationId });
            }
            c.continue();
          };
        }
        tx.oncomplete = () => {
          savedFrames.sort((a, b) =>
            Number(a.generation_id.slice(3)) - Number(b.generation_id.slice(3)));
          resolve({
            generation: /^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(generation)) ? generation : null,
            frames: savedFrames, nicknames
          });
        };
        tx.onerror = () => reject(tx.error || Error('保存データを読み込めません'));
        tx.onabort = () => reject(tx.error || Error('読み込みを中断しました'));
      });
    } finally {
      db.close();
    }
  }

  function numberOf(generation) {
    return Number(String(generation).slice(3));
  }

  function normalizeVisitorName(raw) {
    const value = String(raw || '').normalize('NFC').trim();
    if (!value) return '';
    if (Array.from(value).length > 12 || /[<>\u0000-\u001f\u007f]/u.test(value)) {
      throw Error('ニックネームは12文字以内で、記号 < > や改行を使わずに入力してください。');
    }
    return value;
  }

  function badgeForGeneration(generation) {
    if (handoverData && generation >= handoverData.start && generation <= handoverData.end) {
      const typed = nicknameInput.value.trim();
      return typed ? '参加：' + typed : 'あなたのプレイ';
    }
    const stored = visitorRecords.find(item => generation >= item.start && generation <= item.end);
    return stored ? '参加：' + stored.name : '';
  }

  function renderBadge(generation) {
    const label = badgeForGeneration(generation);
    playedLabel.textContent = label;
    playedLabel.hidden = !label;
  }

  async function saveVisitorName(modeId, handover, name) {
    if (!name) return; // Empty is an intentional anonymous handover: no DB writes.
    const mode = MODES[modeId];
    if (!mode || !handover || !Number.isSafeInteger(handover.start)
        || !Number.isSafeInteger(handover.end) || handover.start < 1
        || handover.end < handover.start || handover.end - handover.start > 4) {
      throw Error('記録するプレイ世代を確認できません。');
    }
    const db = await openExisting(mode.db);
    if (!db) throw Error('進化データが見つかりません。');
    try {
      // Only use the EXISTING DB v2 meta store. No migration or new object store.
      if (db.version !== 2 || !db.objectStoreNames.contains('meta')) {
        throw Error('進化データの保存形式が想定と異なります。');
      }
      const nextId = 'gen' + String(handover.end + 1).padStart(5, '0');
      const recordKey = NAME_PREFIX + 'gen' + String(handover.end).padStart(5, '0');
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        let failure = null;
        const current = store.get('current_generation_id');
        current.onsuccess = () => {
          // Refuse a stale handover (e.g. another tab has already evolved).
          if (current.result !== nextId) {
            failure = Error('別の画面で世代が変更されました。名前は記録していません。');
            try { tx.abort(); } catch (_) {}
            return;
          }
          // A completed visitor name is write-once. In particular, Safari
          // BFCache/back navigation must never overwrite an earlier attendee.
          // IDB add() rejects an existing key atomically (unlike put()).
          const add = store.add({ schema: 1, start: handover.start, end: handover.end, name }, recordKey);
          add.onerror = () => {
            failure = Error('この世代の参加者名は登録済みです。既存の名前を上書きしません。'
              + '匿名で次の人へ進む場合は入力欄を空欄にしてください。');
          };
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(failure || tx.error || Error('名前の記録を中断しました。'));
        tx.onerror = () => {};
      });
    } finally {
      db.close();
    }
  }
  async function refreshGenerations() {
    await Promise.all(Object.values(MODES).map(async mode => {
      const element = document.getElementById(mode.generationElement);
      if (!element) return;
      try {
        const result = await readMode(mode);
        element.textContent = result.generation
          ? '現在 第' + numberOf(result.generation) + '世代'
          : '現在 未開始';
      } catch (error) {
        console.warn('展示版の世代読み込みに失敗しました', error);
        element.textContent = '現在世代を読み込めません';
      }
    }));
  }

  function releaseImage() {
    ++frameLoadId;
    pendingFrameIndex = null;
    canvas.hidden = true;
    // The gallery's object URLs follow the regular entertainment theater:
    // create once per saved frame, revoke ONLY on dialog teardown.
    for (const uri of frameUrls) URL.revokeObjectURL(uri);
    frameUrls = [];
    loadedImages.clear();
  }
  function assignFrameUrls() {
    // Historical IDs are cheap; only the requested snapshot obtains a
    // temporary Blob URL. Do not allocate a URL for every past generation.
    frameUrls = [];
  }
  async function loadFrameBlob(index) {
    const generationId = frames[index]?.generation_id;
    const mode = MODES[activeMode];
    if (!generationId || !mode) throw Error('Frame unavailable');
    const db = await openExisting(mode.db);
    if (!db) throw Error('Saved history unavailable');
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('theater_frames', 'readonly');
        const request = tx.objectStore('theater_frames').get(generationId);
        request.onsuccess = () => {
          const entry = request.result;
          if (entry?.generation_id !== generationId || !(entry.image_blob instanceof Blob)) {
            reject(Error('Saved generation image missing: ' + generationId));
          } else resolve(entry.image_blob);
        };
        request.onerror = () => reject(request.error || Error('Frame read failed'));
        tx.onabort = () => reject(tx.error || Error('Frame transaction aborted'));
      });
    } finally {
      db.close();
    }
  }
  function decodeFrame(index) {
    if (!frames[index]) return Promise.reject(Error('Frame unavailable'));
    if (loadedImages.has(index)) return loadedImages.get(index);
    const ready = loadFrameBlob(index).then(blob => new Promise((resolve, reject) => {
      const preview = new Image();
      preview.decoding = 'async';
      const url = URL.createObjectURL(blob);
      const release = () => URL.revokeObjectURL(url);
      preview.onload = () => {
        const decoded = typeof preview.decode === 'function'
          ? preview.decode().catch(() => {}) : Promise.resolve();
        Promise.resolve(decoded).then(() => { release(); resolve(preview); }, error => { release(); reject(error); });
      };
      preview.onerror = () => { release(); reject(Error('Frame image could not be read')); };
      preview.src = url;
    }));
    loadedImages.set(index, ready);
    ready.catch(() => {
      // An old session's failure must not delete a newer session's
      // same-index cached decode after close/reopen or mode switch.
      if (loadedImages.get(index) === ready) loadedImages.delete(index);
    });
    // Keep a small decoded window around the current slide. Blob URLs stay
    // valid for the whole viewer, so old generations can be revisited.
    if (loadedImages.size > 7) {
      for (const key of loadedImages.keys()) {
        if (Math.abs(key - cursor) > 3) loadedImages.delete(key);
        if (loadedImages.size <= 6) break;
      }
    }
    return ready;
  }
  function stopPlayback() {
    if (playback !== null) {
      clearInterval(playback);
      playback = null;
    }
    play.textContent = handoverData && frames.length > 1
      && cursor === frames.length - 1 ? 'もう一度再生' : '再生';
  }
  function enableControls(enabled) {
    slider.disabled = !enabled;
    previous.disabled = !enabled;
    next.disabled = !enabled;
    play.disabled = !enabled;
  }
  function renderMarkers() {
    markers.replaceChildren();
    if (!handoverData || frames.length === 0) {
      markers.hidden = true;
      return;
    }
    markers.hidden = false;
    for (let i = 0; i < frames.length; i++) {
      const generation = numberOf(frames[i].generation_id);
      const marker = document.createElement('span');
      marker.className = 'exhibit-theater-marker';
      marker.textContent = String(generation);
      if (generation >= handoverData.start && generation <= handoverData.end) {
        marker.classList.add('is-played');
        marker.setAttribute('title', 'あなたのプレイ 第' + generation + '世代');
      }
      markers.appendChild(marker);
    }
  }
  function followCurrentMarker() {
    // The timeline contains every saved generation. On narrow iPad screens
    // its scrollable row can hide later numbers (e.g. 34+) unless it follows
    // the frame that was ACTUALLY drawn, rather than the requested frame.
    if (markers.hidden || !markers.clientWidth
        || markers.scrollWidth <= markers.clientWidth) return;
    const marker = markers.children[cursor];
    if (!marker || typeof marker.getBoundingClientRect !== 'function'
        || typeof markers.getBoundingClientRect !== 'function') return;
    const viewport = markers.getBoundingClientRect();
    const selected = marker.getBoundingClientRect();
    const margin = Math.min(12, viewport.width / 8);
    let delta = 0;
    if (selected.right > viewport.right - margin) {
      delta = selected.right - viewport.right + margin;
    } else if (selected.left < viewport.left + margin) {
      delta = selected.left - viewport.left - margin;
    }
    if (delta) {
      const max = markers.scrollWidth - markers.clientWidth;
      markers.scrollLeft = Math.max(0, Math.min(max, markers.scrollLeft + delta));
    }
  }
  function showFrame(index) {
    if (index < 0 || index >= frames.length) return;
    if (pendingFrameIndex === index) return;
    // The cursor, labels and highlighted generation describe the image that
    // has actually been decoded and drawn, NOT the requested image.
    // Keep the old image and all its labels while the next image is pending.
    pendingFrameIndex = index;
    const ticket = ++frameLoadId;
    void decodeFrame(index).then(bitmap => {
      if (ticket !== frameLoadId || dialog.hidden) return;
      const record = frames[index];
      if (!record) return;
      picture.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // Legacy saved screenshots have an obsolete "エンタメ型" label baked
      // into y=50..90. Cover it by copying an empty area of the SAME header.
      // Do not rewrite/delete any historical frame in IndexedDB.
      picture.drawImage(bitmap, 310, 50, 230, 40, 0, 50, 230, 40);
      cursor = index;
      pendingFrameIndex = null;
      const generation = numberOf(record.generation_id);
      const marked = !!handoverData
        && generation >= handoverData.start && generation <= handoverData.end;
      renderBadge(generation);
      stage.classList.toggle('is-played', marked);
      for (let i = 0; i < markers.children.length; i++) {
        markers.children[i].classList.toggle('is-current', i === cursor);
      }
      followCurrentMarker();
      meta.textContent = '第' + generation + '世代 · ' +
        (cursor + 1) + ' / ' + frames.length + '枚';
      counter.textContent = (cursor + 1) + ' / ' + frames.length;
      slider.max = String(frames.length - 1);
      slider.value = String(cursor);
      previous.disabled = cursor === 0;
      next.disabled = cursor === frames.length - 1;
      canvas.hidden = false;
      empty.hidden = true;
      // Warm up the next slide while preserving a bounded decoded cache.
      if (index + 1 < frames.length) void decodeFrame(index + 1).catch(() => {});
    }).catch(error => {
      if (ticket !== frameLoadId || dialog.hidden) return;
      pendingFrameIndex = null;
      // A failed image must NEVER inherit the previous image's canvas while
      // displaying the failed generation's label. The old frame stays intact.
      slider.value = String(cursor);
      empty.textContent = canvas.hidden
        ? '画像を読み込めませんでした。'
        : '画像を読み込めませんでした。前の世代の画像を表示しています。';
      empty.hidden = false;
      console.warn('進化シアター画像', error);
    });
  }
  function finishHandover() {
    if (!handoverData || dialog.hidden) return;
    // Retain the last moth snapshot, playback controls and focus.
    // No completion overlay or navigation: visitor explicitly exits below.
    stopPlayback();
    if (frames.length > 1) play.textContent = 'もう一度再生';
  }
  function beginPlayback(intervalMs) {
    if (playback !== null || frames.length < 2) return;
    play.textContent = '停止';
    let stalledTicks = 0;
    playback = setInterval(() => {
      if (dialog.hidden) { stopPlayback(); return; }
      // Wait for the previous PNG decode before advancing on a slow iPad.
      if (pendingFrameIndex !== null) {
        if (++stalledTicks > 50) {
          if (handoverData) finishHandover();
          else stopPlayback();
        }
        return;
      }
      stalledTicks = 0;
      if (cursor >= frames.length - 1) {
        if (handoverData) finishHandover();
        else stopPlayback();
      } else {
        showFrame(cursor + 1);
      }
    }, intervalMs);
  }
  function scheduleHandoverPlayback() {
    if (!handoverData || dialog.hidden) return;
    if (frames.length < 2) {
      finalTimer = setTimeout(finishHandover, frames.length ? 1300 : 400);
      return;
    }
    beginPlayback(950);
  }
  function closeTheater() {
    if (dialog.hidden || handoverData) return;
    token += 1;
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    releaseImage();
    frames = [];
    activeMode = null;
    dialog.hidden = true;
    document.body.style.overflow = originalOverflow;
    focusReturn?.focus?.({ preventScroll: true });
    focusReturn = null;
    void refreshGenerations();
  }
  async function openTheater(modeId, handover = null) {
    const mode = MODES[modeId];
    if (!mode) return;
    activeMode = modeId;
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    frames = [];
    releaseImage();
    cursor = 0;
    handoverData = handover;
    visitorRecords = [];
    leavingForNextVisitor = false;
    handoverFinishNext.disabled = false;
    nicknameInput.disabled = false;
    nicknameInput.value = '';
    nicknameStatus.textContent = '「次の人へ」で記録します。空欄でもOK。';
    dialog.classList.toggle('is-handover', !!handover);
    // Small footer stays visible, but never obscures the moth canvas.
    handoverFinished.hidden = !handover;
    markers.hidden = true;
    playedLabel.hidden = true;
    stage.classList.remove('is-played');
    focusReturn = document.activeElement;
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.hidden = false;
    title.textContent = mode.name + ' · 進化シアター';
    meta.textContent = '保存された世代を読み込み中…';
    empty.textContent = '保存された進化シアターを読み込んでいます…';
    empty.hidden = false;
    counter.textContent = '-- / --';
    enableControls(false);
    if (!handover) closeButton.focus({ preventScroll: true });
    const requestToken = ++token;
    try {
      const result = await readMode(mode);
      if (requestToken !== token || dialog.hidden) return;
      // All saved generations stay available across visitor handovers.
      // The visit range only highlights the current visitor's contribution.
      frames = result.frames;
      visitorRecords = result.nicknames;
      assignFrameUrls();
      renderMarkers();
      if (!frames.length) {
        meta.textContent = result.generation
          ? '現在 第' + numberOf(result.generation) + '世代'
          : '現在 未開始';
        empty.textContent = result.generation
          ? '閲覧できる進化シアター画像はまだありません。'
          : '実験開始後、進化した蛾の履歴がここに表示されます。';
        if (handover) scheduleHandoverPlayback();
        return;
      }
      enableControls(true);
      showFrame(handover ? 0 : frames.length - 1);
      if (handover) scheduleHandoverPlayback();
    } catch (error) {
      if (requestToken !== token || dialog.hidden) return;
      meta.textContent = '読み込みに失敗しました';
      empty.textContent = '保存された画像を確認できません。データは変更していません。';
      console.error('閲覧専用進化シアター', error);
      if (handover) scheduleHandoverPlayback();
    }
  }
  for (const button of document.querySelectorAll('[data-view-theater]')) {
    button.addEventListener('click', () => openTheater(button.dataset.viewTheater));
  }
  nicknameInput.addEventListener('input', () => {
    nicknameStatus.textContent = '「次の人へ」で記録します。空欄でもOK。';
    if (handoverData && !dialog.hidden && frames[cursor]) {
      renderBadge(numberOf(frames[cursor].generation_id));
    }
  });
  handoverFinishNext.addEventListener('click', async () => {
    if (leavingForNextVisitor || !handoverData || !activeMode) return;
    let name;
    try { name = normalizeVisitorName(nicknameInput.value); }
    catch (error) { nicknameStatus.textContent = error.message; nicknameInput.focus(); return; }
    leavingForNextVisitor = true;
    handoverFinishNext.disabled = true;
    nicknameInput.disabled = true;
    nicknameStatus.textContent = name ? 'ニックネームを記録中…' : '匿名で交代します…';
    try {
      // The caller has finished evolving BEFORE this theater opens.
      // A single isolated meta entry is included in existing v1 JSON backups.
      if (name) await saveVisitorName(activeMode, handoverData, name);
      stopPlayback();
      if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
      try {
        sessionStorage.removeItem(VISIT_KEY);
        sessionStorage.removeItem(HANDOVER_KEY);
      } catch (_) {}
      location.assign(new URL('./', location.href).href);
    } catch (error) {
      leavingForNextVisitor = false;
      handoverFinishNext.disabled = false;
      nicknameInput.disabled = false;
      nicknameStatus.textContent = '記録失敗：' + (error?.message || String(error))
        + '。再試行するか名前を空欄にしてください。';
    }
  });
  closeButton.addEventListener('click', closeTheater);
  previous.addEventListener('click', () => {
    stopPlayback();
    showFrame(cursor - 1);
  });
  next.addEventListener('click', () => {
    stopPlayback();
    showFrame(cursor + 1);
  });
  slider.addEventListener('input', () => {
    stopPlayback();
    showFrame(Number(slider.value));
  });
  play.addEventListener('click', () => {
    if (playback !== null) { stopPlayback(); return; }
    if (frames.length < 2) return;
    if (cursor === frames.length - 1) showFrame(0);
    // The interval will wait for frame 1 to finish decoding.
    beginPlayback(800);
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTheater();
    }
    // Keep keyboard focus inside the simple viewing dialog.
    if (e.key === 'Tab') {
      const controls = (handoverData
        ? [slider, previous, play, next, nicknameInput, handoverFinishNext]
        : [closeButton, slider, previous, play, next])
        .filter(element => !element.disabled && !element.hidden);
      if (!controls.length) return;
      const ix = controls.indexOf(document.activeElement);
      if (e.shiftKey && (ix <= 0)) {
        e.preventDefault(); controls[controls.length - 1].focus();
      } else if (!e.shiftKey && ix === controls.length - 1) {
        e.preventDefault(); controls[0].focus();
      }
    }
  });
  window.addEventListener('pagehide', () => {
    // Invalidate a pending IDB read as well as pending image decoding.
    // BFCache retains JavaScript state but our object URLs are revoked.
    token += 1;
    resumeHandoverOnPageshow = !!handoverData && playback !== null;
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    releaseImage();
  });
  window.addEventListener('pageshow', event => {
    void refreshGenerations();
    if (!event.persisted || dialog.hidden || !activeMode) return;
    if (frames.length) {
      // BFCache resumed the same document, not a new page. Reuse the
      // already-read Blob records, not a new experiment or DB write.
      if (!frameUrls.length) assignFrameUrls();
      showFrame(cursor);
      if (handoverData && resumeHandoverOnPageshow) {
        resumeHandoverOnPageshow = false;
        scheduleHandoverPlayback();
      }
    } else {
      // The page was suspended before the readonly theater query finished.
      // It was invalidated on pagehide, so restart that read deliberately.
      void openTheater(activeMode, handoverData);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshGenerations();
  });
  // A completed visitor's handover is authorized only by a one-use local
  // session marker written AFTER the offspring were safely committed.
  if (new URL(location.href).searchParams.get('handover') === '1') {
    let handover = null;
    try {
      handover = JSON.parse(sessionStorage.getItem(HANDOVER_KEY) || 'null');
      sessionStorage.removeItem(HANDOVER_KEY);
    } catch (_) {}
    if (handover && MODES[handover.mode]
      && Number.isInteger(handover.start) && Number.isInteger(handover.end)
      && handover.start > 0 && handover.end >= handover.start
      && handover.end - handover.start <= 4) {
      void openTheater(handover.mode, handover);
    } else {
      location.replace(new URL('./', location.href).href);
    }
  }
  void refreshGenerations();
})();
