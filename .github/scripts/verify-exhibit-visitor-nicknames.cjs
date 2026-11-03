'use strict';
// Synthetic, offline-only contract test for exhibit nicknames. Never opens
// a user's IndexedDB, modifies generations or requires an iPad.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = process.argv[2] || '_site';
const exhibit = path.join(site, 'exhibit');
const read = p => fs.readFileSync(path.join(exhibit, p), 'utf8');
const theater = read('theater_canvas_20261026.js');
const mode = read('modes.html');
const stylesheet = read('theater_canvas_20261026.css');
const exhibitEngine = read('js/pages_preview.js');
const publicEngine = fs.readFileSync('js/pages_preview.js', 'utf8');
const admin = read('admin.js');

assert.match(mode, /id="exhibitVisitorNickname"[^>]*maxlength="24"/);
assert.match(mode, /aria-describedby="exhibitVisitorNicknameStatus"/);
assert.match(mode, /入力名はiPadとバックアップに残ります。空欄は匿名。/);
assert.match(theater, /入力名はiPadとバックアップに残ります。空欄は匿名。/);
assert.ok(mode.indexOf('id="exhibitVisitorNickname"') <
  mode.indexOf('id="exhibitHandoverFinishNext"'),
  'left nickname field must precede right handover CTA');
assert.match(stylesheet, /\.exhibit-visitor-nickname\{/);
assert.match(stylesheet, /#exhibitHandoverFinishNext\{[^}]*margin-inline-start:auto/);
assert.match(theater, /const NAME_PREFIX = 'exhibit_visitor_nickname_v1:';/);
assert.match(theater, /metaStore\.openCursor\(IDBKeyRange\.bound\(NAME_PREFIX,/);
assert.match(theater, /entry\.key === NAME_PREFIX \+ 'gen' \+ String\(value\.end\)\.padStart\(5, '0'\)/);
assert.match(theater, /db\.transaction\('meta', 'readwrite'\)/);
assert.match(theater, /store\.add\(\{ schema: 1, start: handover\.start/);
assert.doesNotMatch(theater, /store\.put\(\{ schema: 1, start: handover\.start/);
assert.match(theater, /current\.result !== nextId/);
assert.doesNotMatch(theater, /deleteDatabase\(|objectStore\(['"]images['"]\).*clear\(/);
assert.match(theater, /picture\.drawImage\(bitmap, 310, 50, 230, 40, 0, 50, 230, 40\)/);
assert.match(publicEngine, /ctx\.fillText\(\s*theaterModelLabel\(\),\s*22,\s*68,/);
assert.doesNotMatch(exhibitEngine, /ctx\.fillText\(\s*theaterModelLabel\(\),\s*22,\s*68,/,
  'exhibit must not bake obsolete label into NEW cached frames');
assert.match(admin, /const STORES = \['images', 'meta', 'theater_frames'\]/,
  'v1 JSON backup includes the unmodified meta store');
assert.match(admin, /snapshotStores\(db\)/);
assert.match(admin, /validateBackup\(raw, selected\)/);

const start = theater.indexOf('  function normalizeVisitorName(raw) {');
const finish = theater.indexOf('  async function refreshGenerations()', start);
assert.ok(start > 0 && finish > start, 'test must exercise the actual shipped functions');
const executable = theater.slice(start, finish);
const state = new Map([['current_generation_id', 'gen00006']]);
const writes = [];
let closes = 0;
let failNextAdd = false;
function fakeDb() {
  return {
    version: 2,
    objectStoreNames: { contains(name) { return name === 'meta'; } },
    close() { closes++; },
    transaction(scope, mode) {
      assert.equal(scope, 'meta');
      assert.equal(mode, 'readwrite');
      let aborted = false;
      const transaction = {
        objectStore(name) {
          assert.equal(name, 'meta');
          return {
            get(key) {
              const request = {};
              queueMicrotask(() => {
                request.result = state.get(key);
                request.onsuccess?.();
                queueMicrotask(() => { if (!aborted) transaction.oncomplete?.(); });
              });
              return request;
            },
            add(value, key) {
              assert.equal(aborted, false);
              const req = {};
              if (state.has(key) || failNextAdd) {
                const errorName=failNextAdd?'QuotaExceededError':'ConstraintError';
                failNextAdd = false;
                queueMicrotask(() => {
                  req.error = Object.assign(new Error(errorName),{name:errorName});
                  req.onerror?.();
                  transaction.abort();
                });
              } else {
                state.set(key, value);
                writes.push(key);
              }
              return req;
            }
          };
        },
        abort() {
          aborted = true;
          queueMicrotask(() => transaction.onabort?.());
        }
      };
      return transaction;
    }
  };
}
const sandbox = {
  MODES: { cryptic: { db: 'synthetic-cryptic' } },
  NAME_PREFIX: 'exhibit_visitor_nickname_v1:',
  openExisting: async () => fakeDb(),
  nicknameInput: { value: '' },
  visitorRecords: [],
  handoverData: null,
  playedLabel: { textContent: '', hidden: false },
  queueMicrotask
};
vm.runInNewContext(executable + '\n' +
  'globalThis.unit = { normalizeVisitorName, badgeForGeneration, renderBadge, saveVisitorName };',
  sandbox, { timeout: 3000, filename: 'exhibit/theater_canvas_20261026.js:nickname' });

(async () => {
  const api = sandbox.unit;
  assert.equal(api.normalizeVisitorName('  テスター  '), 'テスター');
  assert.equal(api.normalizeVisitorName(''), '');
  assert.throws(() => api.normalizeVisitorName('a'.repeat(13)), /12文字/);
  assert.throws(() => api.normalizeVisitorName('<b>'), /12文字/);
  await api.saveVisitorName('cryptic', { start: 1, end: 5 }, 'テスター');
  const key = 'exhibit_visitor_nickname_v1:gen00005';
  assert.equal(state.get(key).schema, 1);
  assert.equal(state.get(key).start, 1);
  assert.equal(state.get(key).end, 5);
  assert.equal(state.get(key).name, 'テスター');
  assert.deepEqual(writes, [key], 'one metadata entry only');
  assert.equal(closes, 1);

  // A second tap after a BFCache/back navigation must NOT overwrite the name
  // of the original visitor, even if the current generation did not change.
  await assert.rejects(
    api.saveVisitorName('cryptic', { start: 1, end: 5 }, '別の名前'),
    /この世代の参加者名は登録済み/);
  assert.equal(state.get(key).name,'テスター');
  assert.deepEqual(writes,[key]);
  assert.equal(closes,2);

  // A stale handover must NOT write a nickname or affect existing entries.
  state.set('current_generation_id', 'gen00008');
  await assert.rejects(
    api.saveVisitorName('cryptic', { start: 6, end: 6 }, '次の人'),
    /別の画面で世代が変更/);
  assert.deepEqual(writes, [key]);
  assert.equal(closes, 3);
  // Storage full is not a duplicate name. Do not mislead the visitor and do
  // not permit a navigation that falsely suggests the name was recorded.
  state.set('current_generation_id','gen00007');
  failNextAdd = true;
  await assert.rejects(
    api.saveVisitorName('cryptic', { start: 6, end: 6 }, '容量試験'),
    /保存できませんでした（QuotaExceededError）/);
  assert.equal(writes.length,1);
  assert.equal(closes,4);
  await api.saveVisitorName('cryptic', { start: 1, end: 5 }, '');
  assert.deepEqual(writes, [key], 'anonymous handover has no DB write');

  sandbox.visitorRecords = [{start:1,end:5,name:'テスター'}];
  assert.equal(api.badgeForGeneration(3), '参加：テスター');
  assert.equal(api.badgeForGeneration(7), '');
  sandbox.handoverData = {start:6,end:7};
  assert.equal(api.badgeForGeneration(6), 'あなたのプレイ');
  sandbox.nicknameInput.value = 'クワガタ';
  api.renderBadge(6);
  assert.equal(sandbox.playedLabel.textContent, '参加：クワガタ');
  assert.equal(sandbox.playedLabel.hidden, false);
  console.log('Exhibit nickname: read-only theater, write-once meta, no BFCache overwrite, quota rejection, anonymous skip, stale rejection, preview, backup inclusion, public isolation OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
