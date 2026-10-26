'use strict';
// Regression for read-only exhibition landing. No actual user IndexedDB touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('exhibit/index.html', 'utf8');
const css = fs.readFileSync('exhibit/theater.css', 'utf8');
const js = fs.readFileSync('exhibit/theater.js', 'utf8');
const build = fs.readFileSync('exhibit/build.py', 'utf8');
const admin = fs.readFileSync('exhibit/admin.js', 'utf8');

assert.match(html, /id="exhibitGenerationCryptic"/);
assert.match(html, /id="exhibitGenerationWarning"/);
assert.equal((html.match(/data-view-theater=/g)||[]).length,2);
assert.match(html, /game\.html\?model=continuous_v1&amp;env=kusagi_001&amp;run=konchu2026_cryptic&amp;play=1/);
assert.match(html, /game\.html\?model=continuous_v1&amp;env=kusagi_001&amp;experiment=warning_color&amp;run=warning_color_fog_v2&amp;fog=1&amp;play=1&amp;tutorial=1/);
assert.match(html, /同じiPadで進化を引き継ぎます/);
assert.match(html, /exhibitAdminOpen/);
assert.match(html, /src="theater\.js" defer/);
assert.match(html, /href="theater\.css"/);
assert.match(css, /exhibit-theater-stage img/);
assert.match(build, /"theater\.js", "theater\.css"/);
assert.match(build, /"theater\.js" in runtime_files/);
assert.doesNotMatch(js,/readwrite|deleteDatabase|\.put\(|\.add\(|\.clear\(/);
assert.match(js,/transaction\(stores, 'readonly'\)/);
assert.match(js,/request\.onupgradeneeded[\s\S]*?request\.transaction\.abort\(\)/);
const suffix='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-';
const crypticDb=suffix+'konchu2026_cryptic';
const warningDb=suffix+'warning_color_fog_v2';
assert.ok(admin.includes(crypticDb)&&admin.includes(warningDb));
assert.ok(js.includes(crypticDb)&&js.includes(warningDb));

function setup({missingWarning=false}={}) {
 const elements=new Map(),listeners={},issued=[],closed=[],txModes=[],upgrades=[],errors=[];
 function element(id=''){
   return { id, hidden:false, disabled:false, value:'0',
     style:{overflow:''}, listeners:{}, textContent:'',
     dataset:{}, focus(){doc.activeElement=this},
     addEventListener(t,fn){this.listeners[t]=fn},
     removeAttribute(k){delete this[k]},
     trigger(t,value){if(value!==undefined)this.value=String(value);this.listeners[t]?.({key:'',preventDefault(){}})}
   };
 }
 for(const id of [
   'exhibitTheaterDialog','exhibitTheaterTitle','exhibitTheaterMeta',
   'exhibitTheaterImage','exhibitTheaterEmpty','exhibitTheaterSlider',
   'exhibitTheaterProgress','exhibitTheaterClose','exhibitTheaterPrev',
   'exhibitTheaterNext','exhibitTheaterPlay',
   'exhibitGenerationCryptic','exhibitGenerationWarning']) elements.set(id,element(id));
 const viewCryptic=element('button-cryptic'),viewWarning=element('button-warning');
 viewCryptic.dataset.viewTheater='cryptic';viewWarning.dataset.viewTheater='warning';
 const body=element('body');
 const doc={activeElement:null,body,hidden:false,
   getElementById:id=>elements.get(id)||null,
   querySelectorAll:()=>[viewCryptic,viewWarning],
   addEventListener:(event,cb)=>{listeners['doc:'+event]=cb}};
 const blob=x=>new Blob([String(x)],{type:'image/webp'});
 const records={
  [crypticDb]:{generation:'gen00031',theater:[
   {generation_id:'gen00001',image_blob:blob('gen1')},
   {generation_id:'gen00031',image_blob:blob('gen31')}]},
  [warningDb]:{generation:'gen00044',theater:[
   {generation_id:'gen00021',image_blob:blob('gen21')},
   {generation_id:'gen00044',image_blob:blob('gen44')}]}
 };
 if(missingWarning)delete records[warningDb];
 const indexedDB={
  open(name){
   const req={};
   queueMicrotask(()=>{
    const record=records[name];
    if(!record) {
     req.transaction={abort(){upgrades.push(name);queueMicrotask(()=>req.onerror?.())}};
     req.onupgradeneeded?.();
     return;
    }
    const db={close(){closed.push(name)},
      objectStoreNames:{contains:x=>x==='meta'||x==='theater_frames'},
      transaction(stores,mode){
       txModes.push(mode);
       const gets=[];
       const tx={objectStore(store){
         return {
           get(key){assert.equal(store,'meta');assert.equal(key,'current_generation_id');const req={};gets.push(()=>{req.result=record.generation;req.onsuccess?.()});return req},
           openCursor(){assert.equal(store,'theater_frames');const req={};gets.push(()=>{
             let i=0;
             function pump(){
               if(i<record.theater.length) {
                 req.result={value:record.theater[i++],continue(){queueMicrotask(pump)}};
                 req.onsuccess?.();
               }else {
                 req.result=null;req.onsuccess?.();
                 queueMicrotask(()=>tx.oncomplete?.());
               }
             }
             pump();
           });return req}
         };
       }};
       queueMicrotask(()=>{for(const fn of gets)fn();if(stores.length===1)queueMicrotask(()=>tx.oncomplete?.())});
       return tx;
      }
    };
    req.result=db;req.onsuccess?.();
   });
   return req;
  }
 };
 let urlNumber=0;
 const url={createObjectURL:b=>{assert.ok(b instanceof Blob);const s='blob:theater-'+ ++urlNumber;issued.push(s);return s},
  revokeObjectURL:s=>closed.push(s)};
 const sandbox={
   document:doc,indexedDB,Blob,URL:url,console:{warn:e=>errors.push(e),error:e=>errors.push(e)},
   window:{addEventListener:(name,fn)=>listeners[name]=fn},
   setInterval:()=>88,clearInterval:id=>{assert.equal(id,88)}
 };
 vm.runInNewContext(js,sandbox,{filename:'exhibit/theater.js',timeout:2000});
 return {elements,viewCryptic,viewWarning,records,upgrades,txModes,issued,closed,errors,
  async settle(){await new Promise(done=>setTimeout(done,12))},
  open(mode){(mode==='cryptic'?viewCryptic:viewWarning).trigger('click')},
  event:(name)=>listeners[name]?.()};
}
(async()=>{
 const s=setup();await s.settle();
 assert.equal(s.elements.get('exhibitGenerationCryptic').textContent,'現在 第31世代');
 assert.equal(s.elements.get('exhibitGenerationWarning').textContent,'現在 第44世代');
 assert.ok(s.txModes.every(x=>x==='readonly'),'no database writes');
 assert.deepEqual(s.upgrades,[],'no new database created');

 s.open('warning');await s.settle();
 assert.equal(s.elements.get('exhibitTheaterDialog').hidden,false);
 assert.match(s.elements.get('exhibitTheaterTitle').textContent,/目立つギタイ/);
 assert.match(s.elements.get('exhibitTheaterMeta').textContent,/第44世代/);
 assert.equal(s.elements.get('exhibitTheaterProgress').textContent,'2 / 2');
 assert.equal(s.elements.get('exhibitTheaterSlider').max,'1');
 assert.ok(s.elements.get('exhibitTheaterImage').src.startsWith('blob:theater'));
 s.elements.get('exhibitTheaterPrev').trigger('click');
 assert.match(s.elements.get('exhibitTheaterMeta').textContent,/第21世代/);
 s.elements.get('exhibitTheaterSlider').trigger('input',1);
 assert.match(s.elements.get('exhibitTheaterMeta').textContent,/第44世代/);
 s.elements.get('exhibitTheaterPlay').trigger('click');
 assert.equal(s.elements.get('exhibitTheaterPlay').textContent,'停止');
 s.elements.get('exhibitTheaterClose').trigger('click');
 assert.equal(s.elements.get('exhibitTheaterDialog').hidden,true);
 assert.ok(s.closed.includes(s.issued.at(-1)),'object URLs must be revoked');
 await s.settle();
 s.open('cryptic');await s.settle();
 assert.match(s.elements.get('exhibitTheaterTitle').textContent,/隠れるギタイ/);
 assert.match(s.elements.get('exhibitTheaterMeta').textContent,/第31世代/);
 s.elements.get('exhibitTheaterClose').trigger('click');
 assert.ok(s.txModes.every(x=>x==='readonly'));

 const m=setup({missingWarning:true});await m.settle();
 assert.equal(m.elements.get('exhibitGenerationWarning').textContent,'現在 未開始');
 assert.deepEqual(m.upgrades,[warningDb], 'unknown DB must be aborted, not initialized');
 assert.equal(m.records[warningDb],undefined,'missing mode is not created');
 m.open('warning');await m.settle();
 assert.match(m.elements.get('exhibitTheaterEmpty').textContent,/実験開始後/);
 assert.deepEqual(m.upgrades,[warningDb,warningDb]);
 console.log('Exhibition landing: generation counters, two-mode theater, readonly transactions, missing-DB abort and modal controls OK');
})().catch(e=>{console.error(e);process.exitCode=1});
