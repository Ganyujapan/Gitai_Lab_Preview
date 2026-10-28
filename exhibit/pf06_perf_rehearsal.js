/* PF06 diagnostic only. User-triggered isolated benchmark: never read a
 * production DB, localStorage, real specimen images or evolution history.
 * Models the DOM/Blob URL bounds but does NOT execute the whole game.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiPF06PerfRehearsal=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const PREFIX='gitailab-pf06-isolated-benchmark-';
  const STORE_THEATER='theater_frames';
  const STORE_SPECIMENS='specimens';
  const BLOB_BYTES=8192; // synthetic; not a real PNG or real specimen
  const BATCH=30;
  function makeDbName(cryptoSource){
    if(!cryptoSource||typeof cryptoSource.getRandomValues!=='function')
      throw Error('安全な試験DB名を作成できません。');
    const random=cryptoSource.getRandomValues(new Uint8Array(16));
    return PREFIX+Array.from(random,byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function assertTestName(name){
    if(typeof name!=='string'||!/^gitailab-pf06-isolated-benchmark-[a-f0-9]{32}$/.test(name))
      throw Error('試験専用でないDB名への操作を拒否しました。');
  }
  function createWindow(frames,urlApi,radius=2){
    if(!urlApi||typeof urlApi.createObjectURL!=='function'||
       typeof urlApi.revokeObjectURL!=='function')
      throw Error('画像URLのテスト機能がありません。');
    const urls=new Map();
    let peak=0,created=0,revoked=0;
    function seek(index){
      if(!Number.isInteger(index)||index<0||index>=frames.length)
        throw Error('世代の位置が不正です。');
      const min=Math.max(0,index-radius);
      const max=Math.min(frames.length-1,index+radius);
      for(const [i,url] of urls){
        if(i<min||i>max){
          urlApi.revokeObjectURL(url);
          urls.delete(i);revoked++;
        }
      }
      for(let i=min;i<=max;i++){
        if(!urls.has(i)){
          urls.set(i,urlApi.createObjectURL(frames[i].image_blob));
          created++;
          peak=Math.max(peak,urls.size);
        }
      }
      return urls.get(index);
    }
    function release(){
      for(const url of urls.values()){
        urlApi.revokeObjectURL(url);revoked++;
      }
      urls.clear();
    }
    return {seek,release,stats:()=>({peak,active:urls.size,created,revoked})};
  }
  function openTestDb(name,idb){
    assertTestName(name);
    return new Promise((resolve,reject)=>{
      const req=idb.open(name,1);
      req.onupgradeneeded=()=>{
        req.result.createObjectStore(STORE_THEATER);
        req.result.createObjectStore(STORE_SPECIMENS);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('試験用DBを作れませんでした。'));
      req.onblocked=()=>reject(Error('試験用DBが別タブで使用中です。'));
    });
  }
  function deleteTestDb(name,idb){
    assertTestName(name);
    return new Promise((resolve,reject)=>{
      const req=idb.deleteDatabase(name);
      req.onsuccess=()=>resolve(true);
      req.onerror=()=>reject(req.error||Error('試験用DBを削除できませんでした。'));
      req.onblocked=()=>reject(Error('試験用DBの削除が別タブに妨げられました。'));
    });
  }
  function putChunk(db,base,limit,blob){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE_THEATER,STORE_SPECIMENS],'readwrite');
      const theater=tx.objectStore(STORE_THEATER);
      const specimens=tx.objectStore(STORE_SPECIMENS);
      for(let i=base;i<limit;i++){
        const generation=i+1, id='gen'+String(generation).padStart(5,'0');
        theater.put({generation_id:id,generation_number:generation,
          render_version:2,image_blob:blob,model_label_ja:'合成テスト'},id);
        specimens.put({id:'test-specimen-'+generation,
          generation_id:id,generation_number:generation,individual_index:1,
          saved_at:String(10000000+i),image_blob:blob},
          'test-specimen-'+generation);
      }
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||Error('試験用データの保存に失敗しました。'));
      tx.onabort=()=>reject(tx.error||Error('試験用データの保存が中断されました。'));
    });
  }
  function cursorRead(db,name,range){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,'readonly');
      const records=[];
      const req=tx.objectStore(name).openCursor(range);
      req.onsuccess=()=>{
        const cursor=req.result;
        if(!cursor)return;
        records.push(cursor.value);
        cursor.continue();
      };
      tx.oncomplete=()=>resolve(records);
      tx.onerror=()=>reject(tx.error||Error('試験用一覧の読み込みに失敗しました。'));
      tx.onabort=()=>reject(tx.error||Error('試験用一覧の読み込みが中断されました。'));
    });
  }
  function renderFirstBatch(specimens,doc,urlApi){
    const host=doc.createElement('div');
    // This intentionally tests JS DOM construction, not actual paint/decode.
    host.hidden=true;
    doc.body.appendChild(host);
    const urls=[];
    try{
      for(const item of specimens.slice(0,BATCH)){
        const card=doc.createElement('button');
        card.type='button';
        card.textContent='第'+item.generation_number+'世代';
        card.setAttribute('aria-label',card.textContent);
        const url=urlApi.createObjectURL(item.image_blob);
        urls.push(url);
        card.dataset.syntheticImageUrl=url;
        host.appendChild(card);
      }
      return {cards:host.childElementCount,cleanup(){
        for(const url of urls)urlApi.revokeObjectURL(url);
        host.remove();
      }};
    }catch(error){
      for(const url of urls)urlApi.revokeObjectURL(url);
      host.remove();
      throw error;
    }
  }
  async function run(options){
    const count=options?.count;
    if(count!==100&&count!==1000)throw Error('試験件数は100または1000のみです。');
    const idb=options.indexedDB;
    const cryptoSource=options.crypto;
    const keyRange=options.IDBKeyRange;
    const now=options.now;
    const urlApi=options.urlApi;
    const doc=options.document;
    const phase=typeof options.onPhase==='function'?options.onPhase:()=>{};
    if(!idb||!keyRange||typeof now!=='function'||!doc||!urlApi)
      throw Error('ブラウザの試験機能が不足しています。');
    const name=makeDbName(cryptoSource);
    let db=null, failure=null, report=null, cleanupFailure=null;
    const durations={};
    const before=()=>now();
    const duration=(key,start)=>{durations[key]=Math.round((now()-start)*10)/10;};
    phase('試験用DBを作成します（本物の記録は開きません）。');
    try{
      db=await openTestDb(name,idb);
      // Synthetic binary blobs, deliberately not a photo or game record.
      const data=new Uint8Array(BLOB_BYTES);
      data[0]=71;data[1]=84;
      const blob=new Blob([data],{type:'application/octet-stream'});
      let start=before();
      for(let i=0;i<count;i+=100){
        await putChunk(db,i,Math.min(count,i+100),blob);
        phase('合成レコード作成 '+Math.min(count,i+100)+' / '+count);
      }
      duration('synthetic_write_ms',start);
      start=before();
      const theater=await cursorRead(db,STORE_THEATER,
        keyRange.bound('gen','gen\uffff'));
      theater.sort((a,b)=>Number(a.generation_number)-Number(b.generation_number));
      duration('theater_read_sort_ms',start);
      if(theater.length!==count)throw Error('シアターの件数が一致しません。');
      start=before();
      const specimens=await cursorRead(db,STORE_SPECIMENS,null);
      specimens.sort((a,b)=>String(b.saved_at).localeCompare(String(a.saved_at)));
      duration('specimen_read_sort_ms',start);
      if(specimens.length!==count)throw Error('標本の件数が一致しません。');
      phase('合成履歴を読み込みました。表示処理を検査します。');
      start=before();
      const windowed=createWindow(theater,urlApi,2);
      let urlStats;
      try{
        for(const index of [0,Math.floor(count/2),count-1,0]){
          windowed.seek(index);
          if(windowed.stats().active>5)
            throw Error('画像URLの同時保持数が5を超えました。');
        }
      }finally{
        windowed.release();
        urlStats=windowed.stats();
      }
      duration('theater_url_seek_ms',start);
      if(urlStats.active!==0||urlStats.created!==urlStats.revoked)
        throw Error('画像URLが残っています。');
      start=before();
      const specimenRender=renderFirstBatch(specimens,doc,urlApi);
      let cards;
      try{cards=specimenRender.cards}
      finally{specimenRender.cleanup()}
      duration('specimen_30_cards_ms',start);
      if(cards!==Math.min(count,BATCH))
        throw Error('標本の初期カード数が不正です。');
      report={
        schema:'gitailab-pf06-synthetic-performance-v1',
        test_size:count,synthetic_only:true,
        records_per_store:count,stores:2,
        synthetic_blob_bytes_per_record:BLOB_BYTES,
        approximate_binary_payload_mib:Math.round(count*2*BLOB_BYTES/1048576*10)/10,
        duration_ms:durations,
        theater_peak_object_urls:urlStats.peak,
        theater_url_leaks:urlStats.active,
        specimen_initial_cards:cards,
        source_db_access:false,
        device_memory_mb:null,
        image_decode_tested:false,
        real_game_performance_tested:false,
        cleanup_completed:false
      };
    }catch(error){failure=error;}
    finally{
      if(db){try{db.close()}catch(_){}}
      phase('試験用DBを削除しています。');
      try{await deleteTestDb(name,idb)}
      catch(error){cleanupFailure=error;}
    }
    if(cleanupFailure)throw Error('試験専用DBの削除を確認できませんでした。'+
      (failure?' 元の失敗：'+String(failure.message||failure):'')+
      ' 削除失敗：'+String(cleanupFailure.message||cleanupFailure));
    if(failure)throw failure;
    report.cleanup_completed=true;
    phase('試験用DBを削除しました。');
    return report;
  }
  async function purgeOrphans(idb){
    if(!idb||typeof idb.databases!=='function')
      throw Error('このSafariにはDB一覧の取得機能がありません。試験中に画面を閉じた場合の確認は別途必要です。');
    const list=await idb.databases();
    const names=Array.from(new Set(list.map(entry=>entry.name).filter(name=>
      typeof name==='string' && new RegExp('^'+PREFIX+'[a-f0-9]{32}$').test(name))));
    for(const name of names)await deleteTestDb(name,idb);
    return names.length;
  }
  return {makeDbName,assertTestName,createWindow,run,purgeOrphans};
});
