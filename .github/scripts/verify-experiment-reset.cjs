// Self-contained regression tests: no browser/IndexedDB data is touched.
// Run with: node .github/scripts/verify-experiment-reset.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/experiment_saves.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/experiment_saves.css', 'utf8');
const gallery = html.match(/<div class="evolution-quick-actions">([\s\S]*?)<\/div>/);
assert.ok(gallery, 'generation gallery actions must exist');
assert.deepEqual(
  Array.from(gallery[1].matchAll(/id="([^"]+)"/g), m => m[1]),
  ['evolutionSpecimenButton', 'evolutionNextButton',
    'evolutionSaveExperimentButton', 'evolutionResetExperimentButton',
    'evolutionSaveAndResetExperimentButton']
);
assert.match(css, /#evolutionResetExperimentButton[\s\S]*?min-height:\s*48px/);
assert.match(css, /#startOverlay \.gitai-experiment-start-actions/);
assert.match(html, /id="startOverlay"[\s\S]*?id="startButton"/);

class Element {
  constructor(tag, id = '') {
    this.tag = tag;
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.selectors = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.classList = { toggle() {} };
  }
  set innerHTML(value) {
    this.html = value;
    if (value.includes('gitaiOpenRecords')) {
      this.selectors['#gitaiOpenRecords'] = new Element('button');
      this.selectors['#gitaiResultStartNew'] = new Element('button');
    }
    if (value.includes('gitaiExperimentHeading')) {
      for (const id of ['gitaiExperimentHeading', 'gitaiExperimentSummary',
        'gitaiExperimentEntries', 'gitaiExperimentMessage', 'gitaiExperimentClose']) {
        this.selectors['#' + id] = new Element(
          id === 'gitaiExperimentEntries' ? 'div' : 'button', id
        );
      }
    }
  }
  querySelector(selector) { return this.selectors[selector] || null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.tag === selector) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  appendChild(el) { this.children.push(el); return el; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  insertAdjacentElement(_, element) { this.after = element; }
  focus() {}
  setAttribute() {}
  removeAttribute() {}
  click() {
    if (this.disabled) return;
    for (const cb of this.listeners.click || []) cb({
      preventDefault() {}, stopPropagation() {}
    });
  }
}

const KEY = 'gitai-experiment-records-v1';
function build({ warning = false, saved = false, others = 0, failSave = false } = {}) {
  const elements = {};
  for (const id of ['entertainmentPortal', 'theaterButton', 'reviewOverlay',
    'startOverlay', 'startButton',
    'evolutionSaveExperimentButton', 'evolutionResetExperimentButton',
    'evolutionSaveAndResetExperimentButton']) {
    elements[id] = new Element('button', id);
  }
  elements.startButton.disabled = true; // generation data is still loading
  const document = {
    getElementById: id => elements[id] || null,
    createElement: tag => new Element(tag),
    body: new Element('body')
  };
  const config = {
    env: 'kusagi_001', model: 'continuous_v1',
    run: warning ? 'warning_color_v6' : 'default',
    experiment: warning ? 'warning_color' : '',
    fog: '', slot: 'exp_current'
  };
  const makeRecord = (n, name) => ({
    id: 'exp_saved' + n, name: 'Saved ' + n, dbName: name,
    config: { ...config, slot: 'exp_saved' + n },
    createdAt: '2026-10-22T00:00:00Z', savedGeneration: 'gen00021'
  });
  const records = Array.from({length: others}, (_, n) => makeRecord(n, 'db-other-' + n));
  if (saved) records.push(makeRecord(99, 'db-current'));
  const store = new Map([[KEY, JSON.stringify({ version: 1, records })]]);
  const localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };
  const databases = new Map([['db-current', {generation: 'gen00021'}]]);
  for (let i = 0; i < others; i++) databases.set('db-other-' + i, {generation: 'gen00021'});
  const deleted = [], navigated = [];
  const indexedDB = {
    open(name) {
      const req = {};
      queueMicrotask(() => {
        const data = databases.get(name);
        if (!data) {
          req.transaction = {abort() {}};
          if (req.onupgradeneeded) req.onupgradeneeded();
          if (req.onerror) req.onerror();
          return;
        }
        req.result = {
          objectStoreNames: {contains: key => key === 'meta' || key === 'images'},
          transaction() {
            return {objectStore() {
              return {get() {
                const out = {};
                queueMicrotask(() => {
                  out.result = data.generation;
                  if (out.onsuccess) out.onsuccess();
                });
                return out;
              }};
            }};
          },
          close() {}
        };
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      throw Error('Unexpected deletion of saved database ' + name);
    }
  };
  const context = {environmentId: config.env, evolutionModelId: config.model, storageNamespace: 'db-current'};
  const engine = {
    context,
    getSaveState: async () => {
      if (failSave) throw Error('Simulated incomplete generation');
      return {generationId: 'gen00021'};
    },
    discardCurrentRun: async () => {
      deleted.push('db-current');
      databases.delete('db-current');
    }
  };
  let cryptoCounter = 1;
  const crypto = {
    getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = (cryptoCounter + i) % 256;
      cryptoCounter += 11;
      return bytes;
    }
  };
  const params = new URLSearchParams(config);
  const location = {
    pathname: '/Gitai_Lab_Preview/',
    origin: 'https://ganyujapan.github.io',
    search: '?' + params.toString(),
    assign: url => navigated.push(new URL(url))
  };
  const windowListeners = {};
  const window = {
    GitaiPagesPreview: engine,
    confirm: () => true,
    addEventListener(type, fn) {
      (windowListeners[type] ||= []).push(fn);
    }
  };
  vm.runInNewContext(source, {
    window, document, location, localStorage, indexedDB, crypto,
    URL, URLSearchParams, Uint8Array, Set, Date, Error
  }, {filename: 'experiment_saves.js'});
  const dialog = document.body.children[0];
  return {
    elements, dialog, entries: dialog.querySelector('#gitaiExperimentEntries'),
    status: dialog.querySelector('#gitaiExperimentMessage'),
    navigated, deleted, databases,
    getRecords: () => JSON.parse(localStorage.getItem(KEY)).records,
    introButtons: () => elements.startButton.after?.children || [],
    ready: () => {
      elements.startButton.disabled = false;
      for (const fn of windowListeners['gitai:solo-assets-ready'] || []) fn();
    },
    introClick: async index => {
      elements.startButton.after.children[index].click();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    click: async id => {
      elements[id].click();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    submit: async index => {
      dialog.querySelector('#gitaiExperimentEntries').children[index].click();
      await new Promise(resolve => setTimeout(resolve, 10));
    },
    config
  };
}
function checkNewRun(s) {
  assert.equal(s.navigated.length, 1, 'new Run should start once');
  const url = s.navigated[0];
  assert.equal(url.searchParams.get('env'), s.config.env);
  assert.equal(url.searchParams.get('run'), s.config.run);
  assert.equal(url.searchParams.get('experiment'), s.config.experiment || null);
  assert.notEqual(url.searchParams.get('slot'), s.config.slot);
}
(async () => {
  for (const warning of [false, true]) {
    const a = build({warning, others: 1});
    await a.click('evolutionResetExperimentButton');
    await a.submit(0);
    checkNewRun(a);
    assert.deepEqual(a.deleted, ['db-current']);
    assert.ok(a.databases.has('db-other-0'));
    assert.equal(a.getRecords().length, 1);

    const b = build({warning, saved: true, others: 9});
    await b.click('evolutionResetExperimentButton');
    await b.submit(0);
    checkNewRun(b);
    assert.deepEqual(b.deleted, []);
    assert.ok(b.databases.has('db-current'));
    assert.equal(b.getRecords().length, 10);

    const c = build({warning, others: 9});
    await c.click('evolutionSaveAndResetExperimentButton');
    await c.submit(1);
    checkNewRun(c);
    assert.deepEqual(c.deleted, []);
    assert.equal(c.getRecords().length, 10);
    assert.ok(c.getRecords().some(rec => rec.dbName === 'db-current'));
    assert.ok(c.databases.has('db-current'));

    const d = build({warning, others: 10});
    await d.click('evolutionSaveAndResetExperimentButton');
    assert.equal(d.entries.children.length, 2, 'full slots: warning and records link');
    assert.equal(d.navigated.length, 0);
    assert.equal(d.getRecords().length, 10);

    const e = build({warning, others: 1, failSave: true});
    await e.click('evolutionSaveAndResetExperimentButton');
    await e.submit(1);
    assert.equal(e.navigated.length, 0, 'failed save must never reset');
    assert.ok(e.databases.has('db-current'));
    assert.equal(e.getRecords().length, 1);
    assert.match(e.status.textContent, /処理できませんでした/);

    const f = build({warning, saved: true, others: 9});
    await f.click('evolutionSaveAndResetExperimentButton');
    await f.submit(0);
    checkNewRun(f);
    assert.equal(f.getRecords().length, 10, 'saved current must not be duplicated');
    assert.ok(f.databases.has('db-current'));

    // Start-overlay controls also work immediately after refreshing in the
    // middle of a generation: no round, submit, or result overlay is required.
    const introUnsaved = build({warning, others: 1});
    assert.deepEqual(introUnsaved.introButtons().map(x=>x.textContent),
      ['保存して初期化', '保存せずに初期化']);
    assert.ok(introUnsaved.introButtons().every(x=>x.disabled),
      'start reset buttons must stay disabled until generation data is ready');
    introUnsaved.ready();
    assert.ok(introUnsaved.introButtons().every(x=>!x.disabled));
    await introUnsaved.introClick(1);
    assert.equal(introUnsaved.entries.children.length,1,'discard confirmation appears without playing');
    await introUnsaved.submit(0);
    checkNewRun(introUnsaved);
    assert.deepEqual(introUnsaved.deleted,['db-current']);
    assert.ok(introUnsaved.databases.has('db-other-0'));

    const introSaved = build({warning, saved: true, others: 9});
    introSaved.ready();
    await introSaved.introClick(1);
    await introSaved.submit(0);
    checkNewRun(introSaved);
    assert.deepEqual(introSaved.deleted,[],'registered save must be preserved');
    assert.equal(introSaved.getRecords().length,10);

    const introSave = build({warning, others: 1});
    introSave.ready();
    await introSave.introClick(0);
    await introSave.submit(1);
    checkNewRun(introSave);
    assert.deepEqual(introSave.deleted,[]);
    assert.equal(introSave.getRecords().length,2);

    const introSaveFail = build({warning, others: 1, failSave: true});
    introSaveFail.ready();
    await introSaveFail.introClick(0);
    await introSaveFail.submit(1);
    assert.equal(introSaveFail.navigated.length,0,'failed save cannot reset from start overlay');
    assert.ok(introSaveFail.databases.has('db-current'));

    const introFull = build({warning, others: 10});
    introFull.ready();
    await introFull.introClick(0);
    assert.equal(introFull.entries.children.length,2);
    assert.equal(introFull.navigated.length,0);

    const g = build({warning, others: 1});
    await g.click('evolutionSaveExperimentButton');
    await g.submit(1);
    assert.equal(g.navigated.length, 0, 'plain save stays on same Run');
    assert.equal(g.getRecords().length, 2);
    assert.equal(g.elements.evolutionSaveExperimentButton.textContent, '✓ 実験保存済み');
  }
  console.log('Experiment save/reset regression scenarios: OK (both modes)');
})().catch(err => {console.error(err); process.exitCode = 1;});
