const {test}=require('node:test'),assert=require('node:assert/strict');
const {LuaFactory}=require('wasmoon');
test('Wasmoon filesystem mounts replace old block data, round-trip nested Chinese filenames and reject links before persistence',async()=>{
 const {mountData,collectData}=await import('../electron/runner/file-runtime.mjs'),FS=(await new LuaFactory().getLuaModule()).module.FS;
 const files=[{name:'输入/中文.txt',data:Buffer.from('Hello').toString('base64')}];
 mountData(FS,files);assert.deepEqual(collectData(FS),files);assert.equal(FS.cwd(),'/data');
 FS.symlink('/tmp','/data/escape');assert.throws(()=>collectData(FS),/符号链接/);
 mountData(FS,[]);assert.deepEqual(collectData(FS),[]);assert.throws(()=>FS.stat('/data/输入/中文.txt'));
});
