const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const{updateRuntimeAdapter,adapterVersion}=require('../electron/runtime-adapters.cjs');
test('Existing bundled engines receive the new data adapter offline without npm source trees',async t=>{
 const base=path.resolve(__dirname,'../../../work/runtime-adapters');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(base+path.sep));try{await fs.rm(root,{recursive:true,force:true});}catch(error){console.error('未清理的测试目录：'+root);throw error;}});
 for(const kind of ['sql','clang','lua','ruby','bash','csharp']){
  const version='1.0.0',directory=path.join(root,'installed',kind),bundled=path.join(root,'bundle'),source=path.join(bundled,kind,version),files={'engine.wasm':{bytes:123,sha256:'a'.repeat(64)}};
  await fs.mkdir(directory,{recursive:true});await fs.mkdir(source,{recursive:true});
  const manifest={kind,version,files,adapterVersion:0,custom:'preserved'};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(directory,kind+'-runtime.mjs'),'old');
  await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({...manifest,adapterVersion:adapterVersion(kind)}));await fs.writeFile(path.join(source,kind+'-runtime.mjs'),'new adapter');
  if(kind==='clang')await fs.writeFile(path.join(source,'clang-source.cjs'),'module.exports={}');
  const updated=await updateRuntimeAdapter({...manifest,directory},{bundled});
  assert.equal(updated.adapterVersion,adapterVersion(kind));assert.equal(await fs.readFile(path.join(directory,kind+'-runtime.mjs'),'utf8'),'new adapter');
  const saved=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));assert.equal(saved.custom,'preserved');assert.deepEqual(saved.files,files);
  assert.deepEqual(await updateRuntimeAdapter(updated,{bundled:path.join(root,'missing')}),updated);
 }
});
