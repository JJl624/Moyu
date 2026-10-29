const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const native=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {Vault}=require('../electron/vault.cjs');
const {WebDAVSync}=require('../electron/sync.cjs');
const {localFiles}=require('../electron/sync-files.cjs');
const {davServer}=require('./helpers/dav-server.cjs');
const base=path.resolve(__dirname,'../../../work/sync-io-tests');
async function fixture(t){
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-')),vault=await new Vault(root).init(),server=await davServer();
  const sync=new WebDAVSync(vault,async()=>({url:server.url,directory:'/Moyu',username:'user',password:'secret',sync:{concurrency:4,deletion:'sync'}}));
  t.after(async()=>{await sync.cancel();await server.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});return{root,vault,server,sync};
}
test('Local exclusions prune directories; changed-path checks do not read unrelated files and stable hashes are reused',async t=>{
  const {root,vault}=await fixture(t);for(const dir of ['kept','ignored','other']){await fs.mkdir(path.join(root,dir));await fs.writeFile(path.join(root,dir,'a.md'),'one');}
  const read=fs.readdir,stream=native.createReadStream;let opens=0;const cache={};
  fs.readdir=async(folder,...args)=>{assert(!['ignored','other'].includes(path.basename(folder)),'must not enter excluded or unrelated folders');return read(folder,...args);};
  native.createReadStream=(...args)=>{opens++;return stream(...args);};
  try{
    const selected=new Set(['kept/a.md','ignored']),excluded=name=>name==='ignored'||name.startsWith('ignored/');
    const first=await localFiles(vault,excluded,Infinity,cache,undefined,selected);assert.deepEqual(Object.keys(first.files),['kept/a.md']);assert.equal(opens,1);assert(first.skipped.some(item=>item.path==='ignored'));
    await localFiles(vault,excluded,Infinity,cache,undefined,selected);assert.equal(opens,1);
    const file=path.join(root,'kept/a.md'),before=await fs.stat(file);await fs.writeFile(file,'two');await fs.utimes(file,before.atime,before.mtime);
    const next=await localFiles(vault,excluded,Infinity,cache,undefined,selected);assert.notEqual(next.files['kept/a.md'].version,first.files['kept/a.md'].version);assert.equal(opens,2);
  }finally{fs.readdir=read;native.createReadStream=stream;}
});
test('Save-trigger checks hash only the affected file and the following sync reuses that hash',async t=>{
  const {vault,sync,server}=await fixture(t);await vault.create('a.md','file','base');await vault.create('b.md','file','base');await sync.sync();
  const doc=await vault.read('a.md');await vault.save('a.md','edited',doc.version);sync.invalidateLocal('a.md');
  const stream=native.createReadStream,opened=[];native.createReadStream=(file,...args)=>{opened.push(path.basename(file));return stream(file,...args);};
  try{
    const before=server.requests.length;assert.equal(await sync.hasLocalChanges(new Set(['a.md'])),true);assert.equal(server.requests.length,before);assert.deepEqual(opened,['a.md']);
    opened.length=0;await sync.sync();assert.deepEqual(opened,[]);const requests=server.requests.slice(before);assert.equal(requests.filter(item=>item.method==='PROPFIND').length,1);assert.equal(requests.filter(item=>item.method==='PUT').length,1);
    assert.equal(await sync.hasLocalChanges(new Set(['missing.md'])),false);
  }finally{native.createReadStream=stream;}
});
test('Remote downloads remain serial even with an old parallel-download preference',async t=>{
  const {vault,sync,server}=await fixture(t);for(const name of ['a.md','b.md','c.md'])await vault.create(name,'file','base');await sync.sync();
  for(const name of ['a.md','b.md','c.md'])server.files.set('/Moyu/'+name,Buffer.from('remote'));
  const client=sync.client.bind(sync);let active=0,maximum=0;
  sync.client=async()=>{const context=await client(),request=context.client.customRequest.bind(context.client);context.client.customRequest=async(...args)=>{if(args[1].method!=='GET')return request(...args);active++;maximum=Math.max(maximum,active);try{await delay(180);return await request(...args);}finally{active--;}};return context;};
  await sync.sync();assert.equal(maximum,1);assert.equal((await vault.read('b.md')).content,'remote');
});
test('Consolidated document state syncs with data and pinned HTML; resizing transfers only the changed management record',async t=>{
  const {vault,root,sync,server}=await fixture(t),{Attachments}=require('../electron/attachments.cjs'),{CodeData}=require('../electron/code-data.cjs');
  const {ResultStore}=require('../electron/result-store.cjs'),{HTMLResults}=require('../electron/html-results.cjs'),{PinnedHTML}=require('../electron/pinned-html.cjs');
  const attachments=new Attachments(vault),current=new CodeData(vault,attachments),store=new ResultStore(),html=new HTMLResults(store,{current:()=>current}),pins=new PinnedHTML(html,()=>current);
  const markdown='```js {id=0001}\ndisplayHTML("note")\n```';await vault.create('note.md','file',markdown);
  await attachments.upload({document:'note.md',name:'photo.svg',bytes:Buffer.from('<svg/>')});
  await current.upload({document:'note.md',language:'js',id:'0001',name:'data.txt',bytes:Buffer.from('user data')});
  const artifact=store.retain([{kind:'html',name:'result.html',data:Buffer.from('<p>note</p>').toString('base64')}])[0];
  html.contexts.set(artifact.token,{current,input:{document:'note.md',id:'0001',language:'js',code:'displayHTML("note")'},context:{files:[]}});await pins.attach(artifact.token,0);await pins.pin({token:artifact.token,pinned:true,height:220});
  await sync.sync();
  for(const file of ['note.md','note.assets/document.json','note.assets/attachments/photo.svg','note.assets/code-data/0001/data.txt','note.assets/results/0001/0.html'])assert.deepEqual(server.files.get('/Moyu/'+file),await fs.readFile(path.join(root,file)));
  assert(![...server.files.keys()].some(file=>file.includes('/.data/')||file.endsWith('/results.json')));
  await pins.resize({token:artifact.token,height:300});sync.invalidateLocal('note.assets/document.json');const before=server.requests.length;await sync.sync();
  assert.deepEqual(server.requests.slice(before).filter(request=>['PUT','GET','DELETE'].includes(request.method)).map(request=>[request.method,request.path]),[['PUT','/Moyu/note.assets/document.json']]);
  assert.equal(JSON.parse(server.files.get('/Moyu/note.assets/document.json')).results['0001'].items[0].height,300);
  const receiver=path.join(root,'receiver');await fs.mkdir(receiver);const other=await new Vault(receiver).init(),incoming=new WebDAVSync(other,async()=>({url:server.url,directory:'/Moyu',username:'user',password:'secret',sync:{deletion:'sync'}}));
  try{await incoming.sync();const records=new Attachments(other).documents;await records.discover();assert.equal((await records.counter('note.md')).next,2);assert.equal((await records.read('note.md')).documents['note.md'].results['0001'].items[0].height,300);assert.equal(await fs.readFile(path.join(receiver,'note.assets/code-data/0001/data.txt'),'utf8'),'user data');}
  finally{await incoming.cancel();}
});
