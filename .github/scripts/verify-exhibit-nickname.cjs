'use strict';
// Synthetic iPad IndexedDB checks: no real evolution data or DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('exhibit/nickname_store.js', 'utf8');
const theater = fs.readFileSync('exhibit/theater_canvas_20261026.js', 'utf8');
const html = fs.readFileSync('exhibit/modes.html', 'utf8');
const build = fs.readFileSync('exhibit/build.py', 'utf8');
const admin = fs.readFileSync('exhibit/admin.js', 'utf8');
const cryptic = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
assert.match(html, /id="exhibitHandoverNickname"/);
assert.match(html, /id="exhibitTheaterNickname"/);
assert.match(html, /src="nickname_store.js" defer/);
assert.ok(html.indexOf('src="nickname_store.js"') <
  html.indexOf('src="theater_canvas_20261026.js"'));
assert.match(build, /"nickname_store.js"/);
assert.match(theater, /picture\\.putImageData\\(patch, left, startY\\)/);
assert.match(theater, /picture\\.getImageData\\(left, 49/);
assert.doesNotMatch(theater, /store\\.put\\(.*nickname/i);
assert.match(theater, /await store\.save\(mode\.db, handoverData\.start, handoverData\.end, name\)/);
// Existing v1 exporter snapshots the entire meta store and includes all keys.
assert.match(admin, /const STORES = \['images', 'meta', 'theater_frames'\]/);
assert.match(admin, /snapshotStores\(db\)/);

function harness(generation = 'gen00026') {
  const metadata = new Map([['current_generation_id', generation]]);
  const modes = [], writes = [];
  let opens = 0, closes = 0;
  const db = {
    version:2, objectStoreNames:{contains:s=>s==='meta'},
    close(){closes++},
    transaction(store, mode) {
      assert.equal(store, 'meta');
      modes.push(mode);
      const tx = {
        abort(){queueMicrotask(()=>tx.onabort?.())},
        objectStore() {
          return {
            get(key) {
              const r = {};
              queueMicrotask(()=>{
                r.result = metadata.get(key);
                r.onsuccess?.();
              });
              return r;
            },
            put(value,key) {
              assert.equal(mode,'readwrite');
              queueMicrotask(()=>{
                writes.push(key);metadata.set(key,value);
                tx.oncomplete?.();
              });
            },
            openCursor(range) {
              assert.equal(mode,'readonly');
              const keys = [...metadata.keys()].filter(k=>
                k >= range.lower && k <= range.upper).sort();
              const request = {};
              let at = 0;
              const pump = () => {
                if (at >= keys.length) {
                  request.result = null; request.onsuccess?.();
                  queueMicrotask(()=>tx.oncomplete?.());
                  return;
                }
                const key = keys[at++];
                request.result = {key,value:metadata.get(key),
                  continue(){queueMicrotask(pump)}};
                request.onsuccess?.();
              };
              queueMicrotask(pump);
              return request;
            }
          };
        }
      };
      return tx;
    }
  };
  const indexedDB = {open(name) {
    assert.equal(name,cryptic);
    opens++;
    const req={};
    queueMicrotask(()=>{req.result=db;req.onsuccess?.()});
    return req;
  }};
  const window={};
  vm.runInNewContext(source,{indexedDB,window,IDBKeyRange:{
    bound:(lower,upper)=>({lower,upper})
  },queueMicrotask,Promise,Error,Set,String,Number,Object},{
    filename:'exhibit/nickname_store.js',timeout:3000
  });
  return {api:window.GitaiExhibitNicknameStore,metadata,writes,modes,
    get opens(){return opens},get closes(){return closes}};
}
(async()=>{
  const h=harness();
  assert.equal(await h.api.save(cryptic,21,25,'   '),false,
    'opt-out leaves both DB and evolution untouched');
  assert.equal(h.opens,0);
  assert.deepEqual(h.writes,[]);
  const saved=await h.api.save(cryptic,21,25,'  蛾博士  ');
  assert.equal(saved,true);
  assert.equal(h.writes.length,1);
  assert.match(h.writes[0],/^exhibit_visit_nickname_v1:/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.metadata.get(h.writes[0]))),
    {start:21,end:25,name:'蛾博士'});
  const previouslyWritten = h.writes.length;
  const names = await h.api.read(cryptic);
  assert.deepEqual(JSON.parse(JSON.stringify(names)),[{start:21,end:25,name:'蛾博士'}]);
  assert.equal(h.writes.length,previouslyWritten,'reading a name must never write');
  assert.equal(h.modes.at(-1),'readonly');
  assert.equal(h.opens,h.closes,'DB connections must be closed');

  // Generation numbering changes after restore/another tab: fail closed.
  h.metadata.set('current_generation_id','gen00077');
  await assert.rejects(h.api.save(cryptic,26,30,'別人'),/世代が変更/);
  assert.equal(h.writes.length,previouslyWritten);
  await assert.rejects(h.api.save(cryptic,31,28,'invalid'),/参加世代/);
  assert.equal(h.writes.length,previouslyWritten);
  await assert.rejects(h.api.save('unrelated-database',21,25,'X'),/展示モード/);
  assert.equal(h.writes.length,previouslyWritten);
  assert.equal(h.api.cleanedName('\u202e  abc\n'), 'abc');
  assert.equal([...h.api.cleanedName('あ'.repeat(100))].length,20);

  // An administrator-reset database has no old nickname records.
  const reset=harness('gen00001');
  assert.equal((await reset.api.read(cryptic)).length,0);
  assert.ok(reset.modes.every(mode=>mode==='readonly'));
  console.log('Exhibition nicknames: optional opt-out, one guarded meta-only save, read-only history, backup scope, reset scope, stale generation rejection PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
