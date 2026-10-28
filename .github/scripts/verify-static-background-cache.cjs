'use strict';
// PF05: exercise real loadStaticBackground helper in a VM without the network.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const a=source.indexOf('  const backgroundImageRequests = new Map();');
const b=source.indexOf('  async function requestScreenWakeLock()',a);
assert.ok(a>0 && b>a,'static background helper not found');
const actual=source.slice(a,b);
for(const changed of [
 'state.backgroundImage = await loadStaticBackground(CONFIG.BACKGROUND_SRC)',
 'const img = await loadStaticBackground(bg.src)',
 'loadStaticBackground(backgroundSrc),'
])assert.ok(source.includes(changed),'callsite not using stable background helper: '+changed);
assert.ok(source.includes('cacheBustUrl(individualAssetPath(state.currentGenerationId, i))'),
 'dynamic moth images MUST continue using their normal per-generation source');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const calls=[],requests=[];
const ctx={
 Map,Error,Promise,
 cacheBustUrl:()=>{throw Error('PF05 static image MUST NOT use time-based URL')},
 loadImage:url=>{calls.push(url);const d=deferred();requests.push(d);return d.promise}
};
vm.runInNewContext(actual+'\nglobalThis.readBackground=loadStaticBackground;globalThis.cache=backgroundImageRequests;',
 ctx,{filename:'index.html:PF05',timeout:4000});
(async()=>{
 const first=ctx.readBackground('environments/kusagi/background.png');
 const same=ctx.readBackground('environments/kusagi/background.png');
 assert.equal(first,same,'share exactly one pending Promise, not separate loads');
 assert.equal(calls.length,1);
 assert.equal(calls[0],'environments/kusagi/background.png','stable static URL');
 const image={naturalWidth:720,naturalHeight:1280,src:'same-image'};
 requests[0].resolve(image);
 assert.equal(await first,image);
 assert.equal(await ctx.readBackground('environments/kusagi/background.png'),image);
 assert.equal(calls.length,1,'multiple score generations reuse same Image');
 const second=ctx.readBackground('environments/ginkgo/background.png');
 assert.equal(calls.length,2,'different background is a distinct asset');
 assert.equal(calls[1],'environments/ginkgo/background.png');
 requests[1].resolve({naturalWidth:720,src:'ginkgo'});
 assert.equal((await second).src,'ginkgo');

 const broken=ctx.readBackground('environments/bad/background.png');
 const error=broken.catch(e=>e);
 assert.equal(calls.length,3);
 requests[2].reject(Error('Image cannot load'));
 assert.match((await error).message,/cannot load/);
 assert.equal(ctx.cache.has('environments/bad/background.png'),false,
  'cache a failure neither now nor on next navigation');
 const retry=ctx.readBackground('environments/bad/background.png');
 assert.equal(calls.length,4);
 requests[3].resolve({src:'recovered'});
 assert.equal((await retry).src,'recovered');
 assert.equal(ctx.cache.size,3);
 await assert.rejects(ctx.readBackground(''),/背景画像が指定/);
 assert.equal(calls.length,4);
 console.log('PF05: stable cacheable URLs, shared decoded images, distinct environments and safe failure retry OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
