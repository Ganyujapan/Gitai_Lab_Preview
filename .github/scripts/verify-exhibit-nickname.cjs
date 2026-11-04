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
const warning = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2';
assert.match(html, /id="exhibitHandoverNickname"/);
assert.match(html, /id="exhibitTheaterNickname"/);
assert.match(html, /src="nickname_store.js" defer/);
assert.ok(html.indexOf('src="nickname_store.js"') <
  html.indexOf('src="theater_canvas_20261026.js"'));
assert.match(build, /"nickname_store.js"/);
assert.match(theater, /picture\.putImageData\(patch, left, startY\)/);
assert.match(theater, /picture\.getImageData\(left, 49/);
assert.doesNotMatch(theater, /store\.put\(.*nickname/i);
assert.match(theater, /await store\.save\(mode\.db, handoverData\.start, handoverData\.end, name\)/);
// Existing v1 exporter snapshots the entire meta store and includes all keys.
assert.match(admin, /const STORES = \['images', 'meta', 'theater_frames'\]/);
assert.match(admin, /snapshotStores\(db\)/);

function harness(generation = 'gen00026', database = cryptic) {
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
    assert.equal(name,database);
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

  // The poisonous-warning mode must use a different backing DB; its names
  // never appear in the ordinary camouflage-mode theater.
  const poison=harness('gen00026',warning);
  await poison.api.save(warning,21,25,'目立つギタイの来場者');
  assert.deepEqual(JSON.parse(JSON.stringify(await poison.api.read(warning))),[
    {start:21,end:25,name:'目立つギタイの来場者'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.read(cryptic))),[
    {start:21,end:25,name:'蛾博士'}]);
  await assert.rejects(poison.api.save(cryptic,21,25,'wrong DB'),
    /AssertionError|展示モード|database/i);
  assert.equal(poison.writes.length,1,'cross-mode write must not take place');

  // Long history: 2,000 opted-in visitors (10,000 total generations) only
  // scan the small metadata records, without opening moth PNGs or writing.
  const history=harness('gen10001');
  for (let visit=0;visit<2000;visit++) {
    const from=1+visit*5, to=from+4;
    const key='exhibit_visit_nickname_v1:'+String(from).padStart(8,'0')+
      ':'+String(to).padStart(8,'0');
    history.metadata.set(key,{start:from,end:to,name:'来場者'+visit});
  }
  const rows=await history.api.read(cryptic);
  assert.equal(rows.length,2000);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0])),
    {start:1,end:5,name:'来場者0'});
  assert.deepEqual(JSON.parse(JSON.stringify(rows.at(-1))),
    {start:9996,end:10000,name:'来場者1999'});
  assert.equal(history.writes.length,0);
  assert.ok(history.modes.every(mode=>mode==='readonly'));

  console.log('Exhibition nicknames: optional opt-out, guarded meta-only save, read-only histories, 2000 visitor load, mode isolation, backup/reset scope and stale-generation rejection PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
