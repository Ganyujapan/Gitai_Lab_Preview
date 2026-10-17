'use strict';
// Standalone, read-only export for "ギタイでバトル". The evolution and specimen-box code is untouched.
(function(){
  const button=document.getElementById('battleSpecimenExport');
  const status=document.getElementById('battleSpecimenExportStatus');
  if(!button||!status)return;
  const NAME='gitai-specimen-box-v1',STORE='specimens',MAX_ITEMS=500,MAX_PNG_BYTES=131072;
  function readAll(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(NAME,1);
      req.onerror=()=>reject(req.error||Error('標本箱を開けません'));
      req.onupgradeneeded=()=>{}; // Never modify an existing store.
      req.onsuccess=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)){db.close();resolve([]);return;}
        let items=[];
        const tx=db.transaction(STORE,'readonly');
        const cur=tx.objectStore(STORE).openCursor();
        cur.onsuccess=()=>{const c=cur.result;if(c){items.push(c.value);c.continue();}};
        cur.onerror=()=>reject(cur.error||Error('読み込み失敗'));
        tx.oncomplete=()=>{db.close();resolve(items);};
        tx.onerror=()=>{db.close();reject(tx.error||Error('読み込み失敗'));};
      };
    });
  }
  function toDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error||Error('画像を読み込めません'));
      reader.readAsDataURL(blob);
    });
  }
  async function run(){
    button.disabled=true;
    status.textContent='標本を読み込んでいます…';
    try{
      const records=(await readAll()).filter(r=>r&&r.image_blob instanceof Blob);
      if(records.length===0)throw Error('保存済みの標本がありません。');
      if(records.length>MAX_ITEMS)throw Error('標本が500匹を超えています。現在は最大500匹まで書き出せます。');
      const specimens=[];
      for(let i=0;i<records.length;i++){
        const r=records[i];
        if(r.image_blob.type!=='image/png'||r.image_blob.size>MAX_PNG_BYTES)
          throw Error('PNG以外、または128KBを超える画像があります。');
        const image_data_url=await toDataUrl(r.image_blob);
        specimens.push({
          id:String(r.id||''),environment_id:String(r.environment_id||''),
          generation_number:Number(r.generation_number)||0,
          individual_index:Number(r.individual_index)||0,
          saved_at:String(r.saved_at||''),image_data_url
        });
      }
      const payload={schema:'gitai-battle-specimens-v1',exported_at:new Date().toISOString(),specimens};
      const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download='gitai-battle-specimens.json';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent=specimens.length+'匹をJSONファイルに書き出しました。バトル画面で「標本箱を取り込む」を選んでください。';
    }catch(e){status.textContent='書き出せませんでした：'+(e.message||e);}
    finally{button.disabled=false;}
  }
  button.addEventListener('click',run);
})();
