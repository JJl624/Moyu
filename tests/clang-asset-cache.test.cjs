const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
test('Clang keeps compiled modules warm without retaining duplicate asset bytes; filesystem assets stay cached',async()=>{
 const {adaptCompilerAssetCache}=await import('../scripts/clang-memory-adapter.mjs');
 const original=await fs.readFile(path.resolve(__dirname,'../node_modules/@wasm-idle/llvm-core/dist/core/src/wasm.js'),'utf8');
 assert.throws(()=>adaptCompilerAssetCache(original+'\n'),/review the Clang memory adapter/);
 const source=adaptCompilerAssetCache(original)+'\nexport const cacheSizes=()=>({modules:store.size,buffers:bufferStore.size});';
 const loader=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const fetch=globalThis.fetch,requests=[];
 const bytes=new Uint8Array([0,97,115,109,1,0,0,0]);
 globalThis.fetch=async input=>{requests.push(String(input));return new Response(bytes);};
 try{
  const url='https://clang.moyu.invalid/clang/bin/clang.wasm';
  const [first,second]=await Promise.all([loader.compile(url),loader.compile(url)]);
  assert(first instanceof WebAssembly.Module);assert.equal(first,second);assert.equal(requests.length,1);
  assert.deepEqual(loader.cacheSizes(),{modules:1,buffers:0});
  assert.equal(await loader.compile(url),first);assert.equal(requests.length,1);
  assert.equal(await loader.getCompiledModuleFingerprint(first),require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  const fsUrl='https://clang.moyu.invalid/clang/bin/sysroot.tar';
  const one=await loader.readBuffer(fsUrl);one[0]=255;
  assert.deepEqual(await loader.readBuffer(fsUrl),bytes);assert.equal(requests.length,2);
  assert.deepEqual(loader.cacheSizes(),{modules:1,buffers:1});
  const archiveUrl='https://clang.moyu.invalid/clang/bin/sysroot.tar.gz';
  const archive=await loader.readBuffer(archiveUrl);archive[0]=255;
  assert.deepEqual(loader.cacheSizes(),{modules:1,buffers:1});
  assert.deepEqual(await loader.readBuffer(archiveUrl),bytes);assert.equal(requests.length,4);
 }finally{globalThis.fetch=fetch;}
});
test('Clang can open, read and close overlay files without native inodes, and missing files stay absent',async()=>{
 const {adaptCompilerFileStats}=await import('../scripts/clang-memory-adapter.mjs');
 const file=path.resolve(__dirname,'../node_modules/@wasm-idle/llvm-core/dist/clang/src/app.js');
 const source=adaptCompilerFileStats(await fs.readFile(file,'utf8')).replace(/from '([^']+)'/g,(_,name)=>"from '"+new URL(name,require('node:url').pathToFileURL(file)).href+"'");
 const {default:App}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const module=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]));
 const data=new Uint8Array([41,42,43]),memfs={exports:{path_open(){throw Error('Native open used for virtual source');}},hasFile:name=>name==='header.h',getFileContents:()=>data};
 const app=new App(module,memfs,'clang');await app.ready;
 app.mem.write(64,'header.h');assert.equal(app.path_open(3,0,64,8,0,2,0,0,128),0);
 const fd=app.mem.read32(128);app.mem.u32[256]=2048;app.mem.u32[257]=3;
 assert.equal(app.fd_read(fd,1024,1,1032),0);assert.deepEqual(app.mem.u8.slice(2048,2051),data);
 assert.equal(app.fd_close(fd),0);assert.equal(app.readFileHandles.size,0);
 memfs.hasFile=()=>false;assert.equal(app.path_open(3,0,64,8,0,2,0,0,128),44);
});
test('Compiler file metadata does not copy file contents, while actual reads keep stable snapshots',async()=>{
 const {adaptCompilerFileStats}=await import('../scripts/clang-memory-adapter.mjs');
 const file=path.resolve(__dirname,'../node_modules/@wasm-idle/llvm-core/dist/clang/src/app.js'),original=await fs.readFile(file,'utf8');
 assert.throws(()=>adaptCompilerFileStats(original+'\n'),/review the Clang memory adapter/);
 const source=adaptCompilerFileStats(original).replace(/from '([^']+)'/g,(_,name)=>"from '"+new URL(name,require('node:url').pathToFileURL(file)).href+"'");
 const {default:App}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const bytes=new Uint8Array([1,2,3]),app=Object.create(App.prototype),stats=[];
 app.mem={check(){},readStr(){return 'header.h';}};
 app.memfs={hasFile:name=>name==='header.h',getFileContents:()=>bytes,exports:{path_filestat_get:()=>44}};
 app.shouldUseJsReadForPath=()=>true;app.writeRegularFileStat=(_,size)=>stats.push(size);app.trace=()=>{};
 const from=Uint8Array.from;let copies=0;Uint8Array.from=function(...args){copies++;return from.apply(this,args);};
 try{
  for(let i=0;i<10;i++)assert.equal(app.path_filestat_get(0,0,0,8,0),0);
  assert.equal(copies,0);assert.deepEqual(stats,Array(10).fill(3));
  const snapshot=app.readMemfsFile('header.h');assert.equal(copies,1);bytes[0]=42;assert.equal(snapshot[0],1);
 }finally{Uint8Array.from=from;}
});
test('Known decoded sizes avoid geometric allocations without weakening stream limits or unknown asset support',async()=>{
 const {adaptCompilerAssetCache}=await import('../scripts/clang-memory-adapter.mjs');
 const original=await fs.readFile(path.resolve(__dirname,'../node_modules/@wasm-idle/llvm-core/dist/core/src/wasm.js'),'utf8');
 const url='https://clang.moyu.invalid/clang/bin/clang.wasm.gz',size=100000;
 const source=adaptCompilerAssetCache(original,{[url]:size})+'\nexport {readBoundedDecompressionStream};';
 const {readBoundedDecompressionStream:read}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const stream=length=>new ReadableStream({start(controller){for(let n=0;n<length;n+=16384)controller.enqueue(new Uint8Array(Math.min(16384,length-n)).fill(42));controller.close();}});
 const result=await read(stream(size),new URL(url),128*1024*1024);
 assert.equal(result.buffer.byteLength,size);assert.equal(result.length,size);assert(result.every(byte=>byte===42));
 await assert.rejects(read(stream(size),url,size-1),/exceeds/);
 const unknown=await read(stream(size),'https://clang.moyu.invalid/unknown.gz',128*1024*1024);
 assert.equal(unknown.length,size);assert(unknown.every(byte=>byte===42));
 const changed=await read(stream(size+1),url,128*1024*1024);assert.equal(changed.length,size+1);
 assert.throws(()=>adaptCompilerAssetCache(original,{[url]:-1}),/Invalid Clang decoded asset size/);
});
