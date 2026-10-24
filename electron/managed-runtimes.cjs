const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {gunzipSync}=require('node:zlib');
const {NpmStore,versionName,registryURL}=require('./npm-store.cjs');
const {atomicIfChanged}=require('./files.cjs');
const definitions={clang:{package:'@live-codes/clang-wasm',recommended:'0.3.0',minimum:'0.3.0',name:'Clang / WASI'},sql:{package:'sql.js',recommended:'1.14.2',minimum:'1.10.0',name:'sql.js / SQLite'},lua:{package:'wasmoon',recommended:'1.16.0',minimum:'1.15.0',name:'Wasmoon / Lua'}};
Object.assign(definitions,{ruby:{package:'@ruby/4.0-wasm-wasi',recommended:'2.10.1',minimum:'2.10.0',name:'Ruby 4.0 / WASI'},bash:{package:'@everruns/bashkit-wasm',recommended:'0.18.2',minimum:'0.18.0',name:'Bashkit / Bash'}});
for(const [kind,receipt] of Object.entries(require('./browser-runtimes.cjs').catalog))definitions[kind]={recommended:receipt.version,name:kind==='csharp'?'.NET WebAssembly / Roslyn':'TeaVM / javac',assetSource:receipt.base};
const semver=require('semver');
const {DownloadTasks}=require('./download-tasks.cjs');
class ManagedRuntimes {
  constructor(root,downloads=new DownloadTasks()){this.downloads=downloads;this.root=path.resolve(root,'runtimes');this.npm=new NpmStore(this.root,{overrides:{'@wasm-idle/llvm-core':'1.0.10'}});this.job=null;const binary=path.join(__dirname,'../resources/tools',require('../shared/native-esbuild.cjs').esbuildName()).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');if(require('node:fs').existsSync(binary))process.env.ESBUILD_BINARY_PATH=binary;}
  directory(kind,version){if(!Object.hasOwn(definitions,kind)||!versionName(version))throw Error('运行环境无效。');return path.join(this.root,kind,'Runtime',version);}
  definition(kind){return definitions[kind];}
  async config(kind){if(!Object.hasOwn(definitions,kind))throw Error('运行环境无效。');try{const config=JSON.parse(await fs.readFile(path.join(this.root,kind,'versions.json'),'utf8'));delete config.refreshMessage;return config;}catch(e){if(e.code!=='ENOENT')throw e;return {selected:'',versions:[definitions[kind].recommended]};}}
  async write(kind,value){await fs.mkdir(path.join(this.root,kind),{recursive:true});await atomicIfChanged(path.join(this.root,kind,'versions.json'),JSON.stringify(value,null,2));}
  async configure({language:kind,registry,assetMirror}){return this.mutate(kind,'configure',async()=>{const c=await this.config(kind);if(registry!==undefined)c.registry=registryURL(registry);if(assetMirror!==undefined)c.assetMirror=require('./browser-runtimes.cjs').assetMirror(assetMirror);await this.write(kind,c);return this.state(kind);});}
  async state(kind){const config=await this.config(kind),installed=[];config.registry=registryURL(config.registry);for(const version of await fs.readdir(path.join(this.root,kind,'Runtime')).catch(()=>[])){if(!versionName(version))continue;try{const m=JSON.parse(await fs.readFile(path.join(this.directory(kind,version),'manifest.json'),'utf8'));installed.push({version,name:m.name||definitions[kind].name,size:m.size});}catch{}}
    const versions=[...new Set([...config.versions,...installed.map(v=>v.version)])],versionLabels=kind==='ruby'?Object.fromEntries(versions.map(v=>[v,require('./ruby-versions.cjs').rubyLabel(v)])):{};return {...definitions[kind],...config,versions,versionLabels,installed,job:this.job?.kind===kind?{action:this.job.action,current:this.job.current}:null};}
  async refresh(kind){return this.transfer(kind,'刷新版本',async job=>{const c=await this.config(kind);if(['csharp','java'].includes(kind)){Object.assign(c,await require('./browser-runtimes.cjs').checkBrowserRuntime(kind,job,c.assetMirror));}else{this.npm.useRegistry(c.registry);c.versions=kind==='ruby'?await require('./ruby-versions.cjs').rubyVersions(this.npm,job):(await this.npm.versions(definitions[kind].package)).filter(v=>semver.gte(v,definitions[kind].minimum));c.checkedAt=new Date().toISOString();}job.commit();await this.write(kind,c);return this.state(kind);});}
  async environment(kind){const config=await this.config(kind);if(!config.selected)throw Error('请先在 '+({clang:'C / C++',sql:'SQL',lua:'Lua',csharp:'C#',java:'Java',ruby:'Ruby',bash:'Bash'}[kind])+' 设置中安装并选择运行环境。');const directory=this.directory(kind,config.selected),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));return require('./runtime-adapters.cjs').updateRuntimeAdapter({...manifest,directory,version:config.selected});}
  async mutate(kind,action,work){if(this.job)throw Error('请等待当前环境操作完成。');this.job={kind,action,current:''};this.npm.options.progress=current=>{this.job.current=current;};try{return await work();}finally{this.job=null;this.npm.clear();}}
  async transfer(kind,label,work){return this.mutate(kind,label,()=>this.downloads.run('runtime:'+kind,label,async job=>{this.npm.options.job=job;try{return await work(job);}finally{this.npm.options.job=null;}}));}
  async install({language:kind,version,localSource,manualSource}){return this.transfer(kind,localSource||manualSource?'导入环境':'安装环境',async job=>{
    let installTree=this.npm.installTree.bind(this.npm);
    if(localSource){const {packageInfo,localInstaller}=require('./local-runtime-package.cjs'),info=await packageInfo(kind,localSource);if(info.version!==version)throw Error('本地环境版本不匹配');installTree=localInstaller(localSource,info.pkg,job);}

    if(['csharp','java'].includes(kind))return require('./browser-runtimes.cjs').installBrowserRuntime(this,kind,version,job,manualSource);
    if(['ruby','bash'].includes(kind))return require('./wasm-script-runtimes.cjs').installScriptRuntime(this,kind,version,job,localSource?installTree:undefined);
    const config=await this.config(kind);if(!config.versions.includes(version)&&!localSource)throw Error('请选择可用的运行版本。');
    this.npm.useRegistry(config.registry);
    const target=this.directory(kind,version);if((await this.state(kind)).installed.some(v=>v.version===version)){if(localSource)throw Error('该版本已安装');return this.state(kind);}
    const stage=path.join(this.root,kind,'staging',crypto.randomUUID());await fs.mkdir(stage,{recursive:true});let published=false,registered=false;
    try{const pkg=path.join(stage,'node_modules',...definitions[kind].package.split('/'));await installTree(definitions[kind].package,version,pkg);
      job.phase('准备环境');const source=path.join(__dirname,'runner'),entry=path.join(stage,'adapter',kind+'-worker.mjs');await fs.mkdir(path.dirname(entry),{recursive:true});
      for(const name of [kind+'-worker.mjs','run-files.mjs',...(kind==='clang'?['clang-project.mjs','clang-lifetime.mjs','clang-workspace.mjs']:kind==='lua'?['file-runtime.mjs']:[])])await fs.copyFile(path.join(source,name),path.join(stage,'adapter',name));
      if(kind==='clang')await fs.copyFile(path.join(__dirname,'clang-source.cjs'),path.join(stage,'clang-source.cjs'));
      const files={},assetSizes={};
      const add=async(from,name)=>{const bytes=await fs.readFile(from);await fs.mkdir(path.dirname(path.join(stage,name)),{recursive:true});await fs.writeFile(path.join(stage,name),bytes);files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};if(name.endsWith('.gz'))assetSizes['https://clang.moyu.invalid/'+name]=gunzipSync(bytes,{maxOutputLength:128*1024*1024}).length;};
      if(kind==='clang'){
        for(const name of ['runtime-manifest.v1.json','bin/memfs.wasm.gz','bin/clang.wasm.gz','bin/lld.wasm.gz','bin/sysroot.tar.gz'])await add(path.join(pkg,'assets',name),'clang/'+name);
      }else await add(path.join(pkg,'dist',kind==='sql'?'sql-wasm.wasm':'glue.wasm'),kind+'/'+(kind==='sql'?'sql-wasm.wasm':'glue.wasm'));
      const esbuild=require('esbuild'),plugins=[{name:'no-host',setup(b){b.onResolve({filter:/.*/},a=>require('node:module').isBuiltin(a.path)?{path:a.path,namespace:'no-host'}:undefined);b.onLoad({filter:/.*/,namespace:'no-host'},()=>({contents:'module.exports={}',loader:'js'}));}}];
      if(kind==='clang'){const {compilerAssetCachePlugin}=await import('../scripts/clang-memory-adapter.mjs');plugins.push(compilerAssetCachePlugin(assetSizes));}
      await esbuild.build({entryPoints:[entry],outfile:path.join(stage,kind+'-runtime.mjs'),bundle:true,platform:'browser',format:'esm',target:'chrome144',minify:true,legalComments:'eof',plugins});
      if(kind==='sql'){
        await fs.copyFile(path.join(source,'sql-viewer.mjs'),path.join(stage,'adapter/sql-viewer.mjs'));
        const helper=path.join(__dirname,'../shared/sqlite-browser.mjs');
        await fs.copyFile(require('node:fs').existsSync(helper)?helper:path.join(source,'sqlite-browser.mjs'),path.join(stage,'adapter/sqlite-browser.mjs'));
        await esbuild.build({entryPoints:[path.join(stage,'adapter/sql-viewer.mjs')],outfile:path.join(stage,'viewer-runtime.mjs'),bundle:true,platform:'browser',format:'esm',target:'chrome144',minify:true,legalComments:'eof',plugins});
      }
      await fs.rm(path.join(stage,'adapter'),{recursive:true,force:true});
      // Keep the downloaded package sources and notices visible alongside the
      // engine. JavaScript loaders are bundled from the exact selected version.
      const manifest={kind,adapterVersion:require('./runtime-adapters.cjs').adapterVersion(kind),name:definitions[kind].name,version,files,size:Object.values(files).reduce((n,f)=>n+f.bytes,0)};
      job.check();await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2));await fs.mkdir(path.dirname(target),{recursive:true});job.commit();await require("./files.cjs").renameWithRetry(stage,target);published=true;
      if(!config.selected||localSource)config.selected=version;config.versions=[...new Set([...config.versions,version])];await this.write(kind,config);registered=true;return this.state(kind);
    }catch(error){if(published&&!registered){const persisted=await this.config(kind).catch(()=>null);if(persisted&&persisted.selected!==version)await fs.rm(target,{recursive:true,force:true});}throw error;}finally{await fs.rm(stage,{recursive:true,force:true});}
  });}
  async select({language:kind,version}){return this.mutate(kind,'select',async()=>{const c=await this.config(kind);if(!(await this.state(kind)).installed.some(v=>v.version===version))throw Error('该运行环境尚未安装。');c.selected=version;await this.write(kind,c);return this.state(kind);});}
  async remove({language:kind,version}){return this.mutate(kind,'remove',async()=>{const c=await this.config(kind),directory=this.directory(kind,version);if(version===definitions[kind].recommended)c.bundledRemoved=version;await fs.rm(directory,{recursive:true,force:true});if(c.selected===version)c.selected=(await this.state(kind)).installed[0]?.version||'';await this.write(kind,c);return this.state(kind);});}
}
module.exports={ManagedRuntimes,definitions};
