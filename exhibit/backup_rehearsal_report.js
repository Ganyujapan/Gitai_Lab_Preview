/* Explicit-click iPad/Safari backup rehearsal report, independent of game.
 * This module NEVER opens IndexedDB, reads real experiment records, reads
 * normal localStorage keys, or sends requests. It only invokes the 3 opt-in
 * sandbox test functions provided by the separate diagnostics page.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiBackupRehearsalReport=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const SCHEMA='gitai-isolated-backup-test-report-v1';
  const TESTS=Object.freeze([
    Object.freeze({id:'migration',label:'DB移行・分割書き出し'}),
    Object.freeze({id:'atomic_restore',label:'原子的復元・中断'}),
    Object.freeze({id:'warning_life',label:'ライフ復元・再試行'})
  ]);
  function safeText(value,max=240){
    // Keep diagnostics useful without recording random sandbox DB names,
    // page URLs, paths, or arbitrary large JavaScript object dumps.
    return String(value==null?'':value)
      .replace(/gitai-backup-rehearsal-[0-9a-f]{32}/gi,'[isolated-db]')
      .replace(/(?:https?:\/\/|file:\/\/)[^\s"'<>]+/gi,'[url]')
      .replace(/\s+/g,' ').trim().slice(0,max);
  }
  function safeError(error){
    if(!error)return {name:'Error',message:'不明なエラー'};
    return {
      name:safeText(typeof error.name==='string'?error.name:'Error',48),
      message:safeText(typeof error.message==='string'?error.message:String(error),240)
    };
  }
  function selectSummary(id,result){
    if(!result||result.success!==true)return {success:false};
    if(id==='migration')return {
      success:true,
      blocked:result.blocked===true,
      downgradeError:result.downgradeError===true,
      copiedEntries:Number.isSafeInteger(result.copiedEntries)?result.copiedEntries:null,
      verifiedEntries:Number.isSafeInteger(result.verifiedEntries)?result.verifiedEntries:null
    };
    if(id==='atomic_restore')return {
      success:true,
      forcedAbortPreservedOriginals:result.forcedAbortPreservedOriginals===true,
      normalRestore:result.normalRestore===true,
      checkedEntries:Number.isSafeInteger(result.checkedEntries)?result.checkedEntries:null
    };
    return {
      success:true,
      partialErrorDetected:result.partialErrorDetected===true,
      retrySucceeded:result.retrySucceeded===true,
      staleEpochRejected:result.staleEpochRejected===true
    };
  }
  // Reports deliberately contain NO user agent, IP address, full URL,
  // backup contents, PNG/DNA, real game DB name or normal life key.
  // Exactly three fixed independent checks; failure in one cannot prevent
  // subsequent checks. No data is persisted after leaving the page.
  async function runSuite(checks,{onUpdate=()=>{},now=()=>Date.now(),
    timestamp=()=>new Date().toISOString()}={}){
    if(!checks||TESTS.some(t=>typeof checks[t.id]!=='function')||
       typeof onUpdate!=='function'||typeof now!=='function'||
       typeof timestamp!=='function')
      throw Error('隔離テストの実行処理が不足しています。');
    const tests=[];
    const createdAt=timestamp();
    for(const test of TESTS){
      const started=now();
      let lastPhase='開始';
      onUpdate({id:test.id,status:'running',label:test.label});
      try{
        const outcome=await checks[test.id]({
          onPhase:message=>{lastPhase=safeText(message,160);}
        });
        if(outcome?.success!==true)
          throw Error('テストが成功を返しませんでした。');
        tests.push(Object.freeze({
          id:test.id,label:test.label,status:'passed',
          durationMs:Math.max(0,Math.floor(now()-started)),
          summary:Object.freeze(selectSummary(test.id,outcome))
        }));
        onUpdate({id:test.id,status:'passed',label:test.label});
      }catch(error){
        tests.push(Object.freeze({
          id:test.id,label:test.label,status:'failed',
          durationMs:Math.max(0,Math.floor(now()-started)),
          lastPhase:safeText(lastPhase,160),
          error:Object.freeze(safeError(error))
        }));
        onUpdate({id:test.id,status:'failed',label:test.label});
      }
    }
    const allPassed=tests.every(test=>test.status==='passed');
    return Object.freeze({
      schema:SCHEMA,createdAt,
      scope:'synthetic-isolated-databases-only',
      actualIpadVerification:'must-be-run-on-device',
      allPassed,passed:tests.filter(x=>x.status==='passed').length,
      failed:tests.filter(x=>x.status==='failed').length,
      tests:Object.freeze(tests),
      caution:'模擬データのみ。容量不足・端末強制終了・本番DB/ライフ・大容量復元は未検証。'
    });
  }
  return Object.freeze({SCHEMA,TESTS,safeText,safeError,runSuite});
});
