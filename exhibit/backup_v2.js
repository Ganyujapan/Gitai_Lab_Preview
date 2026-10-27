/* Experimental, read-only part verification for a future split exhibit backup.
 * Not wired to admin.js: v1 export/restore and every IndexedDB record are unchanged.
 * No database writes occur in this module. File hashes detect accidental damage,
 * not maliciously forged backups. A restoration design needs a separate review.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitaiBackupV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 'gitai-exhibit-backup-v2';
  const PART_SCHEMA = 'gitai-exhibit-backup-part-v2';
  const STORES = Object.freeze(['images', 'meta', 'theater_frames']);
  const MAX_MANIFEST_BYTES = 1024 * 1024;
  const MAX_PART_BYTES = 8 * 1024 * 1024;
  const MAX_PARTS = 8192;
  const MAX_PART_ENTRIES = 2000;
  const MAX_PART_NODES = 350000;
  const MAX_DEPTH = 36;
  const GEN_RE = /^gen(?:\d{5}|[1-9]\d{5,})$/;
  const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
  const fail = message => { throw Error('分割バックアップ検証失敗：' + message); };

  function checkDepthAndNodes(root) {
    let total = 0;
    const stack = [[root, 0]];
    while (stack.length) {
      const [value, depth] = stack.pop();
      if (++total > MAX_PART_NODES || depth > MAX_DEPTH) fail('構造が複雑すぎます。');
      if (value && typeof value === 'object') {
        const children = Object.values(value);
        if (total + children.length > MAX_PART_NODES) fail('構造ノードが多すぎます。');
        for (const child of children) stack.push([child, depth + 1]);
      }
    }
  }

  function validateManifest(manifest, expectedMode, expectedDb) {
    if (!isObject(manifest) || manifest.schema !== SCHEMA ||
        !['cryptic', 'warning'].includes(expectedMode) ||
        manifest.mode !== expectedMode || manifest.database !== expectedDb ||
        manifest.databaseVersion !== 2 || !GEN_RE.test(manifest.currentGeneration)) {
      fail('モード・保存先・世代の指定が一致しません。');
    }
    if (!Array.isArray(manifest.parts) || !integer(manifest.parts.length, 1, MAX_PARTS)) {
      fail('分割ファイルの一覧が不正です。');
    }
    if (!isObject(manifest.totals) || !integer(manifest.totals.entries, 1, Number.MAX_SAFE_INTEGER) ||
        !isObject(manifest.totals.byStore) ||
        STORES.some(s => !integer(manifest.totals.byStore[s], 0, Number.MAX_SAFE_INTEGER)) ||
        Object.keys(manifest.totals.byStore).length !== STORES.length) {
      fail('総件数が不正です。');
    }
    if (manifest.mode === 'warning' && manifest.warningLife != null) {
      if (typeof manifest.warningLife !== 'string' || manifest.warningLife.length > 1024) {
        fail('ライフ情報の形式が不正です。');
      }
      let life;
      try { life = JSON.parse(manifest.warningLife); }
      catch (_) { fail('ライフ情報が破損しています。'); }
      if (!isObject(life) || life.generation_id !== manifest.currentGeneration ||
          !integer(life.thirds, 1, 30)) fail('ライフ情報の世代・残量が不正です。');
    }
    let planned = 0;
    const plannedByStore = {images: 0, meta: 0, theater_frames: 0};
    const names = new Set();
    for (let i = 0; i < manifest.parts.length; i++) {
      const part = manifest.parts[i];
      if (!isObject(part) || part.index !== i ||
          !STORES.includes(part.store) ||
          typeof part.file !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(part.file) ||
          part.file.includes('..') || names.has(part.file) ||
          !integer(part.bytes, 1, MAX_PART_BYTES) ||
          !integer(part.entries, 1, MAX_PART_ENTRIES) ||
          typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.sha256)) {
        fail('分割ファイルの索引・名前・容量・ハッシュが不正です。');
      }
      names.add(part.file);
      planned += part.entries;
      plannedByStore[part.store] += part.entries;
      if (!Number.isSafeInteger(planned)) fail('総件数の上限を超えました。');
    }
    if (planned !== manifest.totals.entries ||
        STORES.some(s => plannedByStore[s] !== manifest.totals.byStore[s])) {
      fail('分割ファイルの総件数が一致しません。');
    }
    return manifest;
  }

  function keyIdentity(store, key) {
    if ((typeof key !== 'string' && typeof key !== 'number') ||
        (typeof key === 'number' && !Number.isFinite(key))) fail('保存キーが不正です。');
    return store + ':' + typeof key + ':' + String(key);
  }

  async function sha256(bytes) {
    const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...result].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // This preflight never opens IndexedDB, decodes data into DB objects, or clears
  // existing records. Only one <=8 MiB part is read at a time. A future importer
  // MUST additionally validate decoded PNG/genomes and stage all records before
  // an atomic swap; passing this function alone does not authorize restore.
  async function verifyPartIntegrity(manifestFile, partFiles, expectedMode, expectedDb, onRecord) {
    if (!manifestFile || !Number.isFinite(manifestFile.size) ||
        manifestFile.size <= 0 || manifestFile.size > MAX_MANIFEST_BYTES) {
      fail('索引ファイルが大きすぎるか読み取れません。');
    }
    let manifest;
    try { manifest = JSON.parse(await manifestFile.text()); }
    catch (_) { fail('索引JSONが読み取れません。'); }
    checkDepthAndNodes(manifest);
    validateManifest(manifest, expectedMode, expectedDb);
    const files = Array.from(partFiles || []);
    if (files.length !== manifest.parts.length) fail('分割ファイルが不足・過剰です。');
    const byName = new Map();
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || byName.has(file.name)) {
        fail('分割ファイル名に重複があります。');
      }
      byName.set(file.name, file);
    }
    const seen = new Set();
    const current = manifest.currentGeneration;
    const requiredImages = new Set(Array.from({length: 60},
      (_, i) => current + ':' + String(i + 1).padStart(2, '0')));
    const requiredGenomes = new Set(Array.from({length: 60},
      (_, i) => 'genome:' + current + ':' + String(i + 1).padStart(2, '0')));
    let pointerFound = false;
    for (const desc of manifest.parts) {
      const file = byName.get(desc.file);
      if (!file || file.size !== desc.bytes || file.size > MAX_PART_BYTES) {
        fail('分割ファイルの欠損または容量不一致：' + desc.file);
      }
      const bytes = await file.arrayBuffer();
      if (await sha256(bytes) !== desc.sha256) fail('分割ファイルが破損しています：' + desc.file);
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
      catch (_) { fail('分割JSONが読めません：' + desc.file); }
      checkDepthAndNodes(body);
      if (!isObject(body) || body.schema !== PART_SCHEMA ||
          body.mode !== expectedMode || body.database !== expectedDb ||
          body.currentGeneration !== current || body.index !== desc.index ||
          body.store !== desc.store || !Array.isArray(body.entries) ||
          body.entries.length !== desc.entries) {
        fail('分割ファイルの構造が索引と一致しません：' + desc.file);
      }
      for (const record of body.entries) {
        if (!isObject(record) || !Object.hasOwn(record, 'value')) fail('保存項目の形式が不正です。');
        const id = keyIdentity(desc.store, record.key);
        if (seen.has(id)) fail('分割間で保存キーが重複しています。');
        seen.add(id);
        if (desc.store === 'images') requiredImages.delete(record.key);
        if (desc.store === 'meta') {
          requiredGenomes.delete(record.key);
          if (record.key === 'current_generation_id') {
            if (record.value !== current) fail('現在世代の参照先が一致しません。');
            pointerFound = true;
          }
        }
        if (onRecord) await onRecord(desc.store, record.key, record.value);
      }
    }
    if (!pointerFound || requiredImages.size || requiredGenomes.size) {
      fail('現在世代の参照情報・60匹の画像・DNAが不足しています。');
    }
    return {mode: expectedMode, generation: current, entries: seen.size, integrityOnly: true};
  }

  return Object.freeze({SCHEMA, PART_SCHEMA, MAX_MANIFEST_BYTES, MAX_PART_BYTES,
    validateManifest, verifyPartIntegrity});
});
