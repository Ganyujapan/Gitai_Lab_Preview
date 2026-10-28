'use strict';
// EXH-F03: execute the ACTUAL admin export handoff UI in a deterministic
// synchronous-click harness. A Share/Download must start in its OWN gesture,
// never after the async IndexedDB/PNG/JSON preparation has consumed activation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('exhibit/admin.js','utf8');
const html=fs.readFileSync('exhibit/modes.html','utf8');
function section(start,end){
  const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing admin handoff section '+start);
  return src.slice(a,b);
}
const exportFunction=section('  async function exportMode(modeId) {','  // Existing export encoding');
const handoff=section('  const exportButton=document.getElementById(\'exhibitBackupExport\');',
  '  const input = document.getElementById(\'exhibitBackupFile\');');
assert.match(exportFunction,/return Object\.freeze\(\{generation: current, mode: modeId, file\}\)/);
assert.doesNotMatch(exportFunction,/navigator\.share\(|link\.click\(|URL\.createObjectURL/);
new vm.Script(handoff,{filename:'admin.js:EXH-F03'});
for(const id of ['exhibitBackupExport','exhibitBackupShare','exhibitBackupDownload']){
  assert.match(html,new RegExp('id="'+id+'"'));
}
assert.match(html,/id="exhibitBackupShare" hidden/);
assert.match(html,/id="exhibitBackupDownload" hidden/);
assert.match(html,/JSONバックアップを準備する/);
assert.match(handoff,/const handoff=navigator\.share\(/);
assert.match(handoff,/link\.click\(\)/);
assert.ok(handoff.indexOf('shareButton.addEventListener(\'click\'')>=0);
assert.ok(handoff.indexOf('downloadButton.addEventListener(\'click\'')>=0);
assert.doesNotMatch(handoff.slice(
  handoff.indexOf('shareButton.addEventListener(\'click\''),
  handoff.indexOf('downloadButton.addEventListener(\'click\'')),
  /await /,'Share must be called without an await in user click handler');

function harness({canShare=true,shareError=null}={}){
  const listeners={};
  const counts={export:0,share:0,download:0,revoke:0,anchors:0,createUrl:0};
  const msgs=[],links=[];
  const file={name:'gitailab_2026_cryptic_gen00042.json',size:4096};
  const controls=Object.fromEntries(
    ['exhibitBackupExport','exhibitBackupShare','exhibitBackupDownload'].map(id=>[
      id,{hidden:id!=='exhibitBackupExport',disabled:false,
        addEventListener(type,cb){listeners[id+':'+type]=cb}}
    ])
  );
  const selector={value:'cryptic',addEventListener(type,cb){
    listeners['selector:'+type]=cb;
  }};
  const body={appendChild(link){counts.anchors++;links.push(link)}};
  let allowShare=canShare, nextShareError=shareError,unlocked=true,resolveExport=null;
  const ctx={
    document:{
      getElementById(id){assert.ok(controls[id]);return controls[id]},
      createElement(tag){
        assert.equal(tag,'a');
        return {href:null,download:null,hidden:false,
          click(){counts.download++;assert.equal(ctx.inGesture,true)},
          remove(){}};
      },
      body
    },
    navigator:{
      canShare({files}){return allowShare&&files.length===1},
      share({files,title}){
        counts.share++;
        assert.equal(ctx.inGesture,true,
          'navigator.share() must run synchronously inside direct click gesture');
        assert.equal(title,'ギタイラボ 進化バックアップ');
        assert.strictEqual(files[0],file);
        if(nextShareError){
          const e=nextShareError;
          nextShareError=null;
          return Promise.reject(e);
        }
        return Promise.resolve();
      }
    },
    URL:{
      createObjectURL(blob){
        counts.createUrl++;
        assert.strictEqual(blob,file);
        return 'blob:synthetic-backup';
      },
      revokeObjectURL(url){
        assert.equal(url,'blob:synthetic-backup');counts.revoke++;
      }
    },
    setTimeout(fn){fn();},
    MODES:{cryptic:{label:'隠れるギタイ'},warning:{label:'目立つギタイ'}},
    selector,unlocked,
    say(msg){msgs.push(msg)},
    exportMode(mode){
      counts.export++;
      // Deliberately pending until our test releases it: there is no share
      // gesture left at the time of this Promise resolution.
      return new Promise(resolve=>{
        resolveExport=()=>resolve({file,generation:'gen00042',mode});
      });
    },
    console
  };
  ctx.inGesture=false;
  vm.runInNewContext(handoff,ctx,{filename:'admin.js:handoff',timeout:1500});
  function click(id){
    const cb=listeners[id+':click];assert.equal(typeof cb,'function');
    ctx.inGesture=true;
    try{return cb();}
    finally{ctx.inGesture=false;}
  }
  return {controls,counts,msgs,file,selector,ctx,
    click,resolve(){assert.equal(typeof resolveExport,'function');resolveExport()},
    changeMode(mode){selector.value=mode;listeners['selector:change']()},
    lock(){ctx.unlocked=false;},
    canShare(value){allowShare=value}
  };
}
(async()=>{
  const h=harness();
  assert.equal(h.controls.exhibitBackupShare.hidden,true);
  assert.equal(h.controls.exhibitBackupDownload.hidden,true);
  const pending=h.click('exhibitBackupExport');
  assert.equal(h.counts.export,1);
  assert.equal(h.counts.share,0);
  assert.equal(h.counts.download,0);
  assert.equal(h.controls.exhibitBackupExport.disabled,true);
  assert.equal(h.controls.exhibitBackupShare.hidden,true);
  // A double-click during preparation is ignored; no duplicate serialization.
  h.click('exhibitBackupExport');
  assert.equal(h.counts.export,1);
  h.resolve();
  await pending;
  assert.equal(h.counts.share,0,'Async preparation must NOT start sharing');
  assert.equal(h.counts.download,0);
  assert.equal(h.controls.exhibitBackupShare.hidden,false);
  assert.equal(h.controls.exhibitBackupDownload.hidden,false);
  assert.match(h.msgs.at(-1),/まだiPadには保存されていません/);
  h.click('exhibitBackupShare');
  assert.equal(h.counts.share,1);
  await Promise.resolve();await Promise.resolve();
  assert.match(h.msgs.at(-1),/保存が完了したとは限りません/);
  h.click('exhibitBackupDownload');
  assert.equal(h.counts.download,1);
  assert.equal(h.counts.createUrl,1);
  assert.equal(h.counts.revoke,1);
  assert.equal(h.counts.anchors,1);
  assert.match(h.msgs.at(-1),/保存完了の保証ではありません/);
  assert.equal(h.controls.exhibitBackupShare.hidden,false,
    'File must remain available after share returns until re-prepared/lock');

  const deny=harness({canShare:false});
  const p=deny.click('exhibitBackupExport');deny.resolve();await p;
  deny.click('exhibitBackupShare');
  assert.equal(deny.counts.share,0);
  assert.match(deny.msgs.at(-1),/JSONをダウンロード/);
  deny.click('exhibitBackupDownload');
  assert.equal(deny.counts.download,1);

  const cancel=harness({shareError:Object.assign(new Error('cancel'),{name:'AbortError'})});
  const cp=cancel.click('exhibitBackupExport');cancel.resolve();await cp;
  cancel.click('exhibitBackupShare');
  await Promise.resolve();await Promise.resolve();
  assert.match(cancel.msgs.at(-1),/共有をキャンセル/);
  assert.equal(cancel.controls.exhibitBackupDownload.hidden,false);

  const changed=harness();
  const inflight=changed.click('exhibitBackupExport');
  changed.changeMode('warning');
  changed.resolve();await inflight;
  assert.equal(changed.controls.exhibitBackupShare.hidden,true,
    'Mode switch while preparing must discard stale archive');
  changed.click('exhibitBackupShare');
  assert.equal(changed.counts.share,0);

  const locked=harness();
  const lp=locked.click('exhibitBackupExport');locked.lock();locked.resolve();await lp;
  assert.equal(locked.controls.exhibitBackupShare.hidden,true);
  locked.click('exhibitBackupShare');
  locked.click('exhibitBackupDownload');
  assert.equal(locked.counts.share,0);
  assert.equal(locked.counts.download,0);

  console.log('EXH-F03: second direct gesture shares/downloads prepared v1 File; async export never implicitly shares, cancellations retain archive, mode changes and locks fail closed, no premature saved-success claim.');
})().catch(e=>{console.error(e);process.exitCode=1});
