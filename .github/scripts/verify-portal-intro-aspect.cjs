'use strict';
// Execute the production title aspect layout and painter. This validates
// iPad/Split View/rotation geometry without touching any game or iPad data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/entertainment_portal.js','utf8');
const css=fs.readFileSync('css/entertainment_portal.css','utf8');
const publicHtml=fs.readFileSync('index.html','utf8');
const exhibitHtml=fs.readFileSync('exhibit/index.html','utf8');
const exhibitBuild=fs.readFileSync('exhibit/build.py','utf8');

const layoutStart=source.indexOf('  function resizeIntroCanvas() {');
const layoutEnd=source.indexOf('\n  function rectangle(',layoutStart);
const drawStart=source.indexOf('  function renderLineArtwork(timestamp) {');
const drawEnd=source.indexOf('\n  function renderScene(time) {',drawStart);
assert.ok(layoutStart>=0 && layoutEnd>layoutStart,'production adaptive layout exists');
assert.ok(drawStart>=0 && drawEnd>drawStart,'production intro painter exists');
const layoutCode=source.slice(layoutStart,layoutEnd);
const paintCode=source.slice(drawStart,drawEnd);
assert.match(css,/#entertainmentPortal \.portal-art\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%/);
for(const html of [publicHtml,exhibitHtml]) {
  assert.match(html,/src="js\/entertainment_portal\.js\?v=20261029-ipad-aspect1"/);
  assert.match(html,/<canvas id="portalArt"/);
}
assert.match(exhibitBuild,/shutil\.copytree\(site \/ folder, exhibit \/ folder/);
assert.match(source,/window\.addEventListener\('resize',[\s\S]*resizeIntroCanvas\(\)/);
assert.match(source,/\(event\.clientX - box\.left\) \* logicalWidth \/ box\.width/);
assert.match(source,/\(event\.clientY - box\.top\) \* lineHeight \/ box\.height/);

function harness(displayWidth,displayHeight) {
 const calls=[];
 const canvas={
   width:180,height:320,
   getBoundingClientRect(){return {width:displayWidth,height:displayHeight}}
 };
 const ctx={
   imageSmoothingEnabled:true,
   setTransform(...args){calls.push(['transform',...args])},
   drawImage(...args){calls.push(['image',...args])},
   fillRect(...args){calls.push(['fill',...args])},
   save(){calls.push(['save'])},restore(){calls.push(['restore'])},
   translate(...args){calls.push(['translate',...args])},
   beginPath(){},arc(...args){calls.push(['arc',...args])},
   stroke(){},bezierCurveTo(){},moveTo(){},lineTo(){}
 };
 const portal={clientWidth:displayWidth,clientHeight:displayHeight};
 const time=1000;
 const titleBackgroundImage={complete:true,naturalWidth:90};
 const titleMothCanvas={width:128,height:128};
 const tapBursts=[{x:displayWidth/displayHeight*320,y:320,time:time-200,hueOffset:20}];
 const context={canvas,ctx,portal,lineWidth:360,lineHeight:640,Math,
   titleBackgroundImage,titleMothCanvas,tapBursts,TITLE_MOTH_Y:350,
   RIPPLE_MS:1750};
 vm.runInNewContext(layoutCode+'\n'+paintCode+
   '\nthis.resize=resizeIntroCanvas;this.paint=renderLineArtwork;',context);
 return {canvas,calls,ctx,resize:context.resize,paint:context.paint,tapBursts};
}
for(const [w,h,label] of [
 [360,640,'design'],[390,844,'iPhone portrait'],
 [768,1024,'iPad portrait'],[820,1180,'iPad portrait tall'],
 [1024,768,'iPad landscape'],[1366,1024,'large iPad landscape'],
 [520,1024,'iPad Split View'],[660,880,'iPad narrow window']
]){
 const t=harness(w,h);
 assert.equal(t.resize(),true,label+' first resize');
 assert.equal(t.canvas.height,1280,label+' logical height remains 640 at 2x');
 assert.ok(Math.abs(t.canvas.width/t.canvas.height-w/h)<=0.5/1280+1e-9,
   label+' canvas CSS/backing aspect ratios must match');
 const cssX=w/t.canvas.width,cssY=h/t.canvas.height;
 assert.ok(Math.abs(cssX/cssY-1)<0.002,
   label+' moths/ripples must receive a uniform physical scale');
 assert.equal(t.resize(),false,label+' stable size must not clear still picture');
 t.paint(1000);
 const images=t.calls.filter(x=>x[0]==='image');
 assert.equal(images.length,2,label+' backdrop and 128px game moth rendered');
 assert.equal(images[0][4],t.canvas.width/2,label+' backdrop fills extra width');
 assert.equal(images[0][5],640,label+' backdrop fills height');
 assert.deepEqual(Array.from(images[1].slice(2)),[-119,-119,238,238],
   label+' real moth remains square in logical units');
 const translated=t.calls.find(x=>x[0]==='translate');
 assert.ok(translated);
 assert.equal(translated[1],t.canvas.width/4,label+' moth centered in viewport');
 assert.equal(translated[2],350);
 assert.ok(t.calls.filter(x=>x[0]==='arc').length>=2,
   label+' ripple circles actually drawn');
 const arcs=t.calls.filter(x=>x[0]==='arc');
 assert.ok(arcs.every(x=>x[3]>0 && x[4]===0 && x[5]===Math.PI*2),
   label+' ripples remain full circles');
 // Simulate an iPad resize in the same page rather than re-opening the title.
 const before=t.canvas.width;
 const otherWidth=w*0.73;
 t.canvas.getBoundingClientRect=()=>({width:otherWidth,height:h});
 assert.equal(t.resize(),true,label+' responsive after rotation or Split View');
 assert.notEqual(t.canvas.width,before);
}
console.log('PORTAL: actual title layout/painter preserves circular moth/ripples on iPhone/iPad, landscape, Split View, and resize; background fills canvas.');
