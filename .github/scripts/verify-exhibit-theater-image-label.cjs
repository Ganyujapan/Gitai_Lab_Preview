'use strict';
// RE2-PF-01: execute the actual exhibition theater's showFrame function.
// The fake decode and canvas are in-memory; no real user records are touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const a=src.indexOf('  function showFrame(index) {'),b=src.indexOf('  function finishHandover(',a);
assert.ok(a>0 && b>a);
const actual=src.slice(a,b);
assert.match(actual,/picture\.drawImage\(bitmap/);
assert.match(actual,/cursor = index/);
assert.ok(actual.indexOf('picture.drawImage(bitmap') < actual.indexOf('cursor = index'),
  'metadata must update only AFTER the new bitmap is painted');
assert.match(src,/pendingFrameIndex = null;/);
function delayed(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const marker = ()=> {
  const values=new Set();return {classList:{
    add:x=>values.add(x),remove:x=>values.delete(x),
    toggle(x,v){if(v)values.add(x);else values.delete(x)},
    contains:x=>values.has(x)
  }};
};
const frames=[1,2,3].map(n=>({generation_id:'gen'+String(n).padStart(5,'0')}));
const images=new Map();
const painted=[],followed=[];
const ctx={
 frames,cursor:0,pendingFrameIndex:null,frameLoadId:0,
 dialog:{hidden:false},canvas:{hidden:true,width:600,height:1000},
 picture:{drawImage:(img)=>painted.push(img.number)},
 markers:{children:frames.map(marker)},
 meta:{textContent:'読み込み中…'},counter:{textContent:'-- / --'},
 slider:{value:'0',max:'0'},
 previous:{disabled:true},next:{disabled:true},
 playedLabel:{hidden:true},stage:marker(),
 handoverData:{start:2,end:3},
 empty:{hidden:false,textContent:'loading'},
 numberOf:g=>Number(g.slice(3)),
 followCurrentMarker(){followed.push(ctx.cursor)},
 console:{warn:()=>{}},
 decodeFrame(index){
   if (!images.has(index))images.set(index,delayed());
   return images.get(index).promise;
 }
};
vm.runInNewContext(actual+'\nglobalThis.display=showFrame;',ctx,{
  filename:'exhibit/theater_canvas_20261026.js:showFrame',timeout:4000
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
(async()=>{
 ctx.display(2);assert.equal(ctx.cursor,0);
 assert.equal(ctx.meta.textContent,'読み込み中…');
 assert.equal(ctx.pendingFrameIndex,2);
 ctx.display(2);assert.equal(images.size,1,'same pending bitmap not restarted');
 images.get(2).resolve({number:3});
 await flush();
 assert.deepEqual(painted,[3]);
 assert.equal(ctx.cursor,2);
 assert.deepEqual(followed,[2],'follow the numbered frame only after its image is painted');
 assert.equal(ctx.meta.textContent,'第3世代 · 3 / 3枚');
 assert.equal(ctx.counter.textContent,'3 / 3');
 assert.equal(ctx.slider.value,'2');
 assert.equal(ctx.stage.classList.contains('is-played'),true);
 assert.equal(ctx.markers.children[2].classList.contains('is-current'),true);
 assert.equal(ctx.playedLabel.hidden,false);
 assert.equal(ctx.canvas.hidden,false);
 ctx.display(1);
 assert.equal(ctx.cursor,2,'pending decode preserves current image id');
 assert.equal(ctx.meta.textContent,'第3世代 · 3 / 3枚');
 images.get(1).reject(Error('corrupted generation 2'));
 await flush();
 assert.deepEqual(painted,[3],'failed bitmap never paints');
 assert.equal(ctx.cursor,2);
 assert.equal(ctx.meta.textContent,'第3世代 · 3 / 3枚',
   'failed generation must not borrow old image');
 assert.equal(ctx.slider.value,'2');
 assert.equal(ctx.empty.hidden,false,'visible old canvas still shows explicit load error');
 assert.match(ctx.empty.textContent,/前の世代の画像/);
 ctx.display(0);
 await flush();
 assert.equal(ctx.meta.textContent,'第3世代 · 3 / 3枚','slow decode keeps old label');
 images.get(0).resolve({number:1});
 await flush();
 assert.deepEqual(painted,[3,1]);
 assert.equal(ctx.cursor,0);
 assert.equal(ctx.meta.textContent,'第1世代 · 1 / 3枚');
 assert.equal(ctx.playedLabel.hidden,true);
 assert.equal(ctx.stage.classList.contains('is-played'),false);
 assert.equal(ctx.markers.children[2].classList.contains('is-current'),false);
 assert.equal(ctx.markers.children[0].classList.contains('is-current'),true);
 assert.equal(ctx.empty.hidden,true,'successful decode clears earlier error');

 const stale=delayed();
 images.set(1,stale);
 ctx.display(1);
 const latest=delayed();
 images.set(2,latest);
 ctx.display(2);
 latest.resolve({number:3});
 await flush();
 assert.equal(ctx.cursor,2);
 stale.reject(Error('old failed load'));
 await flush();
 assert.equal(ctx.cursor,2);
 assert.equal(ctx.meta.textContent,'第3世代 · 3 / 3枚');
 assert.equal(ctx.empty.hidden,true,'stale error cannot obscure newest image');
 // Closed viewer must not redraw or replace metadata after pending image.
 const closing=delayed();images.set(0,closing);
 ctx.display(0);ctx.dialog.hidden=true;
 closing.resolve({number:1});await flush();
 assert.equal(ctx.cursor,2);
 assert.deepEqual(painted,[3,1,3]);
 console.log('RE2-PF-01: actual theater labels, markers and canvas commit atomically; slow/corrupt/stale/closed requests safe.');
})().catch(e=>{console.error(e);process.exitCode=1});
