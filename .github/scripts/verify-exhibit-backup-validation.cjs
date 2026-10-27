'use strict';
// EXH-02: exercise the real admin validator on isolated exported-v1-shaped
// JSON fixtures. Never open the user's IndexedDB or erase an existing record.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('exhibit/admin.js','utf8');
const start=source.indexOf('  const MAX_BACKUP_BYTES = ');
const end=source.indexOf('\n  const button = document.getElementById',start);
assert.ok(start>=0 && end>start, 'Validation and restore functions not found');
const body=source.slice(start,end);
assert.match(body,/file\.size > MAX_BACKUP_BYTES/);
assert.match(body,/await checkMothPng\(images\.get\(imageKey\), index\)/);
assert.match(body,/checkGenome\(genomes\.get\(genomeKey\), index, selected\)/);
assert.match(body,/db\.transaction\(STORES, 'readwrite'\)/);
assert.match(body,/tx\.abort\(\)/);
const digest=async text=>crypto.createHash('sha256').update(text).digest('hex');
const crypticDb='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
const warningDb='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2';
const sig=[137,80,78,71,13,10,26,10];
function blobPayload({badHeader=false,corrupt=false,width=128}={}) {
 const array=new Uint8Array(25);
 array.set(sig,0);array[0]=badHeader?0:137;
 array[16]=Math.floor(width/16777216)%256;
 array[17]=Math.floor(width/65536)%256;
 array[18]=Math.floor(width/256)%256;
 array[19]=width%256;
 array[23]=128;
 array[24]=corrupt?13:42;
 return {$blob:Array.from(array),mime:'image/png'};
}
const MODEL_LOCI = JSON.parse(fs.readFileSync(
 'data/evolution_models/continuous_v1/config.json','utf8'
)).trait_genetics.pattern_loci.map(item=>item.id);
function makeGenome(i,warning) {
 const modules=Object.fromEntries(MODEL_LOCI.map(id=>[id,{
   alleles:[1,0],cx:0.5,cy:0.5,rx:0.2,ry:0.2,
   valueEffect:-0.2,hueEffect:0,saturationEffect:0,
   phase:1.5,angle:0,frequency:1.5,roughness:0.25
 }]));
 return {schema_version:1,baseHue:30,baseSaturation:.3,baseValue:.9,
  patternContrast:.3,textureStrength:.01,textureSeed:i,
  modules,...(warning?{lineage:i<=30?'poison':'harmless'}:{})
 };
}
function createPayload(mode,gen) {
 const warning=mode==='warning';
 return {
  schema:'gitai-exhibit-backup-v1',mode,
  database:warning?warningDb:crypticDb,databaseVersion:2,
  currentGeneration:gen,createdAt:'2026-10-26T00:00:00Z',
  stores:{
   images:Array.from({length:60},(_,i)=>({key:gen+':'+String(i+1).padStart(2,'0'),value:blobPayload()})),
   meta:[{key:'current_generation_id',value:gen},
     ...Array.from({length:60},(_,i)=>({key:'genome:'+gen+':'+String(i+1).padStart(2,'0'),value:makeGenome(i+1,warning)}))],
   theater_frames:[]
  }
 };
}
async function exportJson(payload) {return JSON.stringify({payload,checksum:await digest(JSON.stringify(payload))})}
function harness() {
 let openCalls=0,confirmCalls=0;
 const context={
  STORES:['images','meta','theater_frames'],
  MODES:{cryptic:{db:crypticDb,label:'隠れるギタイ'},warning:{db:warningDb,label:'目立つギタイ'}},
  BACKUP_SCHEMA:'gitai-exhibit-backup-v1',Blob,Uint8Array,DataView,
  digest,
  decode(value) {
    if(value?.$blob)return new Blob([Uint8Array.from(value.$blob)],{type:value.mime});
    return value;
  },
  createImageBitmap:async(blob)=>{
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.at(-1)!==42)throw Error('decode corrupted PNG');
    return {width:128,height:128,close(){}};
  },
  openDb:async()=>{openCalls++;throw Error('Should never touch user data for a failed backup')},
  confirm:()=>{confirmCalls++;return true}
 };
 vm.runInNewContext(body+'\nglobalThis.validate=validateBackup;globalThis.restore=restoreMode;globalThis.verifySaved=verifySavedBackupFile;globalThis.loci=EXPECTED_PATTERN_LOCI;',
   context,{filename:'exhibit/admin.js:EXH-02',timeout:5000});
 assert.deepEqual(Array.from(context.loci),MODEL_LOCI,'validator must match frozen model loci');
 return {validate:(raw,mode)=>context.validate(raw,mode),
  restore:(mode,file)=>context.restore(mode,file),
  verifySaved:(file,mode)=>context.verifySaved(file,mode),
  get openCalls(){return openCalls},get confirmCalls(){return confirmCalls}};
}
async function shouldFail(mode,payload,match) {
 const h=harness();
 const raw=await exportJson(payload);  // attacker can recompute SHA-256!
 await assert.rejects(h.validate(raw,mode),match);
 let read=0;
 await assert.rejects(h.restore(mode,{size:raw.length,async text(){read++;return raw}}),match);
 assert.equal(read,1);
 assert.equal(h.openCalls,0,'Rejected input cannot open/clear the existing DB');
 assert.equal(h.confirmCalls,0,'No confirmation before validation');
}
(async()=>{
 for(const [mode,gen] of [['cryptic','gen00035'],['warning','gen00025']]) {
  const payload=createPayload(mode,gen);
  const raw=await exportJson(payload);
  const valid=harness();
  const {body,prepared}=await valid.validate(raw,mode);
  assert.equal(body.currentGeneration,gen);
  assert.equal(prepared.images.length,60);
  assert.equal(prepared.meta.length,61);
  assert.ok(prepared.images[0].value instanceof Blob);
  assert.equal(valid.openCalls,0);
  // A backup selected AGAIN from Files must validate independently without
  // touching a live DB or invoking the destructive restore confirmation.
  let verifiedFileReads=0;
  const reselected={
    name:'gitailab_2026_'+mode+'_'+gen+'.json',
    size:Buffer.byteLength(raw,'utf8'),
    async text(){verifiedFileReads++;return raw;}
  };
  const verified=await valid.verifySaved(reselected,mode);
  assert.equal(verifiedFileReads,1);
  assert.equal(verified.generation,gen);
  assert.equal(verified.mode,mode);
  assert.equal(verified.count,121);
  assert.equal(verified.bytes,reselected.size);
  assert.equal(verified.integrity,'sha256-and-current-generation-shape');
  assert.equal(valid.openCalls,0);
  assert.equal(valid.confirmCalls,0);
  // Bad checksum, wrong mode and missing current DNA must FAIL verification
  // while preserving any saved experiment data.
  const forgedChecksum=JSON.parse(raw);forgedChecksum.checksum='0'.repeat(64);
  await assert.rejects(valid.verifySaved({
    name:'broken.json',size:raw.length,
    async text(){return JSON.stringify(forgedChecksum);}
  },mode),/整合性検証/);
  assert.equal(valid.openCalls,0);
  // Supported and exported current schema v1 stays intact.
  const wrongKey=structuredClone(payload);
  wrongKey.stores.images[59].key=gen+':garbage_60';
  await shouldFail(mode,wrongKey,/画像が不足/);

  const nonBlob=structuredClone(payload);
  nonBlob.stores.images[4].value='PNG-not-Blob';
  await shouldFail(mode,nonBlob,/画像の形式/);

  const badHeader=structuredClone(payload);
  badHeader.stores.images[0].value=blobPayload({badHeader:true});
  await shouldFail(mode,badHeader,/PNGヘッダー/);

  const badDimensions=structuredClone(payload);
  badDimensions.stores.images[1].value=blobPayload({width:320});
  await shouldFail(mode,badDimensions,/寸法が不正/);

  const brokenDecode=structuredClone(payload);
  brokenDecode.stores.images[2].value=blobPayload({corrupt:true});
  await shouldFail(mode,brokenDecode,/デコードできません/);

  const missingGenome=structuredClone(payload);
  missingGenome.stores.meta.splice(1,1);
  await shouldFail(mode,missingGenome,/遺伝情報が不足/);

  const futureVersion=structuredClone(payload);
  futureVersion.stores.meta[1].value.schema_version=2;
  await shouldFail(mode,futureVersion,/未対応の形式/);

  const missingAlleles=structuredClone(payload);
  delete missingAlleles.stores.meta[1].value.modules.central_blotch.alleles;
  await shouldFail(mode,missingAlleles,/対立遺伝子/);

  const invalidNumber=structuredClone(payload);
  invalidNumber.stores.meta[1].value.baseHue=null;
  await shouldFail(mode,invalidNumber,/数値が不正/);

  const missingLocus=structuredClone(payload);
  delete missingLocus.stores.meta[1].value.modules.central_blotch;
  await shouldFail(mode,missingLocus,/必須模様遺伝子/);

  const unknownLocus=structuredClone(payload);
  unknownLocus.stores.meta[1].value.modules.unknown_module=
    unknownLocus.stores.meta[1].value.modules.central_blotch;
  delete unknownLocus.stores.meta[1].value.modules.central_blotch;
  await shouldFail(mode,unknownLocus,/必須模様遺伝子/);

  const invalidEffect=structuredClone(payload);
  invalidEffect.stores.meta[1].value.modules.central_blotch.valueEffect='not-a-number';
  await shouldFail(mode,invalidEffect,/模様遺伝子の数値が不正/);

  const missingLegacyPigment=structuredClone(payload);
  // Previous schema-1 genomes may lack newly introduced local pigment fields.
  delete missingLegacyPigment.stores.meta[1].value.modules.central_blotch.pigmentHue;
  const legacyRaw=await exportJson(missingLegacyPigment);
  await harness().validate(legacyRaw,mode);

  const invalidSaturation=structuredClone(payload);
  invalidSaturation.stores.meta[1].value.baseSaturation=40;
  await shouldFail(mode,invalidSaturation,/数値が不正/);

  const invalidGeometry=structuredClone(payload);
  invalidGeometry.stores.meta[1].value.modules.central_blotch.rx=-3;
  await shouldFail(mode,invalidGeometry,/模様遺伝子の数値が不正/);
  if(mode==='warning'){
   const swapped=structuredClone(payload);
   swapped.stores.meta[1].value.lineage='harmless';
   await shouldFail(mode,swapped,/系統情報/);
  }
 }
 // First generation must be complete too: EV-01 will not silently rebuild
 // gen1 after a restore of corrupted or incomplete legacy records.
 const first=createPayload('cryptic','gen00001');
 first.stores.images.pop();
 await shouldFail('cryptic',first,/画像が不足/);

 const huge=harness();
 let textRead=0;
 await assert.rejects(huge.restore('cryptic',{
   size:151*1024*1024,async text(){textRead++;return ''}
 }),/容量が上限/);
 assert.equal(textRead,0,'File.size guard must precede file.text()');
 assert.equal(huge.openCalls,0);
 let didRead=0;
 await assert.rejects(huge.verifySaved({
   name:'oversized.json',size:151*1024*1024,
   async text(){didRead++;return '';}
 },'cryptic'),/容量/);
 assert.equal(didRead,0,'Size limit must reject BEFORE allocating file text');
 await assert.rejects(huge.verifySaved(null,'cryptic'),/容量/);
 await assert.rejects(huge.verifySaved({
   name:'empty.json',size:0,
   async text(){didRead++;return '';}
 },'cryptic'),/容量/);
 assert.equal(didRead,0);
 await assert.rejects(huge.verifySaved({
   name:'synthetic.json',size:4,
   async text(){return '{}';}
 },'unexpected'),/選び直して/);
 assert.equal(huge.openCalls,0);

 const wrongMode=createPayload('warning','gen00021');
 await shouldFail('cryptic',wrongMode,/このモード用/);
 const deep=createPayload('cryptic','gen00031');
 let branch=deep;
 for(let i=0;i<40;i++){branch.extra={};branch=branch.extra}
 await shouldFail('cryptic',deep,/入れ子が深すぎ/);
 const many=createPayload('cryptic','gen00035');
 many.stores.theater_frames=Array.from({length:20001},(_,i)=>({key:'x'+i,value:{}}));
 await shouldFail('cryptic',many,/保存項目が多すぎ/);
 const modes=fs.readFileSync('exhibit/modes.html','utf8');
 const admin=fs.readFileSync('exhibit/admin.js','utf8');
 const css=fs.readFileSync('exhibit/admin.css','utf8');
 assert.match(modes,/id="exhibitBackupVerify"/);
 assert.match(modes,/id="exhibitBackupVerifyFile"/);
 assert.match(css,/#exhibitBackupVerifyFile\{display:none\}/);
 assert.match(admin,/verifyBackupInput\.addEventListener\('change'/);
 assert.match(admin,/await verifySavedBackupFile\(file,requestedMode\)/);
 assert.doesNotMatch(body.slice(body.indexOf('  async function verifySavedBackupFile(')),
   /\bopenDb\(|db\.transaction\(|localStorage\.|\brestoreMode\(/,
   'Saved backup verification MUST NOT open DB, write to life or trigger restore');
 console.log('EXH-F01: Re-selected v1 backup checksum, all 60 images/DNA, byte limits and wrong-mode guards verified without any IndexedDB or localStorage access.');
})().catch(e=>{console.error(e);process.exitCode=1});
