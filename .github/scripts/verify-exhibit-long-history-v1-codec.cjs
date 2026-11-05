'use strict';
// Exercise the ACTUAL exhibition admin v1 JSON value codec using synthetic
// 1000-generation image/visitor metadata. No IndexedDB, localStorage, game,
// cache, backup restore or user file is opened. Does not simulate iPad RAM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash} = require('node:crypto');

const source = fs.readFileSync('exhibit/admin.js','utf8');
const start = source.indexOf('  function encode64(bytes) {');
const end = source.indexOf('  async function digest(text) {',start);
assert.ok(start > 0 && end > start,'production v1 base64 codec must exist');
const code = source.slice(start,end);
const sandbox = {
  Blob,ArrayBuffer,
  Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,
  Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,
  Object,Date,btoa,atob
};
vm.runInNewContext(code+
  '\nglobalThis.codec = Object.freeze({encode, decode});',sandbox,
  {filename:'exhibit/admin.js:production-v1-codec',timeout:5000});
const {encode,decode}=sandbox.codec;
const id = n => 'gen'+String(n).padStart(5,'0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Use the current published nickname META namespace; no historical names or real blobs are read.\nconst snapshot = {
  // Saved images are simulated; real image size and OS quota remain unknown.
  theater_frames:Array.from({length:1000},(_,i)=>{
    const generation=i+1;
    const bytes=new Uint8Array(128);
    for(let j=0;j<bytes.length;j++)bytes[j]=(generation*17+j*13)%256;
    return {key:id(generation),value:{
      generation_id:id(generation),generation_number:generation,
      render_version:3,image_blob:new Blob([bytes],{type:'image/webp'})
    }};
  }),
  meta:Array.from({length:200},(_,i)=>{
    const start=i*5+1,end=start+4;
    return {key:'exhibit_visit_nickname_v1:'+id(end),value:{
      schema:1,start,end,name:'来場者🦋'+String(i+1)
    }};
  })
};

(async()=>{
  const encoded=await encode(snapshot); // actual production encoder
  assert.equal(encoded.theater_frames.length,1000);
  assert.equal(encoded.meta.length,200);
  assert.equal(encoded.theater_frames[0].value.image_blob.$type,'Blob');
  assert.equal(encoded.theater_frames[0].value.image_blob.mime,'image/webp');
  const file=JSON.stringify(encoded);
  const decoded=decode(JSON.parse(file)); // actual production decoder
  assert.equal(decoded.theater_frames.length,1000);
  assert.equal(decoded.meta.length,200);
  const records=Array.from(decoded.meta,entry=>JSON.stringify(entry.value));
  const expected=Array.from(snapshot.meta,entry=>JSON.stringify(entry.value));
  assert.deepEqual(records,expected,
    '1000 generations retain all 200 nickname/range records byte-for-byte');
  for(const i of [0,1,199,499,999]){
    const original=snapshot.theater_frames[i].value.image_blob;
    const restored=decoded.theater_frames[i].value.image_blob;
    assert.ok(restored instanceof Blob);
    assert.equal(restored.type,'image/webp');
    assert.equal(hash(Buffer.from(await restored.arrayBuffer())),
      hash(Buffer.from(await original.arrayBuffer())),
      'historical frame binary changes at index '+i);
    assert.equal(decoded.theater_frames[i].key,id(i+1));
  }
  // A copied Unicode nickname must not be encoded as HTML or lose emoji.
  assert.equal(decoded.meta[0].value.name,'来場者🦋1');
  assert.equal(decoded.meta[199].value.name,'来場者🦋200');
  console.log('EXH-V1: real production codec preserves 1000 binary snapshots and 200 per-visit Japanese/emoji nicknames; synthetic memory-only, no live DB or iPad quota.');
})().catch(e=>{console.error(e);process.exitCode=1});
