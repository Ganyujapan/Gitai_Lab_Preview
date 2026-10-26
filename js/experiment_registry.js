/* STO-02: safe cross-tab experiment slot registry.
 * Run-specific PNG/DNA and exhibition databases are never touched here. */
(() => {
  'use strict';
  if (location.pathname.includes('/exhibit/')) return;
  const LEGACY_KEY = 'gitai-experiment-records-v1';
  const DATABASE = 'gitai-experiment-registry-v2';
  const STORE = 'state';
  const KEY = 'records';
  const LIMIT = 10;
  let dbPromise = null;
  let initPromise = null;
  let cache = [];
  let revision = -1;
  const subscribers = new Set();
  let channel = null;

  function validRecord(item) {
    return item && typeof item === 'object'
      && /^[a-z0-9_-]{1,48}$/i.test(String(item.id || ''))
      && typeof item.dbName === 'string' && item.dbName.length > 0
      && typeof item.name === 'string'
      && item.config && typeof item.config === 'object'
      && !Array.isArray(item.config);
  }
  function validateRecords(records) {
    if (!Array.isArray(records) || records.length > LIMIT
        || !records.every(validRecord)) {
      throw Error('保存記録の形式または件数を確認できません。元の記録は変更していません。');
    }
    const ids = new Set(), databases = new Set();
    for (const item of records) {
      if (ids.has(item.id) || databases.has(item.dbName)) {
        throw Error('重複した保存記録があります。元の記録は変更していません。');
      }
      ids.add(item.id);
      databases.add(item.dbName);
    }
    return records;
  }
  function readLegacy() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return [];
    let doc;
    try { doc = JSON.parse(raw); } catch (_) {
      throw Error('旧形式の保存記録を読み込めません。バックアップを確認してください。');
    }
    if (!doc || doc.version !== 1) {
      throw Error('旧形式の保存記録が未対応です。元の記録は変更していません。');
    }
    return validateRecords(doc.records).map(x => ({...x,config:{...x.config}}));
  }
  function openRegistry() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject) => {
      const request = indexedDB.open(DATABASE,1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
          initPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error || Error('セーブ一覧を開けませんでした。'));
      request.onblocked = () => reject(Error('他のタブが保存一覧の更新を妨げています。'));
    }).catch(error => {dbPromise=null;throw error});
    return dbPromise;
  }
  function setCache(value) {
    if (!value || value.version !== 2 || !Number.isSafeInteger(value.revision)
        || value.revision < 0) {
      throw Error('保存一覧の形式が不正です。データは変更していません。');
    }
    validateRecords(value.records);
    if (value.revision >= revision) {
      revision = value.revision;
      cache = value.records.map(item => ({...item,config:{...item.config}}));
      for (const subscriber of subscribers) {
        try { subscriber(cache.slice()); } catch (error) { console.error(error); }
      }
    }
  }
  function startTransaction(mode, action) {
    return openRegistry().then(db => new Promise((resolve,reject) => {
      const tx = db.transaction(STORE,mode);
      const store = tx.objectStore(STORE);
      let output, value, issue;
      tx.oncomplete = () => {
        if (value) setCache(value);
        resolve(output);
      };
      tx.onabort = () => reject(issue || tx.error || Error('セーブ一覧の操作が中断されました。'));
      tx.onerror = () => { /* abort rejects the entire transaction */ };
      try { action(store,tx,(v,result) => {value=v;output=result}) }
      catch (error) {issue=error;try{tx.abort()}catch(_){reject(error)}}
    }));
  }
  async function initialize() {
    // Migration is a single serializable transaction. Two new tabs cannot
    // both overwrite each other's initial snapshot.
    const legacy = readLegacy();
    await startTransaction('readwrite',(store,tx,accept)=>{
      const req = store.get(KEY);
      req.onsuccess = () => {
        try {
          const state = req.result;
          if (state !== undefined) {
            if (state.version !== 2 || !Number.isSafeInteger(state.revision)) {
              throw Error('新形式の保存記録が不正です。元の記録は変更していません。');
            }
            validateRecords(state.records);
            accept(state,state.records);
          } else {
            const created = {version:2,revision:0,records:legacy};
            store.put(created,KEY);
            accept(created,legacy);
          }
        } catch (error) {
          // Never create a blank registry over unrecognized old data.
          tx.abort();
        }
      };
    });
  }
  function ready() {
    if (!initPromise) {
      initPromise = initialize().catch(error => {initPromise=null;throw error});
    }
    return initPromise.then(()=>cache.slice());
  }
  async function refresh() {
    await ready();
    return startTransaction('readonly',(store,tx,accept)=>{
      const req=store.get(KEY);
      req.onsuccess=()=>{
        const state=req.result;
        if (!state || state.version!==2 || !Number.isSafeInteger(state.revision)) {
          tx.abort();return;
        }
        try {validateRecords(state.records);accept(state,state.records)}
        catch (_) {tx.abort()}
      };
    });
  }
  async function mutate(op,record) {
    await ready();
    const result = await startTransaction('readwrite',(store,tx,accept)=>{
      const req = store.get(KEY);
      req.onsuccess=()=>{
        let state = req.result;
        try {
          if (!state || state.version!==2) throw Error('保存一覧が不正です。');
          const records=validateRecords(state.records);
          let updated=records.slice(), outcome=null, changed=false;
          if (op==='add') {
            const existing=records.find(x=>x.dbName===record.dbName);
            if (existing) outcome=existing;
            else {
              if (records.length>=LIMIT) throw Error('セーブスロットが満杯です。');
              if (!validRecord(record)||records.some(x=>x.id===record.id)) {
                throw Error('実験の識別情報が重複または不正です。');
              }
              updated=[...records,record]; outcome=record;changed=true;
            }
          } else if(op==='rename') {
            const index=records.findIndex(x=>x.id===record.id && x.dbName===record.dbName);
            if(index<0) throw Error('変更する実験が見つかりません。');
            updated[index]={...records[index],name:record.name};outcome=updated[index];changed=true;
          } else if(op==='remove') {
            updated=records.filter(x=>!(x.id===record.id && x.dbName===record.dbName));
            changed=updated.length!==records.length;outcome=changed;
          } else throw Error('未対応の保存一覧操作です。');
          if(changed){
            validateRecords(updated);
            state={version:2,revision:state.revision+1,records:updated};
            store.put(state,KEY);
          }
          accept(state,outcome);
        } catch(error) {
          // Abort prevents a partial or silently failed operation. The
          // request's handler is synchronous (no awaits inside transaction).
          tx.abort();
        }
      };
    });
    if (channel) {
      try {channel.postMessage({type:'changed'})} catch (_) {}
    }
    return result;
  }
  function snapshot(){return cache.map(x=>({...x,config:{...x.config}}))}
  function subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn)}
  if(typeof BroadcastChannel==='function'){
    try{
      channel=new BroadcastChannel('gitai-experiment-registry-v2');
      channel.onmessage=()=>{void refresh().catch(console.warn)};
    }catch(_){}
  }
  window.addEventListener('pageshow',()=>{void refresh().catch(console.warn)});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden) void refresh().catch(console.warn);
  });
  window.GitaiExperimentRegistry=Object.freeze({
    ready,refresh,mutate,snapshot,subscribe
  });
})();