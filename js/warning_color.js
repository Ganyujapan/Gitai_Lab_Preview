/* Warning-color experiment: two independent moth lineages.
 * Pure functions are shared by the browser game and its evolution engine.
 */
(function (root) {
  'use strict';
  const PER_LINEAGE = 30;
  const TOTAL = 60;
  const POISON = 'poison';
  const HARMLESS = 'harmless';
  // Life is kept in integer thirds to avoid floating-point drift.
  const LIFE_MAX_THIRDS = 30;
  const LIFE_INITIAL_THIRDS = 9;
  function adjustLife(thirds, kind) {
    const current = Number.isInteger(thirds)
      ? Math.max(0, Math.min(LIFE_MAX_THIRDS, thirds))
      : LIFE_INITIAL_THIRDS;
    if (kind === POISON) return Math.max(0, current - 3);
    if (kind === HARMLESS) return Math.min(LIFE_MAX_THIRDS, current + 1);
    throw new RangeError('Unknown captured moth lineage');
  }


  function lineage(index) {
    if (!Number.isInteger(index) || index < 1 || index > TOTAL) {
      throw new RangeError('Invalid warning experiment moth index: ' + index);
    }
    return index <= PER_LINEAGE ? POISON : HARMLESS;
  }

  function indices(kind) {
    if (kind !== POISON && kind !== HARMLESS) {
      throw new RangeError('Invalid warning experiment lineage');
    }
    const start = kind === POISON ? 1 : PER_LINEAGE + 1;
    return Array.from({ length: PER_LINEAGE }, (_, i) => start + i);
  }

  function shuffle(values, rng = Math.random) {
    const a = [...values];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeRounds(rng = Math.random) {
    const poison = shuffle(indices(POISON), rng);
    const harmless = shuffle(indices(HARMLESS), rng);
    return Array.from({ length: 5 }, (_, r) => shuffle([
      ...poison.slice(r * 6, r * 6 + 6),
      ...harmless.slice(r * 6, r * 6 + 6),
    ], rng));
  }

  function survivorCounts(eatenIndices) {
    const eaten = new Set(eatenIndices);
    return {
      poison: indices(POISON).filter(i => !eaten.has(i)).length,
      harmless: indices(HARMLESS).filter(i => !eaten.has(i)).length,
    };
  }

  function viable(eatenIndices) {
    const count = survivorCounts(eatenIndices);
    return count.poison >= 2 && count.harmless >= 2;
  }

  function chooseBackground(pool, rng = Math.random) {
    if (!Array.isArray(pool) || pool.length < 1) throw new Error('Missing warning experiment backgrounds');
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }

  // Draw one Bernoulli trial per generation. When it succeeds, select one
  // offspring independently from each lineage; the two mutations then draw
  // their own color, brightness, texture and pattern parameters.
  function synchronizedSpecialMutationIndices(probability, rng = Math.random) {
    const p = Math.max(0, Math.min(1, Number(probability) || 0));
    if (rng() >= p) return [];
    return [
      1 + Math.min(PER_LINEAGE - 1, Math.floor(rng() * PER_LINEAGE)),
      PER_LINEAGE + 1
        + Math.min(PER_LINEAGE - 1, Math.floor(rng() * PER_LINEAGE)),
    ];
  }

  // Weather and mutation are separate random events. Fog is sampled once
  // per warning-experiment round, before display. An ordinary fog roll
  // is followed by a dense-fog roll only when the first one succeeds.
  function chooseFogEvent(fogProbability, denseGivenFogProbability, rng = Math.random) {
    const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
    if (rng() >= clamp(fogProbability)) return 'none';
    return rng() < clamp(denseGivenFogProbability) ? 'dense_fog' : 'fog';
  }

  const api = Object.freeze({
    POISON, HARMLESS, PER_LINEAGE, TOTAL,
    LIFE_MAX_THIRDS, LIFE_INITIAL_THIRDS, adjustLife,
    lineage, indices, makeRounds, survivorCounts, viable, chooseBackground,
    synchronizedSpecialMutationIndices, chooseFogEvent,
  });
  root.GitaiWarningColor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
