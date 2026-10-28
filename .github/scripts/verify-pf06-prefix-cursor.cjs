'use strict';
// PF06: run the production prefix-reader with an IndexedDB cursor simulator.
// Preserve order, exact keys and abort semantics; never delete old records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/pages_preview.js', 'utf8');
const begin = source.indexOf('  async function idbEntriesByPrefix(storeName, prefix) {');
const end = source.indexOf('  function diagnosticKey(', begin);
assert.ok(begin >= 0 && end > begin, 'production prefix reader missing');
const actual = source.slice(begin, end);
assert.match(actual, /transaction\(storeName, 'readonly'\)/);
assert.doesNotMatch(actual, /\.put\(|\.delete\(|\.clear\(/);

function makeFixture(records, outcome = 'ok') {
  let visited = 0, opened = 0, writes = 0, rangeUsed;
  const sorted = records.slice().sort((a, b) => String(a.key).localeCompare(String(b.key), 'en'));
  const db = {
    transaction(name, mode) {
      assert.equal(mode, 'readonly', 'must never write or upgrade existing DB');
      assert.equal(name, 'meta');
      const tx = {
        error: null, oncomplete: null, onabort: null, onerror: null,
        objectStore(store) {
          assert.equal(store, name);
          return {
            openCursor(range) {
              opened += 1;
              rangeUsed = range;
              const matching = sorted.filter(item => !range ||
                (item.key >= range.lower && item.key <= range.upper));
              const request = {result: null, error: null, onsuccess: null};
              let ix = 0;
              function advance() {
                queueMicrotask(() => {
                  if (outcome !== 'ok') {
                    tx.error = Error('simulated ' + outcome);
                    if (outcome === 'abort') tx.onabort();
                    else tx.onerror();
                    return;
                  }
                  if (ix >= matching.length) {
                    request.result = null;
                    request.onsuccess();
                    queueMicrotask(() => tx.oncomplete());
                    return;
                  }
                  const item = matching[ix++];
                  visited += 1;
                  request.result = {
                    key: item.key,
                    value: item.value,
                    continue: advance
                  };
                  request.onsuccess();
                });
              }
              advance();
              return request;
            },
            put() {writes++; throw Error('write forbidden');},
            delete() {writes++; throw Error('delete forbidden');},
            clear() {writes++; throw Error('clear forbidden');}
          };
        }
      };
      return tx;
    }
  };
  const bounds = [];
  const ctx = {
    Promise, Error, String,
    openDb: async () => db,
    IDBKeyRange: {
      bound: (lower, upper) => {
        bounds.push([lower, upper]);
        return {lower, upper};
      }
    }
  };
  vm.runInNewContext(actual + '\nglobalThis.read = idbEntriesByPrefix;',
    ctx, {timeout: 4000});
  return {read: ctx.read, stats: () => ({visited, opened, writes, rangeUsed, bounds})};
}

(async () => {
  const records = [
    ...Array.from({length: 3000}, (_, i) => ({
      key: 'genome:gen' + String(i).padStart(5, '0') + ':01',
      value: {irrelevant: i}
    })),
    ...Array.from({length: 100}, (_, i) => ({
      key: 'diagnostic:gen' + String(i + 1).padStart(5, '0'),
      value: {generation: i + 1}
    })),
    {key: 'diagnostic:gen100000', value: {generation: 100000}},
    {key: 'diagnostic:legacy:key', value: {generation: -1}},
    {key: 'warningLife', value: 'unrelated'},
    {key: 'meta', value: 'unrelated'},
    {key: 'gen00001', value: 'unrelated'}
  ];
  const fixture = makeFixture(records);
  const found = await fixture.read('meta', 'diagnostic:');
  const expected = records
    .filter(record => record.key.startsWith('diagnostic:'))
    .sort((a, b) => String(a.key).localeCompare(String(b.key), 'en'));
  assert.equal(found.length, expected.length);
  assert.deepEqual(Array.from(found, x => x.key), expected.map(x => x.key));
  assert.deepEqual(Array.from(found, x => x.value.generation),
    expected.map(x => x.value.generation));
  assert.equal(fixture.stats().visited, expected.length,
    'must not visit 3000 unrelated genome entries');
  assert.deepEqual(fixture.stats().bounds, [['diagnostic:', 'diagnostic:\uffff']]);
  assert.equal(fixture.stats().writes, 0);

  const theater = makeFixture([
    {key: 'gen00001', value: {n:1}},
    {key: 'gen99999', value: {n:99999}},
    {key: 'gen100000', value: {n:100000}},
    {key: 'another:key', value: {}},
    {key: 'legacy', value: {}}
  ]);
  assert.deepEqual(Array.from(await theater.read('meta', 'gen'), x => x.key),
    ['gen00001', 'gen100000', 'gen99999']);
  assert.equal(theater.stats().visited, 3);

  // Preserve the original full-scan behavior for a caller without a prefix.
  const full = makeFixture([{key:'alpha',value:1},{key:'zulu',value:2}]);
  assert.deepEqual(Array.from(await full.read('meta', ''), x => x.key),
    ['alpha', 'zulu']);
  assert.equal(full.stats().rangeUsed, null);
  for (const failure of ['abort','error']) {
    await assert.rejects(makeFixture(records, failure).read('meta','diagnostic:'),
      new RegExp('simulated ' + failure));
  }
  console.log('PF06: bounded cursor preserves legacy records, order, readonly safety, empty prefix and transaction failures.');
})().catch(error => {console.error(error);process.exitCode = 1;});
