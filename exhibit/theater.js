/* Exhibition landing: read-only access to its two isolated evolution Runs.
   Never open a database writing transaction, never initialize a
   missing Run, and never start the simulator just to display theater frames. */
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
  const image = document.getElementById('exhibitTheaterImage');
  const imageBuffer = document.getElementById('exhibitTheaterImageBuffer');
  const stage = dialog.querySelector('.exhibit-theater-stage');
  const playedLabel = document.getElementById('exhibitTheaterPlayed');
  const markers = document.getElementById('exhibitTheaterMarkers');
  const handoverFinished = document.getElementById('exhibitHandoverFinished');
  const handoverFinishNext = document.getElementById('exhibitHandoverFinishNext');
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
  let currentUrl = null;
  let pendingUrl = null;
  let activeImage = null;
  let frameLoadId = 0;
  let handoverData = null;
  let finalTimer = null;
  let playback = null;
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
    if (!db) return { generation: null, frames: [] };
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
        const get = tx.objectStore('meta').get('current_generation_id');
        get.onsuccess = () => { generation = get.result; };
        if (hasTheater) {
          const request = tx.objectStore('theater_frames').openCursor();
          request.onsuccess = () => {
            const c = request.result;
            if (!c) return;
            const entry = c.value;
            if (entry && /^gen\d{5}$/.test(String(entry.generation_id || ''))
              && entry.image_blob instanceof Blob) {
              savedFrames.push(entry);
            }
            c.continue();
          };
        }
        tx.oncomplete = () => {
          savedFrames.sort((a, b) =>
            Number(a.generation_id.slice(3)) - Number(b.generation_id.slice(3)));
          resolve({
            generation: /^gen\d{5}$/.test(String(generation)) ? generation : null,
            frames: savedFrames
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
    // Dispose only when leaving the theater or switching modes.
    // NEVER clear the visible layer before the next image is decoded.
    frameLoadId++;
    for (const layer of [image, imageBuffer]) {
      layer.onload = null;
      layer.onerror = null;
      layer.hidden = true;
      layer.removeAttribute('src');
    }
    for (const url of [pendingUrl, currentUrl]) {
      if (url) URL.revokeObjectURL(url);
    }
    pendingUrl = null;
    currentUrl = null;
    activeImage = null;
  }
  function stopPlayback() {
    if (playback !== null) {
      clearInterval(playback);
      playback = null;
    }
    play.textContent = '再生';
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
  function showFrame(index) {
    if (index < 0 || index >= frames.length) return;
    cursor = index;
    const record = frames[cursor];
    const generation = numberOf(record.generation_id);
    const marked = !!handoverData
      && generation >= handoverData.start && generation <= handoverData.end;
    playedLabel.hidden = !marked;
    stage.classList.toggle('is-played', marked);
    for (let i = 0; i < markers.children.length; i++) {
      markers.children[i].classList.toggle('is-current', i === cursor);
    }
    meta.textContent = '第' + generation + '世代 · ' +
      (cursor + 1) + ' / ' + frames.length + '枚';
    counter.textContent = (cursor + 1) + ' / ' + frames.length;
    slider.max = String(frames.length - 1);
    slider.value = String(cursor);
    previous.disabled = cursor === 0;
    next.disabled = cursor === frames.length - 1;

    // Double buffering: keep the previously visible frame in place until
    // the following frame is fully loaded/decoded. This avoids the black
    // flash produced by removing src and hiding the old <img> first.
    ++frameLoadId;
    const requestId = frameLoadId;
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    const target = activeImage === image ? imageBuffer : image;
    target.onload = null;
    target.onerror = null;
    target.hidden = true;
    pendingUrl = URL.createObjectURL(record.image_blob);
    const candidateUrl = pendingUrl;
    const reveal = () => {
      if (frameLoadId !== requestId || dialog.hidden) return;
      target.hidden = false;
      if (activeImage && activeImage !== target) activeImage.hidden = true;
      activeImage = target;
      const previousUrl = currentUrl;
      currentUrl = candidateUrl;
      pendingUrl = null;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      empty.hidden = true;
    };
    target.onload = () => {
      const decoded = typeof target.decode === 'function'
        ? target.decode().catch(() => {}) : Promise.resolve();
      Promise.resolve(decoded).then(reveal);
    };
    target.onerror = () => {
      if (frameLoadId !== requestId) return;
      empty.textContent = '画像を読み込めませんでした。';
      empty.hidden = !activeImage;
      URL.revokeObjectURL(candidateUrl);
      pendingUrl = null;
    };
    target.src = candidateUrl;
  }
  function finishHandover() {
    if (!handoverData || dialog.hidden) return;
    stopPlayback();
    handoverFinished.hidden = false;
    handoverFinishNext.focus({ preventScroll: true });
  }
  function scheduleHandoverPlayback() {
    if (!handoverData || dialog.hidden) return;
    if (frames.length < 2) {
      finalTimer = setTimeout(finishHandover, frames.length ? 1300 : 400);
      return;
    }
    let steps = 0;
    playback = setInterval(() => {
      if (dialog.hidden) { stopPlayback(); return; }
      if (cursor >= frames.length - 1) {
        stopPlayback();
        finalTimer = setTimeout(finishHandover, 1100);
      } else {
        showFrame(cursor + 1);
      }
      if (++steps > 50) finishHandover();
    }, 950);
  }
  function closeTheater() {
    if (dialog.hidden || handoverData) return;
    token += 1;
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    releaseImage();
    frames = [];
    dialog.hidden = true;
    document.body.style.overflow = originalOverflow;
    focusReturn?.focus?.({ preventScroll: true });
    focusReturn = null;
    void refreshGenerations();
  }
  async function openTheater(modeId, handover = null) {
    const mode = MODES[modeId];
    if (!mode) return;
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    frames = [];
    releaseImage();
    handoverData = handover;
    dialog.classList.toggle('is-handover', !!handover);
    handoverFinished.hidden = true;
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
      frames = result.frames;
      if (handover) {
        // A compact closing recap: 4 earlier frames for context, plus all
        // available frames of the visitor's up to five completed generations.
        const from = Math.max(1, handover.start - 4);
        frames = frames.filter(frame => {
          const n = numberOf(frame.generation_id);
          return n >= from && n <= handover.end;
        });
      }
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
  handoverFinishNext.addEventListener('click', () => {
    stopPlayback();
    if (finalTimer !== null) { clearTimeout(finalTimer); finalTimer = null; }
    try {
      sessionStorage.removeItem(VISIT_KEY);
      sessionStorage.removeItem(HANDOVER_KEY);
    } catch (_) {}
    location.assign(new URL('./', location.href).href);
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
    play.textContent = '停止';
    playback = setInterval(() => {
      if (cursor >= frames.length - 1) {
        stopPlayback();
        return;
      }
      showFrame(cursor + 1);
    }, 800);
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTheater();
    }
    // Keep keyboard focus inside the simple viewing dialog.
    if (e.key === 'Tab') {
      const controls = [closeButton, slider, previous, play, next]
        .filter(element => !element.disabled);
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
    stopPlayback();
    releaseImage();
  });
  window.addEventListener('pageshow', () => { void refreshGenerations(); });
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
      window.GitaiExhibitLanding?.showMenu?.();
      void openTheater(handover.mode, handover);
    } else {
      window.GitaiExhibitLanding?.showSplash?.();
    }
  }
  void refreshGenerations();
})();
