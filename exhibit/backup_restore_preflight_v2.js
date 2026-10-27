/* Read-only, semantic restore preflight for split exhibit backups.
 * UNWIRED: never imports production DB, never stages data and never restores.
 * Passing these checks does NOT authorize an irreversible restore.
 * Validators MUST be the SAME current PNG/genome validators as the shipped v1
 * admin importer; omitting them is an error, never an optional fast path.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitaiBackupRestorePreflightV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_DEPTH = 36;
  const MAX_BINARY_BYTES = 8 * 1024 * 1024;
  const BINARY_TYPES = Object.freeze({
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array
  });
  const fail = message => { throw Error('復元前の内容検証に失敗：' + message); };
  const typed = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value);

  function decodeBase64(value) {
    if (typeof value !== 'string' || value.length > MAX_BINARY_BYTES * 2 ||
        value.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      fail('バイナリデータの文字列が不正です。');
    }
    const binary = atob(value);
    if (binary.length > MAX_BINARY_BYTES) fail('バイナリデータが大きすぎます。');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function decodeValue(value, depth = 0) {
    if (depth > MAX_DEPTH) fail('保存データが深すぎます。');
    if (Array.isArray(value)) return value.map(item => decodeValue(item, depth + 1));
    if (typed(value)) {
      if (Object.hasOwn(value, '$type')) {
        const type = value.$type;
        if (typeof type !== 'string') fail('型識別子が不正です。');
        const allowedKeys = type === 'Blob'
          ? ['data', 'mime', '$type'] : type === 'Date'
            ? ['data', '$type'] : ['data', '$type'];
        if (Object.keys(value).some(key => !allowedKeys.includes(key)) ||
            !Object.hasOwn(value, 'data')) fail('型付きデータの構造が不正です。');
        if (type === 'Date') {
          if (typeof value.data !== 'string' || value.data.length > 40 ||
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.data)) {
            fail('日時データの形式が不正です。');
          }
          const date = new Date(value.data);
          if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.data) {
            fail('日時が不正です。');
          }
          return date;
        }
        if (type === 'Blob' && (typeof value.mime !== 'string' ||
            value.mime.length > 128)) fail('Blobの種類が不正です。');
        const bytes = decodeBase64(value.data);
        if (type === 'Blob') return new Blob([bytes], {type: value.mime});
        if (type === 'ArrayBuffer') return bytes.buffer;
        if (!Object.hasOwn(BINARY_TYPES, type)) fail('未対応のデータ型が含まれています：' + type);
        const Constructor = BINARY_TYPES[type];
        if (bytes.length % Constructor.BYTES_PER_ELEMENT !== 0) {
          fail('配列の要素幅が一致しません。');
        }
        return new Constructor(bytes.buffer);
      }
      const result = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          fail('安全でないプロパティ名が含まれています。');
        }
        result[key] = decodeValue(item, depth + 1);
      }
      return result;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))) return value;
    fail('JSONに保存できない値が含まれています。');
  }

  // Structural/integrity verification invokes onRecord before ALL parts have
  // been checked. This callback MUST remain read-only; staging/writing within
  // it could leave incomplete data if a later part fails verification.
  async function preflightSemanticRestore({
    manifestFile, partFiles, mode, database, partApi,
    checkGenome, checkMothPng
  }) {
    if (!partApi || typeof partApi.verifyPartIntegrity !== 'function' ||
        !['cryptic', 'warning'].includes(mode) || !database ||
        typeof checkGenome !== 'function' ||
        typeof checkMothPng !== 'function') {
      fail('必須の厳格なPNG・DNA検証処理がありません。');
    }
    const currentKeys = new Set();
    let checkedGenomes = 0, checkedPngs = 0, decoded = 0;
    const result = await partApi.verifyPartIntegrity(
      manifestFile, partFiles, mode, database,
      async (store, key, encoded) => {
        const value = decodeValue(encoded);
        decoded++;
        if (store === 'meta' && typeof key === 'string' &&
            /^genome:gen(?:\d{5}|[1-9]\d{5,}):\d{2}$/.test(key)) {
          // Only the current generation requires strict schema-v1 validation;
          // historical records may legitimately use an older experiment model.
          const parts = key.split(':');
          const index = Number(parts[2]);
          if (parts[1] === currentGeneration && index >= 1 && index <= 60) {
            checkGenome(value, index, mode);
            checkedGenomes++;
            currentKeys.add('g:' + index);
          }
        }
        if (store === 'images' && typeof key === 'string' &&
            /^gen(?:\d{5}|[1-9]\d{5,}):\d{2}$/.test(key)) {
          const parts = key.split(':');
          const index = Number(parts[1]);
          if (parts[0] === currentGeneration && index >= 1 && index <= 60) {
            await checkMothPng(value, index);
            checkedPngs++;
            currentKeys.add('p:' + index);
          }
        }
      });
    if (result.generation !== currentGeneration || checkedGenomes !== 60 ||
        checkedPngs !== 60 || currentKeys.size !== 120 ||
        decoded !== result.entries) {
      fail('現在世代60匹のPNG・DNA内容をすべて検証できませんでした。');
    }
    return Object.freeze({
      mode, generation: currentGeneration, entries: decoded,
      checkedGenomes, checkedPngs,
      semanticChecked: true, safeToRestore: false,
      explanation: '破損検査のみ。原子的復元と保存先の安全性検証は別途必要です。'
    });

    // A manifest is parsed read-only up front, with strict expected mode/DB.
    // The same verifier reopens and validates it (and SHA-256) before return.
  }

  // Keep generation locked to the manifest's validated pointer BEFORE the
  // callback is used; verifyPartIntegrity itself verifies this pointer.
  async function preflightRestore(options) {
    if (!options || !options.partApi ||
        typeof options.partApi.validateManifest !== 'function' ||
        !options.manifestFile || !Number.isFinite(options.manifestFile.size) ||
        options.manifestFile.size <= 0 ||
        options.manifestFile.size > options.partApi.MAX_MANIFEST_BYTES) {
      fail('索引または検証器が不正です。');
    }
    let manifest;
    try { manifest = JSON.parse(await options.manifestFile.text()); }
    catch (_) { fail('索引JSONを読めません。'); }
    options.partApi.validateManifest(manifest, options.mode, options.database);
    // Independent immutable variable for concurrent source changes; never
    // trust caller-supplied generation IDs.
    return preflightSemanticRestore({...options, generation: manifest.currentGeneration});
  }

  return Object.freeze({decodeValue, preflightRestore});
});
