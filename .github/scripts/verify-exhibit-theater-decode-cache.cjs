'use strict';
// RE2-PF-03: execute the real image decoder, simulate old session's late error
// after a new mode creates another Promise for the same frame index.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const a=source.indexOf('  function decodeFrame(index) {');
const b=source.indexOf('  function stopPlayback()',a);
assert.ok(a>0&&b>a);
const original=source.slice(a,b);
assert.match(original,/loadedImages\.get\(index\) === ready/);
const launched=[];
class FakeImage{
  constructor(){this.onload=null;this.onerror=null;this.decoding='';launched.push(this);}
  set src(v){this.url=v;}
  decode(){return Promise.resolve();}
  succeed(){this.onload?.();}
  fail(){this.onerror?.(Error('broken image'));}
}
const urls=[],revoked=[];
const ctx={frames:[{generation_id:'gen00021'}],loadedImages:new Map(),
  frameUrls:[],cursor:0,Image:FakeImage,Math,Promise,Error,
  loadFrameBlob:()=>Promise.resolve(new Blob(['original'],{type:'image/webp'})),
  URL:{createObjectURL:()=>{const u='blob:test-'+(urls.length+1);urls.push(u);return u},
       revokeObjectURL:u=>revoked.push(u)}};
vm.runInNewContext(original+'\nglobalThis.read=decodeFrame;',ctx,{
 filename:'exhibit/theater_canvas_20261026.js:decodeFrame',timeout:3000
});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
(async()=>{
 const old=ctx.read(0);void old.catch(()=>{});
 await flush();
 assert.equal(launched[0].url,'blob:test-1');
 ctx.loadedImages.clear();
 const fresh=ctx.read(0);
 await flush();
 assert.notEqual(fresh,old);
 assert.equal(launched[1].url,'blob:test-2');
 launched[0].fail();await flush();
 assert.equal(ctx.loadedImages.get(0),fresh,
   'old failure cannot evict newer same-index promise');
 const reused=ctx.read(0);
 assert.equal(reused,fresh,'current promise reused without third Image');
 assert.equal(launched.length,2);
 launched[1].succeed();await fresh;
 assert.equal(ctx.loadedImages.get(0),fresh);
 ctx.loadedImages.clear();
 const broken=ctx.read(0);void broken.catch(()=>{});
 await flush();launched[2].fail();await flush();
 assert.equal(ctx.loadedImages.has(0),false,'current failed decode may be dropped');
 const retried=ctx.read(0);
 await flush();
 assert.notEqual(retried,broken);
 assert.equal(launched.length,4);
 launched[3].succeed();await retried;
 assert.equal(revoked.length,4,'each lazily loaded frame URL must be released');
 console.log('RE2-PF-03: old failure preserves new-session cache, current failures clean up and retry.');
})().catch(error=>{console.error(error);process.exitCode=1});
