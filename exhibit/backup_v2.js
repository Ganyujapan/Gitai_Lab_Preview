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
  // The isolated checkpoint inspector and writer must agree on a hard
  // ceiling; never accept a multipart archive that cannot be staged safely.
  const MAX_TOTAL_ENTRIES = 250000;
  const MAX_PART_NODES = 350000;
  const MAX_DEPTH = 36;
  const GEN_RE = /^gen(?:\d{5}|[1-9]\d{5,})$/;
  const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
  const fail = message => { throw Error('分割バックアップ検証失敗：' + message); };

  function checkDepthAndNodes(root) {
    let total = 0;
    const seen = new WeakSet();
    const backingBuffers = new WeakSet();
    const stack = [[root, 0]];
    while (stack.length) {
      const [value, depth] = stack.pop();
      if (++total > MAX_PART_NODES || depth > MAX_DEPTH) fail('構造が複雑すぎます。');
      if (value && typeof value === 'object') {
        // IndexedDB preserves graph identity, but the v2 JSON codec does
        // not. Refuse both cycles and shared references before serialization.
        if (seen.has(value)) fail('共有参照または循環参照は復元できません。');
        seen.add(value);
        const backing = ArrayBuffer.isView(value) ? value.buffer :
          value instanceof ArrayBuffer ? value : null;
        if (backing) {
          // Two views of the same buffer must not silently become two
          // independent backing buffers on restore.
          if (backingBuffers.has(backing)) {
            fail('共有バイナリバッファーは復元できません。');
          }
          backingBuffers.add(backing);
        }
      }
      if (value instanceof Blob || value instanceof Date ||
          value instanceof ArrayBuffer || ArrayBuffer.isView(value)) continue;
      if (value && typeof value === 'object') {
        const children = Object.values(value);
        if (total + children.length > MAX_PART_NODES) fail('構造ノードが多すぎます。');
        for (const child of children) stack.push([child, depth + 1]);
      }
    }
    return total;
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
    if (!isObject(manifest.totals) || !integer(manifest.totals.entries, 1, MAX_TOTAL_ENTRIES) ||
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
      if (planned > MAX_TOTAL_ENTRIES) fail('総件数の上限を超えました。');
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

  
  // A separately testable, bounded writer for ALREADY CONSISTENT records.
  // IMPORTANT: callers must supply a transactionally consistent source in
  // store/key order. This function deliberately never opens IndexedDB.
  // The savePart callback must persist each file; no v2 manifest is handed
  // back until all callbacks complete and every input record is accounted for.
  const utf8 = text => new TextEncoder().encode(text).byteLength;

  function orderedKeyAfter(previous, next) {
    const primitive = v => typeof v === 'string' ||
      (typeof v === 'number' && Number.isFinite(v));
    if (!primitive(next)) fail('保存キーは有限数値か文字列である必要があります。');
    if (previous === undefined) return true;
    // IndexedDB key ordering places numbers before strings, and uses code-unit
    // order for strings. A strict ascending cursor detects duplicated keys.
    if (typeof previous !== typeof next) return typeof previous === 'number';
    return next > previous;
  }

  function bytesToBase64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(text);
  }

  async function encodeRecordValue(value, depth = 0, parents = new WeakSet()) {
    if (depth > 30) fail('保存項目の入れ子が深すぎます。');
    // File is a Blob subclass, but structured-clone File records retain
    // name/lastModified. Restoring our v2 Blob wrapper would silently lose
    // that metadata, so refuse File until the format has a reviewed codec.
    if (typeof File !== 'undefined' && value instanceof File) {
      fail('ファイル名・更新日時を復元できないFile形式が含まれています。');
    }
    if (value instanceof Blob) {
      if (value.size > MAX_PART_BYTES / 2) fail('単一画像が分割サイズを超えます。');
      return {$type: 'Blob', mime: value.type,
        data: bytesToBase64(new Uint8Array(await value.arrayBuffer()))};
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      // The v2 codec stores only view bytes. The decoder always creates a
      // fresh buffer with byteOffset=0; a sliced view would lose its
      // original offset and backing-buffer length.
      if (ArrayBuffer.isView(value) &&
          (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength)) {
        fail('復元未対応の部分バイナリビューが含まれています。');
      }
      if (ArrayBuffer.isView(value) &&
          !['Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
            'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array']
            .includes(value.constructor?.name)) {
        fail('復元未対応のバイナリ形式が含まれています。');
      }
      const view = value instanceof ArrayBuffer ?
        new Uint8Array(value) :
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (view.byteLength > MAX_PART_BYTES / 2) fail('単一配列が分割サイズを超えます。');
      return {$type: value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name,
        data: bytesToBase64(view)};
    }
    if (value instanceof Date) return {$type: 'Date', data: value.toISOString()};
    if (value && typeof value === 'object') {
      if (parents.has(value)) fail('保存データが循環参照しています。');
      parents.add(value);
      try {
        if (Array.isArray(value)) {
          // JSON arrays cannot preserve sparse slots or custom enumerable
          // properties. Refuse to silently change a saved structured clone.
          const keys = Object.keys(value);
          if (keys.length !== value.length ||
              keys.some((key, index) => key !== String(index))) {
            fail('復元未対応の配列構造が含まれています。');
          }
          const result = [];
          for (const item of value) result.push(await encodeRecordValue(item, depth + 1, parents));
          return result;
        }
        // IndexedDB can store Map, Set, RegExp and other structured-clone
        // objects, but this JSON v2 format cannot reconstruct them. Without
        // this guard Object.entries() could silently turn such values into {}.
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          fail('復元未対応のオブジェクト形式が含まれています。');
        }
        // The v2 decoder uses $type to turn JSON wrappers back into Blob,
        // Date or typed arrays. A real plain object's own $type property
        // would collide with that marker and could silently change its type
        // on restore (or make the backup impossible to import).
        if (Object.hasOwn(value, '$type')) {
          fail('復元用の予約済み型識別子を持つ保存項目は書き出せません。');
        }
        const result = Object.create(null);
        for (const [key, item] of Object.entries(value)) {
          // The v2 restore decoder deliberately rejects dangerous property
          // names. Reject them during export too; never issue a manifest
          // describing a backup that our own importer cannot decode.
          if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
            fail('安全でない保存キーが含まれています。');
          }
          result[key] = await encodeRecordValue(item, depth + 1, parents);
        }
        return result;
      } finally { parents.delete(value); }
    }
    // JSON.stringify(-0) is "0", which loses the sign even though
    // IndexedDB preserves negative zero. Refuse a lossy v2 export rather
    // than silently changing stored numeric values.
    if (typeof value === 'number' && Object.is(value, -0)) {
      fail('負のゼロはJSON化で符号が失われるため、元データを変えずに書き出しを中止しました。');
    }
    // JSON.stringify silently serializes NaN/Infinity to null, undefined
    // array values to null and undefined object properties to nothing.
    // This would change recorded DNA/diagnostics without any warning.
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
      fail('不正な数値または未定義の値が含まれているため、元データを変えずに書き出しを中止しました。');
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      fail('保存できないデータ型が含まれています。');
    }
    return value;
  }

  // savePart(File, descriptor) must save to durable storage or reject.
  // If it throws, the caller MUST discard any partial files: no successful
  // manifest exists. This is not a live IndexedDB snapshot/export controller.
  async function writePartsFromRecords(records, options, savePart) {
    if (!options || !['cryptic', 'warning'].includes(options.mode) ||
        typeof options.database !== 'string' || !options.database ||
        !GEN_RE.test(options.currentGeneration) || typeof savePart !== 'function' ||
        !records || typeof records[Symbol.asyncIterator] !== 'function') {
      fail('書き出しパラメーターまたは逐次入力が不正です。');
    }
    // Cancellation is advisory while savePart is awaiting an external file
    // handoff. Once the callback settles, refuse to issue a success manifest
    // if the caller cancelled. Previously saved parts must be discarded by
    // the caller; this writer never reports partial success.
    const signal = options.signal;
    if (signal != null && typeof signal.aborted !== 'boolean') {
      fail('中断通知の形式が不正です。');
    }
    const checkCancelled = () => {
      if (signal?.aborted) fail('書き出しが中断されました。');
    };
    checkCancelled();
    const maxPartBytes = options.maxPartBytes ?? MAX_PART_BYTES;
    const maxPartEntries = options.maxPartEntries ?? MAX_PART_ENTRIES;
    const maxTotalEntries = options.maxTotalEntries ?? MAX_TOTAL_ENTRIES;
    if (!integer(maxPartBytes, 1024, MAX_PART_BYTES) ||
        !integer(maxPartEntries, 1, MAX_PART_ENTRIES) ||
        !integer(maxTotalEntries, 1, MAX_TOTAL_ENTRIES)) {
      fail('分割上限の指定が不正です。');
    }
    const parts = [];
    const byStore = {images: 0, meta: 0, theater_frames: 0};
    const requiredImages = new Set(Array.from({length: 60}, (_, i) =>
      options.currentGeneration + ':' + String(i + 1).padStart(2, '0')));
    const requiredGenomes = new Set(Array.from({length: 60}, (_, i) =>
      'genome:' + options.currentGeneration + ':' + String(i + 1).padStart(2, '0')));
    const lastKeys = Object.create(null);
    let pointerFound = false;
    let totalRecords = 0;
    let currentStore = null;
    let storeIndex = -1;
    let chunks = [];
    let size = 0;
    let count = 0;
    let partNodes = 0;
    let prefix = '';

    function makePrefix(store, index) {
      return JSON.stringify({
        schema: PART_SCHEMA, mode: options.mode, database: options.database,
        currentGeneration: options.currentGeneration, index, store, entries: []
      }).slice(0, -2);
    }
    function begin(store) {
      currentStore = store;
      prefix = makePrefix(store, parts.length);
      chunks = [];
      count = 0;
      // JSON structure: root + 7 property values, including entries array.
      partNodes = 8;
      size = utf8(prefix + ']}');
    }
    async function flush() {
      checkCancelled();
      if (!count) return;
      if (parts.length >= MAX_PARTS) fail('分割ファイルの上限を超えました。');
      const filename = 'part-' + String(parts.length).padStart(5, '0') + '.json';
      const file = new File([prefix, chunks.join(','), ']}'], filename,
        {type: 'application/json'});
      if (file.size !== size || file.size > maxPartBytes) {
        fail('分割ファイルの実容量が想定と異なります。');
      }
      const desc = {
        index: parts.length, store: currentStore, file: filename,
        bytes: file.size, entries: count,
        sha256: await sha256(await file.arrayBuffer())
      };
      await savePart(file, desc);
      checkCancelled();
      parts.push(desc);
      chunks = [];
      count = 0;
    }

    for await (const record of records) {
      checkCancelled();
      // Reject oversize input even if parts were written earlier. No
      // success manifest is returned and the underlying DB is untouched.
      if (++totalRecords > maxTotalEntries) fail('総件数の上限を超えました。');
      const store = record?.store;
      const nextIndex = STORES.indexOf(store);
      if (nextIndex < 0 || nextIndex < storeIndex) {
        fail('入力ストアの順序が不正です。');
      }
      if (!orderedKeyAfter(lastKeys[store], record.key)) {
        fail('入力キーの順序または重複が不正です。');
      }
      lastKeys[store] = record.key;
      if (nextIndex !== storeIndex) {
        await flush();
        storeIndex = nextIndex;
        begin(store);
      }
      if (store === 'images') requiredImages.delete(record.key);
      if (store === 'meta') {
        requiredGenomes.delete(record.key);
        if (record.key === 'current_generation_id') {
          if (record.value !== options.currentGeneration) fail('現在世代の参照先が一致しません。');
          pointerFound = true;
        }
      }
      if (!Object.hasOwn(record, 'value') || record.value === undefined) {
        fail('保存項目に値がありません。');
      }
      // Shape check before recursively allocating base64/JSON. The actual
      // encoded byte ceiling remains authoritative after serialization.
      checkDepthAndNodes(record.value);
      const encoded = await encodeRecordValue(record.value);
      checkCancelled();
      const entryText = JSON.stringify({key: record.key, value: encoded});
      if (!entryText) fail('保存項目がJSON化できません。');
      const entryBytes = utf8(entryText);
      // The verifier's MAX_PART_NODES applies to the complete parsed part,
      // not each record. Track exact JSON nodes (record + key + value tree),
      // otherwise many small diagnostic arrays create a part it rejects.
      const entryNodes = 2 + checkDepthAndNodes(encoded);
      if (entryBytes + utf8(makePrefix(store, parts.length) + ']}') > maxPartBytes ||
          8 + entryNodes > MAX_PART_NODES) {
        fail('単一保存項目が分割上限を超えています。');
      }
      if (count && (count >= maxPartEntries ||
          size + 1 + entryBytes > maxPartBytes ||
          partNodes + entryNodes > MAX_PART_NODES)) {
        await flush();
        begin(store);
      }
      const extra = entryBytes + (count ? 1 : 0);
      chunks.push(entryText);
      size += extra;
      partNodes += entryNodes;
      count++;
      byStore[store]++;
    }
    await flush();
    checkCancelled();
    if (!pointerFound || requiredImages.size || requiredGenomes.size) {
      fail('現在世代の参照情報・60匹の画像・DNAが不足しています。');
    }
    const manifest = {
      schema: SCHEMA, mode: options.mode, database: options.database,
      databaseVersion: 2, createdAt: options.createdAt || new Date().toISOString(),
      currentGeneration: options.currentGeneration,
      gameBuild: options.gameBuild ?? null,
      warningLife: options.mode === 'warning' ? (options.warningLife ?? null) : null,
      totals: {
        entries: byStore.images + byStore.meta + byStore.theater_frames,
        byStore
      },
      parts
    };
    validateManifest(manifest, options.mode, options.database);
    const manifestFile = new File([JSON.stringify(manifest)], 'manifest.json',
      {type: 'application/json'});
    if (manifestFile.size > MAX_MANIFEST_BYTES) {
      fail('索引ファイルが大きすぎます。');
    }
    checkCancelled();
    return {manifest, manifestFile};
  }

  return Object.freeze({SCHEMA, PART_SCHEMA, MAX_MANIFEST_BYTES, MAX_PART_BYTES,
    MAX_TOTAL_ENTRIES,
    validateManifest, verifyPartIntegrity, writePartsFromRecords});
});
