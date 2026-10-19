import {initBashkit,Bash} from '@everruns/bashkit-wasm';
import {decode,encode,nameOf} from './run-files.mjs';
import {fileArtifacts} from './file-runtime.mjs';
import {openTerminal,executeTerminal} from './bash-terminal.mjs';
let bash,settings,code;
function collect(fs,directory='/data',prefix='',result=[],depth=0){
  if(depth>12)throw Error('数据目录层级过深。');
  for(const item of fs.ls(directory)){const name=item.split('/').filter(Boolean).at(-1),target=directory+'/'+name,logical=nameOf(prefix+name);let bytes;
    try{bytes=fs.readFileBytes(target);}catch(e){collect(fs,target,logical+'/',result,depth+1);continue;}
    if(bytes.length>20*1024*1024||result.length>=128||result.reduce((n,f)=>n+f.data.length*.75,0)+bytes.length>40*1024*1024)throw Error('代码数据超过限制。');result.push({name:logical,data:encode(bytes)});
  }return result;
}
self.onmessage=async({data:input})=>{
  let started;
  try{
    if(input.type==='init'){await initBashkit(input.module||new URL('/bash/bashkit_wasm_bg.wasm',self.location.href));self.postMessage({type:'ready'});return;}
    if(input.type==='terminal-open'){openTerminal(input.settings);self.postMessage({type:'packages'});return;}
    if(input.type==='terminal-run'){self.postMessage({type:'result',...await executeTerminal(input.code)});return;}
    if(input.type==='packages'){
      settings=input.runtimeSettings;code=input.code;const inputPath=(input.files||[]).some(f=>f.name===settings.stdinFile)?'/data/'+settings.stdinFile:'/moyu/stdin',env={MOYU_STDIN:inputPath};settings.arguments.forEach((value,index)=>env['MOYU_ARG_'+index]=value);
      bash=new Bash({profile:'hardened',cwd:'/data',env,timeoutMs:settings.executionTimeoutSeconds*1000,maxCommands:settings.maxCommands,maxLoopIterations:settings.maxLoopIterations,maxMemory:settings.memoryLimitMB*1024*1024});
      const fs=bash.fs();for(const directory of ['/data','/data/output','/moyu'])if(!fs.exists(directory))fs.mkdir(directory);
      for(const file of input.files||[]){const name=nameOf(file.name),parts=name.split('/');let target='/data';for(const part of parts.slice(0,-1)){target+='/'+part;if(!fs.exists(target))fs.mkdir(target);}fs.writeFileBytes('/data/'+name,decode(file.data));}
      fs.writeFile('/moyu/code.sh',code);if(!settings.stdinFile||!fs.exists('/data/'+settings.stdinFile))fs.writeFile('/moyu/stdin','');self.postMessage({type:'packages'});return;
    }
    if(input.type!=='run')return;started=performance.now();
    // Bashkit propagates redirected stdin through a compound command, while
    // a bare `source` currently drops it before evaluating the sourced script.
    const result=await bash.execute('(source /moyu/code.sh '+settings.arguments.map((_,index)=>'"$MOYU_ARG_'+index+'"').join(' ')+') < "$MOYU_STDIN"'),files=collect(bash.fs());
    self.postMessage({type:'result',output:result.stdout,error:[result.stderr,result.exitCode?'退出代码：'+result.exitCode:'',result.stdoutTruncated||result.stderrTruncated?'输出达到显示上限。':''].filter(Boolean).join('\n'),artifacts:fileArtifacts(files),dataFiles:files,elapsed:performance.now()-started});result.free();
  }catch(e){self.postMessage({type:['packages','terminal-open'].includes(input.type)?'packages':'result',output:'',error:String(e.message||e),elapsed:started?performance.now()-started:0});}
  finally{if(started){bash?.free();bash=null;code=null;}}
};
