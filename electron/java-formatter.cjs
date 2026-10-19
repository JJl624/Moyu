const fs=require('node:fs/promises'),path=require('node:path');
const {atomic}=require('./files.cjs');
const builds=new Map(),windows=new Set();
async function build(directory) {
  const entry=path.join(directory,'format-browser-entry.mjs');
  try {
    await fs.writeFile(entry,'import * as prettier from "./node_modules/prettier/standalone.mjs";import java from "./formatter/dist/index.js";export const format=(code,options)=>prettier.format(code,{...options,parser:"java",plugins:[java]});');
    const root=await fs.realpath(directory);
    const output=await require('esbuild').build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',target:'chrome144',minify:true,write:false,logLevel:'silent',plugins:[{name:'formatter-files',setup(builder){builder.onLoad({filter:/.*/},async args=>{const file=await fs.realpath(args.path);if(!file.startsWith(root+path.sep))throw Error('格式化插件不能读取环境目录以外的文件。');});}}]});
    await atomic(path.join(directory,'formatter-browser.mjs'),output.outputFiles[0].contents);
  } finally { await fs.unlink(entry).catch(()=>{}); }
}
async function ensure(directory) {
  if(await fs.stat(path.join(directory,'formatter-browser.mjs')).catch(()=>null))return;
  if(builds.has(directory))return builds.get(directory);
  const task=build(directory);builds.set(directory,task);
  try {await task;}finally{builds.delete(directory);}
}
async function format(input) {
  if(!input.formatterDirectory)throw Error('请先安装 Java 运行环境。');
  const allowed=['printWidth','tabWidth','useTabs','trailingComma','endOfLine','entrypoint','experimentalOperatorPosition'];
  if(Object.keys(input.pluginConfig).some(key=>!allowed.includes(key)))throw Error('Java 格式化选项不受支持。');
  await ensure(input.formatterDirectory);
  const {BrowserWindow,session}=require('electron');
  const ses=session.fromPartition('moyu-format-'+require('node:crypto').randomUUID());
  const csp="default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
  ses.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!['moyu-run://formatter/index.html','moyu-run://formatter/formatter.mjs'].includes(details.url)}));
  ses.protocol.handle('moyu-run',async request=>{
    if(request.method!=='GET')return new Response('Forbidden',{status:403});
    const headers={'Content-Security-Policy':csp,'Cache-Control':'no-store'};
    if(request.url==='moyu-run://formatter/index.html')return new Response('<!doctype html>',{headers:{...headers,'Content-Type':'text/html'}});
    if(request.url==='moyu-run://formatter/formatter.mjs')return new Response(await fs.readFile(path.join(input.formatterDirectory,'formatter-browser.mjs')),{headers:{...headers,'Content-Type':'text/javascript'}});
    return new Response('Forbidden',{status:403});
  });
  const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webSecurity:true,devTools:false,backgroundThrottling:false}});
  windows.add(win);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  let timer;
  const interrupted=new Promise((_,reject)=>{win.once('closed',()=>reject(Error('Java 格式化已停止。')));win.webContents.once('render-process-gone',()=>reject(Error('Java 格式化沙箱已退出。')));timer=setTimeout(()=>{reject(Error('格式化超过 10 秒，已停止。'));if(!win.isDestroyed())win.destroy();},10000);});
  try {
    const options={printWidth:input.config.lineWidth,tabWidth:input.config.indentWidth,useTabs:input.config.useTabs,endOfLine:input.config.newLineKind==='crlf'?'crlf':'lf',...input.pluginConfig};
    return await Promise.race([(async()=>{await win.loadURL('moyu-run://formatter/index.html');return win.webContents.executeJavaScript(`import('/formatter.mjs').then(module=>module.format(${JSON.stringify(input.code)},${JSON.stringify(options)}))`);})(),interrupted]).then(code=>code.replace(/\r?\n$/,''));
  } finally {clearTimeout(timer);windows.delete(win);if(!win.isDestroyed())win.destroy();ses.protocol.unhandle('moyu-run');void ses.clearStorageData().catch(()=>{});void ses.clearCache().catch(()=>{});}
}
function close(){for(const win of windows)if(!win.isDestroyed())win.destroy();windows.clear();}
module.exports={build,ensure,format,close};
