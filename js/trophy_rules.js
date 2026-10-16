/* Stable S/SS trophy counts; all-photo backgrounds open in test mode only. */
(function(root){
  'use strict';
  const STORAGE_KEY='gitai-trophies-v1';
  const VERSION=/^gitai_rank_calibrated_v[1-9][0-9]*$/;
  const ACCESS=root.GitaiHabitatAccess || (typeof require==='function' ? require('./habitat_access.js') : null);
  const basic=ACCESS.userHabitats[0];
  const LEVELS=Object.freeze([
    {id:basic.id,required:0,playable:true,label:basic.ja,asset:basic.asset,en:basic.en},
    {id:'future_001',required:1,playable:false,label:'？？？',en:'???'},
    {id:'future_002',required:10,playable:false,label:'？？？',en:'???'},
  ]);
  const COMPARISON_LEVELS=Object.freeze(ACCESS.allHabitats.slice(1).map(e=>({
    id:e.id,required:0,playable:true,comparison:true,
    label:e.ja,en:e.en,asset:e.asset,
  })));
  function eligible(r){
    return !!(r && typeof r.id==='string' && r.id.length
      && r.evolution_model_id==='continuous_v1'
      && (r.trophy_rank==='S'||r.trophy_rank==='SS')
      && typeof r.rank_calibration_version==='string'&&VERSION.test(r.rank_calibration_version));
  }
  function normalize(input){
    const data=input&&typeof input==='object'?input:{};
    const awards=new Set(Array.isArray(data.awards)?data.awards.filter(x=>typeof x==='string'&&x):[]);
    const unlocked=new Set(Array.isArray(data.unlocked)?data.unlocked.filter(x=>['future_001','future_002','sand_001'].includes(x)):[]);
    return {version:2,awards:[...awards],unlocked:[...unlocked]};
  }
  function merge(previous,specimens){
    const state=normalize(previous),ids=new Set(state.awards);
    for(const entry of Array.isArray(specimens)?specimens:[])if(eligible(entry))ids.add(entry.id);
    const unlocked=new Set(state.unlocked);
    for(const e of LEVELS)if(ids.size>=e.required)unlocked.add(e.id);
    return {version:2,awards:[...ids],unlocked:[...unlocked]};
  }
  function progress(data,options={}){
    const state=normalize(data),count=state.awards.length;
    const testMode=typeof options.testMode==='boolean'?options.testMode:ACCESS.testMode;
    const entries=testMode?[LEVELS[0],...COMPARISON_LEVELS]:LEVELS;
    return {count,testMode,environments:entries.map(e=>({
      ...e,current:Math.min(count,e.required),
      unlocked:!!(testMode&&e.comparison)||e.required===0||state.unlocked.includes(e.id)||count>=e.required,
    }))};
  }
  const api={STORAGE_KEY,LEVELS,COMPARISON_LEVELS,eligible,normalize,merge,progress};
  root.GitaiTrophyRules=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
