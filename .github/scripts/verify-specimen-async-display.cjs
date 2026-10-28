'use strict';
// PF04: exercise the real specimen overlay renderer with delayed IndexedDB
// snapshots. DOM, Blob URLs and store reads are isolated in-memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');
const start = source.indexOf('  function releaseSpecimenObjectUrls() {');
const end = source.indexOf('\n  function readHitColor(', start);
const closeStart = source.indexOf("  specimenBoxCloseButton.addEventListener('click', () => {");
const closeEnd = source.indexOf("\n  specimenBackgroundToggle.addEventListener(", closeStart);
assert.ok(start > 0 && end > start && closeStart > end && closeEnd > closeStart);
const code = source.slice(start, end) + '\n' + source.slice(closeStart, closeEnd)
  + '\nglobalThis.openBox = showSpecimenBox;';

class ClassList {
  constructor(){this.values=new Set();}
  add(n){this.values.add(n);}
  remove(n){this.values.delete(n);}
  contains(n){return this.values.has(n);}
  toggle(n,force){
    const add = force === undefined ? !this.contains(n) : !!force;
    if(add)this.add(n);else this.remove(n);return add;
  }
}
class Element {
  constructor(tag){
    this.tag=tag;this.children=[];this.classList=new ClassList();
    this.style={setProperty(){}};
    this.attributes={};this.listeners={};this.textContent='';this.src='';
    this._html='';
  }
  set innerHTML(s){this._html=s;this.children=[];}
  get innerHTML(){return this._html;}
  append(...children){this.children.push(...children);}
  appendChild(c){this.children.push(c);return c;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
}
const record = (id,date) => ({
  generation_id:'gen00042', generation_number:42, individual_index:id,
  saved_at:date, image_blob:new Blob(['image-'+id]), environment_id:'test-env'
});
function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
function harness(){
  const state={specimenObjectUrls:[]};
  const specimenGrid=new Element('grid');
  const specimenBoxOverlay=new Element('overlay');
  const specimenBackgroundToggle=new Element('toggle');
  const specimenBoxCloseButton=new Element('close');
  const specimenLoadMoreButton=new Element('load-more');
  specimenLoadMoreButton.hidden=true;
  const created=[],revoked=[],queued=[],calls=[];
  const document={baseURI:'https://example.test/',
    createElement:tag=>new Element(tag)};
  const URL={
    createObjectURL(){const value='blob:mock-'+(created.length+1);created.push(value);return value;},
    revokeObjectURL(value){revoked.push(value);}
  };
  const window={GitaiHabitatAccess:{get(){return null;}}};
  const ctx={
    Blob,URL,window,document,state,specimenGrid,specimenBoxOverlay,
    specimenBackgroundToggle,specimenBoxCloseButton,specimenLoadMoreButton,
    specimenAll(){const next=queued.shift();assert.ok(next,'missing store response');return next.promise;},
    showMothShare(...args){calls.push(args);}
  };
  vm.runInNewContext(code,ctx,{filename:'index.html:PF04',timeout:4000});
  return {created,revoked,state,specimenGrid,specimenBoxOverlay,
    specimenBoxCloseButton,specimenLoadMoreButton,calls,queue(){const d=deferred();queued.push(d);return d;},
    open:()=>ctx.openBox(),close:()=>specimenBoxCloseButton.listeners.click(),
    cards:()=>specimenGrid.children.filter(x=>x.className==='specimen-card'),
    empty:()=>specimenGrid.children.filter(x=>x.className==='specimen-empty')
  };
}
(async()=>{
  // Older request finishing last must not duplicate cards or object URLs.
  const duplicate=harness();
  const old=duplicate.queue(),latest=duplicate.queue();
  const oldOpen=duplicate.open(),newOpen=duplicate.open();
  latest.resolve([record(1,'2026-01-01'),record(2,'2026-02-01')]);
  await newOpen;
  old.resolve([record(3,'2026-03-01')]);await oldOpen;
  assert.equal(duplicate.cards().length,2);
  assert.equal(duplicate.created.length,2);
  assert.equal(duplicate.state.specimenObjectUrls.length,2);
  assert.equal(duplicate.cards()[0].children[1].children[1].textContent,'MOTH 02',
    'newest saved item is still first');
  // Closing in-flight request must not draw cards or retain URLs.
  const closed=harness();const pending=closed.queue();
  const waiting=closed.open();closed.close();
  pending.resolve([record(1,'2026-01-01')]);await waiting;
  assert.equal(closed.cards().length,0);
  assert.equal(closed.created.length,0);
  assert.equal(closed.state.specimenObjectUrls.length,0);
  assert.equal(closed.specimenBoxOverlay.classList.contains('visible'),false);
  // Closing and reopening lets only the newest read render.
  const reopened=harness();
  const first=reopened.queue(),second=reopened.queue();
  const loading=reopened.open();reopened.close();
  const next=reopened.open();second.resolve([record(5,'2026-02-01')]);
  await next;first.resolve([record(3,'2026-01-01')]);await loading;
  assert.equal(reopened.cards().length,1);
  assert.equal(reopened.cards()[0].children[1].children[1].textContent,'MOTH 05');
  reopened.close();
  assert.deepEqual(reopened.revoked,['blob:mock-1']);
  assert.equal(reopened.cards().length,0);
  assert.equal(reopened.state.specimenObjectUrls.length,0);
  // Reopening after deleting a record redraws only current records, and
  // revokes the previous session's URLs.
  const deleteCase=harness();
  const many=deleteCase.queue();
  const open1=deleteCase.open();many.resolve([record(1,'2026-01-01'),record(2,'2026-02-01')]);
  await open1;
  const fewer=deleteCase.queue();
  const open2=deleteCase.open();fewer.resolve([record(2,'2026-02-01')]);
  await open2;
  assert.equal(deleteCase.cards().length,1);
  assert.deepEqual(deleteCase.revoked,['blob:mock-1','blob:mock-2']);
  assert.equal(deleteCase.state.specimenObjectUrls.length,1);
  // Empty snapshot.
  const empty=harness();const noRecords=empty.queue();
  const opened=empty.open();noRecords.resolve([]);await opened;
  assert.equal(empty.empty().length,1);
  assert.equal(empty.created.length,0);
  // Failed active load shows one message, never orphan URLs.
  const failed=harness();const broken=failed.queue();
  const underway=failed.open();broken.reject(Error('test read error'));await underway;
  assert.equal(failed.empty().length,1);
  assert.match(failed.empty()[0].textContent,/読み込めませんでした/);
  assert.equal(failed.created.length,0);
  // Older failed load must not erase a newer completed open.
  const raced=harness();const stale=raced.queue(),fresh=raced.queue();
  const a=raced.open(),b=raced.open();fresh.resolve([record(8,'2026-01-01')]);
  await b;stale.reject(Error('stale failure'));await a;
  assert.equal(raced.cards().length,1);
  assert.equal(raced.empty().length,0);
  assert.equal(raced.created.length,1);

  // PF06: hundreds of stored specimens must not generate hundreds of Blob URLs
  // or DOM cards at first open. The user can explicitly reveal the rest.
  const large=harness();const manyRecords=large.queue();
  const list=Array.from({length:95},(_,i)=>
    record(i+1,'2026-04-'+String(i+1).padStart(3,'0')));
  const largeOpen=large.open();manyRecords.resolve(list);await largeOpen;
  assert.equal(large.cards().length,30,'first paint is capped to one batch');
  assert.equal(large.created.length,30,'only first batch gets object URLs');
  assert.equal(large.specimenLoadMoreButton.hidden,false);
  assert.match(large.specimenLoadMoreButton.textContent,/30 \/ 95件/);
  // Newest-first sort is unchanged; click still opens the saved original record.
  assert.equal(large.cards()[0].children[1].children[1].textContent,'MOTH 95');
  large.cards()[0].listeners.click();
  assert.equal(large.calls[0][0],'gen00042');
  assert.equal(large.calls[0][1],95);
  large.specimenLoadMoreButton.listeners.click();
  assert.equal(large.cards().length,60);
  assert.equal(large.created.length,60);
  large.specimenLoadMoreButton.listeners.click();
  assert.equal(large.cards().length,90);
  large.specimenLoadMoreButton.listeners.click();
  assert.equal(large.cards().length,95);
  assert.equal(large.created.length,95);
  assert.equal(large.specimenLoadMoreButton.hidden,true);
  large.close();
  assert.equal(large.revoked.length,95,'close releases all created Blob URLs');
  assert.equal(large.cards().length,0);
  assert.equal(large.state.specimenObjectUrls.length,0);
  // No stale user event can create more URLs when closed.
  large.specimenLoadMoreButton.listeners.click();
  assert.equal(large.created.length,95);
  console.log('PF04/PF06: async races, batched specimen rendering, manual reveal, ordering, click, and Blob URL cleanup OK.');
})().catch(err=>{console.error(err);process.exitCode=1;});
