/* Gitai Lab trophy rules; scorer-agnostic and intentionally requires calibrated grades. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'gitai-trophies-v1';
  const RANK_VERSION = /^gitai_rank_calibrated_v[1-9][0-9]*$/;
  const LEVELS = Object.freeze([
    { id: 'bark_001', required: 0, playable: true, label: '樹皮' },
    { id: 'sand_001', required: 1, playable: true, label: '砂地' },
    { id: 'future_001', required: 10, playable: false, label: '？？？' },
  ]);

  function eligible(r) {
    return !!(r && typeof r.id === 'string' && r.id.length
      && r.evolution_model_id === 'continuous_v1'
      && (r.trophy_rank === 'S' || r.trophy_rank === 'SS')
      && typeof r.rank_calibration_version === 'string'
      && RANK_VERSION.test(r.rank_calibration_version));
  }

  function normalize(data) {
    const source = data && typeof data === 'object' ? data : {};
    const awards = new Set(Array.isArray(source.awards)
      ? source.awards.filter(id => typeof id === 'string' && id.length) : []);
    const unlocked = new Set(Array.isArray(source.unlocked)
      ? source.unlocked.filter(id => id === 'sand_001' || id === 'future_001') : []);
    return { version: 1, awards: [...awards], unlocked: [...unlocked] };
  }

  function merge(previous, specimens) {
    const state = normalize(previous);
    const ids = new Set(state.awards);
    for (const specimen of Array.isArray(specimens) ? specimens : []) {
      if (eligible(specimen)) ids.add(specimen.id);
    }
    const unlocked = new Set(state.unlocked);
    for (const environment of LEVELS) {
      if (ids.size >= environment.required) unlocked.add(environment.id);
    }
    return { version: 1, awards: [...ids], unlocked: [...unlocked] };
  }

  function progress(data) {
    const state = normalize(data);
    const count = state.awards.length;
    return {
      count,
      environments: LEVELS.map(e => ({
        ...e,
        current: Math.min(count, e.required),
        unlocked: e.required === 0 || state.unlocked.includes(e.id) || count >= e.required,
      })),
    };
  }

  const api = { STORAGE_KEY, LEVELS, eligible, normalize, merge, progress };
  root.GitaiTrophyRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
