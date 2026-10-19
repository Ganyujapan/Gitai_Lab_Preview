/* Habitat selection: test = kusagi + legacy comparisons; release = trophy-locked user backgrounds. */
(() => {
  'use strict';
  const portal=document.getElementById('entertainmentPortal');
  const menu=document.getElementById('portalMenu');
  const rules=window.GitaiTrophyRules;
  const params=new URLSearchParams(location.search);
  if(!portal||!menu||!rules||(params.get('model')||'continuous_v1')!=='continuous_v1')return;

  const picker=document.createElement('section');
  picker.id='portalEnvironmentPicker';
  picker.className='portal-environments';
  picker.hidden=true;
  picker.setAttribute('role','dialog');
  picker.setAttribute('aria-modal','true');
  picker.setAttribute('aria-label','生息環境を選ぶ');
  picker.innerHTML = [
    '<div class="portal-environments-head"><button id="portalEnvironmentBack" type="button" aria-label="モード選択に戻る">←</button>',
    '<div class="portal-environments-heading"><span>[ HABITAT COLLECTION ]</span><strong>生息環境を選ぶ</strong></div></div>',
    '<p class="portal-environments-lead" id="portalEnvironmentLead"></p>',
    '<div class="portal-environments-list" id="portalEnvironmentCards"></div>',
    '<p id="portalEnvironmentFeedback" class="portal-environment-feedback" aria-live="polite"></p>',
    '<p id="portalTrophyTotal" class="portal-environment-total"></p>',
  ].join('');
  menu.appendChild(picker);
  const feedback=picker.querySelector('#portalEnvironmentFeedback');
  const lead=picker.querySelector('#portalEnvironmentLead');
  const total=picker.querySelector('#portalTrophyTotal');
  const back=picker.querySelector('#portalEnvironmentBack');
  const cards=picker.querySelector('#portalEnvironmentCards');
  let state=rules.normalize(null),choose=null,opened=0;

  function readState() {
    try{return rules.normalize(JSON.parse(localStorage.getItem(rules.STORAGE_KEY)))}
    catch(_){return rules.normalize(state)}
  }
  function store(next) {
    state=next;
    try{localStorage.setItem(rules.STORAGE_KEY,JSON.stringify(next))}catch(_){}
  }
  async function readSpecimens() {
    if(!window.indexedDB)return [];
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('gitai-specimen-box-v1',1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('specimens'))req.result.createObjectStore('specimens',{keyPath:'id'});
      };
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const db=req.result,tx=db.transaction('specimens','readonly');
        const specimens=[],cursor=tx.objectStore('specimens').openCursor();
        cursor.onsuccess=()=>{
          if(!cursor.result)return;
          if(rules.eligible(cursor.result.value))specimens.push(cursor.result.value);
          cursor.result.continue();
        };
        cursor.onerror=()=>reject(cursor.error);
        tx.oncomplete=()=>{db.close();resolve(specimens)};
        tx.onerror=()=>{db.close();reject(tx.error)};
      };
    });
  }
  function render() {
    const p=rules.progress(state);
    total.textContent='トロフィー：'+p.count+'個体';
    const english = window.GitaiHabitatAccess?.locale === 'en';
    lead.textContent=p.testMode
      ? (english ? 'TEST MODE: Choose any of the 13 new and 2 legacy backgrounds.'
        : 'テスト中：新しい13背景と旧比較用2背景を自由に選択できます。')
      : (english ? 'Collect S/SS specimens to unlock more habitats.'
        : 'S以上の蛾を標本箱に集めて次の環境を解放しよう。');
    cards.textContent='';
    for(const e of p.environments){
      const card=document.createElement('button');
      card.type='button';card.className='portal-environment-card';
      card.dataset.environment=e.id;
      const canPlay=e.unlocked&&e.playable;
      card.setAttribute('aria-disabled',String(!canPlay));
      card.classList.toggle('is-unlocked',e.unlocked);
      card.classList.toggle('is-locked',!e.unlocked);
      const art=e.asset
        ? '<img src="'+e.asset+'" alt="" loading="lazy">'
        : '<span class="portal-environment-unknown" aria-hidden="true">?</span>';
      const label=e.legacy
        ? (english ? 'Legacy comparison; existing progress retained'
          : '旧版比較用・進化データは保持')
        : e.comparison
          ? (english ? 'Available during testing' : 'テスト期間中は自由に選択可能')
          : e.required===0
            ? (english ? 'Available from the start' : '最初からプレイ可能')
            : !e.unlocked
              ? (english ? 'S/SS specimens '+e.current+' / '+e.required
                : 'S以上の標本 '+e.current+' / '+e.required)
              : !e.playable
                ? (english ? 'Unlocked; background coming soon' : '条件達成！新背景は準備中')
                : (english ? 'Unlocked; ready to play' : '解放済み・プレイ可能');
      card.innerHTML=art+
        '<span class="portal-environment-info"><b></b><small></small></span>'+
        '<span class="portal-environment-symbol"></span>';
      card.querySelector('b').textContent=english ? (e.en||e.label) : e.label;
      card.querySelector('small').textContent=label;
      card.querySelector('.portal-environment-symbol').textContent=canPlay?'▶':e.unlocked?'◇':'🔒';
      if(e.required>0){
        const meter=document.createElement('span');meter.className='portal-trophy-meter';
        const fill=document.createElement('i');fill.style.width=(100*e.current/e.required)+'%';
        meter.appendChild(fill);card.querySelector('.portal-environment-info').appendChild(meter);
      }
      card.addEventListener('click',()=>{
        if(!canPlay) {
          feedback.textContent=e.unlocked?'背景は準備中です。':'S・SSの標本で解放できます。';
        } else if(choose) {
          const action=choose;close();action(e.id);
        }
      });
      cards.appendChild(card);
    }
  }
  async function refresh(){
    store(rules.normalize(readState()));
    try{store(rules.merge(readState(),await readSpecimens()))}
    catch(err){console.warn('Trophy data not readable:',err)}
    render();
    return rules.progress(state);
  }
  function recordSpecimen(record) {
    if(!rules.eligible(record))return false;
    store(rules.merge(readState(),[record]));render();return true;
  }
  function close() {
    ++opened;choose=null;picker.hidden=true;
    const solo=document.getElementById('portalSolo');
    if(solo && menu.classList.contains('is-active'))solo.focus({preventScroll:true});
  }
  async function open({onChoose}={}){
    choose=typeof onChoose==='function'?onChoose:null;
    const serial=++opened;picker.hidden=false;
    const english=window.GitaiHabitatAccess?.locale==='en';
    feedback.textContent=window.GitaiHabitatAccess?.testMode
      ? (english ? 'Comparison test mode. S/SS calibration is still in progress.'
        : '全背景の比較テスト中です。S・SSの判定はまだ較正中です。')
      : (english ? 'S/SS rank calibration is still in progress.'
        : 'S・SSのランク判定は現在調整中です。');
    back.focus({preventScroll:true});
    await refresh();
    if(serial!==opened)return;
  }
  back.addEventListener('click',close);
  window.GitaiTrophies={open,close,refresh,recordSpecimen,getProgress:()=>rules.progress(readState())};
})();
