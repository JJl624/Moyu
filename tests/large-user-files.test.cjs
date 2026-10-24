const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault,hash}=require('../electron/vault.cjs'),{Attachments}=require('../electron/attachments.cjs'),{CodeData}=require('../electron/code-data.cjs'),{snapshot,replace}=require('../electron/files.cjs'),{ResultStore}=require('../electron/result-store.cjs');
async function fixture(t){
 const base=path.resolve(__dirname,'../../../work/large-user-files');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'case-')),vault=await new Vault(root).init(),attachments=new Attachments(vault),data=new CodeData(vault,attachments);
 t.after(async()=>{assert(path.resolve(root).startsWith(base+path.sep));try{await fs.rm(root,{recursive:true,force:true});}catch(error){console.error('未清理的测试目录：'+root);throw error;}});
 return{root,vault,attachments,data};
}
test('Attachments above 20 MB can be imported, read and replaced without bypassing name validation',async t=>{
 const{vault,attachments}=await fixture(t);await vault.create('note.md','file','');
 const bytes=Buffer.alloc(21*1024*1024,65),uploaded=await attachments.upload({document:'note.md',name:'large.txt',bytes});
 assert.equal((await snapshot(vault,uploaded.path)).bytes.length,bytes.length);
 assert.equal((await vault.read(uploaded.path)).content.length,bytes.length);
 const before=hash(bytes);bytes[0]=66;await replace(vault,uploaded.path,bytes,before);
 assert.equal((await snapshot(vault,uploaded.path)).version,hash(bytes));
 await assert.rejects(attachments.upload({document:'note.md',name:'../escape.txt',bytes}),/文件名无效/);
});
test('Code data above both previous byte limits uploads, persists and rolls back completely',async t=>{
 const{root,vault,data}=await fixture(t),input={document:'note.md',language:'js',id:'0001'};
 await vault.create('note.md','file','```js {id=0001}\nconsole.log(1)\n```');
 const bytes=Buffer.alloc(41*1024*1024,97);await data.upload({...input,name:'large.bin',bytes});
 await assert.rejects(data.upload({...input,name:'../escape.bin',bytes}),/名称不支持|文件名|无效/);
 const context=await data.context(input);assert.equal(context.files[0].size,bytes.length);
 bytes[0]=98;const next=bytes.toString('base64');await data.persist(input,context,[{name:'large.bin',data:next}]);
 const target=path.join(root,context.directory,'large.bin');assert.equal((await fs.readFile(target))[0],98);
 const previous=await snapshot(vault,context.directory+'/large.bin');
 await assert.rejects(data.transaction.write([
  {path:context.directory+'/large.bin',previous,next:Buffer.from('temporary')},
  {path:context.directory+'/missing.bin',previous:{version:'external-change',bytes:Buffer.from('old')},next:Buffer.from('fail')},
 ]),/外部修改/);
 assert.equal((await fs.readFile(target)).length,bytes.length);assert.equal((await fs.readFile(target))[0],98);
});
test('Large result files and deferred HTML remain exportable within the result cache budget',async()=>{
 const store=new ResultStore(),bytes=Buffer.alloc(41*1024*1024,65),file=store.retain([{kind:'file',name:'large.txt',data:bytes.toString('base64')}])[0];
 assert.equal((await store.read(file.token)).length,bytes.length);
 const html=store.retainDeferred({kind:'html',name:'large.html'},async()=>bytes);
 assert.equal((await store.read(html.token)).length,bytes.length);await store.materialize(html.token);
 assert.equal(store.size,bytes.length*2);assert.equal(store.text(file.token).truncated,true);store.clear();assert.equal(store.size,0);
});

test('Shared Wasm filesystem collection keeps large Lua, Java and C# data files',async()=>{
 const {collectData}=await import('../electron/runner/file-runtime.mjs');
 const bytes=new Uint8Array(21*1024*1024);
 const FS={readdir:()=>['.','..','large.bin'],lstat:()=>({mode:0o100644,size:bytes.length}),isFile:()=>true,readFile:()=>bytes};
 const files=collectData(FS);assert.equal(files.length,1);assert.equal(files[0].name,'large.bin');assert.equal(Buffer.byteLength(files[0].data,'base64'),bytes.length);
});
