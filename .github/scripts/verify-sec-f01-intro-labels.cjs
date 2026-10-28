'use strict';
// SEC-F01 regression against the shipped inline UI code, not a rewrite.
// Config labels must remain literal text if user-controlled in the future.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.html', 'utf8');
function section(a,b) {
  const start=source.indexOf(a);
  const end=source.indexOf(b,start);
  assert.ok(start>0 && end>start,'production code changed: '+a);
  return source.slice(start,end);
}
const helper=section('  function setIntroLines(', '\n  function applyAppConfig(');
const intro=section("    const label = String(speciesConfig.display_name_ja || '生き物');",
  '    compareButton.textContent =',);
assert.doesNotMatch(intro,/\.innerHTML\s*=/,
  'do not parse bundled or future custom species labels as HTML');
assert.match(helper,/document\.createTextNode/);
assert.match(helper,/document\.createElement\('br'\)/);
assert.match(helper,/\.replaceChildren\(/);
class Node {
  constructor(tag,text='') {this.tag=tag;this.text=text;this.children=[];}
  replaceChildren(...items){this.children=items;}
}
function run(label,warning) {
  const introLead=new Node('p'),introSubtle=new Node('p');
  const ctx={
    String,WARNING_MODE:warning,
    speciesConfig:{display_name_ja:label},
    appConfig:{title:'ギタイラボ'},
    document:{
      title:'',
      createTextNode(value){return new Node('#text',value)},
      createElement(tag){assert.equal(tag,'br');return new Node(tag)}
    },
    introLead,introSubtle
  };
  vm.runInNewContext(helper+intro,ctx,{timeout:3000,filename:'index.html:SEC-F01'});
  const extract=el=>{
    assert.equal(el.children.length,3);
    assert.equal(el.children[0].tag,'#text');
    assert.equal(el.children[1].tag,'br');
    assert.equal(el.children[2].tag,'#text');
    // The label is not parsed into actual HTML elements.
    assert.equal(el.children.filter(x=>x.tag==='img'||x.tag==='script').length,0);
    return el.children[0].text+'\n'+el.children[2].text;
  };
  return {lead:extract(introLead),subtle:extract(introSubtle),
    rawLead:introLead,rawSubtle:introSubtle,title:ctx.document.title};
}
const malicious='<img src=x onerror="alert(1)">&\n日本語\\\'"';
const regular=run(malicious,false);
assert.equal(regular.lead,'見つけた'+malicious+'を\nタップしてください。');
assert.equal(regular.subtle,'見つからなかった'+malicious+
  'が生き残り、\n次の世代へ子孫を残します。');
assert.equal(regular.title,'ギタイラボ');
const normal=run('蛾',false);
assert.equal(normal.lead,'見つけた蛾を\nタップしてください。');
assert.equal(normal.subtle,
  '見つからなかった蛾が生き残り、\n次の世代へ子孫を残します。');
const fallback=run('',false);
assert.equal(fallback.lead,'見つけた生き物を\nタップしてください。');
const warning=run(malicious,true);
assert.equal(warning.lead,
  '毒蛾と無毒蛾が混ざっています。\n見つけた蛾をタップしてください。');
assert.equal(warning.subtle,
  '時間制限はありません。蛾を5匹食べると次のラウンドへ。\n'
  +'毒蛾を食べると1秒間「毒」と表示されます。');
assert.ok(!warning.lead.includes('onerror'));
console.log('SEC-F01: literal malicious HTML, quotes, ampersand, Japanese, newline, warning copy and single BR preserved.');
