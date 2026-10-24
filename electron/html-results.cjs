const crypto=require('node:crypto');
const htmlPolicy="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
function adoptHTML(markup){
  const page=new DOMParser().parseFromString(markup,'text/html');
  for(const [target,source] of [[document.documentElement,page.documentElement],[document.head,page.head],[document.body,page.body]]){
    for(const attr of [...target.attributes])target.removeAttribute(attr.name);
    for(const attr of source.attributes)target.setAttribute(attr.name,attr.value);
  }
  document.head.innerHTML=page.head.innerHTML;document.body.innerHTML=page.body.innerHTML;
  for(const old of [...document.querySelectorAll('script')]){const next=document.createElement('script');for(const attr of old.attributes)next.setAttribute(attr.name,attr.value);next.textContent=old.textContent;old.replaceWith(next);}
}
function htmlDocument({code,files=[],executionMs=10000}){
  const encoded=Buffer.from(code).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html{font:14px system-ui}body{margin:0}</style></head><body><script>
  (()=>{
    const send=(type,value)=>parent.postMessage({moyuHTML:true,type,value},'*');
    const format=v=>{try{return typeof v==='string'?v:JSON.stringify(v)??String(v);}catch{return String(v)}};
    let size=0,logBuffer='',logTimer;const flushLogs=()=>{clearTimeout(logTimer);logTimer=undefined;if(logBuffer){send('log',logBuffer);logBuffer='';}};for(const key of ['log','warn','error','info','debug'])console[key]=(...args)=>{const text=args.map(format).join(' ');if(size<65536){logBuffer+=text.slice(0,65536-size)+'\\n';size+=text.length+1;if(!logTimer)logTimer=setTimeout(flushLogs,16);}};
    addEventListener('error',e=>send('error',e.message));addEventListener('unhandledrejection',e=>send('error',String(e.reason?.stack||e.reason)));
    const data=new Map(${JSON.stringify(files).replaceAll('<','\\u003c')}.map(f=>[f.name,f.data]));
    const name=n=>{if(typeof n!=='string'||!n||n.length>200||n.includes('\\\\')||n.startsWith('/')||n.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('数据路径无效。');return n;};
    const decode=v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
    window.files=Object.freeze({root:'/data',list:async()=>[...data.keys()],readFile:async(n,encoding='utf8')=>{const v=data.get(name(n));if(v===undefined)throw Error('数据文件不存在。');const b=decode(v);return encoding==='utf8'?new TextDecoder().decode(b):b;},writeFile:async(n,v)=>{n=name(n);const bytes=typeof v==='string'?new TextEncoder().encode(v):new Uint8Array(v);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));data.set(n,btoa(text));send('files',[...data].map(([name,data])=>({name,data})));},remove:async n=>{data.delete(name(n));send('files',[...data].map(([name,data])=>({name,data})));}});
    window.displayHTML=html=>{html=String(html);if(/<!doctype|<html[\\s>]|<head[\\s>]|<body[\\s>]/i.test(html))(${adoptHTML.toString()})(html);else document.body.insertAdjacentHTML('beforeend',html);};
    let nextRequest=0;const requests=new Map();addEventListener('message',event=>{if(event.source!==parent||!event.data?.moyuHTML||event.data.type!=='download-result')return;const pending=requests.get(event.data.id);if(!pending)return;requests.delete(event.data.id);event.data.error?pending.reject(Error(event.data.error)):pending.resolve(decode(event.data.data));});
    window.fetch=async(url,options={})=>{const method=options.method||(url instanceof Request?url.method:'GET');url=String(url instanceof Request?url.url:url);if(method.toUpperCase()!=='GET')throw Error('仅支持读取公共 HTTP(S) 资源。');const bytes=await new Promise((resolve,reject)=>{const id=++nextRequest;requests.set(id,{resolve,reject});send('download',{id,url});});return new Response(bytes);};
    send('ready',${executionMs});
    new(Object.getPrototypeOf(async function(){}).constructor)(new TextDecoder().decode(decode('${encoded}')))().then(()=>{flushLogs();send('complete',true);},e=>{flushLogs();send('error',String(e?.stack||e));});
  })();</script></body></html>`;
}
class HTMLResults{
  constructor(store,options={}){this.store=store;this.options=options;this.contexts=new Map();this.views=new Map();store.onRelease=token=>{this.contexts.delete(token);this.closeViews(token);};}
  closeViews(token){for(const [id,view] of this.views)if(view.token===token)this.views.delete(id);}
  async open(token){
    const item=this.store.get(token),entry=this.contexts.get(token);if(item.kind!=='html'||!entry)throw Error('HTML 结果已关闭。');
    if(this.options.current&&entry.current!==this.options.current())throw Error('知识库已切换。');
    for(const view of this.views.values())if(view.token===token)await view.queue;
    const files=entry.input.document?await entry.current.entries(await entry.current.target(entry.input)):[];
    const encoded=(await this.store.read(token)).toString('utf8').match(/new TextDecoder\(\)\.decode\(decode\('([A-Za-z0-9+/=]*)'\)\)/)?.[1];
    if(!encoded)throw Error('HTML 结果无效，请重新运行代码。');
    const config=await this.options.config?.();
    const bytes=Buffer.from(htmlDocument({code:Buffer.from(encoded,'base64').toString('utf8'),files,executionMs:(config?.executionTimeoutSeconds||10)*1000}));
    if(!item.read)this.store.replaceBytes(token,bytes);this.closeViews(token);
    const id=crypto.randomUUID();this.views.set(id,{token,current:entry.current,input:entry.input,context:{...entry.context,files:files.map(({name,version})=>({name,version}))},bytes,queue:Promise.resolve(),downloads:0});
    return 'moyu-html://'+id+'/index.html';
  }
  view(token,id){this.store.get(token);const view=this.views.get(id);if(!view||view.token!==token||this.options.current&&view.current!==this.options.current())throw Error('HTML 页面已停止。');return view;}
  persist({token,view:id,files}){
    const view=this.view(token,id),task=view.queue.then(async()=>{this.view(token,id);const metadata=await view.current.persist(view.input,view.context,files);if(metadata)view.context.files=metadata;});view.queue=task.catch(()=>{});return task;
  }
  async download({token,view:id,url}){const view=this.view(token,id);if(view.downloads>=4)throw Error('同时读取的资源不能超过 4 个。');view.downloads++;try{return (await require('./runtime-download.cjs').downloadRuntimeFile(url)).toString('base64');}finally{view.downloads--;}}
  url(token){const item=this.store.get(token);if(item.kind!=='html')throw Error('HTML 结果无效。');return 'moyu-html://'+token+'/index.html';}
  response(request){try{const u=new URL(request.url);if(u.pathname!=='/index.html'||request.method!=='GET')throw Error();const view=this.views.get(u.hostname),item=this.store.get(view?.token||u.hostname);if(item.kind!=='html')throw Error();return new Response(view?.bytes||item.bytes,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':htmlPolicy,'Cache-Control':'no-store'}});}catch{return new Response('结果已关闭',{status:404});}}
  release(tokens){for(const token of tokens||[]){this.contexts.delete(token);this.closeViews(token);}}
}
module.exports={htmlDocument,HTMLResults,htmlPolicy};
// Adopt the original page structure, including its head, body attributes and scripts.
module.exports.htmlMarkupCode=markup=>`(${adoptHTML.toString()})(${JSON.stringify(markup)});`;
