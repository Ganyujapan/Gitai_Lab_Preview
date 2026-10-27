/* Read-only eligibility audit for a future exhibit backup checkpoint store.
 * NOT loaded by the exhibition pages. Never opens a higher IDB version and
 * never creates/deletes stores or records. No schema migration is authorized.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitaiBackupUpgradePreflightV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EXPECTED_SOURCE = Object.freeze(['images', 'meta', 'theater_frames']);
  const STAGE_STORE = 'backup_v2_stage';
  const TARGET_VERSION = 3;
  const GEN_RE = /^gen(?:\d{5}|[1-9]\d{5,})$/;

  function summarizeCompatibility(dbVersion, runtimeVersions) {
    const versions = runtimeVersions && typeof runtimeVersions === 'object'
      ? runtimeVersions : {};
    const required = ['game', 'admin', 'theater'];
    const compatible = required.every(name =>
      Number.isSafeInteger(versions[name]) && versions[name] === dbVersion);
    return {
      compatible,
      runtimeVersions: Object.fromEntries(required.map(key =>
        [key, Number.isSafeInteger(versions[key]) ? versions[key] : null])),
      // A future v3 cannot be used by a shipped opener that requests v2:
      // the browser raises VersionError. Merely creating the staging store
      // without atomically shipping all callers is NOT a safe migration.
      incompatibleReaders: required.filter(key => versions[key] !== dbVersion)
    };
  }

  // Calling indexedDB.open(name) with NO explicit version is intentional:
  // it opens whatever existing version is present without upgrading it.
  // For a missing database an open request would implicitly create v1;
  // abort the new-database versionchange and report it as missing instead.
  // This function does not call storage.persist, request quota, clear,
  // deleteDatabase, or any readwrite transaction.
  function inspectExistingDb(name, {
    indexedDb = globalThis.indexedDB,
    runtimeVersions,
    storageEstimate = null,
    onBlocked = () => {}
  } = {}) {
    if (typeof name !== 'string' || name.length === 0 ||
        !indexedDb || typeof indexedDb.open !== 'function') {
      return Promise.reject(new Error('バックアップ移行調査：DB名または接続が不正です。'));
    }
    return new Promise((resolve, reject) => {
      let missing = false, settled = false;
      let db = null;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        try { db?.close(); } catch (_) {}
        if (error) reject(error);
        else resolve(result);
      }
      let req;
      try { req = indexedDb.open(name); }
      catch (error) { reject(error); return; }
      req.onblocked = () => {
        // A blocked request is still live. Do NOT falsely reject+abandon an
        // open request that may later succeed (or upgrade) after a tab closes.
        try { onBlocked(); } catch (_) {}
      };
      req.onupgradeneeded = event => {
        if (event.oldVersion === 0) {
          missing = true;
          try { req.transaction.abort(); }
          catch (error) { finish(error); }
        } else {
          // A versionless open should not migrate any existing DB.
          try { req.transaction.abort(); } catch (_) {}
          finish(new Error('バックアップ移行調査：予期しないバージョン更新です。'));
        }
      };
      req.onerror = () => {
        if (missing) {
          finish(null, {status: 'missing', migrationAllowed: false,
            explanation: '実験データベースが存在しません。新規DBの生成は中止しました。'});
        } else finish(req.error || new Error('バックアップ移行調査：読込みに失敗しました。'));
      };
      req.onsuccess = () => {
        db = req.result;
        if (missing) {
          finish(new Error('バックアップ移行調査：新規DBの中断後に接続が成立しました。'));
          return;
        }
        const version = db.version;
        const sourceStoresPresent = EXPECTED_SOURCE.every(key =>
          db.objectStoreNames.contains(key));
        const stageStorePresent = db.objectStoreNames.contains(STAGE_STORE);
        const compatibility = summarizeCompatibility(version, runtimeVersions);
        const summary = {
          status: 'inspected',
          dbVersion: version,
          sourceStoresPresent,
          stageStorePresent,
          targetVersion: TARGET_VERSION,
          ...compatibility,
          currentGeneration: null,
          storedEntries: null,
          storageEstimate: null,
          migrationAllowed: false,
          // Even when all checks pass, explicit approval and real-device
          // validation are prerequisites; a read-only preflight does not
          // automatically authorize a production schema upgrade.
          requiresExplicitMigrationApproval: true
        };
        if (!sourceStoresPresent) {
          summary.status = 'invalid-source-schema';
          finish(null, summary);
          return;
        }
        let tx;
        try {
          tx = db.transaction(EXPECTED_SOURCE, 'readonly');
          const counts = {};
          let generation = null;
          const metaReq = tx.objectStore('meta').get('current_generation_id');
          metaReq.onsuccess = () => { generation = metaReq.result; };
          for (const store of EXPECTED_SOURCE) {
            const countReq = tx.objectStore(store).count();
            countReq.onsuccess = () => { counts[store] = countReq.result; };
          }
          tx.onabort = () => finish(tx.error ||
            new Error('バックアップ移行調査：読み取りが中断されました。'));
          tx.onerror = () => {};
          tx.oncomplete = async () => {
            summary.currentGeneration = typeof generation === 'string' && GEN_RE.test(generation)
              ? generation : null;
            summary.storedEntries = counts;
            summary.stagePrepared = version === TARGET_VERSION && stageStorePresent;
            summary.gameCanOpenThisDatabase = compatibility.compatible;
            try {
              if (typeof storageEstimate === 'function') {
                const estimate = await storageEstimate();
                const usage = estimate?.usage, quota = estimate?.quota;
                if (Number.isFinite(usage) && usage >= 0 &&
                    Number.isFinite(quota) && quota >= usage) {
                  summary.storageEstimate = {usage, quota,
                    estimatedFreeBytes: quota - usage,
                    // Browser estimates are not a guarantee that an IDB
                    // transaction will have sufficient quota to commit.
                    sufficientForCheckpoint: 'unverified'};
                }
              }
            } catch (_) { /* quota estimate is advisory only */ }
            summary.status = !summary.currentGeneration
              ? 'invalid-generation' : 'inspected';
            finish(null, summary);
          };
        } catch (error) { finish(error); }
      };
    });
  }

  return Object.freeze({STAGE_STORE, TARGET_VERSION, EXPECTED_SOURCE,
    summarizeCompatibility, inspectExistingDb});
});
