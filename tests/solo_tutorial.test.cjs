'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/solo_tutorial.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css/solo_tutorial.css'),'utf8');
const portal=fs.readFileSync(path.join(root,'js/entertainment_portal.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function harness(){
 const nodes=new Map(),draws=[],rendererDraws=[];
 let rendererInitializeCalls=0,rendererNextCalls=0,requestedBg=null;
 const rootElement=mockElement();
 rootElement.querySelector=id=>{
  if(!nodes.has(id))nodes.set(id,mockElement());
  return nodes.get(id);
 };
 const tutorialCanvas=rootElement.querySelector('#soloTutorialCanvas');
 tutorialCanvas.width=360;
 tutorialCanvas.height=640;
 const stage=mockElement();
 function mockElement(){
  return {
   hidden:false,children:[],handlers:{},textContent:'',width:0,height:0,
   classList:{toggle(){}},
   setAttribute(){},appendChild(x){this.children.push(x);},
   addEventListener(k,f){this.handlers[k]=f;},focus(){},
   getContext(){
    return new Proxy({},{
     get:(_target,k)=> k==='drawImage'
      ? (...args)=>draws.push(args)
      : ()=>{},
     set:()=>true
    });
   }
  };
 }
 class FakeImage{
  constructor(){this.complete=false;this.naturalWidth=0;this.naturalHeight=0;}
  set src(value){
   requestedBg=String(value);
   this.complete=true;this.naturalWidth=720;this.naturalHeight=1280;
   this.onload?.();
  }
  get src(){return requestedBg;}
 }
 const mockRenderer={
  initialize:async()=>{rendererInitializeCalls++;},
  next:()=>{
   rendererNextCalls++;
   return {width:128,height:128,isGameRendererSprite:true};
  }
 };
 const sandbox={
  document:{
   baseURI:'https://ganyujapan.github.io/Gitai_Lab_Preview/',
   activeElement:mockElement(),
   getElementById:k=>k==='stage'?stage:null,
   createElement:tag=>tag==='section'?rootElement:mockElement()
  },
  URL,Image:FakeImage,
  console,
  window:{GitaiPortalRandomMoth:mockRenderer}
 };
 vm.runInNewContext(source,sandbox,{timeout:1500});
 return {
  api:sandbox.window.GitaiSoloTutorial,rootElement,nodes,draws,
  get requestedBg(){return requestedBg},
  get rendererInitializeCalls(){return rendererInitializeCalls},
  get rendererNextCalls(){return rendererNextCalls},
  click:k=>nodes.get(k).handlers.click(),
  async settle(){await new Promise(resolve=>setImmediate(resolve));}
 };
}
test('tapping Solo presents the four screens BEFORE any habitat picker',()=>{
 const entry=portal.slice(portal.indexOf('  function beginSoloTutorial() {'),
   portal.indexOf("  shared.addEventListener('click'"));
 const start=portal.slice(portal.indexOf('  function startSolo() {'),
   portal.indexOf('  function randomizeTitleMoth() {'));
 assert.match(entry,/solo\.addEventListener\('click', \(\) => \{\s*if \(ensureNickname\(\)\) beginSoloTutorial\(\)/);
 assert.match(entry,/window\.GitaiSoloTutorial\.open\(\{ onDone: showEnvironmentPicker \}\)/);
 assert.doesNotMatch(entry,/startSolo\(\)/);
 assert.doesNotMatch(start,/GitaiSoloTutorial/);
 assert.match(portal,/if \(entry\?\.unlocked && entry\.playable && ensureNickname\(\)\) startSolo\(\)/);
});
test('the tutorial always uses the exact Leaf 1 photo and game moth renderer, independently of selected habitat',async()=>{
 const h=harness();
 h.api.open();
 assert.equal(h.api.isOpen,true,'tutorial must appear immediately');
 assert.equal(h.rootElement.hidden,false);
 await h.settle();
 assert.match(h.requestedBg,/\/img\/backgrounds\/bg_leaf01\.png$/);
 assert.equal(h.rendererInitializeCalls,1);
 assert.equal(h.rendererNextCalls,12);
 assert.ok(h.draws.some(d=>d[0]?.naturalWidth===720),'real Leaf 1 photo drawn');
 assert.ok(h.draws.some(d=>d[0]?.isGameRendererSprite),'game renderer generated actual moth graphics');
 assert.doesNotMatch(source,/GitaiSoloTutorialAssets|state\.backgroundImage/);
 assert.doesNotMatch(source,/Math\.random|createGenome|indexedDB|localStorage/);
});
test('the four pages contain the exact approved copy and Next/Skip work',async()=>{
 const h=harness();
 let completed=0;
 h.api.open({onDone:()=>completed++});
 await h.settle();
 const expected=[
  'あなたは蛾を食べる捕食者です。\nタップすることで蛾を食べることが出来ます。',
  '1世代あたり60匹の蛾が表示されます。\n食べられずに生き残った蛾が親となり、次の世代の子を作ります。',
  'あなたは背景に似ている蛾を残し、似ていない蛾だけを積極的に食べていくことで、蛾の模様が背景にギタイしていきます。',
  '究極にギタイした蛾を作ることが目的です。\nお気に入りの蛾は標本箱に入れられます。'
 ];
 for(let i=0;i<4;i++){
  const number=h.nodes.get('#soloTutorialStep');
  assert.equal(number.textContent,String(i+1).padStart(2,'0')+' / 04');
  assert.equal(h.nodes.get('#soloTutorialText').textContent,expected[i]);
  assert.equal(h.nodes.get('#soloTutorialNext').textContent,i===3?'はじめる':'次へ');
  if(i!==3)h.click('#soloTutorialNext');
 }
 assert.equal(completed,0);
 h.click('#soloTutorialNext');
 assert.equal(completed,1);
 assert.equal(h.api.isOpen,false);
 h.api.open({onDone:()=>completed++});
 assert.equal(h.nodes.get('#soloTutorialStep').textContent,'01 / 04');
 h.click('#soloTutorialSkip');
 assert.equal(completed,2);
});
test('tutorial overlays portal and forces a new Safari script version',()=>{
 assert.match(css,/#soloTutorialOverlay\{[^}]*z-index:110/s);
 assert.match(css,/#soloTutorialOverlay \.tutorial-copy\{[^}]*white-space:pre-line/s);
 assert.match(css,/aspect-ratio:9\/16/);
 assert.match(html,/js\/solo_tutorial\.js\?v=20261018-tutorial3/);
 assert.match(html,/js\/entertainment_portal\.js\?v=20261018-tutorial3/);
 assert.match(html,/css\/solo_tutorial\.css\?v=20261018-tutorial3/);
 const tutorialScript=html.indexOf('js/solo_tutorial.js?v=');
 const portalScript=html.indexOf('js/entertainment_portal.js?v=');
 assert.ok(tutorialScript>0 && tutorialScript<portalScript,'tutorial is ready before mode click handler');
 assert.match(portal,/window\.GitaiTrophies\.open\(\{ onChoose: playEnvironment \}\)/);
});
