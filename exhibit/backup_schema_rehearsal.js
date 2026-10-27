/* Isolated, opt-in Safari/IndexedDB v2→v3 backup-stage rehearsal.
 * NEVER opens, upgrades or deletes actual exhibit game databases.
 * NOT imported by any game, admin, or other production entry point.
 * A new sandbox name is generated for every button press.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitaiBackupSchemaRehearsal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFIX = 'gitai-backup-rehearsal-';
  const SOURCE_STORES = Object.freeze(['images', 'meta', 'theater_frames']);
  const STAGE_STORE = 'backup_v2_stage';
  const GENERATION = 'gen00042';

  function uniqueSandboxName(cryptoApi) {
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
      throw new Error('安全な乱数がないため隔離DBの作成を中止しました。');
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return PREFIX + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  function assertSandboxName(name) {
    if (typeof name !== 'string' ||
        !/^gitai-backup-rehearsal-[0-9a-f]{32}$/.test(name)) {
      throw new Error('隔離試験以外のDB名は禁止されています。');
    }
    return name;
  }
  // Called ONLY inside the isolated database's IDB onupgradeneeded event.
  // Object stores and data from v2 are never deleted, cleared or copied.
  function stageUpgradeOnly(db, previousVersion) {
    if (previousVersion !== 2 || db.version !== 3 ||
        SOURCE_STORES.some(s => !db.objectStoreNames.contains(s)) ||
        db.objectStoreNames.contains(STAGE_STORE)) {
      throw new Error('想定外のスキーマです。更新を中断します。');
    }
    db.createObjectStore(STAGE_STORE);
  }
  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }
  function txFinished(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      tx.onerror = () => {}; // abort is the authoritative failure
    });
  }
  function openAtVersion(idb, name, version, {upgrade, blocked} = {}) {
    assertSandboxName(name);
    return new Promise((resolve, reject) => {
      const req = idb.open(name, version);
      let failure = null;
      req.onupgradeneeded = event => {
        try {
          if (typeof upgrade !== 'function') throw new Error('予期しないDB更新です。');
          upgrade(req.result, req.transaction, event.oldVersion);
        } catch (error) {
          failure = error;
          try { req.transaction.abort(); } catch (_) {}
        }
      };
      req.onerror = () => reject(failure || req.error || new Error('DBを開けません。'));
      req.onblocked = () => { if (blocked) blocked(); };
      req.onsuccess = () => resolve(req.result);
    });
  }
  function deleteSandbox(idb, name) {
    assertSandboxName(name);
    return new Promise((resolve, reject) => {
      const req = idb.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('隔離DBを削除できません。'));
      req.onblocked = () => reject(new Error('隔離DBが他のタブで使用されています。'));
    });
  }
  async function seedV2(idb, name) {
    const db = await openAtVersion(idb, name, 2, {
      upgrade(db, tx, previous) {
        if (previous !== 0) throw new Error('新規隔離DBではありません。');
        for (const store of SOURCE_STORES) db.createObjectStore(store);
      }
    });
    try {
      const tx = db.transaction(SOURCE_STORES, 'readwrite');
      const completion = txFinished(tx);
      const images = tx.objectStore('images');
      const meta = tx.objectStore('meta');
      const theater = tx.objectStore('theater_frames');
      meta.put(GENERATION, 'current_generation_id');
      for (let i = 1; i <= 60; i++) {
        const n = String(i).padStart(2, '0');
        const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,i])],
          {type: 'image/png'});
        images.put(blob, GENERATION + ':' + n);
        meta.put({schema_version: 1, marker: 'SANDBOX-ONLY', number: i},
          'genome:' + GENERATION + ':' + n);
      }
      theater.put({marker: 'SANDBOX-ONLY', generation: GENERATION},
        'theater:' + GENERATION);
      await completion;
    } finally { db.close(); }
  }
  async function getV2Report(db) {
    const tx = db.transaction(SOURCE_STORES, 'readonly');
    const done = txFinished(tx);
    const get = idbRequest(tx.objectStore('meta').get('current_generation_id'));
    const counts = SOURCE_STORES.map(s => idbRequest(tx.objectStore(s).count()));
    const [pointer, ...sizes] = await Promise.all([get, ...counts]);
    await done;
    return {pointer, sizes};
  }
  function assertReport(report) {
    if (report.pointer !== GENERATION ||
        report.sizes.join(',') !== '60,61,1') {
      throw new Error('元のv2データが一致しません：' + JSON.stringify(report));
    }
  }
  async function runRehearsal({
    indexedDb = globalThis.indexedDB,
    cryptoApi = globalThis.crypto,
    onPhase = () => {},
    checkpointApi = globalThis.GitaiBackupCheckpointV2,
    backupApi = globalThis.GitaiBackupV2
  } = {}) {
    if (!indexedDb || !checkpointApi || !backupApi ||
        typeof checkpointApi.makeCheckpoint !== 'function' ||
        typeof backupApi.writePartsFromRecords !== 'function') {
      throw new Error('隔離試験の必須モジュールが読み込めません。');
    }
    const name = uniqueSandboxName(cryptoApi);
    let db = null, blocker = null, blocked = false, downgradeError = false;
    let written = 0, checkpointEntries = 0;
    try {
      onPhase('隔離DBを新規作成し、60匹の画像・DNAと世代番号を保存');
      await seedV2(indexedDb, name);
      blocker = await openAtVersion(indexedDb, name, 2);
      assertReport(await getV2Report(blocker));
      onPhase('v2→v3の中断を試し、元のデータが残るか検証');
      try {
        await openAtVersion(indexedDb, name, 3, {
          upgrade(db, tx) {
            stageUpgradeOnly(db, 2);
            tx.abort();
          },
          blocked() { blocker?.close(); }
        });
        throw new Error('中断した移行が予期せず完了しました。');
      } catch (error) {
        // AbortError is expected; a synthetic success error is NOT.
        if (/予期せず完了/.test(error.message)) throw error;
      }
      blocker.close();
      blocker = null;
      blocker = await openAtVersion(indexedDb, name, 2);
      assertReport(await getV2Report(blocker));
      if (blocker.objectStoreNames.contains(STAGE_STORE)) {
        throw new Error('中断後も新しいストアが残っています。');
      }
      onPhase('古い接続を開いたまま移行し、onblockedを検証');
      let releaseGuard = null;
      try {
        // Safety valve for browsers with unusual blocked event timing.
        releaseGuard = setTimeout(() => { blocker?.close(); }, 4500);
        db = await openAtVersion(indexedDb, name, 3, {
          upgrade(targetDb, tx, oldVersion) {
            stageUpgradeOnly(targetDb, oldVersion);
          },
          blocked() { blocked = true; blocker?.close(); }
        });
      } finally {
        if (releaseGuard !== null) clearTimeout(releaseGuard);
        blocker?.close();
        blocker = null;
      }
      if (!blocked) throw new Error('旧タブによる移行ブロックを検証できませんでした。');
      if (db.version !== 3 || !db.objectStoreNames.contains(STAGE_STORE)) {
        throw new Error('v3スキーマ移行が完了していません。');
      }
      assertReport(await getV2Report(db));
      onPhase('古いv2コードのVersionErrorを確認');
      try {
        const old = await openAtVersion(indexedDb, name, 2);
        old.close();
      } catch (error) {
        if (error.name === 'VersionError') downgradeError = true;
        else throw error;
      }
      if (!downgradeError) throw new Error('古いv2接続が拒否されませんでした。');
      onPhase('一貫した一時コピーを作成して分割ファイルを検証');
      const snapshotId = 'rehearsal-' + name.slice(-32);
      const cp = await checkpointApi.makeCheckpoint(db, snapshotId);
      checkpointEntries = cp.entries;
      if (cp.generation !== GENERATION || cp.entries !== 122) {
        throw new Error('一時コピーの件数または世代が一致しません。');
      }
      const files = [];
      const {manifestFile} = await backupApi.writePartsFromRecords(
        checkpointApi.readCheckpoint(db, snapshotId, cp.entries, {batchSize:8}),
        {mode:'cryptic', database:name, currentGeneration:GENERATION,
          maxPartBytes:4096, maxPartEntries:12},
        async file => { files.push(file); }
      );
      const verified = await backupApi.verifyPartIntegrity(
        manifestFile, files, 'cryptic', name);
      written = verified.entries;
      if (written !== 122 || files.length < 2) {
        throw new Error('分割ファイルの往復整合性が確認できません。');
      }
      await checkpointApi.discardCheckpoint(db, snapshotId);
      assertReport(await getV2Report(db));
      return {success:true, blocked, downgradeError,
        preservedGeneration: GENERATION, copiedEntries: checkpointEntries,
        verifiedEntries: written, files: files.length,
        note:'隔離DBのみ。展示用データは一切変更していません。'};
    } finally {
      try { db?.close(); } catch (_) {}
      try { blocker?.close(); } catch (_) {}
      try {
        onPhase('隔離テストDBを削除');
        await deleteSandbox(indexedDb, name);
      } catch (error) {
        onPhase('隔離DBの後片付けに失敗：' + error.message +
          ' （実験データではありません）');
      }
    }
  }

  return Object.freeze({PREFIX, SOURCE_STORES, STAGE_STORE, GENERATION,
    uniqueSandboxName, assertSandboxName, stageUpgradeOnly, runRehearsal});
});
