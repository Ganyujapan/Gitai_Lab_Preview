'use strict';
// PF06 stage 3: execute the real public theater controls with 1,000 frames.
// Only Blob URL ownership is optimized; generation records stay immutable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.html', 'utf8');
function part(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'production theater section missing: ' + start);
  return source.slice(a, b);
}
const helpers = part('  // PF06: keep object URLs for only the selected frame',
  '  function playEvolutionTheater() {');
const playback = part('  function playEvolutionTheater() {',
  '  async function showEvolutionTheater() {');
const openClose = part('  async function showEvolutionTheater() {',
  '  function shareNameStorageKey() {');
const code = 'let theaterRenderTicket = 0;\nlet theaterSession = 0;\n'
  + 'let theaterLoadingButtonLabel = null;\n'
  + helpers + '\n' + playback + '\n' + openClose
  + '\nglobalThis.theater = {open:showEvolutionTheater,'
  + ' close:closeEvolutionTheater,render:renderEvolutionTheaterFrame,'
  + ' play:playEvolutionTheater,pause:pauseEvolutionTheater};';

function frames(count) {
  return Array.from({length:count}, (_, i) => ({
    generation_id: 'gen' + String(i + 1).padStart(5, '0'),
    generation_number: i + 1,
    render_version: 2,
    model_label_ja: 'テスト',
    image_blob: new Blob(['frame-' + i])
  }));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {resolve=a; reject=b});
  return {promise, resolve, reject};
}
function harness(readFrames) {
  const state = {theaterFrames: [],theaterFrameIndex: 0,
    theaterObjectUrls: [],theaterTimerId: null};
  const created = [],revoked = [],active = new Set();
  const visible = new Set();
  const theaterFrameImage = {
    src: '',
    removeAttribute(name) {
      assert.equal(name, 'src');
      this.src = '';
    }
  };
  const theaterButton={disabled:false,textContent:'進化シアター'};
  const theaterOverlay={classList:{
    add(name){visible.add(name)},
    remove(name){visible.delete(name)},
    contains(name){return visible.has(name)}
  }};
  let tick=null, tickId=0, lastTickId=0;
  const ctx={
    state,Blob,Math,Number,String,Promise,console,Map,
    window:{GitaiTheaterScale:{needsRebuild:f=>f.render_version!==2},
      GitaiPagesPreview:{getEvolutionTheaterFrames:()=>readFrames()}},
    URL:{
      createObjectURL(blob) {
        assert.ok(blob instanceof Blob);
        const url='blob:theater-'+(++lastTickId);
        created.push(url);active.add(url);return url;
      },
      revokeObjectURL(url) {
        assert.ok(active.has(url),'duplicate or unknown URL revocation');
        revoked.push(url);active.delete(url);
      }
    },
    theaterFrameImage, theaterOverlay,theaterButton,
    theaterNote:{textContent:''},
    theaterMeta:{textContent:''},
    theaterProgress:{textContent:''},
    theaterSlider:{max:'0',value:'0'},
    theaterPrevButton:{disabled:false},
    theaterNextButton:{disabled:false},
    theaterPlayButton:{disabled:false,textContent:'再生'},
    theaterSpeed:{value:'150'},
    // All fixtures are already at the current render version. The production
    // upgrade function is separately exercised by the existing PF03 test.
    upgradeSavedTheaterFramesInBackground:async()=>{},
    clearInterval(id){if(id===tickId) tick=null},
    setInterval(fn){tick=fn;return ++tickId},
    alert(message){throw Error('unexpected theater alert: '+message)}
  };
  vm.runInNewContext(code,ctx,{timeout:4000,filename:'index.html:PF06'});
  return {
    ctx,state,created,revoked,active,theaterFrameImage,
    theaterButton,theaterOverlay,
    open:()=>ctx.theater.open(),
    close:()=>ctx.theater.close(),
    render:()=>ctx.theater.render(),
    play:()=>ctx.theater.play(),
    advance:()=>{assert.ok(tick);tick();}
  };
}
function assertWindow(h, radius=2) {
  const n=h.state.theaterFrameIndex, frames=h.state.theaterFrames;
  assert.ok(h.active.size <= radius*2+1,
    'never hold object URLs for all 1,000 frames');
  assert.equal(h.active.size,h.state.theaterObjectUrls.length);
  assert.equal(new Set(h.state.theaterObjectUrls).size,h.active.size);
  for(let i=0;i<frames.length;i++){
    const expected=Math.abs(i-n)<=radius;
    assert.equal(Boolean(frames[i].object_url),expected,
      'frame index '+i+' URL ownership does not match displayed window '+n);
  }
  assert.equal(h.theaterFrameImage.src,frames[n].object_url,
    'selected generation must display the correct Blob URL');
}

(async()=>{
  const h=harness(()=>Promise.resolve(frames(1000)));
  await h.open();
  assert.equal(h.state.theaterFrames.length,1000,
    'historical frames must not be deleted or silently trimmed');
  assert.equal(h.created.length,3,'first generation allocates only 3 URLs');
  assertWindow(h);
  assert.equal(h.ctx.theaterProgress.textContent,'1 / 1000');
  for(const index of [1,10,500,999,0,998]){
    h.state.theaterFrameIndex=index;
    h.render();assertWindow(h);
    assert.equal(h.ctx.theaterSlider.value,String(index));
    assert.equal(h.ctx.theaterMeta.textContent,
      '第'+String(index+1)+'世代 · テスト');
  }
  // Fast playback uses the existing interval and same URL bounds.
  h.state.theaterFrameIndex=0;h.render();
  h.play();h.advance();h.advance();
  assert.equal(h.state.theaterFrameIndex,2);
  assertWindow(h);
  h.play();assert.equal(h.state.theaterTimerId,null);
  h.close();
  assert.equal(h.active.size,0);
  assert.equal(h.state.theaterFrames.length,0);
  assert.equal(h.theaterFrameImage.src,'');
  assert.equal(h.created.length,h.revoked.length,
    'every allocated URL must be released once when closed');

  // A delayed IDB load completing AFTER close must never recreate 1,000 URLs,
  // resurrect the hidden overlay, or strand the open button disabled.
  const staleRead=deferred();
  const stale=harness(()=>staleRead.promise);
  const opening=stale.open();
  stale.close();
  staleRead.resolve(frames(1000));
  await opening;
  assert.equal(stale.created.length,0);
  assert.equal(stale.state.theaterFrames.length,0);
  assert.equal(stale.theaterOverlay.classList.contains('visible'),false);
  assert.equal(stale.theaterButton.disabled,false);
  assert.equal(stale.theaterButton.textContent,'進化シアター');

  // Overlapping opens: the old result must not replace the newer saved run.
  const old=deferred(),fresh=deferred();
  let reads=0;
  const race=harness(()=>++reads===1?old.promise:fresh.promise);
  const first=race.open();
  const second=race.open();
  fresh.resolve(frames(9));await second;
  assert.equal(race.state.theaterFrames.length,9);
  assertWindow(race);
  old.resolve(frames(1000));await first;
  assert.equal(race.state.theaterFrames.length,9);
  assertWindow(race);
  assert.equal(race.theaterButton.disabled,false);
  race.close();
  assert.equal(race.active.size,0);

  console.log('PF06: 1,000-frame window <=5 URLs, seek/playback, close/reopen, obsolete IDB reads and Blob cleanup OK.');
})().catch(error=>{console.error(error);process.exitCode=1});
