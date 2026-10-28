'use strict';
// PF05 follow-up: exercise the real static JSON loader; dynamic APIs stay uncached.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('js/pages_preview.js', 'utf8');
const start = page.indexOf('  async function loadJson(path) {');
const end = page.indexOf('  async function ensureConfig()', start);
assert.ok(start > 0 && end > start, 'real static JSON loader not found');
const requests = [];
const context = {
  nativeFetch: async (url, options) => {
    requests.push({url, options});
    if (url.includes('/missing.json')) return {ok: false, status: 404};
    return {ok: true, json: async () => ({url})};
  },
  baseUrl: path => 'https://example.test/exhibit/' + path,
  Error
};
vm.runInNewContext(
  page.slice(start, end) + '\nglobalThis.loadStaticJson = loadJson;',
  context, {filename: 'js/pages_preview.js:PF05', timeout: 4000}
);
(async () => {
  const paths = [
    'config/konchu_univ_alpha.json',
    'species/moth/species.json',
    'environments/kusagi_001/environment.json',
    'data/evolution_models/continuous_v1/config.json',
    'config/warning_color_experiment.json'
  ];
  for (const path of paths) {
    const value = await context.loadStaticJson(path);
    assert.equal(value.url, 'https://example.test/exhibit/' + path);
  }
  assert.equal(requests.length, paths.length);
  for (const request of requests) {
    assert.equal(request.options.cache, 'default',
      'static JSON must use HTTP cache, not no-store');
  }
  await assert.rejects(context.loadStaticJson('missing.json'), /HTTP 404/);
  assert.equal(requests[paths.length].options.cache, 'default');

  const game = fs.readFileSync('index.html', 'utf8');
  assert.match(game, /function loadStaticBackground\(src\)\s*\{[\s\S]*?loadImage\(key\)\.catch\(/);
  assert.match(game, /async function loadEnvironmentForScore\(environmentId\)\s*\{[\s\S]*?cache: 'default'/);
  assert.match(game, /cacheBustUrl\(individualAssetPath\(state\.currentGenerationId, i\)\)/,
    'dynamic moth PNGs must still bypass stale caches');
  assert.ok(game.includes("fetch('/api/app_config', { cache: 'no-store' })"),
    'live API must remain uncached');
  assert.ok(game.includes("fetch('/api/current_generation', { cache: 'no-store' })"),
    'live generation pointer must remain uncached');
  const sw = fs.readFileSync('exhibit/sw.template.js', 'utf8');
  assert.ok(sw.includes("new Request(url, { cache: 'reload' })"),
    'a new exhibit build must refetch assets during SW installation');
  assert.ok(sw.includes('cache.match(request, { ignoreSearch: true })'),
    'offline exhibit must still serve cached assets');
  console.log('PF05: static JSON cacheable, live APIs uncached, exhibit precache semantics safe.');
})().catch(error => { console.error(error); process.exitCode = 1; });
