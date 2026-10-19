const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../electron/runner/clang-lifetime.mjs');
test('Completed compiler invocations release their memory and retain the warm filesystem/modules',async()=>{
 const {releaseCompletedCompilerMemory}=await load(),cache={},memfs={hostMem:null,files:new Map([['header.h','contents']])};
 const runtime={memfs,moduleCache:cache,async runWithOptions(...args){assert.equal(this,runtime);assert.deepEqual(args,['clang',false,['-c']]);memfs.hostMem={bytes:new ArrayBuffer(1024)};return null;}};
 const originalFiles=memfs.files;releaseCompletedCompilerMemory(runtime);
 for(let i=0;i<3;i++){assert.equal(await runtime.runWithOptions('clang',false,['-c']),null);assert.equal(memfs.hostMem,null);assert.equal(runtime.moduleCache,cache);assert.equal(memfs.files,originalFiles);}
});
test('Memory cleanup preserves the compiler and linker arguments',async()=>{
 const {releaseCompletedCompilerMemory}=await load(),argv=['wasm-ld','--export-dynamic','program.o','-o','program.wasm'];let actual;
 const runtime={memfs:{hostMem:null},async runWithOptions(module,out,args){actual=args;return null;}};
 releaseCompletedCompilerMemory(runtime);await runtime.runWithOptions({},false,argv);
 assert.equal(actual,argv);assert.deepEqual(actual,['wasm-ld','--export-dynamic','program.o','-o','program.wasm']);
});
test('Compiler memory stays connected while running and is detached on failure',async()=>{
 const {releaseCompletedCompilerMemory}=await load();let finish;
 const memory={},memfs={hostMem:memory},runtime={memfs,runWithOptions(){return new Promise((_,reject)=>{finish=reject;});}};
 releaseCompletedCompilerMemory(runtime);const pending=runtime.runWithOptions();assert.equal(memfs.hostMem,memory);
 finish(Error('diagnostics'));await assert.rejects(pending,/diagnostics/);assert.equal(memfs.hostMem,null);
});
test('Suspended instances keep their memory until their execution completes',async()=>{
 const {releaseCompletedCompilerMemory}=await load(),app={},memory={},runtime={memfs:{hostMem:memory},async runWithOptions(){return app;}};
 releaseCompletedCompilerMemory(runtime);assert.equal(await runtime.runWithOptions(),app);assert.equal(runtime.memfs.hostMem,memory);
});
