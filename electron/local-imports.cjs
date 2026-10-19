const fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const {atomicIfChanged}=require('./files.cjs');
const {packageName,versionName,unpack}=require('./npm-store.cjs');
const safe=name=>typeof name==='string'&&name.length<1000&&!path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[<>:"|?*\x00-\x1f]/.test(p));
async function json(file){const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>4*1024*1024)throw Error('导入记录必须是普通 JSON 文件，且不超过 4 MB。');return JSON.parse(await fs.readFile(file,'utf8'));}
async function checksum(file,job){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('本地导入不读取链接或特殊文件。');job?.file(path.basename(file),stat.size);const digest=crypto.createHash('sha256');let read=0;for await(const chunk of native.createReadStream(file,{signal:job?.controller.signal})){job?.check();digest.update(chunk);read+=chunk.length;job?.advance(read);}return {bytes:read,sha256:digest.digest('hex')};}
async function copyFile(source,target,job){const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('本地导入不读取链接或特殊文件。');job?.file(path.basename(source),stat.size);let bytes=0;await pipeline(native.createReadStream(source),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;try{job?.advance(bytes);done(null,chunk);}catch(error){done(error);}}}),native.createWriteStream(target,{flags:'wx',flush:true}),{signal:job?.controller.signal});}
async function copyDirectory(source,target,job,budget={count:0,total:0}){
  source=path.resolve(source);target=path.resolve(target);const comparable=value=>process.platform==='win32'?value.toLowerCase():value;if(comparable(target)===comparable(source)||comparable(target).startsWith(comparable(source)+path.sep))throw Error('不能把导入目录复制到它自身。');

  const visit=async(from,to,depth=0)=>{job?.check();const stat=await fs.lstat(from);if(stat.isSymbolicLink())throw Error('本地导入不允许符号链接或目录链接。');if(!stat.isDirectory()||depth>32)throw Error('本地导入目录无效或层级过深。');await fs.mkdir(to,{recursive:true});
    for(const entry of await fs.readdir(from,{withFileTypes:true})){job?.check();if(!safe(entry.name)||entry.isSymbolicLink())throw Error('导入文件名无效或包含链接：'+entry.name);const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())await visit(a,b,depth+1);else if(entry.isFile()){const size=(await fs.stat(a)).size;budget.total+=size;if(++budget.count>30000||budget.total>1024*1024*1024)throw Error('导入最多 30000 个文件、共 1 GB。');await copyFile(a,b,job);}else throw Error('导入不支持特殊文件。');}
  };await visit(source,target);
}
async function verifyManifest(directory,manifest,job){
  if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||Object.keys(manifest.files).length>4000)throw Error('manifest.json 缺少有效 files 清单。');
  for(const [name,record] of Object.entries(manifest.files)){job?.check();if(!safe(name)||!Number.isSafeInteger(record?.bytes)||record.bytes<0||! /^[a-f\d]{64}$/i.test(record.sha256))throw Error('环境清单中的文件名、大小或校验值无效。');const actual=await checksum(path.join(directory,...name.split('/')),job);if(actual.bytes!==record.bytes||actual.sha256!==record.sha256)throw Error('本地环境校验失败：'+name);}
}
class LocalImports {
  constructor({runtimes,python,packages}){Object.assign(this,{runtimes,python,packages});}
  async runtime(kind,source){const manager=this.runtimes;if(!await fs.stat(path.join(source,'manifest.json')).catch(()=>null)){const info=await require('./local-runtime-package.cjs').packageInfo(kind,source);return manager.install({language:kind,version:info.version,localSource:source});}return manager.transfer(kind,'导入环境',async job=>{
    const manifest=await json(path.join(source,'manifest.json'));if(manifest.kind!==kind||!versionName(manifest.version))throw Error('请选择对应语言的 Runtime 版本目录，目录内需有 manifest.json。');
    const target=manager.directory(kind,manifest.version);if(await fs.lstat(target).catch(()=>null))throw Error('该版本已存在，请先删除或选择其他版本。');
    const stage=path.join(manager.root,kind,'staging',crypto.randomUUID());let published=false,registered=false;
    try{await copyDirectory(source,stage,job);await verifyManifest(stage,manifest,job);
      for(const name of [kind+'-runtime.mjs',...(kind==='sql'?['viewer-runtime.mjs']:kind==='java'?['formatter-browser.mjs']:kind==='csharp'?['formatter.wasm']:[])]){
        if(kind==='java'&&!await fs.stat(path.join(stage,name)).catch(()=>null))await require('./java-formatter.cjs').ensure(stage);
        if(!(await fs.stat(path.join(stage,name))).isFile())throw Error('环境缺少 '+name);
      }
      const asset=kind==='sql'?'sql/sql-wasm.wasm':kind==='lua'?'lua/glue.wasm':kind==='bash'?'bash/bashkit_wasm_bg.wasm':kind==='ruby'?'ruby/ruby+stdlib.wasm':kind==='clang'?'clang/runtime-manifest.v1.json':null;
      if(asset&&!Object.hasOwn(manifest.files,asset))throw Error('环境清单缺少 '+asset);
      const required=kind==='clang'?['runtime-manifest.v1.json','bin/memfs.wasm.gz','bin/clang.wasm.gz','bin/lld.wasm.gz','bin/sysroot.tar.gz'].map(name=>'clang/'+name):['csharp','java'].includes(kind)?require('./browser-runtimes.cjs').catalog[kind].files.map(file=>kind+'/'+file.name):[];
      for(const name of required)if(!Object.hasOwn(manifest.files,name))throw Error('环境清单缺少 '+name);
      job.commit();await fs.mkdir(path.dirname(target),{recursive:true});await require("./files.cjs").renameWithRetry(stage,target);published=true;const config=await manager.config(kind);config.versions=[...new Set([...(config.versions||[]),manifest.version])];config.selected=manifest.version;await manager.write(kind,config);registered=true;return manager.state(kind);
    }catch(error){if(published&&!registered){const persisted=await manager.config(kind).catch(()=>null);if(persisted&&persisted.selected!==manifest.version)await fs.rm(target,{recursive:true,force:true});}throw error;}finally{await fs.rm(stage,{recursive:true,force:true});}
  });}
  pythonRuntime(source,version){const manager=this.python;return manager.transfer('导入 Python 环境',async()=>{
    const original=await json(path.join(source,'manifest.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const pkg=original?null:await json(path.join(source,'package.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});version=manager.version(original?.version||(pkg?.name==='pyodide'?pkg.version:version));
    const config=await manager.config(),target=manager.directory(version),stage=target+'-importing-'+crypto.randomUUID(),job=manager.task;
    let published=false,registered=false;
    if(config.installed.includes(version)||await fs.lstat(target).catch(()=>null))throw Error('该 Python 版本已存在，请先删除或选择其他版本。');
    try{await copyDirectory(source,stage,job);const loader=await fs.readFile(path.join(stage,'pyodide.mjs'),'utf8'),asm=loader.match(/pyodide\.asm\.(?:mjs|js)/)?.[0]||'pyodide.asm.mjs',files={};if(loader.length<1000||loader.slice(0,100).includes('<!DOCTYPE'))throw Error('Pyodide 加载器无效。');
      for(const name of ['pyodide.mjs',asm,'pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'])files[name]=await checksum(path.join(stage,name),job);
      if(original)await verifyManifest(stage,original,job);manager.validateCatalog(await json(path.join(stage,'pyodide-lock.json')));
      const handle=await fs.open(path.join(stage,'pyodide.asm.wasm'),'r');try{const magic=Buffer.alloc(4);await handle.read(magic,0,4,0);if(magic.toString('hex')!=='0061736d')throw Error('Pyodide WASM 文件无效。');}finally{await handle.close();}
      await atomicIfChanged(path.join(stage,'manifest.json'),JSON.stringify({version,files},null,2));
      if(await fs.lstat(path.join(stage,'packages.json')).catch(()=>null)){
        const installed=await json(path.join(stage,'packages.json')),catalog=await json(path.join(stage,'pyodide-lock.json'));
        if(!Array.isArray(installed.installed)||!Array.isArray(installed.requested))throw Error('Python 包记录无效。');
        for(const name of manager.dependencies(installed.requested,catalog)){const record=catalog.packages[name];if((await checksum(path.join(stage,record.file_name),job)).sha256!==record.sha256)throw Error('Python 包校验失败：'+name);}
      }
      job.commit();await fs.mkdir(path.dirname(target),{recursive:true});await require("./files.cjs").renameWithRetry(stage,target);published=true;config.installed.push(version);config.selected=version;await manager.write(config);registered=true;return manager.state();
    }catch(error){if(published&&!registered){const persisted=await manager.config().catch(()=>null);if(persisted&&!persisted.installed?.includes(version))await fs.rm(target,{recursive:true,force:true});}throw error;}finally{await fs.rm(stage,{recursive:true,force:true});}
  });}
  pythonPackages(sources){const manager=this.python;return manager.transfer('导入 Python 包',async()=>{
    const c=await manager.config();if(!c.selected)throw Error('请先选择 Python 环境。');const catalog=await manager.catalog(c.selected);manager.validateCatalog(catalog);const directory=manager.directory(c.selected),state=await manager.read(path.join(directory,'packages.json'),{requested:[],installed:[]});
    const supplied=new Map();for(const source of sources){const name=Object.keys(catalog.packages).find(name=>catalog.packages[name].file_name===path.basename(source));if(!name)throw Error('文件不在当前 Pyodide 包清单中：'+path.basename(source));supplied.set(name,source);}
    const requested=[...new Set([...state.requested,...supplied.keys()])],needed=manager.dependencies(requested,catalog),copies=[];
    for(const name of needed){const p=catalog.packages[name],target=path.join(directory,p.file_name),existing=await fs.lstat(target).catch(()=>null);if(existing){if((await checksum(target,manager.task)).sha256!==p.sha256)throw Error('已安装包校验失败：'+name);continue;}const source=supplied.get(name);if(!source)throw Error('请同时选择依赖文件：'+p.file_name);if((await checksum(source,manager.task)).sha256!==p.sha256)throw Error('包校验失败：'+p.file_name);copies.push({source,target});}
    const added=[];try{for(const file of copies){added.push(file.target);await copyFile(file.source,file.target,manager.task);}manager.task.commit();await atomicIfChanged(path.join(directory,'packages.json'),JSON.stringify({requested,installed:needed},null,2));return manager.state();}catch(error){for(const file of added)await fs.unlink(file).catch(()=>{});throw error;}
  });}
  javascript(source,archive=false){const manager=this.packages;return manager.transfer('导入 npm 包',async job=>{
    const stage=path.join(manager.root,'staging',crypto.randomUUID());let target,published=false,registered=false;
    try{if(archive){const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>100*1024*1024)throw Error('npm .tgz 归档需为普通文件，且不超过 100 MB。');await fs.mkdir(stage,{recursive:true});await unpack(await fs.readFile(source),stage,job);}else await copyDirectory(source,stage,job);
      const pkg=await json(path.join(stage,'package.json'));if(!packageName(pkg.name)||!versionName(pkg.version))throw Error('目录或归档需包含有效的 npm package.json。');
      const state=await manager.read();target=manager.directory(pkg.name,pkg.version);if(await fs.lstat(target).catch(()=>null))throw Error('该 npm 版本已存在。');
      const visited=new Set();
      const dependencies=async(directory)=>{if(visited.has(directory))return;visited.add(directory);if(visited.size>4096)throw Error('依赖数量超过限制。');const info=await json(path.join(directory,'package.json'));for(const [name,range] of Object.entries(info.dependencies||{})){if(!packageName(name))throw Error('依赖包名无效。');let current=directory,found;while(current===stage||current.startsWith(stage+path.sep)){const candidate=path.join(current,'node_modules',...name.split('/'));if(await fs.stat(path.join(candidate,'package.json')).catch(()=>null)){found=candidate;break;}current=path.dirname(current);}if(!found){const entry=Object.hasOwn(state.packages,name)?state.packages[name]:null;if(entry)found=manager.directory(name,entry.selected);}if(!found)throw Error('本地包缺少依赖 '+name+'。请先导入该依赖，或导入包含 node_modules 的完整包目录。');const dep=await json(path.join(found,'package.json'));if(!require('semver').satisfies(dep.version,range))throw Error('依赖版本不匹配：'+name+'，需要 '+range);await dependencies(found);}};
      await dependencies(stage);job.commit();await fs.mkdir(path.dirname(target),{recursive:true});await require("./files.cjs").renameWithRetry(stage,target);published=true;
      const entry=Object.hasOwn(state.packages,pkg.name)?state.packages[pkg.name]:{selected:pkg.version,versions:[]};entry.selected=pkg.version;entry.versions=[...new Set([...entry.versions,pkg.version])];state.packages[pkg.name]=entry;await atomicIfChanged(path.join(manager.root,'packages.json'),JSON.stringify(state,null,2));registered=true;return manager.state();
    }catch(error){if(published&&!registered)await fs.rm(target,{recursive:true,force:true});throw error;}finally{await fs.rm(stage,{recursive:true,force:true});}
  });}
}
async function inspectEnvironment(manager,kind,source,version){
  const issues=[];let manifest;
  try{manifest=await json(path.join(source,'manifest.json'));}catch(error){if(error.code!=='ENOENT')issues.push('无法读取 manifest.json：'+error.message);}
  let files;
  if(kind==='python'){
    let pkg;try{pkg=await json(path.join(source,'package.json'));}catch(error){if(error.code!=='ENOENT')issues.push('无法读取 package.json');}
    try{version=manager.version(manifest?.version||(pkg?.name==='pyodide'?pkg.version:version));}catch{issues.push('无法识别 Pyodide 版本');version='';}
    const asm=await fs.stat(path.join(source,'pyodide.asm.mjs')).catch(()=>null)?'pyodide.asm.mjs':'pyodide.asm.js';
    files=['pyodide.mjs',asm,'pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'];
  }else if(!manifest&&['clang','sql','lua','ruby','bash'].includes(kind)&&await fs.stat(path.join(source,'package.json')).catch(()=>null)){
    try{const info=await require('./local-runtime-package.cjs').packageInfo(kind,source);version=info.version;files=info.files;const install=require('./local-runtime-package.cjs').localInstaller(source,info.pkg);await install.validate();if(kind==='ruby')await install.validate('@ruby/wasm-wasi',info.pkg.version);}catch(error){issues.push(error.message);files=['package.json'];version='';}
  }else{
    version=manifest?.version||'';
    if(manifest?.kind!==kind||!versionName(version))issues.push('请选择对应语言的 Moyu Runtime 版本目录');
    files=['manifest.json',kind+'-runtime.mjs',...(kind==='sql'?['viewer-runtime.mjs','sql/sql-wasm.wasm']:kind==='lua'?['lua/glue.wasm']:kind==='ruby'?['ruby/ruby+stdlib.wasm']:kind==='bash'?['bash/bashkit_wasm_bg.wasm']:kind==='clang'?['clang/runtime-manifest.v1.json','clang/bin/clang.wasm.gz','clang/bin/lld.wasm.gz','clang/bin/memfs.wasm.gz','clang/bin/sysroot.tar.gz']:kind==='java'?['formatter-browser.mjs',...require('./browser-runtimes.cjs').catalog.java.files.map(f=>'java/'+f.name)]:['formatter.wasm',...require('./browser-runtimes.cjs').catalog.csharp.files.map(f=>'csharp/'+f.name)])];
  }
  for(const file of files){const stat=await fs.lstat(path.join(source,file)).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())issues.push('缺少文件：'+file);}
  if(version){const state=await manager.state(kind);const installed=kind==='python'?state.installed.includes(version):state.installed.some(item=>item.version===version);if(installed)issues.push('此版本已安装');}
  return{path:source,version,files,issues};
}
module.exports={LocalImports,copyDirectory,verifyManifest,inspectEnvironment};
