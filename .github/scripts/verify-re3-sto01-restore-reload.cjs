'use strict';
// RE3-STO-01: execute real UI error handlers with sterile fetch responses.
// No IndexedDB, real backup, browser profile or game data is opened/modified.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>0&&b>a,'production source marker missing '+start);
 return source.slice(a,b);
}
const submitSource=section('  async function sendEvolutionData()', '\n  function showPoisonPenalty()');
const clickSource=section("  continueButton.addEventListener('click', () => {",
 '\n  });');
assert.match(submitSource,/data\.error === 'restore_epoch_mismatch'/);
assert.match(submitSource,/state\.submitStatus = 'stale_restore'/);
assert.match(submitSource,/reviewMessage\.textContent = typeof data\.message === 'string'/);
assert.doesNotMatch(submitSource,/reviewMessage\.innerHTML\s*=/);
assert.match(clickSource,/state\.submitStatus === 'stale_restore'/);
assert.match(submitSource,/state\.submitStatus = 'pending_confirmation'/,
 'preserve uncertain commit handling');
assert.match(submitSource,/data\.error === 'generation_mismatch'/,
 'preserve distinct pointer mismatch handling');
function node(){
 const classes=new Set();
 return {hidden:false,disabled:false,textContent:'',classList:{
  add:tag=>classes.add(tag),remove:tag=>classes.delete(tag),
  contains:tag=>classes.has(tag)},
  addEventListener(name,fn){this[name]=fn;}
 };
}
function setup({entertainment,error='restore_epoch_mismatch',status=409,message}={}){
 const state={submitStatus:'ready',currentGenerationId:'gen00021',
  eatenIndices:new Set([1,2,3]),roundRecords:[],uiTransitionLocked:false,
  nextGenerationId:null,runId:'actual-run-1',warningLifeThirds:30};
 const location={href:'https://example.test/Gitai_Lab_Preview/index.html?env=kusagi_001&run=warning_color_fog_v2&experiment=warning_color'};
 const continueButton=node(),reviewOverlay=node(),generationOverlay=node();
 const reviewTitle=node(),reviewMessage=node(),evolutionStatus=node();
 const authorNewsTeaser=node(),compareButton=node();
 const requests=[];
 const payload=error==='generation_mismatch'
  ? {error,server_current_generation_id:'gen00050'}
  : error==='insufficient_survivors'
  ? {error,retry_same_generation:true}
  : {error,message};
 const ctx={
  state,location,window:{GitaiPagesPreview:null},URL,Date,Math,Array,Set,
  Promise,AbortController,Response,
  setTimeout,clearTimeout,submitTimeoutMs:30000,
  continueButton,reviewOverlay,generationOverlay,
  reviewTitle,reviewMessage,evolutionStatus,authorNewsTeaser,compareButton,
  ensureRunId:()=>state.runId,isEntertainmentModel:()=>Boolean(entertainment),
  WARNING_LIFE:false,WARNING_MODE:false,
  fetch:async (url,options)=>{
   requests.push({url,options});
   return {status,ok:false,json:async()=>payload};
  },
  // These are not invoked on a stale restore; if clicked they indicate an
  // unsafe resubmit or restart of the active generation.
  buildRounds(){throw Error('unexpected game reset')},
  startRound(){throw Error('unexpected replay')},
  showGenerationGenerating(){throw Error('unexpected generation request')},
  console
 };
 vm.runInNewContext(submitSource+'\n'+clickSource+'\n  });\nglobalThis.submit=sendEvolutionData;',
  ctx,{filename:'index.html:RE3-STO-01',timeout:3000});
 return {ctx,state,location,continueButton,reviewOverlay,generationOverlay,
  reviewTitle,reviewMessage,evolutionStatus,authorNewsTeaser,compareButton,requests};
}
(async()=>{
 const malicious='<img src=x onerror=alert(1)>';
 for(const entertainment of [true,false]){
  const page=setup({entertainment,message:'復元しました。'+malicious});
  await page.ctx.submit();
  assert.equal(page.requests.length,1);
  assert.equal(page.requests[0].url,'/api/submit_run');
  assert.equal(page.requests[0].options.method,'POST');
  assert.equal(page.state.submitStatus,'stale_restore');
  assert.equal(page.state.nextGenerationId,null);
  assert.equal(page.state.uiTransitionLocked,false);
  assert.equal(page.continueButton.disabled,false);
  assert.equal(page.continueButton.textContent,'復元後の世代を読み込む');
  assert.equal(page.reviewTitle.textContent,'実験が別の画面で復元されました');
  assert.equal(page.reviewMessage.textContent,'復元しました。'+malicious);
  assert.match(page.evolutionStatus.textContent,/再送せず/);
  assert.equal(page.authorNewsTeaser.hidden,true);
  assert.equal(page.compareButton.hidden,false);
  if(entertainment){
   assert.equal(page.reviewOverlay.classList.contains('visible'),true);
   assert.equal(page.generationOverlay.classList.contains('visible'),false);
  }
  page.continueButton.click();
  assert.equal(page.requests.length,1,'explicit reload never resends old run');
  const newUrl=new URL(page.location.href);
  assert.equal(newUrl.searchParams.get('run'),'warning_color_fog_v2');
  assert.equal(newUrl.searchParams.get('env'),'kusagi_001');
  assert.equal(newUrl.searchParams.get('experiment'),'warning_color');
  assert.ok(newUrl.searchParams.has('v'),'new page reloads and recaptures epoch');
  assert.equal(newUrl.searchParams.get('play'),entertainment?'1':null);
 }
 {
  const page=setup({entertainment:true,error:'restore_epoch_mismatch'});
  await page.ctx.submit();
  assert.match(page.reviewMessage.textContent,/元データを保持/);
 }
 {
  const page=setup({error:'generation_mismatch',entertainment:true});
  await page.ctx.submit();
  assert.equal(page.state.submitStatus,'stale_generation');
  assert.equal(page.continueButton.textContent,'最新世代を読み込む');
  assert.match(page.evolutionStatus.textContent,/gen00050/);
  page.continueButton.click();
  assert.equal(page.requests.length,1);
  assert.ok(new URL(page.location.href).searchParams.has('v'));
 }
 {
  const page=setup({error:'insufficient_survivors',status:422});
  await page.ctx.submit();
  assert.equal(page.state.submitStatus,'retry_generation');
  assert.equal(page.continueButton.textContent,'同じ世代でもう一度');
 }
 {
  const page=setup({error:'internal_error',status:500});
  await page.ctx.submit();
  assert.equal(page.state.submitStatus,'failed');
  assert.equal(page.continueButton.textContent,'もう一度送信',
   'unrelated HTTP error retains original retry behavior');
 }
 console.log('RE3-STO-01: real submit/review/click: normal and warning restore409 -> safe text and explicit reload without resubmit; generation mismatch/422/500 unaffected.');
})().catch(error=>{console.error(error);process.exitCode=1});
