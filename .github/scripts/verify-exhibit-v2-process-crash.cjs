'use strict';
// EXH-F01: real SIGKILL crash/restart rehearsal, synthetic files only.
// NEVER open or delete a real IndexedDB. The worker is a child process
// and may only write into a fresh temporary directory provided by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {webcrypto} = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.File) {
  globalThis.File = class extends Blob {
    constructor(parts,name,opts) {super(parts,opts);this.name=name;}
  };
}
globalThis.indexedDB = {
  open() {throw Error('No real IndexedDB access permitted in crash rehearsal');},
  deleteDatabase() {throw Error('No real IndexedDB deletion permitted');}
};
const {writePartsFromRecords,verifyPartIntegrity} =
  require('../../exhibit/backup_v2.js');
const DB='gitai-exhibit-2026-crash-fixture';
const GEN='gen00035';
const basename=i=>String(i).padStart(2,'0');

async function* syntheticRecords(seed) {
  for(let i=1;i<=60;i++) {
    yield {store:'images',key:GEN+':'+basename(i),
      value:new Blob([Uint8Array.of(137,80,78,71,13,10,26,seed)],
        {type:'image/png'})};
  }
  yield {store:'meta',key:'current_generation_id',value:GEN};
  for(let i=1;i<=60;i++) {
    yield {store:'meta',key:'genome:'+GEN+':'+basename(i),
      value:{schema_version:1,baseHue:i,diagnostic:seed}};
  }
  yield {store:'theater_frames',key:'frame:'+GEN,value:{generation:GEN}};
}

function writeSyncedExclusive(dir,name,bytes) {
  // Exclusive creation also prevents a retry from silently overwriting a
  // partial file from an old attempt. The caller must use a fresh directory.
  const fd=fs.openSync(path.join(dir,name),'wx');
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  finally {fs.closeSync(fd);}
}

async function worker(dir,scenario) {
  const seed=scenario==='complete'?3:scenario==='kill-final'?2:1;
  let written=0;
  const output=await writePartsFromRecords(syntheticRecords(seed),{
    mode:'cryptic',database:DB,currentGeneration:GEN,
    maxPartBytes:2048,maxPartEntries:7,
    createdAt:'2026-10-29T00:00:00.000Z'
  },async(file,descriptor)=>{
    writeSyncedExclusive(dir,descriptor.file,
      Buffer.from(await file.arrayBuffer()));
    written++;
    // Actually kill this child WITHOUT allowing writer's Promise to settle
    // or its finally block to create a manifest. Parent must survive.
    if((scenario==='kill-mid'&&written===2) ||
       (scenario==='kill-final'&&descriptor.store==='theater_frames')) {
      process.kill(process.pid,'SIGKILL');
    }
  });
  writeSyncedExclusive(dir,'manifest.json',
    Buffer.from(await output.manifestFile.arrayBuffer()));
}

const readFile=filename=>new File([fs.readFileSync(filename)],
  path.basename(filename),{type:'application/json'});
const partFiles=dir=>fs.readdirSync(dir).filter(x=>/^part-\d{5}\.json$/.test(x))
  .sort().map(x=>readFile(path.join(dir,x)));

async function parent() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitailab-v2-kill-'));
  try {
    const attempts={};
    for(const scenario of ['kill-mid','kill-final','complete']) {
      const dir=path.join(root,scenario);
      fs.mkdirSync(dir,{recursive:true});
      const run=spawnSync(process.execPath,[__filename,'--worker',dir,scenario],
        {cwd:path.resolve(__dirname,'../..'),encoding:'utf8',timeout:20000});
      if(scenario==='complete') {
        assert.equal(run.status,0,run.stderr||run.error?.message);
        assert.equal(run.signal,null);
        assert.ok(fs.existsSync(path.join(dir,'manifest.json')));
      }else{
        assert.equal(run.signal,'SIGKILL',
          'worker must really die, not merely throw: '+(run.stderr||''));
        assert.equal(run.status,null);
        assert.ok(!fs.existsSync(path.join(dir,'manifest.json')),
          'a killed writer must not leave a success manifest');
        assert.ok(partFiles(dir).length>=2,
          'previously persisted orphaned parts must be visible');
        await assert.rejects(verifyPartIntegrity(null,partFiles(dir),
          'cryptic',DB),/索引/);
      }
      attempts[scenario]=dir;
    }

    const fresh=attempts.complete;
    const manifest=readFile(path.join(fresh,'manifest.json'));
    const goodParts=partFiles(fresh);
    const result=await verifyPartIntegrity(manifest,goodParts,'cryptic',DB);
    assert.equal(result.entries,122);
    assert.equal(result.generation,GEN);
    // Existing files from a crash belong to a different run. Equal names
    // and equal sizes do not let them pass the successful run's SHA-256.
    const stale=partFiles(attempts['kill-final']);
    assert.equal(stale[0].name,goodParts[0].name);
    assert.equal(stale[0].size,goodParts[0].size);
    const mixed=goodParts.slice();
    mixed[0]=stale[0];
    await assert.rejects(verifyPartIntegrity(manifest,mixed,
      'cryptic',DB),/破損/);

    console.log('EXH-F01 real child SIGKILL: mid-part and last-part '+
      'crashes leave no manifest; fresh attempt verifies 122 records; '+
      'stale same-name/size parts rejected by SHA-256. Synthetic files only.');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}

if(process.argv[2]==='--worker'){
  worker(process.argv[3],process.argv[4])
    .catch(err=>{console.error(err);process.exitCode=1;});
}else{
  parent().catch(err=>{console.error(err);process.exitCode=1;});
}
