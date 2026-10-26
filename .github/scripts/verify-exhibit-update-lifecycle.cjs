'use strict';
// EXH-05: execute the ACTUAL exhibition Service Worker handlers with isolated
// fake caches. This tests install / activate / offline fetch, NOT the browser's
// native automatic activation timing. No real browser data is opened/erased.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const worker = fs.readFileSync('exhibit/sw.template.js','utf8');
const landing = fs.readFileSync('exhibit/landing.js','utf8');
const admin = fs.readFileSync('exhibit/admin.js','utf8');
const title = fs.readFileSync('exhibit/index.html','utf8');
const modes = fs.readFileSync('exhibit/modes.html','utf8');
const guide = fs.readFileSync('exhibit/README.md','utf8');
const BASE = 'https://example.test/Gitai_Lab_Preview/exhibit/';
const PREFIX = 'gitai-konchu2026-exhibit-';
const BUILD = 'test-vB';
const CACHE = PREFIX+BUILD;
const path = value => new URL(value,BASE).href;

assert.match(worker,/const BASE = self\.registration\.scope/);
assert.match(landing,/serviceWorker\.register\('\.\/sw\.js',\s*\{\s*scope:\s*'\.\/', updateViaCache:\s*'none'\s*\}\)/);
assert.match(title,/serviceWorker\.register\('\.\/sw\.js',\{scope:'\.\/',updateViaCache:'none'\}\)/);
assert.match(admin,/if \(!unlocked\) return;\s*updateApply\.hidden = true/);
assert.match(admin,/if \(!unlocked \|\| !pendingWorker \|\| updateApply\.hidden\) return/);
assert.match(admin,/pendingWorker\.postMessage\(\{type: 'APPLY_EXHIBIT_UPDATE'\}\)/);
assert.match(modes,/id="exhibitUpdateLifecycleNote"/);
assert.match(modes,/手動適用なしで新版に切り替わる可能性/);
assert.match(guide,/管理者操作まで旧版に固定/);
assert.match(guide,/ブラウザ再起動時/);
assert.match(guide,/PIN未解錠/);
assert.match(guide,/通信断とオフライン/);
// There is no install-time forced takeover. Any skipWaiting request is from
// the manual message path; waiting -> auto-activation is a browser rule.
const installText=worker.slice(worker.indexOf("self.addEventListener('install'"),
  worker.indexOf("self.addEventListener('activate'"));
assert.doesNotMatch(installText,/self\.skipWaiting\s*\(/);
const messageText=worker.slice(worker.indexOf("self.addEventListener('message'"));
assert.match(messageText,/self\.skipWaiting\s*\(/);

function harness({failAdd=false}={}) {
  const callbacks={};
  const oldName=PREFIX+'test-vA';
  const stores=new Map([
    [oldName, new Map([[path('game.html'),{tag:'old-game',ok:true}]])],
    ['unrelated-app-cache',new Map([['x','y']])]
  ]);
  const removed=[];
  let claimed=0,skipped=0,network=0;
  const caches={
    async keys(){return Array.from(stores.keys());},
    async delete(name){removed.push(name);return stores.delete(name);},
    async open(name){
      if(!stores.has(name)) stores.set(name,new Map());
      const store=stores.get(name);
      return {
        async addAll(requests){
          if(failAdd)throw Error('TEST_OFFLINE_NETWORK_CUT');
          for(const request of requests)store.set(request.url,
            {tag:'vB:'+new URL(request.url).pathname.split('/').at(-1),ok:true});
        },
        async match(request,{ignoreSearch=false}={}){
          const raw=typeof request==='string'?request:request.url;
          const requested=ignoreSearch?raw.split('?')[0]:raw;
          return store.get(requested)||null;
        }
      };
    }
  };
  class FakeRequest {
    constructor(url,options){this.url=url;this.cache=options?.cache;}
  }
  const context={
    self:{
      registration:{scope:BASE},
      location:{origin:new URL(BASE).origin},
      addEventListener(type,callback){callbacks[type]=callback;},
      skipWaiting(){skipped++;return Promise.resolve();},
      clients:{async claim(){claimed++;}}
    },
    URL,Request:FakeRequest,caches,
    async fetch(request){
      network++;
      const url=typeof request==='string'?request:request.url;
      if(url===path('precache.json'))return {
        ok:true,
        async json(){return ['index.html','modes.html','game.html','version.json'];}
      };
      return {ok:true,tag:'network'};
    }
  };
  vm.runInNewContext(worker.replace('__GITAI_BUILD__',BUILD),context,{
    filename:'exhibit/sw.template.js',timeout:5000
  });
  function lifecycle(type){
    let completion;
    const e={waitUntil(promise){completion=promise;}};
    callbacks[type](e);
    assert.ok(completion, type+' must waitUntil');
    return completion;
  }
  async function request(url,{mode='navigate',method='GET'}={}){
    let received;
    callbacks.fetch({
      request:{url:path(url),mode,method},
      respondWith(promise){received=promise;}
    });
    return received?await received:null;
  }
  return {
    stores,oldName,removed,caches,callbacks,lifecycle,request,
    get claimed(){return claimed;},
    get skipped(){return skipped;},
    get network(){return network;}
  };
}
(async()=>{
  const h=harness();
  await h.lifecycle('install');
  assert.ok(h.stores.has(h.oldName),'old cache must survive full vB installation');
  assert.ok(h.stores.has(CACHE),'new version pre-cached');
  assert.equal(h.skipped,0,'installation must not call skipWaiting');
  assert.equal(h.claimed,0,'activation is not part of installation');
  assert.equal((await h.request('game.html?play=1')).tag,'vB:game.html');
  assert.equal((await h.request('./')).tag,'vB:index.html');
  assert.equal((await h.request('version.json')).tag,'vB:version.json');
  assert.equal(h.network,1,'only precache manifest should access network');
  assert.equal(await h.request('https://example.test/Gitai_Lab_Preview/index.html'),null);
  assert.equal(await h.request('version.json?online=1'),null);
  assert.equal(await h.request('game.html',{method:'POST'}),null);
  h.callbacks.message({data:{type:'OTHER'}});
  assert.equal(h.skipped,0);
  h.callbacks.message({data:{type:'APPLY_EXHIBIT_UPDATE'}});
  assert.equal(h.skipped,1,'manual message requests early activation');
  // Browser decides WHEN activate is dispatched; simulate it only explicitly.
  await h.lifecycle('activate');
  assert.equal(h.claimed,1);
  assert.ok(!h.stores.has(h.oldName),'activation clears old exhibit cache');
  assert.ok(h.stores.has(CACHE));
  assert.ok(h.stores.has('unrelated-app-cache'),'unrelated app cache untouched');
  assert.equal((await h.request('game.html')).tag,'vB:game.html');
  const cut=harness({failAdd:true});
  await assert.rejects(cut.lifecycle('install'),/TEST_OFFLINE_NETWORK_CUT/);
  assert.ok(cut.stores.has(cut.oldName),'failed vB installation keeps vA cache');
  assert.ok(!cut.stores.has(CACHE),'partially populated vB cache must be deleted');
  assert.equal(cut.skipped,0);
  assert.equal(cut.claimed,0);
  console.log('EXH-05: vA/vB precache, waiting-compatible install, manual skipWaiting, scoped activation cleanup, offline navigation, cross-scope exclusion and network-cut rollback OK. Browser auto-activation and iPad timing NOT simulated.');
})().catch(error=>{console.error(error);process.exitCode=1;});
