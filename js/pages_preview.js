(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const DB_NAME = 'gitai-pages-preview-v2';
  const DB_VERSION = 1;
  const IMAGE_STORE = 'images';
  const META_STORE = 'meta';
  const TOTAL = 60;
  const SIZE = 128;
  const HALF = SIZE / 2;
  const ACHROMATIC_SATURATION_EPSILON = 1 / 255;

  let dbPromise = null;
  let appConfig = null;
  let speciesConfig = null;
  let environmentConfig = null;
  let evolutionConfig = null;
  let currentGenerationId = 'gen00001';
  let currentObjectUrls = new Map();
  let mask = null;
  let templateAlpha = null;
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

  async function resetAllPreviewData() {
    releaseObjectUrls();
    await clearDb();
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (
          key
          && (
            key.startsWith('gitai-preview-leaderboard-')
            || key.startsWith('gitai-preview-share-name-')
          )
        ) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}

    location.href = location.pathname
      + (location.search.includes('fast=1') ? '?fast=1' : '');
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
    const seconds = Number(params.get('seconds'));
    if (
      Number.isFinite(seconds)
      && seconds >= 0.5
      && seconds <= 10
    ) {
      appConfig.game.round_time_ms = Math.round(seconds * 1000);
    } else if (params.get('fast') === '1') {
      appConfig.game.round_time_ms = 500;
    }
  }

  async function ensureCurrentGeneration() {
    await ensureConfig();
    const stored = await idbGet(META_STORE, 'current_generation_id');
    if (typeof stored === 'string' && /^gen\d{5}$/.test(stored)) {
      currentGenerationId = stored;
    }

    if (
      String(evolutionConfig?.inheritance || '').startsWith('trait_')
      && currentGenerationId === 'gen00001'
    ) {
      await ensureFounderGeneration();
    }

    let loaded = await loadGeneratedGeneration(currentGenerationId);
    if (!loaded) {
      currentGenerationId = 'gen00001';
      if (String(evolutionConfig?.inheritance || '').startsWith('trait_')) {
        await ensureFounderGeneration();
      }
      await idbPut(META_STORE, 'current_generation_id', currentGenerationId);
      loaded = await loadGeneratedGeneration(currentGenerationId);
    }

    if (!loaded) {
      throw new Error('第1世代の生成に失敗しました');
    }
  }

  function resolveAsset(generationId, index, fallbackPath) {
    const generated = currentObjectUrls.get(imageKey(generationId, index));
    if (generated) return generated;

    if (generationId === 'gen00001') {
      const embedded = window.GitaiGen1Images
        && window.GitaiGen1Images[index];
      return embedded || fallbackPath;
    }
    return fallbackPath;
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
    const maskSource = window.GitaiPreviewMaskDataUri
      || baseUrl(speciesConfig.genetics.mask_source);
    const maskData = await loadImageDataFromUrl(maskSource);
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

    if (evolutionConfig.parent_selection === 'all_survivors') {
      return shuffle(survivors);
    }

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
    const parents = shuffle(parentIndices);
    const plan = [];
    for (let childIndex = 1; childIndex <= TOTAL; childIndex += 1) {
      const a = parents[(childIndex - 1) % parents.length];
      const choices = parentIndices.filter((b) => b !== a);
      const b = choices[Math.floor(Math.random() * choices.length)];
      plan.push({ childIndex, parentA: a, parentB: b });
    }
    return shuffle(plan).map((item, offset) => ({
      ...item,
      childIndex: offset + 1,
    }));
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
      const hueDelta = (Math.random() * 2 - 1) * dh;
      const newS = Math.max(
        0,
        Math.min(1, s + (Math.random() * 2 - 1) * ds),
      );
      const newV = Math.max(
        0,
        Math.min(1, v + (Math.random() * 2 - 1) * dv),
      );

      // White/gray pixels have no meaningful hue. rgbToHsv represents
      // achromatic colors as H=0, which would otherwise bias the first
      // visible color mutation toward red.
      if (
        s <= ACHROMATIC_SATURATION_EPSILON
        && newS > ACHROMATIC_SATURATION_EPSILON
      ) {
        h = Math.random() * 360;
      } else {
        h = (h + hueDelta + 360) % 360;
      }

      const [nr, ng, nb] = hsvToRgb(h, newS, newV);
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }
    return true;
  }

  function applyPatchMutation(data, maskData, coords, microMutated) {
    if (!microMutated) return false;
    if (Math.random() >= Number(evolutionConfig.p_patch_given_mut || 0)) {
      return false;
    }
    if (!coords.length) return false;

    const count = randomInt(
      Number(evolutionConfig.patch_count_min || 1),
      Number(evolutionConfig.patch_count_max || 1),
    );
    const rMin = Number(evolutionConfig.patch_radius_min || 2);
    const rMax = Number(evolutionConfig.patch_radius_max || 6);
    const dH = Number(
      evolutionConfig.patch_delta_h_deg ?? evolutionConfig.delta_h_deg ?? 10
    );
    const dS = Number(
      evolutionConfig.patch_delta_s ?? evolutionConfig.delta_s ?? 0.18
    );
    const dV = Number(
      evolutionConfig.patch_delta_v ?? evolutionConfig.delta_v ?? 0.18
    );

    for (let n = 0; n < count; n += 1) {
      const [cx, cy] = coords[Math.floor(Math.random() * coords.length)];
      const rx = Math.max(1, randomInt(rMin, rMax));
      const ry = Math.max(1, randomInt(rMin, rMax));
      const hueDelta = (Math.random() * 2 - 1) * dH;
      const achromaticHue = Math.random() * 360;
      const satDelta = (Math.random() * 2 - 1) * dS;
      const valDelta = (Math.random() * 2 - 1) * dV;

      const x0 = Math.max(0, cx - rx);
      const x1 = Math.min(HALF - 1, cx + rx);
      const y0 = Math.max(0, cy - ry);
      const y1 = Math.min(SIZE - 1, cy + ry);

      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (!maskData[y * SIZE + x]) continue;
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;

          const [r, g, b, a] = getPixel(data, x, y);
          if (a === 0) continue;
          let [h, s, v] = rgbToHsv(r, g, b);
          const newS = Math.max(0, Math.min(1, s + satDelta));
          const newV = Math.max(0, Math.min(1, v + valDelta));

          if (
            s <= ACHROMATIC_SATURATION_EPSILON
            && newS > ACHROMATIC_SATURATION_EPSILON
          ) {
            h = achromaticHue;
          } else {
            h = (h + hueDelta + 360) % 360;
          }

          const [nr, ng, nb] = hsvToRgb(h, newS, newV);
          setPixelMirrored(data, x, y, [nr, ng, nb, a]);
        }
      }
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

    if (
      mode === 'contrast_shift_small'
      || mode === 'contrast_boost'
    ) {
      const values = [];
      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        values.push(rgbToHsv(r, g, b)[2]);
      }
      const mean = values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0.5;

      let strength;
      if (mode === 'contrast_shift_small') {
        const delta = Math.max(
          0,
          Number(selected.strength_delta || 0.06),
        );
        strength = 1 + (Math.random() * 2 - 1) * delta;
      } else {
        strength = Number(selected.strength || 1.25);
      }

      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        const [h, sat, value] = rgbToHsv(r, g, b);
        const shiftedValue = Math.max(
          0,
          Math.min(1, mean + (value - mean) * strength),
        );
        const [nr, ng, nb] = hsvToRgb(h, sat, shiftedValue);
        setPixelMirrored(data, x, y, [nr, ng, nb, a]);
      }
      return;
    }

    let hueShift = 0;
    let saturationShift = 0;
    let valueScale = 1;
    const achromaticHue = Math.random() * 360;

    if (mode === 'melanism_darkening') {
      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        let [h, s, v] = rgbToHsv(r, g, b);
        v *= Number(selected.strength || 0.65);
        const [nr, ng, nb] = hsvToRgb(h, s, v);
        setPixelMirrored(data, x, y, [nr, ng, nb, a]);
      }
      return;
    }

    if (mode === 'pallor_lightening') {
      for (const [x, y] of coords) {
        const [r, g, b, a] = getPixel(data, x, y);
        if (a === 0) continue;
        let [h, s, v] = rgbToHsv(r, g, b);
        v *= Number(selected.strength || 1.25);
        const [nr, ng, nb] = hsvToRgb(h, s, v);
        setPixelMirrored(data, x, y, [nr, ng, nb, a]);
      }
      return;
    }

    if (mode === 'hue_shift_small') {
      hueShift =
        (Math.random() * 2 - 1) * Number(selected.shift_deg || 15);
    } else if (mode === 'saturation_shift_small') {
      saturationShift =
        (Math.random() * 2 - 1) * Number(selected.shift || 0.12);
    } else if (mode === 'value_shift_small') {
      const scaleDelta = Math.max(
        0,
        Number(selected.scale_delta ?? selected.shift ?? 0.12),
      );
      valueScale = 1 + (Math.random() * 2 - 1) * scaleDelta;
    } else {
      return;
    }

    for (const [x, y] of coords) {
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;
      let [h, s, v] = rgbToHsv(r, g, b);
      const newS = Math.max(0, Math.min(1, s + saturationShift));
      const newV = Math.max(0, Math.min(1, v * valueScale));

      if (
        mode === 'saturation_shift_small'
        && s <= ACHROMATIC_SATURATION_EPSILON
        && newS > ACHROMATIC_SATURATION_EPSILON
      ) {
        h = achromaticHue;
      } else {
        h = (h + hueShift + 360) % 360;
      }

      const [nr, ng, nb] = hsvToRgb(h, newS, newV);
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }
  }

  function applyGlobalHueMutation(data, coords) {
    const probability = Number(
      evolutionConfig.p_global_hue_mutation || 0
    );
    if (probability <= 0 || Math.random() >= probability) {
      return false;
    }

    const hue = Math.random() * 360;
    const minSaturation = Math.max(
      0,
      Math.min(
        1,
        Number(evolutionConfig.global_hue_min_saturation || 0),
      ),
    );

    for (const [x, y] of coords) {
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;

      const [, s, v] = rgbToHsv(r, g, b);
      const [nr, ng, nb] = hsvToRgb(
        hue,
        Math.max(s, minSaturation),
        v,
      );
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }

    return true;
  }

  function applyGlobalValueMutation(data, coords) {
    const probability = Number(
      evolutionConfig.p_global_value_mutation || 0
    );
    if (probability <= 0 || Math.random() >= probability) {
      return false;
    }

    const minMean = Math.max(
      0,
      Math.min(
        1,
        Number(evolutionConfig.global_value_mean_min ?? 0.35),
      ),
    );
    const maxMean = Math.max(
      minMean,
      Math.min(
        1,
        Number(evolutionConfig.global_value_mean_max ?? 0.90),
      ),
    );

    let totalValue = 0;
    let pixelCount = 0;
    for (const [x, y] of coords) {
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;
      totalValue += rgbToHsv(r, g, b)[2];
      pixelCount += 1;
    }
    if (!pixelCount) return false;

    const currentMean = totalValue / pixelCount;
    const targetMean = minMean + Math.random() * (maxMean - minMean);
    const valueScale = targetMean / Math.max(currentMean, 1e-6);

    for (const [x, y] of coords) {
      const [r, g, b, a] = getPixel(data, x, y);
      if (a === 0) continue;

      const [h, sat, value] = rgbToHsv(r, g, b);
      const newValue = Math.max(
        0,
        Math.min(1, value * valueScale),
      );
      const [nr, ng, nb] = hsvToRgb(h, sat, newValue);
      setPixelMirrored(data, x, y, [nr, ng, nb, a]);
    }

    return true;
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

  function genomeKey(generationId, index) {
    return `genome:${generationId}:${String(index).padStart(2, '0')}`;
  }

  async function deleteGeneration(generationId) {
    if (!generationId || generationId === 'gen00001') return;
    for (let i = 1; i <= TOTAL; i += 1) {
      await idbDelete(IMAGE_STORE, imageKey(generationId, i));
      await idbDelete(META_STORE, genomeKey(generationId, i));
    }
  }

  async function evolveGenerationLegacy(generationId, eatenIndices) {
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
      applyPatchMutation(child.data, mask, coords, micro);
      applyMacroMutation(child.data, mask, coords, micro);
      applyGlobalHueMutation(child.data, coords);
      applyGlobalValueMutation(child.data, coords);
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


  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value)));
  }

  function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, Number(value)));
  }

  function generationNumber(generationId) {
    const match = String(generationId || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 1;
  }

  function seededUnit(seed, salt) {
    const x = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function circularLerpDeg(a, b, t) {
    let delta = ((Number(b) - Number(a) + 540) % 360) - 180;
    return (Number(a) + delta * t + 360) % 360;
  }

  function inheritLinear(a, b) {
    const lo = Math.min(Number(a), Number(b));
    const hi = Math.max(Number(a), Number(b));
    return lo + Math.random() * (hi - lo);
  }

  function mutateAllele(value, genetics) {
    let allele = value ? 1 : 0;
    if (
      allele === 0
      && Math.random() < Number(genetics.pattern_allele_gain_p || 0)
    ) {
      allele = 1;
    } else if (
      allele === 1
      && Math.random() < Number(genetics.pattern_allele_loss_p || 0)
    ) {
      allele = 0;
    }
    return allele;
  }

  function locusExpression(locus, alleles) {
    const dosage = Number(Boolean(alleles[0])) + Number(Boolean(alleles[1]));
    if (locus.dominance === 'dominant') return dosage > 0 ? 1 : 0;
    if (locus.dominance === 'recessive') return dosage === 2 ? 1 : 0;
    return dosage / 2;
  }

  function defaultModuleParams(id, seed) {
    const j = (salt, amount) => (seededUnit(seed, salt) * 2 - 1) * amount;
    const phase = seededUnit(seed, 90) * Math.PI * 2;

    if (id === 'central_blotch') {
      return {
        cx: clamp(0.48 + j(1, 0.12), 0.20, 0.78),
        cy: clamp(0.52 + j(2, 0.12), 0.25, 0.78),
        rx: clamp(0.22 + j(3, 0.08), 0.08, 0.38),
        ry: clamp(0.16 + j(4, 0.07), 0.06, 0.32),
        valueEffect: clamp(-0.30 + j(5, 0.14), -0.55, 0.35),
        hueEffect: j(6, 22),
        saturationEffect: j(7, 0.12),
        phase,
        angle: j(8, 18),
        frequency: clamp(1.3 + j(9, 0.4), 0.6, 2.5),
        roughness: clamp(0.18 + j(10, 0.10), 0, 0.5),
      };
    }

    if (id === 'transverse_band') {
      return {
        cx: 0.50,
        cy: clamp(0.50 + j(11, 0.16), 0.20, 0.80),
        rx: 0.50,
        ry: clamp(0.085 + j(12, 0.04), 0.035, 0.18),
        valueEffect: clamp(-0.27 + j(13, 0.15), -0.55, 0.35),
        hueEffect: j(14, 22),
        saturationEffect: j(15, 0.12),
        phase,
        angle: j(16, 10),
        frequency: clamp(1.4 + j(17, 0.5), 0.6, 3.0),
        roughness: clamp(0.18 + j(18, 0.10), 0, 0.55),
      };
    }

    if (id === 'outer_edge') {
      return {
        cx: 0.14,
        cy: 0.52,
        rx: clamp(0.18 + j(21, 0.07), 0.07, 0.34),
        ry: 0.48,
        valueEffect: clamp(-0.24 + j(22, 0.14), -0.50, 0.32),
        hueEffect: j(23, 18),
        saturationEffect: j(24, 0.10),
        phase,
        angle: j(25, 8),
        frequency: clamp(1.2 + j(26, 0.4), 0.6, 2.5),
        roughness: clamp(0.20 + j(27, 0.12), 0, 0.55),
      };
    }

    if (id === 'longitudinal_streaks') {
      return {
        cx: 0.50,
        cy: 0.50,
        rx: 0.50,
        ry: 0.50,
        valueEffect: clamp(-0.22 + j(41, 0.16), -0.52, 0.35),
        hueEffect: j(42, 20),
        saturationEffect: j(43, 0.11),
        phase,
        angle: clamp(j(44, 12), -25, 25),
        frequency: clamp(3.5 + j(45, 1.4), 1.5, 7.0),
        roughness: clamp(0.20 + j(46, 0.14), 0, 0.6),
      };
    }

    if (id === 'cloud_mottle') {
      return {
        cx: 0.50,
        cy: 0.52,
        rx: 0.50,
        ry: 0.48,
        valueEffect: clamp(-0.20 + j(51, 0.18), -0.50, 0.38),
        hueEffect: j(52, 24),
        saturationEffect: j(53, 0.13),
        phase,
        angle: j(54, 45),
        frequency: clamp(2.5 + j(55, 1.0), 1.0, 5.5),
        roughness: clamp(0.45 + j(56, 0.20), 0.10, 0.85),
      };
    }

    if (id === 'ring_spots') {
      return {
        cx: clamp(0.50 + j(61, 0.20), 0.15, 0.85),
        cy: clamp(0.50 + j(62, 0.22), 0.15, 0.85),
        rx: clamp(0.20 + j(63, 0.08), 0.07, 0.38),
        ry: clamp(0.15 + j(64, 0.07), 0.05, 0.32),
        valueEffect: clamp(-0.30 + j(65, 0.16), -0.58, 0.38),
        hueEffect: j(66, 26),
        saturationEffect: j(67, 0.14),
        phase,
        angle: j(68, 30),
        frequency: 1,
        roughness: clamp(0.12 + j(69, 0.08), 0, 0.4),
      };
    }

    if (id === 'diagonal_streak') {
      return {
        cx: clamp(0.50 + j(71, 0.14), 0.22, 0.78),
        cy: clamp(0.50 + j(72, 0.14), 0.22, 0.78),
        rx: clamp(0.09 + j(73, 0.035), 0.035, 0.18),
        ry: 0.55,
        valueEffect: clamp(-0.25 + j(74, 0.16), -0.55, 0.36),
        hueEffect: j(75, 22),
        saturationEffect: j(76, 0.12),
        phase,
        angle: clamp(35 + j(77, 22), 8, 72),
        frequency: clamp(1.2 + j(78, 0.4), 0.7, 2.4),
        roughness: clamp(0.16 + j(79, 0.10), 0, 0.5),
      };
    }

    // speckle_cluster
    return {
      cx: clamp(0.48 + j(31, 0.18), 0.12, 0.85),
      cy: clamp(0.50 + j(32, 0.18), 0.15, 0.85),
      rx: clamp(0.30 + j(33, 0.10), 0.12, 0.48),
      ry: clamp(0.30 + j(34, 0.10), 0.12, 0.48),
      valueEffect: clamp(-0.22 + j(35, 0.16), -0.50, 0.36),
      hueEffect: j(36, 24),
      saturationEffect: j(37, 0.13),
      phase,
      angle: j(38, 25),
      frequency: clamp(4.0 + j(39, 1.4), 1.8, 8.0),
      roughness: clamp(0.52 + j(40, 0.20), 0.15, 0.9),
    };
  }

  async function ensureTemplateAlpha() {
    if (templateAlpha) return templateAlpha;

    const embedded = window.GitaiGen1Images
      && window.GitaiGen1Images[1];
    const fallback = speciesConfig.image.asset_template
      .replaceAll('{generation_id}', 'gen00001')
      .replaceAll('{index_2d}', '01')
      .replaceAll('{index}', '1');
    const sourceUrl = embedded || baseUrl(fallback);
    const source = await loadImageDataFromUrl(sourceUrl);

    templateAlpha = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      templateAlpha[i] = source.data[i * 4 + 3];
    }
    return templateAlpha;
  }

  function inferGenomeFromImage(imageData, generationId, index) {
    const genetics = evolutionConfig.trait_genetics || {};
    let totalS = 0;
    let totalV = 0;
    let hueX = 0;
    let hueY = 0;
    let hueWeight = 0;
    let count = 0;

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < HALF; x += 1) {
        if (!mask[y * SIZE + x]) continue;
        const [r, g, b, a] = getPixel(imageData.data, x, y);
        if (a === 0) continue;
        const [h, sat, value] = rgbToHsv(r, g, b);
        totalS += sat;
        totalV += value;
        const weight = Math.max(0.001, sat);
        hueX += Math.cos(h * Math.PI / 180) * weight;
        hueY += Math.sin(h * Math.PI / 180) * weight;
        hueWeight += weight;
        count += 1;
      }
    }

    const seed = generationNumber(generationId) * 1000 + index;
    const meanS = count ? totalS / count : 0.02;
    const meanV = count ? totalV / count : 0.96;
    let meanH = (index * 137.507764 + generationNumber(generationId) * 17) % 360;
    if (hueWeight > 0.02 && Math.hypot(hueX, hueY) > 0.01) {
      meanH = (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360;
    }

    const modules = {};
    (genetics.pattern_loci || []).forEach((locus, locusIndex) => {
      modules[locus.id] = {
        alleles: [0, 0],
        ...defaultModuleParams(locus.id, seed + locusIndex),
      };
    });

    return {
      schema_version: 1,
      baseHue: meanH,
      baseSaturation: clamp01(meanS),
      baseValue: clamp(meanV, 0.15, 1),
      patternContrast: 0.26,
      textureStrength: 0.035,
      textureSeed: seed,
      modules,
    };
  }

  async function loadGenomeOrInfer(generationId, index, imageData) {
    const stored = await idbGet(META_STORE, genomeKey(generationId, index));
    if (
      stored
      && typeof stored === 'object'
      && Number(stored.schema_version) === 1
    ) {
      return stored;
    }
    const genome = inferGenomeFromImage(
      imageData,
      generationId,
      index,
    );
    await idbPut(META_STORE, genomeKey(generationId, index), genome);
    return genome;
  }

  function inheritModule(parentA, parentB, locus, genetics, childSeed) {
    const a = parentA.modules[locus.id]
      || { alleles: [0, 0], ...defaultModuleParams(locus.id, childSeed + 1) };
    const b = parentB.modules[locus.id]
      || { alleles: [0, 0], ...defaultModuleParams(locus.id, childSeed + 2) };

    const alleleAIndex = Math.floor(Math.random() * 2);
    const alleleBIndex = Math.floor(Math.random() * 2);
    const inheritedA = a.alleles[alleleAIndex] || 0;
    const inheritedB = b.alleles[alleleBIndex] || 0;
    const childAlleleA = mutateAllele(inheritedA, genetics);
    const childAlleleB = mutateAllele(inheritedB, genetics);

    const chooseNumber = (key, fallback) => {
      const av = Number(a[key] ?? fallback);
      const bv = Number(b[key] ?? fallback);
      if (childAlleleA && childAlleleB) return inheritLinear(av, bv);
      if (childAlleleA) return av;
      if (childAlleleB) return bv;
      return Math.random() < 0.5 ? av : bv;
    };

    const chooseCircularPhase = () => {
      const av = Number(a.phase || 0);
      const bv = Number(b.phase || 0);
      if (childAlleleA && !childAlleleB) return av;
      if (!childAlleleA && childAlleleB) return bv;
      return Math.random() < 0.5 ? av : bv;
    };

    const chooseHue = (key, fallback) => {
      const av = Number(a[key] ?? fallback);
      const bv = Number(b[key] ?? fallback);
      if (childAlleleA && childAlleleB) {
        return circularLerpDeg(av, bv, Math.random());
      }
      if (childAlleleA) return av;
      if (childAlleleB) return bv;
      return Math.random() < 0.5 ? av : bv;
    };

    const patternSatMin = Number(
      genetics.pattern_pigment_saturation_min ?? 0.06
    );
    const patternSatMax = Math.max(
      patternSatMin,
      Number(genetics.pattern_pigment_saturation_max ?? 0.26),
    );
    const fallbackPigmentSat = patternSatMin
      + seededUnit(childSeed, 211) * (patternSatMax - patternSatMin);

    const module = {
      alleles: [childAlleleA, childAlleleB],
      cx: chooseNumber('cx', 0.5),
      cy: chooseNumber('cy', 0.5),
      rx: chooseNumber('rx', 0.2),
      ry: chooseNumber('ry', 0.2),
      valueEffect: chooseNumber('valueEffect', -0.2),
      hueEffect: chooseNumber('hueEffect', 0),
      saturationEffect: chooseNumber('saturationEffect', 0),
      pigmentHue: chooseHue(
        'pigmentHue',
        seededUnit(childSeed, 210) * 360,
      ),
      pigmentSaturation: chooseNumber(
        'pigmentSaturation',
        fallbackPigmentSat,
      ),
      phase: chooseCircularPhase(),
      angle: chooseNumber('angle', 0),
      frequency: chooseNumber('frequency', 1),
      roughness: chooseNumber('roughness', 0),
    };

    const dosage = Number(Boolean(module.alleles[0]))
      + Number(Boolean(module.alleles[1]));

    if (
      dosage > 0
      && Math.random()
      < Number(genetics.pattern_parameter_mutation_p || 0)
    ) {
      const posStep = Number(genetics.pattern_position_step || 0.025);
      const sizeStep = Number(genetics.pattern_size_step || 0.04);
      const effectStep = Number(genetics.pattern_effect_step || 0.04);
      const angleStep = Number(genetics.pattern_angle_step_deg || 10);
      const frequencyStep = Number(genetics.pattern_frequency_step || 0.35);
      const roughnessStep = Number(genetics.pattern_roughness_step || 0.08);

      module.cx = clamp(module.cx + (Math.random() * 2 - 1) * posStep, 0.06, 0.94);
      module.cy = clamp(module.cy + (Math.random() * 2 - 1) * posStep, 0.08, 0.92);
      module.rx = clamp(module.rx + (Math.random() * 2 - 1) * sizeStep, 0.03, 0.55);
      module.ry = clamp(module.ry + (Math.random() * 2 - 1) * sizeStep, 0.03, 0.58);
      module.valueEffect = clamp(
        module.valueEffect + (Math.random() * 2 - 1) * effectStep,
        -0.65,
        0.50,
      );
      module.hueEffect = clamp(
        module.hueEffect + (Math.random() * 2 - 1) * effectStep * 140,
        -80,
        80,
      );
      module.saturationEffect = clamp(
        module.saturationEffect + (Math.random() * 2 - 1) * effectStep,
        -0.38,
        0.38,
      );
      module.angle = clamp(
        module.angle + (Math.random() * 2 - 1) * angleStep,
        -90,
        90,
      );
      module.frequency = clamp(
        module.frequency + (Math.random() * 2 - 1) * frequencyStep,
        0.5,
        9,
      );
      module.roughness = clamp01(
        module.roughness + (Math.random() * 2 - 1) * roughnessStep,
      );

      const pigmentHueStep = Number(
        genetics.pattern_pigment_hue_step_deg ?? 24
      );
      const pigmentSatStep = Number(
        genetics.pattern_pigment_saturation_step ?? 0.05
      );
      const pigmentSatCap = Number(
        genetics.pattern_pigment_saturation_cap ?? 0.30
      );
      module.pigmentHue = (
        Number(module.pigmentHue || 0)
        + (Math.random() * 2 - 1) * pigmentHueStep
        + 360
      ) % 360;
      module.pigmentSaturation = clamp(
        Number(module.pigmentSaturation || 0)
        + (Math.random() * 2 - 1) * pigmentSatStep,
        0,
        pigmentSatCap,
      );
    }

    if (
      dosage > 0
      && Math.random()
      < Number(genetics.pattern_pigment_global_hue_mutation_p || 0)
    ) {
      const minJump = Number(
        genetics.pattern_pigment_global_min_jump_deg ?? 70
      );
      const maxJump = Math.max(
        minJump,
        Number(genetics.pattern_pigment_global_max_jump_deg ?? 180),
      );
      const jump = minJump + Math.random() * (maxJump - minJump);
      const sign = Math.random() < 0.5 ? -1 : 1;
      module.pigmentHue = (
        Number(module.pigmentHue || 0) + sign * jump + 360
      ) % 360;
    }

    return module;
  }

  function makeChildGenome(parentA, parentB, childIndex, nextId) {
    const genetics = evolutionConfig.trait_genetics || {};
    const colorParent = Math.random() < 0.5 ? parentA : parentB;
    let baseHue = Number(colorParent.baseHue || 0);
    let baseSaturation = Number(colorParent.baseSaturation || 0);

    if (
      generationNumber(nextId) === 1
      && evolutionConfig.founder_model?.latent_hue_diversity
    ) {
      // Pure white has no visible hue at S=0, so Generation 1 can carry
      // broad hidden hue potential without ceasing to be phenotypically white.
      baseHue = Math.random() * 360;
    }

    let baseValue = inheritLinear(parentA.baseValue, parentB.baseValue);
    let patternContrast = inheritLinear(
      parentA.patternContrast,
      parentB.patternContrast,
    );
    let textureStrength = inheritLinear(
      parentA.textureStrength,
      parentB.textureStrength,
    );

    if (Math.random() < Number(genetics.base_hue_small_mutation_p || 0)) {
      baseHue = (
        baseHue
        + (Math.random() * 2 - 1)
        * Number(genetics.base_hue_small_mutation_deg || 0)
        + 360
      ) % 360;
    }

    if (Math.random() < Number(genetics.base_hue_global_mutation_p || 0)) {
      const minJump = Number(
        genetics.base_hue_global_min_jump_deg ?? 70
      );
      const maxJump = Math.max(
        minJump,
        Number(genetics.base_hue_global_max_jump_deg ?? 180),
      );
      const jump = minJump + Math.random() * (maxJump - minJump);
      const sign = Math.random() < 0.5 ? -1 : 1;
      baseHue = (baseHue + sign * jump + 360) % 360;

      // Major hue mutation changes hue only. Brightness and saturation
      // continue to run through their own independent mutation draws below.
    }

    const saturationCap = clamp(
      Number(genetics.base_saturation_max ?? 1),
      0,
      1,
    );
    baseSaturation = clamp(baseSaturation, 0, saturationCap);

    if (
      Math.random()
      < Number(genetics.base_saturation_mutation_p || 0)
    ) {
      baseSaturation = clamp(
        baseSaturation
        + (Math.random() * 2 - 1)
        * Number(genetics.base_saturation_mutation_step || 0),
        0,
        saturationCap,
      );
    }

    const pigmentMin = Math.min(
      saturationCap,
      Number(genetics.pigment_expression_saturation_min ?? 0.08),
    );
    const pigmentMax = Math.min(
      saturationCap,
      Math.max(
        pigmentMin,
        Number(genetics.pigment_expression_saturation_max ?? 0.25),
      ),
    );
    if (
      baseSaturation < pigmentMin
      && Math.random() < Number(genetics.pigment_expression_p || 0)
    ) {
      // Reveal the hue already carried by this lineage instead of assigning
      // a new random hue at pigment expression time.
      baseSaturation = pigmentMin
        + Math.random() * (pigmentMax - pigmentMin);
    }

    if (
      Math.random()
      < Number(genetics.base_value_small_mutation_p || 0)
    ) {
      const delta = Number(genetics.base_value_small_scale_delta || 0);
      baseValue = clamp01(
        baseValue * (1 + (Math.random() * 2 - 1) * delta),
      );
    }

    if (
      Math.random()
      < Number(genetics.base_value_global_mutation_p || 0)
    ) {
      const minV = Number(genetics.base_value_global_min ?? 0.10);
      const maxV = Number(genetics.base_value_global_max ?? 0.95);
      const darkBiasP = Number(genetics.base_value_dark_bias_p || 0);

      if (Math.random() < darkBiasP) {
        const darkMin = Number(genetics.base_value_dark_min ?? minV);
        const darkMax = Math.max(
          darkMin,
          Number(genetics.base_value_dark_max ?? 0.28),
        );
        baseValue = darkMin + Math.random() * (darkMax - darkMin);
      } else {
        baseValue = minV + Math.random() * (maxV - minV);
      }
    }

    if (
      Math.random()
      < Number(genetics.contrast_mutation_p || 0)
    ) {
      patternContrast = clamp(
        patternContrast
        + (Math.random() * 2 - 1)
        * Number(genetics.contrast_mutation_step || 0),
        0.06,
        0.90,
      );
    }

    let textureMutated = false;
    if (
      Math.random()
      < Number(genetics.texture_mutation_p || 0)
    ) {
      textureStrength = clamp(
        textureStrength
        + (Math.random() * 2 - 1)
        * Number(genetics.texture_mutation_step || 0),
        0,
        0.20,
      );
      textureMutated = true;
    }

    const childSeed = generationNumber(nextId) * 1000 + childIndex;
    const modules = {};
    for (const locus of genetics.pattern_loci || []) {
      modules[locus.id] = inheritModule(
        parentA,
        parentB,
        locus,
        genetics,
        childSeed,
      );
    }

    // New pattern modules are born at the child level, not independently
    // at every pixel/locus. This keeps mutation supply fast without turning
    // inheritance into fine-grained mosaic noise.
    if (
      Math.random()
      < Number(genetics.pattern_birth_p_per_child || 0)
    ) {
      const candidates = (genetics.pattern_loci || []).filter((locus) => {
        const module = modules[locus.id];
        return module
          && !module.alleles[0]
          && !module.alleles[1];
      });

      if (candidates.length) {
        const locus = candidates[Math.floor(Math.random() * candidates.length)];
        const locusIndex = Math.max(
          0,
          (genetics.pattern_loci || []).findIndex(
            (item) => item.id === locus.id
          ),
        );
        const fresh = defaultModuleParams(
          locus.id,
          childSeed + (locusIndex + 1) * 997 + Math.floor(Math.random() * 997),
        );
        const newAlleles = [0, 0];
        newAlleles[Math.floor(Math.random() * 2)] = 1;
        const patternSatMin = Number(
          genetics.pattern_pigment_saturation_min ?? 0.06
        );
        const patternSatMax = Math.max(
          patternSatMin,
          Number(genetics.pattern_pigment_saturation_max ?? 0.26),
        );
        modules[locus.id] = {
          alleles: newAlleles,
          ...fresh,
          pigmentHue: Math.random() * 360,
          pigmentSaturation: patternSatMin
            + Math.random() * (patternSatMax - patternSatMin),
        };

        patternContrast = Math.max(
          patternContrast,
          Number(genetics.pattern_birth_contrast_floor || 0.40),
        );
      }
    }

    return {
      schema_version: 1,
      baseHue,
      baseSaturation,
      baseValue,
      patternContrast,
      textureStrength,
      textureSeed: textureMutated
        ? childSeed
        : (
          Math.random() < 0.5
            ? Number(parentA.textureSeed || childSeed)
            : Number(parentB.textureSeed || childSeed)
        ),
      modules,
    };
  }

  function makePureWhiteFounderGenome(founderIndex) {
    const genetics = evolutionConfig.trait_genetics || {};
    const founder = evolutionConfig.founder_model || {};
    const seed = 100 + founderIndex;
    const modules = {};

    for (const locus of genetics.pattern_loci || []) {
      modules[locus.id] = {
        alleles: [0, 0],
        ...defaultModuleParams(locus.id, seed),
      };
    }

    return {
      schema_version: 1,
      baseHue: Number(founder.founder_base_hue ?? 0),
      baseSaturation: Number(founder.founder_base_saturation ?? 0),
      baseValue: Number(founder.founder_base_value ?? 1),
      patternContrast: Number(
        founder.founder_pattern_contrast ?? 0.32
      ),
      textureStrength: Number(
        founder.founder_texture_strength ?? 0
      ),
      textureSeed: seed,
      modules,
    };
  }

  async function ensureFounderGeneration() {
    await ensureConfig();
    await ensureMask();
    await ensureTemplateAlpha();

    const markerKey = 'founder_generation_config_id';
    const expectedMarker = String(evolutionConfig.config_id || 'unknown');
    const storedMarker = await idbGet(META_STORE, markerKey);

    if (storedMarker === expectedMarker) {
      const first = await idbGet(
        IMAGE_STORE,
        imageKey('gen00001', 1),
      );
      const last = await idbGet(
        IMAGE_STORE,
        imageKey('gen00001', TOTAL),
      );
      if (first instanceof Blob && last instanceof Blob) {
        return true;
      }
    }

    const founderA = makePureWhiteFounderGenome(1);
    const founderB = makePureWhiteFounderGenome(2);

    for (let i = 1; i <= TOTAL; i += 1) {
      const genome = makeChildGenome(
        founderA,
        founderB,
        i,
        'gen00001',
      );
      const imageData = renderGenome(genome);
      const blob = await imageDataToBlob(imageData);

      await idbPut(IMAGE_STORE, imageKey('gen00001', i), blob);
      await idbPut(
        META_STORE,
        genomeKey('gen00001', i),
        genome,
      );

      if (i % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await idbPut(META_STORE, markerKey, expectedMarker);
    await idbPut(
      META_STORE,
      'current_generation_id',
      'gen00001',
    );
    return true;
  }

  function moduleMaskValue(id, module, xNorm, yNorm, xPx, yPx) {
    const angle = Number(module.angle || 0) * Math.PI / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dx0 = xNorm - Number(module.cx || 0.5);
    const dy0 = yNorm - Number(module.cy || 0.5);
    const u = dx0 * cosA + dy0 * sinA;
    const v = -dx0 * sinA + dy0 * cosA;
    const frequency = Math.max(0.5, Number(module.frequency || 1));
    const roughness = clamp01(Number(module.roughness || 0));
    const phase = Number(module.phase || 0);

    if (id === 'central_blotch') {
      const dx = u / Math.max(0.02, module.rx);
      const dy = v / Math.max(0.02, module.ry);
      const wobble = roughness * 0.18
        * Math.sin(Math.atan2(dy, dx) * 5 + phase);
      const d2 = dx * dx + dy * dy;
      const edge = 1 + wobble;
      return d2 >= edge ? 0 : Math.pow(1 - d2 / edge, 0.65);
    }

    if (id === 'transverse_band') {
      const wave = (
        0.025 + roughness * 0.035
      ) * Math.sin(xNorm * Math.PI * 2 * frequency + phase);
      const center = Number(module.cy || 0.5) + wave;
      const distance = Math.abs(yNorm - center);
      if (distance >= module.ry) return 0;
      return 1 - distance / Math.max(0.01, module.ry);
    }

    if (id === 'outer_edge') {
      const distance = Math.abs(xNorm - Number(module.cx || 0.14));
      if (distance >= module.rx) return 0;
      const base = 1 - distance / Math.max(0.01, module.rx);
      const serration = 0.82 + 0.18 * Math.sin(
        yNorm * Math.PI * 2 * frequency + phase
      );
      return Math.pow(base, 0.7) * (
        (1 - roughness) + roughness * Math.max(0, serration)
      );
    }

    if (id === 'longitudinal_streaks') {
      const warpedX = xNorm
        + roughness * 0.045
        * Math.sin(yNorm * Math.PI * 2 * 1.7 + phase);
      const stripe = Math.abs(
        Math.sin((warpedX * frequency + phase / Math.PI) * Math.PI)
      );
      const sharp = Math.pow(1 - stripe, 1.8);
      return sharp > 0.18 ? (sharp - 0.18) / 0.82 : 0;
    }

    if (id === 'cloud_mottle') {
      const a = Math.sin(
        (xNorm * frequency * 1.15 + yNorm * 0.75) * Math.PI * 2 + phase
      );
      const b = Math.sin(
        (yNorm * frequency * 0.85 - xNorm * 0.55) * Math.PI * 2
        + phase * 0.73
      );
      const c = Math.sin(
        (xNorm + yNorm) * frequency * Math.PI
        + phase * 1.37
      );
      const cloud = (a * 0.46 + b * 0.34 + c * 0.20 + 1) / 2;
      const threshold = 0.50 - roughness * 0.10;
      return cloud > threshold
        ? Math.min(1, (cloud - threshold) / (1 - threshold))
        : 0;
    }

    if (id === 'ring_spots') {
      const dx = u / Math.max(0.02, module.rx);
      const dy = v / Math.max(0.02, module.ry);
      const radius = Math.sqrt(dx * dx + dy * dy);
      const width = 0.16 + roughness * 0.10;
      const distance = Math.abs(radius - 0.72);
      if (distance >= width) return 0;
      return 1 - distance / width;
    }

    if (id === 'diagonal_streak') {
      const halfWidth = Math.max(0.02, Number(module.rx || 0.08));
      const distance = Math.abs(u);
      if (distance >= halfWidth) return 0;
      const along = Math.abs(v) / Math.max(0.10, Number(module.ry || 0.55));
      if (along > 1) return 0;
      const waviness = 0.80 + 0.20 * Math.sin(
        v * Math.PI * 2 * frequency + phase
      );
      return (1 - distance / halfWidth)
        * (1 - along * 0.35)
        * ((1 - roughness) + roughness * Math.max(0, waviness));
    }

    // speckle_cluster
    const dx = u / Math.max(0.03, module.rx);
    const dy = v / Math.max(0.03, module.ry);
    if (dx * dx + dy * dy > 1) return 0;
    const cellSize = Math.max(2, Math.round(9 - frequency));
    const cellX = Math.floor(xPx / cellSize);
    const cellY = Math.floor(yPx / cellSize);
    const noise = seededUnit(
      Number(module.phase || 0) * 1000 + cellX * 31 + cellY * 101,
      41,
    );
    const threshold = 0.72 - roughness * 0.22;
    return noise > threshold
      ? Math.min(1, (noise - threshold) / (1 - threshold))
      : 0;
  }

  function renderGenome(genome) {
    const genetics = evolutionConfig.trait_genetics || {};
    const child = new ImageData(SIZE, SIZE);

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < HALF; x += 1) {
        if (!mask[y * SIZE + x]) continue;
        const alpha = templateAlpha[y * SIZE + x] || 255;
        const xNorm = x / Math.max(1, HALF - 1);
        const yNorm = y / Math.max(1, SIZE - 1);

        const smoothTexture =
          0.55 * Math.sin(
            x * 0.20
            + y * 0.055
            + Number(genome.textureSeed || 0) * 0.017
          )
          + 0.45 * Math.sin(
            y * 0.145
            - x * 0.035
            + Number(genome.textureSeed || 0) * 0.031
          );

        let hue = Number(genome.baseHue);
        let sat = Number(genome.baseSaturation);
        let value = Number(genome.baseValue)
          * (1 + smoothTexture * Number(genome.textureStrength || 0));

        for (const locus of genetics.pattern_loci || []) {
          const module = genome.modules[locus.id];
          if (!module) continue;
          const expression = locusExpression(locus, module.alleles || [0, 0]);
          if (expression <= 0) continue;

          const maskValue = moduleMaskValue(
            locus.id,
            module,
            xNorm,
            yNorm,
            x,
            y,
          );
          if (maskValue <= 0) continue;

          const amount = expression
            * Number(genome.patternContrast || 0)
            * maskValue;
          value += Number(module.valueEffect || 0) * amount;

          if (
            Number.isFinite(Number(module.pigmentHue))
            && Number.isFinite(Number(module.pigmentSaturation))
          ) {
            const colorMix = clamp01(
              amount
              * Number(genetics.pattern_pigment_mix_scale ?? 1.0)
            );
            hue = circularLerpDeg(
              hue,
              Number(module.pigmentHue),
              colorMix,
            );
            const patternSatCap = Number(
              genetics.pattern_pigment_saturation_cap ?? 0.30
            );
            const targetSat = clamp(
              Number(module.pigmentSaturation),
              0,
              patternSatCap,
            );
            sat += (targetSat - sat) * colorMix;
          } else {
            sat += Number(module.saturationEffect || 0) * amount;
            hue = (
              hue + Number(module.hueEffect || 0) * amount + 360
            ) % 360;
          }
        }

        value = clamp01(value);
        sat = clamp01(sat);
        const [r, g, b] = hsvToRgb(hue, sat, value);
        setPixelMirrored(child.data, x, y, [r, g, b, alpha]);
      }
    }

    return child;
  }

  async function evolveGenerationByGenome(generationId, eatenIndices) {
    await ensureConfig();
    await ensureMask();
    await ensureTemplateAlpha();

    const parentIndices = selectParents(eatenIndices);
    if (!parentIndices) return null;

    const uniqueParents = [...new Set(parentIndices)];
    const parentData = new Map();
    const parentGenomes = new Map();

    for (const index of uniqueParents) {
      const imageData = await parentImageData(generationId, index);
      parentData.set(index, imageData);
      parentGenomes.set(
        index,
        await loadGenomeOrInfer(generationId, index, imageData),
      );
    }

    const plan = buildPairingPlan(parentIndices);
    const nextId = nextGenerationId(generationId);
    const blobs = new Map();
    const genomes = new Map();

    for (const item of plan) {
      const genome = makeChildGenome(
        parentGenomes.get(item.parentA),
        parentGenomes.get(item.parentB),
        item.childIndex,
        nextId,
      );
      const child = renderGenome(genome);
      genomes.set(item.childIndex, genome);
      blobs.set(item.childIndex, await imageDataToBlob(child));

      if (item.childIndex % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    for (const [index, blob] of blobs.entries()) {
      await idbPut(IMAGE_STORE, imageKey(nextId, index), blob);
      await idbPut(META_STORE, genomeKey(nextId, index), genomes.get(index));
    }

    await idbPut(META_STORE, 'current_generation_id', nextId);
    await deleteGeneration(generationId);

    currentGenerationId = nextId;
    await loadGeneratedGeneration(nextId);
    return nextId;
  }

  async function evolveGeneration(generationId, eatenIndices) {
    if (String(evolutionConfig?.inheritance || '').startsWith('trait_')) {
      return evolveGenerationByGenome(generationId, eatenIndices);
    }
    return evolveGenerationLegacy(generationId, eatenIndices);
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

    const params = new URLSearchParams(location.search);
    let previewSeconds = Number(params.get('seconds'));
    if (
      !Number.isFinite(previewSeconds)
      || previewSeconds < 0.5
      || previewSeconds > 10
    ) {
      previewSeconds = params.get('fast') === '1' ? 0.5 : 4.0;
    }

    badge.innerHTML =
      '<span>SOLO PREVIEW · '
      + previewSeconds.toFixed(1)
      + 's</span>'
      + '<button type="button">テストをリセット</button>';
    Object.assign(badge.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      zIndex: '20',
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
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('gitai:request-reset'));
    });
    document.body.appendChild(badge);
  }

  window.GitaiPagesPreview = {
    fetch: apiFetch,
    resolveAsset,
    reset: clearDb,
    resetAll: resetAllPreviewData,
  };

  window.fetch = apiFetch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPreviewBadge, { once: true });
  } else {
    installPreviewBadge();
  }
})();
