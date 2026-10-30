'use strict';
// Execute the shipped marker-follow helper, not a duplicate algorithm.
// No IndexedDB or saved evolution records are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const from = script.indexOf('  function followCurrentMarker() {');
const to = script.indexOf('  function showFrame(index) {',from);
assert.ok(from >= 0 && to > from,'follow helper must precede showFrame');
assert.match(script.slice(to,to+1600),/followCurrentMarker\(\)/,
  'follow the generation actually drawn and highlighted');
const helper = script.slice(from,to);

const viewportLeft=100, viewportWidth=280, chipWidth=38, pitch=43;
const count=60;
let cursor=0;
const markers={
 hidden:false,clientWidth:viewportWidth,scrollWidth:count*pitch,scrollLeft:0,
 getBoundingClientRect(){return {left:viewportLeft,right:viewportLeft+viewportWidth,width:viewportWidth}},
 children:Array.from({length:count},(_,i)=>({
  getBoundingClientRect(){
   const left=viewportLeft+i*pitch-markers.scrollLeft;
   return {left,right:left+chipWidth,width:chipWidth};
  }
 }))
};
const sandbox={markers};
vm.runInNewContext(helper+'\nglobalThis.follow = followCurrentMarker;',sandbox,{
 filename:'exhibit/theater_canvas_20261026.js:followCurrentMarker',timeout:3000
});
function display(index){
 cursor=index;
 // The actual renderer updates cursor only AFTER decoding and drawing.
 sandbox.cursor=cursor;
 sandbox.follow();
 const marker=markers.children[cursor].getBoundingClientRect();
 const strip=markers.getBoundingClientRect();
 assert.ok(marker.left >= strip.left-0.001,'active generation hidden to left: '+(index+1));
 assert.ok(marker.right <= strip.right+0.001,'active generation hidden to right: '+(index+1));
}
for(let i=0;i<count;i++)display(i);
assert.ok(markers.scrollLeft>400,'the indicator should move past generation 33');
for(let i=count-1;i>=0;i--)display(i);
assert.equal(markers.scrollLeft,0,'older generation numbers must reappear on reverse playback');
markers.hidden=true;
markers.scrollLeft=100;
sandbox.cursor=40;
sandbox.follow();
assert.equal(markers.scrollLeft,100,'hidden markers must not be scrolled');
markers.hidden=false;
markers.clientWidth=markers.scrollWidth;
sandbox.follow();
assert.equal(markers.scrollLeft,100,'no scrolling when all markers fit');
console.log('Exhibition theater: all 60 generation labels remain visible during forward/back playback; no DB writes.');
