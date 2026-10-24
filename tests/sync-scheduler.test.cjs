const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setImmediate:turn}=require('node:timers/promises');
const {SyncScheduler}=require('../electron/sync-scheduler.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('A save during an automatic desktop sync is sent after the active sync ends',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const first=deferred();let calls=0;
  const sync={job:{phase:'idle'},sync:async()=>{calls++;return calls===1?first.promise:{};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://example.test',sync:{afterSave:true}});
  const active=scheduler.trigger();scheduler.changed();t.mock.timers.tick(2000);assert.equal(calls,1);first.resolve({});await active;t.mock.timers.tick(2000);await turn();assert.equal(calls,1);t.mock.timers.tick(26000);await turn();assert.equal(calls,2);
});

test('Desktop automatic saves coalesce for 30 seconds and an account cooldown delays queued work',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;const sync={job:{phase:'idle'},budget:{retryAt:60000},sync:async()=>{calls++;return{};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://example.test',sync:{afterSave:true}});scheduler.changed();t.mock.timers.tick(2000);await turn();assert.equal(calls,0);t.mock.timers.tick(58000);await turn();assert.equal(calls,1);
  for(let i=0;i<5;i++){scheduler.changed();t.mock.timers.tick(2000);await turn();}assert.equal(calls,1);t.mock.timers.tick(20000);await turn();assert.equal(calls,2);
});

test('A save queued behind a manual desktop sync waits for its running promise',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const manual=deferred();let calls=0;
  const sync={job:{phase:'transfer'},running:manual.promise,sync:async()=>{calls++;return{};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://example.test',sync:{afterSave:true}});
  scheduler.changed();t.mock.timers.tick(2000);assert.equal(calls,0);sync.running=null;manual.resolve();await turn();t.mock.timers.tick(2000);await turn();assert.equal(calls,1);
});

test('Closing or reconfiguring a desktop scheduler invalidates work waiting behind another sync',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const manual=deferred();let calls=0;
  const sync={job:{phase:'transfer'},running:manual.promise,sync:async()=>{calls++;return{};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://old.test',sync:{afterSave:true}});
  scheduler.changed();t.mock.timers.tick(2000);scheduler.configure({url:'https://new.test',sync:{afterSave:false,onOpen:false}});sync.running=null;manual.resolve();await turn();t.mock.timers.tick(5000);await turn();assert.equal(calls,0);
});

test('Desktop startup is opt-in and pending first-sync reviews stop repeated automatic attempts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const sync={job:{phase:'idle'},sync:async()=>{calls++;sync.job.phase='awaiting';return{needsConfirmation:true};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://example.test',sync:{}},true);t.mock.timers.tick(5000);await turn();assert.equal(calls,0);
  scheduler.configure({url:'https://example.test',sync:{onOpen:true,afterSave:true}},true);t.mock.timers.tick(1500);await turn();assert.equal(calls,1);scheduler.changed();t.mock.timers.tick(5000);await turn();assert.equal(calls,1);
});

test('Desktop watcher events caused by a download never trigger another network scan; later local edits still do',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0,changed=false;const checked=[];
  const sync={job:{phase:'idle'},hasLocalChanges:async paths=>{checked.push([...paths]);return changed;},sync:async()=>{calls++;return{};}};
  const scheduler=new SyncScheduler(sync);t.after(()=>scheduler.close());scheduler.configure({url:'https://example.test',sync:{afterSave:true}});scheduler.changed('downloaded.md');t.mock.timers.tick(2000);await turn();assert.equal(calls,0);assert.deepEqual(checked,[['downloaded.md']]);changed=true;scheduler.changed('edited.md');t.mock.timers.tick(2000);await turn();assert.equal(calls,1);
});
