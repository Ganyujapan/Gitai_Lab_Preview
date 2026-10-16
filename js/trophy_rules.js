/* Trophy medals use validated S/SS only; score calibration must be completed first. */
(function(root) {
  'use strict';
  const STORAGE_KEY = 'gitai-trophies-v1';
  const RANK_VERSION = /^gitai_rank_calibrated_v[1-9][0-9]*$/;
  const LEVELS = Object.freeze([
    { id:'kusagi_001', required:0, playable:true, label:'クサギ01', asset:'img/backgrounds/bg_kusagi_720x1280_01.png' },
    { id:'future_001', required:1, playable:false, label:'？？？' },
    { id:'future_002', required:10, playable:false, label:'？？？' },
  ]);
  const COMPARISON_LEVELS = Object.freeze([
    { id:'bark_001', required:0, playable:true, comparison:true, label:'旧・樹皮', asset:'img/backgrounds/bg_preview.svg' },
    { id:'sand_001', required:0, playable:true, comparison:true, label:'旧・砂地', asset:'img/backgrounds/bg_desert_preview.svg' },
  ]);
  function eligible(r) {
    return !!(r && typeof r.id==='string' && r.id.length
      && r.evolution_model_id==='continuous_v1'
      && (r.trophy_rank==='S' || r.trophy_rank==='SS')
      && typeof r.rank_calibration_version==='string'
      && RANK_VERSION.test(r.rank_calibration_version));
  }
  function normalize(data) {
    const input = data && typeof data === 'object' ? data : {};
    const awards = new Set(Array.isArray(input.awards) ? input.awards.filter(x=>typeof x==='string'&&x) : []);
    const unlocked = new Set(Array.isArray(input.unlocked) ? input.unlocked.filter(x=>['sand_001','future_001','future_002'].includes(x)) : []);
    return {version:2, awards:[...awards], unlocked:[...unlocked]};
  }
  function merge(previous,specimens) {
    const state=normalize(previous),ids=new Set(state.awards);
    for(const record of Array.isArray(specimens)?specimens:[]) if(eligible(record))ids.add(record.id);
    const unlocked=new Set(state.unlocked);
    for(const e of LEVELS) if(ids.size>=e.required)unlocked.add(e.id);
    return {version:2,awards:[...ids],unlocked:[...unlocked]};
  }
  function progress(data,options={}) {
    const state=normalize(data),count=state.awards.length;
    const testMode=typeof options.testMode==='boolean'
      ? options.testMode : !!root.GitaiHabitatAccess?.testMode;
    const list=testMode ? [LEVELS[0],...COMPARISON_LEVELS] : LEVELS;
    return {count,testMode,environments:list.map(e=>({
      ...e, current:Math.min(count,e.required),
      unlocked:!!e.comparison&&testMode || e.required===0 || state.unlocked.includes(e.id) || count>=e.required,
    }))};
  }
  const api={STORAGE_KEY,LEVELS,COMPARISON_LEVELS,eligible,normalize,merge,progress};
  root.GitaiTrophyRules=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
