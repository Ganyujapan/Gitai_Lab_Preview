(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const DB_NAME = 'gitai-pages-preview-v1';
  const DB_VERSION = 1;
  const IMAGE_STORE = 'images';
  const META_STORE = 'meta';
  const TOTAL = 60;
  const SIZE = 128;
  const HALF = SIZE / 2;

  let dbPromise = null;
  let appConfig = null;
  let speciesConfig = null;
  let environmentConfig = null;
  let evolutionConfig = null;
  let currentGenerationId = 'gen00001';
  let currentObjectUrls = new Map();
  let mask = null;
  const completedRuns = new Map();

  function baseUrl(path) {
    return new URL(path, document.baseURI).toString();
  }

  function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(storeName, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearDb() {
    if (dbPromise) {
      const db = await dbPromise.catch(() => null);
      if (db) db.close();
      dbPromise = null;
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }

  function imageKey(generationId, index) {
    return `${generationId}:${String(index).padStart(2, '0')}`;
  }

  function releaseObjectUrls() {
    for (const url of currentObjectUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    currentObjectUrls.clear();
  }

  async function loadGeneratedGeneration(generationId) {
    releaseObjectUrls();
    if (generationId === 'gen00001') return true;

    const loaded = new Map();
    for (let i = 1; i <= TOTAL; i += 1) {
      const blob = await idbGet(IMAGE_STORE, imageKey(generationId, i));
      if (!(blob instanceof Blob)) {
        for (const url of loaded.values()) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
        return false;
      }
      loaded.set(imageKey(generationId, i), URL.createObjectURL(blob));
    }
    currentObjectUrls = loaded;
    return true;
  }

  async function loadJson(path) {
    const res = await nativeFetch(baseUrl(path), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`${path} を取得できません (HTTP ${res.status})`);
    }
    return res.json();
  }

  async function ensureConfig() {
    if (appConfig) return;
    appConfig = await loadJson('config/konchu_univ_alpha.json');
    speciesConfig = await loadJson(appConfig.species_config);
    environmentConfig = await loadJson(appConfig.environment_config);
    evolutionConfig = await loadJson(appConfig.evolution_config);

    appConfig = JSON.parse(JSON.stringify(appConfig));
    appConfig.mode = 'pages_preview';
    appConfig.title = `${appConfig.title} — Pages Preview`;
    appConfig.network = {
      ...(appConfig.network || {}),
      submit_timeout_ms: 120000,
    };

    const params = new URLSearchParams(location.search);
    if (params.get('fast') === '1') {
      appConfig.game.round_time_ms = 500;
    }
  }

  async function ensureCurrentGeneration() {
    await ensureConfig();
    const stored = await idbGet(META_STORE, 'current_generation_id');
    if (typeof stored === 'string' && /^gen\d{5}$/.test(stored)) {
      currentGenerationId = stored;
    }

    const loaded = await loadGeneratedGeneration(currentGenerationId);
    if (!loaded) {
      currentGenerationId = 'gen00001';
      await idbPut(META_STORE, 'current_generation_id', currentGenerationId);
      await loadGeneratedGeneration(currentGenerationId);
    }
  }

  function resolveAsset(generationId, index, fallbackPath) {
    if (generationId === 'gen00001') return fallbackPath;
    return currentObjectUrls.get(imageKey(generationId, index)) || fallbackPath;
  }

  function shuffle(values) {
    const a = [...values];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function nextGenerationId(generationId) {
    const n = Number(generationId.slice(3));
    return `gen${String(n + 1).padStart(5, '0')}`;
  }

  function rgbToHsv(r, g, b) {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const mx = Math.max(rf, gf, bf);
    const mn = Math.min(rf, gf, bf);
    const diff = mx - mn;
    let h = 0;
    if (diff !== 0) {
      if (mx === rf) h = (60 * ((gf - bf) / diff) + 360) % 360;
      else if (mx === gf) h = (60 * ((bf - rf) / diff) + 120) % 360;
      else h = (60 * ((rf - gf) / diff) + 240) % 360;
    }
    const s = mx === 0 ? 0 : diff / mx;
    return [h, s, mx];
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rf = 0;
    let gf = 0;
    let bf = 0;
    if (h < 60) [rf, gf, bf] = [c, x, 0];
    else if (h < 120) [rf, gf, bf] = [x, c, 0];
    else if (h < 180) [rf, gf, bf] = [0, c, x];
    else if (h < 240) [rf, gf, bf] = [0, x, c];
    else if (h < 300) [rf, gf, bf] = [x, 0, c];
    else [rf, gf, bf] = [c, 0, x];
    return [
      Math.round((rf + m) * 255),
      Math.round((gf + m) * 255),
      Math.round((bf + m) * 255),
    ];
  }

  async function loadImageDataFromUrl(url) {
    const img = new Image();
    img.decoding = 'async';
    const ready = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(`画像を読み込めません: ${url}`));
    });
    img.src = url;
    await ready;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    return ctx.getImageData(0, 0, SIZE, SIZE);
  }

  async function parentImageData(generationId, index) {
    const template = speciesConfig.image.asset_template;
    const fallback = template
      .replaceAll('{generation_id}', generationId)
      .replaceAll('{index_2d}', String(index).padStart(2, '0'))
      .replaceAll('{index}', String(index));
    const resolved = resolveAsset(generationId, index, fallback);
    const url = resolved.startsWith('blob:') || resolved.startsWith('data:')
      ? resolved
      : baseUrl(resolved);
    return loadImageDataFromUrl(url);
  }

  async function ensureMask() {
    if (mask) return mask;
    const maskData = await loadImageDataFromUrl(
      baseUrl(speciesConfig.genetics.mask_source),
    );
    mask = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      mask[i] = maskData.data[i * 4 + 3] > 0 ? 1 : 0;
    }
    return mask;
  }

  function selectParents(eatenIndices) {
    const eaten = new Set(eatenIndices);
    const survivors = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      if (!eaten.has(i)) survivors.push(i);
    }
    if (survivors.length < 2) return null;

    const poolSize = Number(evolutionConfig.parent_pool_size || 12);
    const shuffled = shuffle(survivors);
    let selected;
    if (shuffled.length >= poolSize) {
      selected = shuffled.slice(0, poolSize);
    } else {
      selected = [...shuffled];
      while (selected.length < poolSize) {
        selected.push(shuffled[Math.floor(Math.random() * shuffled.length)]);
      }
      selected = shuffle(selected);
    }
    return selected;
  }

  function buildPairingPlan(parentIndices) {
    const repeats = TOTAL / parentIndices.length;
    const parentA = [];
    for (const index of parentIndices) {
      for (let r = 0; r < repeats; r += 1) parentA.push(index);
    }
    const shuffledA = shuffle(parentA);
    return shuffledA.map((a, offset) => {
      const choices = parentIndices.filter((b) => b !== a);
      const b = choices[Math.floor(Math.random() * choices.length)];
      return { childIndex: offset + 1, parentA: a, parentB: b };
    });
  }

  function setPixelMirrored(data, x, y, rgba) {
    const leftOffset = (y * SIZE + x) * 4;
    const rightX = SIZE - 1 - x;
    const rightOffset = (y * SIZE + rightX) * 4;
    for (let c = 0; c < 4; c += 1) {
      data[leftOffset + c] = rgba[c];
      data[rightOffset + c] = rgba[c];
    }
  }

  function getPixel(data, x, y) {
    const offset = (y * SIZE + x) * 4;
    return [
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3],
    ];
  }

  function maskedLeftCoords(maskData) {
    const coords = [];
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < HALF; x += 1) {
        if (maskData[y * SIZE + x]) coords.push([x, y]);
      }
    }
    return coords;
  }

  function applyMicroMutation(data, maskData, coords) {
    const p = Number(evolutionConfig.p_mut_individual);
    if (Math.random() >= p) return false;

    const k = randomInt(
      Number(evolutionConfig.k_min),
      Number(evolutionConfig.k_max),
    );
    const dh = Number(evolutionConfig.delta_h_deg);
    const ds = Number(evolutionConfig.delta_s);
    const dv = Number(evolutionConfig.delta_v);

    for (let n = 0; n < k; n += 1) {
      const [x, y] = coords[Math.floor(Math.random() * coords.length)];
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;
      let [h, s, v] = rgbToHsv(r, g, b);
      h = (h + (Math.random() * 2 - 1) * dh + 360) % 360;
      s = Math.max(0, Math.min(1, s + (Math.random() * 2 - 1) * ds));
      v = Math.max(0, Math.min(1, v + (Math.random() * 2 - 1) * dv));
      const [nr, ng, nb] = hsvToRgb(h, s, v);
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }
    return true;
  }

  function chooseMacroMode() {
    let r = Math.random();
    for (const mode of evolutionConfig.macro_modes) {
      r -= Number(mode.p);
      if (r <= 0) return mode;
    }
    return evolutionConfig.macro_modes[evolutionConfig.macro_modes.length - 1];
  }

  function applyMacroMutation(data, maskData, coords, microMutated) {
    if (!microMutated) return;
    if (Math.random() >= Number(evolutionConfig.p_macro_given_mut)) return;

    const selected = chooseMacroMode();
    const mode = selected.mode;

    if (mode === 'contrast_boost') {
      const values = [];
      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        values.push(rgbToHsv(r, g, b)[2]);
      }
      const mean = values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0.5;
      const strength = Number(selected.strength || 1.25);
      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        let [h, s, v] = rgbToHsv(r, g, b);
        v = mean + (v - mean) * strength;
        const [nr, ng, nb] = hsvToRgb(h, s, v);
        setPixelMirrored(data, x, y, [nr, ng, nb, a]);
      }
      return;
    }

    for (const [x, y] of coords) {
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;
      let [h, s, v] = rgbToHsv(r, g, b);
      if (mode === 'melanism_darkening') {
        v *= Number(selected.strength || 0.65);
      } else if (mode === 'pallor_lightening') {
        v *= Number(selected.strength || 1.25);
      } else if (mode === 'hue_shift_small') {
        h += Number(selected.shift_deg || 15);
      }
      const [nr, ng, nb] = hsvToRgb(h, s, v);
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }
  }

  function imageDataToBlob(imageData) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG生成に失敗しました'));
      }, 'image/png');
    });
  }

  async function deleteGeneration(generationId) {
    if (!generationId || generationId === 'gen00001') return;
    for (let i = 1; i <= TOTAL; i += 1) {
      await idbDelete(IMAGE_STORE, imageKey(generationId, i));
    }
  }

  async function evolveGeneration(generationId, eatenIndices) {
    await ensureConfig();
    await ensureMask();

    const parentIndices = selectParents(eatenIndices);
    if (!parentIndices) return null;

    const uniqueParents = [...new Set(parentIndices)];
    const parentData = new Map();
    for (const index of uniqueParents) {
      parentData.set(index, await parentImageData(generationId, index));
    }

    const coords = maskedLeftCoords(mask);
    const plan = buildPairingPlan(parentIndices);
    const nextId = nextGenerationId(generationId);
    const blobs = new Map();

    for (const item of plan) {
      const a = parentData.get(item.parentA);
      const b = parentData.get(item.parentB);
      const child = new ImageData(SIZE, SIZE);

      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < HALF; x += 1) {
          if (!mask[y * SIZE + x]) continue;
          const source = Math.random() < 0.5 ? a.data : b.data;
          const offset = (y * SIZE + x) * 4;
          const rgba = [
            source[offset],
            source[offset + 1],
            source[offset + 2],
            source[offset + 3],
          ];
          setPixelMirrored(child.data, x, y, rgba);
        }
      }

      const micro = applyMicroMutation(child.data, mask, coords);
      applyMacroMutation(child.data, mask, coords, micro);
      blobs.set(item.childIndex, await imageDataToBlob(child));

      if (item.childIndex % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    for (const [index, blob] of blobs.entries()) {
      await idbPut(IMAGE_STORE, imageKey(nextId, index), blob);
    }

    await idbPut(META_STORE, 'current_generation_id', nextId);
    await deleteGeneration(generationId);

    currentGenerationId = nextId;
    await loadGeneratedGeneration(nextId);
    return nextId;
  }

  async function apiFetch(input, init = {}) {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    const path = url.pathname;

    if (!path.endsWith('/api/app_config') &&
        !path.endsWith('/api/current_generation') &&
        !path.endsWith('/api/submit_run')) {
      return nativeFetch(input, init);
    }

    await ensureConfig();

    if (path.endsWith('/api/app_config')) {
      const publicConfig = JSON.parse(JSON.stringify(appConfig));
      delete publicConfig.species_config;
      delete publicConfig.environment_config;
      delete publicConfig.evolution_config;
      publicConfig.species = speciesConfig;
      publicConfig.environment = environmentConfig;
      return jsonResponse(200, publicConfig);
    }

    if (path.endsWith('/api/current_generation')) {
      await ensureCurrentGeneration();
      return jsonResponse(200, {
        current_generation_id: currentGenerationId,
        preview: true,
      });
    }

    await ensureCurrentGeneration();
    let payload = {};
    try {
      payload = JSON.parse(init.body || '{}');
    } catch (_) {
      return jsonResponse(400, { error: 'invalid_json' });
    }

    const generationId = String(payload.generation_id || '');
    const runId = String(payload.run_id || '');
    const eaten = Array.isArray(payload.eaten_indices)
      ? [...payload.eaten_indices].sort((a, b) => a - b)
      : [];

    if (generationId !== currentGenerationId) {
      const previous = completedRuns.get(runId);
      if (previous && previous.generation_id === generationId) {
        return jsonResponse(200, {
          ok: true,
          next_generation_id: previous.next_generation_id,
          replayed: true,
          preview: true,
        });
      }
      return jsonResponse(409, {
        error: 'generation_mismatch',
        server_current_generation_id: currentGenerationId,
        client_generation_id: generationId,
      });
    }

    const survivorCount = TOTAL - eaten.length;
    if (survivorCount < 2) {
      return jsonResponse(422, {
        error: 'insufficient_survivors',
        generation_id: currentGenerationId,
        survivor_count: survivorCount,
        minimum_survivors: 2,
        retry_same_generation: true,
        preview: true,
      });
    }

    const nextId = await evolveGeneration(generationId, eaten);
    completedRuns.set(runId, {
      generation_id: generationId,
      next_generation_id: nextId,
    });

    return jsonResponse(200, {
      ok: true,
      next_generation_id: nextId,
      replayed: false,
      preview: true,
    });
  }

  function installPreviewBadge() {
    const badge = document.createElement('div');
    badge.id = 'pagesPreviewBadge';
    badge.innerHTML =
      '<span>PAGES PREVIEW</span>' +
      '<button type="button">Gen1へリセット</button>';
    Object.assign(badge.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 8px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,.72)',
      color: '#b7f2f4',
      fontFamily: 'monospace',
      fontSize: '10px',
      letterSpacing: '.04em',
      boxShadow: '0 1px 8px rgba(0,0,0,.3)',
    });
    const button = badge.querySelector('button');
    Object.assign(button.style, {
      border: '1px solid rgba(183,242,244,.55)',
      borderRadius: '6px',
      padding: '3px 6px',
      background: 'transparent',
      color: '#e7ffff',
      font: 'inherit',
    });
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      button.textContent = 'リセット中…';
      releaseObjectUrls();
      await clearDb();
      location.href = location.pathname + (location.search.includes('fast=1') ? '?fast=1' : '');
    });
    document.body.appendChild(badge);
  }

  window.GitaiPagesPreview = {
    fetch: apiFetch,
    resolveAsset,
    reset: clearDb,
  };

  window.fetch = apiFetch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPreviewBadge, { once: true });
  } else {
    installPreviewBadge();
  }
})();
