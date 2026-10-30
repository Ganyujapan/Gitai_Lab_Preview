'use strict';
// Execute the REAL reset helpers extracted from shipped admin.js against
// isolated synthetic DB transactions. Never touch a real user's IndexedDB.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('exhibit/admin.js','utf8');
const html=fs.readFileSync('exhibit/modes.html','utf8');
const begin=source.indexOf('  // EXH-RESET-BEGIN:');
const end=source.indexOf('  // EXH-RESET-END.',begin);
assert.ok(begin>0&&end>begin,'Reset helpers must be present');
assert.match(html,/id="exhibitResetInspect"/);
assert.match(html,/id="exhibitResetExecute" disabled/);
assert.match(source,/if \(!unlocked \|\| !snapshot \|\| snapshot\.mode !== modeId/);
assert.match(source,/prompt\('最終確認：'/);
assert.match(source,/!== 'RESET'/);
assert.doesNotMatch(source.slice(begin,end).replace(/\/\/[^\n]*/g,''),/deleteDatabase|caches\.delete|localStorage\.clear|indexedDB\.deleteDatabase/);
const helperCode=source.slice(begin,end)+'\n globalThis.api={inspectModeBeforeReset,resetModeForExhibit};';
const STORES=['images','meta','theater_frames'];
const MODES={
  cryptic:{label:'隠れるギタイ',db:'cryptic-exhibit-db'},
  warning:{label:'目立つギタイ',db:'warning-exhibit-db'}
};
function fixture({clearFails=false,lifeRemoveFails=false}={}) {
  const data={};
  for(const mode of Object.keys(MODES))data[mode]={
    images:new Map([['gen00018:01','img-'+mode]]),
    meta:new Map([['current_generation_id','gen00018'],['restore_epoch','prior-'+mode],['genome:gen00018:01','dna-'+mode]]),
    theater_frames:new Map([['gen00018-frame','frame-'+mode]])
  };
  const warningLifeKey='gitai-warning-life-v1:'+MODES.warning.db;
  const durableCryptic='gitai-exhibit-visit-start-durable-v1:'+MODES.cryptic.db;
  const durableWarning='gitai-exhibit-visit-start-durable-v1:'+MODES.warning.db;
  const pendingCryptic='gitai-exhibit-handover-pending-durable-v1:'+MODES.cryptic.db;
  const pendingWarning='gitai-exhibit-handover-pending-durable-v1:'+MODES.warning.db;
  const local=new Map([[warningLifeKey,'old warning hearts'],['admin-pin','keep'],
    [pendingCryptic,'synthetic pending cryptic'],
    [pendingWarning,'synthetic pending warning'],
    [durableCryptic,JSON.stringify({mode:'cryptic',namespace:MODES.cryptic.db,start:15})],
    [durableWarning,JSON.stringify({mode:'warning',namespace:MODES.warning.db,start:16})]]);
  const session=new Map([['gitai-exhibit-visit-start-v1',JSON.stringify({mode:'warning',start:18})],
    ['gitai-exhibit-handover-v1',JSON.stringify({mode:'warning',start:17,end:18})],
    ['gitai-exhibit-handover-pending-v1',
      JSON.stringify({mode:'warning',start:17,end:18})]]);
  let reads=0,writes=0,closes=0,txAborts=0;
  function openDb(name){
    const mode=Object.keys(MODES).find(key=>MODES[key].db===name);
    assert.ok(mode,'reset never opens a non-exhibition database');
    const state=data[mode];
    return Promise.resolve({
      close(){closes++;},
      transaction(storeNames,kind){
        assert.deepEqual([...storeNames],STORES,'all stores must be in a single transaction');
        assert.ok(['readonly','readwrite'].includes(kind));
        const tx={oncomplete:null,onabort:null,onerror:null,error:null};
        let queue=[],scheduled=false,aborted=false,completed=false;
        const staged=[];
        function pump(){
          if(scheduled||aborted||completed)return;
          scheduled=true;
          queueMicrotask(()=>{
            scheduled=false;
            if(aborted||completed)return;
            const job=queue.shift();
            if(job){job();pump();}
            else {completed=true;for(const op of staged)op();tx.oncomplete?.();}
          });
        }
        function read(value){
          reads++;
          const req={result:undefined,onsuccess:null};
          queue.push(()=>{req.result=value();req.onsuccess?.();});pump();return req;
        }
        tx.abort=()=>{if(aborted||completed)return;aborted=true;txAborts++;queue=[];tx.onabort?.();};
        tx.objectStore=store=>{
          assert.ok(storeNames.includes(store));
          return {
            get(key){return read(()=>state[store].get(key));},
            count(){return read(()=>state[store].size);},
            clear(){
              assert.equal(kind,'readwrite');
              if(clearFails)throw Error('simulated quota failure');
              writes++;staged.push(()=>state[store].clear());
            },
            put(value,key){
              assert.equal(kind,'readwrite');writes++;
              staged.push(()=>state[store].set(key,value));
            }
          };
        };
        return tx;
      }
    });
  }
  const context={
    MODES,STORES,openDb,Error,Uint8Array,
    crypto:{getRandomValues(a){a.fill(11);return a;}},
    warningLifeStorageKey:name=>'gitai-warning-life-v1:'+name,
    localStorage:{
      getItem:key=>local.get(key)??null,
      removeItem(key){
        if(lifeRemoveFails)throw Error('simulated iPad localStorage failure');
        local.delete(key);
      }
    },
    sessionStorage:{
      getItem:key=>session.get(key)??null,
      removeItem(key){session.delete(key);}
    }
  };
  vm.runInNewContext(helperCode,context,{timeout:2500});
  return {api:context.api,data,local,session,warningLifeKey,
    durableCryptic,durableWarning,pendingCryptic,pendingWarning,
    get reads(){return reads},get writes(){return writes},
    get closes(){return closes},get aborts(){return txAborts}};
}
(async()=>{
  const i=fixture();
  const before=await i.api.inspectModeBeforeReset('cryptic');
  assert.equal(before.generation,'gen00018');
  assert.equal(before.counts.images,1);
  assert.equal(before.counts.meta,3);
  assert.equal(i.writes,0,'preview is strictly read-only');
  const result=await i.api.resetModeForExhibit('cryptic',before);
  assert.equal(result.status,'complete');
  assert.equal(i.data.cryptic.images.size,0);
  assert.equal(i.data.cryptic.meta.has('current_generation_id'),false);
  assert.equal(i.data.cryptic.meta.size,1,'new reset epoch is retained');
  assert.match(i.data.cryptic.meta.get('restore_epoch'),/^exhibit-reset-/);
  assert.equal(i.data.cryptic.theater_frames.size,0);
  assert.equal(i.data.warning.images.size,1,'warning data is untouched');
  assert.equal(i.local.has(i.durableCryptic),false,
    'admin reset clears selected mode\'s durable visitor allowance');
  assert.equal(i.local.has(i.durableWarning),true,
    'reset does not clear the other mode\'s allowance');
  assert.equal(i.local.has(i.pendingCryptic),false);
  assert.equal(i.local.has(i.pendingWarning),true,
    'other mode pending handover is not touched by this reset');
  assert.equal(i.local.get(i.warningLifeKey),'old warning hearts');
  assert.ok(i.session.has('gitai-exhibit-visit-start-v1'),
    'a cryptic reset does not erase a warning visitor session');
  const snapWarning=await i.api.inspectModeBeforeReset('warning');
  const w=await i.api.resetModeForExhibit('warning',snapWarning);
  assert.equal(w.status,'complete');
  assert.equal(i.data.warning.images.size,0);
  assert.equal(i.data.warning.meta.has('current_generation_id'),false);
  assert.ok(!i.local.has(i.warningLifeKey),'warning life key cleared');
  assert.equal(i.local.has(i.durableWarning),false,
    'warning reset clears its durable visitor allowance');
  assert.equal(i.local.has(i.pendingWarning),false,
    'warning reset clears any interrupted warning handover');
  assert.equal(i.local.get('admin-pin'),'keep','administrator PIN never reset');
  assert.equal(i.session.size,0,'warning session and handover cleared');
  assert.equal(i.closes,4,'all DB connections closed');

  const stale=fixture();
  const snap=await stale.api.inspectModeBeforeReset('cryptic');
  stale.data.cryptic.meta.set('current_generation_id','gen00019');
  await assert.rejects(stale.api.resetModeForExhibit('cryptic',snap),
    /他の画面で世代・保存履歴が変更/);
  assert.equal(stale.data.cryptic.images.size,1,
    'stale snapshot must not clear any store');
  assert.equal(stale.aborts,1,'racing generation aborts atomic IDB transaction');

  const epochRace=fixture();
  const staleEpoch=await epochRace.api.inspectModeBeforeReset('cryptic');
  epochRace.data.cryptic.meta.set('restore_epoch','other-restore');
  await assert.rejects(epochRace.api.resetModeForExhibit('cryptic',staleEpoch),
    /他の画面で世代・保存履歴が変更/);
  assert.equal(epochRace.data.cryptic.images.size,1);

  const failed=fixture({clearFails:true});
  const preview=await failed.api.inspectModeBeforeReset('warning');
  await assert.rejects(failed.api.resetModeForExhibit('warning',preview),
    /simulated quota failure/);
  assert.equal(failed.data.warning.images.size,1,'failed transaction rolls back everything');
  assert.equal(failed.local.get(failed.warningLifeKey),'old warning hearts');
  assert.equal(failed.aborts,1);

  const partial=fixture({lifeRemoveFails:true});
  const ps=await partial.api.inspectModeBeforeReset('warning');
  const res=await partial.api.resetModeForExhibit('warning',ps);
  assert.equal(res.status,'partial','IDB-committed life cleanup failure cannot be called total failure');
  assert.match(res.detail,/ライフ/);
  assert.equal(partial.data.warning.images.size,0);
  assert.equal(partial.local.get(partial.warningLifeKey),'old warning hearts');

  await assert.rejects(fixture().api.resetModeForExhibit('warning',{mode:'cryptic'}),
    /対象モード/);
  console.log('EXH-RESET: read-only preview; mode-isolated atomic clear; stale generation/epoch abort; rollback; partial life; admin PIN/cache untouched.');
})().catch(error=>{console.error(error);process.exitCode=1;});
