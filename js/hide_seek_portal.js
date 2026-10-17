/* Hide-and-seek editor: select 3 DIFFERENT Genome-backed specimens,
   place each independently on one of 3 actual background photos, then
   hand off placements and DNA to the private LAN battle prototype.
   No trophies, battle wins, coins or persisted progress are written. */
(() => {
 'use strict';
 const portal=document.getElementById('entertainmentPortal');
 const menu=document.getElementById('portalMenu');
 const list=menu?.querySelector('.portal-modes');
 if(!portal||!list)return;
 const trigger=document.createElement('button');
 trigger.id='portalHideSeek';trigger.type='button';trigger.className='portal-mode';
 trigger.innerHTML='<span class="portal-mode-icon" aria-hidden="true">◎</span><span class="portal-mode-text"><span class="portal-mode-title">ギタイでかくれんぼ</span><span class="portal-mode-sub">標本を隠して、相手の蛾を探す</span></span><span class="portal-mode-arrow">LOCK</span>';
 list.insertBefore(trigger,document.getElementById('portalMystery'));
 const params=new URLSearchParams(location.search);
 const DEV=params.get('hideSeekTest')==='1';
 trigger.querySelector('.portal-mode-arrow').textContent=DEV?'TEST ▶':'10 WINS';
 const picker=document.createElement('section');
 picker.id='hidePicker';picker.hidden=true;
 picker.setAttribute('role','dialog');picker.setAttribute('aria-modal','true');
 picker.innerHTML=[
  '<div class="hide-top"><button class="hide-back" id="hideBack" type="button" aria-label="戻る">←</button><div><h2>ギタイでかくれんぼ</h2><p class="hide-sub">INVISILAB / HIDE & SEEK / TEST</p></div></div>',
  '<p id="hideNote" class="hide-note"></p>',
  '<div id="hideSelect"><div id="hideSpecimens" class="hide-scroll hide-specimens" role="group" aria-label="標本を3匹選ぶ"></div></div>',
  '<div id="hidePlace" hidden><div id="hideSlots" class="hide-slot-row"></div><div id="hideStages" class="hide-stage-row"></div></div>',
  '<div id="hideBoardWrap" class="hide-board-wrap" hidden><canvas id="hideBoard" width="360" height="640" aria-label="蛾の配置を指定する背景"></canvas></div>',
  '<p id="hidePlaceTip" class="hide-position-label" hidden></p>',
  '<button id="hideContinue" class="hide-action" type="button" disabled>配置へ</button>'
 ].join('');
 menu.appendChild(picker);
 // The selectable list is the scroll surface. This avoids a new page scroll
 // on the vertically mounted iPad and iPhone.
 const grid=picker.querySelector('#hideSpecimens'),
 note=picker.querySelector('#hideNote'),advance=picker.querySelector('#hideContinue');
 const place=picker.querySelector('#hidePlace'),select=picker.querySelector('#hideSelect');
 const board=picker.querySelector('#hideBoard'),boardWrap=picker.querySelector('#hideBoardWrap');
 const tip=picker.querySelector('#hidePlaceTip'),ctx=board.getContext('2d');
 const stages=['leaf1','leaf2','bark'],names=['葉1','葉2','樹皮'];
 const urls=[],backgrounds=new Map(),selected=[],positions=[null,null,null];
 let entries=[],slot=0,stage=0,screen='select',ticket=0;
 function revoke(){for(const url of urls)URL.revokeObjectURL(url);urls.length=0;}
 function stop(){ticket++;picker.hidden=true;revoke();selected.length=0;entries=[];trigger.focus({preventScroll:true});}
 function fetchSpecimens(){
  return new Promise((resolve,reject)=>{
   const req=indexedDB.open('gitai-specimen-box-v1',1);
   req.onerror=()=>reject(req.error||Error('標本箱を開けません'));
   req.onsuccess=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains('specimens')){db.close();resolve([]);return;}
    const out=[],tx=db.transaction('specimens','readonly');
    const cursor=tx.objectStore('specimens').openCursor();
    cursor.onsuccess=()=>{const c=cursor.result;if(c){out.push(c.value);c.continue();}};
    cursor.onerror=()=>reject(cursor.error||Error('読み込みに失敗'));
    tx.oncomplete=()=>{db.close();resolve(out);};
    tx.onerror=()=>{db.close();reject(tx.error||Error('読み込みに失敗'));};
   };
  });
 }
 function loadImage(src){return new Promise((ok,fail)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>fail(Error('背景を読み込めません'));im.src=src;});}
 const sources=['img/backgrounds/bg_leaf01.png','img/backgrounds/bg_leaf02.png','img/backgrounds/bg_bark01.png'];
 async function loadBackdrops(){
  await Promise.all(stages.map(async(b,i)=>backgrounds.set(b,await loadImage(sources[i]))));
  redraw();
 }
 function drawMoth(entry,x,y,size=38){
  if(entry?.image?.complete&&entry.image.naturalWidth)ctx.drawImage(entry.image,x,y,size,size);
 }
 function redraw(){
  if(screen!=='place')return;
  ctx.fillStyle='#101716';ctx.fillRect(0,0,360,640);
  const bg=backgrounds.get(stages[stage]);
  if(bg)ctx.drawImage(bg,0,0,360,640);
  positions.forEach((p,i)=>{if(!p||p.background!==stages[stage])return;
   drawMoth(selected[i],p.x,p.y);
   ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(p.x,p.y+38,18,16);
   ctx.fillStyle='#e6fff2';ctx.font='bold 12px ui-monospace';ctx.fillText(i+1,p.x+5,p.y+51);
  });
  ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(0,0,360,52);ctx.fillRect(0,590,360,50);
  ctx.fillStyle='#fff';ctx.font='bold 15px system-ui';ctx.textAlign='center';
  ctx.fillText('背景 '+names[stage],180,32);ctx.fillText('蛾を隠す場所をタップ',180,621);
 }
 function refreshPlace(){
  const area=picker.querySelector('#hideSlots');area.replaceChildren();
  selected.forEach((entry,i)=>{
   const b=document.createElement('button');b.type='button';
   b.setAttribute('aria-pressed',String(slot===i));
   const icon=document.createElement('img');icon.src=entry.url;icon.alt='';
   const text=document.createElement('span');
   text.textContent='蛾'+(i+1)+(positions[i]?' ✓':'');
   b.append(icon,text);b.onclick=()=>{slot=i;if(positions[i])stage=stages.indexOf(positions[i].background);refreshPlace();};area.append(b);
  });
  const row=picker.querySelector('#hideStages');row.replaceChildren();
  stages.forEach((id,i)=>{
   const b=document.createElement('button');b.type='button';b.textContent=names[i];
   b.setAttribute('aria-pressed',String(i===stage));
   b.onclick=()=>{stage=i;refreshPlace();};row.append(b);
  });
  const count=positions.filter(Boolean).length;
  tip.textContent='蛾'+(slot+1)+'を '+names[stage]+' の好きな場所に置いてください';
  note.textContent='3匹を自由に配置 · '+count+'/3匹';
  advance.textContent='対戦相手を探す';
  advance.disabled=count!==3;
  redraw();
 }
 function updateSelection(){
  for(const b of grid.querySelectorAll('button')){
   b.setAttribute('aria-pressed',String(selected.includes(entries[Number(b.dataset.idx)])));
  }
  note.textContent='DNA付き標本を3匹選ぶ · '+selected.length+'/3匹';
  advance.disabled=selected.length!==3;
 }
 async function show(){
  const serial=++ticket;picker.hidden=false;
  screen='select';selected.length=0;positions.fill(null);revoke();entries=[];
  select.hidden=false;place.hidden=true;boardWrap.hidden=true;tip.hidden=true;
  advance.textContent='配置へ';advance.disabled=true;grid.replaceChildren();
  note.textContent='標本箱を読み込んでいます…';
  try{
   const all=await fetchSpecimens();if(ticket!==serial)return;
   entries=all.filter(r=>r&&r.genome?.schema_version===1
    &&r.evolution_model_id==='continuous_v1'&&r.image_blob instanceof Blob)
    .sort((a,b)=>String(b.saved_at||'').localeCompare(String(a.saved_at||'')));
   if(entries.length<3){note.textContent='DNA付きの標本が3匹必要です。ひとりでギタイで保存してください。';return;}
   entries.forEach((r,i)=>{
    const url=URL.createObjectURL(r.image_blob),img=new Image();
    img.src=url;urls.push(url);
    entries[i]={...r,image:img,url};
    const button=document.createElement('button');button.type='button';button.dataset.idx=String(i);
    button.setAttribute('aria-pressed','false');
    const picture=document.createElement('img');picture.src=url;picture.alt='';
    const label=document.createElement('span');label.textContent='第'+r.generation_number+'世代';
    button.append(picture,label);
    button.onclick=()=>{
     const entry=entries[i],old=selected.indexOf(entry);
     if(old>=0)selected.splice(old,1);
     else if(selected.length<3)selected.push(entry);
     updateSelection();
    };
    grid.append(button);
   });
   updateSelection();
  }catch(e){if(ticket===serial)note.textContent='標本箱の読み込みに失敗しました：'+e.message;}
 }
 board.addEventListener('pointerdown',e=>{
  if(screen!=='place')return;e.preventDefault();
  const rect=board.getBoundingClientRect();
  const x=(e.clientX-rect.left)*360/rect.width,y=(e.clientY-rect.top)*640/rect.height;
  positions[slot]={background:stages[stage],
   x:Math.round(Math.max(0,Math.min(322,x-19))),
   y:Math.round(Math.max(52,Math.min(552,y-19)))};
  const next=positions.findIndex((p,i)=>!p);
  if(next>=0)slot=next;
  refreshPlace();
 });
 async function advanceScreen(){
  if(screen==='select'){
   if(selected.length!==3)return;
   screen='place';select.hidden=true;place.hidden=false;
   boardWrap.hidden=false;tip.hidden=false;
   slot=0;stage=0;advance.disabled=true;
   refreshPlace();void loadBackdrops().catch(e=>{note.textContent=e.message;});
   return;
  }
  if(positions.some(p=>!p))return;
  const name=String(document.getElementById('portalNickname')?.value||'').trim().slice(0,16);
  if(!name){note.textContent='ニックネームを入力してください';return;}
  const data={version:1,name,placements:positions.map((p,i)=>({...p,genome:selected[i].genome}))};
  const packed=encodeURIComponent(JSON.stringify(data));
  if(packed.length>160000){note.textContent='標本のDNAが大きすぎます';return;}
  advance.disabled=true;
  note.textContent='バトルサーバーへ移動します…';
  window.location.assign('http://192.168.1.25:3000/hide_seek#hide='+packed);
 }
 advance.addEventListener('click',advanceScreen);
 picker.querySelector('#hideBack').addEventListener('click',()=>{
  if(screen==='place'){screen='select';select.hidden=false;place.hidden=true;boardWrap.hidden=true;tip.hidden=true;advance.textContent='配置へ';updateSelection();}
  else stop();
 });
 trigger.addEventListener('click',()=>{
  if(!DEV){
   window.alert('ギタイでバトル 通算10勝で解放されます。現在は開発中です。');
   return;
  }
  if(window.GitaiSoloTutorial?.open)window.GitaiSoloTutorial.open({mode:'hide',onDone:show});
  else show();
 });
 window.addEventListener('pagehide',revoke);
})();
