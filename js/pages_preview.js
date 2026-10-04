(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const PREVIEW_QUERY = new URLSearchParams(location.search);

  function safeNamespaceId(value, fallback) {
    const raw = String(value || '').trim();
    return /^[a-z0-9_-]{1,48}$/i.test(raw) ? raw : fallback;
  }

  function resolveEnvironmentId(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw || raw === 'bark') return 'bark_001';
    if (raw === 'sand') return 'sand_001';
    return safeNamespaceId(raw, 'bark_001');
  }

  const PREVIEW_ENV_ID = resolveEnvironmentId(PREVIEW_QUERY.get('env'));
  const PREVIEW_ENV = PREVIEW_ENV_ID === 'sand_001'
    ? 'sand'
    : (
      PREVIEW_ENV_ID === 'bark_001'
        ? 'bark'
        : PREVIEW_ENV_ID
    );
  const EVOLUTION_MODEL_ID = safeNamespaceId(
    PREVIEW_QUERY.get('model'),
    'continuous_v1',
  );
  const PREVIEW_RUN_ID = safeNamespaceId(
    PREVIEW_QUERY.get('run'),
    'default',
  );

  const LEGACY_DEFAULT_STORAGE = (
    EVOLUTION_MODEL_ID === 'continuous_v1'
    && PREVIEW_RUN_ID === 'default'
    && (
      PREVIEW_ENV_ID === 'bark_001'
      || PREVIEW_ENV_ID === 'sand_001'
    )
  );

  // Keep existing testers' bark/sand data alive. New model/run combinations
  // use the fully namespaced v3 store.
  const DB_NAME = LEGACY_DEFAULT_STORAGE
    ? (
      PREVIEW_ENV_ID === 'sand_001'
        ? 'gitai-pages-preview-v2-sand'
        : 'gitai-pages-preview-v2'
    )
    : [
      'gitai-pages-preview-v3',
      PREVIEW_ENV_ID,
      EVOLUTION_MODEL_ID,
      PREVIEW_RUN_ID,
    ].join('-');

  const DB_VERSION = 2;
  const IMAGE_STORE = 'images';
  const META_STORE = 'meta';
  const THEATER_STORE = 'theater_frames';
  const THEATER_FRAME_WIDTH = 600;
  const THEATER_FRAME_HEIGHT = 1000;
  const THEATER_COLUMNS = 6;
  const THEATER_ROWS = 10;
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
        if (!db.objectStoreNames.contains(THEATER_STORE)) {
          db.createObjectStore(THEATER_STORE);
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

  async function idbEntriesByPrefix(storeName, prefix) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const key = String(cursor.key);
        if (key.startsWith(prefix)) {
          out.push({ key, value: cursor.value });
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  function diagnosticKey(generationId) {
    return `diagnostic:${generationId}`;
  }

  function diagnosticNumber(value, digits = 5) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** digits;
    return Math.round(n * factor) / factor;
  }

  function diagnosticPatternSummary(genome, genetics) {
    const patterns = [];
    for (const locus of genetics.pattern_loci || []) {
      const module = genome.modules?.[locus.id];
      if (!module) continue;
      const expression = locusExpression(
        locus,
        module.alleles || [0, 0],
      );
      if (expression <= 0) continue;
      patterns.push({
        id: locus.id,
        dominance: locus.dominance,
        alleles: [...(module.alleles || [0, 0])],
        expression: diagnosticNumber(expression, 3),
        pigment_hue: diagnosticNumber(module.pigmentHue, 2),
        pigment_saturation: diagnosticNumber(module.pigmentSaturation, 4),
        value_effect: diagnosticNumber(module.valueEffect, 4),
        cx: diagnosticNumber(module.cx, 4),
        cy: diagnosticNumber(module.cy, 4),
        rx: diagnosticNumber(module.rx, 4),
        ry: diagnosticNumber(module.ry, 4),
        angle: diagnosticNumber(module.angle, 3),
        frequency: diagnosticNumber(module.frequency, 4),
        roughness: diagnosticNumber(module.roughness, 4),
      });
    }
    return patterns;
  }


  async function collectDiagnosticPayload() {
    await ensureConfig();
    const entries = await idbEntriesByPrefix(META_STORE, 'diagnostic:');
    const generations = entries
      .map((item) => item.value)
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => (
        generationNumber(a.generation_id)
        - generationNumber(b.generation_id)
      ));

    return {
      schema: 'gitailab-preview-diagnostic-v1',
      schema_version: 1,
      exported_at: new Date().toISOString(),
      environment: {
        preview_env: PREVIEW_ENV,
        environment_id:
          environmentConfig?.environment_id || PREVIEW_ENV_ID,
        display_name_ja: environmentConfig?.display_name_ja || null,
      },
      run: {
        run_id: PREVIEW_RUN_ID,
        storage_namespace: DB_NAME,
        legacy_default_storage: LEGACY_DEFAULT_STORAGE,
      },
      evolution: {
        model_id: evolutionConfig?.model_id || EVOLUTION_MODEL_ID,
        model_display_name_ja:
          evolutionConfig?.model_display_name_ja || null,
        config_id: evolutionConfig?.config_id || null,
        engine_version: evolutionConfig?.engine_version || null,
        inheritance: evolutionConfig?.inheritance || null,
        parent_selection: evolutionConfig?.parent_selection || null,
        parent_pool_size: evolutionConfig?.parent_pool_size || null,
        trait_genetics: evolutionConfig?.trait_genetics || null,
        morph_genetics: evolutionConfig?.morph_genetics || null,
        founder_set_id:
          evolutionConfig?.founder_model?.founder_set_id || null,
        founder_seed:
          evolutionConfig?.founder_model?.founder_seed || null,
      },
      game: {
        round_time_ms: Number(appConfig?.game?.round_time_ms || 0),
        rounds_per_generation: Number(
          appConfig?.game?.rounds_per_generation || 0
        ),
        individuals_per_round: Number(
          appConfig?.game?.individuals_per_round || 0
        ),
        population_size: TOTAL,
      },
      current_generation_id: currentGenerationId,
      recorded_generation_count: generations.length,
      note: generations.length
        ? 'Diagnostic recording starts from the first generation evolved after this feature was installed.'
        : 'No evolved generations have been recorded on this device/environment yet.',
      generations,
    };
  }

  async function exportDiagnosticLog() {
    const payload = await collectDiagnosticPayload();
    const json = JSON.stringify(payload, null, 2);
    const env = PREVIEW_ENV_ID;
    const model = EVOLUTION_MODEL_ID;
    const run = PREVIEW_RUN_ID;
    const current = String(currentGenerationId || 'gen00001');
    const filename =
      `gitailab_log_${env}_${model}_${run}_${current}.json`;
    const file = new File([json], filename, {
      type: 'application/json',
    });

    if (
      navigator.share
      && navigator.canShare
      && navigator.canShare({ files: [file] })
    ) {
      await navigator.share({
        title: 'ギタイラボ 診断ログ',
        text: 'ギタイラボPreviewの進化診断ログです。',
        files: [file],
      });
      return;
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function compactNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    const rounded = Number(n.toFixed(digits));
    return Object.is(rounded, -0) ? '0' : String(rounded);
  }

  function hueSectorCode(value, saturation = 1) {
    const s = Number(saturation);
    if (!Number.isFinite(s) || s < 0.04) return 'A';
    const h = ((Number(value) % 360) + 360) % 360;
    if (h < 30 || h >= 330) return 'R';
    if (h < 90) return 'Y';
    if (h < 170) return 'G';
    if (h < 210) return 'C';
    if (h < 270) return 'B';
    return 'M';
  }

  function compactPopulationSummary(offspring) {
    const finals = (offspring || [])
      .map((child) => child?.final)
      .filter(Boolean);
    if (!finals.length) return 'population=unavailable';

    let sSum = 0;
    let vSum = 0;
    const sectors = {
      A: 0, R: 0, Y: 0, G: 0, C: 0, B: 0, M: 0,
    };

    for (const final of finals) {
      const sat = Number(final.saturation || 0);
      sSum += sat;
      vSum += Number(final.value || 0);
      sectors[hueSectorCode(final.hue, sat)] += 1;
    }

    const n = finals.length;
    return [
      'n=' + n,
      'Savg=' + compactNumber(sSum / n, 3),
      'Vavg=' + compactNumber(vSum / n, 3),
      'H[A/R/Y/G/C/B/M]='
        + [
          sectors.A,
          sectors.R,
          sectors.Y,
          sectors.G,
          sectors.C,
          sectors.B,
          sectors.M,
        ].join('/'),
    ].join(' ');
  }

  function compactMutationCounts(offspring) {
    const counts = new Map();
    const add = (key) => {
      const label = String(key || 'unknown');
      counts.set(label, (counts.get(label) || 0) + 1);
    };

    for (const child of offspring || []) {
      for (const event of child?.mutations || []) {
        add(event?.type);
      }
      if (child?.pattern_birth) add('pattern_birth');
      for (const event of child?.pattern_mutations || []) {
        if (event?.allele_changed) add('pattern_allele_change');
        if (event?.geometry_mutated) add('pattern_geometry');
        if (event?.saturation_mutated) add('pattern_saturation');
        if (event?.major_hue_mutated) add('pattern_hue_major');
      }
    }

    if (!counts.size) return 'none';
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => key + ':' + count)
      .join(',');
  }

  function morphFingerprint(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const fields = [
      snapshot.dominance_rank,
      snapshot.ground_hue,
      snapshot.ground_saturation,
      snapshot.ground_value,
      snapshot.pattern_id,
      snapshot.pattern_hue,
      snapshot.pattern_saturation,
      snapshot.pattern_contrast,
      snapshot.texture_strength,
      snapshot.pattern_seed,
      snapshot.texture_seed,
    ];
    return JSON.stringify(fields);
  }

  function buildMorphRegistry(generations) {
    const byFingerprint = new Map();
    const snapshots = new Map();
    let sequence = 0;

    const register = (snapshot) => {
      const fingerprint = morphFingerprint(snapshot);
      if (!fingerprint) return null;
      if (!byFingerprint.has(fingerprint)) {
        sequence += 1;
        const id = 'M' + String(sequence).padStart(3, '0');
        byFingerprint.set(fingerprint, id);
        snapshots.set(id, snapshot);
      }
      return byFingerprint.get(fingerprint);
    };

    for (const record of generations || []) {
      for (const child of record?.offspring || []) {
        register(child?.expressed_morph);
        for (const event of child?.mutations || []) {
          register(event?.before);
          register(event?.after);
        }
      }
    }

    return { register, byFingerprint, snapshots };
  }

  function compactMorphSnapshot(snapshot) {
    if (!snapshot) return '-';
    return [
      'H' + compactNumber(snapshot.ground_hue, 0),
      'S' + compactNumber(snapshot.ground_saturation, 2),
      'V' + compactNumber(snapshot.ground_value, 2),
      'P=' + String(snapshot.pattern_id || 'none'),
      'PH' + compactNumber(snapshot.pattern_hue, 0),
      'PS' + compactNumber(snapshot.pattern_saturation, 2),
      'D' + compactNumber(snapshot.dominance_rank, 0),
    ].join('/');
  }

  function compactContinuousEvent(event) {
    const type = String(event?.type || 'mutation');
    if (type === 'base_hue_major') {
      return 'Hmajor '
        + compactNumber(event.before, 0)
        + '>'
        + compactNumber(event.after, 0)
        + '('
        + compactNumber(event.signed_jump_deg, 0)
        + 'deg)';
    }
    if (type === 'base_value_major') {
      return 'Vmajor '
        + compactNumber(event.before, 2)
        + '>'
        + compactNumber(event.after, 2)
        + (event.dark_bias_branch ? '[dark]' : '');
    }
    if (type === 'pigment_expression') {
      return 'pigment '
        + compactNumber(event.before, 2)
        + '>'
        + compactNumber(event.after, 2)
        + '@H'
        + compactNumber(event.hue_revealed, 0);
    }
    return type;
  }

  function notableContinuousEvents(child) {
    const out = [];
    for (const event of child?.mutations || []) {
      if (
        event?.type === 'base_hue_major'
        || event?.type === 'base_value_major'
        || event?.type === 'pigment_expression'
      ) {
        out.push(compactContinuousEvent(event));
      }
    }

    if (child?.pattern_birth) {
      out.push(
        'Pbirth=' + String(child.pattern_birth.locus || 'unknown')
      );
    }

    for (const event of child?.pattern_mutations || []) {
      const locus = String(event?.locus || 'pattern');
      if (event?.allele_changed) out.push('Pallele=' + locus);
      if (event?.major_hue_mutated) out.push('PHmajor=' + locus);
      if (event?.saturation_mutated) out.push('PSat=' + locus);
    }
    return out;
  }

  function nextGenerationOutcome(recordById, nextGenerationId, childIndex) {
    const next = recordById.get(nextGenerationId);
    if (!next) return 'next=?';

    const eaten = new Set(next.eaten_indices || []);
    const selected = (next.selected_parent_pool || [])
      .filter((index) => Number(index) === Number(childIndex))
      .length;

    return 'next='
      + (eaten.has(Number(childIndex)) ? 'EATEN' : 'SURVIVED')
      + '/parentSlots='
      + selected;
  }

  function buildChatGPTDiagnosticTextFromPayload(payload) {
    const generations = payload.generations || [];
    const recordById = new Map(
      generations.map((record) => [record.generation_id, record])
    );
    const isMorph = payload.evolution?.model_id === 'morph_v1';
    const morphRegistry = isMorph
      ? buildMorphRegistry(generations)
      : null;

    const lines = [
      'GITAI_LAB_CHATGPT_LOG_V1',
      'environment='
        + String(payload.environment?.environment_id || '-'),
      'model=' + String(payload.evolution?.model_id || '-'),
      'config=' + String(payload.evolution?.config_id || '-'),
      'run=' + String(payload.run?.run_id || '-'),
      'founder=' + String(payload.evolution?.founder_set_id || '-'),
      'current=' + String(payload.current_generation_id || '-'),
      'recorded_generations=' + generations.length,
      'NOTE: Each record describes selection in generation G and the offspring generated as G+1.',
      'NOTE: For mutation lines, next=... is the fate of that child when G+1 was actually played.',
      'H sectors: A=achromatic,R=red,Y=yellow/orange,G=green,C=cyan,B=blue,M=magenta/purple.',
      '',
    ];

    for (const record of generations) {
      const generationId = String(record.generation_id || '-');
      const nextId = String(record.next_generation_id || '-');
      const selectedParents = (record.selected_parent_pool || [])
        .map((value) => Number(value))
        .join(',');
      const uniqueParents = (record.unique_selected_parents || [])
        .map((value) => Number(value))
        .join(',');

      lines.push(
        '[' + generationId + '>' + nextId + '] '
        + 'eaten=' + (record.eaten_indices || []).length
        + ' survivors=' + Number(record.survivor_count || 0)
      );
      lines.push(
        'parents=[' + selectedParents + '] '
        + 'unique=[' + uniqueParents + ']'
      );
      lines.push(
        'offspring ' + compactPopulationSummary(record.offspring)
      );
      lines.push(
        'mutation_counts=' + compactMutationCounts(record.offspring)
      );

      if (isMorph && morphRegistry) {
        const composition = new Map();
        for (const child of record.offspring || []) {
          const id = morphRegistry.register(child?.expressed_morph);
          if (!id) continue;
          composition.set(id, (composition.get(id) || 0) + 1);
        }
        const compositionText = [...composition.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([id, count]) => id + 'x' + count)
          .join(' ');
        lines.push('expressed_morphs=' + (compositionText || 'none'));

        const eventLines = [];
        for (const child of record.offspring || []) {
          const mutations = child?.mutations || [];
          if (!mutations.length) continue;

          const expressedId = morphRegistry.register(
            child?.expressed_morph
          );
          for (const event of mutations) {
            const beforeId = morphRegistry.register(event?.before);
            const afterId = morphRegistry.register(event?.after);
            const expressed = (
              morphFingerprint(event?.after)
              === morphFingerprint(child?.expressed_morph)
            );
            eventLines.push(
              ' c'
              + String(child.child_index).padStart(2, '0')
              + ' '
              + String(event?.type || 'morph_mutation')
              + ' '
              + (beforeId || '?')
              + '>'
              + (afterId || '?')
              + ' expressed='
              + (expressed ? 'yes' : 'no')
              + ' final='
              + (expressedId || '?')
              + ' '
              + compactMorphSnapshot(event?.after)
              + ' '
              + nextGenerationOutcome(
                recordById,
                nextId,
                child.child_index,
              )
            );
          }
        }
        if (eventLines.length) {
          lines.push('events:');
          lines.push(...eventLines);
        }
      } else {
        const eventLines = [];
        for (const child of record.offspring || []) {
          const notable = notableContinuousEvents(child);
          if (!notable.length) continue;
          const final = child?.final || {};
          eventLines.push(
            ' c'
            + String(child.child_index).padStart(2, '0')
            + ' '
            + notable.join(';')
            + ' final=H'
            + compactNumber(final.hue, 0)
            + '/S'
            + compactNumber(final.saturation, 2)
            + '/V'
            + compactNumber(final.value, 2)
            + ' '
            + nextGenerationOutcome(
              recordById,
              nextId,
              child.child_index,
            )
          );
        }
        if (eventLines.length) {
          lines.push('notable_events:');
          lines.push(...eventLines);
        }
      }

      lines.push('');
    }

    if (isMorph && morphRegistry) {
      lines.push('MORPH_DICTIONARY');
      for (const [id, snapshot] of morphRegistry.snapshots.entries()) {
        lines.push(id + '=' + compactMorphSnapshot(snapshot));
      }
      lines.push('');
    }

    lines.push('END_GITAI_LAB_CHATGPT_LOG_V1');
    return lines.join('\n');
  }

  async function buildChatGPTDiagnosticText() {
    const payload = await collectDiagnosticPayload();
    return buildChatGPTDiagnosticTextFromPayload(payload);
  }

  function closeChatGPTCopyDialog() {
    const existing = document.getElementById('gitaiChatGPTLogDialog');
    if (existing) existing.remove();
  }

  function showChatGPTCopyDialog(text) {
    closeChatGPTCopyDialog();

    const overlay = document.createElement('div');
    overlay.id = 'gitaiChatGPTLogDialog';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '99999',
      display: 'grid',
      placeItems: 'center',
      padding: '18px',
      background: 'rgba(0,0,0,.84)',
      fontFamily: 'monospace',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(94vw, 560px)',
      maxHeight: '88dvh',
      overflow: 'auto',
      padding: '16px',
      border: '1px solid rgba(184,247,255,.42)',
      borderRadius: '14px',
      background: '#0a0d0f',
      color: '#fff',
      boxShadow: '0 12px 40px rgba(0,0,0,.55)',
    });

    const title = document.createElement('div');
    title.textContent = 'ChatGPT用 診断ログ';
    Object.assign(title.style, {
      marginBottom: '10px',
      fontSize: '16px',
      color: '#b8f7ff',
    });

    const info = document.createElement('div');
    info.textContent =
      '解析用に圧縮したログです（'
      + text.length.toLocaleString('ja-JP')
      + '文字）。「コピーする」→ ChatGPTに貼り付けて送信してください。';
    Object.assign(info.style, {
      marginBottom: '12px',
      fontSize: '12px',
      lineHeight: '1.6',
      color: 'rgba(255,255,255,.78)',
    });

    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.readOnly = true;
    fallback.setAttribute('aria-label', 'ChatGPT用診断ログ');
    Object.assign(fallback.style, {
      display: 'none',
      width: '100%',
      height: '42dvh',
      marginBottom: '10px',
      padding: '10px',
      border: '1px solid rgba(255,255,255,.24)',
      borderRadius: '8px',
      background: '#050708',
      color: '#fff',
      font: '11px/1.45 monospace',
      userSelect: 'text',
      WebkitUserSelect: 'text',
    });

    const status = document.createElement('div');
    status.textContent = '';
    Object.assign(status.style, {
      minHeight: '20px',
      marginBottom: '8px',
      fontSize: '12px',
      lineHeight: '1.5',
      color: '#b8f7ff',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'コピーする';

    for (const button of [closeButton, copyButton]) {
      Object.assign(button.style, {
        minHeight: '46px',
        border: '1px solid rgba(184,247,255,.48)',
        borderRadius: '9px',
        background: 'rgba(184,247,255,.12)',
        color: '#fff',
        font: '13px monospace',
      });
    }

    closeButton.addEventListener('click', closeChatGPTCopyDialog);
    copyButton.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(text);
        status.textContent =
          'コピーしました。ChatGPTの入力欄で「ペースト」して送信してください。';
        fallback.style.display = 'none';
        copyButton.textContent = 'もう一度コピー';
      } catch (error) {
        console.error(error);
        status.textContent =
          '自動コピーできませんでした。下の文字を長押しして「すべて選択」→「コピー」してください。';
        fallback.style.display = 'block';
        fallback.focus();
        fallback.select();
        fallback.setSelectionRange(0, fallback.value.length);
      }
    });

    actions.append(closeButton, copyButton);
    panel.append(title, info, fallback, status, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  async function prepareChatGPTDiagnosticCopy() {
    const text = await buildChatGPTDiagnosticText();
    showChatGPTCopyDialog(text);
  }


  let theaterBackgroundPromise = null;

  function theaterModelLabel() {
    return EVOLUTION_MODEL_ID === 'morph_v1'
      ? '教育型'
      : 'エンタメ型';
  }

  function canvasToBlob(canvas, type = 'image/webp', quality = 0.78) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('進化シアター画像の生成に失敗しました'));
      }, type, quality);
    });
  }

  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(
        new Error('画像を読み込めません: ' + url)
      );
      img.src = url;
    });
  }

  async function loadTheaterBackground() {
    await ensureConfig();
    if (!theaterBackgroundPromise) {
      const src = String(
        environmentConfig?.background?.src
        || appConfig?.environment?.background?.src
        || ''
      );
      theaterBackgroundPromise = loadImageElement(baseUrl(src))
        .catch((error) => {
          theaterBackgroundPromise = null;
          throw error;
        });
    }
    return theaterBackgroundPromise;
  }

  function drawImageCover(ctx, image, x, y, width, height) {
    const iw = Number(image.naturalWidth || image.width || 1);
    const ih = Number(image.naturalHeight || image.height || 1);
    const scale = Math.max(width / iw, height / ih);
    const sw = width / scale;
    const sh = height / scale;
    const sx = Math.max(0, (iw - sw) / 2);
    const sy = Math.max(0, (ih - sh) / 2);
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }

  async function drawBlobToCanvas(ctx, blob, x, y, width, height) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      try {
        ctx.drawImage(bitmap, x, y, width, height);
      } finally {
        if (bitmap.close) bitmap.close();
      }
      return;
    }

    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImageElement(url);
      ctx.drawImage(img, x, y, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderTheaterFrameBlob(generationId) {
    await ensureConfig();

    const blobs = [];
    for (let index = 1; index <= TOTAL; index += 1) {
      const blob = await idbGet(
        IMAGE_STORE,
        imageKey(generationId, index),
      );
      if (!(blob instanceof Blob)) {
        return null;
      }
      blobs.push(blob);
    }

    const canvas = document.createElement('canvas');
    canvas.width = THEATER_FRAME_WIDTH;
    canvas.height = THEATER_FRAME_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    try {
      const background = await loadTheaterBackground();
      drawImageCover(
        ctx,
        background,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } catch (_) {
      ctx.fillStyle = '#182019';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const headerHeight = 92;
    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    const generation = generationNumber(generationId);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 31px "PixelMplus", monospace';
    ctx.fillText(
      '第' + generation + '世代',
      22,
      34,
    );

    ctx.fillStyle = '#b8f7ff';
    ctx.font = '20px "PixelMplus", monospace';
    ctx.fillText(
      theaterModelLabel(),
      22,
      68,
    );

    const gridTop = headerHeight + 8;
    const gridHeight = canvas.height - gridTop - 8;
    const cellWidth = canvas.width / THEATER_COLUMNS;
    const cellHeight = gridHeight / THEATER_ROWS;
    const mothSize = Math.floor(
      Math.min(cellWidth * 0.78, cellHeight * 0.82)
    );

    for (let i = 0; i < blobs.length; i += 1) {
      const col = i % THEATER_COLUMNS;
      const row = Math.floor(i / THEATER_COLUMNS);
      const cellX = col * cellWidth;
      const cellY = gridTop + row * cellHeight;
      const x = Math.round(
        cellX + (cellWidth - mothSize) / 2
      );
      const y = Math.round(
        cellY + (cellHeight - mothSize) / 2
      );

      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(cellX) + 0.5,
        Math.round(cellY) + 0.5,
        Math.round(cellWidth) - 1,
        Math.round(cellHeight) - 1,
      );

      await drawBlobToCanvas(
        ctx,
        blobs[i],
        x,
        y,
        mothSize,
        mothSize,
      );
    }

    try {
      return await canvasToBlob(canvas, 'image/webp', 0.78);
    } catch (_) {
      return canvasToBlob(canvas, 'image/png');
    }
  }

  async function ensureTheaterSnapshot(generationId, stats = {}) {
    if (!generationId || !/^gen\d{5}$/.test(generationId)) {
      return null;
    }

    const existing = await idbGet(THEATER_STORE, generationId);
    let imageBlob = existing?.image_blob;

    if (!(imageBlob instanceof Blob)) {
      imageBlob = await renderTheaterFrameBlob(generationId);
      if (!(imageBlob instanceof Blob)) return null;
    }

    const eatenCount = Number.isFinite(Number(stats.eatenCount))
      ? Number(stats.eatenCount)
      : (
        Number.isFinite(Number(existing?.eaten_count))
          ? Number(existing.eaten_count)
          : null
      );
    const survivorCount = Number.isFinite(Number(stats.survivorCount))
      ? Number(stats.survivorCount)
      : (
        Number.isFinite(Number(existing?.survivor_count))
          ? Number(existing.survivor_count)
          : null
      );

    const record = {
      schema_version: 1,
      generation_id: generationId,
      generation_number: generationNumber(generationId),
      environment_id:
        environmentConfig?.environment_id || PREVIEW_ENV_ID,
      evolution_model_id: EVOLUTION_MODEL_ID,
      model_label_ja: theaterModelLabel(),
      preview_run_id: PREVIEW_RUN_ID,
      eaten_count: eatenCount,
      survivor_count: survivorCount,
      image_blob: imageBlob,
      captured_at:
        existing?.captured_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await idbPut(THEATER_STORE, generationId, record);
    return record;
  }

  async function getEvolutionTheaterFrames() {
    await ensureConfig();
    const entries = await idbEntriesByPrefix(THEATER_STORE, 'gen');
    return entries
      .map((item) => item.value)
      .filter((item) => (
        item
        && item.image_blob instanceof Blob
        && /^gen\d{5}$/.test(String(item.generation_id || ''))
      ))
      .sort(
        (a, b) => (
          Number(a.generation_number)
          - Number(b.generation_number)
        )
      );
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
        if (!key) continue;

        const legacyLeaderboardPrefix =
          `gitai-preview-leaderboard-v4-solo-${PREVIEW_ENV_ID}-`;
        const namespacedLeaderboardPrefix = [
          'gitai-preview-leaderboard-v5-solo',
          PREVIEW_ENV_ID,
          EVOLUTION_MODEL_ID,
          PREVIEW_RUN_ID,
          '',
        ].join('-');

        if (
          (LEGACY_DEFAULT_STORAGE
            && key.startsWith(legacyLeaderboardPrefix))
          || key.startsWith(namespacedLeaderboardPrefix)
        ) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}

    const u = new URL(location.href);
    u.searchParams.delete('v');
    const query = u.searchParams.toString();
    location.href = u.pathname + (query ? '?' + query : '');
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

    const params = new URLSearchParams(location.search);
    const environmentPath =
      `environments/${PREVIEW_ENV_ID}/environment.json`;
    const evolutionPath =
      `data/evolution_models/${EVOLUTION_MODEL_ID}/config.json`;

    environmentConfig = await loadJson(environmentPath);
    evolutionConfig = await loadJson(evolutionPath);

    const loadedModelId = String(
      evolutionConfig.model_id || EVOLUTION_MODEL_ID
    );
    if (loadedModelId !== EVOLUTION_MODEL_ID) {
      throw new Error(
        `進化モデルIDが一致しません: ${loadedModelId}`
      );
    }

    appConfig = JSON.parse(JSON.stringify(appConfig));
    appConfig.mode = 'pages_preview';
    appConfig.environment_config = environmentPath;
    appConfig.evolution_config = evolutionPath;
    appConfig.evolution_model_id = EVOLUTION_MODEL_ID;
    appConfig.preview_run_id = PREVIEW_RUN_ID;
    appConfig.title = `${appConfig.title} — Pages Preview`;
    appConfig.network = {
      ...(appConfig.network || {}),
      submit_timeout_ms: 120000,
    };

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
      usesBrowserGeneratedFounder()
      && currentGenerationId === 'gen00001'
    ) {
      await ensureFounderGeneration();
    }

    let loaded = await loadGeneratedGeneration(currentGenerationId);
    if (!loaded) {
      currentGenerationId = 'gen00001';
      if (usesBrowserGeneratedFounder()) {
        await ensureFounderGeneration();
      }
      await idbPut(META_STORE, 'current_generation_id', currentGenerationId);
      loaded = await loadGeneratedGeneration(currentGenerationId);
    }

    if (!loaded) {
      throw new Error('第1世代の生成に失敗しました');
    }

    // Evolution Theater snapshots are lightweight contact sheets.
    // Gen1 is retained permanently, so existing runs can at least show
    // Gen1 + the current generation after this feature is introduced.
    await ensureTheaterSnapshot('gen00001').catch(console.error);
    if (currentGenerationId !== 'gen00001') {
      await ensureTheaterSnapshot(currentGenerationId)
        .catch(console.error);
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

  function hashString32(value) {
    let h = 2166136261 >>> 0;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeSeededRng(seedValue) {
    let state = hashString32(seedValue) || 0x6d2b79f5;
    return () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function inheritLinear(a, b, rng = Math.random) {
    const lo = Math.min(Number(a), Number(b));
    const hi = Math.max(Number(a), Number(b));
    return lo + rng() * (hi - lo);
  }

  function mutateAllele(value, genetics, rng = Math.random) {
    let allele = value ? 1 : 0;
    if (
      allele === 0
      && rng() < Number(genetics.pattern_allele_gain_p || 0)
    ) {
      allele = 1;
    } else if (
      allele === 1
      && rng() < Number(genetics.pattern_allele_loss_p || 0)
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

    if (id === 'chevron_pair') {
      return {
        cx: 0.50,
        cy: clamp(0.48 + j(81, 0.16), 0.20, 0.78),
        rx: 0.50,
        ry: clamp(0.055 + j(82, 0.025), 0.025, 0.12),
        valueEffect: clamp(-0.18 + j(83, 0.18), -0.48, 0.38),
        hueEffect: j(84, 24),
        saturationEffect: j(85, 0.13),
        phase,
        angle: clamp(32 + j(86, 20), 8, 68),
        frequency: clamp(1.2 + j(87, 0.35), 0.7, 2.2),
        roughness: clamp(0.16 + j(88, 0.10), 0, 0.5),
      };
    }

    if (id === 'twin_spots') {
      return {
        cx: clamp(0.50 + j(91, 0.24), 0.18, 0.86),
        cy: clamp(0.52 + j(92, 0.22), 0.18, 0.84),
        rx: clamp(0.11 + j(93, 0.05), 0.04, 0.22),
        ry: clamp(0.09 + j(94, 0.045), 0.035, 0.20),
        valueEffect: clamp(-0.20 + j(95, 0.22), -0.52, 0.44),
        hueEffect: j(96, 28),
        saturationEffect: j(97, 0.15),
        phase,
        angle: j(98, 35),
        frequency: 1,
        roughness: clamp(0.12 + j(99, 0.10), 0, 0.45),
      };
    }

    if (id === 'ripple_bands') {
      return {
        cx: 0.50,
        cy: clamp(0.52 + j(101, 0.10), 0.28, 0.72),
        rx: 0.50,
        ry: 0.50,
        valueEffect: clamp(-0.14 + j(102, 0.20), -0.44, 0.42),
        hueEffect: j(103, 24),
        saturationEffect: j(104, 0.14),
        phase,
        angle: clamp(j(105, 16), -30, 30),
        frequency: clamp(4.0 + j(106, 1.8), 1.8, 8.0),
        roughness: clamp(0.24 + j(107, 0.16), 0, 0.65),
      };
    }

    if (id === 'radial_rays') {
      return {
        cx: clamp(0.90 + j(111, 0.08), 0.72, 0.98),
        cy: clamp(0.28 + j(112, 0.10), 0.10, 0.46),
        rx: 0.50,
        ry: 0.58,
        valueEffect: clamp(-0.16 + j(113, 0.20), -0.46, 0.42),
        hueEffect: j(114, 26),
        saturationEffect: j(115, 0.15),
        phase,
        angle: j(116, 18),
        frequency: clamp(5.0 + j(117, 1.8), 2.2, 9.0),
        roughness: clamp(0.20 + j(118, 0.14), 0, 0.60),
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

  function inheritModule(parentA, parentB, locus, genetics, childSeed, diagnosticEvents = null, rng = Math.random) {
    const a = parentA.modules[locus.id]
      || { alleles: [0, 0], ...defaultModuleParams(locus.id, childSeed + 1) };
    const b = parentB.modules[locus.id]
      || { alleles: [0, 0], ...defaultModuleParams(locus.id, childSeed + 2) };

    const alleleAIndex = Math.floor(rng() * 2);
    const alleleBIndex = Math.floor(rng() * 2);
    const inheritedA = a.alleles[alleleAIndex] || 0;
    const inheritedB = b.alleles[alleleBIndex] || 0;
    const childAlleleA = mutateAllele(inheritedA, genetics, rng);
    const childAlleleB = mutateAllele(inheritedB, genetics, rng);
    let geometryMutated = false;
    let saturationMutated = false;
    let majorPatternHueMutated = false;
    const inheritedPigmentHueA = Number(a.pigmentHue);
    const inheritedPigmentHueB = Number(b.pigmentHue);

    const chooseNumber = (key, fallback) => {
      const av = Number(a[key] ?? fallback);
      const bv = Number(b[key] ?? fallback);
      if (childAlleleA && childAlleleB) return inheritLinear(av, bv, rng);
      if (childAlleleA) return av;
      if (childAlleleB) return bv;
      return rng() < 0.5 ? av : bv;
    };

    const chooseCircularPhase = () => {
      const av = Number(a.phase || 0);
      const bv = Number(b.phase || 0);
      if (childAlleleA && !childAlleleB) return av;
      if (!childAlleleA && childAlleleB) return bv;
      return rng() < 0.5 ? av : bv;
    };

    const chooseHue = (key, fallback) => {
      const av = Number(a[key] ?? fallback);
      const bv = Number(b[key] ?? fallback);
      if (childAlleleA && childAlleleB) {
        return circularLerpDeg(av, bv, rng());
      }
      if (childAlleleA) return av;
      if (childAlleleB) return bv;
      return rng() < 0.5 ? av : bv;
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
      && rng()
      < Number(genetics.pattern_parameter_mutation_p || 0)
    ) {
      geometryMutated = true;
      const posStep = Number(genetics.pattern_position_step || 0.025);
      const sizeStep = Number(genetics.pattern_size_step || 0.04);
      const effectStep = Number(genetics.pattern_effect_step || 0.04);
      const angleStep = Number(genetics.pattern_angle_step_deg || 10);
      const frequencyStep = Number(genetics.pattern_frequency_step || 0.35);
      const roughnessStep = Number(genetics.pattern_roughness_step || 0.08);

      module.cx = clamp(module.cx + (rng() * 2 - 1) * posStep, 0.06, 0.94);
      module.cy = clamp(module.cy + (rng() * 2 - 1) * posStep, 0.08, 0.92);
      module.rx = clamp(module.rx + (rng() * 2 - 1) * sizeStep, 0.03, 0.55);
      module.ry = clamp(module.ry + (rng() * 2 - 1) * sizeStep, 0.03, 0.58);
      module.valueEffect = clamp(
        module.valueEffect + (rng() * 2 - 1) * effectStep,
        -0.65,
        0.50,
      );
      module.hueEffect = clamp(
        module.hueEffect + (rng() * 2 - 1) * effectStep * 140,
        -80,
        80,
      );
      module.saturationEffect = clamp(
        module.saturationEffect + (rng() * 2 - 1) * effectStep,
        -0.38,
        0.38,
      );
      module.angle = clamp(
        module.angle + (rng() * 2 - 1) * angleStep,
        -90,
        90,
      );
      module.frequency = clamp(
        module.frequency + (rng() * 2 - 1) * frequencyStep,
        0.5,
        9,
      );
      module.roughness = clamp01(
        module.roughness + (rng() * 2 - 1) * roughnessStep,
      );

      const pigmentHueStep = Number(
        genetics.pattern_pigment_hue_step_deg ?? 24
      );
      module.pigmentHue = (
        Number(module.pigmentHue || 0)
        + (rng() * 2 - 1) * pigmentHueStep
        + 360
      ) % 360;
    }

    if (
      dosage > 0
      && rng()
      < Number(genetics.pattern_pigment_saturation_mutation_p || 0)
    ) {
      saturationMutated = true;
      const pigmentSatStep = Number(
        genetics.pattern_pigment_saturation_step ?? 0.07
      );
      const pigmentSatCap = Number(
        genetics.pattern_pigment_saturation_cap ?? 0.85
      );
      module.pigmentSaturation = clamp(
        Number(module.pigmentSaturation || 0)
        + (rng() * 2 - 1) * pigmentSatStep,
        0,
        pigmentSatCap,
      );
    }

    if (
      dosage > 0
      && rng()
      < Number(genetics.pattern_pigment_global_hue_mutation_p || 0)
    ) {
      majorPatternHueMutated = true;
      const minJump = Number(
        genetics.pattern_pigment_global_min_jump_deg ?? 70
      );
      const maxJump = Math.max(
        minJump,
        Number(genetics.pattern_pigment_global_max_jump_deg ?? 180),
      );
      const jump = minJump + rng() * (maxJump - minJump);
      const sign = rng() < 0.5 ? -1 : 1;
      module.pigmentHue = (
        Number(module.pigmentHue || 0) + sign * jump + 360
      ) % 360;
    }

    if (diagnosticEvents) {
      const alleleChanged = (
        childAlleleA !== inheritedA
        || childAlleleB !== inheritedB
      );
      if (
        alleleChanged
        || geometryMutated
        || saturationMutated
        || majorPatternHueMutated
      ) {
        diagnosticEvents.push({
          locus: locus.id,
          inherited_alleles: [inheritedA, inheritedB],
          child_alleles: [childAlleleA, childAlleleB],
          allele_changed: alleleChanged,
          geometry_mutated: geometryMutated,
          saturation_mutated: saturationMutated,
          major_hue_mutated: majorPatternHueMutated,
          inherited_pigment_hues: [
            diagnosticNumber(inheritedPigmentHueA, 2),
            diagnosticNumber(inheritedPigmentHueB, 2),
          ],
          final_pigment_hue: diagnosticNumber(module.pigmentHue, 2),
          final_pigment_saturation: diagnosticNumber(
            module.pigmentSaturation,
            4,
          ),
        });
      }
    }

    return module;
  }

  function makeChildGenome(
    parentA,
    parentB,
    childIndex,
    nextId,
    parentAIndex,
    parentBIndex,
    rng = Math.random,
  ) {
    const genetics = evolutionConfig.trait_genetics || {};
    const colorParentIsA = rng() < 0.5;
    const colorParent = colorParentIsA ? parentA : parentB;
    const colorParentIndex = colorParentIsA ? parentAIndex : parentBIndex;

    let baseHue = Number(colorParent.baseHue || 0);
    let baseSaturation = Number(colorParent.baseSaturation || 0);

    if (
      generationNumber(nextId) === 1
      && evolutionConfig.founder_model?.latent_hue_diversity
    ) {
      baseHue = rng() * 360;
    }

    let baseValue = inheritLinear(parentA.baseValue, parentB.baseValue, rng);
    let patternContrast = inheritLinear(
      parentA.patternContrast,
      parentB.patternContrast,
      rng,
    );
    let textureStrength = inheritLinear(
      parentA.textureStrength,
      parentB.textureStrength,
      rng,
    );

    const diagnostic = {
      child_index: childIndex,
      parent_a: parentAIndex,
      parent_b: parentBIndex,
      color_parent: colorParentIndex,
      inherited: {
        hue: diagnosticNumber(baseHue, 2),
        saturation: diagnosticNumber(baseSaturation, 4),
        value: diagnosticNumber(baseValue, 4),
        pattern_contrast: diagnosticNumber(patternContrast, 4),
        texture_strength: diagnosticNumber(textureStrength, 4),
      },
      mutations: [],
      pattern_mutations: [],
      pattern_birth: null,
      final: null,
      active_patterns: [],
    };

    if (rng() < Number(genetics.base_hue_small_mutation_p || 0)) {
      const before = baseHue;
      const delta = (rng() * 2 - 1)
        * Number(genetics.base_hue_small_mutation_deg || 0);
      baseHue = (baseHue + delta + 360) % 360;
      diagnostic.mutations.push({
        type: 'base_hue_small',
        before: diagnosticNumber(before, 2),
        after: diagnosticNumber(baseHue, 2),
        signed_delta_deg: diagnosticNumber(delta, 2),
      });
    }

    if (rng() < Number(genetics.base_hue_global_mutation_p || 0)) {
      const before = baseHue;
      const minJump = Number(
        genetics.base_hue_global_min_jump_deg ?? 70
      );
      const maxJump = Math.max(
        minJump,
        Number(genetics.base_hue_global_max_jump_deg ?? 180),
      );
      const jump = minJump + rng() * (maxJump - minJump);
      const sign = rng() < 0.5 ? -1 : 1;
      baseHue = (baseHue + sign * jump + 360) % 360;
      diagnostic.mutations.push({
        type: 'base_hue_major',
        before: diagnosticNumber(before, 2),
        after: diagnosticNumber(baseHue, 2),
        signed_jump_deg: diagnosticNumber(sign * jump, 2),
        absolute_jump_deg: diagnosticNumber(jump, 2),
      });
    }

    const saturationCap = clamp(
      Number(genetics.base_saturation_max ?? 1),
      0,
      1,
    );
    baseSaturation = clamp(baseSaturation, 0, saturationCap);

    if (
      rng()
      < Number(genetics.base_saturation_mutation_p || 0)
    ) {
      const before = baseSaturation;
      baseSaturation = clamp(
        baseSaturation
        + (rng() * 2 - 1)
        * Number(genetics.base_saturation_mutation_step || 0),
        0,
        saturationCap,
      );
      diagnostic.mutations.push({
        type: 'base_saturation',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(baseSaturation, 4),
      });
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
      && rng() < Number(genetics.pigment_expression_p || 0)
    ) {
      const before = baseSaturation;
      baseSaturation = pigmentMin
        + rng() * (pigmentMax - pigmentMin);
      diagnostic.mutations.push({
        type: 'pigment_expression',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(baseSaturation, 4),
        hue_revealed: diagnosticNumber(baseHue, 2),
      });
    }

    if (
      rng()
      < Number(genetics.base_value_small_mutation_p || 0)
    ) {
      const before = baseValue;
      const delta = Number(genetics.base_value_small_scale_delta || 0);
      baseValue = clamp01(
        baseValue * (1 + (rng() * 2 - 1) * delta),
      );
      diagnostic.mutations.push({
        type: 'base_value_small',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(baseValue, 4),
      });
    }

    if (
      rng()
      < Number(genetics.base_value_global_mutation_p || 0)
    ) {
      const before = baseValue;
      const minV = Number(genetics.base_value_global_min ?? 0.10);
      const maxV = Number(genetics.base_value_global_max ?? 0.95);
      const darkBiasP = Number(genetics.base_value_dark_bias_p || 0);
      let darkBias = false;

      if (rng() < darkBiasP) {
        darkBias = true;
        const darkMin = Number(genetics.base_value_dark_min ?? minV);
        const darkMax = Math.max(
          darkMin,
          Number(genetics.base_value_dark_max ?? 0.28),
        );
        baseValue = darkMin + rng() * (darkMax - darkMin);
      } else {
        baseValue = minV + rng() * (maxV - minV);
      }

      diagnostic.mutations.push({
        type: 'base_value_major',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(baseValue, 4),
        dark_bias_branch: darkBias,
      });
    }

    if (
      rng()
      < Number(genetics.contrast_mutation_p || 0)
    ) {
      const before = patternContrast;
      patternContrast = clamp(
        patternContrast
        + (rng() * 2 - 1)
        * Number(genetics.contrast_mutation_step || 0),
        0.06,
        0.90,
      );
      diagnostic.mutations.push({
        type: 'pattern_contrast',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(patternContrast, 4),
      });
    }

    let textureMutated = false;
    if (
      rng()
      < Number(genetics.texture_mutation_p || 0)
    ) {
      const before = textureStrength;
      textureStrength = clamp(
        textureStrength
        + (rng() * 2 - 1)
        * Number(genetics.texture_mutation_step || 0),
        0,
        0.20,
      );
      textureMutated = true;
      diagnostic.mutations.push({
        type: 'texture_strength',
        before: diagnosticNumber(before, 4),
        after: diagnosticNumber(textureStrength, 4),
      });
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
        diagnostic.pattern_mutations,
        rng,
      );
    }

    if (
      rng()
      < Number(genetics.pattern_birth_p_per_child || 0)
    ) {
      const candidates = (genetics.pattern_loci || []).filter((locus) => {
        const module = modules[locus.id];
        return module
          && !module.alleles[0]
          && !module.alleles[1];
      });

      if (candidates.length) {
        const locus = candidates[Math.floor(rng() * candidates.length)];
        const locusIndex = Math.max(
          0,
          (genetics.pattern_loci || []).findIndex(
            (item) => item.id === locus.id
          ),
        );
        const fresh = defaultModuleParams(
          locus.id,
          childSeed + (locusIndex + 1) * 997 + Math.floor(rng() * 997),
        );
        const newAlleles = [0, 0];
        newAlleles[Math.floor(rng() * 2)] = 1;
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
          pigmentHue: rng() * 360,
          pigmentSaturation: patternSatMin
            + rng() * (patternSatMax - patternSatMin),
        };

        patternContrast = Math.max(
          patternContrast,
          Number(genetics.pattern_birth_contrast_floor || 0.40),
        );

        diagnostic.pattern_birth = {
          locus: locus.id,
          alleles: [...newAlleles],
          pigment_hue: diagnosticNumber(
            modules[locus.id].pigmentHue,
            2,
          ),
          pigment_saturation: diagnosticNumber(
            modules[locus.id].pigmentSaturation,
            4,
          ),
          value_effect: diagnosticNumber(
            modules[locus.id].valueEffect,
            4,
          ),
        };
      }
    }

    const genome = {
      schema_version: 1,
      baseHue,
      baseSaturation,
      baseValue,
      patternContrast,
      textureStrength,
      textureSeed: textureMutated
        ? childSeed
        : (
          rng() < 0.5
            ? Number(parentA.textureSeed || childSeed)
            : Number(parentB.textureSeed || childSeed)
        ),
      modules,
    };

    diagnostic.final = {
      hue: diagnosticNumber(baseHue, 2),
      saturation: diagnosticNumber(baseSaturation, 4),
      value: diagnosticNumber(baseValue, 4),
      pattern_contrast: diagnosticNumber(patternContrast, 4),
      texture_strength: diagnosticNumber(textureStrength, 4),
    };
    diagnostic.active_patterns = diagnosticPatternSummary(genome, genetics);

    return { genome, diagnostic };
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


  function randomRange(rng, minValue, maxValue) {
    const min = Number(minValue);
    const max = Math.max(min, Number(maxValue));
    return min + rng() * (max - min);
  }

  function cloneMorphAllele(allele) {
    return {
      dominanceRank: Number(allele?.dominanceRank || 0),
      groundHue: Number(allele?.groundHue || 0),
      groundSaturation: Number(allele?.groundSaturation || 0),
      groundValue: Number(allele?.groundValue ?? 1),
      patternId: String(allele?.patternId || 'none'),
      patternHue: Number(allele?.patternHue || 0),
      patternSaturation: Number(allele?.patternSaturation || 0),
      patternContrast: Number(allele?.patternContrast || 0.55),
      textureStrength: Number(allele?.textureStrength || 0),
      patternSeed: Number(allele?.patternSeed || 1),
      textureSeed: Number(allele?.textureSeed || 1),
    };
  }

  function morphAlleleSnapshot(allele) {
    return {
      dominance_rank: Number(allele.dominanceRank || 0),
      ground_hue: diagnosticNumber(allele.groundHue, 2),
      ground_saturation: diagnosticNumber(allele.groundSaturation, 4),
      ground_value: diagnosticNumber(allele.groundValue, 4),
      pattern_id: String(allele.patternId || 'none'),
      pattern_hue: diagnosticNumber(allele.patternHue, 2),
      pattern_saturation: diagnosticNumber(allele.patternSaturation, 4),
      pattern_contrast: diagnosticNumber(allele.patternContrast, 4),
      texture_strength: diagnosticNumber(allele.textureStrength, 4),
      pattern_seed: Number(allele.patternSeed || 0),
      texture_seed: Number(allele.textureSeed || 0),
    };
  }

  function makeWhiteMorphAllele(rng, seed) {
    const genetics = evolutionConfig.morph_genetics || {};
    const rankMin = Number(genetics.dominance_rank_min ?? 0);
    const rankMax = Math.max(
      rankMin,
      Number(genetics.dominance_rank_max ?? 2),
    );
    return {
      dominanceRank: Math.floor(
        randomRange(rng, rankMin, rankMax + 1)
      ),
      groundHue: rng() * 360,
      groundSaturation: Number(
        evolutionConfig.founder_model?.founder_base_saturation ?? 0
      ),
      groundValue: Number(
        evolutionConfig.founder_model?.founder_base_value ?? 1
      ),
      patternId: 'none',
      patternHue: rng() * 360,
      patternSaturation: 0,
      patternContrast: 0.55,
      textureStrength: 0,
      patternSeed: seed,
      textureSeed: seed + 137,
    };
  }

  function chooseWeightedMutationType(rng) {
    const genetics = evolutionConfig.morph_genetics || {};
    const types = Array.isArray(genetics.mutation_types)
      ? genetics.mutation_types
      : [];
    if (!types.length) return 'color_morph';

    const total = types.reduce(
      (sum, item) => sum + Math.max(0, Number(item.weight || 0)),
      0,
    );
    if (total <= 0) return String(types[0].id || 'color_morph');

    let roll = rng() * total;
    for (const item of types) {
      roll -= Math.max(0, Number(item.weight || 0));
      if (roll <= 0) return String(item.id || 'color_morph');
    }
    return String(types[types.length - 1].id || 'color_morph');
  }

  function chooseMorphPatternId(rng, currentId = 'none') {
    const loci = evolutionConfig.trait_genetics?.pattern_loci || [];
    const ids = loci
      .map((item) => String(item.id || ''))
      .filter(Boolean)
      .filter((id) => id !== currentId);
    if (!ids.length) return 'none';
    return ids[Math.floor(rng() * ids.length)];
  }

  function farHueJump(currentHue, rng) {
    const genetics = evolutionConfig.morph_genetics || {};
    const minJump = Number(genetics.color_hue_jump_min_deg ?? 70);
    const maxJump = Math.max(
      minJump,
      Number(genetics.color_hue_jump_max_deg ?? 180),
    );
    const jump = randomRange(rng, minJump, maxJump);
    const sign = rng() < 0.5 ? -1 : 1;
    return {
      hue: (Number(currentHue || 0) + sign * jump + 360) % 360,
      signedJump: sign * jump,
    };
  }

  function mutateMorphAllele(sourceAllele, rng, seed) {
    const genetics = evolutionConfig.morph_genetics || {};
    const allele = cloneMorphAllele(sourceAllele);
    const p = Number(genetics.mutation_p_per_inherited_allele || 0);
    if (rng() >= p) {
      return { allele, event: null };
    }

    const before = morphAlleleSnapshot(allele);
    const type = chooseWeightedMutationType(rng);
    const visibleSatMin = Number(
      genetics.visible_saturation_min ?? 0.10
    );
    const visibleSatMax = Number(
      genetics.visible_saturation_max ?? 0.38
    );
    const patternSatMin = Number(
      genetics.pattern_saturation_min ?? 0.08
    );
    const patternSatMax = Number(
      genetics.pattern_saturation_max ?? 0.55
    );
    const patternContrastMin = Number(
      genetics.pattern_contrast_min ?? 0.45
    );
    const patternContrastMax = Number(
      genetics.pattern_contrast_max ?? 0.86
    );

    if (type === 'color_morph') {
      const jump = farHueJump(allele.groundHue, rng);
      allele.groundHue = jump.hue;
      allele.groundSaturation = randomRange(
        rng,
        visibleSatMin,
        visibleSatMax,
      );
      if (rng() < 0.35) {
        allele.groundValue = randomRange(
          rng,
          genetics.ordinary_value_min ?? 0.28,
          genetics.ordinary_value_max ?? 0.82,
        );
      }
    } else if (type === 'pattern_switch') {
      allele.patternId = chooseMorphPatternId(
        rng,
        allele.patternId,
      );
      allele.patternHue = rng() * 360;
      allele.patternSaturation = randomRange(
        rng,
        patternSatMin,
        patternSatMax,
      );
      allele.patternContrast = randomRange(
        rng,
        patternContrastMin,
        patternContrastMax,
      );
      allele.patternSeed = seed + Math.floor(rng() * 100000);
    } else if (type === 'melanism') {
      allele.groundValue = randomRange(
        rng,
        genetics.melanism_value_min ?? 0.10,
        genetics.melanism_value_max ?? 0.32,
      );
    } else if (type === 'pallor') {
      allele.groundValue = randomRange(
        rng,
        genetics.light_value_min ?? 0.70,
        genetics.light_value_max ?? 0.98,
      );
    } else if (type === 'pattern_color') {
      if (allele.patternId === 'none') {
        allele.patternId = chooseMorphPatternId(rng, 'none');
        allele.patternSeed = seed + Math.floor(rng() * 100000);
      }
      const jump = farHueJump(allele.patternHue, rng);
      allele.patternHue = jump.hue;
      allele.patternSaturation = randomRange(
        rng,
        patternSatMin,
        patternSatMax,
      );
      allele.patternContrast = Math.max(
        allele.patternContrast,
        patternContrastMin,
      );
    } else {
      const jump = farHueJump(allele.groundHue, rng);
      allele.groundHue = jump.hue;
      allele.groundSaturation = randomRange(
        rng,
        visibleSatMin,
        visibleSatMax,
      );
      allele.groundValue = randomRange(
        rng,
        genetics.ordinary_value_min ?? 0.28,
        genetics.ordinary_value_max ?? 0.82,
      );
      allele.patternId = chooseMorphPatternId(rng, allele.patternId);
      allele.patternHue = rng() * 360;
      allele.patternSaturation = randomRange(
        rng,
        patternSatMin,
        patternSatMax,
      );
      allele.patternContrast = randomRange(
        rng,
        patternContrastMin,
        patternContrastMax,
      );
      allele.textureStrength = randomRange(
        rng,
        genetics.texture_strength_min ?? 0,
        genetics.texture_strength_max ?? 0.14,
      );
      allele.patternSeed = seed + Math.floor(rng() * 100000);
      allele.textureSeed = seed + Math.floor(rng() * 100000);
    }

    if (
      rng()
      < Number(genetics.new_morph_dominance_mutation_p ?? 0.30)
    ) {
      const rankMin = Number(genetics.dominance_rank_min ?? 0);
      const rankMax = Math.max(
        rankMin,
        Number(genetics.dominance_rank_max ?? 2),
      );
      allele.dominanceRank = Math.floor(
        randomRange(rng, rankMin, rankMax + 1)
      );
    }

    return {
      allele,
      event: {
        type: 'morph_' + type,
        before,
        after: morphAlleleSnapshot(allele),
      },
    };
  }

  function expressedMorphIndex(alleles, seed) {
    const a = Number(alleles[0]?.dominanceRank || 0);
    const b = Number(alleles[1]?.dominanceRank || 0);
    if (a > b) return 0;
    if (b > a) return 1;
    return seededUnit(seed, 713) < 0.5 ? 0 : 1;
  }

  function phenotypeFromMorphAlleles(
    alleles,
    childSeed,
    expressedIndex = null,
  ) {
    const index = expressedIndex == null
      ? expressedMorphIndex(alleles, childSeed)
      : expressedIndex;
    const expressed = cloneMorphAllele(alleles[index]);
    const modules = {};
    const loci = evolutionConfig.trait_genetics?.pattern_loci || [];

    for (let i = 0; i < loci.length; i += 1) {
      const locus = loci[i];
      const seed = expressed.patternSeed + (i + 1) * 997;
      modules[locus.id] = {
        alleles: [0, 0],
        ...defaultModuleParams(locus.id, seed),
        pigmentHue: expressed.patternHue,
        pigmentSaturation: expressed.patternSaturation,
      };
    }

    if (
      expressed.patternId !== 'none'
      && modules[expressed.patternId]
    ) {
      modules[expressed.patternId].alleles = [1, 1];
    }

    return {
      schema_version: 2,
      model_id: 'morph_v1',
      morphAlleles: alleles.map(cloneMorphAllele),
      expressedMorphIndex: index,
      baseHue: expressed.groundHue,
      baseSaturation: expressed.groundSaturation,
      baseValue: expressed.groundValue,
      patternContrast: expressed.patternId === 'none'
        ? 0
        : expressed.patternContrast,
      textureStrength: expressed.textureStrength,
      textureSeed: expressed.textureSeed,
      modules,
    };
  }

  function makeMorphGenerationOneGenome(index) {
    const founder = evolutionConfig.founder_model || {};
    const founderSeed = String(
      founder.founder_seed || founder.founder_set_id || 'standard_white_001'
    );
    const rng = makeSeededRng(founderSeed + ':morph:' + index);
    const seed = index * 1009;
    const alleles = [
      makeWhiteMorphAllele(rng, seed + 1),
      makeWhiteMorphAllele(rng, seed + 2),
    ];
    return phenotypeFromMorphAlleles(alleles, seed);
  }

  function makeMorphChildGenome(
    parentA,
    parentB,
    childIndex,
    nextId,
    parentAIndex,
    parentBIndex,
  ) {
    if (
      !Array.isArray(parentA?.morphAlleles)
      || !Array.isArray(parentB?.morphAlleles)
    ) {
      throw new Error('Morph v1 の親遺伝子データがありません');
    }

    const childSeed = generationNumber(nextId) * 1000 + childIndex;
    const rng = Math.random;
    const inheritedA = cloneMorphAllele(
      parentA.morphAlleles[Math.floor(rng() * 2)]
    );
    const inheritedB = cloneMorphAllele(
      parentB.morphAlleles[Math.floor(rng() * 2)]
    );

    const resultA = mutateMorphAllele(
      inheritedA,
      rng,
      childSeed * 2 + 1,
    );
    const resultB = mutateMorphAllele(
      inheritedB,
      rng,
      childSeed * 2 + 2,
    );
    const alleles = [resultA.allele, resultB.allele];
    const expressedIndex = expressedMorphIndex(alleles, childSeed);
    const genome = phenotypeFromMorphAlleles(
      alleles,
      childSeed,
      expressedIndex,
    );

    const mutationEvents = [resultA.event, resultB.event].filter(Boolean);
    const expressed = alleles[expressedIndex];
    const diagnostic = {
      child_index: childIndex,
      parent_a: parentAIndex,
      parent_b: parentBIndex,
      color_parent: null,
      inherited: {
        allele_a: morphAlleleSnapshot(inheritedA),
        allele_b: morphAlleleSnapshot(inheritedB),
      },
      mutations: mutationEvents,
      pattern_mutations: [],
      pattern_birth: mutationEvents.find((event) => (
        event.before?.pattern_id === 'none'
        && event.after?.pattern_id !== 'none'
      )) || null,
      expressed_morph_index: expressedIndex,
      expressed_morph: morphAlleleSnapshot(expressed),
      final: {
        hue: diagnosticNumber(genome.baseHue, 2),
        saturation: diagnosticNumber(genome.baseSaturation, 4),
        value: diagnosticNumber(genome.baseValue, 4),
        pattern_contrast: diagnosticNumber(
          genome.patternContrast,
          4,
        ),
        texture_strength: diagnosticNumber(
          genome.textureStrength,
          4,
        ),
      },
      active_patterns: diagnosticPatternSummary(
        genome,
        evolutionConfig.trait_genetics || {},
      ),
    };

    return { genome, diagnostic };
  }

  async function evolveGenerationByMorph(generationId, eatenIndices) {
    await ensureConfig();
    await ensureMask();
    await ensureTemplateAlpha();

    const parentIndices = selectParents(eatenIndices);
    if (!parentIndices) return null;

    const uniqueParents = [...new Set(parentIndices)];
    const parentGenomes = new Map();

    for (const index of uniqueParents) {
      const genome = await idbGet(
        META_STORE,
        genomeKey(generationId, index),
      );
      if (!genome || !Array.isArray(genome.morphAlleles)) {
        throw new Error(
          'Morph v1 の親データを読み込めません: '
          + generationId
          + ' MOTH '
          + index
        );
      }
      parentGenomes.set(index, genome);
    }

    const plan = buildPairingPlan(parentIndices);
    const nextId = nextGenerationId(generationId);
    const blobs = new Map();
    const genomes = new Map();
    const offspringDiagnostics = [];

    for (const item of plan) {
      const result = makeMorphChildGenome(
        parentGenomes.get(item.parentA),
        parentGenomes.get(item.parentB),
        item.childIndex,
        nextId,
        item.parentA,
        item.parentB,
      );
      const child = renderGenome(result.genome);
      genomes.set(item.childIndex, result.genome);
      blobs.set(item.childIndex, await imageDataToBlob(child));
      offspringDiagnostics.push(result.diagnostic);

      if (item.childIndex % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    for (const [index, blob] of blobs.entries()) {
      await idbPut(IMAGE_STORE, imageKey(nextId, index), blob);
      await idbPut(
        META_STORE,
        genomeKey(nextId, index),
        genomes.get(index),
      );
    }

    const eatenSet = new Set(eatenIndices);
    const survivors = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      if (!eatenSet.has(i)) survivors.push(i);
    }

    const morphMutationCount = offspringDiagnostics.reduce(
      (count, child) => count + child.mutations.length,
      0,
    );

    const generationDiagnostic = {
      schema_version: 1,
      recorded_at: new Date().toISOString(),
      generation_id: generationId,
      next_generation_id: nextId,
      generation_number: generationNumber(generationId),
      environment_id:
        environmentConfig?.environment_id || PREVIEW_ENV_ID,
      evolution_model_id: 'morph_v1',
      preview_run_id: PREVIEW_RUN_ID,
      founder_set_id:
        evolutionConfig?.founder_model?.founder_set_id || null,
      evolution_config_id: evolutionConfig?.config_id || null,
      eaten_indices: [...eatenIndices],
      survivor_indices: survivors,
      survivor_count: survivors.length,
      selected_parent_pool: [...parentIndices],
      unique_selected_parents: [...uniqueParents],
      pairing_plan: plan.map((item) => ({
        child_index: item.childIndex,
        parent_a: item.parentA,
        parent_b: item.parentB,
      })),
      offspring: offspringDiagnostics.sort(
        (a, b) => a.child_index - b.child_index
      ),
      summary: {
        morph_mutation_count: morphMutationCount,
        pattern_birth_count: offspringDiagnostics.filter(
          (child) => Boolean(child.pattern_birth)
        ).length,
        expressed_pattern_count: offspringDiagnostics.filter(
          (child) => child.active_patterns.length > 0
        ).length,
      },
    };

    await idbPut(
      META_STORE,
      diagnosticKey(generationId),
      generationDiagnostic,
    );
    await idbPut(META_STORE, 'current_generation_id', nextId);
    await deleteGeneration(generationId);

    currentGenerationId = nextId;
    await loadGeneratedGeneration(nextId);
    return nextId;
  }

  function usesBrowserGeneratedFounder() {
    return (
      EVOLUTION_MODEL_ID === 'continuous_v1'
      || EVOLUTION_MODEL_ID === 'morph_v1'
      || String(evolutionConfig?.inheritance || '').startsWith('trait_')
    );
  }

  async function ensureFounderGeneration() {
    await ensureConfig();
    await ensureMask();
    await ensureTemplateAlpha();

    const markerKey = 'founder_generation_identity';
    const expectedMarker = [
      EVOLUTION_MODEL_ID,
      String(
        evolutionConfig.founder_model?.founder_set_id
        || 'standard_white_001'
      ),
      String(
        evolutionConfig.founder_model?.founder_seed
        || 'standard_white_001'
      ),
    ].join(':');
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
      let genome;

      if (EVOLUTION_MODEL_ID === 'morph_v1') {
        genome = makeMorphGenerationOneGenome(i);
      } else {
        const founderSetId = String(
          evolutionConfig.founder_model?.founder_set_id
          || 'standard_white_001'
        );
        const founderSeed = String(
          evolutionConfig.founder_model?.founder_seed
          || founderSetId
        );
        const founderRng = makeSeededRng(
          `${founderSeed}:${i}`
        );
        const result = makeChildGenome(
          founderA,
          founderB,
          i,
          'gen00001',
          0,
          0,
          founderRng,
        );
        genome = result.genome;
      }

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

    if (id === 'chevron_pair') {
      const slope = Math.tan(angle) * 0.42;
      const wave = roughness * 0.025
        * Math.sin(xNorm * Math.PI * 2 * frequency + phase);
      const center = Number(module.cy || 0.5)
        + slope * (1 - xNorm)
        + wave;
      const distance = Math.abs(yNorm - center);
      const width = Math.max(0.018, Number(module.ry || 0.055));
      if (distance >= width) return 0;
      return Math.pow(1 - distance / width, 0.72);
    }

    if (id === 'twin_spots') {
      const dx = u / Math.max(0.025, Number(module.rx || 0.11));
      const dy = v / Math.max(0.025, Number(module.ry || 0.09));
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) return 0;
      const edgeWobble = 1
        + roughness * 0.12
        * Math.sin(Math.atan2(dy, dx) * 4 + phase);
      return d2 >= edgeWobble
        ? 0
        : Math.pow(1 - d2 / edgeWobble, 0.55);
    }

    if (id === 'ripple_bands') {
      const tiltedY = yNorm
        + Math.tan(angle) * (xNorm - 0.5) * 0.20;
      const wave = roughness * 0.035
        * Math.sin(xNorm * Math.PI * 2 * 1.35 + phase);
      const signal = Math.abs(
        Math.sin((tiltedY + wave) * Math.PI * frequency + phase)
      );
      const ridge = Math.pow(1 - signal, 2.0);
      return ridge > 0.20 ? (ridge - 0.20) / 0.80 : 0;
    }

    if (id === 'radial_rays') {
      const ox = Number(module.cx || 0.90);
      const oy = Number(module.cy || 0.28);
      const dx = xNorm - ox;
      const dy = yNorm - oy;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius > 0.78) return 0;
      const theta = Math.atan2(dy, dx) + angle;
      const ray = Math.abs(Math.sin(theta * frequency + phase));
      const sharp = Math.pow(1 - ray, 2.2);
      const fade = clamp01(1 - radius / 0.78);
      const modulation = (1 - roughness)
        + roughness * (0.72 + 0.28 * Math.sin(radius * 34 + phase));
      const value = sharp * (0.45 + 0.55 * fade) * modulation;
      return value > 0.16 ? (value - 0.16) / 0.84 : 0;
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

        const genomeModules = (
          genome && genome.modules && typeof genome.modules === 'object'
        ) ? genome.modules : {};
        for (const locus of genetics.pattern_loci || []) {
          const module = genomeModules[locus.id];
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
          value += Number(module.valueEffect || 0) * amount * 0.75;

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
    const offspringDiagnostics = [];

    for (const item of plan) {
      const result = makeChildGenome(
        parentGenomes.get(item.parentA),
        parentGenomes.get(item.parentB),
        item.childIndex,
        nextId,
        item.parentA,
        item.parentB,
      );
      const genome = result.genome;
      const child = renderGenome(genome);
      genomes.set(item.childIndex, genome);
      blobs.set(item.childIndex, await imageDataToBlob(child));
      offspringDiagnostics.push(result.diagnostic);

      if (item.childIndex % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    for (const [index, blob] of blobs.entries()) {
      await idbPut(IMAGE_STORE, imageKey(nextId, index), blob);
      await idbPut(META_STORE, genomeKey(nextId, index), genomes.get(index));
    }

    const eatenSet = new Set(eatenIndices);
    const survivors = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      if (!eatenSet.has(i)) survivors.push(i);
    }

    const generationDiagnostic = {
      schema_version: 1,
      recorded_at: new Date().toISOString(),
      generation_id: generationId,
      next_generation_id: nextId,
      generation_number: generationNumber(generationId),
      environment_id:
        environmentConfig?.environment_id || PREVIEW_ENV_ID,
      evolution_model_id:
        evolutionConfig?.model_id || EVOLUTION_MODEL_ID,
      preview_run_id: PREVIEW_RUN_ID,
      founder_set_id:
        evolutionConfig?.founder_model?.founder_set_id || null,
      evolution_config_id: evolutionConfig?.config_id || null,
      eaten_indices: [...eatenIndices],
      survivor_indices: survivors,
      survivor_count: survivors.length,
      selected_parent_pool: [...parentIndices],
      unique_selected_parents: [...uniqueParents],
      pairing_plan: plan.map((item) => ({
        child_index: item.childIndex,
        parent_a: item.parentA,
        parent_b: item.parentB,
      })),
      offspring: offspringDiagnostics.sort(
        (a, b) => a.child_index - b.child_index
      ),
      summary: {
        base_hue_major_count: offspringDiagnostics.filter(
          (child) => child.mutations.some(
            (mutation) => mutation.type === 'base_hue_major'
          )
        ).length,
        base_value_major_count: offspringDiagnostics.filter(
          (child) => child.mutations.some(
            (mutation) => mutation.type === 'base_value_major'
          )
        ).length,
        pattern_birth_count: offspringDiagnostics.filter(
          (child) => Boolean(child.pattern_birth)
        ).length,
        pattern_major_hue_count: offspringDiagnostics.reduce(
          (count, child) => (
            count + child.pattern_mutations.filter(
              (event) => event.major_hue_mutated
            ).length
          ),
          0,
        ),
      },
    };

    await idbPut(
      META_STORE,
      diagnosticKey(generationId),
      generationDiagnostic,
    );
    await idbPut(META_STORE, 'current_generation_id', nextId);
    await deleteGeneration(generationId);

    currentGenerationId = nextId;
    await loadGeneratedGeneration(nextId);
    return nextId;
  }

  async function evolveGeneration(generationId, eatenIndices) {
    const eatenCount = Array.isArray(eatenIndices)
      ? eatenIndices.length
      : 0;
    await ensureTheaterSnapshot(generationId, {
      eatenCount,
      survivorCount: TOTAL - eatenCount,
    }).catch(console.error);

    let nextId;
    if (EVOLUTION_MODEL_ID === 'morph_v1') {
      nextId = await evolveGenerationByMorph(
        generationId,
        eatenIndices,
      );
    } else if (
      EVOLUTION_MODEL_ID === 'continuous_v1'
      || String(evolutionConfig?.inheritance || '').startsWith('trait_')
    ) {
      nextId = await evolveGenerationByGenome(
        generationId,
        eatenIndices,
      );
    } else {
      nextId = await evolveGenerationLegacy(
        generationId,
        eatenIndices,
      );
    }

    if (nextId) {
      await ensureTheaterSnapshot(nextId).catch(console.error);
    }
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
      publicConfig.preview_context = {
        environment_id: PREVIEW_ENV_ID,
        evolution_model_id: EVOLUTION_MODEL_ID,
        run_id: PREVIEW_RUN_ID,
        founder_set_id:
          evolutionConfig?.founder_model?.founder_set_id || null,
        legacy_default_storage: LEGACY_DEFAULT_STORAGE,
      };
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

    const envLabel = PREVIEW_ENV_ID === 'sand_001'
      ? '砂漠'
      : (
        PREVIEW_ENV_ID === 'bark_001'
          ? '樹皮'
          : PREVIEW_ENV_ID
      );
    const switchLabel = PREVIEW_ENV_ID === 'sand_001'
      ? '背景: 樹皮へ'
      : '背景: 砂漠へ';

    badge.innerHTML =
      '<span>SOLO · '
      + previewSeconds.toFixed(1)
      + 's · '
      + envLabel
      + ' · '
      + (EVOLUTION_MODEL_ID === 'morph_v1'
        ? '教育型'
        : 'エンタメ型')
      + ' · run:'
      + PREVIEW_RUN_ID
      + '</span>'
      + '<button type="button" data-action="environment">'
      + switchLabel
      + '</button>'
      + '<button type="button" data-action="model">'
      + (EVOLUTION_MODEL_ID === 'morph_v1'
        ? 'モデル: エンタメ型へ'
        : 'モデル: 教育型へ')
      + '</button>'
      + '<button type="button" data-action="diagnostic">診断ログ</button>'
      + '<button type="button" data-action="chatgpt-log">ChatGPT用ログ</button>'
      + '<button type="button" data-action="reset">テストをリセット</button>';

    Object.assign(badge.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      zIndex: '20',
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '6px',
      maxWidth: 'calc(100vw - 16px)',
      padding: '6px 8px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,.72)',
      color: '#b7f2f4',
      fontFamily: 'monospace',
      fontSize: '10px',
      letterSpacing: '.04em',
      boxShadow: '0 1px 8px rgba(0,0,0,.3)',
    });

    for (const button of badge.querySelectorAll('button')) {
      Object.assign(button.style, {
        width: 'auto',
        minHeight: '0',
        border: '1px solid rgba(183,242,244,.55)',
        borderRadius: '6px',
        padding: '3px 6px',
        background: 'transparent',
        color: '#e7ffff',
        font: 'inherit',
      });
    }

    const environmentButton = badge.querySelector(
      '[data-action="environment"]'
    );
    environmentButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const u = new URL(location.href);
      if (PREVIEW_ENV_ID === 'sand_001') {
        u.searchParams.delete('env');
      } else {
        u.searchParams.set('env', 'sand');
      }
      u.searchParams.set('v', String(Date.now()));
      location.href = u.toString();
    });

    const modelButton = badge.querySelector('[data-action="model"]');
    modelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const u = new URL(location.href);
      if (EVOLUTION_MODEL_ID === 'morph_v1') {
        u.searchParams.delete('model');
      } else {
        u.searchParams.set('model', 'morph_v1');
      }
      u.searchParams.set('v', String(Date.now()));
      location.href = u.toString();
    });

    const diagnosticButton = badge.querySelector(
      '[data-action="diagnostic"]'
    );
    diagnosticButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const originalText = diagnosticButton.textContent;
      diagnosticButton.textContent = '準備中…';
      diagnosticButton.disabled = true;
      try {
        await exportDiagnosticLog();
      } catch (error) {
        console.error(error);
        alert('診断ログの書き出しに失敗しました。');
      } finally {
        diagnosticButton.disabled = false;
        diagnosticButton.textContent = originalText;
      }
    });

    const chatGPTLogButton = badge.querySelector(
      '[data-action="chatgpt-log"]'
    );
    chatGPTLogButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const originalText = chatGPTLogButton.textContent;
      chatGPTLogButton.textContent = '準備中…';
      chatGPTLogButton.disabled = true;
      try {
        await prepareChatGPTDiagnosticCopy();
      } catch (error) {
        console.error(error);
        alert('ChatGPT用ログの作成に失敗しました。');
      } finally {
        chatGPTLogButton.disabled = false;
        chatGPTLogButton.textContent = originalText;
      }
    });

    const resetButton = badge.querySelector('[data-action="reset"]');
    resetButton.addEventListener('click', (event) => {
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
    exportDiagnosticLog,
    buildChatGPTDiagnosticText,
    prepareChatGPTDiagnosticCopy,
    getEvolutionTheaterFrames,
    ensureTheaterSnapshot,
    context: Object.freeze({
      environmentId: PREVIEW_ENV_ID,
      evolutionModelId: EVOLUTION_MODEL_ID,
      runId: PREVIEW_RUN_ID,
      storageNamespace: DB_NAME,
      legacyDefaultStorage: LEGACY_DEFAULT_STORAGE,
    }),
  };

  window.fetch = apiFetch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPreviewBadge, { once: true });
  } else {
    installPreviewBadge();
  }
})();
