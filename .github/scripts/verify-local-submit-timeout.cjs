'use strict';
// STO-04: execute real sendEvolutionData + local apiFetch cancellation boundary.
// Isolated VM only; no user IDB, no network and no real timers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const engine=fs.readFileSync('js/pages_preview.js','utf8');
function take(src,start,end){
 const i=src.indexOf(start),j=src.indexOf(end,i);
 assert.ok(i>=0&&j>i,'missing real source section '+start);
 return src.slice(i,j);
}
const source=take(html,'  async function sendEvolutionData() {','\n  function showPoisonPenalty()');
const api=take(engine,'  async function apiFetch(','\n  function installPreviewBadge(');
assert.match(source,/pending_confirmation/);
assert.match(source,/window\.fetch === window\.GitaiPagesPreview\.fetch/);
assert.match(source,/continueButton\.disabled = true/);
assert.match(api,/rejectCancelledBeforeStart\(\)/);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function fixture(local){
 let requests=0,probes=0;const pending=deferred(),status=deferred(),timer=[];
 const sent=[];
 const state={
  submitStatus:'idle',uiTransitionLocked:true,runId:'run-keep',
  eatenIndices:new Set([1,4,8]),currentGenerationId:'gen00021',
  roundRecords:[{round_index:1}],nextGenerationId:null
 };
 const ctx={
  state,window:{},fetch:null,AbortController,Set,Promise,JSON,Math,Response,encodeURIComponent,
  submitTimeoutMs:120000,
  setTimeout(fn){timer.push(fn);return timer.length;},
  clearTimeout(){},
  ensureRunId(){return state.runId;},
  evolutionStatus:{textContent:''},
  continueButton:{textContent:'',disabled:false},
  generationOverlay:{classList:{remove(){}}},
  reviewOverlay:{classList:{add(){}}},
  authorNewsTeaser:{hidden:false},
  compareButton:{hidden:false},
  reviewTitle:{textContent:''},reviewMessage:{textContent:''},
  WARNING_LIFE:false,WARNING_MODE:false,
  isEntertainmentModel:()=>true,
  async showGenerationReady(event){sent.push(event);},
  console
 };
 const action=(url,init)=>{
   if(String(url).startsWith('/api/run_status?run_id=')){
     probes++;assert.equal(init.cache,'no-store');return status.promise;
   }
   requests++;assert.equal(init.method,'POST');
   assert.equal(JSON.parse(init.body).run_id,'run-keep');return pending.promise;
 };
 if(local){ctx.window.fetch=action;ctx.window.GitaiPagesPreview={fetch:action};}
 else {ctx.window.fetch=action;ctx.window.GitaiPagesPreview=null;}
 ctx.fetch=action;
 vm.runInNewContext(source+'\nglobalThis.submit=sendEvolutionData;',ctx,
   {filename:'index.html:STO-04',timeout:5000});
 return {ctx,pending,status,timer,sent,state,
  get requests(){return requests},get probes(){return probes},start:()=>ctx.submit()};
}
(async()=>{
 const local=fixture(true);
 const wait=local.start();
 assert.equal(local.requests,1);
 assert.equal(local.state.submitStatus,'sending');
 assert.equal(local.timer.length,1);
 const firstPending=local.timer[0];
 firstPending();
 assert.equal(local.state.submitStatus,'pending_confirmation');
 assert.equal(local.state.uiTransitionLocked,true);
 assert.equal(local.ctx.continueButton.disabled,true);
 assert.match(local.ctx.evolutionStatus.textContent,/保存済みか読み取り専用で確認/);
 assert.equal(local.state.runId,'run-keep');
 assert.equal(local.requests,1,'timeout cannot resubmit while first is alive');
 assert.equal(local.probes,1,'one read-only status check on local timeout');
 local.pending.resolve({
   ok:true,status:200,
   async json(){return {next_generation_id:'gen00022',
     entertainment_event:null}}
 });
 await wait;
 assert.equal(local.state.submitStatus,'success');
 assert.equal(local.state.nextGenerationId,'gen00022');
 assert.equal(local.state.uiTransitionLocked,false);
 assert.equal(local.sent.length,1);
 assert.equal(local.requests,1);
 const recovered=fixture(true);
 const recoveredWait=recovered.start();
 assert.equal(recovered.requests,1);
 recovered.timer[0]();
 assert.equal(recovered.state.submitStatus,'pending_confirmation');
 recovered.status.resolve({ok:true,status:200,async json(){return {
    status:'committed',generation_id:'gen00021',
    next_generation_id:'gen00022',entertainment_event:null,
    current_generation_id:'gen00022'}}});
 await recoveredWait;
 assert.equal(recovered.state.submitStatus,'success');
 assert.equal(recovered.state.nextGenerationId,'gen00022');
 assert.equal(recovered.requests,1,'durable replay cannot send second evolution');
 assert.equal(recovered.probes,1);
 assert.equal(recovered.sent.length,1);

 const unconfirmed=fixture(true);
 const unresolved=unconfirmed.start();
 unconfirmed.timer[0]();
 unconfirmed.status.resolve({ok:true,status:200,async json(){return {
   status:'unconfirmed',current_generation_id:'gen00021'
 }}});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(unconfirmed.state.submitStatus,'pending_confirmation',
   'unknown result must remain locked');
 assert.equal(unconfirmed.ctx.continueButton.disabled,true);
 assert.equal(unconfirmed.requests,1);
 unconfirmed.pending.resolve({ok:true,status:200,async json(){
   return {next_generation_id:'gen00022',entertainment_event:null};
 }});
 await unresolved;
 assert.equal(unconfirmed.state.submitStatus,'success');

 const cancelled=fixture(true);
 const ctrl=new AbortController();ctrl.abort();
 const ctx={
  location:{href:'https://example.test/Gitai_Lab_Preview/'},
  URL,Error,init:null,ensureConfig:async()=>{throw Error('Should not run after preabort')},
  nativeFetch:async()=>{throw Error('Should not fetch remote')},
  jsonResponse:()=>{throw Error('Should not serialize')},
  window:{},
  console
 };
 vm.runInNewContext(api+'\nglobalThis.localFetch=apiFetch;',ctx,
   {filename:'js/pages_preview.js:STO-04',timeout:4000});
 await assert.rejects(ctx.localFetch('/api/submit_run',{
   signal:ctrl.signal,body:'{}',method:'POST'
 }),error=>error.name==='AbortError');
 const paused=deferred();let beginCount=0;
 ctx.ensureConfig=()=>{beginCount++;return paused.promise;};
 const later=new AbortController();
 const waiting=ctx.localFetch('/api/submit_run',{
   signal:later.signal,body:'{}',method:'POST'
 });
 later.abort();paused.resolve();
 await assert.rejects(waiting,error=>error.name==='AbortError');
 assert.equal(beginCount,1);

 console.log('STO-04: pre-start AbortSignal is honored, local timeout reports unknown outcome without abort/duplicate run; late successful commit still completes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
