import {Bash} from '@everruns/bashkit-wasm';
let interpreter;
export function openTerminal(settings){
  interpreter?.free();
  interpreter=new Bash({profile:'hardened',cwd:'/data',env:{TERM:'xterm-256color'},timeoutMs:settings.executionTimeoutSeconds*1000,maxCommands:settings.maxCommands,maxLoopIterations:settings.maxLoopIterations,maxMemory:settings.memoryLimitMB*1024*1024});
  interpreter.mkdir('/data');
}
export async function executeTerminal(code){
  if(!interpreter)throw Error('Bash 终端未准备好。');
  try{interpreter.analyze(code);}catch(error){
    if(/unterminated|unclosed|empty (?:for|while|until) loop body|empty then clause|end of input|\bEof\b|expected command after \||expected ['"]?(?:done|fi|esac|[})])/i.test(error.message))return {incomplete:true};
    throw error;
  }
  const result=await interpreter.executeWithOutput(code,(stdout,stderr)=>self.postMessage({type:'terminal-output',output:stdout+stderr}));
  try{return {output:'',error:result.stdoutTruncated||result.stderrTruncated?'输出达到显示上限。':'',exitCode:result.exitCode};}finally{result.free();}
}
