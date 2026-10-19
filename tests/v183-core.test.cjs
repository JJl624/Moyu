const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {javaSource}=require('../electron/managed-source.cjs'),{validate,RuntimeSettings}=require('../electron/runtime-settings.cjs'),{ResultStore}=require('../electron/result-store.cjs');
test('Java snippets preserve strings/comments, lift real imports and choose the public source name',()=>{
  const snippet='import java.util.List;\n/* import fake.One; */\nSystem.out.println("class Other {}");';
  const source=javaSource(snippet);assert.equal(source.path,'Main.java');assert(source.code.startsWith('import java.util.List;'));assert(source.code.includes('/* import fake.One; */'));assert(source.code.includes('"class Other {}"'));
  assert.equal(javaSource('package demo; class Helper {} public final class Main {}').path,'demo/Main.java');
  assert.equal(javaSource('System.out.print(1);',{autoMain:false}).code,'System.out.print(1);');
});
test('Managed runtime options reject host paths and code injection, and legacy JS mode is ignored without read-time writes',async()=>{
  for(const [kind,patch]of [['csharp',{usings:['System; #error injected']}],['csharp',{stdinFile:'../host'}],['java',{mainClass:'Main;'}],['java',{arguments:['a\0b']}],['java',{multiFile:1}],['javascript',{mode:'dom'}]])assert.throws(()=>validate(kind,patch));
  assert.equal(validate('java',{mainClass:'测试.Main'}).mainClass,'测试.Main');
  const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/settings-v183-'));try{const store=new RuntimeSettings(root),raw=JSON.stringify({version:1,code:{javascript:{mode:'dom',executionTimeoutSeconds:2}}});await fs.writeFile(store.file,raw);assert.equal((await store.config('javascript')).mode,undefined);assert.equal(await fs.readFile(store.file,'utf8'),raw);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Restoring many pinned HTML results retains metadata only, reads on demand and invalidates released readers',async()=>{
  const store=new ResultStore(16),bytes=Buffer.alloc(100000,65);let reads=0;const artifacts=Array.from({length:30},()=>store.retainDeferred({kind:'html',name:'result.html',size:bytes.length},async()=>{reads++;return bytes;}));
  assert.equal(store.size,0);assert.equal(reads,0);assert.equal((await store.read(artifacts[0].token)).length,bytes.length);assert.equal(reads,1);assert.equal(store.size,0);
  store.release([artifacts[0].token]);await assert.rejects(store.read(artifacts[0].token),/释放/);assert.equal(reads,1);
  store.retain([{kind:'file',name:'a',data:Buffer.alloc(10).toString('base64')}]);store.retain([{kind:'file',name:'b',data:Buffer.alloc(10).toString('base64')}]);assert(store.get(artifacts[1].token).read);assert.equal(store.size,10);
});
test('Markdown paste closes inline link nodes while preserving list and paragraph openness',()=>{
  const Module=require('node:module'),bundle=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/inlinePaste.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*']}).outputFiles[0].text,mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(bundle,__filename);
  const {Schema}=require('prosemirror-model'),schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},bullet_list:{content:'list_item+',group:'block'},list_item:{content:'paragraph block*'},code_block:{content:'text*',group:'block',code:true},resource_link:{inline:true,group:'inline',content:'text*',code:true},text:{group:'inline'}}});
  const raw='[绘图](<attachments/中文 空格.excalidraw>)',link=schema.node('resource_link',null,schema.text(raw)),p=schema.node('paragraph',null,link),slice=mod.exports.markdownLinkSlice(schema.node('doc',null,p));assert.equal(slice.openStart,0);assert.equal(slice.content.firstChild.type.name,'resource_link');assert.equal(slice.content.firstChild.textContent,raw);
  const list=schema.node('doc',null,schema.node('bullet_list',null,schema.node('list_item',null,p))),listed=mod.exports.markdownLinkSlice(list);assert.equal(listed.openStart,3);assert.equal(mod.exports.markdownLinkSlice(schema.node('doc',null,schema.node('code_block',null,schema.text(raw)))),null);
});
test('Browser runtime mirrors verify receipts, cancel partially downloaded assets and publish no partial version',async()=>{
  const {ManagedRuntimes}=require('../electron/managed-runtimes.cjs'),{DownloadTasks}=require('../electron/download-tasks.cjs');const original=global.fetch;
  const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/browser-download-'));try{
    for(const language of ['csharp','java']){
      const tasks=new DownloadTasks(),manager=new ManagedRuntimes(root,tasks),version=manager.definition(language).recommended;await manager.configure({language,assetMirror:'https://mirror.example/assets/'});
      global.fetch=async url=>{assert(String(url).startsWith('https://mirror.example/assets/'));return new Response('wrong asset');};await assert.rejects(manager.install({language,version}),/校验失败/);assert.deepEqual((await manager.state(language)).installed,[]);
      let started;const ready=new Promise(r=>started=r);global.fetch=async(_url,{signal})=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});started();}}));
      const pending=assert.rejects(manager.install({language,version}),e=>e.code==='DOWNLOAD_CANCELLED');await ready;tasks.cancel('runtime:'+language,tasks.state('runtime:'+language).id);await pending;assert.deepEqual(await fs.readdir(path.join(manager.root,language,'staging')),[]);assert.equal((await manager.state(language)).selected,'');
    }
  }finally{global.fetch=original;await fs.rm(root,{recursive:true,force:true});}
});
test('Pinned HTML follows document rename/copy, avoids unchanged resize writes and remains usable after unpin',async()=>{
 const {Vault}=require('../electron/vault.cjs'),{Attachments}=require('../electron/attachments.cjs'),{References}=require('../electron/references.cjs'),{CodeData}=require('../electron/code-data.cjs'),{DocumentFiles}=require('../electron/document-files.cjs'),{HTMLResults,htmlDocument}=require('../electron/html-results.cjs'),{PinnedHTML}=require('../electron/pinned-html.cjs');
 const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/pin-lifecycle-'));try{
  const vault=await new Vault(root).init(),attachments=new Attachments(vault),refs=new References(vault),current=new CodeData(vault,attachments,refs),store=new ResultStore(),html=new HTMLResults(store,{current:()=>current}),pins=new PinnedHTML(html,()=>current),operations=new DocumentFiles(vault,attachments,refs,()=>{throw Error('Unexpected trash');}),markdown='```js {id=0001}\ndisplayHTML("old");\n```';
  await vault.create('原.md','file',markdown);await current.documents.sync('原.md',markdown);const bytes=Buffer.from(htmlDocument({code:'displayHTML("old");'})),artifact=store.retain([{kind:'html',name:'result.html',data:bytes.toString('base64')}])[0];html.contexts.set(artifact.token,{current,input:{document:'原.md',id:'0001',language:'js',code:'displayHTML("old");'},context:{files:[]}});await pins.attach(artifact.token,0);await pins.pin({token:artifact.token,pinned:true,height:550});
  const record=path.join(root,'原.assets/results/0001/results.json'),before=(await fs.stat(record)).mtimeMs;await pins.resize({token:artifact.token,height:550});assert.equal((await fs.stat(record)).mtimeMs,before);
  await operations.rename({from:'原.md',to:'新.md'});await operations.copy({from:'新.md',to:'复制.md'});store.clear();const restored=await pins.load({document:'复制.md',markdown});assert.equal(restored[0].artifacts[0].height,550);assert.equal(store.size,0);const token=restored[0].artifacts[0].token;await pins.pin({token,pinned:false,height:550});assert.deepEqual(await store.read(token),bytes);assert.equal(await fs.stat(path.join(root,'复制.assets/results/0001/0.html')).catch(()=>null),null);assert.deepEqual(await fs.readFile(path.join(root,'新.assets/results/0001/0.html')),bytes);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
