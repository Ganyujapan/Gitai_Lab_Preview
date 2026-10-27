'use strict';
// EV-08: execute the REAL capture-time stopwatch helpers from the HTML game,
// using a deterministic monotonic clock, without DOM, network or IndexedDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const begin = html.indexOf('  function resetRoundElapsedClock(');
const finish = html.indexOf('  // A return to the menu pauses', begin);
assert.ok(begin >= 0 && finish > begin, 'Active-time stopwatch helpers missing');
const helpers = html.slice(begin, finish);
assert.doesNotMatch(helpers, /Math\.random|indexedDB|localStorage|\bfetch\(|Date\.now|setTimeout|setInterval/);
assert.match(helpers, /Math\.max\(0, at - state\.roundElapsedResumedAt\)/);
assert.match(helpers, /!state\.roundActive\s*\|\|\s*state\.soloPaused\s*\|\|\s*state\.toxinPaused/);
function harness() {
  let now = 0;
  const state = {
    roundElapsedMs:0, roundElapsedResumedAt:null,
    roundActive:false, soloPaused:false, toxinPaused:false
  };
  const context={state,performance:{now:()=>now}};
  vm.runInNewContext(helpers+`
  globalThis.api = {
    reset:resetRoundElapsedClock,
    freeze:freezeRoundElapsedClock,
    resume:resumeRoundElapsedClock,
    elapsed:currentRoundElapsedMs
  };`,context,{filename:'index.html:EV08 active clock',timeout:1000});
  return {state,api:context.api,
    at(value){now=value;},
    elapsed(){return context.api.elapsed();}};
}

// Ordinary four-second round: clock advances with live taps.
{
  const h=harness();
  h.state.roundActive=true;
  h.api.reset();
  h.at(740);
  assert.equal(h.elapsed(),740);
  h.at(4000);
  assert.equal(h.elapsed(),4000);
}
// A toxic pause must NOT count; freezing twice must be idempotent.
{
  const h=harness();
  h.state.roundActive=true;
  h.api.reset();
  h.at(300);assert.equal(h.elapsed(),300);
  h.state.toxinPaused=true;h.api.freeze();
  h.at(750);h.api.freeze();assert.equal(h.elapsed(),300);
  h.at(1300);assert.equal(h.elapsed(),300);
  h.api.resume();assert.equal(h.elapsed(),300,
    'Cannot resume while toxic overlay is still shown');
  h.state.toxinPaused=false;h.api.resume();
  h.at(1550);
  assert.equal(h.elapsed(),550,'The 1000-ms toxin overlay must be excluded');
  h.state.toxinPaused=true;h.api.freeze();
  h.at(2550);assert.equal(h.elapsed(),550);
  h.state.toxinPaused=false;h.api.resume();
  h.at(2750);assert.equal(h.elapsed(),750);
}
// Menu navigation: long pauses are excluded in BOTH game modes.
{
  const h=harness();
  h.state.roundActive=true;h.api.reset();
  h.at(350);h.state.soloPaused=true;h.api.freeze();
  h.at(1500000);assert.equal(h.elapsed(),350);
  h.api.resume();assert.equal(h.elapsed(),350,
    'No progress while the menu remains open');
  h.state.soloPaused=false;h.api.resume();
  h.at(1500650);assert.equal(h.elapsed(),1000);
}
// Poison overlay -> leave for menu -> resume after the original toxin timeout
// has been cancelled: do not double count either blocked interval.
{
  const h=harness();
  h.state.roundActive=true;h.api.reset();
  h.at(250);h.state.toxinPaused=true;h.api.freeze();
  h.at(370);h.state.soloPaused=true;h.api.freeze();
  h.state.toxinPaused=false; // toxin overlay cancelled when leaving
  h.at(1270);h.api.resume();assert.equal(h.elapsed(),250);
  h.at(9200);h.state.soloPaused=false;h.api.resume();
  h.at(9500);assert.equal(h.elapsed(),550);
}
// A frozen round cannot resume after it is marked finished. The next round
// starts at zero, independent of the preceding generation.
{
  const h=harness();
  h.state.roundActive=true;h.api.reset();h.at(1200);
  h.api.freeze();h.state.roundActive=false;
  h.at(12000);h.api.resume();assert.equal(h.elapsed(),1200);
  h.state.roundActive=true;h.api.reset();
  assert.equal(h.elapsed(),0);
  h.at(12100);assert.equal(h.elapsed(),100);
}
// Timers are monotonic, nonnegative and integer-millisecond in the diagnostic.
{
  const h=harness();
  h.state.roundActive=true;h.at(500);h.api.reset();
  h.at(499.9);assert.equal(h.elapsed(),0);
  h.at(500.45);assert.equal(h.elapsed(),0);
  h.at(500.52);assert.equal(h.elapsed(),1);
  h.api.freeze();const last=h.elapsed();
  h.at(400);assert.equal(h.elapsed(),last);
}
// Verify integration against the actual runtime (not a copy of the helpers).
const section=(start,end)=>{
  const a=html.indexOf(start);
  const b=html.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a, 'Game function boundary not found: '+start);
  return html.slice(a,b);
};
const startRound=section('  function startRound() {','  function endRound() {');
const endRound=section('  function endRound() {','  // Temporary visual ranking');
const pauseSolo=section('  function pauseSolo() {','  function resumeSolo() {');
const resumeSolo=section('  function resumeSolo() {',"  window.addEventListener('gitai:solo-pause'");
const toxin=section('  function showPoisonPenalty() {','  function handleTap(');
const tap=section('  function handleTap(',"  canvas.addEventListener('pointerdown'");
const fatal=section('  function showWarningToxicDeath() {','  warningDeathReturn.addEventListener');
assert.match(startRound,/state\.roundStartedAt = performance\.now\(\);\s*resetRoundElapsedClock\(state\.roundStartedAt\)/);
assert.match(endRound,/freezeRoundElapsedClock\(\);\s*clearTimers\(\)/);
assert.match(pauseSolo,/state\.soloPaused = true;\s*freezeRoundElapsedClock\(\)/);
assert.match(resumeSolo,/state\.soloPaused = false;\s*resumeRoundElapsedClock\(\)/);
assert.match(toxin,/state\.toxinPaused = true;\s*freezeRoundElapsedClock\(\)/);
assert.match(toxin,/if \(state\.soloPaused\) return;\s*resumeRoundElapsedClock\(\)/);
assert.match(fatal,/freezeRoundElapsedClock\(\);\s*state\.roundActive = false/);
assert.match(tap,/elapsed_ms: currentRoundElapsedMs\(\)/);
assert.match(endRound,/tap_elapsed_basis: 'active_excludes_explicit_pauses_v2'/);
assert.doesNotMatch(tap,/performance\.now\(\) - state\.roundStartedAt/);
// Timed normal rounds still retain their original schedule, pause/resume, and
// no extra random draws or data storage were added to active-time helpers.
assert.match(startRound,/state\.roundTimeoutId = setTimeout\(endRound, CONFIG\.ROUND_TIME_MS\)/);
assert.match(resumeSolo,/state\.roundTimeoutId = setTimeout\(endRound, remaining\)/);
console.log('EV-08: live tap elapsed-time clock excludes toxin and menu pauses, handles overlaps/retries, resets by round; existing countdown and evolution RNG unchanged.');
