'use strict';
// EXH-02: invoke the actual exporter AND the production current-generation
// verifier on synthetic in-memory 60-moth stores. No real IDB or user files.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('exhibit/admin.js','utf8');
function section(a,b){
 const i=source.indexOf(a),j=source.indexOf(b,i);
 assert.ok(i>0&&j>i,'missing source section '+a);
 return source.slice(i,j);
}
const functions=section('  function encode64(', '  async function validateBackup(');
const exportFunction=section('  async function exportMode(', '  // Existing export encoding');
assert.ok(exportFunction.indexOf('await verifyExportCurrentSnapshot(snapshot, modeId)')
 < exportFunction.indexOf('const stores = {}'),
 'all current moths must be verified BEFORE big JSON is encoded');
const loci=JSON.parse(fs.readFileSync(
 'data/evolution_models/continuous_v1/config.json','utf8'
)).trait_genetics.pattern_loci.map(x=>x.id);
class TestFile extends Blob{
 constructor(parts,name,opts){super(parts,opts);this.name=name}
}
const pad=i=>String(i).padStart(2,'0');
function makeGenome(i,warning=false){
 return {schema_version:1,baseHue:25,baseSaturation:0.5,baseValue:0.8,
  patternContrast:0.5,textureStrength:0.08,textureSeed:i,
  modules:Object.fromEntries(loci.map(id=>[id,{alleles:[0,1],
   cx:0.5,cy:0.5,rx:.2,ry:.2,valueEffect:-.2,phase:0,frequency:1}])),
  ...(warning?{lineage:i<=30?'poison':'harmless'}:{})
 };
}
function image({corrupt=false,header=false}={}){
 const bytes=new Uint8Array(25);
 bytes.set([137,80,78,71,13,10,26,10],0);
 bytes[16]=0;bytes[17]=0;bytes[18]=0;bytes[19]=128;
 bytes[20]=0;bytes[21]=0;bytes[22]=0;bytes[23]=128;
 bytes[24]=corrupt?0:42;
 if(header)bytes[0]=0;
 return new Blob([bytes],{type:'image/png'});
}
function snapshot(warning=false){
 const current='gen00021';
 return {
  images:Array.from({length:60},(_,i)=>({
   key:current+':'+pad(i+1),value:image()
  })),
  meta:[{key:'current_generation_id',value:current},
   ...Array.from({length:60},(_,i)=>({
    key:'genome:'+current+':'+pad(i+1),value:makeGenome(i+1,warning)
   }))],
  theater_frames:[],
 };
}
function harness(initial,mode='cryptic'){
 let shareCalls=0,open=0,closed=0;const files=[];
 const ctx={
  Blob,File:TestFile,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,
  Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,
  DataView,Date,Object,Map,Set,TextEncoder,btoa,atob,crypto:webcrypto,
  hex:bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(''),
  STORES:['images','meta','theater_frames'],BACKUP_SCHEMA:'gitai-exhibit-backup-v1',
  MODES:{cryptic:{db:'db-cryptic'},warning:{db:'db-warning'}},
  snapshotStores:async()=>initial,
  openDb:async()=>{open++;return {close(){closed++}};},
  fetch:async()=>({json:async()=>({build:'unit-test'})}),
  localStorage:{getItem:()=>null},
  navigator:{canShare:()=>true,share:async ({files:items})=>{shareCalls++;files.push(...items)}},
  createImageBitmap:async blob=>{
   const raw=new Uint8Array(await blob.arrayBuffer());
   if(raw.at(-1)!==42)throw Error('corrupted decoded PNG');
   return {width:128,height:128,close(){}};
  }
 };
 vm.runInNewContext(functions+'\nglobalThis.exportBackup=exportMode;',ctx,{
  filename:'exhibit/admin.js:export',timeout:4000});
 return {run:()=>ctx.exportBackup(mode),files,
  get shares(){return shareCalls},get opened(){return open},
  get closed(){return closed},data:initial};
}
async function assertBad(mutator,error,mode='cryptic'){
 const data=snapshot(mode==='warning'),h=harness(data,mode);
 const originals={images:data.images.length,meta:data.meta.length};
 mutator(data);
 await assert.rejects(h.run(),error);
 assert.equal(h.shares,0,'Invalid archive must not claim export success');
 assert.equal(h.opened,1);
 assert.equal(h.closed,1);
 assert.equal(data.images.length,
  originals.images+(data.images.length-originals.images),
  'source snapshot must never be rewritten by export');
 assert.ok(data.meta.some(item=>item.key==='current_generation_id'));
}
(async()=>{
 for(const mode of ['cryptic','warning']){
  const h=harness(snapshot(mode==='warning'),mode);
  const gen=await h.run();
  assert.equal(gen,'gen00021');
  assert.equal(h.shares,1);
  assert.equal(h.closed,1);
  const parsed=JSON.parse(await h.files[0].text());
  assert.equal(parsed.payload.currentGeneration,'gen00021');
  assert.equal(parsed.payload.stores.images.length,60);
  assert.equal(parsed.payload.stores.meta.length,61);
  assert.equal(parsed.payload.stores.images[0].value.$type,'Blob');
  assert.equal(parsed.payload.stores.meta[1].value.schema_version,1);
 }
 await assertBad(d=>{d.images.pop()},/画像が不足/);
 await assertBad(d=>{d.meta.splice(1,1)},/遺伝情報が不足/);
 await assertBad(d=>{d.meta[1].value.baseHue='red'},/数値が不正/);
 await assertBad(d=>{d.meta[1].value.modules.central_blotch.valueEffect=NaN},
  /模様遺伝子の数値が不正/);
 await assertBad(d=>{delete d.meta[1].value.modules.central_blotch},
  /必須模様遺伝子/);
 await assertBad(d=>{d.images[10].value=image({header:true})},/PNGヘッダー/);
 await assertBad(d=>{d.images[10].value=image({corrupt:true})},/デコードできません/);
 await assertBad(d=>{d.meta[1].value.lineage='harmless'},/系統情報/,'warning');
 console.log('EXH-02: actual exporter shares complete 60-PNG/DNA snapshots but rejects missing, corrupt and wrong-lineage current records BEFORE creating JSON or touching user IDB.');
})().catch(err=>{console.error(err);process.exitCode=1});
