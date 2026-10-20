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
  {heading:'2種類の蛾',description:'毒蛾30匹と無毒蛾30匹は、元はどちらも真っ白でした。\n共通の祖先として30世代進化し、毒蛾・無毒蛾に分かれてさらに2世代。\n第33世代から実験します。'},
  {heading:'毒を食べると',description:'時間制限はありません。6匹食べると次のラウンドです。\n毒蛾を食べると1秒間「毒」が表示され、食べられた毒蛾も死亡します。'},
  {heading:'毒を見分ける',description:'捕食者であるあなたの行動が、生き残る蛾を変えます。\n各系統で2匹以上残らなければ、同じ世代をやり直します。'},
  {heading:'2つの進化を観察',description:'毒蛾と無毒蛾は別々に子孫を残し、両方に突然変異が起こります。\n背景もラウンドごとに変わる実験です。'}
 ]);
 // A mode-specific four-page introduction shares the original live-art panel.
 // Battle unlocks, coins, and saved population data are never modified here.
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
   if(activeSlides===warningSlides){
    ctx.save();
    // Both warning-experiment founder lineages begin white.
    ctx.filter='brightness(0) invert(1)';
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
 function draw(){
  const a=demonstration;
  ctx.fillStyle='#101816';ctx.fillRect(0,0,360,640);
  if(!a.background?.complete||!a.moths.length){
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
  heading.textContent=activeSlides[page].heading;
  description.textContent=activeSlides[page].description;
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
  open({onDone:finishHandler,mode='solo'}={}){
   if(opened)return;
   opened=true;page=0;activeSlides=mode==='hide'?hideSlides:mode==='warning'?warningSlides:slides;
   onDone=finishHandler;priorFocus=document.activeElement;
   root.hidden=false;render();next.focus({preventScroll:true});
   // Display the tutorial immediately; load its Leaf 1 artwork in parallel.
   void initializeAssets();
  },
  refreshAssets(){if(opened)draw();},
  get isOpen(){return opened;}
 };
})();