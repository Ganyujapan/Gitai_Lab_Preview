'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'js/solo_tutorial.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css/solo_tutorial.css'),'utf8');
const portal=fs.readFileSync(path.join(root,'js/entertainment_portal.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function harness(){
 const nodes=new Map(),art=[];
 function el(){
  return {hidden:false,children:[],handlers:{},textContent:'',classList:{toggle(){}},
    setAttribute(){},appendChild(x){this.children.push(x);},
    addEventListener(k,fn){this.handlers[k]=fn;},focus(){},
    getContext(){return new Proxy({},{
      get:(_obj,k)=>k==='drawImage'?(...args)=>art.push(args):()=>{},
      set:()=>true
    });}
  };
 }
 const stage=el(),panel=el();
 panel.querySelector=k=>{if(!nodes.has(k))nodes.set(k,el());return nodes.get(k);};
 const view=panel.querySelector('#soloTutorialCanvas');view.width=360;view.height=640;
 const context={
  document:{activeElement:el(),getElementById:k=>k==='stage'?stage:null,createElement:t=>t==='section'?panel:el()},
  window:{GitaiSoloTutorialAssets:()=>({
   background:{complete:true,naturalWidth:720},
   moths:Array.from({length:60},()=>({complete:true,naturalWidth:128})),
   size:38,generation:7
  })}
 };
 vm.runInNewContext(js,context,{timeout:1500});
 return {api:context.window.GitaiSoloTutorial,nodes,art,panel,click:k=>nodes.get(k).handlers.click()};
}
test('each of the four tutorial steps and skip have predictable behavior',()=>{
 const h=harness();let done=0;h.api.open({onDone:()=>done++});
 const n=h.nodes.get('#soloTutorialStep');
 assert.equal(n.textContent,'01 / 04');
 assert.ok(h.art.some(args=>args[0].naturalWidth===720));
 assert.ok(h.art.some(args=>args[0].naturalWidth===128));
 for(let k=2;k<=4;k++){h.click('#soloTutorialNext');assert.equal(n.textContent,'0'+k+' / 04');}
 assert.equal(h.nodes.get('#soloTutorialNext').textContent,'はじめる');
 h.click('#soloTutorialNext');assert.equal(done,1);
 assert.equal(h.api.isOpen,false);
 h.api.open({onDone:()=>done++});assert.equal(n.textContent,'01 / 04');
 h.click('#soloTutorialSkip');assert.equal(done,2);
});
test('tutorial opens BEFORE habitat choice and cannot reopen after changing background',()=>{
 const modeEntry=portal.slice(portal.indexOf("  function beginSoloTutorial() {"),
   portal.indexOf("  shared.addEventListener('click'"));
 const gameplayEntry=portal.slice(portal.indexOf("  function startSolo() {"),
   portal.indexOf("  function randomizeTitleMoth() {"));
 assert.match(modeEntry,/window\.GitaiSoloTutorial\.open\(\{ onDone: showEnvironmentPicker \}\)/);
 assert.match(modeEntry,/if \(ensureNickname\(\)\) beginSoloTutorial\(\)/);
 assert.doesNotMatch(modeEntry,/startSolo\(\)/);
 assert.doesNotMatch(gameplayEntry,/GitaiSoloTutorial/);
 assert.match(portal,/if \(entry\?\.unlocked && entry\.playable && ensureNickname\(\)\) startSolo\(\)/);
 assert.match(portal,/gitai:solo-assets-ready/);
 assert.match(html,/window\.GitaiSoloTutorialAssets = \(\) => \(\{/);
 assert.match(html,/background: state\.backgroundImage/);
 assert.match(html,/moths: state\.mothImages/);
 assert.match(html,/window\.GitaiSoloTutorial\?\.refreshAssets\(\)/);
 assert.match(html,/js\/solo_tutorial\.js\?v=20261017-tutorial1/);
 assert.match(html,/css\/solo_tutorial\.css\?v=20261017-tutorial1/);
});
test('gameplay remains separate and tap-zoom resistant',()=>{
 assert.match(css,/#soloTutorialOverlay\{[^}]*z-index:110/s);
 assert.match(css,/aspect-ratio:9\/16/);
 assert.match(js,/id="soloTutorialSkip"/);
 assert.match(js,/id="soloTutorialNext"/);
 assert.doesNotMatch(js,/indexedDB|localStorage|createGenome|Math\.random/);
});

test('tutorial displays the approved Japanese copy in the intended order',()=>{
 const approved=[
  'あなたは蛾を食べる捕食者です。\\nタップすることで蛾を食べることが出来ます。',
  '1世代あたり60匹の蛾が表示されます。\\n食べられずに生き残った蛾が親となり、次の世代の子を作ります。',
  'あなたは背景に似ている蛾を残し、似ていない蛾だけを積極的に食べていくことで、蛾の模様が背景にギタイしていきます。',
  '究極にギタイした蛾を作ることが目的です。\\nお気に入りの蛾は標本箱に入れられます。'
 ];
 for(let index=0;index<approved.length;index++){
  const phrase=approved[index];
  const expected=phrase.replace(/\\\\n/g, '\\n');
  assert.ok(js.includes("description:'"+expected+"'"),'missing exact copy at slide '+(index+1));
 }
 assert.match(css,/white-space:pre-line/);
 assert.equal((js.match(/\{heading:/g)||[]).length,4);
});
