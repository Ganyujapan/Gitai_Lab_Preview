/* iPad-only exhibition administration. A local passcode is a kiosk lock,
   not server security: source code is public and Safari data is user-controlled. */
(() => {
  'use strict';
  const MODES = {
    cryptic: {
      label: '隠れるギタイ',
      db: 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic'
    },
    warning: {
      label: '目立つギタイ',
      db: 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2'
    }
  };
  const STORES = ['images', 'meta', 'theater_frames'];
  const PIN_KEY = 'gitai-exhibit2026-admin-pin-v1';
  const BACKUP_SCHEMA = 'gitai-exhibit-backup-v1';
  const panel = document.getElementById('exhibitAdminPanel');
  const message = document.getElementById('exhibitAdminMessage');
  const selector = document.getElementById('exhibitBackupMode');
  let unlocked = false;

  function say(text) { message.textContent = text; }
  const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  function unhex(s) {
    if (typeof s !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(s)) throw Error('Invalid hexadecimal encoding');
    return Uint8Array.from(s.match(/../g), v => parseInt(v, 16));
  }
  async function pinHash(pin, salt) {
    const bytes = new TextEncoder().encode(pin);
    const key = await crypto.subtle.importKey('raw', bytes, {name: 'PBKDF2'}, false, ['deriveBits']);
    const hash = await crypto.subtle.deriveBits(
      {name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256'}, key, 256
    );
    return hex(new Uint8Array(hash));
  }
  async function unlock() {
    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) {
      if (!confirm('管理者パスコードが未設定です。展示準備中の管理者だけが初期設定してください。')) return false;
      const pin = prompt('管理者用パスコードを設定（6文字以上）');
      if (!pin || pin.length < 6) { alert('6文字以上のパスコードが必要です。'); return false; }
      const confirmPin = prompt('同じパスコードをもう一度入力してください');
      if (pin !== confirmPin) { alert('入力が一致しません。'); return false; }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      localStorage.setItem(PIN_KEY, JSON.stringify({salt: hex(salt), hash: await pinHash(pin, salt)}));
    } else {
      const pin = prompt('管理者用パスコードを入力');
      if (pin == null) return false;
      let entry;
      try { entry = JSON.parse(stored); } catch (_) { alert('管理者設定が破損しています。'); return false; }
      const actual = await pinHash(pin, unhex(entry.salt));
      if (actual.length !== entry.hash.length ||
          [...actual].reduce((d, c, i) => d | (c.charCodeAt(0) ^ entry.hash.charCodeAt(i)), 0) !== 0) {
        alert('パスコードが違います。');
        return false;
      }
    }
    unlocked = true;
    panel.hidden = false;
    say('管理機能のロックを解除しました。');
    return true;
  }

  async function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      // STO-04: onblocked already rejects the administrator operation.
      // The request itself cannot be cancelled and may open much later;
      // close that stale connection to avoid holding a versionchange lock.
      let blocked = false;
      request.onupgradeneeded = () => {
        // Never create a version-2 DB without the game engine's stores.
        // An admin backup attempt before the first play must be harmless.
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('データベースが使用中です。ゲーム画面を閉じてください。'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        if (STORES.some(s => !db.objectStoreNames.contains(s))) {
          db.close();
          reject(new Error('保存データの形式が想定と異なります。'));
          return;
        }
        resolve(db);
      };
    });
  }
  // RE2-EXH-02: count the nodes that encode() would emit, without
  // allocating Base64 strings or duplicating huge diagnostic arrays.
  // This is a conservative early-rejection guard; final export/import
  // shape and file-size checks remain authoritative.
  function estimateSnapshotValue(value) {
    const stack = [[value, 0]];
    let nodes = 0;
    let base64Bytes = 0;
    while (stack.length) {
      const [item, depth] = stack.pop();
      if (++nodes > MAX_BACKUP_NODES || depth > 30) {
        throw Error('保存履歴の構造がバックアップ上限を超えています。');
      }
      if (item instanceof Blob) {
        // Encoded as {$type, mime, data}, not as raw PNG bytes.
        nodes += 3;
        base64Bytes += 4 * Math.ceil(item.size / 3);
      } else if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
        nodes += 2; // {$type, data}
        const size = item instanceof ArrayBuffer ? item.byteLength : item.byteLength;
        base64Bytes += 4 * Math.ceil(size / 3);
      } else if (item instanceof Date) {
        nodes += 2; // {$type, data}
      } else if (item && typeof item === 'object') {
        const children = Array.isArray(item) ? item : Object.values(item);
        if (nodes + stack.length + children.length > MAX_BACKUP_NODES) {
          throw Error('保存履歴の構造がバックアップ上限を超えています。');
        }
        for (const child of children) stack.push([child, depth + 1]);
      }
      if (nodes > MAX_BACKUP_NODES || base64Bytes > MAX_BACKUP_BYTES) {
        throw Error('保存履歴の構造または画像容量がバックアップ上限を超えています。');
      }
    }
    return {nodes, base64Bytes};
  }

  function snapshotStores(db) {
    // Read all stores in ONE readonly transaction. A generation commit or
    // restore transaction can run before or after this snapshot, not between
    // the images, genomes and current-generation pointer being collected.
    // Do not await blob encoding inside the IDB transaction: Safari can
    // auto-commit an inactive transaction between asynchronous turns.
    return new Promise((resolve, reject) => {
      const stores = Object.fromEntries(STORES.map(name => [name, []]));
      const tx = db.transaction(STORES, 'readonly');
      let visitedNodes = 64; // Envelope, payload, all store arrays and metadata.
      let encodedBinaryBytes = 0;
      let entryCount = 0;
      let earlyFailure = null;
      tx.oncomplete = () => resolve(stores);
      tx.onerror = () => reject(earlyFailure || tx.error || Error('バックアップの読込みに失敗しました。'));
      tx.onabort = () => reject(earlyFailure || tx.error || Error('バックアップの読込みが中断されました。'));
      try {
        for (const store of STORES) {
          const output = stores[store];
          const request = tx.objectStore(store).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            try {
              const size = estimateSnapshotValue(cursor.value);
              // Encoded store entry is {key, value}: two extra node visits
              // in addition to the entire encoded value tree.
              visitedNodes += size.nodes + 2;
              encodedBinaryBytes += size.base64Bytes;
              entryCount += 1;
              if (visitedNodes > MAX_BACKUP_NODES
                  || entryCount > MAX_BACKUP_ENTRIES
                  || encodedBinaryBytes > MAX_BACKUP_BYTES) {
                throw Error('保存履歴がバックアップ上限を超えています。'
                  + '元の進化データは変更していません。');
              }
              output.push({key: cursor.key, value: cursor.value});
              cursor.continue();
            } catch (error) {
              earlyFailure = error;
              try { tx.abort(); } catch (_) {}
              reject(error);
            }
          };
        }
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        reject(error);
      }
    });
  }
  function encode64(bytes) {
    let result = '';
    for (let pos = 0; pos < bytes.length; pos += 8192) {
      result += String.fromCharCode(...bytes.subarray(pos, pos + 8192));
    }
    return btoa(result);
  }
  function decode64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function encode(value) {
    if (value instanceof Blob) {
      return {$type: 'Blob', mime: value.type, data: encode64(new Uint8Array(await value.arrayBuffer()))};
    }
    if (value instanceof ArrayBuffer) return {$type: 'ArrayBuffer', data: encode64(new Uint8Array(value))};
    if (ArrayBuffer.isView(value)) {
      const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return {$type: value.constructor.name, data: encode64(raw)};
    }
    if (value instanceof Date) return {$type: 'Date', data: value.toISOString()};
    if (Array.isArray(value)) {
      const out = [];
      for (const entry of value) out.push(await encode(entry));
      return out;
    }
    if (value && typeof value === 'object') {
      const out = Object.create(null);
      for (const [key, entry] of Object.entries(value)) out[key] = await encode(entry);
      return out;
    }
    return value;
  }
  const ARRAY_TYPES = {
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array
  };
  function decode(value) {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') {
      if (value.$type === 'Blob') return new Blob([decode64(value.data)], {type: value.mime || ''});
      if (value.$type === 'ArrayBuffer') return decode64(value.data).buffer;
      if (value.$type === 'Date') return new Date(value.data);
      if (value.$type && Object.hasOwn(ARRAY_TYPES, value.$type)) {
        const bytes = decode64(value.data);
        const Constructor = ARRAY_TYPES[value.$type];
        if (bytes.byteLength % Constructor.BYTES_PER_ELEMENT) throw Error('Malformed typed array');
        return new Constructor(bytes.buffer);
      }
      if (value.$type) throw Error('Unsupported record type ' + value.$type);
      const out = Object.create(null);
      for (const [key, entry] of Object.entries(value)) out[key] = decode(entry);
      return out;
    }
    return value;
  }
  async function digest(text) {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  }

  async function exportMode(modeId) {
    const mode = MODES[modeId];
    if (!mode) throw Error('不明なモードです。');
    const db = await openDb(mode.db);
    let snapshot;
    try {
      snapshot = await snapshotStores(db);
    } finally { db.close(); }
    // Reject corrupt or incomplete current-generation records before spending
    // memory on a JSON artifact that this exact release could never restore.
    // The snapshot is read-only and represents one consistent IDB point.
    await verifyExportCurrentSnapshot(snapshot, modeId);
    // Encode only AFTER the complete, transactionally consistent snapshot.
    const stores = {};
    for (const store of STORES) {
      stores[store] = [];
      for (const item of snapshot[store]) {
        stores[store].push({key: item.key, value: await encode(item.value)});
      }
    }
    const current = stores.meta.find(item => item.key === 'current_generation_id')?.value;
    if (!/^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(current))) {
      throw Error('このモードには保存済みの進化データがまだありません。');
    }
    const lifeKey = 'gitai-warning-life-v1:' + mode.db;
    const payload = {
      schema: BACKUP_SCHEMA, mode: modeId, database: mode.db, databaseVersion: 2,
      createdAt: new Date().toISOString(), currentGeneration: current,
      gameBuild: await fetch('version.json').then(r => r.json()).then(x => x.build).catch(() => null),
      warningLife: modeId === 'warning' ? localStorage.getItem(lifeKey) : null,
      stores
    };
    const checksum = await digest(JSON.stringify(payload));
    const envelope = {checksum, payload};
    const file = new File([JSON.stringify(envelope)],
      'gitailab_2026_' + modeId + '_' + current + '_' +
      new Date().toISOString().slice(0, 10) + '.json',
      {type: 'application/json'});
    // Never announce a successful export that the same release's import
    // rejects on byte, entry, node or nesting limits. Preserve original DB.
    checkBackupExportLimits(envelope, file.size);
    if (modeId === 'warning') checkWarningLife(payload.warningLife, current);
    if (navigator.canShare?.({files: [file]}) && navigator.share) {
      await navigator.share({title: 'ギタイラボ 進化バックアップ', files: [file]});
    } else {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = file.name; document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    }
    return current;
  }

  // Existing export encoding and IndexedDB schemas are unchanged.
  // Keep a conservative limit before JSON decode and BEFORE any destructive
  // restore transaction. A checksum detects accidental damage, not authorship.
  const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
  const MAX_BACKUP_ENTRIES = 20000;
  const MAX_BACKUP_NODES = 350000;
  const MAX_MOTH_PNG_BYTES = 2 * 1024 * 1024;
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

  function validateTreeShape(root) {
    let visited = 0;
    const pending = [[root, 0]];
    while (pending.length) {
      const [value, depth] = pending.pop();
      if (++visited > MAX_BACKUP_NODES || depth > 36) {
        throw Error('バックアップの構造が大きすぎるか、入れ子が深すぎます。');
      }
      if (value && typeof value === 'object') {
        const children = Object.values(value);
        if (visited + children.length > MAX_BACKUP_NODES) {
          throw Error('バックアップの項目数が上限を超えています。');
        }
        for (const item of children) pending.push([item, depth + 1]);
      }
    }
  }

  function countBackupEntries(stores) {
    let count = 0;
    for (const store of STORES) {
      if (!Array.isArray(stores?.[store])) {
        throw Error('必須の保存データが不足しています。');
      }
      count += stores[store].length;
    }
    if (count > MAX_BACKUP_ENTRIES) {
      throw Error('バックアップの保存項目が多すぎます。');
    }
    return count;
  }
  function checkBackupExportLimits(envelope, bytes) {
    if (bytes > MAX_BACKUP_BYTES) {
      throw Error('この実験はバックアップ復元の容量上限を超えています。' +
        '既存データは保持しています。履歴を削除せず管理者へお知らせください。');
    }
    // Must traverse the exact envelope accepted by validateBackup, including
    // encoded historical diagnostics, not just a file's byte count.
    try {
      validateTreeShape(envelope);
      countBackupEntries(envelope?.payload?.stores);
    } catch (error) {
      throw Error('この実験は現在のバックアップ復元上限を超えています。' +
        '既存データは保持しています。履歴を削除せず管理者へお知らせください。' +
        ' 詳細：' + (error?.message || String(error)));
    }
  }

  // The shipped continuous_v1 model has these frozen pattern loci. Keep the
  // list aligned with data/evolution_models/continuous_v1/config.json via CI.
  // Do not synthesize missing modules from pixels or silently repair alleles.
  const EXPECTED_PATTERN_LOCI = Object.freeze([
    'central_blotch', 'transverse_band', 'outer_edge', 'speckle_cluster',
    'longitudinal_streaks', 'cloud_mottle', 'ring_spots', 'diagonal_streak',
    'chevron_pair', 'twin_spots', 'ripple_bands', 'radial_rays'
  ]);
  // Broad safety bounds (not a redefinition of mutation limits). Values
  // outside these cannot be valid continuous_v1 traits, but accepted old
  // numeric module fields remain optional for older schema-1 saves.
  const MODULE_NUMBER_BOUNDS = Object.freeze({
    cx: [-1, 2], cy: [-1, 2], rx: [0, 2], ry: [0, 2],
    valueEffect: [-2, 2], hueEffect: [-360, 360],
    saturationEffect: [-2, 2], pigmentHue: [-360, 720],
    pigmentSaturation: [0, 2], phase: [-1000000, 1000000],
    angle: [-360, 360], frequency: [0, 100], roughness: [0, 2]
  });
  function checkGenome(genome, index, selected) {
    if (!genome || typeof genome !== 'object' || Array.isArray(genome)
        || Number(genome.schema_version) !== 1) {
      throw Error('現在世代の遺伝情報が不足、または未対応の形式です（' + index + '番）。');
    }
    const baseLimits = {
      baseHue: [0, 360], baseSaturation: [0, 1], baseValue: [0, 1],
      patternContrast: [0, 1], textureStrength: [0, 1],
      textureSeed: [0, Number.MAX_SAFE_INTEGER]
    };
    for (const [key, [min, max]] of Object.entries(baseLimits)) {
      const value = genome[key];
      if (typeof value !== 'number' || !Number.isFinite(value)
          || value < min || value > max) {
        throw Error('遺伝情報の数値が不正です（' + index + '番・' + key + '）。');
      }
    }
    if (!genome.modules || typeof genome.modules !== 'object'
        || Array.isArray(genome.modules)
        || Object.keys(genome.modules).length < 1
        || Object.keys(genome.modules).length > 64) {
      throw Error('遺伝情報の模様遺伝子が不足しています（' + index + '番）。');
    }
    // A PNG cannot recover hidden/recessive alleles or lost loci.
    // All loci in the *current frozen model* must exist; extra/unknown loci
    // must not be accepted as substitutes for the missing ones.
    const actualLoci = Object.keys(genome.modules);
    if (actualLoci.length !== EXPECTED_PATTERN_LOCI.length ||
        EXPECTED_PATTERN_LOCI.some(id =>
          !Object.prototype.hasOwnProperty.call(genome.modules, id))) {
      throw Error('遺伝情報の必須模様遺伝子が欠損または不一致です（' + index + '番）。');
    }
    for (const locusId of EXPECTED_PATTERN_LOCI) {
      const module = genome.modules[locusId];
      if (!module || typeof module !== 'object' || Array.isArray(module)
          || !Array.isArray(module.alleles) || module.alleles.length !== 2
          || module.alleles.some(value => value !== 0 && value !== 1)) {
        throw Error('遺伝情報の対立遺伝子が不正です（' + index + '番・' + locusId + '）。');
      }
      for (const [key, [min, max]] of Object.entries(MODULE_NUMBER_BOUNDS)) {
        if (!Object.prototype.hasOwnProperty.call(module, key)) continue;
        const value = module[key];
        if (typeof value !== 'number' || !Number.isFinite(value)
            || value < min || value > max) {
          throw Error('模様遺伝子の数値が不正です（' + index + '番・' + locusId + '.' + key + '）。');
        }
      }
    }
    const expected = index <= 30 ? 'poison' : 'harmless';
    if (selected === 'warning' && genome.lineage !== expected) {
      throw Error('毒蛾と無毒蛾の系統情報が一致しません（' + index + '番）。');
    }
    const pending = [genome], seen = new Set();
    let nodes = 0;
    while (pending.length) {
      const value = pending.pop();
      if (value && typeof value === 'object') {
        if (seen.has(value)) continue;
        seen.add(value);
        if (++nodes > 5000) throw Error('遺伝情報の構造が大きすぎます。');
        for (const child of Object.values(value)) pending.push(child);
      } else if (typeof value === 'number' && !Number.isFinite(value)) {
        throw Error('遺伝情報に不正な数値があります（' + index + '番）。');
      }
    }
  }

  async function checkMothPng(blob, index) {
    if (!(blob instanceof Blob) || blob.size < 24 || blob.size > MAX_MOTH_PNG_BYTES
        || (blob.type && blob.type !== 'image/png')) {
      throw Error('現在世代の蛾画像の形式・容量が不正です（' + index + '番）。');
    }
    const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (!PNG_SIGNATURE.every((value, i) => header[i] === value)
        || view.getUint32(16) !== 128 || view.getUint32(20) !== 128) {
      throw Error('蛾画像のPNGヘッダーまたは寸法が不正です（' + index + '番）。');
    }
    // Header bytes alone aren't enough: a truncated PNG also has an IHDR.
    let width = 0, height = 0;
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob).catch(() => {
        throw Error('蛾画像をデコードできません（' + index + '番）。');
      });
      try { width = bitmap.width; height = bitmap.height; }
      finally { bitmap.close?.(); }
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const dimensions = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
          img.onerror = () => reject(Error('蛾画像をデコードできません（' + index + '番）。'));
          img.src = url;
        });
        [width, height] = dimensions;
      } finally { URL.revokeObjectURL(url); }
    }
    if (width !== 128 || height !== 128) {
      throw Error('蛾画像のデコード後の寸法が不正です（' + index + '番）。');
    }
  }

  // EXH-02: an exported file must at least contain a current generation
  // which this release would accept on import. All checks are read-only.
  // An old/invalid experimental record is kept intact for manual recovery;
  // never synthesize missing DNA from pixels or truncate the history.
  async function verifyExportCurrentSnapshot(snapshot, selected) {
    const meta = new Map(snapshot.meta.map(item => [item.key, item.value]));
    const images = new Map(snapshot.images.map(item => [item.key, item.value]));
    const current = meta.get('current_generation_id');
    if (!/^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(current))) {
      throw Error('このモードには復元可能な世代情報がありません。'
        + ' 元の実験は変更していません。');
    }
    for (let index = 1; index <= 60; index += 1) {
      const id = String(index).padStart(2, '0');
      const imageKey = current + ':' + id;
      const dnaKey = 'genome:' + current + ':' + id;
      if (!images.has(imageKey)) {
        throw Error('バックアップできる蛾画像が不足しています（'
          + index + '番）。実験データは保持しました。');
      }
      if (!meta.has(dnaKey)) {
        throw Error('バックアップできる遺伝情報が不足しています（'
          + index + '番）。実験データは保持しました。');
      }
      checkGenome(meta.get(dnaKey), index, selected);
      await checkMothPng(images.get(imageKey), index);
    }
    return current;
  }

  // An invalid/stale life string must not be treated as a successful
  // backup restoration. This is the JSON format persisted by
  // index.html:saveWarningLife; null means no saved life and is supported.
  function checkWarningLife(value, generationId) {
    if (value == null) return;
    if (typeof value !== 'string' || value.length > 1024) {
      throw Error('ライフの保存形式が不正です。');
    }
    let life;
    try { life = JSON.parse(value); }
    catch (_) { throw Error('ライフのJSONが破損しています。'); }
    if (!life || typeof life !== 'object' || Array.isArray(life)
        || life.generation_id !== generationId
        || !Number.isInteger(life.thirds)
        || life.thirds < 1 || life.thirds > 30) {
      throw Error('ライフの世代番号または残量が不正です。');
    }
  }

  async function validateBackup(raw, selected) {
    if (raw.length > MAX_BACKUP_BYTES) throw Error('JSONファイルが大きすぎます。');
    const doc = JSON.parse(raw);
    validateTreeShape(doc);
    const body = doc.payload;
    if (!body || body.schema !== BACKUP_SCHEMA || !MODES[selected] ||
        body.mode !== selected || body.database !== MODES[selected].db ||
        body.databaseVersion !== 2) {
      throw Error('このモード用のバックアップではありません。既存データは変更していません。');
    }
    if (await digest(JSON.stringify(body)) !== doc.checksum) {
      throw Error('バックアップの整合性検証に失敗しました。');
    }
    countBackupEntries(body.stores);
    const current = body.stores.meta.find(item => item?.key === 'current_generation_id')?.value;
    if (!/^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(current)) || current !== body.currentGeneration) {
      throw Error('世代番号が不正です。');
    }
    if (selected === 'warning') checkWarningLife(body.warningLife, current);
    const prepared = {};
    for (const store of STORES) {
      prepared[store] = body.stores[store].map(entry => {
        if (!entry || (typeof entry.key !== 'string' && typeof entry.key !== 'number')) {
          throw Error('無効なデータキーです。');
        }
        return {key: entry.key, value: decode(entry.value)};
      });
      if (new Set(prepared[store].map(item => String(item.key))).size !== prepared[store].length) {
        throw Error('キーの重複を検出しました。');
      }
    }
    const images = new Map(prepared.images.map(item => [item.key, item.value]));
    const genomes = new Map(prepared.meta.map(item => [item.key, item.value]));
    // Validate EXACT keys 01..60, not a count of arbitrary prefix matches.
    // Gen1 is also checked: under the current engine missing stored PNGs
    // block continuation rather than silently resetting the experiment.
    for (let index = 1; index <= 60; index++) {
      const id = String(index).padStart(2, '0');
      const imageKey = current + ':' + id;
      const genomeKey = 'genome:' + current + ':' + id;
      if (!images.has(imageKey)) {
        throw Error('現在世代の蛾画像が不足しています（' + index + '番）。');
      }
      if (!genomes.has(genomeKey)) {
        throw Error('現在世代の遺伝情報が不足しています（' + index + '番）。');
      }
      checkGenome(genomes.get(genomeKey), index, selected);
      await checkMothPng(images.get(imageKey), index);
    }
    return {body, prepared};
  }
  // EXH-03: IndexedDB and localStorage cannot commit atomically. Keep a tiny,
  // durable intent in the existing v2 meta store INSIDE the restore transaction,
  // so a failed life write can be retried without restoring (overwriting) all
  // evolution records again. This does NOT require a DB schema upgrade.
  const PENDING_WARNING_LIFE_KEY = 'pending_warning_life_restore_v1';
  const warningLifeStorageKey = dbName => 'gitai-warning-life-v1:' + dbName;

  function readWarningLifeState(db) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('meta','readonly');
      const meta=tx.objectStore('meta');
      const result={};
      for(const [field,key] of [
        ['generation','current_generation_id'],
        ['epoch','restore_epoch'],
        ['pending',PENDING_WARNING_LIFE_KEY]
      ]){
        const req=meta.get(key);
        req.onsuccess=()=>{result[field]=req.result;};
      }
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>{};
      tx.onabort=()=>reject(tx.error||Error('ライフ復元情報の読み込みが中断されました。'));
    });
  }
  // The cleanup has its OWN guarded transaction. It can never delete a newer
  // restore's intent after a concurrent backup restore or generation update.
  function clearCompletedWarningLifeIntent(db,intent) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('meta','readwrite');
      const meta=tx.objectStore('meta');
      let failure=null;
      const abort=message=>{
        failure=Error(message);
        try{tx.abort();}catch(_){reject(failure);}
      };
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(failure||tx.error||Error('ライフ復元記録の更新が中断されました。'));
      tx.onerror=()=>{};
      const epoch=meta.get('restore_epoch');
      epoch.onsuccess=()=>{
        if(epoch.result!==intent.epoch){
          abort('別の復元を検出したため、ライフ復元記録を変更しません。');
          return;
        }
        const generation=meta.get('current_generation_id');
        generation.onsuccess=()=>{
          if(generation.result!==intent.generation_id){
            abort('世代が進んだため、ライフ復元記録を変更しません。');
            return;
          }
          const req=meta.get(PENDING_WARNING_LIFE_KEY);
          req.onsuccess=()=>{
            const current=req.result;
            if(!current||current.epoch!==intent.epoch||
                current.generation_id!==intent.generation_id||
                current.value!==intent.value){
              abort('ライフ復元記録が更新されたため、以前の記録を変更しません。');
              return;
            }
            try{meta.delete(PENDING_WARNING_LIFE_KEY);}
            catch(error){failure=error;try{tx.abort();}catch(_){reject(error);}}
          };
        };
      };
    });
  }

  async function retryPendingWarningLife() {
    const db=await openDb(MODES.warning.db);
    try{
      const before=await readWarningLifeState(db);
      const intent=before.pending;
      if(intent==null)return {status:'none'};
      const valid=typeof intent==='object'&&!Array.isArray(intent)
        && typeof intent.epoch==='string'
        && /^restore-[a-f0-9]{32}$/.test(intent.epoch)
        && typeof intent.generation_id==='string'
        && /^gen(?:\\d{5}|[1-9]\\d{5,})$/.test(intent.generation_id)
        && (intent.value===null||typeof intent.value==='string');
      if(!valid){
        return {status:'stale',detail:'未完了のライフ復元情報が不正です。進化データは変更しません。'};
      }
      checkWarningLife(intent.value,intent.generation_id);
      if(before.generation!==intent.generation_id||before.epoch!==intent.epoch){
        return {status:'stale',detail:'世代または復元履歴が更新されました。古いライフは適用しません。'};
      }
      const lifeKey=warningLifeStorageKey(MODES.warning.db);
      try{
        if(intent.value===null)localStorage.removeItem(lifeKey);
        else localStorage.setItem(lifeKey,intent.value);
        if(localStorage.getItem(lifeKey)!==intent.value)
          throw Error('ライフ情報が保存されていません。');
      }catch(error){
        return {status:'partial',generation:intent.generation_id,
          detail:error?.message||String(error)};
      }
      const after=await readWarningLifeState(db);
      if(after.generation!==intent.generation_id||after.epoch!==intent.epoch){
        // localStorage cannot be atomic with IDB. Never claim success if
        // another tab advanced the game while the life write was performed.
        return {status:'stale',detail:'ライフの書込み中に世代が変更されました。'
          +'ゲーム画面を閉じた状態で管理者に確認してください。'};
      }
      try{await clearCompletedWarningLifeIntent(db,intent);}
      catch(error){
        return {status:'partial',generation:intent.generation_id,
          detail:'ライフ情報は保存されましたが完了記録を更新できません：'
            +(error?.message||String(error))};
      }
      return {status:'complete',generation:intent.generation_id};
    }finally{db.close();}
  }

  async function restoreMode(selected, file) {
    // Reject a large import BEFORE allocating an equally large UTF-8 string.
    if (!file || !Number.isFinite(file.size) || file.size > MAX_BACKUP_BYTES) {
      throw Error('バックアップファイルの容量が上限を超えています。');
    }
    const {body, prepared} = await validateBackup(await file.text(), selected);
    const mode = MODES[selected];
    if (!confirm(mode.label + 'を' + body.currentGeneration +
      'に復元します。現在の同モードのデータは置き換えられます。実行しますか？')) return {status: 'cancelled'};
    // Unique restore epoch: never reuse a value from an imported backup.
    // Browser cryptographic randomness is separate from evolution RNG.
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const epoch = 'restore-' + [...entropy]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const db = await openDb(mode.db);
    try {
      // Atomic across ALL object stores. On quota/write errors, IDB rolls
      // back the entire transaction, preserving the old generation.
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, 'readwrite');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        try {
          for (const store of STORES) {
            const objectStore = tx.objectStore(store);
            objectStore.clear();
            for (const {key, value} of prepared[store]) objectStore.put(value, key);
            // Same transaction as every other restored store. Any historic
            // restore_epoch in the backup is intentionally replaced.
            if (store === 'meta') {
              objectStore.put(epoch, 'restore_epoch');
              if(selected==='warning') {
                objectStore.put({
                  epoch,generation_id:body.currentGeneration,
                  value:body.warningLife??null
                },PENDING_WARNING_LIFE_KEY);
              }
            }
          }
        } catch (error) {
          // Synchronous put errors must not leave queued clear() operations
          // free to commit without the replacement records.
          tx.abort();
          reject(error);
        }
      });
    } finally { db.close(); }
    if(selected==='warning')return retryPendingWarningLife();
    return {status:'complete',generation:body.currentGeneration};
  }

  const button = document.getElementById('exhibitAdminOpen');
  button.addEventListener('click', async () => {
    try { await unlock(); } catch (error) { alert(error.message); }
  });
  document.getElementById('exhibitAdminClose').addEventListener('click', () => {
    unlocked = false; panel.hidden = true;
  });
  document.getElementById('exhibitBackupExport').addEventListener('click', async () => {
    if (!unlocked) return;
    say('JSONバックアップを作成中…');
    try {
      const generation = await exportMode(selector.value);
      say(generation + 'のバックアップを生成しました。必ずiPadの「ファイル」アプリ等に保存されたことを確認してください。');
    } catch (error) {
      say('バックアップ失敗：' + (error?.message || String(error)));
    }
  });
  document.getElementById('exhibitBackupLifeRetry').addEventListener('click',async()=>{
    if(!unlocked)return;
    if(selector.value!=='warning'){
      say('ライフ情報の再試行は「目立つギタイ」を選択してください。');
      return;
    }
    say('保存済みの世代とライフ復元情報を確認中…');
    try{
      const result=await retryPendingWarningLife();
      if(result.status==='complete')
        say('進化データには触れず、'+result.generation+'のライフ情報だけ復元しました。');
      else if(result.status==='none')
        say('再試行が必要なライフ情報はありません。');
      else if(result.status==='stale')
        say('ライフ情報は変更していません：'+result.detail);
      else
        say('進化データは保存済みですが、ライフ情報が未完了です：'
          +result.detail+'。他のゲーム画面を閉じて再試行してください。');
    }catch(error){
      say('ライフ情報の再試行に失敗しました。進化データは変更していません：'
        +(error?.message||String(error)));
    }
  });
  const input = document.getElementById('exhibitBackupFile');
  document.getElementById('exhibitBackupRestore').addEventListener('click', () => {
    if (unlocked) { input.value = ''; input.click(); }
  });
  input.addEventListener('change', async () => {
    if (!unlocked || !input.files?.[0]) return;
    say('バックアップを検証中…');
    try {
      const result = await restoreMode(selector.value, input.files[0]);
      if (result.status === 'cancelled') {
        say('復元をキャンセルしました。');
      } else if (result.status === 'partial') {
        say('進化データ（' + result.generation + '）は復元しましたが、ライフ情報を復元できませんでした。' +
          '以前のライフ情報が残っている可能性があります。保存エラー：' + result.detail +
          '。全データを復元し直さず「ライフ情報だけ再試行」を押してください。');
      } else if(result.status==='stale'){
        say('進化データの復元後に世代変更を検出しました。ライフは安全のため確定していません：'
          +result.detail);
      } else if(result.status==='none'){
        say('進化データを復元しましたが、ライフ復元の完了情報が見つかりません。管理者へ確認してください。');
      } else {
        say('進化データ（' + result.generation + '）の復元が完了しました。');
      }
    } catch (error) {
      say('復元失敗（既存データは保持）：' + (error?.message || String(error)));
    }
  });
  // Only the update UI is PIN-gated. The browser may discover/install a new
  // Service Worker independently. Without install-time skipWaiting, it normally
  // waits while old controlled clients remain open, but can auto-activate once
  // all those clients close or the browser shuts down. This is not version pinning.
  const updateStatus = document.getElementById('exhibitUpdateStatus');
  const updateApply = document.getElementById('exhibitUpdateApply');
  let pendingWorker = null;
  const setUpdate = text => { updateStatus.textContent = text; };
  document.getElementById('exhibitUpdateCheck').addEventListener('click', async () => {
    if (!unlocked) return;
    updateApply.hidden = true;
    pendingWorker = null;
    setUpdate('GitHub Pagesの最新版を確認しています…');
    try {
      if (!('serviceWorker' in navigator)) throw Error('Service Worker非対応です。');
      const reg = await navigator.serviceWorker.getRegistration('./');
      if (!reg?.active) throw Error('オフラインアプリが未インストールです。');
      const cached = await fetch('./version.json').then(response => response.json());
      const network = await fetch('./version.json?online=1&t=' + Date.now(),
        {cache: 'no-store'}).then(response => {
        if (!response.ok) throw Error('HTTP ' + response.status);
        return response.json();
      });
      if (network.build === cached.build) {
        setUpdate('最新版です（' + String(cached.build).slice(0, 12) + '）。');
        return;
      }
      setUpdate('新しいバージョンを発見しました。全ファイルをダウンロード中…');
      await reg.update();
      // Installation includes a complete precache. Installing failures do
      // not displace the current active worker.
      for (let i = 0; i < 100 && !reg.waiting; i++) {
        if (reg.installing?.state === 'redundant') break;
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      if (!reg.waiting) throw Error('更新を完了できませんでした。旧版は維持されています。');
      pendingWorker = reg.waiting;
      setUpdate('ダウンロード完了。展示中のプレイを終了し、世代保存と他の展示画面の終了を確認してから適用してください。');
      updateApply.hidden = false;
    } catch (error) {
      setUpdate('更新失敗：' + (error.message || String(error)) +
        '。現在のバージョンと保存データはそのままです。');
    }
  });
  updateApply.addEventListener('click', async () => {
    if (!unlocked || !pendingWorker || updateApply.hidden) return;
    if (!confirm('今すぐ更新を適用し、展示トップを再読み込みしますか？')) return;
    updateApply.disabled = true;
    setUpdate('最新版を適用中…');
    try {
      const newControl = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('切替確認がタイムアウトしました。')), 20000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer); resolve();
        }, {once: true});
      });
      pendingWorker.postMessage({type: 'APPLY_EXHIBIT_UPDATE'});
      await newControl;
      setUpdate('更新の適用が完了しました。再起動します。');
      location.reload();
    } catch (error) {
      setUpdate('適用結果を確認できません：' + (error.message || error));
      updateApply.disabled = false;
    }
  });

})();
