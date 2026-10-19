import {RubyVM} from '@ruby/wasm-wasi';
import {WASI,File,OpenFile,Directory,PreopenDirectory,ConsoleStdout} from '@bjorn3/browser_wasi_shim';
import {nameOf,decode,encode} from './run-files.mjs';
import {fileArtifacts} from './file-runtime.mjs';
let module,vm,tree,output='',errorOutput='',code;
const entry='.moyu-code.rb';
function collect(dir,prefix='',result=[],depth=0){
  if(depth>12)throw Error('数据目录层级过深。');
  for(const [name,node]of dir.contents){if(!prefix&&name===entry)continue;const logical=nameOf(prefix+name);if(node instanceof Directory)collect(node,logical+'/',result,depth+1);else{if(node.data.length>20*1024*1024||result.length>=128||result.reduce((n,f)=>n+f.data.length*.75,0)+node.data.length>40*1024*1024)throw Error('代码数据超过限制。');result.push({name:logical,data:encode(node.data)});}}
  return result;
}
self.onmessage=async({data:input})=>{
  let started;
  try{
    if(input.type==='init'){module=input.module||await WebAssembly.compileStreaming(fetch('/ruby/ruby+stdlib.wasm'));self.postMessage({type:'ready'});return;}
    if(input.type==='packages'){
      code=input.code;output='';errorOutput='';tree=new Directory(new Map([['output',new Directory(new Map())]]));
      for(const file of input.files||[]){const parts=nameOf(file.name).split('/');let at=tree;for(const part of parts.slice(0,-1)){if(!at.contents.has(part))at.contents.set(part,new Directory(new Map()));at=at.contents.get(part);if(!(at instanceof Directory))throw Error('文件路径与目录冲突。');}at.contents.set(parts.at(-1),new File(decode(file.data)));}
      tree.contents.set(entry,new File(new TextEncoder().encode(code)));
      const stdin=(input.files||[]).find(f=>f.name===input.runtimeSettings.stdinFile),root=new Map([['data',tree],['tmp',new Directory(new Map())]]),decoders=[new TextDecoder(),new TextDecoder()];let size=0;
      const write=index=>bytes=>{if((size+=bytes.length)>65536)throw Error('输出超过 64 KB，已停止。');const text=decoders[index].decode(bytes,{stream:true});if(index)errorOutput+=text;else output+=text;};
      const wasi=new WASI([],[],[new OpenFile(new File(stdin?decode(stdin.data):[])),new ConsoleStdout(write(0)),new ConsoleStdout(write(1)),new PreopenDirectory('/',root)],{debug:false});
      ({vm}=await RubyVM.instantiateModule({module,wasip1:wasi,args:['ruby.wasm','-EUTF-8','-e_=0','--',...input.runtimeSettings.arguments]}));vm.eval('Dir.chdir("/data"); $stdout.sync = true; $stderr.sync = true');self.postMessage({type:'packages'});return;
    }
    if(input.type!=='run')return;started=performance.now();vm.eval('load "/data/'+entry+'"');const files=collect(tree);self.postMessage({type:'result',output,error:errorOutput,artifacts:fileArtifacts(files),dataFiles:files,elapsed:performance.now()-started});
  }catch(e){self.postMessage({type:input.type==='packages'?'packages':'result',output,error:[errorOutput,String(e.message||e)].filter(Boolean).join('\n'),elapsed:started?performance.now()-started:0});}
  finally{if(started){vm=null;tree=null;code=null;}}
};
