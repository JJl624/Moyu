const {test}=require('node:test'),assert=require('node:assert/strict');
const {CoalescedWrites}=require('../shared/coalesced-writes.mjs');
test('A typing burst writes only the latest recovery snapshot; explicit flush is durable',async()=>{
  const stored=[],queue=new CoalescedWrites(async value=>stored.push(value));
  const waiting=[];for(let i=0;i<100;i++)waiting.push(queue.set('note',{content:String(i)}));
  await queue.flush();assert.equal(stored.length,1);assert.equal(stored[0].content,'99');assert((await Promise.all(waiting)).every(Boolean));
  await queue.flush();assert.equal(stored.length,1);
});
test('Continuous typing has a maximum recovery delay rather than postponing writes indefinitely',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const stored=[],queue=new CoalescedWrites(async value=>stored.push(value),{delay:350,maxWait:1500});
  const waiting=[];for(let i=0;i<5;i++){waiting.push(queue.set('note',i));t.mock.timers.tick(300);}
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.deepEqual(stored,[4]);assert((await Promise.all(waiting)).every(Boolean));
});
test('A lifecycle flush waits for an active write and then commits the newer snapshot',async()=>{
  let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),stored=[];
  const queue=new CoalescedWrites(async value=>{if(!stored.length){started();await gate;}stored.push(value);});
  const first=queue.set('note','old'),writing=queue.flush();await ready;
  const next=queue.set('note','new');let finished=false;const flush=queue.flush().then(()=>finished=true);
  await Promise.resolve();assert.equal(finished,false);release();await Promise.all([first,next,writing,flush]);assert.deepEqual(stored,['old','new']);
});
test('Discard cancels pending drafts and waits for active writes before deleting recovery data',async()=>{
  let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),stored=new Map();
  const queue=new CoalescedWrites(async value=>{started();await gate;stored.set(value.path,value.content);});
  const first=queue.set('root:a',{path:'a',content:'old'}),writing=queue.flush();await ready;
  const newer=queue.set('root:a',{path:'a',content:'new'}),other=queue.set('root:b',{path:'b',content:'other'});
  const discard=queue.discard(value=>value.path==='a').then(()=>stored.delete('a'));release();await Promise.all([first,newer,writing,discard]);await queue.flush();await other;
  assert.deepEqual([...stored],[['b','other']]);
});
test('Failed writes remain available for explicit retry without an automatic retry loop or stale replacement',async()=>{
  let fail=true;const stored=[],queue=new CoalescedWrites(async value=>{if(fail)throw Error('disk full');stored.push(value);});
  const first=assert.rejects(queue.set('note','old'),/disk full/);await assert.rejects(queue.flush(),/disk full/);await first;
  const next=queue.set('note','new');fail=false;await queue.flush();await next;assert.deepEqual(stored,['new']);
});
