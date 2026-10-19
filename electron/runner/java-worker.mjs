import source from '../managed-source.cjs';
import {decode} from './run-files.mjs';
let load,compiler,settings,program,errors=[];
self.onmessage=async({data:input})=>{
  let started,output='';
  try{
    if(input.type==='init'){
      ({load}=await import(new URL('/java/compiler.wasm-runtime.js',self.location.href).href));
      const library=await load('moyu-run://sandbox/java/compiler.wasm',{stackDeobfuscator:{enabled:false}});compiler=library.exports.createCompiler();
      compiler.setSdk(new Int8Array(await(await fetch('/java/compile-classlib-teavm.bin')).arrayBuffer()));compiler.setTeaVMClasslib(new Int8Array(await(await fetch('/java/runtime-classlib-teavm.bin')).arrayBuffer()));
      compiler.onDiagnostic(d=>{if(d.severity==='error')errors.push([d.fileName,d.lineNumber,d.message].filter(Boolean).join(': '));});self.postMessage({type:'ready'});return;
    }
    if(input.type==='packages'){
      settings=input.runtimeSettings;errors=[];compiler.clearSourceFiles();compiler.clearOutputFiles();compiler.clearInputClassFiles();
      const entry=source.javaSource(input.code,settings);compiler.addSourceFile(entry.path,entry.code);
      let count=1,total=entry.code.length;
      if(settings.multiFile)for(const file of input.files||[])if(/\.java$/i.test(file.name)&&!file.name.startsWith('output/')){if(++count>32||(total+=file.data.length)>8*1024*1024)throw Error('编译源文件最多 32 个、共 8 MB。');compiler.addSourceFile(file.name,new TextDecoder('utf-8',{fatal:true}).decode(decode(file.data)));}
      if(!compiler.compile())throw Error(errors.join('\n')||'Java 编译失败。');
      const mains=compiler.detectMainClasses(),main=settings.mainClass||mains[0];if(!main||!mains.includes(main))throw Error('没有找到可执行的 main 方法。');
      if(!compiler.generateWebAssembly({outputName:'moyu',mainClass:main}))throw Error(errors.join('\n')||'TeaVM 编译失败。');
      program=compiler.getWebAssemblyOutputFile('moyu.wasm');self.postMessage({type:'packages'});return;
    }
    if(input.type!=='run')return;
    started=performance.now();
    const write=char=>{if(output.length>=65536)throw Error('输出超过 64 KB，已停止。');output+=String.fromCharCode(char);};
    const app=await load(program,{stackDeobfuscator:{enabled:false},noAutoImports:true,installImports:imports=>{imports.teavmConsole={putcharStdout:write,putcharStderr:write};}});
    app.exports.main(settings.arguments);self.postMessage({type:'result',output,artifacts:[],elapsed:performance.now()-started});
  }catch(e){self.postMessage({type:input.type==='packages'?'packages':'result',output,error:String(e.message||e),elapsed:started?performance.now()-started:0});}
  finally{if(started)program=null;}
};
