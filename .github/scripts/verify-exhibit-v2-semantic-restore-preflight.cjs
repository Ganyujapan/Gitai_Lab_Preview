'use strict';
// Read-only v2 multipart semantic restore checks against the ACTUAL shipped
// v1 strict genome/PNG validators. All files and data are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {deflateSync,inflateSync} = require('node:zlib');
const {writePartsFromRecords,verifyPartIntegrity,validateManifest,MAX_MANIFEST_BYTES} =
  require('../../exhibit/backup_v2.js');
const {decodeValue,preflightRestore} =
  require('../../exhibit/backup_restore_preflight_v2.js');
globalThis.indexedDB = {
  open(){throw Error('READ-ONLY PROTOCOL VIOLATION: IndexedDB.open');},
  deleteDatabase(){throw Error('READ-ONLY PROTOCOL VIOLATION: deleteDatabase');}
};
if (typeof File === 'undefined') globalThis.File=class extends Blob {
  constructor(parts,name,options){super(parts,options);this.name=name;}
};
const GEN='gen00035',DB='gitai-exhibit-2026-cryptic-test';
const indexName=i=>String(i).padStart(2,'0');
const loci=['central_blotch','transverse_band','outer_edge','speckle_cluster',
'longitudinal_streaks','cloud_mottle','ring_spots','diagonal_streak',
'chevron_pair','twin_spots','ripple_bands','radial_rays'];
function genome(i, mode='cryptic'){
  return {
    schema_version:1,baseHue:i,baseSaturation:0.4,baseValue:0.5,
    patternContrast:0.5,textureStrength:0.5,textureSeed:i*1234,
    ...(mode==='warning'?{lineage:i<=30?'poison':'harmless'}:{}),
    modules:Object.fromEntries(loci.map(l=>[l,{alleles:[0,1]}]))
  };
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const b of bytes) {
    crc ^= b;
    for(let k=0;k<8;k++) crc=(crc>>>1)^(0xedb88320&-(crc&1));
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
  const code=Buffer.from(type,'ascii');
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([code,data])));
  return Buffer.concat([len,code,data,crc]);
}
function png128(){
  const header=Buffer.alloc(13);header.writeUInt32BE(128,0);
  header.writeUInt32BE(128,4);header[8]=8;header[9]=6;
  // valid RGBA scanlines with PNG filter-byte 0 per row
  const raw=Buffer.alloc(128*(128*4+1));
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))
  ]);
}
const validPng=png128();
async function realPngDecoder(blob){
  const data=Buffer.from(await blob.arrayBuffer());
  if(data.length<40||!data.subarray(0,8).equals(validPng.subarray(0,8)))
    throw Error('Invalid PNG signature');
  let offset=8,width=0,height=0,hasIend=false;const idat=[];
  while(offset+12<=data.length){
    const len=data.readUInt32BE(offset);
    if(len>data.length-offset-12)throw Error('Invalid PNG chunk');
    const name=data.toString('ascii',offset+4,offset+8);
    const body=data.subarray(offset+8,offset+8+len);
    const crc=data.readUInt32BE(offset+8+len);
    if(crc!==crc32(data.subarray(offset+4,offset+8+len)))throw Error('Bad PNG CRC');
    if(name==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4)}
    if(name==='IDAT')idat.push(body);
    offset+=len+12;
    if(name==='IEND'){hasIend=true;break}
  }
  if(!hasIend||!idat.length||offset!==data.length||
      inflateSync(Buffer.concat(idat)).length!==128*(128*4+1))
    throw Error('PNG is truncated');
  return {width,height,close(){}};
}
const admin=fs.readFileSync('exhibit/admin.js','utf8');
const start=admin.indexOf('  const EXPECTED_PATTERN_LOCI = Object.freeze([');
const end=admin.indexOf('  // EXH-02: an exported file must',start);
assert.ok(start>0&&end>start,'Production semantic validators must exist');
const ctx={Blob,DataView,Uint8Array,MAX_MOTH_PNG_BYTES:2*1024*1024,
  PNG_SIGNATURE:[137,80,78,71,13,10,26,10],
  createImageBitmap:realPngDecoder,URL};
vm.runInNewContext(admin.slice(start,end)+
  '\nglobalThis.productionCheckGenome=checkGenome;'+
  '\nglobalThis.productionCheckMothPng=checkMothPng;',ctx);
const partApi={validateManifest,verifyPartIntegrity,MAX_MANIFEST_BYTES};

async function* records({mode='cryptic',badPng=false,badDna=false}={}){
  for(let i=1;i<=60;i++){
    const value=badPng && i===31
      ?new Blob([Buffer.from([137,80,78,71,13,10,26,10])],{type:'image/png'})
      :new Blob([validPng],{type:'image/png'});
    yield {store:'images',key:GEN+':'+indexName(i),value};
  }
  yield {store:'meta',key:'current_generation_id',value:GEN};
  yield {store:'meta',key:'diagnostic:gen00034',value:{
    noise:new Uint16Array([7,9,400]),date:new Date('2026-10-27T08:00:00.000Z')
  }};
  for(let i=1;i<=60;i++){
    const value=genome(i,mode);
    if(badDna&&i===40)value.modules.outer_edge.alleles=[4,0];
    yield {store:'meta',key:'genome:'+GEN+':'+indexName(i),value};
  }
  yield {store:'theater_frames',key:'frame:'+GEN,value:{generation:GEN}};
}
async function fixture(opts={}){
  const files=[];
  const result=await writePartsFromRecords(records(opts),
    {mode:opts.mode||'cryptic',database:DB,currentGeneration:GEN,
      maxPartBytes:8192,maxPartEntries:18},async file=>{files.push(file)});
  return {...result,files};
}
async function preflight(obj,options={}){
  return preflightRestore({
    manifestFile:obj.manifestFile,partFiles:obj.files,
    mode:options.mode||'cryptic',database:DB,partApi,
    checkGenome:options.checkGenome||ctx.productionCheckGenome,
    checkMothPng:options.checkMothPng||ctx.productionCheckMothPng
  });
}
(async()=>{
  const good=await fixture();
  const outcome=await preflight(good);
  assert.equal(outcome.generation,GEN);
  assert.equal(outcome.entries,123);
  assert.equal(outcome.checkedPngs,60);
  assert.equal(outcome.checkedGenomes,60);
  assert.equal(outcome.semanticChecked,true);
  assert.equal(outcome.safeToRestore,false);
  const warning=await fixture({mode:'warning'});
  assert.equal((await preflight(warning,{mode:'warning'})).checkedGenomes,60);
  const corruptPng=await fixture({badPng:true});
  await assert.rejects(preflight(corruptPng),/蛾画像のPNGヘッダー|蛾画像/);
  const corruptDna=await fixture({badDna:true});
  await assert.rejects(preflight(corruptDna),/対立遺伝子/);

  const noValidator=await fixture();
  await assert.rejects(preflightRestore({manifestFile:noValidator.manifestFile,
    partFiles:noValidator.files,mode:'cryptic',database:DB,partApi,
    checkGenome:ctx.productionCheckGenome}),/必須の厳格/);
  const alteredLast=await fixture();
  const final=alteredLast.files.at(-1),payload=await final.text();
  alteredLast.files[alteredLast.files.length-1]=new File(
    ['!'+payload.slice(1)],final.name,{type:'application/json'});
  await assert.rejects(preflight(alteredLast),/破損/);
  const wrongMode=await fixture({mode:'warning'});
  await assert.rejects(preflight(wrongMode),/モード/);

  const blob=decodeValue({$type:'Blob',mime:'image/png',data:'iVBORw0KGgo='});
  assert.equal(blob.size,8);
  assert.ok(decodeValue({$type:'Date',data:'2026-10-27T00:00:00.000Z'}) instanceof Date);
  assert.deepEqual(Array.from(decodeValue({$type:'Uint16Array',data:'AQACAA=='})),[1,2]);
  assert.equal(decodeValue({nested:[true,0,null]}).nested[0],true);
  for(const bad of [
    {$type:'Mystery',data:'AA=='},
    {$type:'Blob',mime:14,data:'AA=='},
    {$type:'Blob',mime:'image/png',data:'AAA!'},
    {$type:'Uint16Array',data:'AQ=='},
    {$type:'Date',data:'2026-13-99T00:00:00.000Z'},
    {$type:'Blob',mime:'image/png',data:'AA==',unused:true},
    JSON.parse('{"__proto__":{"admin":true}}'),
    {nested:{constructor:1}},
    Infinity
  ])assert.throws(()=>decodeValue(bad),/不正|未対応|一致|プロパティ|JSON/);

  assert.equal(globalThis.indexedDB.open.name,'open');
  console.log('RE2-EXH-02: 123-record cryptic/warning v2 semantic preflight using production DNA and PNG validators; corrupted PNG/DNA, SHA tamper, missing validator, illegal binary/date/property inputs rejected without database access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
