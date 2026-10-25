/* CI-only regression: actual audio bytes, routing, concurrency and fallbacks.
 * Safe to run in public CI; no private test code in Pages artifact. */
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const blobs = {
  'opus/capture_01.ogg': 'a8ee662e21005335d481bb6ede04a495da40e124',
  'aac/capture_01.m4a': '6d4e977f38f07712bc933e1b1942b83be98a5b69',
  'opus/capture_02.ogg': '7df4f9bc6508d5a3279e3539022f209fa9e16665',
  'aac/capture_02.m4a': '4bd761a32a8215b318ca5c786d7e00de621dd9f1',
  'opus/capture_03.ogg': 'b968d90ac1a24306d5ffb256f463bdf67e787dbb',
  'aac/capture_03.m4a': '94e9a3fee57a2cf98a643dcd7bf6735a4c1ff688',
  'opus/capture_04.ogg': '5a59bd1f8880fd6414016bba41bd7b801e55153b',
  'aac/capture_04.m4a': 'ea3f2491d131c36f368d13992fa984b960de0d35',
  'opus/poison_01.ogg': '0a59ba923738cbd0ff3ad58f0600558ecdc336b2',
  'aac/poison_01.m4a': '4595c90512bab402c40502bab801c7855a9f572c',
  'opus/poison_02.ogg': '79d6cc355cd85a4dd7ab24ca7a12fb8078760104',
  'aac/poison_02.m4a': '8ee30324667e93b973889b91cb080c823222851b',
  'opus/poison_03.ogg': '78ec09750372c5f46c4c1056fab3e834ab426475',
  'aac/poison_03.m4a': '2a2be57207f1eaeba885fc23ff3148c98393e647',
  'opus/poison_04.ogg': '94bfc9cfbfd6013b76031b6b0cfecb8a5857c569',
  'aac/poison_04.m4a': 'f374a6702067b5bec9e9f8271d57527cf3ec5077',
  'opus/death_01.ogg': '47c719b42c0e60d69fcb4666a97eadddc0f69b94',
  'aac/death_01.m4a': '3d5a93f2d66c4995a5bc3b1d4445efe9a13875aa',
  'opus/death_02.ogg': 'f10359357567689a749a8883e799aac435404ac8',
  'aac/death_02.m4a': 'f351d144a860e8cf9b7415dba3c31537a8009c42'
};
for (const [rel, hash] of Object.entries(blobs)) {
  const file = 'audio/sfx/' + rel;
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 1000, 'Audio too small: ' + file);
  assert.equal(crypto.createHash('sha1').update('blob ' + bytes.length + '\0')
    .update(bytes).digest('hex'), hash, 'Unexpected audio bytes: ' + file);
  assert.ok(rel.endsWith('.ogg') ? bytes.toString('ascii',0,4) === 'OggS'
    : bytes.toString('ascii',4,8) === 'ftyp', 'Audio format broken: ' + file);
}
const index = fs.readFileSync('index.html','utf8');
const portal = fs.readFileSync('js/entertainment_portal.js','utf8');
const code = fs.readFileSync('js/game_sfx.js','utf8');
const tutorial = fs.readFileSync('js/solo_tutorial.js','utf8');
const tutorialCss = fs.readFileSync('css/solo_tutorial.css','utf8');
const ambient = fs.readFileSync('js/ambient_audio.js','utf8');
const manifest = JSON.parse(fs.readFileSync('audio/sfx/manifest.json','utf8'));
assert.equal(manifest.formats.length,2);
assert.deepEqual(manifest.volumes, {capture:0.1935,poison:0.1835,death:0.64});
assert.match(code, /const VOLUME = Object\.freeze\(\{ capture: 0\.1935, poison: 0\.1835, death: 0\.64 \}\)/);
assert.match(index,/<script src="js\/game_sfx\.js\?v=[^"]+"><\/script>/);
assert.doesNotMatch(index,/predationWavUrl|predationToneUrls|predationSound\(/);
assert.match(index,/window\.GitaiGameSfx\?\.play\(/);
assert.match(index,/WARNING\.adjustLife\(state\.warningLifeThirds, sfxKind\) === 0/);
assert.match(code,/getRandomValues/);
assert.doesNotMatch(code,/Math\.random\(/);
assert.match(code,/source\.start\(0\)/);
assert.match(code,/cache: 'force-cache'/);
assert.match(code,/previousClockMs/);
assert.match(code,/if \(iosDevice\) \{/);
assert.match(code,/if \(iosDevice \|\| context \|\| !AudioContextCtor\)/);
assert.match(code,/ctx\.currentTime - previousClockSec < 0\.015/);
assert.match(code,/document\.addEventListener\('pointerup', flushTouchSound/);
assert.match(code,/const format = touchDevice \? 'aac' : formats\[0\]/);
assert.match(tutorialCss,/#soloTutorialOverlay \.tutorial-viewport\{[^}]*width:100%/);
assert.match(tutorial,/canvasWrap\.style\.width=width\+'px'/);
assert.match(tutorial,/canvasWrap\.style\.height=\(width\*16\/9\)\+'px'/);
assert.match(ambient,/iosMediaGestureRequired/);
const files=Object.keys(blobs);
assert.equal(files.filter(x=>x.startsWith('opus/')).length,10);
assert.equal(files.filter(x=>x.startsWith('aac/')).length,10);

// In-process WebAudio fake tests that don't depend on browsers, network or soundcard.
async function mock({ webaudio=true, ogg=true, failDecodeOgg=false, failNative=false, touch=false, ios=false }={}) {
  let random=0;
  const starts=[],nativePlays=[],stops=[],fetches=[],listeners=[];
  const soundBuffers=[];
  class TestContext {
    constructor() { this.state='running'; this.destination={}; }
    createDynamicsCompressor() { return {threshold:{},knee:{},ratio:{},attack:{},release:{},connect(){}}; }
    createGain() { return {gain:{},connect(){},disconnect(){}}; }
    createBufferSource() {
      const node={buffer:null,onended:null,connect(){},disconnect(){},
        start() {starts.push(this.buffer.path);},
        stop() {stops.push(this.buffer?.path);this.onended?.();}};
      soundBuffers.push(node);
      return node;
    }
    decodeAudioData(bytes) {
      if(failDecodeOgg && bytes.path.includes('/opus/')) return Promise.reject(Error('Ogg unsupported'));
      return Promise.resolve({path:bytes.path});
    }
    resume() {this.state='running';return Promise.resolve();}
  }
  function element() {
    return {volume:1,paused:true,src:'',preload:'',playsInline:false,
      canPlayType:()=>ogg?'probably':'',
      load(){},
      addEventListener(){},
      pause(){this.paused=true;},
      play(){this.paused=false;nativePlays.push(this.src);
        if(failNative)throw Error('Playback denied');
        return Promise.resolve();}};
  }
  const window = {
    navigator: { maxTouchPoints: touch ? 5 : 0, userAgent: ios ? 'iPad Safari' : '', platform: ios ? 'MacIntel' : '' },
    AudioContext: webaudio ? TestContext : null,
    crypto:{getRandomValues(arr){arr[0]=random++;return arr;}},
    fetch:async (path)=>{fetches.push(path);return {ok:true,arrayBuffer:async()=>({path})};}
  };
  const document={createElement:()=>element(),addEventListener:(type,cb)=>listeners.push([type,cb])};
  vm.runInNewContext(code,{window,document,Date,Promise,Uint32Array,Map,Object,Math,Array,Set}, {filename:'game_sfx.js'});
  await window.GitaiGameSfx.prepare();
  return {api:window.GitaiGameSfx,starts,nativePlays,stops,fetches,listeners,soundBuffers};
}
(async()=>{
  const a=await mock();
  for(let i=0;i<4;i++)a.api.play('capture');
  for(let i=0;i<4;i++)a.api.play('poison');
  for(let i=0;i<2;i++)a.api.play('death');
  for (const [group,count] of [['capture',4],['poison',4],['death',2]]) {
    const played=a.starts.filter(s=>s.includes('/'+group+'_'));
    assert.equal(played.length,count,group);
    assert.equal(new Set(played).size,count,group+' variants');
  }
  assert.equal(a.nativePlays.length,0,'WebAudio should be preferred after decode');
  assert.ok(a.stops.every(s=>s.includes('/poison_')),'Death must stop lingering poison');
  assert.equal(a.fetches.filter(s=>s.includes('/opus/')).length,10);
  assert.deepEqual(Object.keys(a.api.volumes).sort(),['capture','death','poison']);
  assert.ok(a.listeners.some(x=>x[0]==='pointerdown'));
  for(let i=0;i<40;i++)a.api.play('capture');
  assert.ok(a.stops.length>0,'voice cap should prevent excess overlap');
  const b=await mock({failDecodeOgg:true});
  b.api.play('poison');
  assert.ok(b.starts[0].includes('/aac/poison_'), 'AAC decoding fallback');
  const c=await mock({webaudio:false,ogg:false});
  c.api.play('capture');
  assert.ok(c.nativePlays[0].includes('/aac/capture_'),'iOS native AAC fallback');
  // Safari touch needs a real pointerup/touchend for native AAC media.
  const ipad=await mock({webaudio:true,ogg:true,touch:true,ios:true});
  assert.equal(ipad.fetches.length,0,'iOS must avoid eager Web Audio decoding');
  ipad.api.play('poison');
  assert.equal(ipad.starts.length,0,'iOS must not switch to Web Audio');
  assert.equal(ipad.nativePlays.length,0,'No premature native play on touch pointerdown');
  ipad.listeners.find(e=>e[0]==='pointerup')[1]();
  assert.equal(ipad.nativePlays.length,1);
  assert.ok(ipad.nativePlays[0].includes('/aac/poison_'));
  ipad.api.play('capture');
  ipad.listeners.find(e=>e[0]==='pointerup')[1]();
  ipad.api.play('death');
  ipad.listeners.find(e=>e[0]==='pointerup')[1]();
  assert.equal(ipad.nativePlays.length,3,'Poison, capture and death all have independent native voices');
  assert.equal(ipad.starts.length,0);
  assert.ok(ipad.nativePlays[1].includes('/aac/capture_'));
  assert.ok(ipad.nativePlays[2].includes('/aac/death_'));
  const d=await mock({webaudio:false,ogg:false,failNative:true});
  assert.doesNotThrow(()=>d.api.play('death'),'Audio errors must never stop gameplay');
  console.log('SFX verified: 20 files, 10 variants, AAC fallback, voice cap, death suppression, nonblocking sound.');
})().catch(err=>{console.error(err);process.exitCode=1;});

// Warning mode entry must never reload on card tap: preserve playing native
// ambient HTMLAudioElements through the whole four-page tutorial.
{
  const startMarker = '  function beginWarningExperiment() {';
  const endMarker = "  solo.addEventListener('click', openEvolutionModePicker);";
  const begin = portal.indexOf(startMarker);
  const end = portal.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, 'Missing warning-mode selection handler');
  const source = portal.slice(begin, end);
  assert.match(source, /GitaiSoloTutorial\?\.open/);
  assert.match(source, /mode:\s*'warning'/);
  const navigations = [];
  const tutorials = [];
  const windowMock = {
    location: {
      href: 'https://ganyujapan.github.io/Gitai_Lab_Preview/?model=continuous_v1&env=leaf_002&slot=test&run=other',
      assign: url => navigations.push(url)
    },
    GitaiSoloTutorial: {open: opts => tutorials.push(opts)}
  };
  const beginWarning = new Function('window', source + '; return beginWarningExperiment;')(windowMock);
  beginWarning();
  assert.equal(navigations.length, 0, 'Tapping warning card must not navigate or cut BGM');
  assert.equal(tutorials.length, 1);
  assert.equal(tutorials[0].mode, 'warning');
  tutorials[0].onDone();
  assert.equal(navigations.length, 1, 'Finishing tutorial must navigate exactly once');
  const dest = new URL(navigations[0]);
  assert.equal(dest.searchParams.get('experiment'), 'warning_color');
  assert.equal(dest.searchParams.get('env'), 'kusagi_001');
  assert.equal(dest.searchParams.get('run'), 'warning_color_fog_v2');
  assert.equal(dest.searchParams.get('fog'), '1');
  assert.equal(dest.searchParams.get('portal'), 'auto-play-warning');
  assert.equal(dest.searchParams.has('slot'), false);
  assert.equal(dest.searchParams.has('play'), false);
  assert.equal(dest.searchParams.get('model'), 'continuous_v1');
  windowMock.GitaiSoloTutorial = null;
  beginWarning();
  assert.equal(navigations.length, 2, 'Tutorial-unavailable fallback still opens game');
}
