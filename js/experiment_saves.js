/* Player-facing experiment records. Each saved experiment points to an isolated
 * IndexedDB Run; we never reserialize or replace existing evolution genomes. */
(() => {
  'use strict';
  // Exhibition kiosk has independent visitor progression and administrator backup.
  if (location.pathname.includes('/exhibit/')) return;
  const engine = window.GitaiPagesPreview;
  const portal = document.getElementById('entertainmentPortal');
  if (!engine || !portal || engine.context?.evolutionModelId !== 'continuous_v1') return;

  // Canonical registry transactions run in experiment_registry.js. The old
  // localStorage v1 JSON remains untouched as a last-resort migration backup.
  const registry = window.GitaiExperimentRegistry;
  if (!registry) {
    console.error('保存一覧の安全な読み書き機能を読み込めませんでした。');
    return;
  }
  const LIMIT = 10;
  const context = engine.context;
  const params = new URLSearchParams(location.search);
  const warning = params.get('experiment') === 'warning_color';
  const modeLabel = warning ? '目立つギタイ' : '隠れるギタイ';
  const dbName = context.storageNamespace;

  function readRegistry() { return registry.snapshot(); }
  function currentRecord() {
    return readRegistry().find(item => item.dbName === dbName) || null;
  }
  // These URL-only gameplay overrides are not part of the evolution genome
  // or storage namespace. Persist valid effective overrides with each record
  // so resumed experiments do not silently change their play conditions.
  function effectivePlayOverrides(config) {
    const rawSeconds = config?.seconds;
    const seconds = rawSeconds == null || String(rawSeconds).trim() === ''
      ? NaN : Number(rawSeconds);
    if (Number.isFinite(seconds) && seconds >= 0.5 && seconds <= 10) {
      return {seconds: String(seconds), fast: ''};
    }
    return {seconds: '', fast: config?.fast === '1' ? '1' : ''};
  }
  function configFromPage() {
    const overrides = effectivePlayOverrides({
      seconds: params.get('seconds'), fast: params.get('fast')
    });
    const life = params.get('life');
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
      slot: params.get('slot') || '',
      ...overrides,
      // The life override is meaningful only in the warning fog-v2 run.
      life: warning && params.get('run') === 'warning_color_fog_v2'
        && (life === '0' || life === '1') ? life : ''
    };
  }
  function urlFor(config) {
    const u = new URL(location.pathname, location.origin);
    for (const name of ['env', 'model', 'run', 'experiment', 'fog', 'slot']) {
      if (config[name]) u.searchParams.set(name, config[name]);
    }
    const overrides = effectivePlayOverrides(config);
    if (overrides.seconds) u.searchParams.set('seconds', overrides.seconds);
    else if (overrides.fast) u.searchParams.set('fast', overrides.fast);
    if (config.experiment === 'warning_color'
        && config.run === 'warning_color_fog_v2'
        && (config.life === '0' || config.life === '1')) {
      u.searchParams.set('life', config.life);
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
    return /^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(id)) ? '第' + Number(id.slice(3)) + '世代' : '世代不明';
  }
  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      let absent = false;
      let blocked = false;
      req.onupgradeneeded = () => {
        absent = true;
        req.transaction.abort(); // Never create a blank saved experiment.
      };
      req.onerror = () => reject(absent ? Error('保存された実験データが見つかりません。') : req.error);
      req.onblocked = () => {
        // STO-04: an IndexedDB open cannot be cancelled after onblocked.
        // The request can still succeed when another tab closes. In that
        // case, close the late connection; otherwise it leaks a connection
        // that can block future experiment deletion/reset.
        blocked = true;
        reject(Error('別のタブで使用中です。ゲーム画面を閉じて再試行してください。'));
      };
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) {
          db.close();
          return;
        }
        resolve(db);
      };
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
        req.onsuccess = () => /^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(req.result))
          ? resolve(req.result) : reject(Error('世代情報がありません。'));
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  // Experiment controls belong ONLY to the completed-generation result panel.
  // The title / mode-selection menu remains dedicated to choosing play modes.
  const theaterButton = document.getElementById('theaterButton');
  const reviewOverlay = document.getElementById('reviewOverlay');
  if (!theaterButton || !reviewOverlay) return;
  const actions = document.createElement('div');
  actions.className = 'gitai-experiment-result-actions';
  actions.innerHTML =
    '<button type="button" id="gitaiOpenRecords">実験記録（0/10）</button>' +
    '<button type="button" id="gitaiResultStartNew">最初から実験</button>';
  theaterButton.insertAdjacentElement('afterend', actions);
  const recordsButton = actions.querySelector('#gitaiOpenRecords');
  const startButton = actions.querySelector('#gitaiResultStartNew');
  const gallerySaveButton = document.getElementById('evolutionSaveExperimentButton');
  const galleryResetButton = document.getElementById('evolutionResetExperimentButton');
  const gallerySaveAndResetButton = document.getElementById('evolutionSaveAndResetExperimentButton');

  // A browser reload in the middle of a generation returns to the same
  // "はじめる" overlay. Give the player access to the existing safe
  // save/reset flows BEFORE playing another round, without exposing controls
  // on the mode picker, education model, or exhibition kiosk.
  const introStartButton = document.getElementById('startButton');
  const introOverlay = document.getElementById('startOverlay');
  let introSaveAndResetButton = null;
  let introResetButton = null;
  if (introOverlay && introStartButton) {
    const introActions = document.createElement('div');
    introActions.className = 'gitai-experiment-start-actions';
    introActions.setAttribute('role', 'group');
    introActions.setAttribute('aria-label', '実験の保存と初期化');
    introSaveAndResetButton = document.createElement('button');
    introSaveAndResetButton.id = 'gitaiIntroSaveAndReset';
    introSaveAndResetButton.type = 'button';
    introSaveAndResetButton.textContent = '保存して初期化';
    introResetButton = document.createElement('button');
    introResetButton.id = 'gitaiIntroResetWithoutSave';
    introResetButton.type = 'button';
    introResetButton.textContent = '保存せずに初期化';
    introActions.appendChild(introSaveAndResetButton);
    introActions.appendChild(introResetButton);
    introStartButton.insertAdjacentElement('afterend', introActions);
    const syncIntroReady = () => {
      const ready = !introStartButton.disabled;
      introSaveAndResetButton.disabled = !ready;
      introResetButton.disabled = !ready;
    };
    // The engine enables its start button only after loading generation data.
    // Handle both the regular ready event and the case it already fired.
    window.addEventListener('gitai:solo-assets-ready', syncIntroReady);
    syncIntroReady();
  }

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
  // Invalidate an old async records refresh on close or a newer refresh.
  let recordsRequestSerial = 0;

  function updateGallerySaveButton() {
    if (!gallerySaveButton) return;
    const saved = Boolean(currentRecord());
    gallerySaveButton.hidden = false;
    gallerySaveButton.disabled = saved;
    gallerySaveButton.classList.toggle('is-saved', saved);
    gallerySaveButton.textContent = saved ? '✓ 実験保存済み' : '実験を保存';
    if (galleryResetButton) galleryResetButton.hidden = false;
    if (gallerySaveAndResetButton) gallerySaveAndResetButton.hidden = false;
  }
  function updateCounter() {
    recordsButton.textContent = '実験記録（' + readRegistry().length + '/10）';
    updateGallerySaveButton();
  }
  function openModal() {
    message.textContent = '';
    close.textContent = 'キャンセル・戻る';
    dialog.hidden = false;
    close.focus({preventScroll: true});
  }
  function closeModal() {
    if (busy) return;
    recordsRequestSerial += 1;
    dialog.hidden = true;
    close.textContent = 'キャンセル・戻る';
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
    // Re-read the canonical index; display snapshots from another tab may
    // have become stale while a generation was played.
    await registry.refresh();
    const existing = currentRecord();
    if (existing) return existing;
    // Verify actual saved evolution (60 PNGs and genomes) FIRST. Registry
    // writes are serialized in the separate v2 IDB state transaction.
    const state = await engine.getSaveState();
    const records = readRegistry();
    const record = {
      id: newId(), dbName,
      name: String(title || defaultTitle(records.length + 1)).trim().slice(0, 40),
      config: configFromPage(),
      createdAt: new Date().toISOString(),
      savedGeneration: state.generationId
    };
    if (!record.name) record.name = defaultTitle(records.length + 1);
    const committed = await registry.mutate('add', record);
    updateCounter();
    return committed;
  }
  async function showSaveCurrent() {
    await registry.refresh();
    heading.textContent = '実験を保存';
    entries.replaceChildren();
    const saved = currentRecord();
    if (saved) {
      summary.textContent = 'この実験は「' + saved.name
        + '」として登録済みです。次の世代も自動保存されます。';
      entries.appendChild(makeButton('実験記録を見る', showRecords));
      openModal();
      return;
    }
    const count = readRegistry().length;
    if (count >= LIMIT) {
      summary.textContent = '保存できる実験は10件までです。'
        + '保存するには実験記録から不要な実験を削除してください。';
      entries.appendChild(makeButton('実験記録を見る', showRecords));
      openModal();
      return;
    }
    summary.textContent = 'この進化を記録に残します。以後も世代が進むたびに自動保存されます。'
      + '保存後も、今の画面からそのままプレイできます。';
    const label = document.createElement('label');
    label.textContent = '実験の名前';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = defaultTitle(count + 1);
    label.appendChild(input);
    entries.appendChild(label);
    entries.appendChild(makeButton('この実験を保存', async () => {
      const record = await registerCurrent(input.value);
      heading.textContent = '保存しました';
      summary.textContent = '「' + record.name
        + '」として保存しました。これからも世代更新ごとに自動保存されます。'
        + 'この画面に戻って続きをプレイできます。';
      entries.replaceChildren();
      message.textContent = '実験を保存しました。';
      // This is the normal close button, not an action wrapped by perform():
      // the latter runs with busy=true and cannot call closeModal() directly.
      close.textContent = '閉じてプレイを続ける';
      close.focus({preventScroll: true});
    }, 'gitai-primary'));
    openModal();
  }

  function freshUrl() {
    const config = configFromPage();
    // A reset always starts in a NEW storage namespace, even when the existing
    // experiment is saved or its slot name coincides with a prior record.
    const occupied = new Set([
      config.slot,
      ...readRegistry().map(record => record.config.slot)
    ].filter(Boolean));
    do { config.slot = newId(); } while (occupied.has(config.slot));
    return urlFor(config);
  }
  async function discardUnregisteredAndStart(preserveCurrent = false) {
    await registry.refresh();
    // Resolve the target before touching any data. For a registered Run, keep
    // its IndexedDB and registry entry intact; only unregistered Runs are discarded.
    // The preserve flag also protects a Run saved when the confirmation opened,
    // even if another tab changes the registry before the user accepts.
    const nextUrl = freshUrl();
    if (!preserveCurrent && !currentRecord()) await engine.discardCurrentRun();
    location.assign(nextUrl);
  }
  async function saveAndStart(title) {
    await registry.refresh();
    const nextUrl = freshUrl();
    // Verify the full saved generation, persist the registry, and re-read it
    // BEFORE navigating. A failed save must never initialize a new Run.
    const record = await registerCurrent(title);
    const state = await engine.getSaveState();
    if (!currentRecord() || await storedGeneration(record.dbName) !== state.generationId)
      throw Error('保存した実験の世代情報を確認できませんでした。初期化は行っていません。');
    location.assign(nextUrl);
  }
  function appendSaveAndStartAction() {
    const saved = currentRecord();
    if (saved) {
      entries.appendChild(makeButton('保存記録を残して新しい実験へ', () => saveAndStart(), 'gitai-primary'));
      return;
    }
    const count = readRegistry().length;
    if (count >= LIMIT) {
      const p = document.createElement('p');
      p.textContent = '10件保存済みです。保存枠が満杯のため、保存して初期化はできません。実験記録から不要な実験を削除してください。';
      entries.appendChild(p);
      entries.appendChild(makeButton('実験記録を見る', showRecords));
      return;
    }
    const label = document.createElement('label');
    label.textContent = '保存する実験の名前';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = defaultTitle(count + 1);
    label.appendChild(input);
    entries.appendChild(label);
    entries.appendChild(makeButton('保存して新しい実験を開始', () => saveAndStart(input.value), 'gitai-primary'));
  }
  function appendResetAction() {
    const saved = currentRecord();
    entries.appendChild(makeButton('実験を初期化する', async () => {
      const confirmText = saved
        ? '現在の実験「' + saved.name + '」は保存記録に残します。\\n同じモード・背景で新しい実験を始めますか？'
        : '現在の未登録実験の進化データを消去して、同じモード・背景で新しい実験を始めますか？\\n消去した進化は元に戻せません。';
      if (!window.confirm(confirmText)) return;
      await discardUnregisteredAndStart(Boolean(saved));
    }, 'gitai-danger'));
  }
  async function showResetCurrent() {
    await registry.refresh();
    const saved = currentRecord();
    heading.textContent = '実験を初期化';
    summary.textContent = saved
      ? '現在の実験「' + saved.name + '」は保存済みです。保存記録と進化データを保持し、同じモード・背景で新しい実験を始めます。'
      : '現在の未登録実験を初期化します。進化データは削除され、元に戻せません。保存済みの別の実験や標本箱は消えません。';
    entries.replaceChildren();
    appendResetAction();
    openModal();
  }
  async function showSaveAndStart() {
    await registry.refresh();
    const saved = currentRecord();
    heading.textContent = '保存して実験を初期化';
    summary.textContent = saved
      ? '現在の実験「' + saved.name + '」を保存したまま、新しい実験を同じモード・背景で始めます。重複登録はしません。'
      : '現在の進化を実験記録に登録し、保存を確認してから同じモード・背景で新しい実験を始めます。保存に失敗した場合、初期化は行いません。';
    entries.replaceChildren();
    appendSaveAndStartAction();
    openModal();
  }
  async function showStartNew() {
    await registry.refresh();
    const saved = currentRecord();
    heading.textContent = '最初から実験';
    summary.textContent = saved
      ? '現在の実験は保存済みです。記録を残したまま新しい実験を始められます。'
      : 'プレイ中の実験は自動保存されています。記録に登録して残すか、未登録の進化データを消去するか選んでください。';
    entries.replaceChildren();
    appendSaveAndStartAction();
    appendResetAction();
    openModal();
  }

  // Deletion requests do NOT stop after IndexedDB reports "blocked".
  // The browser still holds the request open, and may complete deletion
  // after a second tab closes. Do not reject early and leave a stale entry
  // for a database that was actually deleted.
  let pendingDeletion = false;
  window.addEventListener('beforeunload', event => {
    if (!pendingDeletion) return;
    // Browsers may ignore this prompt; the main protection is keeping the
    // request pending and updating the registry only after actual success.
    event.preventDefault();
    event.returnValue = '';
  });
  async function deleteSavedRecord(record) {
    if (record.dbName === dbName) throw Error('現在開いている実験は削除できません。先に別の実験に切り替えてください。');
    if (!window.confirm('「' + record.name + '」の進化データと進化シアターを完全に削除しますか？\nこの操作は元に戻せません。')) return;
    pendingDeletion = true;
    try {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(record.dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || Error('実験データを削除できませんでした。'));
        request.onblocked = () => {
          // "blocked" is only a notification, not a terminal failure.
          // Remain busy/disable buttons until the request succeeds or fails.
          message.textContent = '別のタブでこの実験が使用中です。'
            + 'そのタブを閉じると削除が続行されます。'
            + 'この画面は削除完了まで閉じないでください。';
        };
      });
      // Only an ACTUAL successful IDB deletion may remove the registry entry.
      // Also scope cleanup by ID AND database, so a stale panel cannot remove
      // a different record that reused the same ID after another tab edited it.
      try { localStorage.removeItem('gitai-warning-life-v1:' + record.dbName); } catch (_) {}
      await registry.mutate('remove',record);
      await showRecords();
      message.textContent = '実験データを削除しました。';
    } finally {
      pendingDeletion = false;
    }
  }
  async function renameSavedRecord(record) {
    const next = window.prompt('実験の名前を変更', record.name);
    if (next === null) return;
    const name = next.trim().slice(0, 40);
    if (!name) throw Error('実験名を入力してください。');
    await registry.mutate('rename',{id: record.id,dbName:record.dbName,name});
    await showRecords();
  }
  async function showRecords() {
    const request = ++recordsRequestSerial;
    try { await registry.refresh(); }
    catch (error) {
      if (request !== recordsRequestSerial) return;
      throw error;
    }
    if (request !== recordsRequestSerial) return;
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
  // A registry initialization/migration error must not open a destructive
  // action with an empty-looking slot list. Show an explicit fail-closed UI.
  async function safelyOpen(action) {
    try { await action(); }
    catch (error) {
      heading.textContent = '保存一覧を確認できません';
      summary.textContent = '元の保存記録を保護しています。実験の保存・初期化は行っていません。';
      entries.replaceChildren();
      openModal();
      message.textContent = '操作できません：' + (error?.message || error);
    }
  }
  recordsButton.addEventListener('click', () => { void safelyOpen(showRecords); });
  startButton.addEventListener('click', () => { void safelyOpen(showStartNew); });
  gallerySaveButton?.addEventListener('click', () => { void safelyOpen(showSaveCurrent); });
  galleryResetButton?.addEventListener('click', () => { void safelyOpen(showResetCurrent); });
  gallerySaveAndResetButton?.addEventListener('click', () => { void safelyOpen(showSaveAndStart); });
  introSaveAndResetButton?.addEventListener('click', () => { void safelyOpen(showSaveAndStart); });
  introResetButton?.addEventListener('click', () => { void safelyOpen(showResetCurrent); });
  registry.subscribe(() => {
    updateCounter();
    if (!busy && !dialog.hidden && heading.textContent === '実験記録') {
      void showRecords().catch(console.warn);
    }
  });
  // The player can continue evolving offline even if the registry is
  // temporarily unavailable, but registration/reset controls fail closed.
  void registry.ready().then(updateCounter).catch(error => {
    recordsButton.textContent = '実験記録（確認が必要）';
    console.warn('保存一覧を確認できません',error);
  });
  close.addEventListener('click', closeModal);
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); closeModal(); }
  });
  // Existing external reset requests now open the same safe player-facing flow.
  window.GitaiExperimentSaves = Object.freeze({
    openStart: showStartNew,
    openRecords: () => safelyOpen(showRecords)
  });
  updateCounter();
})();
