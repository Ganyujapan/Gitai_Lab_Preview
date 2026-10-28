'use strict';
// CI-02: enforce reviewed exact commit SHAs for every external action.
// Updating an action requires checking the current official GitHub tag and
// reviewing the concrete upstream commit before changing this whitelist.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const workflows=fs.readdirSync('.github/workflows')
  .filter(file=>file.endsWith('.yml')||file.endsWith('.yaml'));
const pins=Object.freeze({
 'actions/checkout':'11d5960a326750d5838078e36cf38b85af677262',
 'actions/configure-pages':'983d7736d9b0ae728b81ab479565c72886d7745b',
 'actions/upload-pages-artifact':'7b1f4a764d45c48632c6b24a0339c27f5614fb0b',
 'actions/deploy-pages':'d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'
});
const seen=new Set();
for(const file of workflows){
 const source=fs.readFileSync(path.join('.github/workflows',file),'utf8');
 for(const line of source.split(/\r?\n/)){
   const match=line.match(/^\s*-\s*uses:\s*([^\s#]+)/);
   if(!match)continue;
   const ref=match[1];
   if(ref.startsWith('./'))continue; // vetted, exact local reusable workflow
   const i=ref.lastIndexOf('@');
   assert.ok(i>0,'Actions ref must include SHA: '+ref);
   const name=ref.slice(0,i),sha=ref.slice(i+1);
   assert.ok(Object.hasOwn(pins,name),'unreviewed external Action: '+ref);
   assert.match(sha,/^[a-f0-9]{40}$/,'moving tag/branch forbidden: '+ref);
   assert.equal(sha,pins[name],'Action SHA changed; review and update policy: '+name);
   seen.add(name);
 }
}
assert.deepEqual([...seen].sort(),Object.keys(pins).sort(),
  'all required official Actions should be pinned and in use');
const deploy=fs.readFileSync('.github/workflows/deploy-pages.yml','utf8');
const validate=fs.readFileSync('.github/workflows/verify-public-preview.yml','utf8');
assert.match(deploy,/verify:\s*\n[\s\S]*?permissions:\s*\n\s+contents: read\s*\n\s+uses: \.\/\.github\/workflows\/verify-public-preview\.yml/);
assert.match(deploy,/deploy:\s*\n\s+needs: verify/);
assert.match(validate,/permissions:\s*\n\s+contents: read/);
assert.doesNotMatch(validate,/pull_request_target:/);
console.log('CI-02: all external Actions pinned to verified upstream commit SHAs; PR and predeploy validation stay read-only.');
