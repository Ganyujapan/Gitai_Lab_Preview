'use strict';
// EXH-01: execute the real exhibition worker fetch handler in a VM.
// No browser storage or existing client cache is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync('exhibit/sw.template.js','utf8');
const manifest = JSON.parse(fs.readFileSync('exhibit/manifest.webmanifest','utf8'));
const build = fs.readFileSync('exhibit/build.py','utf8');
assert.equal(manifest.start_url,'./');
assert.equal(manifest.scope,'./');
assert.match(build,/\"index\.html\", \"modes\.html\"/);
assert.match(build,/for folder in \("audio",/,
  'exhibition build must copy the Ogg sound assets');
assert.match(build,/for p in exhibit\.rglob/,
  'offline precache must include copied audio assets');
const BASE='https://example.test/Gitai_Lab_Preview/exhibit/';
const actualCache=new Map([
 ['index.html','TITLE_OFFLINE'],
 ['modes.html','MODES_OFFLINE'],
 ['game.html','GAME_OFFLINE'],
 ['img/backgrounds/bg_leaf01.png','IMAGE_OFFLINE'],
 ['audio/gitailab_rainforest_overlap_test_48k.ogg','RAINFOREST_BGM_OFFLINE']
].map(([x,value])=>[new URL(x,BASE).href,value]));
const listeners={};
const cacheLookups=[], network=[],scope=BASE;
const cache={
 async match(input,{ignoreSearch=false}={}) {
  const raw=typeof input==='string'?input:input.url;
  const url=new URL(raw);
  const key=ignoreSearch?new URL(url.pathname,url.origin).href:url.href;
  cacheLookups.push(key);
  return actualCache.get(key);
 }
};
const self={
 registration:{scope},
 location:{origin:new URL(scope).origin},
 addEventListener:(event,fn)=>{listeners[event]=fn},
 clients:{claim:async()=>{}},
 skipWaiting:()=>{}
};
const context={URL,Request:class {
 constructor(url,options={}){this.url=url;this.options=options}
},self,caches:{open:async()=>cache},
 fetch:async request=>{network.push(request.url);throw Error('OFFLINE')},
 console};
vm.runInNewContext(script,context,{filename:'exhibit/sw.template.js',timeout:1500});
async function visit(path,mode='navigate',method='GET') {
 const request={url:new URL(path,BASE).href,mode,method};
 let promise=null;
 listeners.fetch({request,respondWith:response=>{promise=Promise.resolve(response)}});
 return promise;
}
(async()=>{
 assert.equal(await visit('./'),'TITLE_OFFLINE',
   'Directory root must resolve to precached standalone title screen');
 assert.equal(await visit('./?source=handover'),'TITLE_OFFLINE',
   'Directory navigation with query must still work offline');
 assert.equal(await visit('index.html'),'TITLE_OFFLINE');
 assert.equal(await visit('modes.html?handover=1'),'MODES_OFFLINE');
 assert.equal(await visit('game.html?play=1'),'GAME_OFFLINE');
 assert.equal(await visit('img/backgrounds/bg_leaf01.png','no-cors'),'IMAGE_OFFLINE');
 assert.equal(await visit('audio/gitailab_rainforest_overlap_test_48k.ogg','no-cors'),
   'RAINFOREST_BGM_OFFLINE','PWA BGM must come from offline cache');
 assert.equal(await visit('../index.html'),null,
   'Outside exhibit must be completely uncontrolled');
 assert.equal(await visit('./','no-cors').then(x=>x).catch(e=>e.message),'OFFLINE',
   'A non-navigation resource must not be treated as the title HTML');
 assert.equal(await visit('api/unknown').then(x=>x).catch(e=>e.message),'OFFLINE',
   'Uncached APIs must never return the title HTML');
 assert.equal(network.length,2,'Only unknown/API and non-navigation root should hit network');
 assert.ok(cacheLookups.includes(new URL('index.html',BASE).href));
 assert.equal(script.includes("skipWaiting();"),true);
 assert.equal(script.includes("await caches.delete(ACTIVE_CACHE)"),true);
 console.log('EXH-01: Offline /exhibit/, title, modes, game and query navigation work; no cross-scope or asset fallback.');
})().catch(e=>{console.error(e);process.exitCode=1});
