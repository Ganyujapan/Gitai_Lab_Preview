'use strict';

// Exercise the helper emitted into the exhibition-only game bundle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const site = process.argv[2] || '_site';
const base = JSON.parse(fs.readFileSync(
  'data/evolution_models/continuous_v1/config.json', 'utf8'
)).trait_genetics;
const normal = fs.readFileSync('js/pages_preview.js', 'utf8');
const exhibit = fs.readFileSync(
  path.join(site, 'exhibit/js/pages_preview.js'), 'utf8'
);

const start = exhibit.indexOf('  const EXHIBIT_MUTATION_RATE_FACTOR = 0.5;');
const end = exhibit.indexOf('  function makeChildGenome(', start);
assert(start >= 0 && end > start, 'Only the exhibit must contain the 50% helper');
// The normal engine may safely *inspect* the optional exhibit factor via
// typeof for diagnostics. It must never define or activate the slowdown.
assert(!normal.includes('const EXHIBIT_MUTATION_RATE_FACTOR = 0.5;'),
  'Normal public engine must not define exhibition slow-down');

const helper = exhibit.slice(start, end);
const getSlowed = new Function(helper + '\nreturn exhibitionMutationGenetics;')();
const reduced = getSlowed(base);
const probability = key => key.endsWith('_p') || key === 'pattern_birth_p_per_child';
let checked = 0;
for (const [key, value] of Object.entries(base)) {
  if (probability(key)) {
    assert.equal(reduced[key], value / 2, 'Wrong exhibition probability: ' + key);
    checked++;
  } else {
    assert.deepEqual(reduced[key], value, 'Nonprobability changed: ' + key);
  }
}
assert(checked >= 12, 'Expected to exercise all mutation probabilities');
assert.equal(reduced.special_mutation_generation_p, 0.1);
assert.equal(reduced.pattern_birth_p_per_child, 0.02);
assert.equal(reduced.base_hue_small_mutation_p, 0.15);

const neutral = exhibit.slice(
  exhibit.indexOf('  async function ensureWarningNeutralHeadstart('),
  exhibit.indexOf('  function moduleMaskValue('),
);
assert(neutral.includes('const genetics = evolutionConfig.trait_genetics || {};'),
  'The initial 20 generations must use original probability settings');
assert(neutral.includes('          rng,\n          genetics,'),
  'Neutral offspring must receive the unslowed genotype settings');

const live = exhibit.slice(
  exhibit.indexOf('  async function evolveGenerationByGenome('),
  exhibit.indexOf('  async function entertainmentMutationEvent('),
);
assert(live.includes('const genetics = exhibitionMutationGenetics('),
  'Live special-mutation generation probability must be reduced');
assert(live.includes('exhibit_mutation_rate_factor: EXHIBIT_MUTATION_RATE_FACTOR,'),
  'Saved generation diagnostics must record the exhibition factor');
assert(exhibit.includes('geneticsOverride\n      || exhibitionMutationGenetics('),
  'Played offspring must use reduced probability settings');

console.log('Exhibition half-rate checks passed for ' + checked
  + ' mutation probabilities; neutral headstart unchanged.');
