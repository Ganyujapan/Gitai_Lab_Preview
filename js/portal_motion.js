/* GITAI LAB entrance animation. Game logic remains untouched. */
(() => {
'use strict';
const params=new URLSearchParams(location.search);
if((params.get('model')||'continuous_v1')!=='continuous_v1'||params.get('play')==='1')return;
const portal=document.getElementById('entertainmentPortal');
const intro=document.getElementById('portalIntro');
if(!portal||!intro||!Array.isArray(window.GitaiPortalScene))return;
window.GitaiPortalMotion={enabled:true};
portal.classList.add('portal-motion-enabled');
const scene=document.createElement('div');
scene.className='portal-motion-scene';
scene.setAttribute('aria-hidden','true');
const art=document.createElement('div');
art.className='portal-motion-art';
scene.appendChild(art);
intro.insertBefore(scene,intro.firstChild);
const layers=window.GitaiPortalScene.map(s=>{
 const outer=document.createElement('div');
 outer.className='portal-sprite portal-sprite-'+s.kind;
 outer.style.setProperty('--x',s.x+'%');
 outer.style.setProperty('--y',s.y+'%');
 outer.style.setProperty('--w',s.w+'vw');
 outer.style.setProperty('--max-w',s.max+'px');
 outer.style.setProperty('--duration',s.drift+'s');
 outer.style.setProperty('--phase',s.phase+'s');
 outer.style.setProperty('--spin',(s.spin||0)+'deg');
 outer.style.zIndex=String(s.z);
 outer.dataset.sprite=s.id;
 const float=document.createElement('div');
 float.className='portal-sprite-float';
 const img=document.createElement('img');
 img.src='img/portal/'+s.asset;
 img.alt='';
 img.draggable=false;
 img.decoding='async';
 float.appendChild(img);
 outer.appendChild(float);
 art.appendChild(outer);
 return {element:outer,depth:s.depth};
});
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let desiredX=0,desiredY=0,x=0,y=0,raf=0,running=false;
const canRun=()=>!reduced.matches&&!document.hidden&&!portal.hidden&&intro.classList.contains('is-active');
function tick(){
 if(!canRun()){running=false;raf=0;return;}
 x+=(desiredX-x)*.055;
 y+=(desiredY-y)*.055;
 for(const layer of layers){
  layer.element.style.transform='translate3d('+(x*layer.depth*7).toFixed(2)+'px,'+(y*layer.depth*7).toFixed(2)+'px,0) translate(-50%,-50%)';
 }
 raf=requestAnimationFrame(tick);
}
function refresh(){
 const should=canRun();
 scene.classList.toggle('is-paused',!should);
 if(should&&!running){running=true;raf=requestAnimationFrame(tick);}
 if(!should){cancelAnimationFrame(raf);raf=0;running=false;}
}
intro.addEventListener('pointermove',event=>{
 if(event.pointerType==='touch')return;
 const rect=intro.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 desiredX=Math.max(-1,Math.min(1,((event.clientX-rect.left)/rect.width-.5)*2));
 desiredY=Math.max(-1,Math.min(1,((event.clientY-rect.top)/rect.height-.5)*2));
},{passive:true});
intro.addEventListener('pointerleave',()=>{desiredX=0;desiredY=0;},{passive:true});
intro.addEventListener('pointerdown',event=>{
 if(event.button>0||!intro.classList.contains('is-active')||reduced.matches)return;
 const rect=intro.getBoundingClientRect();
 const ring=document.createElement('span');
 ring.className='portal-touch-ring';
 ring.style.left=(event.clientX-rect.left)+'px';
 ring.style.top=(event.clientY-rect.top)+'px';
 scene.appendChild(ring);
 ring.addEventListener('animationend',()=>ring.remove(),{once:true});
 if(event.pointerType==='touch'){
  desiredX=((event.clientX-rect.left)/rect.width-.5)*1.1;
  desiredY=((event.clientY-rect.top)/rect.height-.5)*1.1;
 }
},{passive:true});
document.addEventListener('visibilitychange',refresh);
reduced.addEventListener?.('change',refresh);
new MutationObserver(refresh).observe(intro,{attributes:true,attributeFilter:['class']});
new MutationObserver(refresh).observe(portal,{attributes:true,attributeFilter:['hidden']});
refresh();
})();