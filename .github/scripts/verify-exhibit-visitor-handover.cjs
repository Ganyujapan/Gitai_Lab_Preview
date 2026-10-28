'use strict';
// RE2-EXH-01: run actual exhibit/game.js (not a copied parser) with an
// isolated document, sessionStorage and version-2 IndexedDB read-only mock.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('exhibit/game.js','utf8');
const injected=source.replace(/\}\)\(\);\s*$/, '  globalThis.__test={numberFrom,sync,safelyHandover,button,notice,\n' +
  '    start:()=>firstGeneration,pending:()=>handoverPending};\n})();');
assert.notEqual(injected,source,'must execute the actual controller');

function element(text='',visible=false){
  const listeners=[];
  const classes=new Set(visible?['visible']:[]);
  return {textContent:text,hidden:false,disabled:false,
    classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)},
    insertAdjacentElement(){},addEventListener(name,fn){listeners.push({name,fn});},
    click(){
      const event={stopped:false,preventDefault(){},stopImmediatePropagation(){this.stopped=true}};
      for(const item of listeners)if(item.name==='click'){
        item.fn(event);if(event.stopped)break;
      }
      if(!event.stopped)this.onNext?.();
      return event;
    }};
}
function fixture({mode='cryptic',start=21,end=21,behavior='commit',review=true,disabled=false,lifeSaveError=false}={}){
  let pointer='gen'+String(end).padStart(5,'0');
  let clicks=0;const errors=[],navigations=[],stash=new Map();
  const life=new Map();
  const lifeKey='gitai-warning-life-v1:gitai-exhibit-test';
  if(mode==='warning')life.set(lifeKey,JSON.stringify({
    generation_id:pointer,thirds:12 // previous visitor's remaining 4 hearts
  }));
  let lifeWrites=0;
  const startGeneration=element('GENERATION '+String(start).padStart(5,'0'));
  const reviewGeneration=element('GENERATION '+String(end).padStart(5,'0'));
  const startOverlay=element('',!review),reviewOverlay=element('',review);
  reviewOverlay.querySelector=()=>({insertAdjacentElement(){}});
  const continueButton=element('次の世代を生成');
  const generationContinueButton=element('次へ');
  generationContinueButton.hidden=true;
  continueButton.disabled=disabled;
  continueButton.onNext=()=>{
    clicks++;
    if(behavior==='commit'){
      pointer='gen'+String(end+1).padStart(5,'0');
      if(mode==='warning')queueMicrotask(()=>{
        // Same order as the game: child DB pointer commits, then the main
        // game persists remaining lives, then the ready UI is shown.
        life.set(lifeKey,JSON.stringify({generation_id:pointer,thirds:6}));
        generationContinueButton.hidden=false;
      });
    }
    if(behavior==='invalid')pointer='bad-pointer';
    if(behavior==='fail')continueButton.textContent='もう一度送信';
  };
  const nodes={startGeneration,reviewGeneration,startOverlay,reviewOverlay,continueButton,
    generationContinueButton};
  const doc={body:{},getElementById:id=>nodes[id]||null,
    createElement:()=>element(),addEventListener(){}};
  const indexedDB = {
    open(_name, version) {
      assert.equal(version, 2);
      const db = {
        close() {},
        transaction(name, kind) {
          assert.equal(name, 'meta');
          assert.equal(kind, 'readonly');
          return {
            objectStore() {
              return {
                get() {
                  const req = { result: pointer };
                  queueMicrotask(() => req.onsuccess?.());
                  return req;
                }
              };
            }
          };
        }
      };
      const req = { result: db };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }
  };
  const sessionStorage={getItem:k=>stash.get(k)||null,setItem:(k,v)=>stash.set(k,v)};
  const localStorage={
    getItem:k=>life.get(k)??null,
    setItem(k,v){lifeWrites++;if(lifeSaveError)throw Error('QuotaExceededError');life.set(k,v);}
  };
  const context={document:doc,indexedDB,sessionStorage,localStorage,URL,
    window:{
      GitaiPagesPreview:{context:{storageNamespace:'gitai-exhibit-test'}},
      GitaiWarningColor:{LIFE_INITIAL_THIRDS:30},
      addEventListener(){}},
    location:{href:'https://example.test/Gitai_Lab_Preview/exhibit/game.html'
      +(mode==='warning'?'?experiment=warning_color':''),
      assign:u=>navigations.push(u)},
    history:{replaceState(){}},MutationObserver:class{observe(){}},
    setTimeout:fn=>queueMicrotask(fn),
    alert:s=>errors.push(s),console:{error:e=>errors.push(String(e?.message||e))}};
  vm.runInNewContext(injected,context,{filename:'exhibit/game.js',timeout:5000});
  return {api:context.__test,nodes,navigations,stash,errors,
    get pointer(){return pointer},get clicks(){return clicks},
    get life(){return life.get(lifeKey)||null},get lifeWrites(){return lifeWrites}};
}
async function waitFor(fn){
  for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setImmediate(r));}
  throw Error('Handover did not finish');
}
(async()=>{
  const p=fixture();
  for(const [label,num] of [
    ['GENERATION 00001',1],['GENERATION 00021',21],
    ['第21世代',21],['第25世代',25],['',null],['GENERATION abc',null]
  ])assert.equal(p.api.numberFrom(element(label)),num,label);
  assert.equal(p.api.start(),21);
  assert.equal(p.api.button.hidden,false);
  assert.equal(JSON.parse(p.stash.get('gitai-exhibit-visit-start-v1')).start,21);
  await p.api.safelyHandover();
  assert.equal(p.pointer,'gen00022');
  assert.equal(p.clicks,1);
  assert.equal(p.navigations.length,1);
  assert.match(p.navigations[0],/modes\.html\?handover=1$/);
  assert.equal(JSON.parse(p.stash.get('gitai-exhibit-handover-v1')).end,21);
  assert.equal(p.lifeWrites,0,'cryptic handover must NEVER touch warning-life storage');
  for(const mode of ['cryptic','warning']){
    const mid=fixture({mode,start:21,end:24});
    assert.equal(mid.api.button.hidden,false,'1-4 generation manual swap');
    await mid.api.safelyHandover();
    assert.equal(mid.pointer,'gen00025');
    assert.equal(JSON.parse(mid.stash.get('gitai-exhibit-handover-v1')).mode,mode);
    if(mode==='warning') {
      assert.deepEqual(JSON.parse(mid.life),{generation_id:'gen00025',thirds:30},
        'next visitor gets 10 full hearts without resetting moth evolution');
      assert.equal(mid.lifeWrites,1,'warning handover writes one life reset');
    }else assert.equal(mid.lifeWrites,0,'cryptic handover must not write life');
    const fifth=fixture({mode,start:21,end:25});
    assert.equal(fifth.api.button.hidden,true);
    assert.equal(fifth.api.notice.hidden,false);
    assert.equal(fifth.nodes.continueButton.textContent,'次へ（進化シアター）');
    const evt=fifth.nodes.continueButton.click();
    assert.equal(evt.stopped,true,'fifth generation Next intercepted');
    assert.equal(fifth.clicks,0,'must await original save before returning');
    await waitFor(()=>fifth.navigations.length>0);
    assert.equal(fifth.pointer,'gen00026');
    assert.equal(fifth.clicks,1);
    assert.equal(JSON.parse(fifth.stash.get('gitai-exhibit-handover-v1')).end,25);
    if(mode==='warning')assert.deepEqual(JSON.parse(fifth.life),{
      generation_id:'gen00026',thirds:30
    },'fifth-generation handover also resets only life');
  }
  const nextVisitor=fixture({start:26,end:26});
  assert.equal(nextVisitor.api.start(),26);
  for(const behavior of ['stale','invalid','fail']){
    const failed=fixture({behavior});
    await failed.api.safelyHandover();
    assert.equal(failed.navigations.length,0,'failed commit cannot navigate');
    assert.equal(failed.api.pending(),false);
    assert.equal(failed.api.button.disabled,false);
    assert.equal(failed.stash.has('gitai-exhibit-handover-v1'),false);
  }
  const failedLife=fixture({mode:'warning',lifeSaveError:true});
  assert.equal(JSON.parse(failedLife.life).thirds,12,
    'ordinary warning game starts with the previous visitor life before handover');
  await failedLife.api.safelyHandover();
  assert.equal(failedLife.pointer,'gen00022',
    'failed localStorage does NOT rollback a successfully committed generation');
  assert.equal(failedLife.navigations.length,0,
    'never claim handover complete if the next visitor life reset failed');
  assert.equal(failedLife.stash.has('gitai-exhibit-handover-v1'),false);
  assert.match(failedLife.errors.join(' '),/ライフ10/);
  assert.equal(failedLife.lifeWrites,1);
  assert.equal(JSON.parse(failedLife.life).thirds,6,
    'failed reset must leave the actual saved life intact');

  const disabled=fixture({disabled:true});
  assert.equal(disabled.api.button.hidden,true);
  await disabled.api.safelyHandover();
  assert.equal(disabled.clicks,0);
  const playing=fixture({review:false});
  await playing.api.safelyHandover();
  assert.equal(playing.clicks,0);
  console.log('RE2-EXH-01: both modes hand over only after committed generations; warning life resets to 10 after ordinary save, cryptic untouched, errors fail closed.');
})().catch(e=>{console.error(e);process.exitCode=1});
