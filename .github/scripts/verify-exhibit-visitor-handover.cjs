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
function fixture({mode='cryptic',start=21,end=21,behavior='commit',review=true,disabled=false,lifeSaveError=false,lifeSaveFailures=0,sessionStash=null}={}){
  let pointer='gen'+String(end).padStart(5,'0');
  let clicks=0;const errors=[],navigations=[],stash=sessionStash||new Map();
  const life=new Map();
  const lifeKey='gitai-warning-life-v1:gitai-exhibit-test';
  if(mode==='warning')life.set(lifeKey,JSON.stringify({
    generation_id:pointer,thirds:12 // previous visitor's remaining 4 hearts
  }));
  let lifeWrites=0,lifeFailuresRemaining=lifeSaveFailures;
  const startGeneration=element('GENERATION '+String(start).padStart(5,'0'));
  const reviewGeneration=element('GENERATION '+String(end).padStart(5,'0'));
  const startOverlay=element('',!review),reviewOverlay=element('',review);
  const generationOverlay=element('',false);
  reviewOverlay.querySelector=()=>({insertAdjacentElement(){}});
  const continueButton=element('次の世代を生成');
  const generationContinueButton=element('次へ');
  generationContinueButton.hidden=true;
  continueButton.disabled=disabled;
  continueButton.onNext=()=>{
    clicks++;
    if(behavior==='commit'){
      reviewOverlay.classList.remove('visible');
      generationOverlay.classList.add('visible');
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
  const nodes={startGeneration,reviewGeneration,startOverlay,reviewOverlay,generationOverlay,
    continueButton,generationContinueButton};
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
  const sessionStorage={
    getItem:k=>stash.get(k)||null,
    setItem:(k,v)=>stash.set(k,v),
    removeItem:k=>stash.delete(k)
  };
  const localStorage={
    getItem:k=>life.get(k)??null,
    setItem(k,v){
      lifeWrites++;
      if(lifeSaveError||lifeFailuresRemaining>0){
        if(lifeFailuresRemaining>0)lifeFailuresRemaining--;
        throw Error('QuotaExceededError');
      }
      life.set(k,v);
    }
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
    get life(){return life.get(lifeKey)||null},get lifeWrites(){return lifeWrites},
    set pointer(next){pointer=next}};
}
async function waitFor(fn){
  for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setImmediate(r));}
  throw Error('Handover did not finish');
}
(async()=>{
  // T-003 A-4/A-6: Execute the ACTUAL START click handler extracted from the
  // exhibition title. Re-entering the title mid-visit must not silently
  // grant five more generations or mutate the visitor's saved state.
  const titleHtml=fs.readFileSync('exhibit/index.html','utf8');
  const startMatch=titleHtml.match(
    /document\.getElementById\('portalEnter'\)\.addEventListener\('click',event=>\{([\s\S]*?)\},true\);/
  );
  assert.ok(startMatch,'exhibition title START handler must be present');
  const existingVisit=JSON.stringify({mode:'warning',start:26});
  const titleStorage=new Map([['gitai-exhibit-visit-start-v1',existingVisit]]);
  const titleNavigations=[];
  const titleUrl='https://example.test/Gitai_Lab_Preview/exhibit/index.html';
  const startAction=vm.runInNewContext('(event)=>{'+startMatch[1]+'}',{
    URL, sessionStorage:{
      getItem:key=>titleStorage.get(key)||null,
      setItem:(key,value)=>titleStorage.set(key,value),
      removeItem:key=>titleStorage.delete(key)
    },
    location:{href:titleUrl,assign:target=>titleNavigations.push(target)}
  });
  startAction({preventDefault(){},stopImmediatePropagation(){}});
  assert.deepEqual(titleNavigations,[
    'https://example.test/Gitai_Lab_Preview/exhibit/modes.html'
  ]);
  assert.equal(titleStorage.get('gitai-exhibit-visit-start-v1'),existingVisit,
    'opening START mid-visit must not reset five-generation allowance');
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
  // This visitor counter must be cleared on success, BEFORE any theater
  // playback. Otherwise interrupting Safari's closing movie causes the
  // next visitor to inherit their predecessor's 5-generation allowance.
  assert.equal(p.stash.has('gitai-exhibit-visit-start-v1'),false,
    'successful handover clears old visitor count before theater playback');
  assert.deepEqual(JSON.parse(p.stash.get('gitai-exhibit-handover-v1')),
    {mode:'cryptic',start:21,end:21},
    'theater must still have the exact previous visitor replay range');
  const nextSession=fixture({start:22,end:22,sessionStash:p.stash});
  assert.equal(nextSession.api.start(),22,'next visitor restarts count from offspring');
  assert.equal(nextSession.api.notice.hidden,true,
    'next visitor must not immediately hit the previous 5-gen limit');
  assert.equal(nextSession.api.button.hidden,false);
  assert.equal(p.lifeWrites,0,'cryptic handover must NEVER touch warning-life storage');
  for(const mode of ['cryptic','warning']){
    const mid=fixture({mode,start:21,end:24});
    assert.equal(mid.api.button.hidden,false,'1-4 generation manual swap');
    await mid.api.safelyHandover();
    assert.equal(mid.pointer,'gen00025');
    assert.equal(JSON.parse(mid.stash.get('gitai-exhibit-handover-v1')).mode,mode);
    assert.equal(mid.stash.has('gitai-exhibit-visit-start-v1'),false,
      'both exhibition modes reset the visitor counter after a saved handover');
    const successor=fixture({mode,start:25,end:25,sessionStash:mid.stash});
    assert.equal(successor.api.start(),25,'the next visitor begins counting at new generation');
    assert.equal(successor.api.notice.hidden,true);
    assert.equal(successor.api.button.hidden,false);
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
    assert.equal(fifth.stash.has('gitai-exhibit-visit-start-v1'),false,
      'the forced fifth generation handover clears the visitor counter');
    if(mode==='warning')assert.deepEqual(JSON.parse(fifth.life),{
      generation_id:'gen00026',thirds:30
    },'fifth-generation handover also resets only life');
  }
  // T-003 A-2: the real exhibition handover from warning generation 26
  // commits exactly generation 27 and gives the NEXT visitor 10 hearts.
  const warningHandover26=fixture({mode:'warning',start:26,end:26});
  assert.equal(JSON.parse(warningHandover26.life).thirds,12);
  await warningHandover26.api.safelyHandover();
  assert.equal(warningHandover26.pointer,'gen00027');
  assert.equal(warningHandover26.clicks,1,'one offspring generation only');
  assert.equal(warningHandover26.navigations.length,1);
  assert.deepEqual(JSON.parse(warningHandover26.life),{
    generation_id:'gen00027',thirds:30
  },'only a completed handover resets life to 10 hearts');
  assert.equal(warningHandover26.stash.has('gitai-exhibit-visit-start-v1'),false);

  // T-003 A-3: the same visitor presses the NORMAL next-generation button
  // (not the handover button). The main game saves remaining hearts, and
  // exhibit/game.js must NOT replace them with 10 or reset the visit count.
  const sameVisitor=fixture({mode:'warning',start:26,end:26});
  const normalNext=sameVisitor.nodes.continueButton.click();
  assert.equal(normalNext.stopped,false,'generation 1 of 5 uses the normal action');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sameVisitor.pointer,'gen00027');
  assert.equal(sameVisitor.clicks,1);
  assert.deepEqual(JSON.parse(sameVisitor.life),{
    generation_id:'gen00027',thirds:6
  },'same visitor keeps main-game remaining life, not ten hearts');
  assert.equal(sameVisitor.lifeWrites,0,'no exhibition life reset without handover');
  assert.equal(sameVisitor.navigations.length,0,'normal play must not navigate');
  assert.equal(JSON.parse(sameVisitor.stash.get('gitai-exhibit-visit-start-v1')).start,26,
    'the same visitor keeps the original five-generation window');

  // T-003 A-4/A-6: a page RELOAD mid-visit must recover the original
  // first generation from sessionStorage rather than award five fresh rounds.
  // This is a DOM/controller reload regression, NOT an iPad OS termination test.
  const continuingVisitStash=new Map([
    ['gitai-exhibit-visit-start-v1',JSON.stringify({mode:'warning',start:26})]
  ]);
  const resumed=fixture({
    mode:'warning',start:29,end:30,sessionStash:continuingVisitStash
  });
  assert.equal(resumed.api.start(),26,'reload restores original visitor start');
  assert.equal(resumed.api.notice.hidden,false,'fifth generation reached after reload');
  assert.equal(resumed.api.button.hidden,true,'manual handover hidden at five generations');
  assert.equal(resumed.nodes.continueButton.textContent,'次へ（進化シアター）');
  resumed.nodes.continueButton.click();
  await waitFor(()=>resumed.navigations.length>0);
  assert.equal(resumed.pointer,'gen00031','fifth result persists exactly one next generation');
  assert.equal(resumed.clicks,1);
  assert.deepEqual(JSON.parse(resumed.life),{generation_id:'gen00031',thirds:30});
  assert.equal(continuingVisitStash.has('gitai-exhibit-visit-start-v1'),false);
  const afterReloadHandover=fixture({
    mode:'warning',start:31,end:31,sessionStash:continuingVisitStash
  });
  assert.equal(afterReloadHandover.api.start(),31,
    'new visitor receives five fresh generations only after saved handover');
  assert.equal(afterReloadHandover.api.notice.hidden,true);

  const nextVisitor=fixture({start:26,end:26});
  assert.equal(nextVisitor.api.start(),26);
  for(const behavior of ['stale','invalid','fail']){
    const failed=fixture({behavior});
    await failed.api.safelyHandover();
    assert.equal(failed.navigations.length,0,'failed commit cannot navigate');
    assert.equal(failed.api.pending(),false);
    assert.equal(failed.api.button.disabled,false);
    assert.equal(failed.stash.has('gitai-exhibit-handover-v1'),false);
    assert.equal(failed.stash.has('gitai-exhibit-visit-start-v1'),true,
      'failed evolution cannot erase the original visitor count');
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
  assert.equal(failedLife.stash.has('gitai-exhibit-visit-start-v1'),true,
    'failed life reset cannot finish the visitor handover');
  assert.match(failedLife.errors.join(' '),/ライフ10/);
  assert.equal(failedLife.lifeWrites,1);
  assert.equal(JSON.parse(failedLife.life).thirds,6,
    'failed reset must leave the actual saved life intact');

  // A temporary localStorage failure occurs AFTER the only evolution DB
  // commit. The retry must never submit again or skip an additional
  // generation; the UI must expose the retry instead of remaining covered
  // by the generation-ready overlay.
  const retry=fixture({mode:'warning',lifeSaveFailures:1});
  await retry.api.safelyHandover();
  assert.equal(retry.pointer,'gen00022');
  assert.equal(retry.clicks,1);
  assert.equal(retry.navigations.length,0);
  assert.equal(retry.api.pending(),false);
  assert.equal(retry.nodes.reviewOverlay.classList.contains('visible'),true);
  assert.equal(retry.nodes.generationOverlay.classList.contains('visible'),false);
  assert.equal(retry.api.button.hidden,false);
  assert.match(retry.api.button.textContent,/保存の再試行/);
  assert.equal(retry.stash.has('gitai-exhibit-visit-start-v1'),true);
  assert.equal(JSON.parse(retry.life).thirds,6,'the primary game life save is preserved');
  await retry.api.safelyHandover();
  assert.equal(retry.pointer,'gen00022','retry must not advance an extra generation');
  assert.equal(retry.clicks,1,'retry must NOT call original evolve button twice');
  assert.equal(retry.navigations.length,1);
  assert.deepEqual(JSON.parse(retry.life),{generation_id:'gen00022',thirds:30});
  assert.equal(retry.lifeWrites,2);
  assert.equal(retry.stash.has('gitai-exhibit-visit-start-v1'),false);
  assert.equal(JSON.parse(retry.stash.get('gitai-exhibit-handover-v1')).end,21);

  const staleAfterCommit=fixture({mode:'warning',lifeSaveError:true});
  await staleAfterCommit.api.safelyHandover();
  staleAfterCommit.pointer='gen00023'; // Another tab progressed.
  await staleAfterCommit.api.safelyHandover();
  assert.equal(staleAfterCommit.clicks,1,
    'changed generation must not be evolved again');
  assert.equal(staleAfterCommit.navigations.length,0);
  assert.equal(staleAfterCommit.lifeWrites,1,
    'changed generation must not receive a stale life reset');
  assert.match(staleAfterCommit.errors.join(' '),/別の画面/);

  const disabled=fixture({disabled:true});
  assert.equal(disabled.api.button.hidden,true);
  await disabled.api.safelyHandover();
  assert.equal(disabled.clicks,0);
  const playing=fixture({review:false});
  await playing.api.safelyHandover();
  assert.equal(playing.clicks,0);
  console.log('EXH: both visitor handovers reset count after saved offspring; warning-life failures are safely retryable without second evolution, and stale generations fail closed.');
})().catch(e=>{console.error(e);process.exitCode=1});
