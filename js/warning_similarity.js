/* GITAI_LAB WARNING-COLOR VISUAL ANALYSIS V1
 * Read-only image analysis: NO mutation, selection, timing or RNG.
 * This metric compares rendered sRGB pixels, NOT predator perception or
 * evidence of Batesian mimicry. Both lineages use the same moth mask.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GitaiWarningSimilarity = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const GRID = 16;
  const THRESHOLD_ALPHA = 128;
  const MAX_RGB_DISTANCE_SQUARED = 255 * 255;

  function sampleImageData(image, gridSize = GRID) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
        || image.width < 1 || image.height < 1 || !image.data
        || !Number.isInteger(gridSize) || gridSize < 2 || gridSize > 64) {
      throw new TypeError('Invalid moth image for similarity sampling');
    }
    const values = new Array(gridSize * gridSize);
    for (let gy = 0; gy < gridSize; gy++) {
      const y = Math.min(image.height - 1,
        Math.floor((gy + 0.5) * image.height / gridSize));
      for (let gx = 0; gx < gridSize; gx++) {
        const x = Math.min(image.width - 1,
          Math.floor((gx + 0.5) * image.width / gridSize));
        const at = (y * image.width + x) * 4;
        values[gy * gridSize + gx] = image.data[at + 3] >= THRESHOLD_ALPHA
          ? [image.data[at], image.data[at + 1], image.data[at + 2]]
          : null;
      }
    }
    return values;
  }

  function similarityScore(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length
        || a.length !== b.length) throw new TypeError('Mismatched samples');
    let sum = 0;
    let compared = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i], q = b[i];
      if (!p && !q) continue;
      compared++;
      if (!p || !q) {
        sum += MAX_RGB_DISTANCE_SQUARED;
        continue;
      }
      const dr = p[0] - q[0], dg = p[1] - q[1], db = p[2] - q[2];
      sum += 0.2126 * dr * dr + 0.7152 * dg * dg + 0.0722 * db * db;
    }
    if (!compared) throw new TypeError('No opaque moth pixels were sampled');
    const similarity = 100 * (1 - Math.sqrt(sum / (compared * MAX_RGB_DISTANCE_SQUARED)));
    return Math.round(Math.max(0, Math.min(100, similarity)) * 100) / 100;
  }

  function bestMatch(index, candidateIndices, samples) {
    let bestIndex = null, bestScore = -1;
    for (const candidate of candidateIndices) {
      if (index === candidate) continue;
      const score = similarityScore(samples.get(index), samples.get(candidate));
      if (score > bestScore) {
        bestIndex = candidate;
        bestScore = score;
      }
    }
    if (bestIndex === null) throw new Error('Missing visual comparison candidates');
    return { index: bestIndex, similarity: bestScore };
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function mean(values) {
    if (!values.length) throw new Error('No samples for mean');
    return round2(values.reduce((total, value) => total + value, 0) / values.length);
  }

  // Keyed by original 1..60 child index, already sampled from renderGenome().
  function analyzeGeneration(samples, generationId) {
    if (!(samples instanceof Map) || samples.size !== 60) {
      throw new TypeError('Expected exactly sixty sampled moth images');
    }
    const poison = Array.from({length:30}, (_, i) => i + 1);
    const harmless = Array.from({length:30}, (_, i) => i + 31);
    for (const id of [...poison, ...harmless]) {
      if (!samples.has(id)) throw new Error('Missing moth ' + id);
    }
    const details = harmless.map((id) => {
      const toxic = bestMatch(id, poison, samples);
      const own = bestMatch(id, harmless, samples);
      return {
        harmless_index: id,
        nearest_poison_index: toxic.index,
        nearest_poison_similarity: toxic.similarity,
        nearest_harmless_index: own.index,
        nearest_harmless_similarity: own.similarity,
        difference_from_own_lineage: round2(
          toxic.similarity - own.similarity,
        ),
      };
    });
    const ownPoison = poison.map(id => bestMatch(id, poison, samples).similarity);
    const interScores = details.map(item => item.nearest_poison_similarity);
    const harmlessScores = details.map(item => item.nearest_harmless_similarity);
    return {
      schema_version: 1,
      metric: 'rendered_srgb_weighted_rmse_16grid_v1',
      generation_id: String(generationId),
      compared_poison: 30,
      compared_harmless: 30,
      mean_harmless_nearest_poison: mean(interScores),
      mean_harmless_nearest_harmless: mean(harmlessScores),
      mean_poison_nearest_poison: mean(ownPoison),
      inter_minus_harmless_nearest: round2(mean(interScores) - mean(harmlessScores)),
      // Most visually similar harmless→poison pairs, not a mimicry diagnosis.
      closest_pairs: [...details].sort((a,b) =>
        b.nearest_poison_similarity - a.nearest_poison_similarity
          || a.harmless_index - b.harmless_index
      ).slice(0, 5).map(d => ({
        harmless_index: d.harmless_index,
        poison_index: d.nearest_poison_index,
        similarity: d.nearest_poison_similarity,
      })),
      harmless_matches: details,
      interpretation: 'Image resemblance only; not evidence of avoidance, predation advantage, or Batesian mimicry.',
    };
  }

  return Object.freeze({
    GRID, sampleImageData, similarityScore, analyzeGeneration,
  });
});
