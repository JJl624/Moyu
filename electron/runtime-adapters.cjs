const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const ADAPTER_VERSION=2;
const BASH_ADAPTER_VERSION=3;
async function updateRuntimeAdapter(runtime){
 const expected=['clang','lua'].includes(runtime.kind)?1:runtime.kind==='bash'?BASH_ADAPTER_VERSION:ADAPTER_VERSION;
 if(!['ruby','bash','csharp','clang','lua'].includes(runtime.kind)||runtime.adapterVersion===expected)return runtime;
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
module.exports={updateRuntimeAdapter,ADAPTER_VERSION,BASH_ADAPTER_VERSION};
