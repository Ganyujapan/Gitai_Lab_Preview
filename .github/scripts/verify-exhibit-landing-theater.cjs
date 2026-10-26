'use strict';
// Exhibition visitor journey regression: no mutation of evolution data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('exhibit/index.html','utf8');
const css = fs.readFileSync('exhibit/theater.css','utf8');
const landing = fs.readFileSync('exhibit/landing.js','utf8');
const theater = fs.readFileSync('exhibit/theater.js','utf8');
const game = fs.readFileSync('exhibit/game.js','utf8');
const gameCSS = fs.readFileSync('exhibit/game.css','utf8');
const build = fs.readFileSync('exhibit/build.py','utf8');
const admin = fs.readFileSync('exhibit/admin.js','utf8');
const assertHas = (s,p)=>assert.match(s,p);
assertHas(html,/id="exhibitSplash"/);
assertHas(html,/id="exhibitSplashStart"[^>]*>START/);
assertHas(html,/class="exhibit-title-eyebrow">進化シミュレーター/);
assertHas(html,/class="exhibit-brand-logo">ギタイラボ/);
assertHas(html,/id="exhibitTheaterImageBuffer"/);
assertHas(html,/id="exhibitTheaterMarkers"/);
assertHas(html,/id="exhibitTheaterPlayed"/);
assertHas(html,/id="exhibitHandoverFinished"/);
assertHas(html,/id="exhibitHandoverFinishNext"/);
assertHas(html,/id="exhibitGenerationCryptic"/);
assertHas(html,/id="exhibitGenerationWarning"/);
assert.equal((html.match(/data-view-theater=/g)||[]).length,2);
assertHas(html,/game\.html\?model=continuous_v1&amp;env=kusagi_001&amp;run=konchu2026_cryptic&amp;play=1/);
assertHas(html,/experiment=warning_color&amp;run=warning_color_fog_v2&amp;fog=1&amp;play=1&amp;tutorial=1/);
assertHas(landing,/sessionStorage\.removeItem\(visitKey\)/);
assertHas(landing,/window\.GitaiExhibitLanding/);
assertHas(build,/"theater\.js", "theater\.css"/);
assertHas(css,/Double.buffer|outgoing frame visible/i);
assertHas(game,/reviewOverlay\?\.querySelector\('\.review-actions'\)/);
assertHas(game,/次へ（進化シアター）/);
assertHas(game,/sessionStorage\.setItem\(HANDOVER_KEY/);
assertHas(game,/sessionStorage\.getItem\(VISIT_KEY/);
assertHas(game,/continueButton\?\.addEventListener\('click', event =>/);
assertHas(game,/next !== previous/);
assertHas(gameCSS,/#reviewOverlay #exhibitHandover/);
assert.doesNotMatch(gameCSS,/position:fixed[^}]*#exhibitHandover/);
assert.doesNotMatch(theater,/(?:\.put\(|\.add\(|\.clear\(|deleteDatabase)/);
assertHas(theater,/transaction\(stores, 'readonly'\)/);
assertHas(theater,/request\.transaction\.abort\(\)/);
const prefix='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-';
const crypticDb=prefix+'konchu2026_cryptic', warningDb=prefix+'warning_color_fog_v2';
for(const db of [crypticDb,warningDb]){assert.ok(admin.includes(db));assert.ok(theater.includes(db));}
const HANDOVER_KEY='gitai-exhibit-handover-v1';
const VISIT_KEY='gitai-exhibit-visit-start-v1';

function setup({handover=false,absentWarning=false}={}) {
 const elements=new Map(), windowListeners={}, documentListeners={}, transactions=[], missingAborts=[],urls=[],revoked=[],navigated=[],timeouts=[],intervals=[];
 function node(id='') {
  const cl=new Set();
  const n={id,hidden:false,disabled:false,value:'0',children:[],style:{overflow:''},dataset:{},listeners:{},textContent:'',
   classList:{add:x=>cl.add(x),remove:x=>cl.delete(x),contains:x=>cl.has(x),toggle(x,v){if(v)cl.add(x);else cl.delete(x)}},
   addEventListener:(event,fn)=>{n.listeners[event]=fn},
   setAttribute:()=>{},removeAttribute(key){if(key==='src')n.src=undefined},
   replaceChildren(...newChildren){n.children=[...newChildren]},
   appendChild(x){n.children.push(x)},
   focus(){doc.activeElement=n},
   decode(){return Promise.resolve()},
   trigger(event,value){if(value!==undefined)n.value=String(value);n.listeners[event]?.({key:'',preventDefault(){},stopImmediatePropagation(){}})}
  };
  let src;
  Object.defineProperty(n,'src',{get(){return src},set(v){src=v;if(v)queueMicrotask(()=>n.onload?.())}});
  return n;
 }
 for(const id of ['exhibitTheaterDialog','exhibitTheaterTitle','exhibitTheaterMeta',
  'exhibitTheaterImage','exhibitTheaterImageBuffer','exhibitTheaterEmpty',
  'exhibitTheaterSlider','exhibitTheaterProgress','exhibitTheaterClose',
  'exhibitTheaterPrev','exhibitTheaterNext','exhibitTheaterPlay',
  'exhibitGenerationCryptic','exhibitGenerationWarning',
  'exhibitTheaterPlayed','exhibitTheaterMarkers','exhibitHandoverFinished',
  'exhibitHandoverFinishNext']) elements.set(id,node(id));
 const stage=node('theaterStage');
 elements.get('exhibitTheaterDialog').querySelector=()=>stage;
 const cButton=node('crypticButton'),wButton=node('warningButton');
 cButton.dataset.viewTheater='cryptic';wButton.dataset.viewTheater='warning';
 const body=node('body');
 const doc={activeElement:null,body,hidden:false,
   getElementById:id=>elements.get(id),createElement:()=>node(),
   querySelectorAll:()=>[cButton,wButton],
   addEventListener:(event,fn)=>{documentListeners[event]=fn}};
 const blob=s=>new Blob([s],{type:'image/webp'});
 const database={
  [crypticDb]:{generation:'gen00031',frames:[{generation_id:'gen00029',image_blob:blob('cryptic29')},{generation_id:'gen00031',image_blob:blob('cryptic31')}]},
  [warningDb]:{generation:'gen00026',frames:[20,21,22,23,24,25,26].map(n=>({generation_id:'gen'+String(n).padStart(5,'0'),image_blob:blob('warn'+n)}))}
 };
 if(absentWarning)delete database[warningDb];
 const indexedDB={open(name){
  const req={};queueMicrotask(()=>{
   const source=database[name];
   if(!source){req.transaction={abort(){missingAborts.push(name);queueMicrotask(()=>req.onerror?.())}};req.onupgradeneeded?.();return}
   const db={close(){},
    objectStoreNames:{contains:store=>store==='meta'||store==='theater_frames'},
    transaction(stores,mode){
      transactions.push(mode);
      let got=false,done=false;
      const tx={objectStore(store){
       return {
        get(key){assert.equal(store,'meta');assert.equal(key,'current_generation_id');const g={};queueMicrotask(()=>{g.result=source.generation;g.onsuccess?.();got=true;if(done)queueMicrotask(()=>tx.oncomplete?.())});return g;},
        openCursor(){const q={};queueMicrotask(()=>{
         let i=0;function pump(){if(i<source.frames.length){
          q.result={value:source.frames[i++],continue:()=>queueMicrotask(pump)};
          q.onsuccess?.();
         }else{q.result=null;q.onsuccess?.();done=true;if(got)queueMicrotask(()=>tx.oncomplete?.())}}
         pump();
        });return q;}
       }
      }};
      if(stores.length===1){done=true}
      return tx;
    }};
   req.result=db;req.onsuccess?.();
  });return req;
 }};
 const stash=new Map();
 if(handover)stash.set(HANDOVER_KEY,JSON.stringify({mode:'warning',start:21,end:25}));
 const sessionStorage={
  getItem:k=>stash.has(k)?stash.get(k):null,
  setItem:(k,v)=>stash.set(k,v),removeItem:k=>stash.delete(k)
 };
 const loc={href:'https://ganyujapan.github.io/Gitai_Lab_Preview/exhibit/'+(handover?'?handover=1':''),
  assign:href=>navigated.push(href)};
 const FakeURL=class extends URL{};
 FakeURL.createObjectURL=()=>{const url='blob:test-'+(urls.length+1);urls.push(url);return url};
 FakeURL.revokeObjectURL=u=>revoked.push(u);
 const globals={
  document:doc,window:{addEventListener:(evt,cb)=>windowListeners[evt]=cb,
   GitaiExhibitLanding:{showMenu(){},showSplash(){}}},location:loc,
  Blob,indexedDB,URL:FakeURL,sessionStorage,
  console:{warn(){},error(){}},
  setInterval:fn=>{intervals.push(fn);return intervals.length},
  clearInterval:()=>{},
  setTimeout:fn=>{timeouts.push(fn);return timeouts.length},
  clearTimeout:()=>{}
 };
 vm.runInNewContext(theater,globals,{filename:'exhibit/theater.js',timeout:5000});
 return {elements,stage,cButton,wButton,database,missingAborts,transactions,urls,revoked,navigated,timeouts,intervals,stash,
  async settle(){await new Promise(resolve=>setTimeout(resolve,6))},
  open(which){(which==='warning'?wButton:cButton).trigger('click')},
  tick(){const cb=intervals.at(-1);if(cb)cb()},
  timeout(){const cb=timeouts.at(-1);if(cb)cb()},
  close(){elements.get('exhibitTheaterClose').trigger('click')}
 };
}
(async()=>{
 const s=setup();
 await s.settle();
 assert.equal(s.elements.get('exhibitGenerationCryptic').textContent,'現在 第31世代');
 assert.equal(s.elements.get('exhibitGenerationWarning').textContent,'現在 第26世代');
 assert.ok(s.transactions.every(x=>x==='readonly'));
 assert.deepEqual(s.missingAborts,[]);
 s.open('warning');await s.settle();
 assert.equal(s.elements.get('exhibitTheaterDialog').hidden,false);
 assert.match(s.elements.get('exhibitTheaterMeta').textContent,/第26世代/);
 assert.equal(s.elements.get('exhibitTheaterProgress').textContent,'7 / 7');
 assert.equal(s.elements.get('exhibitTheaterImage').hidden,false);
 // The old image remains visible while the next buffer is loading.
 s.elements.get('exhibitTheaterPrev').trigger('click');await s.settle();
 assert.equal(s.elements.get('exhibitTheaterImageBuffer').hidden,false);
 assert.equal(s.elements.get('exhibitTheaterImage').hidden,true);
 assert.equal(s.elements.get('exhibitTheaterMarkers').hidden,true);
 s.close();assert.equal(s.elements.get('exhibitTheaterDialog').hidden,true);
 assert.ok(s.urls.every(u=>s.revoked.includes(u)),'all display URLs must be revoked');
 assert.ok(s.transactions.every(x=>x==='readonly'),'no database writes');

 const missing=setup({absentWarning:true});await missing.settle();
 assert.equal(missing.elements.get('exhibitGenerationWarning').textContent,'現在 未開始');
 assert.deepEqual(missing.missingAborts,[warningDb]);
 missing.open('warning');await missing.settle();
 assert.match(missing.elements.get('exhibitTheaterEmpty').textContent,/実験開始後/);
 assert.deepEqual(missing.missingAborts,[warningDb,warningDb]);

 const h=setup({handover:true});await h.settle();
 assert.equal(h.stash.has(HANDOVER_KEY),false,'one-use handover consumed');
 assert.equal(h.elements.get('exhibitTheaterDialog').hidden,false);
 assert.equal(h.elements.get('exhibitTheaterDialog').classList.contains('is-handover'),true);
 assert.equal(h.elements.get('exhibitTheaterMarkers').children.length,6);
 assert.equal(h.elements.get('exhibitTheaterMarkers').children.filter(x=>x.classList.contains('is-played')).length,5);
 assert.equal(h.elements.get('exhibitTheaterPlayed').hidden,true,'pre-visitor frame is unmarked');
 h.tick();await h.settle();
 assert.equal(h.elements.get('exhibitTheaterPlayed').hidden,false);
 assert.ok(h.stage.classList.contains('is-played'),'visitor frame outlined');
 for(let i=0;i<8;i++){h.tick();await h.settle()}
 h.timeout();
 assert.equal(h.elements.get('exhibitHandoverFinished').hidden,false);
 h.elements.get('exhibitHandoverFinishNext').trigger('click');
 assert.deepEqual(h.navigated,['https://ganyujapan.github.io/Gitai_Lab_Preview/exhibit/']);
 assert.ok(h.transactions.every(x=>x==='readonly'));
 console.log('Exhibition: logo/splash, readonly theater, flicker-free buffering, five-visit highlighting & handover OK');
})().catch(e=>{console.error(e);process.exitCode=1});
