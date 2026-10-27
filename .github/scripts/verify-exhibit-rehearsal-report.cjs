'use strict';
// Node CI: no browser/UI network. Exercise the shared report builder and
// verify that the optional page is only reachable by an explicit button.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const reportApi=require('../../exhibit/backup_rehearsal_report.js');
const page=fs.readFileSync('exhibit/backup_rehearsal.html','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
const js=fs.readFileSync('exhibit/backup_rehearsal_report.js','utf8');
new vm.Script(js,{filename:'backup_rehearsal_report.js'});
const inline=page.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline,'Rehearsal controls need an inline script');
new vm.Script(inline[1],{filename:'backup_rehearsal.html'});
assert.match(page,/id="runAll"/);
assert.match(page,/id="copyReport" disabled/);
assert.match(page,/id="saveReport" disabled/);
assert.match(page,/allButton\.addEventListener\('click'/);
assert.match(page,/copyButton\.addEventListener\('click'/);
assert.match(page,/saveButton\.addEventListener\('click'/);
assert.match(page,/GitaiBackupRehearsalReport\.runSuite/);
assert.match(page,/navigator\.clipboard\?\.writeText/);
assert.match(page,/URL\.createObjectURL\(blob\)/);
assert.match(page,/外部への自動送信はありません/);
assert.doesNotMatch(page,/fetch\(/);
assert.doesNotMatch(page,/onload\s*=/i);
assert.match(build,/backup_rehearsal_report\.js/);
for(const file of ['exhibit/index.html','exhibit/modes.html','exhibit/game.js',
  'exhibit/admin.js','exhibit/landing.js']){
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),
    /backup_rehearsal_report/,'diagnostics must never auto-load from '+file);
}
let idbOpened=0;
globalThis.indexedDB={open(){idbOpened++;throw Error('Should never open a DB');}};
globalThis.localStorage={getItem(){throw Error('Should never read life storage')}};
function allChecks(log){
  return {
    async migration({onPhase}){
      log.push('migration');onPhase('versionless inspection');
      return {success:true,blocked:true,downgradeError:true,
        copiedEntries:122,verifiedEntries:122,randomInternalValue:'secret'};
    },
    async atomic_restore({onPhase}){
      log.push('atomic_restore');onPhase('abort verified');
      return {success:true,forcedAbortPreservedOriginals:true,
        normalRestore:true,checkedEntries:122};
    },
    async warning_life({onPhase}){
      log.push('warning_life');onPhase('sandbox life retried');
      return {success:true,partialErrorDetected:true,
        retrySucceeded:true,staleEpochRejected:true};
    }
  };
}
(async()=>{
  assert.equal(reportApi.SCHEMA,'gitai-isolated-backup-test-report-v1');
  assert.deepEqual(reportApi.TESTS.map(x=>x.id),
    ['migration','atomic_restore','warning_life']);
  const calls=[],events=[];
  let t=0;
  const generated=await reportApi.runSuite(allChecks(calls),{
    onUpdate:event=>events.push(event),
    now:()=>t++ * 100,
    timestamp:()=> '2026-10-27T12:00:00Z'
  });
  assert.equal(generated.allPassed,true);
  assert.equal(generated.passed,3);
  assert.equal(generated.failed,0);
  assert.deepEqual(calls,['migration','atomic_restore','warning_life']);
  assert.equal(events.length,6);
  assert.equal(generated.tests.length,3);
  assert.ok(generated.tests.every(x=>x.status==='passed'&&x.durationMs>=0));
  assert.equal(generated.tests[0].summary.copiedEntries,122);
  assert.ok(!JSON.stringify(generated).includes('secret'));
  assert.equal(generated.scope,'synthetic-isolated-databases-only');
  assert.equal(generated.actualIpadVerification,'must-be-run-on-device');
  assert.equal(reportApi.safeText('gitai-backup-rehearsal-'+'a'.repeat(32)),
    '[isolated-db]');
  assert.equal(reportApi.safeText('https://example.org/secret'),
    '[url]');
  assert.ok(reportApi.safeText('X'.repeat(600)).length<=240);
  assert.deepEqual(reportApi.safeError({name:'QuotaExceededError',
    message:'DB gitai-backup-rehearsal-'+'c'.repeat(32)+' failed'}),
    {name:'QuotaExceededError',message:'DB [isolated-db] failed'});
  assert.equal(idbOpened,0);

  const failures=[];
  const defective=allChecks(failures);
  defective.migration=async()=>({success:true,
    copiedEntries:122,verifiedEntries:122,blocked:false,downgradeError:true});
  defective.atomic_restore=async()=>{failures.push('atomic_restore');throw Object.assign(
    Error('failed in gitai-backup-rehearsal-'+'f'.repeat(32)),{name:'AbortError'});
  };
  defective.warning_life=async()=>{
    failures.push('warning_life');return {
      success:true,partialErrorDetected:true,retrySucceeded:true,
      staleEpochRejected:true
    };
  };
  const mixed=await reportApi.runSuite(defective);
  assert.equal(mixed.allPassed,false);
  assert.equal(mixed.passed,1);
  assert.equal(mixed.failed,2);
  assert.equal(mixed.tests[0].status,'failed',
    'missing safety flag must never be success');
  assert.equal(mixed.tests[1].error.name,'AbortError');
  assert.equal(mixed.tests[1].error.message,'failed in [isolated-db]');
  assert.equal(mixed.tests[2].status,'passed',
    'failed tests must never block independent later checks');
  assert.deepEqual(failures,['atomic_restore','warning_life']);
  assert.equal(idbOpened,0);
  assert.doesNotMatch(JSON.stringify(mixed),/gitai-backup-rehearsal-[a-f0-9]{32}/);
  await assert.rejects(reportApi.runSuite({}),/不足/);

  const fakeTrue=allChecks([]);
  fakeTrue.warning_life=async()=>({success:true,partialErrorDetected:false,
    retrySucceeded:true,staleEpochRejected:true});
  const failClosed=await reportApi.runSuite(fakeTrue);
  assert.equal(failClosed.tests[2].status,'failed');
  console.log('RE2-EXH-02: opt-in 3-step browser report generated in order, mandatory flags fail closed, JSON redacts sandbox IDs, no real DB/localStorage access, copy/save controls are manual.');
})().catch(e=>{console.error(e);process.exitCode=1;});
