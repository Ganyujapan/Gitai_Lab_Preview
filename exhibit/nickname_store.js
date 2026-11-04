/* Exhibition opt-in visitor nameplate. Name data is a small META record in the
   existing mode database, so v1 JSON backup and reset include it automatically.
   No writes are made on startup or while browsing the theater. */
(() => {
  'use strict';
  const PREFIX = 'exhibit_visit_nickname_v1:';
  const NAMESPACES = new Set([
    'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic',
    'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2'
  ]);
  const MAX_NAME_CHARS = 20;

  function cleanedName(value) {
    return [...String(value || '').normalize('NFC')
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e]/g, '').trim()]
      .slice(0, MAX_NAME_CHARS).join('');
  }
  function validRange(start, end) {
    return Number.isSafeInteger(start) && start > 0 &&
      Number.isSafeInteger(end) && end >= start && end - start <= 4;
  }
  function validMode(name) {
    if (!NAMESPACES.has(name)) throw Error('この展示モードには名前を保存できません。');
  }
  function expectedGeneration(end) {
    return 'gen' + String(end + 1).padStart(5, '0');
  }
  function nameKey(start, end) {
    return PREFIX + String(start).padStart(8, '0') + ':' + String(end).padStart(8, '0');
  }
  function openExisting(name) {
    validMode(name);
    return new Promise((resolve, reject) => {
      let absent = false;
      const request = indexedDB.open(name); // NO version upgrade or creation.
      request.onupgradeneeded = () => {
        absent = true;
        try { request.transaction.abort(); }
        catch (error) { reject(error); }
      };
      request.onerror = () => {
        if (absent) reject(Error('進化データが見つからないため名前を保存できません。'));
        else reject(request.error || Error('進化データを開けませんでした。'));
      };
      request.onblocked = () => reject(Error('別のゲーム画面が開いています。'));
      request.onsuccess = () => {
        const db = request.result;
        if (db.version !== 2 || !db.objectStoreNames.contains('meta')) {
          db.close(); reject(Error('保存形式を確認できません。')); return;
        }
        resolve(db);
      };
    });
  }
  async function read(database) {
    const db = await openExisting(database);
    try {
      return await new Promise((resolve, reject) => {
        const rows = [];
        const tx = db.transaction('meta', 'readonly');
        const range = IDBKeyRange.bound(PREFIX, PREFIX + '\uffff');
        const request = tx.objectStore('meta').openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const value = cursor.value;
          if (value && validRange(value.start, value.end) &&
              typeof value.name === 'string' && cleanedName(value.name)) {
            rows.push({start:value.start,end:value.end,name:cleanedName(value.name)});
          }
          cursor.continue();
        };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = () => reject(tx.error || Error('ニックネームを読み込めません。'));
        tx.onabort = () => reject(tx.error || Error('ニックネームの読込が中断されました。'));
      });
    } finally {
      db.close();
    }
  }
  async function save(database, start, end, rawName) {
    const name = cleanedName(rawName);
    if (!name) return false; // Blank means opt out and never writes.
    if (!validRange(start,end)) throw Error('参加世代を確認できません。');
    const db = await openExisting(database);
    try {
      await new Promise((resolve,reject) => {
        const tx = db.transaction('meta','readwrite');
        const store = tx.objectStore('meta');
        const get = store.get('current_generation_id');
        get.onsuccess = () => {
          // The previous player already committed the next generation.
          // Never attach a name to a different/restarted/restored Run.
          if (get.result !== expectedGeneration(end)) {
            tx.abort();
            reject(Error('世代が変更されました。名前は保存していません。'));
            return;
          }
          store.put({start,end,name}, nameKey(start,end));
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || Error('ニックネームを保存できませんでした。'));
        tx.onabort = () => reject(tx.error || Error('ニックネームの保存が中断されました。'));
      });
      return true;
    } finally {
      db.close();
    }
  }
  window.GitaiExhibitNicknameStore = Object.freeze({read,save,cleanedName});
})();
