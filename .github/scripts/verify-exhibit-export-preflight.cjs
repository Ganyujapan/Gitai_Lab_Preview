'use strict';
// RE2-EXH-02. Run actual exhibit exporter and its shared import bounds in a
// separate VM, with in-memory snapshots; never touch a user's database.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const src=fs.readFileSync('exhibit/admin.js','utf8');
function section(a,b) {
  const start=src.indexOf(a),end=src.indexOf(b,start);
  assert.ok(start>0 && end>start,'missing source marker '+a);
  return src.slice(start,end);
}
const codecs=section('  function encode64(', '  async function digest(');
const exported=section('  async function exportMode(', '  // Existing export encoding');
const bounds=section('  const MAX_BACKUP_BYTES', '  function checkGenome(');
const lifeCheck=section('  function checkWarningLife(', '  async function validateBackup(');
const validateBeginning=section('  async function validateBackup(', '  async function restoreMode(');
assert.match(exported,/checkBackupExportLimits\(envelope, file.size\)/);
assert.match(validateBeginning,/countBackupEntries\(body.stores\)/);
assert.match(validateBeginning,/validateTreeShape\(doc\)/);
assert.match(src,/const MAX_BACKUP_NODES = 350000/);
assert.match(src,/const MAX_BACKUP_ENTRIES = 20000/);
assert.match(src,/const MAX_BACKUP_BYTES = 150 \* 1024 \* 1024/);
class TestFile extends Blob {
  constructor(parts,name,opts){super(parts,opts);this.name=name;}
}
function harness({mode='cryptic',entries={},maxBytes=null}={}){
  const current='gen00021',shared={},sharedSnapshot={
    images:entries.images||[],meta:entries.meta||[{key:'current_generation_id',value:current}],
    theater_frames:entries.theater_frames||[]
  };
  const stores=['images','meta','theater_frames'];
  let dbClosed=false;
  const downloads=[];
  const textSource=codecs+'\n'+exported+'\n'+bounds+'\n'+lifeCheck+
    '\nglobalThis.__audit={exportMode,validateTreeShape,countBackupEntries,checkBackupExportLimits};';
  const limitSource=maxBytes==null?textSource
    :textSource.replace('150 * 1024 * 1024',String(maxBytes));
  const ctx={
    Blob,File:TestFile,ArrayBuffer,Uint8Array,Uint8ClampedArray,
    Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,
    Float64Array,Date,TextEncoder,btoa,atob,Object,Map,Set,
    crypto:webcrypto,
    MODES:{cryptic:{db:'db-cryptic'},warning:{db:'db-warning'}},
    STORES:stores,BACKUP_SCHEMA:'gitai-exhibit-backup-v1',
    openDb:async()=>({close(){dbClosed=true}}),
    snapshotStores:async()=>sharedSnapshot,
    digest:async text=>{
      const hashed=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      return Buffer.from(hashed).toString('hex');
    },
    fetch:async()=>({json:async()=>({build:'test-build'})}),
    navigator:{canShare:()=>true,share:async opts=>{downloads.push(opts.files[0]);}},
    localStorage:{getItem:()=>null},
    setTimeout(){},URL:{createObjectURL(){throw Error('not expected')}},
    document:{}
  };
  vm.runInNewContext(limitSource,ctx,{filename:'exhibit/admin.js:export',timeout:5000});
  return {ctx,downloads,sharedSnapshot,closed:()=>dbClosed,
    run:()=>ctx.__audit.exportMode(mode)};
}
(async()=>{
  // A regular export is sent unchanged (schema/checksum) and the DB stays untouched.
  for(const mode of ['cryptic','warning']){
    const normal=harness({mode,entries:{
      images:[{key:'gen00021:01',value:new Blob(['png'],{type:'image/png'})}],
      meta:[{key:'current_generation_id',value:'gen00021'},
            {key:'genome:gen00021:01',value:{schema_version:1,baseHue:30}}],
      theater_frames:[{key:'gen00021',value:{frame:'old'}}]
    }});
    assert.equal(await normal.run(),'gen00021');
    assert.equal(normal.downloads.length,1);
    assert.equal(normal.closed(),true);
    const bytes=await normal.downloads[0].text();
    const parsed=JSON.parse(bytes);
    normal.ctx.__audit.validateTreeShape(parsed);
    assert.equal(normal.ctx.__audit.countBackupEntries(parsed.payload.stores),4);
    assert.equal(parsed.payload.mode,mode);
    assert.equal(parsed.payload.schema,'gitai-exhibit-backup-v1');
    assert.equal(parsed.payload.currentGeneration,'gen00021');
    const actual=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parsed.payload)));
    assert.equal(parsed.checksum,Buffer.from(actual).toString('hex'));
    assert.equal(parsed.payload.stores.images[0].value.$type,'Blob');
  }
  // Audit reproduction: a modest JSON (~few MB) with >350k nested nodes
  // must fail before navigator.share, preserving every old record.
  const enormous=Array.from({length:350100},(_,i)=>i);
  const tooManyNodes=harness({entries:{meta:[
    {key:'current_generation_id',value:'gen00021'},
    {key:'diagnostics',value:enormous}
  ]}});
  await assert.rejects(tooManyNodes.run(),/復元上限/);
  assert.equal(tooManyNodes.downloads.length,0,'cannot signal success');
  assert.equal(tooManyNodes.closed(),true);
  assert.equal(tooManyNodes.sharedSnapshot.meta[1].value.length,350100);

  // Smaller fixture below bound exports normally; same serializer/validator.
  const under=harness({entries:{meta:[
    {key:'current_generation_id',value:'gen00021'},
    {key:'diagnostics',value:Array.from({length:340000},(_,i)=>i)}
  ]}});
  await under.run();
  assert.equal(under.downloads.length,1);

  // Restore-entry limit includes all stores (not just diagnostic entries).
  const manyEntries=harness({entries:{
    images:Array.from({length:20000},(_,i)=>({key:'image-'+i,value:i}))
  }});
  await assert.rejects(manyEntries.run(),/復元上限/);
  assert.equal(manyEntries.downloads.length,0);
  const atEntries=harness({entries:{
    images:Array.from({length:19999},(_,i)=>({key:'image-'+i,value:i}))
  }});
  await atEntries.run();
  assert.equal(atEntries.downloads.length,1);

  // Small scaled byte ceiling exercises the real File.size comparison
  // without allocating a real 150 MiB user-device-sized string.
  const bytesHigh=harness({maxBytes:1000,entries:{meta:[
    {key:'current_generation_id',value:'gen00021'},
    {key:'note',value:'a'.repeat(1100)}
  ]}});
  await assert.rejects(bytesHigh.run(),/容量上限/);
  assert.equal(bytesHigh.downloads.length,0);
  const bytesLow=harness({maxBytes:1600});
  await bytesLow.run();
  assert.equal(bytesLow.downloads.length,1);
  // Import's own structure limit remains identical after this refactor.
  assert.ok(validateBeginning.includes('countBackupEntries(body.stores)'));
  console.log('RE2-EXH-02: real export blocks unimportable node/entry/byte size before sharing, preserves DB; ordinary mode exports remain compatible.');
})().catch(e=>{console.error(e);process.exitCode=1;});
