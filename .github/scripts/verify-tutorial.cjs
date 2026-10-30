/* Public CI-only warning tutorial regression: images, text, routing, layout. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const code=fs.readFileSync('js/solo_tutorial.js','utf8');
const css=fs.readFileSync('css/solo_tutorial.css','utf8');
const html=fs.readFileSync('index.html','utf8');
const exhibitIndex=fs.readFileSync('exhibit/modes.html','utf8');
const exhibitGame=fs.readFileSync('exhibit/game.js','utf8');
assert.match(code,/function arrow\(/);
const tutorialAssets=[
 ['tutorial_warning_01_1080x1760.png','e3ff7d7ef4fef1ec937f465b4c038e05db35d681b131a4e05905c5cbe878865d'],
 ['tutorial_warning_02_1080x1760.png','6c021c9add485bc34a32f65a8b63134d4298e671f0210050400021d307146c67'],
 ['tutorial_warning_03_1080x1760.png','8d19c3c32bcc6653123228d58fc0dfa5384cb5d99abb8b19429e09a029e9c9ec'],
 ['tutorial_warning_04_1080x1760.png','9d769e25abb7aba351d78d205dc227c913efc6a9b43d421e6620f6a9e53cae59']
];
for(const [file,hash] of tutorialAssets){
 const path='img/tutorial/'+file;
 assert.ok(code.includes("image:'"+path+"'"),'missing slide image mapping '+path);
 const picture=fs.readFileSync(path);
 assert.equal(picture.subarray(0,8).toString('hex'),'89504e470d0a1a0a',path);
 assert.equal(picture.readUInt32BE(16),1080,path+' width');
 assert.equal(picture.readUInt32BE(20),1758,path+' height');
 assert.equal(crypto.createHash('sha256').update(picture).digest('hex'),hash,
  'image must match the exact user-uploaded PNG bytes: '+path);
}
assert.match(code,/alt="" aria-hidden="true"/);
assert.match(code,/const ratio=\(activeMode==='warning'&&activeSlides\[page\]\?\.image\)\?1080\/1758:9\/16/);
assert.match(css,/object-fit:contain/);
assert.match(css,/is-warning-image \.tutorial-title/);
assert.match(code,/#ee2c31/);
assert.match(code,/function warningHud\(/);
assert.match(code,/function warningGallery\(/);
assert.match(code,/function warningExhibit\(/);
assert.match(code,/warningHud\(21,page===1\?9:page===2\?0:10\)/);
assert.match(css,/aspect-ratio:9\/16/);
assert.match(css,/is-warning \.tutorial-copy/);
assert.match(css,/font-size:clamp\(16px,4\.4vw,19px\)/);
assert.match(code,/const labelSize=Math\.max\(13,Math\.min\(19,/);
assert.match(html,/solo_tutorial\.js\?v=20261030-warning-images4/);
assert.match(html,/solo_tutorial\.css\?v=20261029-warning-image1/);
assert.match(exhibitIndex,/experiment=warning_color[^"]*tutorial=1/);
assert.match(exhibitGame,/history\.replaceState/);
assert.match(exhibitIndex,/run=konchu2026_cryptic[^"]*tutorial=1/);
assert.match(exhibitGame,/GitaiSoloTutorial\?\.open\(\{ mode: tutorialMode \}\)/);
assert.match(exhibitGame,/\? 'warning' : 'solo'/);

function run(exhibit=false) {
 const elements=new Map(),paint=[];
 function node() {
  return {children:[],handlers:{},textContent:'',hidden:false,style:{},
   classList:{toggle(){}},setAttribute(){},focus(){},
   appendChild(x){this.children.push(x)},
   replaceChildren(...items){this.children=items},
   addEventListener(t,cb){this.handlers[t]=cb},
   getContext(){return new Proxy({},{
    get:(_,k)=>k==='drawImage'?(...args)=>paint.push(args):()=>{},
    set:()=>true
   });}
  };
 }
 const root=node();root.querySelector=sel=>{
  if(!elements.has(sel))elements.set(sel,node());
  return elements.get(sel);
 };
 class ImageStub {
  constructor(){this.complete=false;this.naturalWidth=0}
  set src(s){this.complete=true;this.naturalWidth=720;this.onload?.();}
 }
 const renderer={initialize:async()=>{},next:()=>({width:128,height:128,realSprite:true})};
 const context={window:{location:{pathname:exhibit?'/Gitai_Lab_Preview/exhibit/game.html':'/Gitai_Lab_Preview/'},
  GitaiPortalRandomMoth:renderer},Image:ImageStub,URL,console,
  document:{baseURI:'https://ganyujapan.github.io/Gitai_Lab_Preview/',
   activeElement:node(),getElementById:k=>k==='stage'?{appendChild(){}}:null,
   createElement:t=>t==='section'?root:node()}};
 vm.runInNewContext(code,context,{timeout:2500});
 const api=context.window.GitaiSoloTutorial;
 return {api,root,elements,paint,advance(){elements.get('#soloTutorialNext').handlers.click()}};
}
async function check() {
 const stable=run();
 stable.api.open({mode:'solo'});
 assert.equal(stable.elements.get('#soloTutorialStep').textContent,'01 / 04');
 stable.elements.get('#soloTutorialSkip').handlers.click();

 for(const exhibit of [false,true]){
  const h=run(exhibit);
  let finished=0;
  h.api.open({mode:'warning',onDone:()=>finished++});
  await new Promise(resolve=>setImmediate(resolve));
  const n=exhibit?7:6;
  assert.equal(h.elements.get('#soloTutorialProgress').children.length,n);
  assert.equal(h.elements.get('#soloTutorialImage').hidden,false,'warning first page uses authored image');
  assert.equal(h.elements.get('#soloTutorialCanvas').hidden,true,'image replaces canvas on first page');
  assert.match(h.elements.get('#soloTutorialImage').src,/img\/tutorial\/tutorial_warning_01_1080x1760\.png$/);
  const expected=[
   '毒蛾6匹と無毒蛾6匹、計12匹',
   'ハートが1つ減ります',
   '中毒死し、その世代は終了',
   '5ラウンド・60個体',
   '第21世代からスタート',
   'どんな模様に進化',
   '来場者のみなさんで'
  ];
  for(let i=0;i<n;i++){
   assert.equal(h.elements.get('#soloTutorialStep').textContent,
    String(i+1).padStart(2,'0')+' / '+String(n).padStart(2,'0'));
   assert.ok(h.elements.get('#soloTutorialText').textContent.includes(expected[i]));
   assert.equal(h.elements.get('#soloTutorialNext').textContent,i===n-1?'はじめる':'次へ');
   if(i<4){
    assert.equal(h.elements.get('#soloTutorialImage').hidden,false,
      'authored images must appear on pages 1-4');
    assert.equal(h.elements.get('#soloTutorialCanvas').hidden,true);
    assert.ok(h.elements.get('#soloTutorialImage').src.endsWith('/'+tutorialAssets[i][0]),
      'wrong image on slide '+(i+1));
   }else{
    assert.equal(h.elements.get('#soloTutorialImage').hidden,true,
      'pages 5-7 keep the current live Canvas');
    assert.equal(h.elements.get('#soloTutorialCanvas').hidden,false);
   }
   if(i<n-1)h.advance();
  }
  assert.equal(finished,0);
  assert.ok(h.paint.some(args=>args[0]?.realSprite),'moths use renderer sprites');
  h.advance();assert.equal(finished,1);assert.equal(h.api.isOpen,false);
 }
 console.log('Warning tutorial: exact PNGs on pages 1-4, Canvas on 5-7; six public, seven exhibit, no forced navigation.');
}
check().catch(e=>{console.error(e);process.exitCode=1;});
