'use strict';
// EXH-03: run the REAL backup validator, restore code and file-change UI
// using isolated stores. Never open a device's existing IndexedDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

const source = fs.readFileSync('exhibit/admin.js', 'utf8');
const restoreStart = source.indexOf('  const MAX_BACKUP_BYTES = ');
const restoreEnd = source.indexOf('\n  const button = document.getElementById', restoreStart);
const handlerStart = source.indexOf("  const input = document.getElementById('exhibitBackupFile');");
// Anchor on executable code, not wording of EXH-05 lifecycle comments.
const handlerEnd = source.indexOf("  const updateStatus = document.getElementById('exhibitUpdateStatus');", handlerStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
assert.ok(handlerStart > restoreEnd && handlerEnd > handlerStart);
const realCode = source.slice(restoreStart, restoreEnd) + '\n' +
  source.slice(handlerStart, handlerEnd);
assert.match(realCode, /db\.transaction\(STORES, 'readwrite'\)/);
assert.match(realCode, /result\.status === 'partial'/);
assert.match(realCode, /status: 'cancelled'/);

const crypticDb = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
const warningDb = 'gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2';
const lifeKey = 'gitai-warning-life-v1:' + warningDb;
const MODES = {
  cryptic: {label:'隠れるギタイ', db:crypticDb},
  warning: {label:'目立つギタイ', db:warningDb}
};
const STORES = ['images', 'meta', 'theater_frames'];
const digest = async value => crypto.createHash('sha256').update(value).digest('hex');

function mothBlob() {
  const bytes = new Uint8Array(25);
  bytes.set([137,80,78,71,13,10,26,10]);
  bytes[19] = 128;
  bytes[23] = 128;
  return {$blob: Array.from(bytes), mime:'image/png'};
}
const EXPECTED_LOCI=JSON.parse(fs.readFileSync(
  'data/evolution_models/continuous_v1/config.json','utf8'
)).trait_genetics.pattern_loci.map(x=>x.id);
function genome(i, warning) {
  const modules=Object.fromEntries(EXPECTED_LOCI.map(id=>[id,{
    alleles:[1,0],cx:0.5,cy:0.5,rx:0.2,ry:0.2,
    valueEffect:-0.2,hueEffect:0,saturationEffect:0,
    phase:1.5,angle:0,frequency:1.5,roughness:0.25
  }]));
  return {schema_version:1, baseHue:30, baseSaturation:.3, baseValue:.9,
    patternContrast:.3, textureStrength:.01, textureSeed:i,
    modules,
    ...(warning ? {lineage:i <= 30 ? 'poison' : 'harmless'} : {})};
}
function backup(mode, warningLife) {
  const gen = mode === 'warning' ? 'gen00025' : 'gen00035';
  const body = {
    schema:'gitai-exhibit-backup-v1',
    mode, database:MODES[mode].db, databaseVersion:2,
    currentGeneration:gen, createdAt:'2026-10-26T00:00:00Z',
    warningLife:mode === 'warning' ? warningLife : null,
    stores:{
      images:Array.from({length:60}, (_,i) => ({
        key:gen + ':' + String(i+1).padStart(2,'0'),value:mothBlob()
      })),
      meta:[{key:'current_generation_id',value:gen},
        ...Array.from({length:60},(_,i) => ({
          key:'genome:' + gen + ':' + String(i+1).padStart(2,'0'),
          value:genome(i+1, mode === 'warning')
        }))],
      theater_frames:[]
    }
  };
  return digest(JSON.stringify(body)).then(checksum => JSON.stringify({checksum,payload:body}));
}
function harness({mode='warning', confirmed=true, idbFail=false,
                  lifeSetFail=false, lifeRemoveFail=false}={}) {
  const saved = new Map([[lifeKey,'PREVIOUS_LIFE']]);
  const messages = [];
  const handlers = {};
  let opened = 0, closed = 0, confirmations = 0;
  const state = {
    images: new Map([['old-image','kept']]),
    meta: new Map([['current_generation_id','gen00010']]),
    theater_frames: new Map([['old-frame','kept']])
  };
  const input = {
    value:'', files:[],
    addEventListener(event,callback) {handlers[event]=callback;},
    click() {}
  };
  const restoreButton = {addEventListener() {}};
  const context = {
    MODES, STORES, BACKUP_SCHEMA:'gitai-exhibit-backup-v1',
    Blob, Uint8Array, DataView, digest,
    selector:{value:mode}, unlocked:true,
    say(message) { messages.push(message); },
    confirm() {confirmations++;return confirmed;},
    decode(value) {
      if(value && value.$blob) return new Blob([Uint8Array.from(value.$blob)],{type:value.mime});
      return value;
    },
    createImageBitmap:async () => ({width:128,height:128,close(){}}),
    localStorage:{
      getItem(key) {return saved.has(key) ? saved.get(key) : null;},
      setItem(key,value) {
        if(lifeSetFail) throw Error('TEST_QUOTA_FAILURE');
        saved.set(key,String(value));
      },
      removeItem(key) {
        if(lifeRemoveFail) throw Error('TEST_REMOVE_FAILURE');
        saved.delete(key);
      }
    },
    openDb:async () => {
      opened++;
      return {
        close() {closed++;},
        transaction(stores,mode) {
          assert.equal(mode,'readwrite');
          assert.deepEqual(Array.from(stores), STORES);
          const draft = Object.fromEntries(STORES.map(s => [s,new Map(state[s])]));
          let aborted = false;
          const tx = {
            error:Error('TEST_IDB_ABORT'),
            objectStore(store) {
              return {
                clear() {draft[store].clear();},
                put(value,key) {draft[store].set(key,value);}
              };
            },
            abort() {
              aborted = true;
              queueMicrotask(() => tx.onabort && tx.onabort());
            }
          };
          queueMicrotask(() => {
            if (aborted) return;
            if (idbFail) {
              tx.onabort && tx.onabort();
            } else {
              for (const store of STORES) state[store]=draft[store];
              tx.oncomplete && tx.oncomplete();
            }
          });
          return tx;
        }
      };
    },
    document:{
      getElementById(id) {
        if(id==='exhibitBackupFile')return input;
        if(id==='exhibitBackupRestore')return restoreButton;
        throw Error('Unexpected DOM lookup: ' + id);
      }
    }
  };
  vm.runInNewContext(realCode,context,{filename:'EXH-03:exhibit/admin.js',timeout:5000});
  assert.equal(typeof handlers.change,'function');
  return {
    messages, state, saved,
    get opened(){return opened;},
    get closed(){return closed;},
    get confirmations(){return confirmations;},
    async restore(raw) {
      input.files=[{size:raw.length,async text(){return raw;}}];
      await handlers.change();
      return messages.at(-1);
    }
  };
}
(async()=>{
  const rawWarning = await backup('warning','RESTORED_LIFE');
  const full = harness();
  const fullMessage = await full.restore(rawWarning);
  assert.match(fullMessage,/復元が完了/);
  assert.equal(full.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(full.saved.get(lifeKey),'RESTORED_LIFE');
  assert.equal(full.state.images.size,60);
  assert.equal(full.opened,1);
  assert.equal(full.closed,1);

  const cryptic = harness({mode:'cryptic'});
  assert.match(await cryptic.restore(await backup('cryptic',null)),/復元が完了/);
  assert.equal(cryptic.state.meta.get('current_generation_id'),'gen00035');
  assert.equal(cryptic.saved.get(lifeKey),'PREVIOUS_LIFE');

  const cancelled = harness({confirmed:false});
  assert.match(await cancelled.restore(rawWarning),/キャンセル/);
  assert.equal(cancelled.opened,0);
  assert.equal(cancelled.state.meta.get('current_generation_id'),'gen00010');
  assert.equal(cancelled.saved.get(lifeKey),'PREVIOUS_LIFE');

  const invalid = harness();
  const bad = JSON.parse(rawWarning);
  bad.checksum = 'wrong';
  assert.match(await invalid.restore(JSON.stringify(bad)),/復元失敗（既存データは保持）/);
  assert.equal(invalid.opened,0);
  assert.equal(invalid.confirmations,0);
  assert.equal(invalid.state.meta.get('current_generation_id'),'gen00010');

  const idbFailure = harness({idbFail:true});
  assert.match(await idbFailure.restore(rawWarning),/復元失敗（既存データは保持）/);
  assert.equal(idbFailure.state.meta.get('current_generation_id'),'gen00010');
  assert.equal(idbFailure.state.images.get('old-image'),'kept');
  assert.equal(idbFailure.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(idbFailure.closed,1);

  const partial = harness({lifeSetFail:true});
  const final = await partial.restore(rawWarning);
  assert.match(final,/進化データ（gen00025）は復元しました/);
  assert.match(final,/ライフ情報を復元できませんでした/);
  assert.match(final,/TEST_QUOTA_FAILURE/);
  assert.doesNotMatch(final,/復元が完了|既存データは保持/);
  assert.equal(partial.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(partial.state.images.size,60);
  assert.equal(partial.saved.get(lifeKey),'PREVIOUS_LIFE');
  assert.equal(partial.messages.length,2,'UI warning must be final, not overwritten');

  const removalFailure = harness({lifeRemoveFail:true});
  const noLife = await removalFailure.restore(await backup('warning',null));
  assert.match(noLife,/ライフ情報を復元できませんでした/);
  assert.match(noLife,/TEST_REMOVE_FAILURE/);
  assert.equal(removalFailure.state.meta.get('current_generation_id'),'gen00025');
  assert.equal(removalFailure.saved.get(lifeKey),'PREVIOUS_LIFE');

  console.log('EXH-03: full warning/cryptic, cancelled, validation reject, IDB abort, localStorage set/remove partial success; UI and persisted state agree.');
})().catch(error=>{console.error(error);process.exitCode=1;});
