const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
test('Release build inputs restore from a checked archive, reject changed bytes and reuse complete inputs',async t=>{
 const {packBuildAssets,restoreBuildAssets}=await import('../scripts/build-assets.mjs');
 const base=path.resolve(__dirname,'../../../work/build-assets-unit');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),target=path.join(root,'target'),folder=path.join(source,'resources/bundled-runtimes');await fs.mkdir(folder,{recursive:true});const runtimes=[];
 for(const kind of ['clang','sql','lua','ruby','bash','java','csharp']){const dir=path.join(folder,kind,'1.0.0');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'runtime.wasm'),kind);runtimes.push({kind,version:'1.0.0',files:{'runtime.wasm':{bytes:Buffer.byteLength(kind)}}});}
 await fs.writeFile(path.join(folder,'index.json'),JSON.stringify({version:1,runtimes}));const file=path.join(root,'assets.tgz'),receipt=await packBuildAssets(source,file);
 const bytes=await fs.readFile(file),bad=path.join(root,'bad.tgz');await fs.writeFile(bad,Buffer.concat([bytes,Buffer.from('changed')]));
 await assert.rejects(restoreBuildAssets(target,receipt,bad),/checksum/);assert.equal(await fs.stat(path.join(target,'resources')).catch(()=>null),null);
 await restoreBuildAssets(target,receipt,file);assert.equal(await fs.readFile(path.join(target,'resources/bundled-runtimes/sql/1.0.0/runtime.wasm'),'utf8'),'sql');
 await restoreBuildAssets(target,receipt,path.join(root,'missing.tgz'));assert.deepEqual(await fs.readdir(path.join(target,'.runtime-build')),[]);
 const repeat=path.join(root,'repeat.tgz');assert.deepEqual(await packBuildAssets(source,repeat),receipt);
});
