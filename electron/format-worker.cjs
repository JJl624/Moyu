const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
const {createFromBuffer}=require('@dprint/formatter');
const plugins=new Map();
parentPort.on('message',async input=>{
  try{
    if(input.language==='java'){
      throw Error('Java 格式化必须在浏览器沙箱中执行。');
    }
    const python=/^(python|py)$/.test(input.language),clang=/^(c|cpp|c\+\+|cc|cxx)$/.test(input.language),sql=/^(sql|sqlite)$/.test(input.language),lua=input.language==='lua',name=python?'ruff':clang?'clang-format':sql?'sql':lua?'stylua':'typescript';
    const csharp=/^(cs|csharp|c#)$/.test(input.language),file=csharp?path.join(input.formatterDirectory,'formatter.wasm'):path.join(__dirname,'../resources/formatters',name+'.wasm');
    let formatter=plugins.get(file);if(!formatter){formatter=createFromBuffer(fs.readFileSync(file));plugins.set(file,formatter);}
    formatter.setConfig(input.config,input.pluginConfig);
    const diagnostics=formatter.getConfigDiagnostics();if(diagnostics.length)throw new Error(diagnostics.map(d=>d.propertyName+': '+d.message).join('\n'));
    const extension=csharp?'cs':python?'py':clang?(input.language==='c'?'c':'cpp'):sql?'sql':lua?'lua':/^(typescript|ts)$/.test(input.language)?'ts':'js';
    const code=formatter.formatText({filePath:'code.'+extension,fileText:input.code}).replace(/\r?\n$/,'');
    parentPort.postMessage({id:input.id,code});
  }catch(error){parentPort.postMessage({id:input.id,error:String(error?.message||error)});}
});
