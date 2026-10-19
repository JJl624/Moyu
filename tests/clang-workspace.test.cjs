const {test}=require('node:test'),assert=require('node:assert/strict');
test('Compiler workspace releases every temporary input/output while preserving the system image and artifact',async()=>{
 const {compilerWorkspace}=await import('../electron/runner/clang-workspace.mjs');let nativeWrites=0;
 const system=new Uint8Array([1,2,3]),fs={filePaths:new Set(['include/system.h']),fileOverlays:new Map(),mem:{memory:{buffer:{byteLength:24*1024*1024}}},normalizePath:path=>path.replace(/^\/+/,''),addFile(){nativeWrites++;},setFile(path,contents){this.filePaths.add(path);this.fileOverlays.set(path,Uint8Array.from(contents));}};
 const runtime={memfs:fs,lastBuildKey:'old',wasm:{}},artifact={wasm:runtime.wasm},workspace=compilerWorkspace(runtime);
 for(let i=0;i<100;i++){
  fs.addFile('workspace/header.h',system);fs.addFile('_moyu_entry.o',system);fs.addFile('_moyu_entry.wasm',system);
  assert.equal(fs.fileOverlays.size,3);assert.notEqual(fs.fileOverlays.get('workspace/header.h'),system);
  workspace.clear();assert.deepEqual([...fs.filePaths],['include/system.h']);assert.equal(fs.fileOverlays.size,0);
 }
 assert.equal(nativeWrites,0);assert.equal(runtime.lastBuildKey,'');assert.equal(runtime.wasm,undefined);assert(artifact.wasm);
 const utf8=Buffer.from('输入.txt'),byteString=utf8.toString('latin1');fs.addFile('workspace/chinese.c',byteString);assert.deepEqual([...fs.fileOverlays.get('workspace/chinese.c')],[...utf8]);workspace.clear();
 assert.equal(workspace.needsRecycle(),false);fs.mem.memory.buffer.byteLength+=33*1024*1024;assert.equal(workspace.needsRecycle(),true);
 fs.addFile('include/system.h',system);assert.equal(nativeWrites,1);
});
