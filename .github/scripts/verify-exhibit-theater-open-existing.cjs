'use strict';
// Run the shipping theater's noncreating IDB opener with deterministic events.
// No browser/user database is opened.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const start=source.indexOf('  function openExisting(name) {');
const end=source.indexOf('  async function readMode(mode) {',start);
assert.ok(start>0&&end>start,'production read-only opener must be present');
const fn=source.slice(start,end);
function fixture(){
  let opened=0,closed=0,aborted=0;
  const req={result:{close(){closed++}},error:null,
    transaction:{abort(){aborted++}}};
  const ctx={indexedDB:{
    open(name,version){
      assert.equal(name,'test-only-theater-db');
      assert.equal(version,undefined,'viewer must never request DB upgrade');
      opened++;return req;
    },
    deleteDatabase(){throw Error('viewer may not delete data')}
  }};
  vm.runInNewContext(fn+'\nglobalThis.openTheaterDb=openExisting;',ctx,
    {filename:'exhibit/theater_canvas_20261026.js:openExisting',timeout:3000});
  return {req,open:()=>ctx.openTheaterDb('test-only-theater-db'),
    get opened(){return opened},get closed(){return closed},
    get aborted(){return aborted}};
}
(async()=>{
  const happy=fixture();
  const p=happy.open();
  happy.req.onsuccess();
  const opened=await p;
  assert.equal(opened,happy.req.result);
  assert.equal(happy.opened,1);
  assert.equal(happy.closed,0,'caller owns successful DB connection');
  opened.close();
  assert.equal(happy.closed,1);

  const missing=fixture();
  const noDb=missing.open();
  missing.req.onupgradeneeded();
  missing.req.onerror();
  assert.equal(await noDb,null,'missing database is not initialized');
  assert.equal(missing.aborted,1,'versionchange creation is aborted');
  assert.equal(missing.closed,0);

  const blocked=fixture();
  const pending=blocked.open();
  blocked.req.onblocked();
  await assert.rejects(pending,/別のタブ/);
  // Browser may complete the OPEN much later, after the caller has left.
  blocked.req.onsuccess();
  assert.equal(blocked.closed,1,'late successful open must close its connection');
  blocked.req.onsuccess();
  assert.equal(blocked.closed,2,'no success may leak a connection');

  const unreadable=fixture();
  const error=unreadable.open();
  unreadable.req.error=Error('synthetic IDB failure');
  unreadable.req.onerror();
  await assert.rejects(error,/synthetic IDB failure/);
  assert.equal(unreadable.closed,0);
  console.log('Theater IDB opener: normal, missing, blocked+late success and error never create/upgrade/delete user data; late connection closed.');
})().catch(error=>{console.error(error);process.exitCode=1});
