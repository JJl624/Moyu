const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const work=path.resolve(__dirname,'../../../work');
const {runtimeFileResponse}=require('../electron/runtime-response.cjs');
test('Runtime assets stream exact bytes and keep MIME, isolation and length headers',async t=>{
 const directory=await fs.mkdtemp(path.join(work,'runtime-response-unit-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.alloc(3*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const file=path.join(directory,'module.wasm');await fs.writeFile(file,bytes);
 const response=await runtimeFileResponse(file,{'Content-Type':'application/wasm','Content-Security-Policy':"default-src 'none'"},new AbortController().signal);
 assert.equal(response.headers.get('Content-Length'),String(bytes.length));assert.equal(response.headers.get('Content-Type'),'application/wasm');assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'none'");
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 await assert.rejects(runtimeFileResponse(directory,{}),/无效/);await assert.rejects(runtimeFileResponse(path.join(directory,'missing'),{}),{code:'ENOENT'});
});
test('Aborting a sandbox request rejects the stream and releases the asset file',async t=>{
 const directory=await fs.mkdtemp(path.join(work,'runtime-response-unit-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'module.wasm');await fs.writeFile(file,Buffer.alloc(4*1024*1024));
 const controller=new AbortController(),response=await runtimeFileResponse(file,{},controller.signal);
 controller.abort();await assert.rejects(response.arrayBuffer(),/abort/i);
 await fs.rename(file,file+'.closed');
});
