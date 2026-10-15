/* Entertainment-only background selection and persistent trophy ledger. */
(() => {
  'use strict';
  const portal = document.getElementById('entertainmentPortal');
  const menu = document.getElementById('portalMenu');
  const rules = window.GitaiTrophyRules;
  const params = new URLSearchParams(location.search);
  if (!portal || !menu || !rules || (params.get('model') || 'continuous_v1') !== 'continuous_v1') return;

  const picker = document.createElement('section');
  picker.id = 'portalEnvironmentPicker';
  picker.className = 'portal-environments';
  picker.hidden = true;
  picker.setAttribute('role','dialog');
  picker.setAttribute('aria-modal','true');
  picker.setAttribute('aria-label','生息環境を選ぶ');
  picker.innerHTML = [
    '<div class="portal-environments-head">',
    '<button id="portalEnvironmentBack" type="button" aria-label="モード選択に戻る">←</button>',
    '<div class="portal-environments-heading"><span>[ HABITAT COLLECTION ]</span><strong>生息環境を選ぶ</strong></div>',
    '</div>',
    '<p class="portal-environments-lead">Sランク以上の蛾を標本箱に集めて、新しい環境を解放しよう。</p>',
    '<div class="portal-environments-list">',
    '<button type="button" class="portal-environment-card" data-environment="bark_001">',
    '<img src="img/backgrounds/bg_preview.svg" alt="" loading="lazy">',
    '<span class="portal-environment-info"><b>樹皮</b><small data-status="bark_001">最初から解放</small></span>',
    '<span class="portal-environment-symbol" data-symbol="bark_001">▶</span></button>',
    '<button type="button" class="portal-environment-card" data-environment="sand_001" aria-disabled="true">',
    '<img src="img/backgrounds/bg_desert_preview.svg" alt="" loading="lazy">',
    '<span class="portal-environment-info"><b>砂地</b><small data-status="sand_001">S以上の標本 0 / 1</small><span class="portal-trophy-meter"><i data-meter="sand_001"></i></span></span>',
    '<span class="portal-environment-symbol" data-symbol="sand_001">🔒</span></button>',
    '<button type="button" class="portal-environment-card portal-environment-future" data-environment="future_001" aria-disabled="true">',
    '<span class="portal-environment-unknown" aria-hidden="true">?</span>',
    '<span class="portal-environment-info"><b>？？？</b><small data-status="future_001">S以上の標本 0 / 10</small><span class="portal-trophy-meter"><i data-meter="future_001"></i></span></span>',
    '<span class="portal-environment-symbol" data-symbol="future_001">🔒</span></button>',
    '</div>',
    '<p id="portalEnvironmentFeedback" class="portal-environment-feedback" aria-live="polite">ランクの判定基準を調整中です。</p>',
    '<p id="portalTrophyTotal" class="portal-environment-total">トロフィー：0個体</p>',
  ].join('');
  menu.appendChild(picker);

  const feedback = picker.querySelector('#portalEnvironmentFeedback');
  const total = picker.querySelector('#portalTrophyTotal');
  const back = picker.querySelector('#portalEnvironmentBack');
  const cards = Array.from(picker.querySelectorAll('[data-environment]'));
  let state = rules.normalize(null);
  let choose = null;
  let opened = 0;

  function readState() {
    try { return rules.normalize(JSON.parse(localStorage.getItem(rules.STORAGE_KEY))); }
    catch (_) { return rules.normalize(state); }
  }
  function store(next) {
    state = next;
    try { localStorage.setItem(rules.STORAGE_KEY, JSON.stringify(next)); }
    catch (_) {}
  }
  async function readSpecimens() {
    if (!window.indexedDB) return [];
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('gitai-specimen-box-v1',1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('specimens')) {
          request.result.createObjectStore('specimens',{keyPath:'id'});
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db=request.result;
        const tx=db.transaction('specimens','readonly');
        const specimens=[];
        const cursor=tx.objectStore('specimens').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          if (rules.eligible(cursor.result.value)) specimens.push(cursor.result.value);
          cursor.result.continue();
        };
        cursor.onerror = () => reject(cursor.error);
        tx.oncomplete = () => { db.close(); resolve(specimens); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  function render() {
    const progress = rules.progress(state);
    total.textContent = 'トロフィー：' + progress.count + '個体';
    for (const environment of progress.environments) {
      const e=environment;
      const card=picker.querySelector('[data-environment="' + e.id + '"]');
      const status=picker.querySelector('[data-status="' + e.id + '"]');
      const symbol=picker.querySelector('[data-symbol="' + e.id + '"]');
      const bar=picker.querySelector('[data-meter="' + e.id + '"]');
      if (!card || !status || !symbol) continue;
      const canPlay=e.unlocked && e.playable;
      card.setAttribute('aria-disabled',String(!canPlay));
      card.classList.toggle('is-unlocked',e.unlocked);
      card.classList.toggle('is-locked',!e.unlocked);
      if (e.id==='bark_001') status.textContent='最初から解放';
      else if (e.unlocked && !e.playable) status.textContent='条件達成！背景は準備中';
      else if (e.unlocked) status.textContent='解放済み・プレイ可能';
      else status.textContent='S以上の標本 ' + e.current + ' / ' + e.required;
      symbol.textContent = canPlay ? '▶' : (e.unlocked ? '◇' : '🔒');
      if (bar) bar.style.width=(e.current / Math.max(1,e.required) * 100) + '%';
    }
  }
  async function refresh() {
    store(rules.normalize(readState()));
    try {
      const existing=await readSpecimens();
      store(rules.merge(readState(),existing));
    } catch(error) {
      console.warn('Trophy specimen scan unavailable:',error);
    }
    render();
    return rules.progress(state);
  }
  function recordSpecimen(record) {
    if (!rules.eligible(record)) return false;
    store(rules.merge(readState(),[record]));
    render();
    return true;
  }
  function close() {
    ++opened;
    choose=null;
    picker.hidden=true;
    if (menu.classList.contains('is-active')) {
      const solo=document.getElementById('portalSolo');
      if (solo) solo.focus({preventScroll:true});
    }
  }
  async function open(options={}) {
    choose=typeof options.onChoose==='function' ? options.onChoose : null;
    const turn=++opened;
    picker.hidden=false;
    feedback.textContent='S・SSの判定境界は現在調整中です。正式に判定した標本で解放されます。';
    back.focus({preventScroll:true});
    await refresh();
    if (turn!==opened) return;
  }
  back.addEventListener('click',close);
  for (const card of cards) {
    card.addEventListener('click',() => {
      const id=card.dataset.environment;
      const environment=rules.progress(state).environments.find(e=>e.id===id);
      if (!environment) return;
      if (!environment.unlocked) {
        feedback.textContent='まだロックされています。S・SSの標本を集めると解放されます。';
      } else if (!environment.playable) {
        feedback.textContent='解放条件達成！この環境の背景は準備中です。';
      } else if (choose) {
        const cb=choose;
        close();
        cb(id);
      }
    });
  }
  window.GitaiTrophies={open,close,refresh,recordSpecimen,getProgress:()=>rules.progress(readState())};
})();
