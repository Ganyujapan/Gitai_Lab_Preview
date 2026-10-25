/* Four-step SOLO tutorial, with actual background and moths loaded by
   GitaiPagesPreview. Demo canvas is isolated from live game state. */
(() => {
 'use strict';
 const stage=document.getElementById('stage');
 if(!stage)return;
 const slides=Object.freeze([
  {heading:'あなたは捕食者',description:'あなたは蛾を食べる捕食者です。\nタップすることで蛾を食べることが出来ます。'},
  {heading:'60匹の蛾',description:'1世代あたり60匹の蛾が表示されます。\n食べられずに生き残った蛾が親となり、次の世代の子を作ります。'},
  {heading:'背景にギタイ',description:'あなたは背景に似ている蛾を残し、似ていない蛾だけを積極的に食べていくことで、蛾の模様が背景にギタイしていきます。'},
  {heading:'究極のギタイ',description:'究極にギタイした蛾を作ることが目的です。\nお気に入りの蛾は標本箱に入れられます。'}
 ]);
 const warningSlides=Object.freeze([
  {heading:'毒蛾と無毒蛾',description:'画面には毒蛾6匹と無毒蛾6匹、計12匹が現れます。\nこのうち5匹をタップして捕食してください。'},
  {heading:'毒ダメージに注意！',description:'毒蛾を食べるとハートが1つ減ります。\n無毒の蛾を食べると、ハートが1/3回復します。'},
  {heading:'ハートがなくなると',description:'ハートが0になると中毒死し、その世代は終了します。\n保存された進化データは消えず、続きから挑戦できます。'},
  {heading:'60匹で1世代',description:'1世代は5ラウンド・60個体。\n生き残った蛾が親となり、毒蛾と無毒蛾は交配せず、それぞれ別々に進化します。'},
  {heading:'第21世代から実験！',description:'真っ白な親から始まり、模様に少しずつ多様性が現れた第21世代からスタート。\n毒蛾と無毒蛾に違いがあるか、よく観察してみましょう！'},
  {heading:'進化のゆくえは？',description:'毒蛾と無毒蛾は、どんな模様に進化するでしょうか？\nあなたの捕食が、2つの進化を変えます！'}
 ]);
 const exhibitWarningSlides=Object.freeze([
  ...warningSlides,
  {heading:'昆虫大学版へようこそ！',description:'来場者のみなさんで、蛾の進化を引き継いでいきます。\nどんな模様に進化するか、お楽しみに！'}
 ]);
 const isExhibit=window.location?.pathname?.includes('/exhibit/') === true;
 const hideSlides=Object.freeze([
  {heading:'蛾を3匹選ぶ',description:'標本箱から、かくれんぼに使う蛾を3匹選びます。'},
  {heading:'好きな場所に隠す',description:'葉1・葉2・樹皮に蛾を自由に配置します。\n同じ背景に3匹隠してもかまいません。'},
  {heading:'相手の蛾を探す',description:'相手が隠した蛾を探します。\n各背景3秒ずつ、合計9秒です。'},
  {heading:'ギタイ度で勝負',description:'蛾を見つけると＋10点。\n空振りすると−1点。'}
 ]);
 let activeSlides=slides;
 const root=document.createElement('section');
 root.id='soloTutorialOverlay';root.hidden=true;
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
 root.setAttribute('aria-labelledby','soloTutorialHeading');
 root.innerHTML=[
  '<div class="tutorial-inner">',
  '<div class="tutorial-header"><span class="tutorial-brand">INVISILAB / HOW TO PLAY</span><span id="soloTutorialStep" class="tutorial-step">01 / 04</span></div>',
  '<h2 id="soloTutorialHeading" class="tutorial-title"></h2>',
  '<div class="tutorial-viewport"><div class="tutorial-canvas-wrap"><canvas id="soloTutorialCanvas" width="360" height="640" role="img" aria-label="ゲームの実際の背景と蛾の描画素材を使った説明画像。赤い矢印はハートの位置などを示します"></canvas></div></div>',
  '<p id="soloTutorialText" class="tutorial-copy" aria-live="polite"></p>',
  '<div id="soloTutorialProgress" class="tutorial-progress"></div>',
  '<div class="tutorial-actions"><button id="soloTutorialSkip" type="button">スキップ</button><button id="soloTutorialNext" type="button">次へ</button></div></div>'
 ].join('');
 stage.appendChild(root);
 const preview=root.querySelector('#soloTutorialCanvas');
 const viewport=root.querySelector('.tutorial-viewport');
 const canvasWrap=root.querySelector('.tutorial-canvas-wrap');
 // iPad Safari may flex the canvas's intrinsic 360x640 height independently
 // of its width when the slide's Japanese text reflows. Size both axes from
 // the available viewport every time the slide or viewport changes.
 function sizePreview(){
  if(!opened||!viewport||!canvasWrap?.style)return;
  const style=window.getComputedStyle?.(viewport);
  const px=v=>Number.parseFloat(v)||0;
  const w=(Number(viewport.clientWidth)||0)-px(style?.paddingLeft)-px(style?.paddingRight);
  const h=(Number(viewport.clientHeight)||0)-px(style?.paddingTop)-px(style?.paddingBottom);
  if(w<1||h<1)return;
  const width=Math.max(1,Math.min(w,h*9/16));
  canvasWrap.style.width=width+'px';
  canvasWrap.style.height=(width*16/9)+'px';
 }
 if(typeof window.ResizeObserver==='function'){
  new window.ResizeObserver(sizePreview).observe(viewport);
 }
 window.addEventListener?.('resize',sizePreview);
 const ctx=preview.getContext('2d',{alpha:false});
 const heading=root.querySelector('#soloTutorialHeading');
 const description=root.querySelector('#soloTutorialText');
 const number=root.querySelector('#soloTutorialStep');
 const next=root.querySelector('#soloTutorialNext');
 const skip=root.querySelector('#soloTutorialSkip');
 const progress=root.querySelector('#soloTutorialProgress');
 let opened=false,page=0,onDone=null,priorFocus=null,activeMode='solo';
 function buildProgress(){
  progress.replaceChildren();
  for(let i=0;i<activeSlides.length;i++){
   const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');progress.appendChild(dot);
  }
 }

 // All four slides use Leaf 1 (kusagi_001), BEFORE any habitat is selected.
 // Each moth uses the same renderGenome() pipeline that powers the game:
 // GitaiPortalRandomMoth is a read-only copy of the production renderer.
 // Never read the active game's environment or its stored population.
 const TUTORIAL_BACKGROUND='img/backgrounds/bg_leaf01.png';
 const demonstration={background:null,moths:[],size:38,generation:1};
 let assetPromise=null;
 function initializeAssets(){
  if(demonstration.background && demonstration.moths.length===12)return Promise.resolve(demonstration);
  if(assetPromise)return assetPromise;
  assetPromise=(async()=>{
   const image=new Image();
   const background=await new Promise((resolve,reject)=>{
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error('葉1の背景を読み込めません'));
    image.src=new URL(TUTORIAL_BACKGROUND,document.baseURI).toString();
   });
   const renderer=window.GitaiPortalRandomMoth;
   if(!renderer)throw new Error('蛾の描画処理が利用できません');
   await renderer.initialize();
   const moths=[];
   for(let index=0;index<12;index++){
    const rendered=renderer.next();
    if(!rendered)throw new Error('蛾を描画できません');
    // next() uses a shared canvas; take a snapshot of every real sprite.
    const snapshot=document.createElement('canvas');
    snapshot.width=128;snapshot.height=128;
    snapshot.getContext('2d').drawImage(rendered,0,0,128,128);
    moths.push(snapshot);
   }
   demonstration.background=background;
   demonstration.moths=moths;
   if(opened)draw();
   return demonstration;
  })().catch(error=>{
   console.warn('チュートリアル素材の読み込みに失敗しました',error);
   assetPromise=null;
   if(opened)draw();
   return null;
  });
  return assetPromise;
 }
 const spots=[[43,117],[164,97],[277,139],[96,233],[229,248],[37,337],
  [160,350],[280,382],[73,471],[217,478],[133,537],[291,527]];
 function sprite(a,i,x,y,size){
  const img=a.moths[i%a.moths.length];
  if(img && (img.naturalWidth>0 || img.width>0)){
   if(activeMode==='warning' && page<=4){
    ctx.save();
    // Show pale, slightly distinct moth patterns (illustrative, not saved genomes).
    ctx.filter='grayscale(1) brightness(1.7) contrast(.55)';
    ctx.drawImage(img,x,y,size,size);
    ctx.restore();
   }else ctx.drawImage(img,x,y,size,size);
  }
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

 // Each screenshot-style tutorial scene uses the actual game background and
 // moth renderer. HUD/annotations are teaching overlays, not saved game state.
 function chip(text,y,w=308,x=(360-w)/2){
  ctx.fillStyle='rgba(7,13,15,.90)';ctx.fillRect(x,y,w,30);
  ctx.strokeStyle='#a1bbae';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,29);
  ctx.textAlign='center';ctx.fillStyle='#f0f7e9';
  ctx.font='bold 13px system-ui,sans-serif';ctx.fillText(text,x+w/2,y+20);
 }
 function arrow(x1,y1,x2,y2){
  ctx.save();ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
  const angle=Math.atan2(y2-y1,x2-x1);
  for(const side of [-1,1]){
   ctx.moveTo(x2,y2);
   ctx.lineTo(x2-17*Math.cos(angle+side*.58),y2-17*Math.sin(angle+side*.58));
  }
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='#fff6e9';ctx.lineWidth=9;ctx.stroke();
  ctx.strokeStyle='#ee2c31';ctx.lineWidth=5;ctx.stroke();ctx.restore();
 }
 function heart(x,y,filled){
  ctx.beginPath();ctx.moveTo(x+8,y+16);
  ctx.bezierCurveTo(x+3,y+12,x,y+9,x+1,y+5);
  ctx.bezierCurveTo(x+2,y-2,x+8,y,x+8,y+3);
  ctx.bezierCurveTo(x+12,y-2,x+18,y-2,x+18,y+5);
  ctx.bezierCurveTo(x+19,y+9,x+13,y+13,x+8,y+16);
  ctx.closePath();
  ctx.fillStyle=filled?'#f35f6b':'#2b3030';
  ctx.strokeStyle=filled?'#ffb7ad':'#d59fa3';
  ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
 }
 function warningHud(gen,remaining){
  ctx.fillStyle='rgba(6,12,14,.90)';
  ctx.fillRect(0,0,360,55);ctx.fillRect(0,590,360,50);
  ctx.fillStyle='#e9f1ed';ctx.textAlign='left';
  ctx.font='bold 14px monospace';ctx.fillText('GEN '+String(gen).padStart(5,'0'),11,29);
  for(let i=0;i<10;i++)heart(153+i*20,18,i<remaining);
  ctx.textAlign='center';ctx.font='bold 12px system-ui,sans-serif';
  ctx.fillText('GITAI LAB  /  目立つギタイ',180,620);
 }
 function warningMoths(){
  for(let i=0;i<12;i++){
   const [x,y]=spots[i];sprite(demonstration,i,x,y,42);
  }
 }
 function warningGallery(){
  ctx.fillStyle='#090d0f';ctx.fillRect(0,0,360,640);
  ctx.fillStyle='#f0f4ed';ctx.textAlign='center';
  ctx.font='bold 21px system-ui,sans-serif';ctx.fillText('進化シアター',180,42);
  ctx.fillStyle='#8ca79a';ctx.fillRect(179,74,2,499);
  chip('毒蛾 30匹',81,168,7);chip('無毒蛾 30匹',81,168,185);
  for(let i=0;i<60;i++){
   const group=Math.floor(i/30),index=i%30;
   const x=10+group*177+(index%5)*33,y=118+Math.floor(index/5)*73;
   ctx.save();ctx.beginPath();ctx.rect(x,y,30,60);ctx.clip();
   ctx.drawImage(demonstration.background,x,y,30,60);
   sprite(demonstration,i,x+3,y+10,24);ctx.restore();
  }
  chip('毒蛾と無毒蛾は交配しない',565,312,24);
  ctx.textAlign='center';ctx.fillStyle='#b8cabb';
  ctx.font='11px system-ui,sans-serif';ctx.fillText('実際のゲーム素材による説明イメージ',180,622);
 }
 function warningFuture(){
  ctx.fillStyle='#08100e';ctx.fillRect(0,0,360,640);
  ctx.fillStyle='#edf3ed';ctx.textAlign='center';
  ctx.font='bold 20px system-ui,sans-serif';ctx.fillText('ふたつの進化を観察',180,46);
  ctx.fillStyle='#819f8f';ctx.fillRect(179,87,2,455);
  chip('毒蛾',85,168,7);chip('無毒蛾',85,168,185);
  for(let g=0;g<2;g++)for(let i=0;i<6;i++){
   const x=15+g*176+(i%2)*80,y=130+Math.floor(i/2)*120;
   ctx.save();ctx.beginPath();ctx.rect(x,y,72,102);ctx.clip();
   ctx.drawImage(demonstration.background,x,y,72,102);
   sprite(demonstration,i+g*6,x+4,y+17,64);ctx.restore();
  }
  chip('どう進化するかは、あなた次第！',556,326,17);
  ctx.textAlign='center';ctx.fillStyle='#b5c8bc';
  ctx.font='11px system-ui,sans-serif';ctx.fillText('模様は進化結果ではなく説明イメージ',180,619);
 }
 function warningExhibit(){
  ctx.fillStyle='#091411';ctx.fillRect(0,0,360,640);
  ctx.fillStyle='#bad7c8';ctx.textAlign='center';
  ctx.font='bold 13px monospace';ctx.fillText('KONCHU UNIVERSITY 2026',180,64);
  ctx.fillStyle='#fff9ed';ctx.font='bold 31px system-ui,sans-serif';
  ctx.fillText('ギタイラボ',180,130);
  ctx.font='15px system-ui,sans-serif';ctx.fillText('みんなで進化を育てよう！',180,172);
  for(let i=0;i<2;i++){
   const y=209+i*146;
   ctx.fillStyle='#1c352e';ctx.fillRect(24,y,312,121);
   ctx.strokeStyle='#81a396';ctx.lineWidth=2;ctx.strokeRect(24,y,312,121);
   ctx.fillStyle='#f9f9f1';ctx.font='bold 23px system-ui,sans-serif';
   ctx.fillText(i?'目立つギタイ':'隠れるギタイ',180,y+56);
   ctx.fillStyle='#bdd7c7';ctx.font='13px system-ui,sans-serif';
   ctx.fillText(i?'警告色の進化とベイツ型擬態':'隠蔽擬態',180,y+85);
  }
  chip('1人5世代を目安に交代',522);
  ctx.fillStyle='#c5dacd';ctx.font='13px system-ui,sans-serif';
  ctx.fillText('前の人から、次の人へ。',180,585);
  ctx.font='11px monospace';ctx.fillText('KONCHU UNIVERSITY / GITAI LAB',180,619);
 }
 function drawWarning(){
  if(page===3){warningGallery();return;}
  if(page===5){warningFuture();return;}
  if(page===6){warningExhibit();return;}
  ctx.drawImage(demonstration.background,0,0,360,640);
  warningMoths();
  warningHud(21,page===1?9:page===2?0:10);
  if(page===0){
   chip('毒蛾6匹 ＋ 無毒蛾6匹',490);
   chip('12匹から5匹をタップ',530);
   arrow(291,453,spots[7][0]+20,spots[7][1]+23);
  }else if(page===1){
   chip('毒蛾を食べると -1',101,236,62);
   arrow(279,98,302,38);
   ctx.fillStyle='rgba(6,9,10,.80)';ctx.fillRect(109,271,142,88);
   ctx.fillStyle='#f45c63';ctx.textAlign='center';
   ctx.font='bold 55px system-ui,sans-serif';ctx.fillText('毒',180,337);
   chip('無毒の蛾3匹でハート +1',522);
  }else if(page===2){
   arrow(275,101,302,38);
   chip('ハート 0',100,190,85);
   ctx.fillStyle='rgba(5,10,11,.91)';ctx.fillRect(17,214,326,222);
   ctx.strokeStyle='#b76569';ctx.lineWidth=2;ctx.strokeRect(17,214,326,222);
   ctx.fillStyle='#ef8d92';ctx.textAlign='center';
   ctx.font='bold 27px system-ui,sans-serif';ctx.fillText('中毒死しました。',180,291);
   ctx.fillStyle='#e6eee5';ctx.font='bold 17px system-ui,sans-serif';
   ctx.fillText('この世代は終了',180,334);
   ctx.font='14px system-ui,sans-serif';ctx.fillText('進化データは残ります',180,377);
   chip('続きから挑戦できます',512);
  }else if(page===4){
   chip('真っ白な親から20世代が経過',482);
   chip('模様の違いをよく見て！',527);
   arrow(289,473,spots[5][0]+24,spots[5][1]+20);
  }
 }

 function draw(){
  const a=demonstration;
  ctx.fillStyle='#101816';ctx.fillRect(0,0,360,640);
  if(!a.background?.complete||!a.moths.length){
   ctx.fillStyle='#b4c5ba';ctx.font='17px system-ui,sans-serif';
   ctx.textAlign='center';ctx.fillText('ゲームの画像を準備中…',180,320);
   return;
  }
  ctx.imageSmoothingEnabled=false;
  if(activeMode==='warning'){drawWarning();return;}
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
  number.textContent=String(page+1).padStart(2,'0')+' / '+String(activeSlides.length).padStart(2,'0');
  heading.textContent=activeSlides[page].heading;
  description.textContent=activeSlides[page].description;
  next.textContent=page===activeSlides.length-1?'はじめる':'次へ';
  [...progress.children].forEach((dot,i)=>dot.classList.toggle('active',i===page));
  sizePreview();
  draw();
 }
 function finish(){
  if(!opened)return;opened=false;root.hidden=true;
  const done=onDone;onDone=null;
  if(typeof done==='function')done();
  else priorFocus?.focus?.({preventScroll:true});
  priorFocus=null;
 }
 next.addEventListener('click',()=>{if(page<activeSlides.length-1){page++;render();}else finish();});
 skip.addEventListener('click',finish);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}});
 window.GitaiSoloTutorial={
  open({onDone:finishHandler,mode='solo'}={}){
   if(opened)return;
   opened=true;page=0;activeMode=mode;
   activeSlides=mode==='hide'?hideSlides:mode==='warning'?(isExhibit?exhibitWarningSlides:warningSlides):slides;
   buildProgress();
   onDone=finishHandler;priorFocus=document.activeElement;
   root.hidden=false;render();next.focus({preventScroll:true});
   // Display the tutorial immediately; load its Leaf 1 artwork in parallel.
   void initializeAssets();
  },
  refreshAssets(){if(opened)draw();},
  get isOpen(){return opened;}
 };
})();