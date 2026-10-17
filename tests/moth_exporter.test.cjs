// Run: NODE_PATH=<directory containing playwright> node tests/moth_exporter.test.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function drawingFunctions(source){return ['clamp','clamp01','seededUnit','circularLerpDeg','hsvToRgb','setPixelMirrored','locusExpression','moduleMaskValue','renderGenome'].map(name=>{const start=source.indexOf('  function '+name+'(');let end=source.indexOf('\n  function ',start+1);if(name==='locusExpression')end=source.indexOf('\n  async function fetchJson',start);assert(start>=0&&end>start);return source.slice(start,end).trim();}).join('\n');}
(async()=>{
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png'})[ext]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/dev/moth_exporter.html');
const seeds=JSON.parse(fs.readFileSync(path.join(root,'research/calibration/high_rating_seed_genomes_v1.json'))).seeds;
const reference=drawingFunctions(fs.readFileSync(path.join(root,'dev/gitai_score_lab.js'),'utf8'));
const result=await page.evaluate(async({seeds,reference})=>{
const api=await import('/js/moth_renderer.mjs');const config=await(await fetch('/data/evolution_models/continuous_v1/config.json')).json();const genetics=config.trait_genetics;
const image=new Image();image.src=window.GitaiPreviewMaskDataUri;await image.decode();const c=document.createElement('canvas');c.width=c.height=128;const cx=c.getContext('2d');cx.drawImage(image,0,0,128,128);const rgba=cx.getImageData(0,0,128,128).data;const mask=new Uint8Array(16384),templateAlpha=new Uint8Array(16384);for(let i=0;i<16384;i++){templateAlpha[i]=rgba[i*4+3];mask[i]=templateAlpha[i]>0?1:0;}
const render=new Function('genetics','mask','templateAlpha','const SIZE=128,HALF=64;'+reference+';return renderGenome;')(genetics,mask,templateAlpha);
let transparent=0;
for(const s of seeds){const original=JSON.stringify(s.genome);const expected=render(s.genome),actual=await api.renderImageData(s.genome);if(!actual.data.every((x,i)=>x===expected.data[i]))throw Error('RGBA mismatch: '+s.id);if(original!==JSON.stringify(s.genome))throw Error('Genome modified');transparent+=actual.data.filter((x,i)=>i%4===3&&x===0).length;
const blob=await api.toPNG(s.genome);const bitmap=await createImageBitmap(blob);if(bitmap.width!==128||bitmap.height!==128)throw Error('PNG size');cx.clearRect(0,0,128,128);cx.drawImage(bitmap,0,0);const png=cx.getImageData(0,0,128,128).data;cx.putImageData(expected,0,0);const referenceCanvas=cx.getImageData(0,0,128,128).data;if(!png.every((x,i)=>x===referenceCanvas[i]))throw Error('PNG mismatch');bitmap.close();}
for(const bad of [{schema_version:2},{schema_version:1,modules:{},baseHue:'bad'}]){let rejected=false;try{await api.renderImageData(bad);}catch{rejected=true;}if(!rejected)throw Error('Invalid input accepted');}
return {genomes:seeds.length,transparent};
},{seeds,reference});assert(result.transparent>0);
await page.locator('#json').fill(JSON.stringify(seeds[0].genome));await page.locator('#render').click();await page.locator('#png').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#png').disabled);
let first;
for(const name of ['葉1','葉2','樹皮']){await page.getByRole('button',{name,exact:true}).click();const downloadEvent=page.waitForEvent('download');await page.locator('#png').click();const download=await downloadEvent;const data=fs.readFileSync(await download.path());assert.equal(data.readUInt32BE(16),128);assert.equal(data.readUInt32BE(20),128);if(first)assert.deepEqual(data,first);first=data;}
await page.locator('#json').fill('{broken');assert(await page.locator('#png').isDisabled());await page.locator('#render').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('エラー'));
await page.locator('#json').fill(JSON.stringify(seeds[0].genome));await page.locator('#render').click();await page.waitForFunction(()=>!document.querySelector('#png').disabled);await page.screenshot({path:'/tmp/moth-exporter-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/moth-exporter-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS',result,'RGBA一致・PNG一致・3背景ダウンロード一致・不正入力・モバイル幅');
}finally{if(browser)await browser.close();server.close();server.closeAllConnections();}
})().catch(e=>{console.error(e);process.exitCode=1;});
