'use strict';
// RE2-EXH-02 writer tests: all records are generated in memory, NEVER via IDB.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
if (typeof File === 'undefined') {
  globalThis.File = class extends Blob {
    constructor(parts, name, options) { super(parts, options); this.name = name; }
  };
}
globalThis.indexedDB = {open() { throw Error('No existing IndexedDB access allowed'); }};
const {
  writePartsFromRecords, verifyPartIntegrity, PART_SCHEMA, SCHEMA, MAX_PART_BYTES
} = require('../../exhibit/backup_v2.js');
const db = 'gitai-exhibit-2026-test-cryptic';
const generation = 'gen00035';
const name = n => String(n).padStart(2, '0');
const image = () => new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])], {type:'image/png'});
async function* records(diagnosticCount = 0, {badOrder=false, duplicate=false, noGenome=false, bigBlob=false, denseDiagnostics=false} = {}) {
  for(let i=1;i<=60;i++) {
    const key = generation + ':' + name(i);
    yield {store:'images',key,value: i === 1 && bigBlob ?
      new Blob([new Uint8Array(5*1024*1024)]) : image()};
    if (i === 12 && duplicate) yield {store:'images',key,value:image()};
  }
  yield {store:'meta',key:'current_generation_id',value:generation};
  for(let i=0;i<diagnosticCount;i++){
    const key='diagnostic:'+String(i).padStart(7,'0');
    yield {store:'meta',key,value:{note:'sample ☘ 演算',point:i,arr:new Uint16Array([2,345]),t:new Date('2026-10-27T00:00:00Z'), ...(denseDiagnostics ? {dense:Array.from({length:220}, (_,j)=>j)} : {})}};
  }
  for(let i=1;i<=60;i++){
    const key='genome:'+generation+':'+name(i);
    if(i===20 && noGenome)continue;
    yield {store:'meta',key,value:{schema_version:1,baseHue:i,modules:{test:{alleles:[1,0]}}}};
  }
  if (badOrder) yield {store:'meta',key:'aaa',value:17};
  yield {store:'theater_frames',key:'frame:'+generation,value:{generation}};
}

async function produce(recordStream, opts={}) {
  const files=[];
  let maxPartSize=0;
  const output=await writePartsFromRecords(recordStream,
    {mode:'cryptic',database:db,currentGeneration:generation,
      maxPartEntries:opts.maxPartEntries ?? 500,
      maxPartBytes:opts.maxPartBytes ?? 256*1024,
      createdAt:'2026-10-27T01:02:03Z'},
    async (file, descriptor)=>{
      assert.equal(file.name, descriptor.file);
      assert.equal(file.size, descriptor.bytes);
      assert.ok(file.size <= (opts.maxPartBytes ?? 256*1024));
      maxPartSize=Math.max(maxPartSize,file.size);
      files.push(file);
      if(opts.failAfterParts && files.length >= opts.failAfterParts)
        throw Error('simulated full disk');
    });
  return {...output,files,maxPartSize};
}

(async ()=>{
  // Legacy serializer compatibility on genuine Blob/typed/date/unicode payloads.
  const source=readFileSync('exhibit/admin.js','utf8');
  const start=source.indexOf('  function encode64('), end=source.indexOf('  const ARRAY_TYPES',start);
  assert.ok(start > 0 && end > start);
  const context={Blob,ArrayBuffer,Uint8Array,Uint16Array,Date,btoa};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.encodeLegacy=encode;',context);
  const sample={str:'森の生物',numbers:[1,2,3],
    image:image(),typed:new Uint16Array([17,240]),datetime:new Date('2026-10-27T00:00:00.000Z')};
  const legacy=await context.encodeLegacy(sample);
  const mini=await produce(records(2),{maxPartBytes:1024,maxPartEntries:3});
  assert.ok(mini.files.length > 8);
  const allRecords=[];
  for (const file of mini.files) {
    const part=JSON.parse(await file.text());
    assert.equal(part.schema,PART_SCHEMA);
    allRecords.push(...part.entries);
  }
  const diag=allRecords.find(x=>x.key==='diagnostic:0000000');
  assert.equal(diag.value.arr.$type,'Uint16Array');
  assert.equal(diag.value.t.$type,'Date');
  assert.equal(diag.value.note,'sample ☘ 演算');
  assert.equal(legacy.typed.$type,'Uint16Array');
  assert.equal(legacy.image.$type,'Blob');
  assert.deepEqual(JSON.parse(JSON.stringify(allRecords.find(x=>x.key===generation+':01').value)),
    JSON.parse(JSON.stringify(legacy.image)), 'image encoding matches v1');

  const miniCheck=await verifyPartIntegrity(mini.manifestFile,mini.files,'cryptic',db);
  assert.equal(miniCheck.generation,generation);
  assert.equal(miniCheck.entries,124);

  // >20,000 records: no v1 cap; read and encode one record at a time.
  const many=await produce(records(22050));
  assert.ok(many.manifest.totals.entries > 20000);
  assert.equal(many.manifest.totals.entries,22172);
  assert.equal(many.manifest.schema,SCHEMA);
  assert.equal(many.manifest.parts.length,many.files.length);
  assert.ok(many.files.length > 40,'actual multipart output');
  assert.ok(many.maxPartSize <= 256*1024);
  assert.ok(many.manifestFile.size < 1024*1024);
  const verified=await verifyPartIntegrity(many.manifestFile,many.files,'cryptic',db);
  assert.equal(verified.entries,22172);
  assert.ok(many.manifest.parts.every(p=>p.bytes<=MAX_PART_BYTES && /^[a-f0-9]{64}$/.test(p.sha256)));

  // Existing restore does not decode DataView or BigInt views.
  const unsupported = async function* () {
    for await (const item of records(0)) {
      yield item.store === 'theater_frames' ?
        {...item,value:{unknownView:new DataView(new ArrayBuffer(8))}} : item;
    }
  };
  await assert.rejects(produce(unsupported()),/復元未対応/);
  // Counterexample to byte-only chunking: <8 MiB and <2,000 entries, but
  // more than 350,000 JSON nodes. The writer must split by node count too.
  const dense=await produce(records(1600,{denseDiagnostics:true}),
    {maxPartBytes:MAX_PART_BYTES,maxPartEntries:2000});
  const metaParts=dense.manifest.parts.filter(x=>x.store==='meta');
  assert.ok(metaParts.length>=2, 'structure node budget forces additional meta part');
  const denseRoundtrip=await verifyPartIntegrity(dense.manifestFile,dense.files,'cryptic',db);
  assert.equal(denseRoundtrip.entries,1722);
  await assert.rejects(produce(records(0,{duplicate:true})),/重複|順序/);
  await assert.rejects(produce(records(0,{badOrder:true})),/順序/);
  await assert.rejects(produce(records(0,{noGenome:true})),/DNAが不足/);
  await assert.rejects(produce(records(0,{bigBlob:true})),/単一画像|分割上限/);

  // An exporter must NEVER quietly change user data to match JSON rules.
  // JSON.stringify would turn NaN/Infinity/undefined into null or omit
  // unsafe object keys; the strict restore preflight would reject some
  // of those keys anyway. Reject before returning any manifest.
  async function* corruptNested(unsupported) {
    for await (const row of records(0)) {
      if (row.store === 'meta' && row.key === 'genome:'+generation+':20') {
        yield {...row,value:{...row.value,extra:{nested:unsupported}}};
      } else yield row;
    }
  }
  const unsafeObject=JSON.parse('{"__proto__":{"unsafe":true}}');
  const arrayWithExtra=[1,2];
  arrayWithExtra.note='would be lost';
  const sparseArray=[1,,3];
  // Structured-clone values supported by IndexedDB are not necessarily
  // round-trippable through our JSON v2 format. Never serialize them as {}.
  for(const [invalid,expected] of [
    [NaN,/不正な数値/],[Infinity,/不正な数値/],
    [-Infinity,/不正な数値/],[undefined,/未定義/],
    // IndexedDB retains the -0 sign, while JSON.stringify(-0) emits "0".
    [-0,/負のゼロ/],[[1,-0,2],/負のゼロ/],
    [{inside:{value:-0}},/負のゼロ/],
    [unsafeObject,/安全でない保存キー/],
    [{constructor:1},/安全でない保存キー/],
    [{prototype:1},/安全でない保存キー/],
    // These are valid ordinary IndexedDB objects, not serializer wrappers.
    // A matching binary-shaped object would otherwise decode as a Blob.
    [{$type:'Blob',mime:'image/png',data:'iVBORw0KGgo='},/予約済み型識別子/],
    [{$type:'Date',data:'2026-10-27T00:00:00.000Z'},/予約済み型識別子/],
    [{$type:'Custom',data:'plain metadata'},/予約済み型識別子/],
    [Object.assign(Object.create(null),{$type:'Blob',data:'AA==',mime:'image/png'}),/予約済み型識別子/],
    [new Map([['genome',1]]),/復元未対応のオブジェクト/],
    [new Set([1,2]),/復元未対応のオブジェクト/],
    [/moth/i,/復元未対応のオブジェクト/],
    [new Number(7),/復元未対応のオブジェクト/],
    [new Error('lost message'),/復元未対応のオブジェクト/],
    [arrayWithExtra,/復元未対応の配列/],
    [sparseArray,/復元未対応の配列/]
  ]){
    let savedPartCount=0,returnedManifest=false;
    await assert.rejects((async()=>{
      const result=await writePartsFromRecords(corruptNested(invalid),
        {mode:'cryptic',database:db,currentGeneration:generation,
          maxPartEntries:3,maxPartBytes:4096},
        async()=>{savedPartCount++;});
      returnedManifest=Boolean(result.manifestFile);
    })(),expected);
    assert.equal(returnedManifest,false,
      'a failed export must not return a success-looking manifest');
    assert.ok(savedPartCount>0,
      'this test must exercise error discovered after parts were already prepared');
  }
  await assert.rejects(produce(records(0),{failAfterParts:1,maxPartEntries:3}),/simulated full disk/);
  await assert.rejects(writePartsFromRecords(records(0),
    {mode:'cryptic',database:db,currentGeneration:generation},
    null),/パラメーター/);

  // Tampering with even one stored output rejects before any restore.
  const corrupted=many.files.slice();
  const first=corrupted[0];
  const firstText=await first.text();
  corrupted[0]=new File(['!' + firstText.slice(1)],first.name,{type:'application/json'});
  await assert.rejects(verifyPartIntegrity(many.manifestFile,corrupted,'cryptic',db),/破損/);

  assert.equal(typeof indexedDB.open,'function');
  console.log('RE2-EXH-02: bounded multipart writer, 22,172 records, verifier round-trip, v1 codec, corrupt/missing/order/disk-full cases OK. No IndexedDB accessed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
