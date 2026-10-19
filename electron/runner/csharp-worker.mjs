import {mountData,collectData,fileArtifacts} from './file-runtime.mjs';
let runtime,bridge,settings,assembly,FS,counter=0,stdin=[],stdinAt=0;
function findBridge(value){if(typeof value?.CompileAsync==='function'&&typeof value?.Run==='function')return value;for(const item of Object.values(value||{}))if(item&&typeof item==='object'){const found=findBridge(item);if(found)return found;}}
const diagnostics=items=>(items||[]).filter(d=>d.severity?.toLowerCase()==='error'||d.severity===2).map(d=>[d.file||d.fileName,d.line||d.lineNumber,d.message].filter(Boolean).join(': ')).join('\n');
// .NET distinguishes sidecar Workers from pthread Workers by onmessage.
// Register a listener without assigning WorkerGlobalScope.onmessage.
self.addEventListener('message',async({data:input})=>{
  let started;
  try{
    if(input.type==='init'){
      const {dotnet}=await import(new URL('/csharp/_framework/dotnet.js',self.location.href).href);
      runtime=await dotnet.withDiagnosticTracing(false).withModuleConfig({stdin:()=>stdinAt<stdin.length?stdin[stdinAt++]:null}).create();
      const nativeFS=runtime.Module.FS;
      FS=new Proxy(nativeFS,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return(...args)=>{try{return value.apply(target,args);}catch(e){if(e.errno===44)e.code='ENOENT';throw e;}};}});
      bridge=findBridge(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName));if(!bridge)throw Error('Roslyn 编译器未就绪。');
      self.postMessage({type:'ready'});return;
    }
    if(input.type==='packages'){
      settings=input.runtimeSettings;mountData(FS,input.files);try{stdin=settings.stdinFile?FS.readFile('/data/'+settings.stdinFile):[];}catch{stdin=[];}
      const sources=[{path:'MoyuProgram.cs',text:settings.usings.map(name=>'using '+name+';').join('\n')+'\n'+input.code}];
      if(settings.multiFile)for(const file of input.files||[])if(/\.cs$/i.test(file.name)&&!file.name.startsWith('output/'))sources.push({path:file.name,text:new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(file.data),c=>c.charCodeAt(0)))});
      if(sources.length>32||sources.reduce((n,s)=>n+s.text.length,0)>8*1024*1024)throw Error('编译源文件最多 32 个、共 8 MB。');
      sources.push({path:'MoyuConsoleGuard.cs',text:`internal static class MoyuConsoleGuard {
        [System.Runtime.CompilerServices.ModuleInitializer] public static void Initialize() { System.Console.SetOut(new BoundedWriter(System.Console.Out)); System.Console.SetError(new BoundedWriter(System.Console.Error)); ${settings.stdinFile?'System.Console.SetIn(new System.IO.StringReader(System.IO.File.Exists("'+settings.stdinFile+'")?System.IO.File.ReadAllText("'+settings.stdinFile+'"):""));':''} }
        sealed class BoundedWriter : System.IO.TextWriter { readonly System.IO.TextWriter target;int size; public BoundedWriter(System.IO.TextWriter target){this.target=target;}public override System.Text.Encoding Encoding=>target.Encoding;public override void Write(char value){if(++size>65536)throw new System.InvalidOperationException("输出超过 64 KB，已停止。");target.Write(value);}public override void Write(string value){if(value!=null)foreach(char c in value)Write(c);} }
      }`});
      assembly=JSON.parse(await bridge.CompileAsync(JSON.stringify({sources,assemblyName:'Moyu_'+(++counter),outputKind:'console',emitPdb:false,optimization:'release'})));
      if(!assembly.success)throw Error(diagnostics(assembly.diagnostics)||JSON.stringify(assembly.error||assembly.diagnostics));
      self.postMessage({type:'packages'});return;
    }
    if(input.type!=='run')return;
    started=performance.now();stdinAt=0;
    const result=JSON.parse(await bridge.Run(assembly.peBase64,JSON.stringify(settings.arguments)));
    const files=collectData(FS);
    self.postMessage({type:'result',output:String(result.stdout||'').slice(0,65536),error:result.success===false?String(result.error?.message||result.error||result.stderr||'执行失败。'):String(result.stderr||''),artifacts:fileArtifacts(files),dataFiles:files,elapsed:performance.now()-started});
  }catch(e){self.postMessage({type:input.type==='packages'?'packages':'result',output:'',error:String(e.message||e.code||e),elapsed:started?performance.now()-started:0});}
  finally{if(started){assembly=null;try{mountData(FS,[]);}catch{}}}
});
