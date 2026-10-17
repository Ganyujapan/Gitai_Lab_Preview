'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const read=(from,to)=>{
  const start=html.indexOf(from),end=html.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start, 'Missing fragment '+from);
  return html.slice(start,end);
};
const shareLogic=read('  function shareNameStorageKey()','  function showMothShare(');
const saveLogic=read('  async function saveSpecimen(', '  function releaseSpecimenObjectUrls()');
test('specimen and share panel no longer asks for a display name',()=>{
  assert.doesNotMatch(html,/id="shareNameInput"|share-name-row|表示名は任意です/);
  assert.match(html,/id="specimenSaveButton"/);
  assert.match(html,/id="shareButton"/);
  assert.match(html,/id="shareCardTitle"/);
});
test('sharing uses the existing menu nickname without modifying it',()=>{
  const storage=new Map([['gitai-player-nickname-v1','がんゆう']]);
  const localStorage={getItem:(name)=>storage.get(name)??null,setItem:()=>{throw Error('should not write nickname');}};
  const getter=new Function('localStorage',shareLogic+';return getShareDisplayName;')(localStorage);
  assert.equal(getter(),'がんゆう');
  assert.match(shareLogic,/localStorage\.getItem\(PLAYER_NICKNAME_KEY\)/);
  assert.doesNotMatch(shareLogic,/shareNameInput|setItem/);
});
test('genome and image preservation remain independent from naming',()=>{
  assert.match(saveLogic,/const genome = existing\?\.genome/);
  assert.match(saveLogic,/image_blob: blob/);
  assert.match(saveLogic,/\.\.\.\(genome \? \{ genome \} : \{\}\)/);
});
