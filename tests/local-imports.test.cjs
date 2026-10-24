const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {LocalImports,copyDirectory}=require('../electron/local-imports.cjs'),{ManagedRuntimes}=require('../electron/managed-runtimes.cjs'),{JavaScriptPackages}=require('../electron/javascript-packages.cjs'),{PythonManager}=require('../electron/python.cjs');
const root=path.resolve(__dirname,'../../../work/local-imports-v188');
async function fixture(t){await fs.mkdir(root,{recursive:true});const base=await fs.mkdtemp(path.join(root,'case-')),data=path.join(base,'data'),source=path.join(base,'source');await fs.mkdir(source);const runtimes=new ManagedRuntimes(data),packages=new JavaScriptPackages(data),python=new PythonManager(data),imports=new LocalImports({runtimes,packages,python});t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,data,source,runtimes,packages,python,imports};}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('Offline package preparation resolves hoisted and cyclic dependencies without network or lifecycle scripts',async t=>{
 const{base}=await fixture(t),{localInstaller}=require('../electron/local-runtime-package.cjs');
 const modules=path.join(base,'node_modules'),a=path.join(modules,'a'),b=path.join(modules,'b');
 await fs.mkdir(a,{recursive:true});await fs.mkdir(b);const info={name:'a',version:'1.0.0',dependencies:{b:'^1.0.0'},scripts:{install:'exit 1'}};
 await fs.writeFile(path.join(a,'package.json'),JSON.stringify(info));await fs.writeFile(path.join(b,'package.json'),JSON.stringify({name:'b',version:'1.0.0',dependencies:{a:'^1.0.0'}}));
 const target=path.join(base,'target'),fetch=global.fetch;global.fetch=async()=>{throw Error('unexpected network');};
 try{await localInstaller(a,info)('a','1.0.0',target);}finally{global.fetch=fetch;}
 assert.equal(JSON.parse(await fs.readFile(path.join(target,'node_modules/b/package.json'))).name,'b');
 assert.equal(await fs.stat(path.join(target,'node_modules/b/node_modules/a')).catch(()=>null),null);
 await fs.writeFile(path.join(b,'package.json'),JSON.stringify({name:'b',version:'2.0.0'}));
 await assert.rejects(localInstaller(a,info).validate(),/版本不匹配/);
});
test('Environment preview identifies versions and missing files without installing or touching the source',async t=>{
 const {source,runtimes}=await fixture(t),{inspectEnvironment}=require('../electron/local-imports.cjs');
 let result=await inspectEnvironment(runtimes,'sql',source);
 assert(result.issues.some(issue=>issue.includes('Runtime')));assert(result.issues.some(issue=>issue.includes('sql-wasm.wasm')));
 await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({kind:'sql',version:'1.14.2'}));
 await fs.mkdir(path.join(source,'sql'));for(const file of ['sql-runtime.mjs','viewer-runtime.mjs','sql/sql-wasm.wasm'])await fs.writeFile(path.join(source,file),'data');
 result=await inspectEnvironment(runtimes,'sql',source);assert.equal(result.version,'1.14.2');assert.deepEqual(result.issues,[]);assert.equal((await runtimes.state('sql')).installed.length,0);
 assert.equal(await fs.stat(runtimes.directory('sql','1.14.2')).catch(()=>null),null);
});
test('Local runtime import validates required files and hashes, selects its version, and never requests the network',async t=>{
 const {source,runtimes,imports}=await fixture(t);const wasm=Buffer.from([0,97,115,109,1,0,0,0]);await fs.mkdir(path.join(source,'sql'));await fs.writeFile(path.join(source,'sql/sql-wasm.wasm'),wasm);for(const name of ['sql-runtime.mjs','viewer-runtime.mjs'])await fs.writeFile(path.join(source,name),'export {};');await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({kind:'sql',adapterVersion:require('../electron/runtime-adapters.cjs').adapterVersion('sql'),version:'1.14.2',files:{'sql/sql-wasm.wasm':{bytes:wasm.length,sha256:digest(wasm)}},size:wasm.length}));
 const fetch=global.fetch;global.fetch=async()=>{throw Error('unexpected network');};try{const state=await imports.runtime('sql',source);assert.equal(state.selected,'1.14.2');assert.equal((await runtimes.environment('sql')).kind,'sql');await assert.rejects(imports.runtime('sql',source),/已存在/);}finally{global.fetch=fetch;}
 await fs.writeFile(path.join(source,'sql/sql-wasm.wasm'),'corrupt');const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json')));manifest.version='1.14.3';await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));await assert.rejects(imports.runtime('sql',source),/校验失败/);assert.equal((await runtimes.state('sql')).installed.length,1);
});
test('npm directory import checks dependencies, runs no package scripts, and makes the package available to the existing browser bundler',async t=>{
 const {source,packages,imports}=await fixture(t);await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'local-example',version:'1.0.0',type:'module',exports:'./index.js',scripts:{install:'throw new Error()'},dependencies:{'local-dependency':'^1.0.0'}}));await fs.writeFile(path.join(source,'index.js'),'import value from "local-dependency";export const result=value+1;');await assert.rejects(imports.javascript(source),/缺少依赖/);
 const dep=path.join(source,'node_modules/local-dependency');await fs.mkdir(dep,{recursive:true});await fs.writeFile(path.join(dep,'package.json'),JSON.stringify({name:'local-dependency',version:'1.0.0',type:'module',exports:'./index.js'}));await fs.writeFile(path.join(dep,'index.js'),'export default 41;');await imports.javascript(source);const code=await packages.bundle('import {result} from "local-example";console.log(result);');assert.match(code,/41/);assert.equal((await packages.state()).packages['local-example'].selected,'1.0.0');
});
test('Local imports reject links and can be cancelled without committing a partial environment',async t=>{
 const {base,source}=await fixture(t),outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.txt'),'secret');await fs.symlink(outside,path.join(source,'link'),process.platform==='win32'?'junction':'dir');await assert.rejects(copyDirectory(source,path.join(base,'target')),/链接/);
 await fs.unlink(path.join(source,'link'));await fs.writeFile(path.join(source,'large.bin'),Buffer.alloc(2*1024*1024));const controller=new AbortController(),job={controller,check(){controller.signal.throwIfAborted();},file(){},advance(){controller.abort();}};await assert.rejects(copyDirectory(source,path.join(base,'cancelled'),job));
});
test('A local npm tarball publishes a usable package without fetching or running lifecycle scripts',async t=>{
 const {base,packages,imports}=await fixture(t),entries={'package/package.json':JSON.stringify({name:'local-archive',version:'1.0.0',type:'module',exports:'./index.js',scripts:{install:'exit 1'}}),'package/index.js':'export const value=42;'},chunks=[];
 for(const [name,text] of Object.entries(entries)){const bytes=Buffer.from(text),header=Buffer.alloc(512);header.write(name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);header.write([...header].reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148);chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}
 chunks.push(Buffer.alloc(1024));const archive=path.join(base,'package.tgz');await fs.writeFile(archive,require('node:zlib').gzipSync(Buffer.concat(chunks)));const fetch=global.fetch;global.fetch=async()=>{throw Error('unexpected network');};try{await imports.javascript(archive,true);const bundled=await packages.bundle('import {value} from "local-archive"; console.log(value);','js');assert.match(bundled,/42/);}finally{global.fetch=fetch;}
});
test('A registration failure removes only the newly copied runtime and leaves the chosen source untouched',async t=>{
 const {source,runtimes,imports}=await fixture(t),bytes=Buffer.from([0,97,115,109,1,0,0,0]);await fs.mkdir(path.join(source,'sql'));await fs.writeFile(path.join(source,'sql/sql-wasm.wasm'),bytes);for(const name of ['sql-runtime.mjs','viewer-runtime.mjs'])await fs.writeFile(path.join(source,name),'export {};');await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({kind:'sql',version:'1.14.2',files:{'sql/sql-wasm.wasm':{bytes:8,sha256:digest(bytes)}}}));runtimes.write=async()=>{throw Error('无法记录版本');};await assert.rejects(imports.runtime('sql',source),/无法记录版本/);assert.equal(await fs.stat(runtimes.directory('sql','1.14.2')).catch(()=>null),null);assert.deepEqual(await fs.readFile(path.join(source,'sql/sql-wasm.wasm')),bytes);
});
test('Python local wheels use the selected catalog hash and require missing dependency files before writing',async t=>{
 const {base,source,python,imports}=await fixture(t),bytes=Buffer.from('wheel-data'),dependency=Buffer.from('dependency'),directory=path.join(base,'python-runtime');await fs.mkdir(directory);const catalog={info:{python:'3.14'},packages:{demo:{file_name:'demo.whl',sha256:digest(bytes),depends:['dep'],version:'1'},dep:{file_name:'dep.whl',sha256:digest(dependency),depends:[],version:'1'}}};
 python.config=async()=>({selected:'314.0.7'});python.catalog=async()=>catalog;python.directory=()=>directory;python.state=async()=>JSON.parse(await fs.readFile(path.join(directory,'packages.json')));await fs.writeFile(path.join(source,'demo.whl'),bytes);await fs.writeFile(path.join(source,'dep.whl'),dependency);
 await assert.rejects(imports.pythonPackages([path.join(source,'demo.whl')]),/依赖文件/);assert.deepEqual(await fs.readdir(directory),[]);const state=await imports.pythonPackages([path.join(source,'demo.whl'),path.join(source,'dep.whl')]);assert.deepEqual(state.installed,['dep','demo']);assert.deepEqual(await fs.readFile(path.join(directory,'demo.whl')),bytes);await fs.writeFile(path.join(directory,'demo.whl'),'bad');await assert.rejects(imports.pythonPackages([path.join(source,'demo.whl')]),/校验失败/);
});
