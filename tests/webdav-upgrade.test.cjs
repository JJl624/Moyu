const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Vault } = require('../electron/vault.cjs');
const { WebDAVSync } = require('../electron/sync.cjs');
const { SyncScheduler } = require('../electron/sync-scheduler.cjs');
const { policy, excludedBy } = require('../electron/sync-policy.cjs');
const { davServer } = require('./helpers/dav-server.cjs');
const base = path.resolve(__dirname, '../../../work/webdav-upgrade');
async function fixture(t, settings = {}, serverOptions = {}) {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-')), vault = await new Vault(root).init();
  const server = await davServer(serverOptions), config = { url: server.url, directory: '/Moyu', username: 'user', password: 'secret', sync: settings }, events = [];
  const sync = new WebDAVSync(vault, async () => config, { onProgress: e => events.push(e) });
  t.after(async () => { await sync.cancel(); await server.close(); assert.equal(path.dirname(root), base); await fs.rm(root, {recursive:true,force:true}); });
  return { root, vault, server, config, sync, events };
}
async function put(root, name, text) { const target = path.join(root, name); await fs.mkdir(path.dirname(target), {recursive:true}); await fs.writeFile(target, text); }
async function edit(vault, name, content) { const old = await vault.read(name); await vault.save(name, content, old.version); }
test('A committed upload with a lost response verifies the body instead of reporting a false conflict',async t=>{
  const {vault,server,sync}=await fixture(t,{retries:1});await vault.create('a.md','file','old');await sync.sync();await edit(vault,'a.md','new');server.loseNextPut('/Moyu/a.md');const result=await sync.sync();assert.equal(result.conflicts.length,0);assert.equal(server.files.get('/Moyu/a.md').toString(),'new');assert.equal((await sync.sync()).changes.length,0);
  await vault.create('b.md','file','brand new');server.loseNextPut('/Moyu/b.md');assert.equal((await sync.sync()).conflicts.length,0);assert.equal(server.files.get('/Moyu/b.md').toString(),'brand new');
});

test('Defaults are manual, exclusion patterns are portable and invalid limits are rejected', () => {
  const settings = policy(); assert.equal(settings.onOpen, false); assert.equal(settings.afterSave, false); assert.equal(settings.interval, 0); assert.equal(settings.deletion, 'confirm');
  const excluded = excludedBy(policy({excludes:'*.tmp\n草稿/\n**/cache/**\nprivate/*.json',includeCodeData:false}));
  for (const name of ['a.tmp','dir/a.tmp','草稿/a.md','dir/草稿/a.md','cache/a.txt','dir/cache/b.txt','private/key.json','笔记.assets/code-data/0001/data.txt']) assert(excluded(name), name);
  for (const name of ['a.md','dir/private/key.json','笔记.assets/attachments/a.png','笔记.assets/document.json']) assert(!excluded(name), name);
  for (const input of [{timeout:0},{interval:-1},{concurrency:100},{deletion:'unsafe'},{maxFileMB:Infinity},{excludes:'../host'}]) assert.throws(()=>policy(input));
});

test('An unchanged sync performs no GET, PUT or DELETE and does not rewrite its baseline or document', async t => {
  const {root,vault,server,sync}=await fixture(t);
  await vault.create('中文.md','file','正文'); await put(root,'中文.assets/attachments/中文 % 图.svg','<svg/>');
  await sync.sync(); const stateFile=await sync.stateFile((await sync.client()).identity), before=await fs.readFile(stateFile), stat=await fs.stat(stateFile), docStat=await fs.stat(path.join(root,'中文.md'));
  const start=server.requests.length; await sync.sync(); await sync.status(); await sync.status();
  assert(!server.requests.slice(start).some(r=>['GET','PUT','DELETE','MKCOL'].includes(r.method)));
  assert.deepEqual(await fs.readFile(stateFile),before); assert.equal((await fs.stat(stateFile)).mtimeMs,stat.mtimeMs); assert.equal((await fs.stat(path.join(root,'中文.md'))).mtimeMs,docStat.mtimeMs);
  const restarted=new WebDAVSync(vault,sync.config); const offset=server.requests.length; await restarted.sync(); assert(!server.requests.slice(offset).some(r=>r.method==='GET'));
});

test('Only changed remote contents are fetched and changed local contents are uploaded', async t => {
  const {vault,server,sync}=await fixture(t); for(const n of ['a','b','c'])await vault.create(n+'.md','file',n);await sync.sync();
  server.files.set('/Moyu/b.md',Buffer.from('remote b')); await edit(vault,'a.md','local a'); const start=server.requests.length;
  await sync.sync(); const requests=server.requests.slice(start);
  assert.deepEqual(requests.filter(r=>r.method==='GET').map(r=>r.path),['/Moyu/b.md']);assert.deepEqual(requests.filter(r=>r.method==='PUT').map(r=>r.path),['/Moyu/a.md']);
  assert.equal((await vault.read('b.md')).content,'remote b');
});

test('First automatic sync only prepares a review and creates no remote directory', async t => {
  const {vault,server,sync}=await fixture(t);await vault.create('a.md','file','a');const pending=await sync.sync({automatic:true});
  assert(pending.needsConfirmation);assert(pending.firstSync);assert(!server.requests.some(r=>['PUT','MKCOL','DELETE'].includes(r.method)));assert.equal(sync.job.phase,'awaiting');
  const confirmed=await sync.sync({token:pending.token});assert.equal(confirmed.changes.length,1);assert(server.files.has('/Moyu/a.md'));
});

test('Delete reviews cancel safely, then approved snapshots propagate both local and remote deletion', async t => {
  const {vault,server,sync,root}=await fixture(t); await vault.create('a.md','file','a');await vault.create('b.md','file','b');await sync.sync();
  await fs.unlink(path.join(root,'a.md'));server.files.delete('/Moyu/b.md'); const pending=await sync.sync();assert(pending.needsConfirmation);assert.equal(pending.deletions.length,2);
  assert(server.files.has('/Moyu/a.md'));assert(await fs.stat(path.join(root,'b.md')));await sync.cancel();
  const preview=await sync.preview();await sync.sync({token:preview.token});assert(!server.files.has('/Moyu/a.md'));assert.equal(await fs.stat(path.join(root,'b.md')).catch(()=>null),null);
});

test('Excluding existing files, code data and oversized files never turns them into deletions', async t => {
  const {root,vault,server,sync,config}=await fixture(t,{deletion:'sync'});await vault.create('a.md','file','a');await put(root,'a.assets/code-data/0001/file.bin',Buffer.alloc(2*1024*1024));await put(root,'a.assets/attachments/image.svg','svg');await sync.sync();
  config.sync={deletion:'sync',excludes:'a.md',includeCodeData:false,maxFileMB:1};await fs.unlink(path.join(root,'a.md'));
  const result=await sync.sync();assert(server.files.has('/Moyu/a.md'));assert(server.files.has('/Moyu/a.assets/code-data/0001/file.bin'));assert(result.skipped.some(s=>s.path.endsWith('file.bin')));
  config.sync={deletion:'sync',maxFileMB:1};await fs.unlink(path.join(root,'a.assets/code-data/0001/file.bin'));await sync.sync();assert(server.files.has('/Moyu/a.assets/code-data/0001/file.bin'));
});

test('Keep deletion policy preserves the opposite copy; changing to sync propagates it later', async t => {
  const {root,vault,server,sync,config}=await fixture(t,{deletion:'keep'});await vault.create('a.md','file','a');await sync.sync();await fs.unlink(path.join(root,'a.md'));await sync.sync();assert(server.files.has('/Moyu/a.md'));
  config.sync={deletion:'sync'};await sync.sync();assert(!server.files.has('/Moyu/a.md'));
});

test('Conflict keep-both preserves exact bytes on both sides without resolving other conflicts', async t => {
  const {vault,server,sync,root}=await fixture(t);for(const n of ['a','b'])await vault.create(n+'.md','file','base');await sync.sync();
  for(const n of ['a','b']){await edit(vault,n+'.md','local '+n);server.files.set('/Moyu/'+n+'.md',Buffer.from('remote '+n));}
  const conflicts=(await sync.sync()).conflicts;assert.equal(conflicts.length,2);await sync.resolve({...conflicts[0],choice:'both'});
  assert.equal((await vault.read('a.md')).content,'local a');assert.equal(await fs.readFile(path.join(root,'a-远端-1.md'),'utf8'),'remote a');
  assert.equal(server.files.get('/Moyu/a.md').toString(),'local a');assert.equal(server.files.get('/Moyu/a-远端-1.md').toString(),'remote a');assert.equal((await sync.status()).conflicts.length,1);
});

test('A stale conflict decision and a changed file after a review do not overwrite content', async t => {
  const {vault,server,sync}=await fixture(t);await vault.create('a.md','file','base');await sync.sync();await edit(vault,'a.md','local');server.files.set('/Moyu/a.md',Buffer.from('remote'));
  const c=(await sync.sync()).conflicts[0];server.files.set('/Moyu/a.md',Buffer.from('new remote'));await assert.rejects(sync.resolve({...c,choice:'local'}),/冲突版本/);
  await sync.resolve({...((await sync.sync()).conflicts[0]),choice:'remote'});
  await edit(vault,'a.md','reviewed');const plan=await sync.preview();await edit(vault,'a.md','new local');await assert.rejects(sync.sync({token:plan.token}),/本地文件发生变化/);assert.equal(server.files.get('/Moyu/a.md').toString(),'new remote');
});

test('Large files stream beyond the old 20 MB cap and sync all companion metadata without .data', async t => {
  const {root,vault,server,sync}=await fixture(t);await vault.create('a.md','file','# a');
  await put(root,'a.assets/attachments/large.bin',Buffer.alloc(24*1024*1024,12));await put(root,'a.assets/document.json','{"version":2,"document":"a.md","nextId":2,"blocks":["0001"]}');await put(root,'.data/attachment_map.json','private');
  await sync.sync();assert.equal(server.files.get('/Moyu/a.assets/attachments/large.bin').length,24*1024*1024);assert(server.files.has('/Moyu/a.assets/document.json'));assert(!server.files.has('/Moyu/.data/attachment_map.json'));
  server.files.set('/Moyu/a.assets/attachments/large.bin',Buffer.alloc(25*1024*1024,13));await sync.sync();const stat=await fs.stat(path.join(root,'a.assets/attachments/large.bin'));assert.equal(stat.size,25*1024*1024);
  assert.equal((await fs.readdir(path.join(root,'.data/sync/transfers'))).length,0);
});

test('Cancelling a delayed download keeps documents editable, preserves bytes and cleans transfer files', async t => {
  const {root,vault,server,sync,events}=await fixture(t);await vault.create('a.md','file','base');await sync.sync();server.files.set('/Moyu/a.md',Buffer.from('remote'));
  const original=sync.client.bind(sync);let started;const ready=new Promise(r=>started=r);
  sync.client=async()=>{const c=await original(),request=c.client.customRequest.bind(c.client);c.client.customRequest=async(name,o)=>{if(o.method==='GET'){started();await delay(30000,undefined,{signal:o.signal});}return request(name,o);};return c;};
  const running=sync.sync();const rejection=assert.rejects(running,e=>e.code==='CANCELLED');await ready;
  await Promise.race([edit(vault,'a.md','editable during scan'),delay(1000).then(()=>{throw Error('vault locked by network');})]);
  await sync.cancel();await rejection;assert.equal((await vault.read('a.md')).content,'editable during scan');assert.equal(events.at(-1).phase,'cancelled');assert.equal((await fs.readdir(path.join(root,'.data/sync/transfers'))).length,0);
});

test('Simultaneous sync requests cannot race a baseline and transient failures retry safely', async t => {
  const {vault,sync}=await fixture(t,{retries:1});await vault.create('a.md','file','a');const original=sync.client.bind(sync);let calls=0;
  sync.client=async()=>{const c=await original(),request=c.client.customRequest.bind(c.client);c.client.customRequest=async(name,o)=>{if(o.method==='PUT'&&calls++===0)throw Object.assign(Error('busy'),{status:503});return request(name,o);};return c;};
  const running=sync.sync();assert.throws(()=>sync.sync(),e=>e.code==='BUSY');await running;assert.equal(calls,2);
});

test('Scheduler defaults make no calls, removed pause is ignored and pending reviews block repetition', async () => {
  let calls=0,finished=0;const sync={job:{phase:'idle'},sync:async()=>{calls++;return{};}};
  const scheduler=new SyncScheduler(sync,async()=>finished++);scheduler.configure({url:'url',sync:{}});await scheduler.trigger();assert.equal(calls,1); // explicit trigger, no automatic timer
  scheduler.configure({url:'url',sync:{paused:true}});assert.equal(scheduler.settings.paused,undefined);await scheduler.trigger();assert.equal(calls,2);
  scheduler.configure({url:'url',sync:{}});sync.job.phase='awaiting';await scheduler.trigger();assert.equal(calls,2);assert.equal(finished,2);scheduler.close();
});

test('An approved empty knowledge base creates its remote root and can synchronize again', async t => {
  const {sync,server}=await fixture(t);const plan=await sync.preview();assert(plan.firstSync);assert.equal(plan.changes.length,0);await sync.sync({token:plan.token});assert(server.directories.has('/Moyu'));await sync.sync();
});

test('Expired approval tokens require a new review and never silently approve new deletions', async t => {
  const {sync,vault,root,server}=await fixture(t);await vault.create('a.md','file','a');await sync.sync();await fs.unlink(path.join(root,'a.md'));const plan=await sync.preview();sync.plan.created-=121000;
  const result=await sync.sync({token:plan.token});assert(result.needsConfirmation);assert(server.files.has('/Moyu/a.md'));assert.notEqual(result.token,plan.token);
});

test('Cancelling a large upload does not leak stream errors or delete the source file', async t => {
  const {sync,root}=await fixture(t);await put(root,'large.bin',Buffer.alloc(3*1024*1024));const original=sync.client.bind(sync);let start;const ready=new Promise(r=>start=r);
  sync.client=async()=>{const c=await original(),request=c.client.customRequest.bind(c.client);c.client.customRequest=async(name,o)=>{if(o.method==='PUT'){start();await delay(30000,undefined,{signal:o.signal});}return request(name,o);};return c;};
  const running=sync.sync(),rejection=assert.rejects(running,e=>e.code==='CANCELLED');await ready;await sync.cancel();await rejection;assert.equal((await fs.stat(path.join(root,'large.bin'))).size,3*1024*1024);
});

test('Cloud directory snapshots reuse sync listing, preserve empty folders, and manual refresh only lists metadata', async t => {
  const {vault,server,sync,config}=await fixture(t,{excludes:'*.tmp'});
  await vault.create('a.md','file','body');await sync.sync();
  server.directories.add('/Moyu/空目录');server.directories.add('/Moyu/资料');server.files.set('/Moyu/资料/中文.tmp',Buffer.from('excluded'));
  server.directories.add('/Moyu/.hidden');server.files.set('/Moyu/.hidden/secret.txt',Buffer.from('not synced'));
  const at=server.requests.length;await sync.sync();
  const requestCount=server.requests.length,status=await sync.status();
  assert.equal(server.requests.length,requestCount);
  assert(status.cloud.entries.some(e=>e.path==='空目录'&&e.type==='folder'));
  assert(status.cloud.entries.some(e=>e.path==='资料/中文.tmp'&&e.excluded==='已排除'&&e.size===8));
  assert(!server.requests.slice(at).some(r=>r.method==='GET'));
  const start=server.requests.length,tree=await sync.refreshTree();
  assert(tree.entries.some(e=>e.path==='.hidden/secret.txt'));
  assert(server.requests.slice(start).every(r=>r.method==='PROPFIND'));
  const again=server.requests.length;assert.deepEqual((await sync.status()).cloud,tree);assert.equal(server.requests.length,again);
  assert.equal((await sync.status()).report.totalChanges,0);
  assert.equal((await sync.status()).report.bytes,0);
  config.directory='/Other';assert.equal((await sync.status()).cloud,null);
});

test('Identical cloud metadata preserves the directory snapshot file and only advances its small scan timestamp',async t=>{
  const {sync}=await fixture(t),{saveTree,readTree}=require('../electron/sync-tree.cjs'),file=await sync.stateFile((await sync.client()).identity);
  const entries=[{path:'b.txt',type:'file',size:2},{path:'a',type:'folder',size:0}];
  await saveTree(file,'/Moyu',entries);const bytes=await fs.readFile(file+'.tree.json'),stat=await fs.stat(file+'.tree.json');
  await delay(15);const next=await saveTree(file,'/Moyu',[...entries].reverse());
  assert.deepEqual(await fs.readFile(file+'.tree.json'),bytes);assert.equal((await fs.stat(file+'.tree.json')).mtimeMs,stat.mtimeMs);
  assert.deepEqual(await readTree(file),next);assert.equal((await fs.stat(file+'.tree-scan.json')).size<100,true);
});

for(const style of ['bare','mixed'])test('Opaque '+style+' ETags round trip edits, downloads and deletes without inventing quotes or bypassing conflicts',async t=>{
  const {vault,server,sync,root}=await fixture(t,{deletion:'sync'},{etagStyle:style,numericETag:true});
  const doc=await vault.create('中文.md','file','base');await sync.sync();
  for(const text of ['updated','updated again']){await edit(vault,doc.path,text);const result=await sync.sync();assert.equal(result.conflicts.length,0);assert.equal(server.files.get('/Moyu/中文.md').toString(),text);}
  const writes=server.requests.filter(r=>r.path==='/Moyu/中文.md'&&r.method==='PUT'&&r.headers['if-match']);assert.equal(writes.length,2);assert(writes.every(r=>/^\d+$/.test(r.headers['if-match'])));
  server.files.set('/Moyu/中文.md',Buffer.from('remote'));await sync.sync();assert.equal((await vault.read(doc.path)).content,'remote');
  await edit(vault,doc.path,'local race');server.setRace({path:'/Moyu/中文.md',method:'PUT',content:'remote race'});
  await assert.rejects(sync.sync(),e=>e.code==='CONFLICT');assert.equal(server.files.get('/Moyu/中文.md').toString(),'remote race');assert.equal((await vault.read(doc.path)).content,'local race');
  const conflict=(await sync.sync()).conflicts[0];assert(conflict);await sync.resolve({...conflict,choice:'local'});
  await fs.unlink(path.join(root,doc.path));await sync.sync();assert(!server.files.has('/Moyu/中文.md'));
});
test('Cached quoted directory ETags recover a header-only quoting difference only after verifying the unchanged remote bytes',async t=>{
 const {vault,server,sync}=await fixture(t);await vault.create('a.md','file','old');await sync.sync();await edit(vault,'a.md','new');
 const original=sync.client.bind(sync);sync.client=async()=>{const c=await original(),send=c.client.customRequest.bind(c.client);c.client.customRequest=async(name,o)=>{
   if(o.method==='PUT'&&o.headers['If-Match']?.startsWith('"'))throw Object.assign(Error('quotes rejected'),{status:412});
   if(o.method==='HEAD'){const r=await send(name,o);r.headers.set('etag',r.headers.get('etag').replaceAll('"',''));return r;}
   if(['GET','PUT'].includes(o.method)&&o.headers['If-Match']&&!o.headers['If-Match'].startsWith('"')){const r=await send(name,{...o,headers:{...o.headers,'If-Match':'"'+o.headers['If-Match']+'"'}});r.headers.set('etag',r.headers.get('etag').replaceAll('"',''));return r;}
   return send(name,o);
 };return c;};
 await sync.sync();assert.equal(server.files.get('/Moyu/a.md').toString(),'new');assert(server.requests.some(r=>r.method==='HEAD'));
});
test('Cloud times come from server metadata; missing times are not manufactured after an upload',async t=>{
 const {vault,sync}=await fixture(t,{}, {omitTimes:true});await vault.create('a.md','file','a');await sync.sync();let entry=(await sync.status()).cloud.entries.find(e=>e.path==='a.md');assert.equal(entry.modified,undefined);assert.equal(entry.created,undefined);
 const f=await fixture(t,{}, {lastModified:'Mon, 12 Oct 2026 04:00:00 GMT',created:'2026-10-01T00:00:00Z'});await f.vault.create('b.md','file','b');await f.sync.sync();await f.sync.refreshTree();entry=(await f.sync.status()).cloud.entries.find(e=>e.path==='b.md');assert.equal(entry.modified,Date.parse('2026-10-12T04:00:00Z'));assert.equal(entry.created,Date.parse('2026-10-01T00:00:00Z'));
});

test('Older cached cloud structure remains readable but its unverified local timestamps are not presented as server times',async t=>{
 const {sync}=await fixture(t),{readTree}=require('../electron/sync-tree.cjs'),file=await sync.stateFile((await sync.client()).identity);
 await fs.writeFile(file+'.tree.json',JSON.stringify({root:'/Moyu',scannedAt:100,entries:[{path:'a.md',type:'file',size:1,modified:100}]}));
 const before=await fs.readFile(file+'.tree.json'),tree=await readTree(file);assert.equal(tree.entries[0].path,'a.md');assert.equal(tree.entries[0].modified,undefined);assert.deepEqual(await fs.readFile(file+'.tree.json'),before);
});
test('directory refresh has its own job identity and completed synchronization lists the actual post-transfer server structure',async t=>{
 const {sync,server,vault}=await fixture(t);server.directories.add('/Moyu');const jobs=[];sync.options.onProgress=j=>jobs.push({...j});await sync.refreshTree();assert(jobs.some(j=>j.operation==='directory'&&j.phase==='scan'));
 await vault.create('nested','folder');await vault.create('nested/new.md','file','new');const before=server.requests.length;await sync.sync();const requests=server.requests.slice(before),lastPut=requests.findLastIndex(r=>r.method==='PUT');assert(lastPut>=0);assert(requests.slice(lastPut+1).some(r=>r.method==='PROPFIND'));const tree=(await sync.status()).cloud;assert(tree.entries.some(e=>e.path==='nested/new.md'));assert(tree.entries.some(e=>e.path==='nested'&&e.type==='folder'));assert.equal(sync.job.operation,'sync');
});


test('A confirmed plan is rescanned if connection or exclusion settings change while preview is open', async t => {
  const {vault,server,sync,config}=await fixture(t,{deletion:'sync'});
  await vault.create('private.md','file','private');
  const preview=await sync.preview();
  config.sync.excludes='private.md';
  const changed=await sync.sync({token:preview.token});
  assert.equal(changed.needsConfirmation,true);
  assert.notEqual(changed.token,preview.token);
  assert(!server.files.has('/Moyu/private.md'));
  await sync.sync({token:changed.token});
  assert(!server.files.has('/Moyu/private.md'));
  const next=await sync.preview();
  config.password='changed';
  await assert.rejects(sync.sync({token:next.token}),/用户名或密码/);
  assert.equal(sync.plan,null);
});
