const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{Attachments}=require('../electron/attachments.cjs'),{CodeData}=require('../electron/code-data.cjs');
const {References}=require('../electron/references.cjs'),{ResultStore}=require('../electron/result-store.cjs'),{HTMLResults}=require('../electron/html-results.cjs'),{PinnedHTML}=require('../electron/pinned-html.cjs');
const source='```js {id=0001}\nconsole.log(1)\n```\n\n```js {id=0002}\nconsole.log(2)\n```';
async function fixture(t){
  const base=path.resolve(__dirname,'../../../work/storage-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
  t.after(async()=>{assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const vault=await new Vault(root).init(),attachments=new Attachments(vault),data=new CodeData(vault,attachments,new References(vault)),store=new ResultStore(),html=new HTMLResults(store,{current:()=>data}),pins=new PinnedHTML(html,()=>data);
  await vault.create('笔记.md','file',source);return {root,vault,attachments,data,store,html,pins,map:attachments.documents};
}
async function legacy(f,id,height=220){
  await f.vault.mutate(()=>f.map.ensureUnlocked('笔记.md'));
  const directory=path.join(f.root,'笔记.assets/results',id);await fs.mkdir(directory,{recursive:true});
  const item={index:0,file:'0.html',name:'result.html',height,language:'js',code:'old '+id};
  await fs.writeFile(path.join(directory,'0.html'),'<p>'+id+'</p>');await fs.writeFile(path.join(directory,'results.json'),JSON.stringify({items:[item]}));return item;
}
test('Plain notes and read-only operations create no document records, companion directories or empty children',async t=>{
  const f=await fixture(t);await f.vault.create('普通.md','file','just text');
  for(let i=0;i<10;i++){await f.map.sync('普通.md','just text');assert.deepEqual(await f.map.counter('普通.md'),{next:1});await f.vault.list();}
  assert.deepEqual((await fs.readdir(f.root)).sort(),['普通.md','笔记.md'].sort());
  await f.attachments.upload({document:'普通.md',name:'a.pdf',bytes:Buffer.from('PDF')});
  assert.deepEqual((await fs.readdir(path.join(f.root,'普通.assets'))).sort(),['attachments','document.json']);
  await f.data.upload({document:'笔记.md',id:'0001',language:'js',name:'data.txt',bytes:Buffer.from('data')});
  assert.deepEqual((await fs.readdir(path.join(f.root,'笔记.assets'))).sort(),['code-data','document.json']);
});
test('Only unbound counters live in the index; binding transfers authority without losing deleted IDs',async t=>{
  const f=await fixture(t);await f.map.sync('笔记.md',source,32);
  const index=path.join(f.root,'.data/document_map.json');assert.equal(JSON.parse(await fs.readFile(index)).documents['笔记.md'].nextId,32);
  assert.equal(await fs.stat(path.join(f.root,'笔记.assets')).catch(()=>null),null);
  await f.attachments.upload({document:'笔记.md',name:'data.txt',bytes:Buffer.from('x')});
  assert.deepEqual(JSON.parse(await fs.readFile(index)).documents['笔记.md'],{directory:'笔记.assets'});
  const before=await fs.readFile(index,'utf8'),mtime=(await fs.stat(index)).mtimeMs;
  const normalized=await f.map.sync('笔记.md','```js\nnew code\n```');assert.match(normalized.content,/id=0020/);
  assert.equal((await f.map.counter('笔记.md')).next,33);assert.equal(await fs.readFile(index,'utf8'),before);assert.equal((await fs.stat(index)).mtimeMs,mtime);
  const owner=JSON.parse(await fs.readFile(path.join(f.root,'笔记.assets/document.json')));assert.equal(owner.nextId,33);
});
test('Legacy mirrors migrate with the highest reserved ID; external owner edits become authoritative immediately',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});
  const index=path.join(f.root,'.data/document_map.json'),ownerFile=path.join(f.root,'笔记.assets/document.json');
  await fs.writeFile(index,JSON.stringify({version:2,documents:{'笔记.md':{directory:'笔记.assets',nextId:40,blocks:['0001']}}}));
  await f.map.discover();assert.equal((await f.map.counter('笔记.md')).next,40);assert.deepEqual(JSON.parse(await fs.readFile(index)).documents['笔记.md'],{directory:'笔记.assets'});
  const owner=JSON.parse(await fs.readFile(ownerFile));owner.nextId=64;owner.blocks=['0002'];await fs.writeFile(ownerFile,JSON.stringify(owner));
  assert.equal((await f.map.counter('笔记.md')).next,64);assert.deepEqual((await f.map.read('笔记.md')).documents['笔记.md'].blocks,['0002']);
  await fs.unlink(index);await f.map.discover();assert.equal((await f.map.counter('笔记.md')).next,64);
});
test('Legacy migration prunes only empty managed children and leaves payloads and unrelated folders intact',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('keep')});
  for(const name of ['code-data','results','用户空目录'])await fs.mkdir(path.join(f.root,'笔记.assets',name));
  const index=path.join(f.root,'.data/document_map.json'),map=await f.map.read();map.version=2;await fs.writeFile(index,JSON.stringify(map));
  await f.map.discover();assert.deepEqual((await fs.readdir(path.join(f.root,'笔记.assets'))).sort(),['attachments','document.json','用户空目录'].sort());
  assert.equal(await fs.readFile(path.join(f.root,'笔记.assets/attachments/a.txt'),'utf8'),'keep');
});
test('Warm record lookups and explorer listings do not reread JSON or unrelated document records',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});
  await f.vault.create('其他.md','file','other');await f.attachments.upload({document:'其他.md',name:'b.txt',bytes:Buffer.from('b')});
  await f.map.counter('笔记.md');await f.map.directory('笔记.md');await f.vault.list();
  const original=fs.readFile,reads=[];fs.readFile=async(file,...args)=>{if(String(file).startsWith(f.root))reads.push(String(file));return original(file,...args);};
  try{for(let i=0;i<20;i++){await f.map.counter('笔记.md');await f.map.directory('笔记.md');await f.vault.list();}assert.deepEqual(reads,[]);}
  finally{fs.readFile=original;}
  const file=path.join(f.root,'笔记.assets/document.json'),owner=JSON.parse(await fs.readFile(file));owner.nextId=99;await fs.writeFile(file,JSON.stringify(owner));assert.equal((await f.map.counter('笔记.md')).next,99);
});
test('Ownership discovery does not scan attachment and code payload subtrees or adopt records hidden inside them',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});
  const hidden=path.join(f.root,'笔记.assets/attachments/vendor');await fs.mkdir(hidden,{recursive:true});await fs.writeFile(path.join(hidden,'document.json'),JSON.stringify({version:2,document:'fake.md',nextId:5,blocks:[]}));
  const original=fs.readdir,scanned=[];fs.readdir=async(file,...args)=>{scanned.push(String(file));return original(file,...args);};
  try{await f.map.discover();assert(!scanned.some(file=>file.includes('笔记.assets')));assert.equal((await f.map.read()).documents['fake.md'],undefined);}
  finally{fs.readdir=original;}
});
test('A missing or malformed authoritative record cannot fall back to a stale counter or be overwritten',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});const file=path.join(f.root,'笔记.assets/document.json');
  await fs.writeFile(file,'{broken');await assert.rejects(f.map.counter('笔记.md'),SyntaxError);await assert.rejects(f.map.sync('笔记.md',source),SyntaxError);assert.equal(await fs.readFile(file,'utf8'),'{broken');
  await fs.unlink(file);await assert.rejects(f.map.counter('笔记.md'),/附属记录缺失/);await assert.rejects(f.attachments.upload({document:'笔记.md',name:'b.txt',bytes:Buffer.from('b')}),/附属记录缺失/);assert.equal(await fs.stat(file).catch(()=>null),null);
});
test('External edits between reading and committing a record cannot be overwritten by cached state',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});
  const file=path.join(f.root,'笔记.assets/document.json'),snapshot=await f.map.read('笔记.md'),external=JSON.parse(await fs.readFile(file));
  external.results={'0001':{items:[{index:0,file:'0.html',language:'js',code:'remote',height:440}]}};await fs.writeFile(file,JSON.stringify(external));
  snapshot.documents['笔记.md'].nextId=80;await assert.rejects(f.map.write(snapshot,['笔记.md']),error=>error.code==='CONFLICT');
  assert.deepEqual(JSON.parse(await fs.readFile(file)),external);
});
test('Record cache observes a same-size external edit even when the modification time is restored',async t=>{
  const f=await fixture(t);await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});
  const file=path.join(f.root,'笔记.assets/document.json'),owner=JSON.parse(await fs.readFile(file));owner.nextId=10;await fs.writeFile(file,JSON.stringify(owner));
  assert.equal((await f.map.counter('笔记.md')).next,10);const before=await fs.stat(file);owner.nextId=20;await fs.writeFile(file,JSON.stringify(owner));await fs.utimes(file,before.atime,before.mtime);
  assert.equal((await fs.stat(file)).size,before.size);assert.equal((await f.map.counter('笔记.md')).next,20);
});
test('A failed location-index commit leaves durable ownership recoverable and never overwrites the note or payload',async t=>{
  const f=await fixture(t);await f.map.sync('笔记.md',source,64);const index=path.join(f.root,'.data/document_map.json'),rename=fs.rename;
  fs.rename=async(from,to,...args)=>{if(to===index)throw Object.assign(Error('simulated index write failure'),{code:'EIO'});return rename(from,to,...args);};
  try{await assert.rejects(f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')}),/simulated/);}finally{fs.rename=rename;}
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'笔记.assets/document.json'))).nextId,64);
  assert.equal(await fs.readFile(path.join(f.root,'笔记.md'),'utf8'),source);await f.map.discover();assert.equal((await f.map.counter('笔记.md')).next,64);
  await f.attachments.upload({document:'笔记.md',name:'a.txt',bytes:Buffer.from('a')});assert.equal(await fs.readFile(path.join(f.root,'笔记.assets/attachments/a.txt'),'utf8'),'a');
});
test('Legacy pinned records consolidate on change, preserve all HTML and metadata, and remain read-only while viewing',async t=>{
  const f=await fixture(t);await legacy(f,'0001');await legacy(f,'0002',330);
  const ownerFile=path.join(f.root,'笔记.assets/document.json'),indexFile=path.join(f.root,'.data/document_map.json');const before=await fs.readFile(ownerFile,'utf8'),index=await fs.readFile(indexFile,'utf8');
  const loaded=await f.pins.load({document:'笔记.md',markdown:source});assert.equal(loaded.length,2);assert.equal(f.store.size,0);assert.equal(await fs.readFile(ownerFile,'utf8'),before);
  await f.pins.resize({token:loaded[0].artifacts[0].token,height:280});
  const owner=JSON.parse(await fs.readFile(ownerFile));assert.equal(owner.results['0001'].items[0].height,280);assert.equal(owner.results['0002'].items[0].height,330);assert.equal(await fs.readFile(indexFile,'utf8'),index);
  for(const id of ['0001','0002']){assert.equal(await fs.stat(path.join(f.root,'笔记.assets/results',id,'results.json')).catch(()=>null),null);assert.equal(await fs.readFile(path.join(f.root,'笔记.assets/results',id,'0.html'),'utf8'),'<p>'+id+'</p>');}
  const stamp=(await fs.stat(ownerFile)).mtimeMs;await f.pins.resize({token:loaded[0].artifacts[0].token,height:280});assert.equal((await fs.stat(ownerFile)).mtimeMs,stamp);
  await f.map.sync('笔记.md',source);assert.deepEqual(JSON.parse(await fs.readFile(ownerFile)).results,owner.results);
  await fs.unlink(indexFile);await f.map.discover();assert.equal((await f.pins.load({document:'笔记.md',markdown:source})).length,2);
});
test('New pins create only one management record; unpin removes empty payload folders without resurrecting shadowed legacy data',async t=>{
  const f=await fixture(t);await f.map.sync('笔记.md',source);
  const artifact=f.store.retain([{kind:'html',name:'result.html',data:Buffer.from('<p>result</p>').toString('base64')}])[0];
  f.html.contexts.set(artifact.token,{current:f.data,input:{document:'笔记.md',id:'0001',language:'js',code:'old'},context:{files:[]}});await f.pins.attach(artifact.token,0);await f.pins.pin({token:artifact.token,pinned:true,height:220});
  assert.deepEqual((await fs.readdir(path.join(f.root,'笔记.assets'))).sort(),['document.json','results']);
  assert.deepEqual(await fs.readdir(path.join(f.root,'笔记.assets/results/0001')),['0.html']);
  await f.pins.pin({token:artifact.token,pinned:false,height:220});assert.deepEqual(await fs.readdir(path.join(f.root,'笔记.assets')),['document.json']);
  // A cloud download or interrupted legacy cleanup must not revive a removed pin.
  await legacy(f,'0001');assert.deepEqual(await f.pins.load({document:'笔记.md',markdown:source}),[]);
});
test('Consolidation leaves unrecognized legacy result records and their payloads intact',async t=>{
  const f=await fixture(t);await legacy(f,'0001');await legacy(f,'0002');
  const unknown=path.join(f.root,'笔记.assets/results/0002/results.json'),bytes=JSON.stringify({items:[{index:100,file:'custom.html',code:'private'}],custom:'keep'});
  await fs.writeFile(unknown,bytes);const loaded=await f.pins.load({document:'笔记.md',markdown:source});await f.pins.resize({token:loaded[0].artifacts[0].token,height:280});
  assert.equal(await fs.readFile(unknown,'utf8'),bytes);assert.equal(await fs.readFile(path.join(f.root,'笔记.assets/results/0002/0.html'),'utf8'),'<p>0002</p>');
});
test('A failed consolidated-record commit preserves every legacy record and the visible pinned state',async t=>{
  const f=await fixture(t);await legacy(f,'0001');await legacy(f,'0002');const loaded=await f.pins.load({document:'笔记.md',markdown:source}),token=loaded[0].artifacts[0].token;
  const file=path.join(f.root,'笔记.assets/document.json'),before=await fs.readFile(file,'utf8'),rename=fs.rename;
  fs.rename=async(from,to,...args)=>{if(to===file)throw Object.assign(Error('simulated manifest failure'),{code:'EIO'});return rename(from,to,...args);};
  try{await assert.rejects(f.pins.resize({token,height:500}),/simulated/);}finally{fs.rename=rename;}
  assert.equal(f.pins.state(token).height,220);assert.equal(await fs.readFile(file,'utf8'),before);
  for(const id of ['0001','0002']){assert(await fs.stat(path.join(f.root,'笔记.assets/results',id,'results.json')));assert.equal(await fs.readFile(path.join(f.root,'笔记.assets/results',id,'0.html'),'utf8'),'<p>'+id+'</p>');}
});
