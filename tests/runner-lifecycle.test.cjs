const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events');
test('Hung sandbox cleanup finishes within a bound and the next environment uses a fresh isolated session',async()=>{
  const sessions=new Map();
  const session={fromPartition(name){if(!sessions.has(name))sessions.set(name,{name,setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},protocol:{handle(){},unhandle(){}},clearStorageData:()=>name.endsWith('-0')?new Promise(()=>{}):Promise.resolve(),clearCache:()=>Promise.resolve()});return sessions.get(name);}};
  class BrowserWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.closed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>true;}
    async loadURL(){}
    isDestroyed(){return this.closed;}
    destroy(){if(!this.closed){this.closed=true;this.emit('closed');}}
  }
  const file=path.resolve(__dirname,'../electron/runner.cjs'),module={exports:{}},nativeRequire=createRequire(file);
  const load=vm.runInThisContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file});
  load(name=>name==='electron'?{BrowserWindow,session}:nativeRequire(name),module,module.exports,path.dirname(file));
  const runner=new module.exports.CodeRunner(null);
  const first=runner.environment('clang');await first.ready;
  const started=Date.now();await first.dispose();assert(Date.now()-started<2600);
  assert(first.win.isDestroyed());
  const second=runner.environment('clang');await second.ready;
  assert.notEqual(second.win.options.webPreferences.session,first.win.options.webPreferences.session);
  assert.equal(second.win.options.webPreferences.sandbox,true);assert.equal(second.win.options.webPreferences.nodeIntegration,false);
  await second.dispose();
  const javascript=runner.environment('javascript');await javascript.ready;
  const restarting=javascript.restart('console.log(1)');
  const rejected=assert.rejects(restarting,/代码运行已停止/);
  await javascript.dispose();await rejected;
});
test('Finished runs do not prepare replacement workers until another execution requests them',async()=>{
 const file=path.resolve(__dirname,'../electron/runner.cjs'),m={exports:{}},native=createRequire(file);vm.runInThisContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>name==='electron'?{}:native(name),m,m.exports,path.dirname(file));
 const runner=new m.exports.CodeRunner(null),limits={executionTimeoutSeconds:1,preparationTimeoutSeconds:1};runner.config=async()=>limits;let restarts=0;const env={ready:Promise.resolve(),aborted:new Promise(()=>{}),prepared:new Set(),win:{webContents:{executeJavaScript:async()=>({output:'42',elapsed:1})},isDestroyed:()=>false},restart:async()=>{restarts++;},dispose:async()=>{}};runner.environment=()=>env;
 await runner.run({language:'bash',code:'echo 42'});assert.equal(restarts,0);assert.equal(env.needsPrepare,true);await runner.run({language:'bash',code:'echo 42'});assert.equal(restarts,1);runner.stop();
});
test('Compiled WASM modules are reused while each nonpersistent run receives a fresh worker',async()=>{
 const workers=[];let compiled=0;class Worker{constructor(){workers.push(this);}postMessage(input){queueMicrotask(()=>{this.onmessage({data:input.type==='init'?{type:'ready'}:input.type==='packages'?{type:'packages'}:{type:'result',output:'42',artifacts:[]}});});}terminate(){this.closed=true;}}
 const context={window:{},Worker,WebAssembly:{compileStreaming:async()=>({serial:++compiled})},fetch:async()=>{},performance,setTimeout,clearTimeout,console};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../electron/runner/runner.mjs'),'utf8'),context);for(let i=0;i<2;i++){await context.window.prepareCode({language:'ruby'});await context.window.runCode({language:'ruby',code:'puts 42',runtimeSettings:{}});}assert.equal(compiled,1);assert.equal(workers.length,2);assert(workers.every(w=>w.closed));
});

test('Closing documents releases only unused idle environments and cancels in-flight preparation without stopping a running sandbox', async () => {
 const file=path.resolve(__dirname,'../electron/runner.cjs'),m={exports:{}},native=createRequire(file);
 vm.runInThisContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>name==='electron'?{}:native(name),m,m.exports,path.dirname(file));
 const runner=new m.exports.CodeRunner(null), disposed=[], active={destroy(){throw Error('active execution must remain alive');}};
 runner.active=active;
 for(const language of ['python','clang','sql'])runner.idle.set(language,{dispose:async()=>disposed.push(language)});
 await runner.releaseIdle(['sql']);assert.deepEqual(disposed,['python','clang']);assert(runner.idle.has('sql'));assert.equal(runner.active,active);
 let release;runner.config=()=>new Promise(resolve=>{release=resolve;});let allocated=0;runner.environment=()=>{allocated++;throw Error('stale allocation');};
 const preparing=runner.prepare({language:'bash'});await new Promise(resolve=>setImmediate(resolve));
 await runner.releaseIdle(['sql']);release({});await preparing;assert.equal(allocated,0);assert.equal(runner.preparing.size,0);
 runner.config=async()=>({});const fresh={ready:Promise.resolve(),dispose:async()=>disposed.push('fresh')};runner.environment=()=>fresh;
 await runner.prepare({language:'bash'});assert.equal(runner.idle.get('bash'),fresh);await runner.releaseIdle([]);clearTimeout(fresh.expiry);
 assert.deepEqual(disposed,['python','clang','sql','fresh']);assert.equal(runner.active,active);
});
