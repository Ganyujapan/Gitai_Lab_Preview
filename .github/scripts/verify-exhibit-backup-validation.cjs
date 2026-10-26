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
function makeGenome(i,warning) {
 return {schema_version:1,baseHue:30,baseSaturation:.3,baseValue:.9,
  patternContrast:.3,textureStrength:.01,textureSeed:i,
  modules:{band:{alleles:[1,0],hue:30,width:.1}},
  ...(warning?{lineage:i<=30?'poison':'harmless'}:{})
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
 vm.runInNewContext(body+'\nglobalThis.validate=validateBackup;globalThis.restore=restoreMode;',
   context,{filename:'exhibit/admin.js:EXH-02',timeout:5000});
 return {validate:(raw,mode)=>context.validate(raw,mode),
  restore:(mode,file)=>context.restore(mode,file),
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
  delete missingAlleles.stores.meta[1].value.modules.band.alleles;
  await shouldFail(mode,missingAlleles,/対立遺伝子/);

  const invalidNumber=structuredClone(payload);
  invalidNumber.stores.meta[1].value.baseHue=null;
  await shouldFail(mode,invalidNumber,/数値が不正/);
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

 const wrongMode=createPayload('warning','gen00021');
 await shouldFail('cryptic',wrongMode,/このモード用/);
 const deep=createPayload('cryptic','gen00031');
 let branch=deep;
 for(let i=0;i<40;i++){branch.extra={};branch=branch.extra}
 await shouldFail('cryptic',deep,/入れ子が深すぎ/);
 const many=createPayload('cryptic','gen00035');
 many.stores.theater_frames=Array.from({length:20001},(_,i)=>({key:'x'+i,value:{}}));
 await shouldFail('cryptic',many,/保存項目が多すぎ/);
 console.log('EXH-02: Valid exports accepted; malformed images/genomes/lineages and huge backups rejected BEFORE destructive IndexedDB restore.');
})().catch(e=>{console.error(e);process.exitCode=1});
