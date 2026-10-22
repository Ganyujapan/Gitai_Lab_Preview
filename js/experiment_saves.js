/* Player-facing experiment records. Each saved experiment points to an isolated
 * IndexedDB Run; we never reserialize or replace existing evolution genomes. */
(() => {
  'use strict';
  // Exhibition kiosk has independent visitor progression and administrator backup.
  if (location.pathname.includes('/exhibit/')) return;
  const engine = window.GitaiPagesPreview;
  const portal = document.getElementById('entertainmentPortal');
  if (!engine || !portal || engine.context?.evolutionModelId !== 'continuous_v1') return;

  const KEY = 'gitai-experiment-records-v1';
  const LIMIT = 10;
  const context = engine.context;
  const params = new URLSearchParams(location.search);
  const warning = params.get('experiment') === 'warning_color';
  const modeLabel = warning ? '目立つギタイ' : '隠れるギタイ';
  const dbName = context.storageNamespace;

  function readRegistry() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
      return parsed.records.filter(item =>
        item && /^[a-z0-9_-]{1,48}$/i.test(String(item.id)) &&
        typeof item.dbName === 'string' &&
        typeof item.name === 'string' &&
        item.config && typeof item.config === 'object'
      ).slice(0, LIMIT);
    } catch (_) { return []; }
  }
  function writeRegistry(records) {
    if (records.length > LIMIT) throw Error('保存できる実験は10個までです。');
    const json = JSON.stringify({version: 1, records});
    localStorage.setItem(KEY, json);
    if (localStorage.getItem(KEY) !== json) throw Error('実験記録の保存を確認できませんでした。');
  }
  function currentRecord() {
    return readRegistry().find(item => item.dbName === dbName) || null;
  }
  function configFromPage() {
    return {
      env: context.environmentId,
      model: context.evolutionModelId,
      run: warning
        ? (params.get('run') === 'warning_color_fog_v2'
          ? 'warning_color_fog_v2'
          : (params.get('fog') === '1' || params.get('run') === 'warning_color_fog_v1')
            ? 'warning_color_fog_v1' : 'warning_color_v6')
        : (params.get('run') || 'default'),
      experiment: warning ? 'warning_color' : '',
      fog: warning && (params.get('fog') === '1'
        || params.get('run') === 'warning_color_fog_v1'
        || params.get('run') === 'warning_color_fog_v2') ? '1' : '',
      slot: params.get('slot') || ''
    };
  }
  function urlFor(config) {
    const u = new URL(location.pathname, location.origin);
    for (const name of ['env', 'model', 'run', 'experiment', 'fog', 'slot']) {
      if (config[name]) u.searchParams.set(name, config[name]);
    }
    u.searchParams.set('play', '1');
    return u.toString();
  }
  function newId() {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return 'exp_' + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  function displayGeneration(id) {
    return /^gen\d{5}$/.test(String(id)) ? '第' + Number(id.slice(3)) + '世代' : '世代不明';
  }
  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      let absent = false;
      req.onupgradeneeded = () => {
        absent = true;
        req.transaction.abort(); // Never create a blank saved experiment.
      };
      req.onerror = () => reject(absent ? Error('保存された実験データが見つかりません。') : req.error);
      req.onblocked = () => reject(Error('別のタブで使用中です。'));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function storedGeneration(name) {
    const db = await openDatabase(name);
    try {
      if (!db.objectStoreNames.contains('meta') || !db.objectStoreNames.contains('images'))
        throw Error('保存データの形式が不正です。');
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get('current_generation_id');
        req.onsuccess = () => /^gen\d{5}$/.test(String(req.result))
          ? resolve(req.result) : reject(Error('世代情報がありません。'));
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  // Add real, reachable controls to the production menu, not the debug badge.
  const menuModes = portal.querySelector('.portal-modes');
  if (!menuModes) return;
  const actions = document.createElement('div');
  actions.className = 'gitai-experiment-menu-actions';
  actions.innerHTML =
    '<button type="button" id="gitaiOpenRecords">実験記録（0/10）</button>' +
    '<button type="button" id="gitaiStartNew">最初から実験</button>';
  menuModes.insertAdjacentElement('afterend', actions);
  const recordsButton = actions.querySelector('#gitaiOpenRecords');
  const startButton = actions.querySelector('#gitaiStartNew');
  const resultReturn = document.getElementById('resultBackToMenu');
  const resultNew = document.createElement('button');
  resultNew.id = 'gitaiResultStartNew';
  resultNew.type = 'button';
  resultNew.textContent = '最初から実験';
  if (resultReturn) resultReturn.insertAdjacentElement('afterend', resultNew);

  const dialog = document.createElement('section');
  dialog.id = 'gitaiExperimentDialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'gitaiExperimentHeading');
  dialog.innerHTML =
    '<div class="gitai-experiment-panel">' +
    '<h2 id="gitaiExperimentHeading">実験記録</h2>' +
    '<p id="gitaiExperimentSummary"></p>' +
    '<div id="gitaiExperimentEntries"></div>' +
    '<p id="gitaiExperimentMessage" role="status" aria-live="polite"></p>' +
    '<button type="button" id="gitaiExperimentClose">キャンセル・戻る</button>' +
    '</div>';
  document.body.appendChild(dialog);
  const heading = dialog.querySelector('#gitaiExperimentHeading');
  const summary = dialog.querySelector('#gitaiExperimentSummary');
  const entries = dialog.querySelector('#gitaiExperimentEntries');
  const message = dialog.querySelector('#gitaiExperimentMessage');
  const close = dialog.querySelector('#gitaiExperimentClose');
  let busy = false;

  function updateCounter() {
    recordsButton.textContent = '実験記録（' + readRegistry().length + '/10）';
  }
  function openModal() {
    message.textContent = '';
    dialog.hidden = false;
    close.focus({preventScroll: true});
  }
  function closeModal() {
    if (busy) return;
    dialog.hidden = true;
    entries.replaceChildren();
    updateCounter();
  }
  async function perform(action) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    close.disabled = true;
    for (const button of entries.querySelectorAll('button')) button.disabled = true;
    message.textContent = '処理中…';
    try { await action(); }
    catch (error) {
      message.textContent = '処理できませんでした：' + (error?.message || error);
    } finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      close.disabled = false;
      for (const button of entries.querySelectorAll('button')) button.disabled = false;
    }
  }
  function makeButton(label, action, style) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (style) button.className = style;
    button.addEventListener('click', () => { void perform(action); });
    return button;
  }
  function defaultTitle(n) {
    return modeLabel + ' ' + n + ' · ' + new Date().toLocaleDateString('ja-JP');
  }
  async function registerCurrent(title) {
    const existing = currentRecord();
    if (existing) return existing;
    const records = readRegistry();
    if (records.length >= LIMIT) throw Error('セーブスロットが満杯です。実験記録から不要なものを削除してください。');
    // Inspect ALL 60 images and both lineage genomes before registering.
    // A complete current generation is already auto-saved by the game engine.
    const state = await engine.getSaveState();
    const id = newId();
    const record = {
      id, dbName, name: String(title || defaultTitle(records.length + 1)).trim().slice(0, 40),
      config: configFromPage(),
      createdAt: new Date().toISOString(),
      savedGeneration: state.generationId
    };
    if (!record.name) record.name = defaultTitle(records.length + 1);
    if (records.some(item => item.id === record.id || item.dbName === record.dbName))
      throw Error('同じ実験はすでに保存されています。');
    writeRegistry([...records, record]);
    updateCounter();
    return record;
  }
  function freshUrl() {
    const config = configFromPage();
    config.slot = newId();
    return urlFor(config);
  }
  async function discardUnregisteredAndStart() {
    // Saved records must NEVER be deleted by "start new".
    if (!currentRecord()) await engine.discardCurrentRun();
    location.assign(freshUrl());
  }
  function showStartNew() {
    const alreadySaved = currentRecord();
    const count = readRegistry().length;
    heading.textContent = '最初から実験';
    summary.textContent = alreadySaved
      ? '現在の実験は記録済みです。これまでの進化は残したまま、新しい実験を始めます。'
      : 'プレイ中の実験は自動保存されています。ここで記録に残すか、消去して最初から始めるか選んでください。';
    entries.replaceChildren();
    if (!alreadySaved && count < LIMIT) {
      const label = document.createElement('label');
      label.textContent = '保存する実験の名前';
      const input = document.createElement('input');
      input.maxLength = 40;
      input.value = defaultTitle(count + 1);
      label.appendChild(input);
      entries.appendChild(label);
      entries.appendChild(makeButton('この実験を保存して最初から', async () => {
        await registerCurrent(input.value);
        location.assign(freshUrl());
      }, 'gitai-primary'));
    }
    if (!alreadySaved && count >= LIMIT) {
      const p = document.createElement('p');
      p.textContent = '10件保存済みです。保存するには、先に実験記録から1件削除してください。';
      entries.appendChild(p);
    }
    if (alreadySaved) {
      entries.appendChild(makeButton('記録を残して新しい実験へ', async () => {
        location.assign(freshUrl());
      }, 'gitai-primary'));
    } else {
      entries.appendChild(makeButton('保存せず最初から実験', async () => {
        if (!window.confirm('現在の未登録実験を消去して、新しい実験を始めますか？\n消去した進化は元に戻せません。')) return;
        await discardUnregisteredAndStart();
      }, 'gitai-danger'));
    }
    openModal();
  }

  async function deleteSavedRecord(record) {
    if (record.dbName === dbName) throw Error('現在開いている実験は削除できません。先に別の実験に切り替えてください。');
    if (!window.confirm('「' + record.name + '」の進化データと進化シアターを完全に削除しますか？\nこの操作は元に戻せません。')) return;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(record.dbName);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('別のタブで開かれているため削除できません。'));
    });
    try { localStorage.removeItem('gitai-warning-life-v1:' + record.dbName); } catch (_) {}
    writeRegistry(readRegistry().filter(x => x.id !== record.id));
    await showRecords();
  }
  async function renameSavedRecord(record) {
    const next = window.prompt('実験の名前を変更', record.name);
    if (next === null) return;
    const name = next.trim().slice(0, 40);
    if (!name) throw Error('実験名を入力してください。');
    writeRegistry(readRegistry().map(x => x.id === record.id ? {...x, name} : x));
    await showRecords();
  }
  async function showRecords() {
    heading.textContent = '実験記録';
    const records = readRegistry();
    summary.textContent = records.length + ' / 10件保存済み。保存した実験は世代更新ごとに自動保存されます。';
    entries.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p');
      empty.textContent = '保存した実験はまだありません。「最初から実験」で現在の進化を記録できます。';
      entries.appendChild(empty);
    }
    for (const record of records) {
      const card = document.createElement('article');
      card.className = 'gitai-experiment-record';
      const title = document.createElement('strong');
      title.textContent = record.name;
      card.appendChild(title);
      const detail = document.createElement('p');
      detail.textContent = (record.config.experiment === 'warning_color' ? '目立つギタイ' : '隠れるギタイ')
        + ' · ' + record.config.env + ' · 読み込み中…';
      card.appendChild(detail);
      const buttons = document.createElement('div');
      buttons.className = 'gitai-experiment-record-buttons';
      const isCurrent = record.dbName === dbName;
      const resume = makeButton(isCurrent ? 'プレイ中' : '再開する', async () => {
        if (isCurrent) { closeModal(); return; }
        await storedGeneration(record.dbName);
        location.assign(urlFor(record.config));
      }, 'gitai-primary');
      resume.disabled = isCurrent;
      buttons.appendChild(resume);
      buttons.appendChild(makeButton('名前変更', () => renameSavedRecord(record)));
      buttons.appendChild(makeButton('削除', () => deleteSavedRecord(record), 'gitai-danger'));
      card.appendChild(buttons);
      entries.appendChild(card);
      void storedGeneration(record.dbName).then(gen => {
        if (detail.isConnected) detail.textContent =
          (record.config.experiment === 'warning_color' ? '目立つギタイ' : '隠れるギタイ')
          + ' · ' + record.config.env + ' · ' + displayGeneration(gen);
      }).catch(() => { if (detail.isConnected) detail.textContent = '保存データを確認できません'; });
    }
    openModal();
    updateCounter();
  }
  recordsButton.addEventListener('click', () => { void showRecords(); });
  startButton.addEventListener('click', showStartNew);
  resultNew.addEventListener('click', showStartNew);
  close.addEventListener('click', closeModal);
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); closeModal(); }
  });
  // Existing external reset requests now open the same safe player-facing flow.
  window.GitaiExperimentSaves = Object.freeze({
    openStart: showStartNew,
    openRecords: showRecords
  });
  updateCounter();
})();
