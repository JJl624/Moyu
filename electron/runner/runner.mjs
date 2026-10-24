let worker, ready, resolveReady, rejectReady, resolveResult,resolvePackages,persistent=false;
const modules=new Map();
let terminalOutput='';
window.takeTerminalOutput=()=>{const output=terminalOutput;terminalOutput='';return output;};
window.prepareTerminal=async input=>{await ready;return new Promise((resolve,reject)=>{resolvePackages=result=>{resolvePackages=null;result.error?reject(Error(result.error)):resolve();};worker.postMessage({type:'terminal-open',settings:input});});};
window.runTerminal=code=>new Promise(resolve=>{resolveResult=result=>{resolveResult=null;resolve(result);};worker.postMessage({type:'terminal-run',code});});
function artifacts(input){let size=0;const out=[];for(const item of Array.isArray(input)?input.slice(0,20):[]){if(!item||typeof item.name!=='string')continue;const name=item.name.slice(0,200);if(item.kind==='table'&&Array.isArray(item.columns)&&Array.isArray(item.rows)){const columns=item.columns.slice(0,100).map(c=>String(c).slice(0,1000)),rows=item.rows.slice(0,1000).map(row=>(Array.isArray(row)?row:[]).slice(0,100).map(cell=>String(cell).slice(0,2000)));const bytes=JSON.stringify(rows).length;if(size+bytes>40*1024*1024)continue;size+=bytes;out.push({kind:'table',name,columns,rows,truncated:!!item.truncated||item.rows.length>1000});}else if(['image','file','html'].includes(item.kind)&&typeof item.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)){out.push({kind:item.kind,name,data:item.data,mime:item.kind==='html'?'text/html':['image/png','image/svg+xml','image/jpeg','image/webp'].includes(item.mime)?item.mime:'application/octet-stream'});}}return out;}
window.prepareCode = input => {
  if(ready)return ready;
  persistent=['python','py','clang','sql','java'].includes(input.language);
  worker = new Worker(input.language==='clang'?'/clang-runtime.mjs':input.language==='sql'?'/sql-runtime.mjs':input.language==='lua'?'/lua-runtime.mjs':input.language==='csharp'?'/csharp-runtime.mjs':input.language==='java'?'/java-runtime.mjs':input.language==='ruby'?'/ruby-runtime.mjs':input.language==='bash'?'/bash-runtime.mjs':'/worker.mjs', {type:'module'});
  ready = new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;worker.onerror=event=>reject(new Error(event.message||'运行环境准备失败。'));});
  worker.onmessage = event => {if(event.data.type==='terminal-output')terminalOutput=(terminalOutput+String(event.data.output||'')).slice(-65536);else if(event.data.type==='ready')resolveReady();else if(event.data.type==='packages')resolvePackages?.(event.data);else if(event.data.type==='result'){if(resolveResult)resolveResult(event.data);else rejectReady(new Error(event.data.error||'运行环境准备失败。'));}};
  const currentWorker=worker;
  void(async()=>{let module;if(['ruby','bash'].includes(input.language)){const url=input.language==='ruby'?'/ruby/ruby+stdlib.wasm':'/bash/bashkit_wasm_bg.wasm';if(!modules.has(url))modules.set(url,WebAssembly.compileStreaming(fetch(url)).catch(error=>{modules.delete(url);throw error;}));module=await modules.get(url);}if(worker===currentWorker)currentWorker.postMessage({type:'init',language:input.language,code:input.code||'',module});})().catch(error=>rejectReady(error));
  return ready;
};
window.preloadCode=async input=>{
  await ready;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{resolvePackages=null;reject(new Error('本地包准备超时。'));},input.preparationMs||60000);
    resolvePackages=result=>{clearTimeout(timeout);resolvePackages=null;result.error?reject(new Error(result.error)):resolve();};
    worker.postMessage({type:'packages',code:input.code,files:[]});
  });
};
window.runCode = input => new Promise(resolve => {
  let timer, finished = false,packageStarted=performance.now(),packageMs=0;
  const finish = (result,reuse=persistent) => { if(finished)return;finished=true;clearTimeout(timer);if(!reuse){worker.terminate();ready=null;}resolveResult=null;resolvePackages=null;resolve({...result,packageMs}); };
  worker.onerror = event => finish({output:'',error:event.message || '沙箱执行失败。'},false);
  resolveResult = data => finish({output:String(data.output||'').slice(0,65536),artifacts:artifacts(data.artifacts),dataFiles:data.dataFiles,error:data.error?String(data.error).slice(0,8192):'',elapsed:Number(data.elapsed)||0},persistent&&!data.recycle);
  resolvePackages=result=>{
    packageMs=performance.now()-packageStarted;clearTimeout(timer);
    if(result.error){finish({output:'',error:result.error,elapsed:0},false);return;}
    timer=setTimeout(()=>finish({output:'',error:`超过 ${(input.executionMs||10000)/1000} 秒，代码已停止。`,elapsed:input.executionMs||10000},false),input.executionMs||10000);
    worker.postMessage({type:'run',language:input.language,code:input.code,arguments:input.arguments||[],scope:input.scope,files:input.files||[]});
  };
  timer=setTimeout(()=>finish({output:'',error:`本地包准备超过 ${(input.preparationMs||60000)/1000} 秒，已停止。`,elapsed:0},false),input.preparationMs||60000);
  worker.postMessage({type:'packages',language:input.language,code:input.code,arguments:input.arguments||[],clangSettings:input.clangSettings,runtimeSettings:input.runtimeSettings,project:input.project,files:input.files||[]});
});
