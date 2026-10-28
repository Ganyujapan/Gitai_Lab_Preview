'use strict';
// Pure synthetic in-memory, serialized IndexedDB-like transaction fixture.
// The real headstart functions execute against this model, never a user DB.
const assert=require('node:assert/strict');
function createFixture({failAt=Infinity}={}){
  const stores={images:new Map(),meta:new Map()};
  const pending=[];
  let busy=false,putCount=0;
  const txLog=[];
  function next(){
    if(busy||!pending.length)return;
    busy=true;
    const tx=pending.shift();
    const stage={images:new Map(stores.images),meta:new Map(stores.meta)};
    let failed=false;
    const abort=(error)=>{
      if(failed)return;
      failed=true;tx.error=error||new Error('AbortError');
      setImmediate(()=>{busy=false;tx.onabort?.();next()});
    };
    tx.abort=()=>abort(new Error('AbortError'));
    function cycle(){
      if(failed)return;
      const item=tx.operations.shift();
      if(!item){
        for(const store of ['images','meta']){
          stores[store].clear();
          for(const [key,value] of stage[store]) stores[store].set(key,value);
        }
        setImmediate(()=>{busy=false;tx.oncomplete?.();next()});
        return;
      }
      try{
        if(item.type==='get'){
          item.request.result=stage[item.store].get(item.key);
          item.request.onsuccess?.();
        } else if(item.type==='put'){
          if(++putCount===failAt)throw new Error('QuotaExceededError');
          stage[item.store].set(item.key,item.value);
        }else throw Error('Unknown operation');
        setImmediate(cycle);
      }catch(error){abort(error)}
    }
    setImmediate(cycle);
  }
  const db={
    transaction(names,mode){
      assert.equal(mode,'readwrite');
      const listed=Array.isArray(names)?names:[names];
      const tx={operations:[],error:null,oncomplete:null,onabort:null,onerror:null,
        objectStore(name){
          assert.ok(listed.includes(name));
          assert.ok(Object.hasOwn(stores,name));
          return {
            get(key){
              const request={onsuccess:null,result:undefined,error:null};
              tx.operations.push({type:'get',store:name,key,request});
              return request;
            },
            put(value,key){tx.operations.push({type:'put',store:name,key,value})}
          };
        }
      };
      pending.push(tx);txLog.push(tx);next();
      return tx;
    }
  };
  return {
    stores,txLog,
    openDb:async()=>db,
    idbGet:async(store,key)=>stores[store].get(key),
    restore(pointer,epoch,tag){
      // Synthetic restore, deliberately between bootstrap's async phases.
      stores.meta.set('current_generation_id',pointer);
      stores.meta.set('restore_epoch',epoch);
      stores.meta.set('restore_tag',tag);
      for(let i=1;i<=60;i++){
        const k=pointer+':'+String(i).padStart(2,'0');
        stores.images.set(k,new Blob([tag]));
        stores.meta.set('genome:'+k,{tag,schema_version:1});
      }
    }
  };
}
module.exports={createFixture};
