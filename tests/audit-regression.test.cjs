const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault,hash}=require('../electron/vault.cjs');
const {Attachments}=require('../electron/attachments.cjs');
const {References}=require('../electron/references.cjs');
const {CodeData}=require('../electron/code-data.cjs');
const {CodeDataTransaction}=require('../electron/code-data-transaction.cjs');
const base=path.resolve(__dirname,'../../../work/audit-v187-unit');
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-')),vault=await new Vault(root).init(),attachments=new Attachments(vault),references=new References(vault),data=new CodeData(vault,attachments,references);t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,vault,attachments,references,data};}
test('A failed second binary data write rolls back changes, additions and deletions as one batch',async t=>{
  const {root,vault,data}=await fixture(t),document='代码.md';await vault.create(document,'file','```js {id=0001}\n1\n```');
  const input={document,language:'js',id:'0001'};
  for(const name of ['a.bin','b.bin','c.bin'])await data.upload({...input,name,bytes:Buffer.from([0,1,2,3])});
  const context=await data.context(input),rename=fs.rename;
  fs.rename=async(from,to)=>{if(String(to).endsWith('b.bin')){throw Object.assign(Error('模拟写入失败'),{code:'ENOSPC'});}return rename(from,to);};
  try{await assert.rejects(data.persist(input,context,[{name:'a.bin',data:Buffer.from([4,5]).toString('base64')},{name:'b.bin',data:Buffer.from([6]).toString('base64')}]),/模拟写入失败/);}finally{fs.rename=rename;}
  assert.deepEqual((await data.context(input)).files.map(f=>[f.name,f.data]),context.files.map(f=>[f.name,f.data]));
  assert.equal(await fs.stat(path.join(root,'.data/code-transactions/journal.json')).catch(()=>null),null);
});
test('Interrupted data writes recover, while external edits are never overwritten',async t=>{
  const {root,vault}=await fixture(t),target='代码.assets/code-data/0001/a.bin',directory=path.join(root,'.data/code-transactions');
  await fs.mkdir(path.dirname(path.join(root,target)),{recursive:true});await fs.mkdir(directory,{recursive:true});
  const before=Buffer.from('before'),after=Buffer.from('after');await fs.writeFile(path.join(root,target),after);await fs.writeFile(path.join(directory,'0.bin'),before);
  const record={version:1,phase:'working',files:[{path:target,before:hash(before),after:hash(after)}]};
  await fs.writeFile(path.join(directory,'journal.json'),JSON.stringify(record));await new CodeDataTransaction(vault).recover();assert.equal(await fs.readFile(path.join(root,target),'utf8'),'before');
  await fs.writeFile(path.join(directory,'0.bin'),before);await fs.writeFile(path.join(directory,'journal.json'),JSON.stringify(record));await fs.writeFile(path.join(root,target),'external');
  await assert.rejects(new CodeDataTransaction(vault).recover(),/外部修改/);assert.equal(await fs.readFile(path.join(root,target),'utf8'),'external');assert((await fs.stat(path.join(directory,'journal.json'))).isFile());
});
test('Unreadable imported notes do not disable indexing or healthy file renames',async t=>{
  const {root,vault,references}=await fixture(t);await vault.create('正常.md','file','[附件](旧.txt)');await fs.writeFile(path.join(root,'旧.txt'),'keep');await fs.writeFile(path.join(root,'坏.md'),Buffer.from([0,255]));
  await references.refresh(await vault.list());assert.match(references.unreadable.get('坏.md').message,/UTF-8|二进制/);
  await references.rename({from:'旧.txt',to:'新.txt'});assert.match((await vault.read('正常.md')).content,/新.txt/);assert.deepEqual(await fs.readFile(path.join(root,'坏.md')),Buffer.from([0,255]));
});
test('Read-only recovery still exposes documents and blocks writes',async t=>{
  const {vault}=await fixture(t);await vault.create('正常.md','file','unsaved-safe');vault.recoveryError='恢复冲突';assert.equal((await vault.list()).readOnly,true);assert.equal((await vault.read('正常.md')).content,'unsaved-safe');await assert.rejects(vault.save('正常.md','bad',hash('unsaved-safe')),/恢复冲突/);
});
test('A broken ownership map does not prevent read-only recovery documents from opening',async t=>{
 const {root,vault,attachments}=await fixture(t);await vault.create('正常.md','file','safe');await fs.mkdir(path.join(root,'.data'));await fs.writeFile(path.join(root,'.data/document_map.json'),'broken');vault.recoveryError='映射恢复未完成';assert((await vault.list()).tree.some(file=>file.path==='正常.md'));assert.equal((await vault.read('正常.md')).content,'safe');assert.deepEqual(await attachments.documents.counter('正常.md'),{next:1});assert.equal(await fs.readFile(path.join(root,'.data/document_map.json'),'utf8'),'broken');
});
test('Closed missing document records are pruned but orphan data stays discoverable',async t=>{
  const {root,vault,attachments}=await fixture(t);await vault.create('无数据.md','file','```js {id=0001}\n1\n```');await attachments.documents.sync('无数据.md',(await vault.read('无数据.md')).content);await fs.unlink(path.join(root,'无数据.md'));
  await vault.create('有数据.md','file','```js {id=0001}\n1\n```');await attachments.documents.ensureUnlocked('有数据.md');await fs.unlink(path.join(root,'有数据.md'));
  await vault.create('毫不相关.md','file','```js {id=0001}\n2\n```');await attachments.documents.discover();const map=await attachments.documents.read();assert.equal(map.documents['无数据.md'],undefined);assert(map.documents['有数据.md']);assert.deepEqual((await attachments.documents.orphans())[0].candidates,[]);
});
test('Deferred results have an entry bound and actively accessed results are retained by LRU',()=>{
  const {ResultStore}=require('../electron/result-store.cjs');const store=new ResultStore(100,2),a=store.retainDeferred({kind:'html',name:'a'},()=>Buffer.from('a')),b=store.retainDeferred({kind:'html',name:'b'},()=>Buffer.from('b'));store.get(a.token);const c=store.retainDeferred({kind:'html',name:'c'},()=>Buffer.from('c'));assert.equal(store.values.size,2);assert.throws(()=>store.get(b.token),/释放/);assert(store.get(a.token));assert(store.get(c.token));
});
test('CRLF editor/file coordinates round trip at each line and Unicode position',()=>{
  const Module=require('node:module'),source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/textFileContent.ts')],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text,mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(source,__filename);
  const {fileOffset,editorOffset,fileLineBreak,fileText}=mod.exports,{EditorState}=require('@codemirror/state'),input='首行\r\n😀abc\r\n尾',state=EditorState.create({doc:input,extensions:[fileLineBreak.of('\r\n')]});assert.equal(fileText(state),input);
  for(let i=0;i<=state.doc.length;i++)assert.equal(editorOffset(state,fileOffset(state,i)),i);
});

test('Reverting text preserves original mixed line endings and exact file coordinates',()=>{
  const Module=require('node:module'),source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/textFileContent.ts')],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text,mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(source,__filename);
  const {fileOffset,editorOffset,fileLineBreak,fileText,originalFileText}=mod.exports,{EditorState}=require('@codemirror/state');
  for(const input of ['首行\r\n😀abc\n尾\r末行\r\n','单行','末尾\n\n']){
    const original=EditorState.create({doc:input,extensions:[fileLineBreak.of(input.includes('\r\n')?'\r\n':'\n'),originalFileText(input)]});
    const changed=original.update({changes:{from:original.doc.length,insert:'X'}}).state;
    assert.notEqual(fileText(changed),input);
    const restored=changed.update({changes:{from:changed.doc.length-1,to:changed.doc.length}}).state;
    assert.equal(fileText(restored),input);
    for(let i=0;i<=restored.doc.length;i++)assert.equal(editorOffset(restored,fileOffset(restored,i)),i);
    const whitespace=original.update({changes:{from:original.doc.length,insert:' '}}).state;
    assert.notEqual(fileText(whitespace),input);
  }
});
test('Download size mismatches cannot be accepted as complete revisions',async t=>{
  const {root}=await fixture(t),{Readable}=require('node:stream'),{download}=require('../electron/sync-files.cjs');const client={customRequest:async()=>({headers:new Headers({'Content-Length':'7'}),body:Readable.from([Buffer.from('bad')])})};
  await assert.rejects(download(client,'/a','a',path.join(root,'first.tmp'),{},100,7),/不完整/);
  client.customRequest=async()=>({headers:new Headers(),body:Readable.from([Buffer.from('bad')])});await assert.rejects(download(client,'/a','a',path.join(root,'second.tmp'),{},100,7),/大小已改变/);
});
