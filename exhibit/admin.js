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
      request.onupgradeneeded = () => {
        // Never create a version-2 DB without the game engine's stores.
        // An admin backup attempt before the first play must be harmless.
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('データベースが使用中です。ゲーム画面を閉じてください。'));
      request.onsuccess = () => {
        const db = request.result;
        if (STORES.some(s => !db.objectStoreNames.contains(s))) {
          db.close();
          reject(new Error('保存データの形式が想定と異なります。'));
          return;
        }
        resolve(db);
      };
    });
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
      tx.oncomplete = () => resolve(stores);
      tx.onerror = () => reject(tx.error || Error('バックアップの読込みに失敗しました。'));
      tx.onabort = () => reject(tx.error || Error('バックアップの読込みが中断されました。'));
      try {
        for (const store of STORES) {
          const output = stores[store];
          const request = tx.objectStore(store).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            output.push({key: cursor.key, value: cursor.value});
            cursor.continue();
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
    // Encode only AFTER the complete, transactionally consistent snapshot.
    const stores = {};
    for (const store of STORES) {
      stores[store] = [];
      for (const item of snapshot[store]) {
        stores[store].push({key: item.key, value: await encode(item.value)});
      }
    }
    const current = stores.meta.find(item => item.key === 'current_generation_id')?.value;
    if (!/^gen\d{5}$/.test(String(current))) {
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
    const file = new File([JSON.stringify({checksum, payload})],
      'gitailab_2026_' + modeId + '_' + current + '_' +
      new Date().toISOString().slice(0, 10) + '.json',
      {type: 'application/json'});
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

  function checkGenome(genome, index, selected) {
    if (!genome || typeof genome !== 'object' || Array.isArray(genome)
        || Number(genome.schema_version) !== 1) {
      throw Error('現在世代の遺伝情報が不足、または未対応の形式です（' + index + '番）。');
    }
    for (const key of ['baseHue', 'baseSaturation', 'baseValue',
                       'patternContrast', 'textureStrength', 'textureSeed']) {
      if (typeof genome[key] !== 'number' || !Number.isFinite(genome[key])) {
        throw Error('遺伝情報の数値が不正です（' + index + '番・' + key + '）。');
      }
    }
    if (!genome.modules || typeof genome.modules !== 'object'
        || Array.isArray(genome.modules)
        || Object.keys(genome.modules).length < 1
        || Object.keys(genome.modules).length > 64) {
      throw Error('遺伝情報の模様遺伝子が不足しています（' + index + '番）。');
    }
    // A visual PNG cannot recover the recessive alleles. Never invent them
    // while restoring a backup or silently downgrade genotype schema.
    for (const module of Object.values(genome.modules)) {
      if (!module || typeof module !== 'object' || Array.isArray(module)
          || !Array.isArray(module.alleles) || module.alleles.length !== 2
          || module.alleles.some(value => value !== 0 && value !== 1)) {
        throw Error('遺伝情報の対立遺伝子が不正です（' + index + '番）。');
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
    let totalEntries = 0;
    for (const store of STORES) {
      if (!Array.isArray(body.stores?.[store])) throw Error('必須の保存データが不足しています。');
      totalEntries += body.stores[store].length;
    }
    if (totalEntries > MAX_BACKUP_ENTRIES) {
      throw Error('バックアップの保存項目が多すぎます。');
    }
    const current = body.stores.meta.find(item => item?.key === 'current_generation_id')?.value;
    if (!/^gen\d{5}$/.test(String(current)) || current !== body.currentGeneration) {
      throw Error('世代番号が不正です。');
    }
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
  async function restoreMode(selected, file) {
    // Reject a large import BEFORE allocating an equally large UTF-8 string.
    if (!file || !Number.isFinite(file.size) || file.size > MAX_BACKUP_BYTES) {
      throw Error('バックアップファイルの容量が上限を超えています。');
    }
    const {body, prepared} = await validateBackup(await file.text(), selected);
    const mode = MODES[selected];
    if (!confirm(mode.label + 'を' + body.currentGeneration +
      'に復元します。現在の同モードのデータは置き換えられます。実行しますか？')) return {status: 'cancelled'};
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
          }
        } catch (error) {
          // Synchronous put errors must not leave queued clear() operations
          // free to commit without the replacement records.
          tx.abort();
          reject(error);
        }
      });
    } finally { db.close(); }
    if (selected === 'warning') {
      const lifeKey = 'gitai-warning-life-v1:' + mode.db;
      try {
        if (body.warningLife == null) localStorage.removeItem(lifeKey);
        else localStorage.setItem(lifeKey, body.warningLife);
      } catch (error) {
        // IndexedDB has already committed. Preserve that fact rather than
        // treating this as a rollback or allowing the UI to claim full success.
        return {status: 'partial', generation: body.currentGeneration,
          detail: error?.message || String(error)};
      }
    }
    return {status: 'complete', generation: body.currentGeneration};
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
          '。バックアップを確認し、再度復元してください。');
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
