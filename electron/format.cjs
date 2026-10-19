const { formatterLanguages } = require('../shared/code-languages.mjs');
const {Worker}=require('node:worker_threads'),path=require('node:path');
let worker,idle,nextId=0;const pending=new Map();
function closeFormatter(error=new Error('格式化已停止。')){require('./java-formatter.cjs').close();clearTimeout(idle);const old=worker;worker=null;void old?.terminate();for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();}
function formatCode(input){
  if(typeof input.code!=='string'||Buffer.byteLength(input.code)>200000||!formatterLanguages.includes(input.language))return Promise.reject(new Error('代码语言或大小无效。'));
  const json=(value,depth=0)=>depth<=4&&(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=1000||typeof value==='number'&&Number.isFinite(value)||Array.isArray(value)&&value.length<=200&&value.every(v=>json(v,depth+1))||value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=350&&Object.entries(value).every(([key,v])=>key.length<=150&&json(v,depth+1)));
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&json(value);
  if(!plain(input.config)||!plain(input.pluginConfig)||JSON.stringify([input.config,input.pluginConfig]).length>30000)return Promise.reject(new Error('格式化配置必须是有效的 JSON 选项对象。'));
  const c=input.config;if(Object.keys(c).some(k=>!['lineWidth','indentWidth','useTabs','newLineKind'].includes(k))||c.lineWidth!==undefined&&(!Number.isInteger(c.lineWidth)||c.lineWidth<1||c.lineWidth>1000)||c.indentWidth!==undefined&&(!Number.isInteger(c.indentWidth)||c.indentWidth<1||c.indentWidth>16)||c.useTabs!==undefined&&typeof c.useTabs!=='boolean'||c.newLineKind!==undefined&&!['lf','crlf','auto','system'].includes(c.newLineKind))return Promise.reject(new Error('dprint global 配置无效。'));
  if(input.language==='java')return require('./java-formatter.cjs').format(input);
  clearTimeout(idle);
  if(!worker){
    const created=new Worker(path.join(__dirname,'format-worker.cjs'));worker=created;
    const fail=error=>{if(worker===created)closeFormatter(error);};
    created.on('error',fail);created.on('exit',code=>{if(code!==0)fail(new Error('格式化线程已退出。'));});
    created.on('message',message=>{if(worker!==created)return;const request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);if(message.error)request.reject(new Error(message.error));else request.resolve(message.code);if(!pending.size){idle=setTimeout(closeFormatter,60000);idle.unref();}});created.unref();
  }
  return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>closeFormatter(new Error('格式化超过 10 秒，已停止。')),10000);pending.set(id,{resolve,reject,timer});worker.postMessage({...input,id});});
}
module.exports={formatCode,closeFormatter};
