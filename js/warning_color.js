/* Warning-color experiment: two independent moth lineages.
 * Pure functions are shared by the browser game and its evolution engine.
 */
(function (root) {
  'use strict';
  const PER_LINEAGE = 30;
  const TOTAL = 60;
  const POISON = 'poison';
  const HARMLESS = 'harmless';

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

  const api = Object.freeze({
    POISON, HARMLESS, PER_LINEAGE, TOTAL,
    lineage, indices, makeRounds, survivorCounts, viable, chooseBackground,
    synchronizedSpecialMutationIndices,
  });
  root.GitaiWarningColor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
