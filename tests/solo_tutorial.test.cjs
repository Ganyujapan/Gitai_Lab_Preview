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
test('tutorial launches on each menu entry and loads exact gameplay assets',()=>{
 assert.match(portal,/window\.GitaiSoloTutorial\.open\(\{ onDone: enterGame \}\)/);
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
