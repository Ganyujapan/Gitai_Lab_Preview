'use strict';
// AUD-UPD-01: evaluate the actual admin Service Worker "Apply update" click
// handler against mocked browser primitives. No IndexedDB, localStorage,
// real Service Worker or real game data is accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('exhibit/admin.js','utf8');
const start=src.indexOf("  updateApply.addEventListener('click', async () => {");
const end=src.indexOf("\n  });",start);
assert.ok(start>0&&end>start,'Missing production apply-update handler');
const code=src.slice(start,end+6);
new vm.Script(code,{filename:'exhibit/admin.js:updateApply'});
assert.match(code,/if\(preparingBackup\)\{/);
assert.match(code,/if\(preparedBackup && !confirm\(/);
assert.match(code,/保存済みJSONをiPadの「ファイル」から再選択して検証しましたか/);
assert.match(code,/if\(restoreMutationBusy \|\| preparingBackup\)/);
function harness({preparing=false,prepared=false,restore=false,
                  confirmations=[],intervene=null}={}){
  const status=[],calls=[];
  let handler=null,change=null,posted=0,reloaded=0;
  const archive={mode:'cryptic',generation:'gen00042',file:{size:2048}};
  const ctx={
    unlocked:true,
    pendingWorker:{postMessage(message){
      posted++;
      assert.equal(message.type,'APPLY_EXHIBIT_UPDATE');
      if(intervene)intervene(ctx);
      if(change)change();
    }},
    updateApply:{
      hidden:false,disabled:false,
      addEventListener(type,fn){
        assert.equal(type,'click');handler=fn;
      }
    },
    preparingBackup:preparing,
    preparedBackup:prepared?archive:null,
    restoreMutationBusy:restore,
    MODES:{cryptic:{label:'隠れるギタイ'}},
    setUpdate(text){status.push(text)},
    confirm(text){
      calls.push(text);
      return confirmations.length?confirmations.shift():true;
    },
    navigator:{serviceWorker:{addEventListener(event,fn,opts){
      assert.equal(event,'controllerchange');
      assert.equal(opts.once,true);
      change=fn;
    }}},
    setTimeout(){return 123;},clearTimeout(t){assert.equal(t,123)},
    Promise,
    location:{reload(){reloaded++}},
    Error
  };
  vm.runInNewContext(code,ctx,{filename:'admin.js:apply',timeout:2000});
  return {
    ctx,status,calls,run:()=>handler(),
    get posted(){return posted},get reloaded(){return reloaded}
  };
}
(async()=>{
  const normal=harness();
  await normal.run();
  assert.equal(normal.posted,1);assert.equal(normal.reloaded,1);
  assert.equal(normal.calls.length,1);

  const restoring=harness({restore:true});
  await restoring.run();
  assert.equal(restoring.posted,0);assert.equal(restoring.reloaded,0);
  assert.equal(restoring.calls.length,0);
  assert.match(restoring.status.at(-1),/復元処理中/);

  const busy=harness({preparing:true});
  await busy.run();
  assert.equal(busy.posted,0);assert.equal(busy.reloaded,0);
  assert.equal(busy.calls.length,0);
  assert.match(busy.status.at(-1),/バックアップを準備中/);

  const unsaved=harness({prepared:true,confirmations:[false]});
  await unsaved.run();
  assert.equal(unsaved.posted,0);assert.equal(unsaved.reloaded,0);
  assert.equal(unsaved.calls.length,1);
  assert.match(unsaved.calls[0],/隠れるギタイ gen00042/);
  assert.match(unsaved.calls[0],/メモリ内のファイルは消えます/);
  assert.match(unsaved.status.at(-1),/準備済みのJSONは保持/);
  assert.equal(unsaved.ctx.preparedBackup.file.size,2048);

  const stopAtFinal=harness({prepared:true,confirmations:[true,false]});
  await stopAtFinal.run();
  assert.equal(stopAtFinal.calls.length,2);
  assert.equal(stopAtFinal.posted,0);
  assert.equal(stopAtFinal.ctx.preparedBackup.file.size,2048);

  const deliberate=harness({prepared:true,confirmations:[true,true]});
  await deliberate.run();
  assert.equal(deliberate.calls.length,2);
  assert.equal(deliberate.posted,1);
  assert.equal(deliberate.reloaded,1);

  // The controller can switch during an export that started after the Apply
  // click; reloading would discard that ongoing export's unsaved File.
  const race=harness({intervene:ctx=>{ctx.preparingBackup=true;}});
  await race.run();
  assert.equal(race.posted,1);
  assert.equal(race.reloaded,0,'Do not interrupt newly started backup');
  assert.match(race.status.at(-1),/自動再読み込みを控えました/);
  // Also preserve a newly started restore after the SW takeover.
  const restoreRace=harness({intervene:ctx=>{ctx.restoreMutationBusy=true;}});
  await restoreRace.run();
  assert.equal(restoreRace.posted,1);
  assert.equal(restoreRace.reloaded,0);
  assert.match(restoreRace.status.at(-1),/自動再読み込みを控えました/);

  console.log('AUD-UPD-01: actual update UI blocks active export/restore; warns before dropping in-memory JSON, accepts explicit override and avoids late reload during newly started operations.');
})().catch(e=>{console.error(e);process.exitCode=1;});
