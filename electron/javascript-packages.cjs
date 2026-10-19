const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {isBuiltin}=require('node:module');
const {NpmStore,packageName,versionName,registryURL}=require('./npm-store.cjs');
const {atomicIfChanged}=require('./files.cjs');
const {DownloadTasks}=require('./download-tasks.cjs');
class JavaScriptPackages {
  constructor(root,downloads=new DownloadTasks()){this.downloads=downloads;this.root=path.resolve(root,'JavaScript');this.npm=new NpmStore(this.root);this.job=false;this.bundles=new Map();}
  async read(){try{return JSON.parse(await fs.readFile(path.join(this.root,'packages.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {registry:'https://registry.npmjs.org',packages:{}};}}
  directory(name,version){if(!packageName(name)||!versionName(version))throw Error('npm 包名或版本无效。');return path.join(this.root,'Packages',...name.split('/'),version);}
  async state(){const state=await this.read();return {...state,root:this.root,busy:this.job};}
  async configure({registry}){return this.mutate(async()=>{const state=await this.read();state.registry=registryURL(registry);await fs.mkdir(this.root,{recursive:true});await atomicIfChanged(path.join(this.root,'packages.json'),JSON.stringify(state,null,2));return this.state();});}
  async versions({name}){return this.transfer('查询 npm 版本',async()=>{this.npm.useRegistry((await this.read()).registry);return {versions:await this.npm.versions(name)};});}
  async mutate(action){if(this.job)throw Error('请等待依赖操作完成。');this.job=true;try{const result=await action();this.bundles.clear();return result;}finally{this.job=false;this.npm.clear();}}
  async transfer(label,work){return this.mutate(()=>this.downloads.run('javascript',label,async job=>{this.npm.options.job=job;try{return await work(job);}finally{this.npm.options.job=null;}}));}
  async install({name,version}){return this.transfer('安装 npm 依赖',async job=>{const target=this.directory(name,version),state=await this.read();if(!state.packages[name]?.versions.includes(version)){
    this.npm.useRegistry(state.registry);
    const stage=path.join(this.root,'staging',crypto.randomUUID());
    try{await this.npm.installTree(name,version,stage);await fs.mkdir(path.dirname(target),{recursive:true});job.commit();await fs.rename(stage,target);}finally{await fs.rm(stage,{recursive:true,force:true});}
    const entry=Object.hasOwn(state.packages,name)?state.packages[name]:{selected:version,versions:[]};entry.versions.push(version);state.packages[name]=entry;
  }state.packages[name].selected=version;await atomicIfChanged(path.join(this.root,'packages.json'),JSON.stringify(state,null,2));return this.state();});}
  async select({name,version}){return this.mutate(async()=>{const state=await this.read();this.directory(name,version);if(!state.packages[name]?.versions.includes(version))throw Error('该依赖版本尚未安装。');state.packages[name].selected=version;await atomicIfChanged(path.join(this.root,'packages.json'),JSON.stringify(state,null,2));return this.state();});}
  async remove({name,version}){return this.mutate(async()=>{const directory=this.directory(name,version),state=await this.read();await fs.rm(directory,{recursive:true,force:true});const entry=state.packages[name];if(entry){entry.versions=entry.versions.filter(v=>v!==version);if(!entry.versions.length)delete state.packages[name];else if(entry.selected===version)entry.selected=entry.versions[0];}await atomicIfChanged(path.join(this.root,'packages.json'),JSON.stringify(state,null,2));return this.state();});}
  async bundle(code,language='js'){
    if(!/\bimport\s*(?:[({"']|[\w*$])|\bexport\s/.test(code) && !/^(ts|typescript)$/.test(language))return code;
    const state=await this.read(),cacheKey=JSON.stringify([code,language,state.packages]);if(this.bundles.has(cacheKey))return this.bundles.get(cacheKey);
    const esbuild=require('esbuild'),root=path.resolve(this.root),entries=state.packages;
    const result=await esbuild.build({stdin:{contents:code,sourcefile:'code.'+(language==='ts'||language==='typescript'?'ts':'js'),loader:language==='ts'||language==='typescript'?'ts':'js',resolveDir:root},bundle:true,write:false,platform:'browser',format:'esm',target:'chrome144',mainFields:['browser','module','main'],conditions:['browser'],logLevel:'silent',plugins:[{name:'installed-browser-packages',setup:build=>{
      build.onResolve({filter:/.*/},async args=>{
        if(args.pluginData?.resolved)return;
        if(isBuiltin(args.path)||args.path.startsWith('node:'))throw Error('浏览器运行环境不支持 Node.js 模块：'+args.path);
        if(/^(?:[a-z]+:|[a-zA-Z]:|\/|\\)/.test(args.path))throw Error('不能导入主机文件或网络模块。');
        if(args.path.startsWith('.')){
          if(path.resolve(args.resolveDir)===root)throw Error('请使用 files 读写本块文件；import 用于已安装的 npm 包。');
          return;
        }
        const name=args.path.startsWith('@')?args.path.split('/').slice(0,2).join('/'):args.path.split('/')[0];
        // Dependencies inside a downloaded package use its own npm dependency
        // graph. Top-level imports must use a version installed by the user.
        if(args.importer && path.resolve(args.resolveDir)!==root){
          const resolved=await build.resolve(args.path,{resolveDir:args.resolveDir,kind:args.kind,importer:args.importer,pluginData:{resolved:true}});
          if(!resolved.errors.length)return resolved;
          if(args.path.startsWith('.'))return resolved;
        }
        const entry=Object.hasOwn(entries,name)?entries[name]:null;if(!entry)throw Error('请先安装 npm 依赖：'+name);
        const dir=this.directory(name,entry.selected),suffix=args.path.slice(name.length);
        // Resolve the package's exports/browser fields without manufacturing
        // node_modules symlinks or executing its main entry in Node.
        const info=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
        const exports=info.exports;let target;
        const condition=value=>typeof value==='string'?value:Array.isArray(value)?value.map(condition).find(Boolean):value&&typeof value==='object'?condition(value.browser)||condition(value.import)||condition(value.default):undefined;
        if(exports)target=condition(typeof exports==='string'?exports:exports[suffix?'.'+suffix:'.']||(!suffix?exports:undefined));
        if(!target)target=suffix?suffix.slice(1):typeof info.browser==='string'?info.browser:info.module||info.main||'index.js';
        if(typeof target!=='string'||target.includes('..')||path.isAbsolute(target))throw Error('依赖入口不受支持。');
        return build.resolve('./'+target.replace(/^\.\//,''),{resolveDir:dir,kind:args.kind,pluginData:{resolved:true}});
      });
      build.onLoad({filter:/.*/},async args=>{const file=await fs.realpath(args.path);if(file!==root&&!file.startsWith(root+path.sep))throw Error('依赖引用了运行环境以外的文件。');});
    }}]});
    const output=result.outputFiles[0].text;if(Buffer.byteLength(output)>10*1024*1024)throw Error('JavaScript 依赖打包超过 10 MB。');
    if(/^export\s/m.test(output))throw Error('代码块支持 import；请直接执行代码，不使用顶层 export。');
    this.bundles.set(cacheKey,output);while(this.bundles.size>8)this.bundles.delete(this.bundles.keys().next().value);return output;
  }
}
module.exports={JavaScriptPackages};
