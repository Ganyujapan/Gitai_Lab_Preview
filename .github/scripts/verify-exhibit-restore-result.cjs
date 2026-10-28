'use strict';
// EXH-03: run the REAL backup validator, restore code and file-change UI
// using isolated stores. Never open a device's existing IndexedDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

const source = fs.readFileSync('exhibit/admin.js', 'utf8');
const restoreStart = source.indexOf('  const MAX_BACKUP_BYTES = ');
const restoreEnd = source.indexOf('\n  const button = document.getElementById', restoreStart);
const handlerStart = source.indexOf("  const input = document.getElementById('exhibitBackupFile');");
// Anchor on executable code, not wording of EXH-05 lifecycle comments.
const handlerEnd = source.indexOf("  const updateStatus = document.getElementById('exhibitUpdateStatus');", handlerStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
assert.ok(handlerStart > restoreEnd && handlerEnd > handlerStart);
const realCode = source.slice(restoreStart, restoreEnd) + '\n' +
  source.slice(handlerStart, handlerEnd);
assert.match(realCode, /db\.transaction\(STORES, 'readwrite'\)/);
assert.match(realCode, /result\.status === 'partial'/);
assert.match(realCode, /status: 'cancelled'/);

const crypticDb = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
const warningDb = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2';
const lifeKey = 'gitai-warning-life-v1:' + warningDb;
const MODES = {
  cryptic: {label:'隠れるギタイ', db:crypticDb},
  warning: {label:'目立つギタイ', db:warningDb}
};
const STORES = ['images', 'meta', 'theater_frames'];
const digest = async value => crypto.createHash('sha256').update(value).digest('hex');

function mothBlob() {
  const bytes = new Uint8Array(25);
  bytes.set([137,80,78,71,13,10,26,10]);
  bytes[19] = 128;
  bytes[23] = 128;
  return {$blob: Array.from(bytes), mime:'image/png'};
}
const EXPECTED_LOCI=JSON.parse(fs.readFileSync(
  'data/evolution_models/continuous_v1/config.json','utf8'
)).trait_genetics.pattern_loci.map(x=>x.id);
function genome(i, warning) {
  const modules=Object.fromEntries(EXPECTED_LOCI.map(id=>[id,{
    alleles:[1,0],cx:0.5,cy:0.5,rx:0.2,ry:0.2,
    valueEffect:-0.2,hueEffect:0,saturationEffect:0,
    phase:1.5,angle:0,frequency:1.5,roughness:0.25
  }]));
  return {schema_version:1, baseHue:30, baseSaturation:.3, baseValue:.9,
    patternContrast:.3, textureStrength:.01, textureSeed:i,
    modules,
    ...(warning ? {lineage:i <= 30 ? 'poison' : 'harmless'} : {})};
}
function backup(mode, warningLife) {
  const gen = mode === 'warning' ? 'gen00025' : 'gen00035';
  const body = {
    schema:'gitai-exhibit-backup-v1',
    mode, database:MODES[mode].db, databaseVersion:2,
    currentGeneration:gen, createdAt:'2026-10-26T00:00:00Z',
    warningLife:mode === 'warning' ? warningLife : null,
    stores:{
      images:Array.from({length:60}, (_,i) => ({
        key:gen + ':' + String(i+1).padStart(2,'0'),value:mothBlob()
      })),
      meta:[{key:'current_generation_id',value:gen},
        ...Array.from({length:60},(_,i) => ({
          key:'genome:' + gen + ':' + String(i+1).padStart(2,'0'),
          value:genome(i+1, mode === 'warning')
        }))],
      theater_frames:[]
    }
  };
  return digest(JSON.stringify(body)).then(checksum => JSON.stringify({checksum,payload:body}));
}
function harness({mode='warning', confirmed=true, idbFail=false,
                  lifeSetFail=false, lifeRemoveFail=false}={}) {
  const saved = new Map([[lifeKey,'PREVIOUS_LIFE']]);
  const messages = [], handlers = {};
  let opened = 0, closed = 0, confirmations = 0, epochCounter = 0;
  let failSet=lifeSetFail,failRemove=lifeRemoveFail;
  let stallOneOpen=false,releaseOpen=null;
  const state = {
    images: new Map([['old-image','kept']]),
    meta: new Map([['current_generation_id','gen00010']]),
    theater_frames: new Map([['old-frame','kept']])
  };
  const input = {
    value:'',files:[],
    addEventListener(event,callback){handlers['file:'+event]=callback;},
    click(){}
  };
  const restoreButton={addEventListener() {}};
  const lifeRetryButton={addEventListener(event,cb){handlers['retry:'+event]=cb;}};
  const verifyFileInput={
    value:'',files:[],click(){},
    addEventListener(event,cb){handlers['verify:'+event]=cb;}
  };
  const verifyButton={addEventListener(event,cb){handlers['verify-button:'+event]=cb;}};
  const context = {
    MODES,STORES,BACKUP_SCHEMA:'gitai-exhibit-backup-v1',
    Blob,Uint8Array,DataView,digest,
    crypto:{getRandomValues(bytes){bytes.fill((++epochCounter)%256);return bytes;}},
    selector:{value:mode},unlocked:true,
    say(message){messages.push(message);},
    confirm(){confirmations++;return confirmed;},
    decode(value){
      if(value && value.$blob) return new Blob(
        [Uint8Array.from(value.$blob)],{type:value.mime});
      return value;
    },
    createImageBitmap:async()=>({width:128,height:128,close(){}}),
    localStorage:{
      getItem(key){return saved.has(key)?saved.get(key):null;},
      setItem(key,value){
        if(failSet)throw Error('TEST_QUOTA_FAILURE');
        saved.set(key,String(value));
      },
      removeItem(key){
        if(failRemove)throw Error('TEST_REMOVE_FAILURE');
        saved.delete(key);
      }
    },
    openDb:async()=>{
      opened++;
      if(stallOneOpen){
        stallOneOpen=false;
        await new Promise(resolve=>{releaseOpen=resolve;});
      }
      return {
        close(){closed++;},
        transaction(stores,mode){
          const names=Array.isArray(stores)?stores:[stores];
          assert.ok(names.length && names.every(x=>STORES.includes(x)));
          assert.ok(mode==='readonly'||mode==='readwrite');
          const draft=Object.fromEntries(names.map(x=>[x,new Map(state[x])]));
          let pending=0,aborted=false,scheduled=false,completed=false;
          const tx={
            error:Error('TEST_IDB_ABORT'),oncomplete:null,onabort:null,onerror:null,
            objectStore(name){
              assert.ok(names.includes(name));
              return {
                clear(){assert.equal(mode,'readwrite');draft[name].clear();},
                put(value,key){
                  assert.equal(mode,'readwrite');draft[name].set(key,value);
                },
                delete(key){
                  assert.equal(mode,'readwrite');draft[name].delete(key);
                },
                get(key){
                  pending++;
                  const req={result:undefined,onsuccess:null,onerror:null};
                  queueMicrotask(()=>{
                    if(aborted||completed)return;
                    req.result=draft[name].get(key);
                    try{req.onsuccess?.();}
                    catch(error){tx.error=error;tx.abort();return;}
                    pending--;
                    settle();
                  });
                  return req;
                }
              };
            },
            abort(){
              if(aborted||completed)return;
              aborted=true;
              queueMicrotask(()=>tx.onabort?.());
            }
          };
          function settle(){
            if(aborted||completed||pending!==0||scheduled)return;
            scheduled=true;
            queueMicrotask(()=>{
              scheduled=false;
              if(aborted||completed||pending!==0)return;
              if(idbFail&&mode==='readwrite'&&names.length===STORES.length){
                aborted=true;tx.onabort?.();return;
              }
              if(mode==='readwrite'){
                for(const name of names)state[name]=draft[name];
              }
              completed=true;
              tx.oncomplete?.();
            });
          }
          queueMicrotask(settle);
          return tx;
        }
      };
    },
    document:{
      getElementById(id){
        if(id==='exhibitBackupFile')return input;
        if(id==='exhibitBackupRestore')return restoreButton;
        if(id==='exhibitBackupLifeRetry')return lifeRetryButton;
        if(id==='exhibitBackupVerifyFile')return verifyFileInput;
        if(id==='exhibitBackupVerify')return verifyButton;
        throw Error('Unexpected DOM lookup: '+id);
      }
    }
  };
  vm.runInNewContext(realCode,context,{filename:'EXH-03:exhibit/admin.js',timeout:5000});
  assert.equal(typeof handlers['file:change'],'function');
  assert.equal(typeof handlers['retry:click'],'function');
  assert.equal(typeof handlers['verify:change'],'function');
  assert.equal(typeof handlers['verify-button:click'],'function');
  return {
    messages,state,saved,
    setLifeFailure(value){failSet=value;},
    setRemoveFailure(value){failRemove=value;},
    setGeneration(value){state.meta.set('current_generation_id',value);},
    setEpoch(value){state.meta.set('restore_epoch',value);},
    get opened(){return opened;},
    get closed(){return closed;},
    get confirmations(){return confirmations;},
    stallNextOpen(){stallOneOpen=true;},
    releaseStalledOpen(){
      assert.equal(typeof releaseOpen,'function');
      releaseOpen();releaseOpen=null;
    },
    restoreDeferred(raw){
      let finishRead=null;
      input.files=[{size:raw.length,text(){return new Promise(resolve=>{
        finishRead=()=>resolve(raw);
      });}}];
      const pending=handlers['file:change']();
      return {pending,
        release(){
          assert.equal(typeof finishRead,'function');
          finishRead();
        }
      };
    },
    async verifySaved(raw) {
      handlers['verify-button:click']();
      verifyFileInput.files=[{
        size:Buffer.byteLength(raw,'utf8'),
        name:'reselected-from-ipad-files.json',
        async text(){return raw;}
      }];
      await handlers['verify:change']();
      return messages.at(-1);
    },
    async restore(raw) {
      input.files=[{size:raw.length,async text(){return raw;}}];
      await handlers['file:change']();
      return messages.at(-1);
    },
    async retry() {
      await handlers['retry:click']();
      return messages.at(-1);
    }
  };
}
(async()=>{
  const savedLife = JSON.stringify({generation_id:'gen00025',thirds:18});
  const rawWarning = await backup('warning',savedLife);
  const verifiedFirst=harness();
  const currentBefore=verifiedFirst.state.meta.get('current_generation_id');
  assert.match(await verifiedFirst.verifySaved(rawWarning),/保存済みJSONの検証成功/);
  assert.equal(verifiedFirst.state.meta.get('current_generation_id'),currentBefore,
    'Verification must not import or overwrite any evolution data');
  assert.equal(verifiedFirst.opened,0);
  assert.equal(verifiedFirst.confirmations,0);
  assert.equal(verifiedFirst.saved.get(lifeKey),'PREVIOUS_LIFE');
  const damagedCopy=JSON.parse(rawWarning);damagedCopy.checksum='wrong';
  assert.match(await verifiedFirst.verifySaved(JSON.stringify(damagedCopy)),
    /保存済みJSONの検証失敗/);
  assert.equal(verifiedFirst.opened,0);

  // AUD-RST-01: a duplicate restore (same file, different generation, or
  // life retry) cannot start while a restore is reading its JSON. The first
  // restore must be allowed to finish, and the local busy state must clear.
  const overlapping=harness();
  const pendingFirst=overlapping.restoreDeferred(rawWarning);
  assert.equal(overlapping.opened,0);
  assert.match(await overlapping.restore(rawWarning),/復元操作が実行中/);
  assert.equal(overlapping.opened,0,'no second DB restore may begin');
  assert.equal(overlapping.confirmations,0,'no second confirmation');
  assert.match(await overlapping.retry(),/復元操作が実行中/);
  assert.equal(overlapping.opened,0,'manual life retry must not race restore');
  pendingFirst.release();
  await pendingFirst.pending;
  assert.match(overlapping.messages.at(-1),/復元が完了/);
  assert.equal(overlapping.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(overlapping.opened,2,'one restore and one internal life finalize');
  assert.equal(overlapping.saved.get(lifeKey),savedLife);
  // Once completed, both new restore and retry are available again.
  assert.match(await overlapping.restore(rawWarning),/復元が完了/);
  assert.equal(overlapping.opened,4);
  assert.match(await overlapping.retry(),/再試行が必要なライフ情報はありません/);

  // Reverse order: while manual life retry is stalled at IDB open, restoring
  // a full backup must be rejected without ever overwriting any stores.
  const retryFirst=harness({lifeSetFail:true});
  assert.match(await retryFirst.restore(rawWarning),/ライフ情報を復元できませんでした/);
  retryFirst.stallNextOpen();
  const pendingRetry=retryFirst.retry();
  assert.equal(retryFirst.opened,3,'retry should be waiting at DB open');
  assert.match(await retryFirst.restore(rawWarning),/復元操作が実行中/);
  assert.equal(retryFirst.opened,3,'concurrent restore must not open DB');
  retryFirst.setLifeFailure(false);
  retryFirst.releaseStalledOpen();
  assert.match(await pendingRetry,/ライフ情報だけ復元しました/);
  assert.equal(retryFirst.opened,3);
  assert.equal(retryFirst.state.meta.get('current_generation_id'),'gen00025');
  // Cancelled/failed restores must release the mutex (previous tests cover
  // checksum failure and IDB abort; assert retry after a deliberate cancel).
  const cancelledThenRetry=harness({confirmed:false});
  assert.match(await cancelledThenRetry.restore(rawWarning),/復元をキャンセル/);
  assert.match(await cancelledThenRetry.restore(rawWarning),/復元をキャンセル/);
  assert.equal(cancelledThenRetry.opened,0);
  assert.match(source,/if\(restoreMutationBusy\)\{\s*setUpdate\('復元処理中のため、更新の適用を中止/);
  assert.match(source,/restoreMutationBusy = false;\s*}\s*}\s*\/\/ EXH-F01/);

  const full = harness();
  const fullMessage = await full.restore(rawWarning);
  assert.match(fullMessage,/復元が完了/);
  assert.equal(full.state.meta.get('current_generation_id'),'gen00025');
  const firstEpoch=full.state.meta.get('restore_epoch');
  assert.match(firstEpoch,/^restore-[a-f0-9]{32}$/);
  assert.match(await full.restore(rawWarning),/復元が完了/);
  assert.notEqual(full.state.meta.get('restore_epoch'),firstEpoch,
    'restoring the same backed-up generation MUST mint a fresh epoch');
  assert.equal(full.saved.get(lifeKey),savedLife);
  assert.equal(full.state.images.size,60);
  assert.equal(full.opened,4);
  assert.equal(full.closed,4);

  const cryptic = harness({mode:'cryptic'});
  assert.match(await cryptic.restore(await backup('cryptic',null)),/復元が完了/);
  assert.equal(cryptic.state.meta.get('current_generation_id'),'gen00035');
  assert.equal(cryptic.saved.get(lifeKey),'PREVIOUS_LIFE');

  const cancelled = harness({confirmed:false});
  assert.match(await cancelled.restore(rawWarning),/キャンセル/);
  assert.equal(cancelled.opened,0);
  assert.equal(cancelled.state.meta.get('current_generation_id'),'gen00010');
  assert.equal(cancelled.saved.get(lifeKey),'PREVIOUS_LIFE');

  const invalid = harness();
  const bad = JSON.parse(rawWarning);
  bad.checksum = 'wrong';
  assert.match(await invalid.restore(JSON.stringify(bad)),/復元失敗（既存データは保持）/);
  assert.equal(invalid.opened,0);
  assert.equal(invalid.confirmations,0);
  assert.equal(invalid.state.meta.get('current_generation_id'),'gen00010');

  for (const badLife of [
    'broken-json', JSON.stringify({generation_id:'gen00024',thirds:5}),
    JSON.stringify({generation_id:'gen00025',thirds:0}),
    JSON.stringify({generation_id:'gen00025',thirds:31}),
    JSON.stringify({generation_id:'gen00025',thirds:'18'}),
    JSON.stringify({generation_id:'gen00025',thirds:12.5}),
    JSON.stringify([]), {generation_id:'gen00025',thirds:12}
  ]) {
    const rejected = harness();
    const rejectedText = await rejected.restore(await backup('warning',badLife));
    assert.match(rejectedText,/復元失敗（既存データは保持）/);
    assert.equal(rejected.opened,0,'wrong life must be rejected before any IDB mutation');
    assert.equal(rejected.confirmations,0);
    assert.equal(rejected.state.meta.get('current_generation_id'),'gen00010');
    assert.equal(rejected.saved.get(lifeKey),'PREVIOUS_LIFE');
  }

  const idbFailure = harness({idbFail:true});
  assert.match(await idbFailure.restore(rawWarning),/復元失敗（既存データは保持）/);
  assert.equal(idbFailure.state.meta.get('current_generation_id'),'gen00010');
  assert.equal(idbFailure.state.images.get('old-image'),'kept');
  assert.equal(idbFailure.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(idbFailure.closed,1);

  const partial = harness({lifeSetFail:true});
  const final = await partial.restore(rawWarning);
  assert.match(final,/進化データ（gen00025）は復元しました/);
  assert.match(final,/ライフ情報を復元できませんでした/);
  assert.match(final,/TEST_QUOTA_FAILURE/);
  assert.doesNotMatch(final,/復元が完了|既存データは保持/);
  assert.equal(partial.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(partial.state.images.size,60);
  assert.equal(partial.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(partial.messages.length,2,'UI warning must be final, not overwritten');
  const savedEpoch=partial.state.meta.get('restore_epoch');
  assert.ok(partial.state.meta.has('pending_warning_life_restore_v1'),
    'life-retry intent must be durable in the SAME committed meta store');
  partial.setLifeFailure(false);
  assert.match(await partial.retry(),/ライフ情報だけ復元しました/);
  assert.equal(partial.saved.get(lifeKey),savedLife);
  assert.equal(partial.state.meta.get('restore_epoch'),savedEpoch,
    'retry MUST NOT perform a second destructive backup restore');
  assert.equal(partial.state.images.size,60);
  assert.equal(partial.state.meta.has('pending_warning_life_restore_v1'),false);
  assert.equal(partial.opened,3,'retry opens the existing db once, not a full import');

  const removalFailure = harness({lifeRemoveFail:true});
  const noLife = await removalFailure.restore(await backup('warning',null));
  assert.match(noLife,/ライフ情報を復元できませんでした/);
  assert.match(noLife,/TEST_REMOVE_FAILURE/);
  assert.equal(removalFailure.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(removalFailure.saved.get(lifeKey),'PREVIOUS_LIFE');
  removalFailure.setRemoveFailure(false);
  assert.match(await removalFailure.retry(),/ライフ情報だけ復元しました/);
  assert.equal(removalFailure.saved.get(lifeKey),undefined);
  assert.equal(removalFailure.state.meta.has('pending_warning_life_restore_v1'),false);

  // After a partial restore, the user may already have evolved another
  // generation. Retrying must NEVER overwrite the new generation's life.
  const advanced=harness({lifeSetFail:true});
  await advanced.restore(rawWarning);
  advanced.setLifeFailure(false);
  advanced.setGeneration('gen00026');
  assert.match(await advanced.retry(),/ライフ情報は変更していません/);
  assert.equal(advanced.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(advanced.state.meta.get('current_generation_id'),'gen00026');
  assert.ok(advanced.state.meta.has('pending_warning_life_restore_v1'));
  // An intervening restore of the SAME generation still has a fresh epoch.
  const sameGenNewEpoch=harness({lifeSetFail:true});
  await sameGenNewEpoch.restore(rawWarning);
  sameGenNewEpoch.setLifeFailure(false);
  sameGenNewEpoch.setEpoch('restore-'+'f'.repeat(32));
  assert.match(await sameGenNewEpoch.retry(),/ライフ情報は変更していません/);
  assert.equal(sameGenNewEpoch.saved.get(lifeKey),'PREVIOUS_LIFE');
  // A retry with no intent never creates new records or alters storage.
  const empty=harness();
  assert.match(await empty.retry(),/再試行が必要なライフ情報はありません/);
  assert.equal(empty.state.meta.get('current_generation_id'),'gen00010');
  assert.equal(empty.saved.get(lifeKey),'PREVIOUS_LIFE');
  // Retry may still fail due to storage denial: it must leave the pending
  // intent and current evolution generation in place until a later retry.
  const denied=harness({lifeSetFail:true});
  await denied.restore(rawWarning);
  assert.match(await denied.retry(),/ライフ情報が未完了です/);
  assert.equal(denied.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(denied.state.meta.get('current_generation_id'),'gen00025');
  assert.ok(denied.state.meta.has('pending_warning_life_restore_v1'));

  console.log('EXH-03: full warning/cryptic, cancelled, validation reject, IDB abort, localStorage set/remove partial success; UI and persisted state agree.');
})().catch(error=>{console.error(error);process.exitCode=1;});
