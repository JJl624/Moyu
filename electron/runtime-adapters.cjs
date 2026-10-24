const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const ADAPTER_VERSION=3;
const BASH_ADAPTER_VERSION=4;
const adapterVersion=kind=>['clang','lua'].includes(kind)?2:kind==='bash'?BASH_ADAPTER_VERSION:ADAPTER_VERSION;
async function updateRuntimeAdapter(runtime,options={}){
 const expected=adapterVersion(runtime.kind);
 if(!['ruby','bash','csharp','clang','lua','sql'].includes(runtime.kind)||runtime.adapterVersion===expected)return runtime;
 // Bundled engines omit npm source trees. Reuse the new bundled adapter when
 // its engine receipts match, so updating an existing environment stays offline.
 const bundled=path.join(options.bundled||path.join(__dirname,'../resources/bundled-runtimes'),runtime.kind,runtime.version);
 const manifest=await fs.readFile(path.join(bundled,'manifest.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const matches=manifest?.kind===runtime.kind&&manifest.version===runtime.version&&manifest.adapterVersion===expected
  &&Object.keys(manifest.files||{}).length===Object.keys(runtime.files||{}).length
  &&Object.entries(manifest.files||{}).every(([name,file])=>runtime.files?.[name]?.sha256===file.sha256&&runtime.files[name].bytes===file.bytes);
 if(matches){
  for(const name of [runtime.kind+'-runtime.mjs',...(runtime.kind==='clang'?['clang-source.cjs']:[])])
   await require('./files.cjs').atomic(path.join(runtime.directory,name),await fs.readFile(path.join(bundled,name)));
  const current=JSON.parse(await fs.readFile(path.join(runtime.directory,'manifest.json'),'utf8'));current.adapterVersion=expected;
  await require('./files.cjs').atomicIfChanged(path.join(runtime.directory,'manifest.json'),JSON.stringify(current,null,2));
  return {...runtime,adapterVersion:expected};
 }
 const stage=path.join(runtime.directory,'adapter-'+crypto.randomUUID());await fs.mkdir(stage,{recursive:true});
 try{for(const file of [runtime.kind+'-worker.mjs','file-runtime.mjs','run-files.mjs',...(runtime.kind==='bash'?['bash-terminal.mjs']:runtime.kind==='clang'?['clang-project.mjs','clang-lifetime.mjs','clang-workspace.mjs']:[])])await fs.copyFile(path.join(__dirname,'runner',file),path.join(stage,file));
  const plugins=[{name:'no-host',setup(b){b.onResolve({filter:/.*/},a=>require('node:module').isBuiltin(a.path)?{path:a.path,namespace:'no-host'}:undefined);b.onLoad({filter:/.*/,namespace:'no-host'},()=>({contents:'module.exports={}',loader:'js'}));}}];
  if(runtime.kind==='clang'){
    await fs.copyFile(path.join(__dirname,'clang-source.cjs'),path.join(runtime.directory,'clang-source.cjs'));
    const sizes={};for(const name of ['memfs.wasm.gz','clang.wasm.gz','lld.wasm.gz','sysroot.tar.gz'])sizes['https://clang.moyu.invalid/clang/bin/'+name]=require('node:zlib').gunzipSync(await fs.readFile(path.join(runtime.directory,'clang/bin',name)),{maxOutputLength:128*1024*1024}).length;
    const {compilerAssetCachePlugin}=await import('../scripts/clang-memory-adapter.mjs');plugins.push(compilerAssetCachePlugin(sizes));
  }
  const output=path.join(stage,'runtime.mjs');await require('esbuild').build({entryPoints:[path.join(stage,runtime.kind+'-worker.mjs')],outfile:output,bundle:true,platform:'browser',format:'esm',target:'chrome144',minify:true,legalComments:'eof',logLevel:'silent',plugins});await require('./files.cjs').renameWithRetry(output,path.join(runtime.directory,runtime.kind+'-runtime.mjs'));
  const manifest=JSON.parse(await fs.readFile(path.join(runtime.directory,'manifest.json'),'utf8'));manifest.adapterVersion=expected;await require('./files.cjs').atomicIfChanged(path.join(runtime.directory,'manifest.json'),JSON.stringify(manifest,null,2));return {...runtime,adapterVersion:expected};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
module.exports={updateRuntimeAdapter,ADAPTER_VERSION,BASH_ADAPTER_VERSION,adapterVersion};
