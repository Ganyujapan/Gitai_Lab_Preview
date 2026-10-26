'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const n0=source.indexOf('  function compactNumber(');
const n1=source.indexOf('\n  function hueSectorCode(',n0);
const e0=source.indexOf('  function compactContinuousEvent(');
const e1=source.indexOf('\n  function notableContinuousEvents(',e0);
assert.ok(n0>0 && n1>n0 && e0>0 && e1>e0);
const ctx={};
vm.runInNewContext(source.slice(n0,n1)+'\n'+source.slice(e0,e1)+
 '\nglobalThis.format=compactContinuousEvent;',ctx,{timeout:3000});
const format=e=>ctx.format({type:'base_hue_major',before:100,after:170,...e});
assert.equal(format({signed_delta_deg:70}),'Hmajor 100>170(70deg)');
assert.equal(format({signed_delta_deg:-50}),'Hmajor 100>170(-50deg)');
assert.equal(format({signed_delta_deg:0}),'Hmajor 100>170(0deg)');
assert.equal(format({signed_jump_deg:-70}),'Hmajor 100>170(-70deg)');
assert.equal(format({signed_delta_deg:70,signed_jump_deg:-80}),'Hmajor 100>170(70deg)');
assert.equal(format({}),'Hmajor 100>170(unknowndeg)');
assert.equal(ctx.format({type:'special_mutation'}),'SPECIAL_MUTATION');
assert.ok(source.includes("signed_delta_deg: diagnosticNumber(signedDelta, 2)"),
 'Generator field must remain unchanged');
console.log('EV-04: signed hue angles, zero, legacy event and missing values recorded correctly.');
