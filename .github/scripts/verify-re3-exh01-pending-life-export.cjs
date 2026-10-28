'use strict';
// RE3-EXH-01: Run the shipped v1 export function against synthetic, readonly
// snapshots. A warning-life restore intent must never produce an exportable file.
// No real IndexedDB, localStorage write, import or user data is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('exhibit/admin.js', 'utf8');
const begin = source.indexOf('  async function exportMode(');
const end = source.indexOf('  // Existing export encoding', begin);
assert.ok(begin > 0 && end > begin);
const exported = source.slice(begin, end);
assert.match(exported, /snapshot\.meta\.some\(item => item\.key === PENDING_WARNING_LIFE_KEY\)/);
assert.match(exported, /latest\.pending !== undefined/);
assert.ok(exported.indexOf('snapshot.meta.some') < exported.indexOf('await encode(item.value)'),
  'pending restore must be rejected before allocating encoded JSON');
const LIFE = JSON.stringify({generation_id:'gen00021',thirds:7});
const INTENT = Object.freeze({
  epoch:'restore-' + 'a'.repeat(32), generation_id:'gen00021', value:LIFE
});
class TestFile extends Blob {
  constructor(parts,name,opts) { super(parts,opts);this.name=name; }
}
function fixture({mode='warning', pendingSnapshot=false, pendingFence=false,
                  pendingNull=false, mutateLife=false}={}) {
  const dbName = mode === 'warning' ? 'test-warning' : 'test-cryptic';
  const meta = [
    {key:'current_generation_id',value:'gen00021'},
    {key:'restore_epoch',value:'restore-'+'b'.repeat(32)},
  ];
  if (pendingSnapshot) meta.push({
    key:'pending_warning_life_restore_v1',value:pendingNull?null:INTENT
  });
  const stores = {
    images:[{key:'gen00021:01',value:'synthetic-png'}],
    meta,
    theater_frames:[]
  };
  const before=JSON.stringify(stores);
  let opens=0, closes=0, encodes=0, fileCreations=0, writes=0, lifeReads=0;
  class CountingFile extends TestFile {
    constructor(...args) { super(...args);fileCreations++; }
  }
  const ctx = {
    Object,Map,Set,Date,File:CountingFile,JSON,
    BACKUP_SCHEMA:'gitai-exhibit-backup-v1',
    PENDING_WARNING_LIFE_KEY:'pending_warning_life_restore_v1',
    MODES:{warning:{db:'test-warning'},cryptic:{db:'test-cryptic'}},
    STORES:['images','meta','theater_frames'],
    openDb:async name=>{
      assert.equal(name,dbName);
      opens++;
      return {close(){closes++}};
    },
    preflightExportEntryCount:async()=>{},
    snapshotStores:async()=>stores,
    verifyExportCurrentSnapshot:async()=>{},
    encode:async value=>{encodes++;return value;},
    fetch:async()=>({json:async()=>({build:'synthetic'})}),
    digest:async()=> 'synthetic-checksum',
    checkBackupExportLimits:()=>{},
    checkWarningLife:(value,gen)=>{
      if(value!==null)assert.equal(JSON.parse(value).generation_id,gen);
    },
    readWarningLifeState:async()=>({
      generation:'gen00021',epoch:'restore-'+'b'.repeat(32),
      pending:pendingFence?(pendingNull?null:INTENT):undefined
    }),
    localStorage:{
      getItem(key){
        assert.equal(key,'gitai-warning-life-v1:'+dbName);
        lifeReads++;
        return mutateLife&&lifeReads>1 ? JSON.stringify({generation_id:'gen00021',thirds:8}) : LIFE;
      },
      setItem(){writes++;throw Error('never write real life');},
      removeItem(){writes++;throw Error('never remove real life');}
    }
  };
  vm.runInNewContext(exported+'\nglobalThis.runExport=exportMode;',ctx,{
    filename:'exhibit/admin.js:RE3-EXH-01',timeout:4000
  });
  return {
    run:()=>ctx.runExport(mode),
    stats:()=>({opens,closes,encodes,fileCreations,writes}),
    unchanged:()=>assert.equal(JSON.stringify(stores),before)
  };
}
(async()=>{
  const normal=fixture();
  const good=await normal.run();
  assert.equal(good.generation,'gen00021');
  assert.equal(good.mode,'warning');
  assert.equal(JSON.parse(await good.file.text()).payload.warningLife,LIFE);
  assert.deepEqual(normal.stats(),{opens:2,closes:2,encodes:3,fileCreations:1,writes:0});
  normal.unchanged();

  const cryptic=fixture({mode:'cryptic'});
  const plain=await cryptic.run();
  assert.equal(plain.mode,'cryptic');
  cryptic.unchanged();

  for (const pendingNull of [false,true]) {
    const pending=fixture({pendingSnapshot:true,pendingNull});
    await assert.rejects(pending.run(),/ライフ情報の復元が完了していない/);
    assert.deepEqual(pending.stats(),
      {opens:1,closes:1,encodes:0,fileCreations:0,writes:0});
    pending.unchanged();

    const late=fixture({pendingFence:true,pendingNull});
    await assert.rejects(late.run(),/ライフ情報の復元未完了を検出/);
    assert.deepEqual(late.stats(),
      {opens:2,closes:2,encodes:3,fileCreations:1,writes:0});
    late.unchanged();
  }
  const changedLife=fixture({mutateLife:true});
  await assert.rejects(changedLife.run(),/ライフ情報が更新されました/);
  assert.equal(changedLife.stats().writes,0,'old life-change rejection remains');
  changedLife.unchanged();

  const afterRetry=fixture();
  const restored=await afterRetry.run();
  assert.equal(restored.generation,'gen00021','export resumes after pending intent clears');
  console.log('RE3-EXH-01: actual exporter refuses pending life at snapshot or final fence, normal export still works, unchanged generation/epoch cannot bypass life gate; no game or storage writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
