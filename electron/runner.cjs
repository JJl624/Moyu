const { runtimeKind } = require('../shared/code-languages.mjs');
const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { DEFAULTS } = require('./runtime-settings.cjs');
const { downloadRuntimeFile } = require('./runtime-download.cjs');
const { runtimeFileResponse } = require('./runtime-response.cjs');
const PY_FILES = ['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'];
const CLANG_FILES = ['runtime-manifest.v1.json','bin/memfs.wasm.gz','bin/clang.wasm.gz','bin/lld.wasm.gz','bin/sysroot.tar.gz'];
class CodeRunner {
  constructor(python,settings,runtimes,dependencies) { this.python=python;this.settings=settings;this.runtimes=runtimes;this.dependencies=dependencies;this.active = null; this.idle = new Map();this.preparing=new Map();this.disposing=new Map();this.sessionGeneration=new Map();this.preparationEpoch=new Map();this.epoch=0;this.running=false;this.activeKind=null; this.closing=false; }
  open() { this.closing=false; }
  stop() { this.epoch++;this.active?.destroy();this.active=null;for(const env of this.idle.values()){clearTimeout(env.expiry);env.dispose();}this.idle.clear();this.preparing.clear(); }
  close() { this.closing=true; this.stop(); }
  kind(language) { const kind = runtimeKind(language); if (kind) return kind; throw new Error('代码语言无效。'); }
  config(kind) { return kind==='python'?this.python.config():this.settings?this.settings.config(kind):Promise.resolve(structuredClone(DEFAULTS[kind])); }
  async reset(language) { const kind=this.kind(language);if(this.running||this.preparing.size)throw new Error('请先停止代码并等待环境准备完成。');const env=this.idle.get(kind);this.idle.delete(kind);if(env)await env.dispose();return true; }
  keepIdle(language,env){clearTimeout(env.expiry);if(language==='python')return;env.expiry=setTimeout(()=>{if(this.idle.get(language)===env){this.idle.delete(language);void env.dispose();}},60000);}
  async releaseIdle(keep = []) {
    const retained = new Set(keep.map(language => this.kind(language))), tasks = [];
    for (const language of new Set([...this.idle.keys(), ...this.preparing.keys()])) {
      if (retained.has(language)) continue;
      this.preparationEpoch.set(language, (this.preparationEpoch.get(language) || 0) + 1);
      this.preparing.delete(language);
      const env = this.idle.get(language);
      this.idle.delete(language);
      if (env) { clearTimeout(env.expiry); tasks.push(env.dispose()); }
    }
    await Promise.all(tasks);
  }
  async prepare(input,limits) {
    const language=this.kind(String(input.language));
    const code=typeof input.code==='string'&&Buffer.byteLength(input.code)<=200000?input.code:'';
    if(this.closing||this.activeKind===language)return;
    if(this.idle.has(language)){const env=this.idle.get(language);this.keepIdle(language,env);
      if(env.needsPrepare){env.needsPrepare=false;env.ready=env.restart(code).catch(async error=>{if(this.idle.get(language)===env)this.idle.delete(language);await env.dispose();throw error;});}
      if(language==='python'&&code&&!env.prepared.has(code)){
        env.prepared.add(code);while(env.prepared.size>16)env.prepared.delete(env.prepared.values().next().value);
        env.ready=env.ready.then(async()=>env.preload(code,(await this.python.config()).preparationTimeoutSeconds*1000)).catch(async error=>{env.prepared.delete(code);if(this.idle.get(language)===env)this.idle.delete(language);await env.dispose();throw error;});
      }
      return env.ready;
    }
    if(this.preparing.has(language))return this.preparing.get(language);
    const ticket=this.epoch, preparationTicket=this.preparationEpoch.get(language)||0;const task=(async()=>{await this.disposing.get(language);const runtime=language==='python'&&this.python?await this.python.environment():this.runtimes&&['clang','sql','lua','csharp','java','ruby','bash'].includes(language)?await this.runtimes.environment(language):null;const config=limits||runtime||await this.config(language);if(this.closing||ticket!==this.epoch||preparationTicket!==(this.preparationEpoch.get(language)||0))return;const env=this.environment(language,runtime,code,config);this.idle.set(language,env);this.keepIdle(language,env);try{await env.ready;}catch(e){if(this.idle.get(language)===env){this.idle.delete(language);await env.dispose();}throw e;}})();
    this.preparing.set(language,task);try{return await task;}finally{if(this.preparing.get(language)===task)this.preparing.delete(language);}
  }
  environment(language,runtime,code='',limits=runtime||DEFAULTS[language]) {
    // Python keeps its isolated interpreter and imported packages warm. Every
    // execution gets fresh globals and the current data mount; JS uses a fresh worker.
    const generation=this.sessionGeneration.get(language)||0;
    const ses=session.fromPartition((this.namespace||'moyu-run')+'-'+language+'-'+generation);
    const csp="default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
    const allowed=new Set(['/index.html','/runner.mjs','/worker.mjs','/run-files.mjs','/clang-runtime.mjs','/sql-runtime.mjs','/lua-runtime.mjs',...(['javascript','python'].includes(language)?['/download']:[]),...(language==='python'?(runtime?.files||PY_FILES).map(f=>'/pyodide/'+f):[]),...(language==='clang'?CLANG_FILES.map(f=>'/clang/'+f):[]),...(language==='sql'?['/sql/sql-wasm.wasm']:[]),...(language==='lua'?['/lua/glue.wasm']:[])]);
    if(['csharp','java','ruby','bash'].includes(language)){allowed.add('/'+language+'-runtime.mjs');for(const name of Object.keys(runtime.files||{}))allowed.add('/'+name);}
    ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false)); ses.setPermissionCheckHandler(()=>false);
    ses.webRequest.onBeforeRequest((details,cb)=>{
      try { const u=new URL(details.url); cb({cancel:u.protocol!=='moyu-run:'||u.host!=='sandbox'||!allowed.has(u.pathname)}); } catch {cb({cancel:true});}
    });
    ses.protocol.handle('moyu-run',async request=>{
      const u=new URL(request.url);
      if(u.host!=='sandbox'||!allowed.has(u.pathname)||request.method!=='GET')return new Response('Forbidden',{status:403});
      const headers={'Content-Security-Policy':csp,'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'};
      if(u.pathname==='/download'){
        try{const bytes=await downloadRuntimeFile(u.searchParams.get('url'));return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream'}});
        }catch(e){return new Response(e.message,{status:400,headers});}
      }
      if(u.pathname==='/index.html') return new Response('<!doctype html><script type="module" src="/runner.mjs"></script>',{headers:{...headers,'Content-Type':'text/html'}});
      const target=runtime?.directory && language!=='python' && (u.pathname.startsWith('/'+language+'/')||u.pathname==='/'+language+'-runtime.mjs')?path.join(runtime.directory,u.pathname.slice(1)):u.pathname.startsWith('/pyodide/')?path.join(runtime?.directory||path.join(__dirname,'../resources/pyodide'),path.basename(u.pathname)):path.join(__dirname,'runner',path.basename(u.pathname));
      return runtimeFileResponse(target,{...headers,'Cache-Control':'private, max-age=3600','Content-Type':/\.m?js$/.test(u.pathname)?'text/javascript':u.pathname.endsWith('.wasm')?'application/wasm':u.pathname.endsWith('.json')?'application/json':'application/octet-stream'},request.signal);
    });
    const win=new BrowserWindow({show:false,width:160,height:100,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webSecurity:true,spellcheck:false,devTools:false,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    const preparationMs=(limits?.preparationTimeoutSeconds||60)*1000;let outerTimer;
    const aborted=new Promise((_,reject)=>{
      win.once('closed',()=>reject(new Error('代码运行已停止。')));
      win.webContents.once('render-process-gone',()=>reject(new Error('运行沙箱已退出。')));
      outerTimer=setTimeout(()=>{win.destroy();reject(new Error('运行环境启动超时。'));},preparationMs);
    });
    const ready=Promise.race([(async()=>{await win.loadURL('moyu-run://sandbox/index.html');await win.webContents.executeJavaScript(`window.prepareCode(${JSON.stringify({language,code,preparationMs})})`);clearTimeout(outerTimer);})(),aborted]);
    let disposed=false;
    const env={win,ready,aborted,expiry:null,prepared:new Set(code?[code]:[]),preload:(code,preparationMs)=>win.webContents.executeJavaScript(`window.preloadCode(${JSON.stringify({code,preparationMs})})`),restart:async code=>{
      let timer;
      try{return await Promise.race([
        (async()=>{if(language==='javascript')await ses.clearStorageData();return win.webContents.executeJavaScript(`window.prepareCode(${JSON.stringify({language,code,preparationMs})})`);})(),
        aborted,
        new Promise((_,reject)=>{timer=setTimeout(()=>{win.destroy();reject(new Error('运行环境准备超时。'));},preparationMs);}),
      ]);}finally{clearTimeout(timer);}
    },dispose:()=>{if(disposed)return this.disposing.get(language);disposed=true;clearTimeout(outerTimer);clearTimeout(env.expiry);if(!win.isDestroyed())win.destroy();ses.protocol.unhandle('moyu-run');const cleanup=Promise.all([ses.clearStorageData(),ses.clearCache()]);
      // Chromium cleanup can remain pending after a sandbox is terminated.
      // Do not reuse that session or block cancellation and future runs.
      const task=new Promise(resolve=>{
        const expired=()=>{if((this.sessionGeneration.get(language)||0)===generation)this.sessionGeneration.set(language,generation+1);resolve();};
        const timer=setTimeout(expired,2000);
        cleanup.then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);expired();});
      });
      this.disposing.set(language,task);return task;}};
    return env;
  }
  async run(input) {
    if(this.running)throw new Error('请先停止当前代码块。');
    const args=require('../shared/runtime-arguments.mjs').argumentsFor(input.language,input.arguments);
    const started=performance.now(),language=String(input.language).toLowerCase(),kind=this.kind(language);
    if(typeof input.code!=='string'||Buffer.byteLength(input.code)>200000)throw new Error('代码语言或大小无效。');
    this.running=true;const ticket=this.epoch;let env,completed=false,code=input.code;
    try {
      const limits={...await this.config(kind),arguments:args};
      code=kind==='javascript'&&this.dependencies?await this.dependencies.bundle(input.code,language):/^(ts|typescript)$/.test(language)?stripTypeScriptTypes(input.code,{mode:'transform'}):input.code;
      if(kind==='javascript'&&input.mode==='dom'){
        const html=require('./html-results.cjs').htmlDocument({code,files:input.files||[],executionMs:limits.executionTimeoutSeconds*1000});
        return {output:'',error:'',artifacts:[{kind:'html',name:'result.html',mime:'text/html',sandboxDocument:true,data:Buffer.from(html).toString('base64')}],executionMs:0,startupMs:performance.now()-started,elapsed:performance.now()-started};
      }
      await this.prepare({language:kind,code},limits);if(this.closing||ticket!==this.epoch)throw new Error('代码运行已停止。');
      env=this.idle.get(kind);if(!env)throw new Error('运行环境不可用。');this.idle.delete(kind);clearTimeout(env.expiry);this.active=env.win;this.activeKind=kind;
      await env.ready;
      const startupMs=performance.now()-started;
      const result=await Promise.race([env.win.webContents.executeJavaScript(`window.runCode(${JSON.stringify({language,code,arguments:args,clangSettings:kind==='clang'?limits:undefined,runtimeSettings:['sql','lua','csharp','java','ruby','bash'].includes(kind)?limits:undefined,scope:input.scope,project:input.project,files:input.files||[],executionMs:limits.executionTimeoutSeconds*1000,preparationMs:limits.preparationTimeoutSeconds*1000})})`),env.aborted]);
      completed=true;
      return {...result,executionMs:result.elapsed||0,startupMs:startupMs+(result.packageMs||0),elapsed:performance.now()-started};
    } finally {
      if(this.active===env?.win)this.active=null;this.activeKind=null;this.running=false;
      if(env&&completed&&!this.closing&&ticket===this.epoch&&!env.win.isDestroyed()){
        // A fresh worker is prepared only when the next run requests it. Do
        // not allocate a second environment immediately after completion.
        if(kind==='csharp'){
          // Roslyn needs a fresh worker for isolation. Keep its existing
          // prewarm so consecutive compilations do not reload on the critical path.
          env.ready=env.restart(code).catch(async error=>{if(this.idle.get(kind)===env)this.idle.delete(kind);await env.dispose();throw error;});env.ready.catch(()=>{});
        }else env.needsPrepare=true;
        this.idle.set(kind,env);this.keepIdle(kind,env);
      }else if(env)await env.dispose();
    }
  }
}
module.exports={CodeRunner,PY_FILES};
