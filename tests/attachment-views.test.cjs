const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{Attachments}=require('../electron/attachments.cjs'),{References}=require('../electron/references.cjs'),{DocumentFiles}=require('../electron/document-files.cjs');
const {readAttachmentViews:read,updateAttachmentViews:write}=require('../electron/attachment-views.cjs');
const {WebDAVSync}=require('../electron/sync.cjs'),{davServer}=require('./helpers/dav-server.cjs');
async function fixture(t){
  const base=path.resolve(__dirname,'../../../work/attachment-view-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
  t.after(async()=>{assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const vault=await new Vault(root).init(),attachments=new Attachments(vault),references=new References(vault),files=new DocumentFiles(vault,attachments,references,()=>{throw Error('No deletion expected');}),services={vault,attachments};
  await vault.create('笔记.md','file','[资料](笔记.assets/attachments/a.pdf)\n\n正文');
  const input={document:'笔记.md',root};return {root,vault,attachments,files,services,input};
}
test('View reads and unchanged preferences do not create companions or rewrite Markdown/history',async t=>{
  const f=await fixture(t);for(let i=0;i<5;i++)assert.deepEqual(await read(f.services,f.input),{views:{},directory:'笔记.assets'});
  assert.deepEqual(await fs.readdir(f.root),['笔记.md']);const doc=await f.vault.read('笔记.md');
  await write(f.services,{...f.input,key:'笔记.assets/attachments/a.pdf',patch:{pdfZoom:1.25,pdfPage:2,height:310}});
  assert.deepEqual((await fs.readdir(path.join(f.root,'笔记.assets'))).sort(),['document.json']);
  assert.equal((await f.vault.read('笔记.md')).version,doc.version);assert.equal(await fs.stat(path.join(f.root,'.data/history.sqlite')).catch(()=>null),null);
  const file=path.join(f.root,'笔记.assets/document.json'),before=await fs.readFile(file),stamp=(await fs.stat(file,{bigint:true})).mtimeNs;
  await write(f.services,{...f.input,key:'笔记.assets/attachments/a.pdf',patch:{pdfZoom:1.25}});assert.deepEqual(await fs.readFile(file),before);assert.equal((await fs.stat(file,{bigint:true})).mtimeNs,stamp);
});
test('Serialized patches preserve counters, pinned results, other attachments and forward-compatible view fields',async t=>{
  const f=await fixture(t);await f.vault.mutate(()=>f.attachments.documents.ensureUnlocked('笔记.md'));
  const file=path.join(f.root,'笔记.assets/document.json'),record=JSON.parse(await fs.readFile(file));record.nextId=40;record.blocks=['0001'];record.results={'0001':{items:[]}};record.attachmentViews={'a.pdf':{futureOption:'keep'}};await fs.writeFile(file,JSON.stringify(record));
  await Promise.all([write(f.services,{...f.input,key:'a.pdf',patch:{pdfZoom:1.5}}),write(f.services,{...f.input,key:'a.pdf',patch:{pdfSpread:'odd'}}),write(f.services,{...f.input,key:'b.alphatex',patch:{scoreLayout:'horizontal',scoreZoom:.7}})]);
  const stored=JSON.parse(await fs.readFile(file));assert.equal(stored.nextId,40);assert.deepEqual(stored.results,record.results);assert.deepEqual(stored.attachmentViews['a.pdf'],{futureOption:'keep',pdfZoom:1.5,pdfSpread:'odd'});
  await f.attachments.documents.sync('笔记.md','正文',45);assert.equal(JSON.parse(await fs.readFile(file)).attachmentViews['a.pdf'].futureOption,'keep');
  await fs.unlink(path.join(f.root,'.data/document_map.json'));await f.attachments.documents.discover();assert.equal((await read(f.services,f.input)).views['b.alphatex'].scoreZoom,.7);
  await assert.rejects(write(f.services,{...f.input,root:f.root+'/other',key:'a.pdf',patch:{height:300}}),/知识库已切换/);
});
test('Document, companion and attachment renames and document copies preserve their view settings',async t=>{
  const f=await fixture(t);await write(f.services,{...f.input,key:'moyu-view:image-window',patch:{imageWindowWidth:640,imageWindowHeight:480}});await f.attachments.upload({document:'笔记.md',name:'a.pdf',bytes:Buffer.from('pdf')});
  await write(f.services,{...f.input,key:'笔记.assets/attachments/a.pdf',patch:{pdfZoom:1.25}});
  await f.files.rename({from:'笔记.md',to:'改名.md'});let state=await read(f.services,{root:f.root,document:'改名.md'});assert.equal(state.views['改名.assets/attachments/a.pdf'].pdfZoom,1.25);
  await f.files.rename({from:'改名.assets/attachments/a.pdf',to:'改名.assets/attachments/b.pdf'});state=await read(f.services,{root:f.root,document:'改名.md'});assert.equal(state.views['改名.assets/attachments/b.pdf'].pdfZoom,1.25);assert.equal(state.views['改名.assets/attachments/a.pdf'],undefined);
  await f.files.copy({from:'改名.md',to:'副本.md'});state=await read(f.services,{root:f.root,document:'副本.md'});assert.equal(state.views['副本.assets/attachments/b.pdf'].pdfZoom,1.25);assert.equal(state.views['moyu-view:image-window'].imageWindowWidth,640);
});
test('WebDAV transfers view records and a second vault restores them; an unchanged sync transfers nothing',async t=>{
  const f=await fixture(t),server=await davServer(),config={url:server.url,directory:'/Moyu',username:'user',password:'secret',sync:{deletion:'sync'}};
  t.after(()=>server.close());await write(f.services,{...f.input,key:'资料.pdf',patch:{pdfZoom:'fit-width',pdfSpread:'even',height:360}});
  const sync=new WebDAVSync(f.vault,async()=>config);await sync.sync();const remote=JSON.parse(server.files.get('/Moyu/笔记.assets/document.json').toString());assert.equal(remote.attachmentViews['资料.pdf'].pdfZoom,'fit-width');
  const other=await fixture(t),download=new WebDAVSync(other.vault,async()=>config);await fs.unlink(path.join(other.root,'笔记.md'));await download.sync();await other.attachments.documents.discover();assert.equal((await read(other.services,other.input)).views['资料.pdf'].height,360);
  const offset=server.requests.length;await sync.sync();assert(!server.requests.slice(offset).some(request=>['GET','PUT','DELETE'].includes(request.method)));
});
