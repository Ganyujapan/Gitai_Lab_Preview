'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const page=fs.readFileSync(path.join(root,'js/pages_preview.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function section(src,start,end){
  const a=src.indexOf(start);
  const b=a<0?-1:src.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing code segment: '+start);
  return src.slice(a,b);
}

const sourceLookup=section(page,'  function genomeKey(generationId, index) {','  async function deleteGeneration(');
const sourceSave=section(html,'  async function loadSpecimenGenome(','  function releaseSpecimenObjectUrls()');

function lookup({model='continuous_v1',value,fail=false}={}){
  const calls=[];
  const getter=new Function('EVOLUTION_MODEL_ID','TOTAL','META_STORE','idbGet',sourceLookup+'; return getStoredGenomeForSpecimen;')(
    model,60,'meta',async(store,key)=>{
      calls.push({store,key});
      if(fail)throw Error('database read failed');
      return value;
    }
  );
  return {getter,calls};
}
function saver({existing=null,genome=null,readFails=false}={}){
  let stored=null,reads=0,fetches=0,trophies=0;
  const image=new Blob(['image-unchanged'],{type:'image/png'});
  const window={
    GitaiPagesPreview:{
      getStoredGenomeForSpecimen:async()=>{reads++;if(readFails)throw Error('missing database');return genome;},
      context:{environmentId:'leaf_001',evolutionModelId:'continuous_v1',runId:'default'}
    },
    GitaiTrophies:{recordSpecimen:()=>{trophies++;}}
  };
  const state={temporaryMothRanks:new Map([['gen00027:12',73.5]])};
  const fn=new Function('window','specimenIdentity','specimenGet','specimenPut','isEntertainmentModel','fetch','console','state',
    sourceSave+'; return saveSpecimen;'
  )(
    window,()=> 'leaf_001:continuous_v1:default:gen00027:12',
    async()=>existing,async r=>{stored=r;},()=>true,
    async()=>{fetches++;return {ok:true,blob:async()=>image};},
    {warn:()=>{}},state
  );
  return {
    fn,run:()=>fn('gen00027',12,'/moth.png'),
    result:()=>({stored,reads,fetches,trophies,image})
  };
}

test('read-only bridge reads exact stored genome for continuous model',async()=>{
  const genome={schema_version:1,baseHue:170,modules:{eye:{alleles:[1,0]}}};
  const {getter,calls}=lookup({value:genome});
  assert.deepEqual(await getter('gen00027',12),genome);
  assert.deepEqual(calls,[{store:'meta',key:'genome:gen00027:12'}]);
});
test('read-only bridge refuses other models, malformed ids, and missing genome',async()=>{
  const params={value:{schema_version:1,modules:{}}};
  const different=lookup({...params,model:'morph_v1'});
  assert.equal(await different.getter('gen00027',12),null);
  assert.equal(different.calls.length,0);
  const current=lookup(params);
  for(const [id,index] of [['bad',12],['gen00027',0],['gen00027',61],['gen00027',2.5]]){
    assert.equal(await current.getter(id,index),null);
  }
  assert.equal(current.calls.length,0);
  assert.equal(await lookup({value:{schema_version:2,modules:{}}}).getter('gen00027',12),null);
  assert.equal(await lookup({value:null}).getter('gen00027',12),null);
});
test('new specimen saves the original image and genome together',async()=>{
  const genome={schema_version:1,baseHue:100,patternContrast:.6,modules:{spot:{alleles:[1,0]}}};
  const s=saver({genome});
  assert.equal(await s.run(),true);
  const {stored,reads,fetches,trophies,image}=s.result();
  assert.equal(stored.genome,genome);
  assert.equal(stored.image_blob,image);
  assert.equal(stored.generation_number,27);
  assert.equal(stored.individual_index,12);
  assert.equal(stored.environment_id,'leaf_001');
  assert.equal(stored.temporary_rank_score,73.5,'the original played-position score is saved');
  assert.equal(reads,1);assert.equal(fetches,1);assert.equal(trophies,1);
});
test('old specimen gets optional genome backfill without touching its PNG or metadata',async()=>{
  const originalImage=new Blob(['original image'],{type:'image/png'});
  const existing={id:'existing',image_blob:originalImage,saved_at:'2026-01-01',other_data:{kept:true}};
  const genome={schema_version:1,baseHue:22,modules:{}};
  const s=saver({existing,genome});
  assert.equal(await s.run(),true);
  const {stored,reads,fetches}=s.result();
  assert.equal(stored.image_blob,originalImage);
  assert.equal(stored.saved_at,existing.saved_at);
  assert.deepEqual(stored.other_data,{kept:true});
  assert.equal(stored.genome,genome);
  assert.equal(stored.temporary_rank_score,73.5);
  assert.equal(reads,1);assert.equal(fetches,0);
});
test('missing original genome never creates image-only specimens',async()=>{
  const old={id:'old',image_blob:new Blob(['old'])};
  const existing=saver({existing:old,genome:null});
  await assert.rejects(existing.run(),/標本の情報を取得できませんでした/);
  assert.equal(existing.result().stored,null);
  assert.equal(existing.result().fetches,0);
  const fresh=saver({genome:null,readFails:true});
  await assert.rejects(fresh.run(),/標本の情報を取得できませんでした/);
  assert.equal(fresh.result().stored,null);
  assert.equal(fresh.result().fetches,0);
});
test('Genome data stays internal and user-facing labels are simple',()=>{
  assert.match(page,/getStoredGenomeForSpecimen,\s*context:/);
  assert.match(html,/shareStatus\.textContent = '標本箱に保存しました。'/);
  assert.doesNotMatch(html,/画像とGenomeを保存しました|画像のみです| · DNA/);
  assert.doesNotMatch(sourceLookup,/idbPut\(/);
});
