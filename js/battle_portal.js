/* Battle selection occurs in the entertainment menu; only matchmaking navigates to LAN. */
(() => {
 'use strict';
 const portal=document.getElementById('entertainmentPortal');
 const menu=document.getElementById('portalMenu');
 const list=menu?.querySelector('.portal-modes');
 if(!portal||!list)return;
 const trigger=document.createElement('button');
 trigger.id='portalBattle';trigger.type='button';trigger.className='portal-mode';
 trigger.setAttribute('aria-haspopup','dialog');
 trigger.innerHTML='<span class="portal-mode-icon" aria-hidden="true">⚔</span><span class="portal-mode-text"><span class="portal-mode-title">ギタイでバトル</span><span class="portal-mode-sub">標本箱から蛾を選んで対戦！</span></span><span class="portal-mode-arrow" aria-hidden="true">PLAY ▶</span>';
 const mystery=document.getElementById('portalMystery');
 list.insertBefore(trigger,mystery||null);
 const dialog=document.createElement('section');
 dialog.id='battlePicker';
 dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','battlePickerTitle');
 dialog.innerHTML=[
   '<div class="battle-picker-top"><button id="battleBack" type="button" aria-label="戻る">←</button><h2 id="battlePickerTitle">ギタイでバトル</h2></div>',
   '<p class="battle-picker-caption">① 対戦する背景を選ぶ</p>',
   '<div id="battleBackgrounds" class="battle-backgrounds">',
   '<button type="button" data-background="leaf1" aria-pressed="true"><img alt="" src="img/backgrounds/bg_leaf01.png">葉1</button>',
   '<button type="button" data-background="leaf2" aria-pressed="false"><img alt="" src="img/backgrounds/bg_leaf02.png">葉2</button>',
   '<button type="button" data-background="bark" aria-pressed="false"><img alt="" src="img/backgrounds/bg_bark01.png">樹皮</button></div>',
   '<p class="battle-picker-caption">② 標本箱から戦わせる蛾を選ぶ</p>',
   '<div id="battleSpecimens" class="battle-specimens" role="group" aria-label="DNA付き標本"></div>',
   '<p id="battlePickerStatus" class="battle-picker-status" role="status"></p>',
   '<button id="battleStartMatch" type="button" disabled>対戦相手を探す ▶</button>',
   '<p class="battle-picker-note">家庭内Wi-Fiテスト版です。iMacのバトルサーバーを起動してください。</p>'
 ].join('');
 menu.append(dialog);
 const style=document.createElement('style');
 style.textContent=[
  '#entertainmentPortal .portal-menu-content{padding-top:14px}',
  '#entertainmentPortal .portal-mode{min-height:61px}',
  '#entertainmentPortal .portal-modes{gap:8px}',
  '#entertainmentPortal #battlePicker{position:absolute;inset:4% 10px 4%;z-index:25;display:flex;flex-direction:column;gap:8px;background:#101d1d;border:2px solid #d7c48e;box-shadow:0 0 0 200vmax rgba(0,0,0,.8);padding:12px;color:#f2efda;overflow:hidden;min-height:0;font-family:DotGothic16,PixelMplus,monospace}',
  '#entertainmentPortal #battlePicker[hidden]{display:none!important}',
  '#battlePicker .battle-picker-top{display:flex;align-items:center;gap:8px;flex:none}',
  '#battlePicker #battleBack{padding:4px 10px;min-height:32px;border:1px solid #b0ad79;background:#243c32;color:white;font-size:20px}',
  '#battlePicker h2{font-size:20px;margin:0;color:#f8e9ae}',
  '#battlePicker .battle-picker-caption{font-size:13px;margin:6px 0 1px;color:#e2d0a0}',
  '#battlePicker .battle-backgrounds{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;flex:none;max-height:110px}',
  '#battlePicker .battle-backgrounds button{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;padding:3px;background:#23372f;color:white;border:2px solid #5f746a;font-size:11px;min-height:0}',
  '#battlePicker .battle-backgrounds button[aria-pressed=true]{border-color:#f6da7c;background:#445d43}',
  '#battlePicker .battle-backgrounds img{height:66px;width:50px;object-fit:cover}',
  '#battlePicker .battle-specimens{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;overflow-y:auto;flex:1 1 auto;min-height:74px;align-content:start;overscroll-behavior:contain}',
  '#battlePicker .battle-specimens button{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;padding:5px 2px;background:#243630;border:2px solid #4f6b61;color:#f0efdc;min-height:90px}',
  '#battlePicker .battle-specimens button[aria-pressed=true]{border-color:#f6da7c;background:#39554a}',
  '#battlePicker .battle-specimens button:disabled{opacity:.5}',
  '#battlePicker .battle-specimens img{width:60px;height:60px;object-fit:contain;image-rendering:pixelated}',
  '#battlePicker .battle-specimens span{font-size:10px;line-height:1.2}',
  '#battlePicker .battle-picker-status{font-size:10px;line-height:1.5;margin:0;color:#e1dec8;max-height:48px;overflow-y:auto}',
  '#battlePicker #battleStartMatch{flex:none;width:100%;padding:11px 6px;font-size:16px;background:#edd28d;color:#1a312b;border:2px solid #fff0c3;font-weight:900}',
  '#battlePicker #battleStartMatch:disabled{opacity:.4}',
  '#battlePicker .battle-picker-note{font-size:9px;line-height:1.5;margin:0;color:#c1c7b1}',
  '@media(max-height:660px){#entertainmentPortal .portal-mode{min-height:52px}#entertainmentPortal .portal-modes{gap:5px}#battlePicker .battle-backgrounds img{height:47px}#battlePicker .battle-backgrounds{max-height:89px}#battlePicker .battle-picker-caption{margin:3px 0 0}#battlePicker .battle-specimens img{width:48px;height:48px}#battlePicker .battle-specimens button{min-height:73px}}'
 ].join('\n');
 document.head.append(style);
 const grid=dialog.querySelector('#battleSpecimens');
 const note=dialog.querySelector('#battlePickerStatus');
 const start=dialog.querySelector('#battleStartMatch');
 const backgrounds=[...dialog.querySelectorAll('#battleBackgrounds button')];
 const nickname=document.getElementById('portalNickname');
 let background='leaf1',chosen=null,objectUrls=[],ticket=0;
 function clearUrls(){for(const u of objectUrls)URL.revokeObjectURL(u);objectUrls=[];}
 function close(){ticket++;dialog.hidden=true;clearUrls();chosen=null;start.disabled=true;trigger.focus({preventScroll:true});}
 function readSpecimens(){
   return new Promise((resolve,reject)=>{
     const req=indexedDB.open('gitai-specimen-box-v1',1);
     req.onupgradeneeded=()=>{}; // Do not change the specimen box schema.
     req.onerror=()=>reject(req.error||Error('標本箱を開けません'));
     req.onsuccess=()=>{
       const db=req.result;
       if(!db.objectStoreNames.contains('specimens')){db.close();resolve([]);return;}
       const records=[],tx=db.transaction('specimens','readonly');
       const cursor=tx.objectStore('specimens').openCursor();
       cursor.onsuccess=()=>{const c=cursor.result;if(c){records.push(c.value);c.continue();}};
       cursor.onerror=()=>reject(cursor.error||Error('標本の読み込みに失敗'));
       tx.oncomplete=()=>{db.close();resolve(records);};
       tx.onerror=()=>{db.close();reject(tx.error||Error('標本の読み込みに失敗'));};
     };
   });
 }
 async function show(){
   const mine=++ticket;
   dialog.hidden=false;background='leaf1';chosen=null;start.disabled=true;
   for(const b of backgrounds)b.setAttribute('aria-pressed',String(b.dataset.background===background));
   clearUrls();grid.replaceChildren();note.textContent='標本箱を読み込んでいます…';
   try{
     const entries=(await readSpecimens()).filter(r=>r&&r.image_blob instanceof Blob)
       .sort((a,b)=>String(b.saved_at||'').localeCompare(String(a.saved_at||'')));
     if(mine!==ticket)return;
     if(!entries.length){note.textContent='まだ標本がありません。「ひとりでギタイ」で保存してください。';return;}
     let eligible=0;
     for(const r of entries){
       const hasGenome=r.genome?.schema_version===1&&r.evolution_model_id==='continuous_v1';
       if(hasGenome)eligible++;
       const button=document.createElement('button');
       button.type='button';button.disabled=!hasGenome;button.setAttribute('aria-pressed','false');
       const img=document.createElement('img'),url=URL.createObjectURL(r.image_blob);
       objectUrls.push(url);img.src=url;img.alt='';
       const caption=document.createElement('span');
       caption.textContent='第'+r.generation_number+'世代 '+(hasGenome?'DNA':'画像のみ');
       button.append(img,caption);
       if(hasGenome)button.addEventListener('click',()=>{
         chosen=r;
         for(const b of grid.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));
         start.disabled=false;
         note.textContent='第'+r.generation_number+'世代の蛾を選択中。出身環境に関係なく対戦できます。';
       });
       grid.append(button);
     }
     note.textContent=eligible
       ? eligible+'匹のDNA付き標本から選んでください。画像のみの標本はグレー表示です。'
       : 'DNA付き標本がありません。進化ゲームで新しく保存してください。';
   }catch(e){if(mine===ticket)note.textContent='標本箱を開けません：'+(e.message||e);}
 }
 backgrounds.forEach(b=>b.addEventListener('click',()=>{
   background=b.dataset.background;
   for(const other of backgrounds)other.setAttribute('aria-pressed',String(other===b));
 }));
 start.addEventListener('click',()=>{
   if(!chosen?.genome)return;
   const name=String(nickname?.value||'').trim().slice(0,16);
   if(!name){note.textContent='先にニックネームを入力してください。';return;}
   const data={version:1,name,background,genome:chosen.genome,generationNumber:chosen.generation_number};
   const fragment=encodeURIComponent(JSON.stringify(data));
   if(fragment.length>40000){note.textContent='選択した標本のデータが大きすぎます。';return;}
   try{localStorage.setItem('gitai-player-nickname-v1',name);}catch(_){}
   start.disabled=true;note.textContent='バトルサーバーに移動します…';
   window.location.assign('http://192.168.1.25:3000/#battle='+fragment);
 });
 dialog.querySelector('#battleBack').addEventListener('click',close);
 trigger.addEventListener('click',show);
 window.addEventListener('pagehide',clearUrls);
})();
