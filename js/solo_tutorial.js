/* Four-step SOLO tutorial, with actual background and moths loaded by
   GitaiPagesPreview. Demo canvas is isolated from live game state. */
(() => {
 'use strict';
 const stage=document.getElementById('stage');
 if(!stage)return;
 const slides=Object.freeze([
  {heading:'あなたは捕食者',description:'あなたは蛾を食べる捕食者です。タップすることで蛾を食べることができます。'},
  {heading:'60匹の蛾',description:'1世代あたり60匹の蛾が登場します。12匹ずつ、5ラウンドに分かれて現れます。'},
  {heading:'生き残った蛾',description:'食べられずに生き残った蛾が、次の世代へ子孫を残します。'},
  {heading:'擬態の進化',description:'世代を重ねると、背景に似た蛾が増えていきます。見つけられるかな？'}
 ]);
 const root=document.createElement('section');
 root.id='soloTutorialOverlay';root.hidden=true;
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
 root.setAttribute('aria-labelledby','soloTutorialHeading');
 root.innerHTML=[
  '<div class="tutorial-inner">',
  '<div class="tutorial-header"><span class="tutorial-brand">INVISILAB / HOW TO PLAY</span><span id="soloTutorialStep" class="tutorial-step">01 / 04</span></div>',
  '<h2 id="soloTutorialHeading" class="tutorial-title"></h2>',
  '<div class="tutorial-viewport"><div class="tutorial-canvas-wrap"><canvas id="soloTutorialCanvas" width="360" height="640" role="img" aria-label="実際のゲーム背景と蛾の説明画像"></canvas></div></div>',
  '<p id="soloTutorialText" class="tutorial-copy" aria-live="polite"></p>',
  '<div id="soloTutorialProgress" class="tutorial-progress"></div>',
  '<div class="tutorial-actions"><button id="soloTutorialSkip" type="button">スキップ</button><button id="soloTutorialNext" type="button">次へ</button></div></div>'
 ].join('');
 stage.appendChild(root);
 const preview=root.querySelector('#soloTutorialCanvas');
 const ctx=preview.getContext('2d',{alpha:false});
 const heading=root.querySelector('#soloTutorialHeading');
 const description=root.querySelector('#soloTutorialText');
 const number=root.querySelector('#soloTutorialStep');
 const next=root.querySelector('#soloTutorialNext');
 const skip=root.querySelector('#soloTutorialSkip');
 const progress=root.querySelector('#soloTutorialProgress');
 for(let i=0;i<slides.length;i++){
  const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');progress.appendChild(dot);
 }
 let opened=false,page=0,onDone=null,priorFocus=null;
 const spots=[[43,117],[164,97],[277,139],[96,233],[229,248],[37,337],
  [160,350],[280,382],[73,471],[217,478],[133,537],[291,527]];
 function sprite(a,i,x,y,size){
  const img=a.moths[i%a.moths.length];
  if(img?.complete && img.naturalWidth>0)ctx.drawImage(img,x,y,size,size);
 }
 function hud(left,right){
  ctx.fillStyle='rgba(5,12,14,.80)';ctx.fillRect(0,0,360,48);ctx.fillRect(0,594,360,46);
  ctx.fillStyle='#d5eff0';ctx.font='bold 16px ui-monospace,monospace';
  ctx.textAlign='left';ctx.fillText(left,14,31);
  ctx.textAlign='right';ctx.fillText(right,346,31);
  ctx.textAlign='center';ctx.fillText('INVISILAB',180,624);
 }
 function mark(x,y,size,kind){
  if(kind==='survive'){
   ctx.strokeStyle='#b8f7ff';ctx.lineWidth=3;ctx.beginPath();
   ctx.arc(x+size/2,y+size/2,size*.8,0,Math.PI*2);ctx.stroke();
  }else{
   ctx.strokeStyle='#ed716e';ctx.lineWidth=3;ctx.beginPath();
   ctx.moveTo(x+4,y+4);ctx.lineTo(x+size-4,y+size-4);
   ctx.moveTo(x+size-4,y+4);ctx.lineTo(x+4,y+size-4);ctx.stroke();
  }
 }
 function draw(){
  const a=window.GitaiSoloTutorialAssets?.();
  ctx.fillStyle='#101816';ctx.fillRect(0,0,360,640);
  if(!a?.background?.complete||!a?.moths?.length){
   ctx.fillStyle='#b4c5ba';ctx.font='17px system-ui,sans-serif';
   ctx.textAlign='center';ctx.fillText('ゲームの画像を準備中…',180,320);
   return;
  }
  ctx.imageSmoothingEnabled=false;
  const size=Math.max(20,Number(a.size)||38);
  if(page===3){
   ctx.fillStyle='#080a0b';ctx.fillRect(0,0,360,640);
   ctx.fillStyle='#ebf3ed';ctx.font='bold 20px system-ui,sans-serif';
   ctx.textAlign='center';ctx.fillText('第'+(a.generation||1)+'世代の蛾',180,70);
   for(let i=0;i<12;i++){
    const x=21+(i%3)*108,y=98+Math.floor(i/3)*117;
    ctx.save();ctx.beginPath();ctx.rect(x,y,98,102);ctx.clip();
    ctx.drawImage(a.background,x,y,98,102);
    sprite(a,i,x+16,y+7,64);
    ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(x+6,y+79,86,17);
    ctx.fillStyle='#f5f5ef';ctx.font='11px ui-monospace,monospace';
    ctx.textAlign='center';ctx.fillText('MOTH '+String(i+1).padStart(2,'0'),x+49,y+92);
    ctx.restore();
   }
   hud('GALLERY','60 MOTHS');return;
  }
  ctx.drawImage(a.background,0,0,360,640);
  const visible=page===2?9:12;
  for(let i=0;i<visible;i++){
   const [x,y]=spots[i];sprite(a,i,x,y,size);
   if(page===1&&[0,3,7,10].includes(i))mark(x,y,size,'eaten');
   if(page===2)mark(x,y,size,i<5?'eaten':'survive');
  }
  if(page===0)mark(spots[4][0],spots[4][1],size,'survive');
  if(page===0)hud('GEN '+String(a.generation||1).padStart(5,'0'),'TAP');
  else if(page===1)hud('ROUND 1 / 5','12 MOTHS');
  else hud('SURVIVORS','NEXT GEN');
 }
 function render(){
  number.textContent=String(page+1).padStart(2,'0')+' / 04';
  heading.textContent=slides[page].heading;
  description.textContent=slides[page].description;
  next.textContent=page===3?'はじめる':'次へ';
  [...progress.children].forEach((dot,i)=>dot.classList.toggle('active',i===page));
  draw();
 }
 function finish(){
  if(!opened)return;opened=false;root.hidden=true;
  const done=onDone;onDone=null;
  if(typeof done==='function')done();
  else priorFocus?.focus?.({preventScroll:true});
  priorFocus=null;
 }
 next.addEventListener('click',()=>{if(page<3){page++;render();}else finish();});
 skip.addEventListener('click',finish);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}});
 window.GitaiSoloTutorial={
  open({onDone:finishHandler}={}){
   if(opened)return;
   opened=true;page=0;onDone=finishHandler;priorFocus=document.activeElement;
   root.hidden=false;render();next.focus({preventScroll:true});
  },
  refreshAssets(){if(opened)draw();},
  get isOpen(){return opened;}
 };
})();