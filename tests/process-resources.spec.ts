import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function fixture(){
 const data=await fs.mkdtemp(path.join(work,'process-resources-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow();
 await expect(page.locator('.ProseMirror')).toBeVisible({timeout:30000});
 await(await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
 const feature=async(action:string,input:Record<string,unknown>={})=>{const result:any=await page.evaluate(({action,input})=>window.moyu!.feature(action,input),{action,input});expect(result.ok,JSON.stringify(result)).toBe(true);return result.data;};
 const snapshot=()=>app.evaluate(({app,BrowserWindow})=>{const processes=app.getAppMetrics();return{privateMiB:processes.reduce((n,p)=>n+(p.memory.privateBytes??p.memory.workingSetSize)/1024,0),processes:processes.length,sandboxes:BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('moyu-run:')).length};});
 const release=()=>feature('code.release-idle',{root:path.join(data,'示例知识库'),keep:[]});
 return{app,page,feature,snapshot,release};
}
test('Repeated C++ runs reuse one sandbox with bounded memory and release its process',async()=>{
 test.setTimeout(120000);const{app,page,feature,snapshot,release}=await fixture();
 try{
  const before=await snapshot(),code='std::cout << 42 << std::endl;';
  await page.evaluate(code=>window.moyu!.create('C++资源.md','file','```cpp {id=0001}\n'+code+'\n```'),code);
  const samples=[];
  for(let i=0;i<5;i++){
   const result=await feature('code.run',{document:'C++资源.md',language:'cpp',id:'0001',code});expect(result.error).toBe('');expect(result.output).toContain('42');
   const sample=await snapshot();expect(sample.sandboxes).toBe(1);samples.push(sample);
  }
  expect(samples.at(-1)!.privateMiB-samples[0].privateMiB).toBeLessThan(128);
  await release();await expect.poll(async()=>(await snapshot()).sandboxes).toBe(0);
  await expect.poll(async()=>(await snapshot()).processes,{timeout:10000}).toBeLessThanOrEqual(before.processes+1);
  console.log(JSON.stringify({kind:'cpp',before,runs:samples,after:await snapshot()}));
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Repeated HTML results and host/Wasm terminals leave no live frames or terminal sessions',async()=>{
 test.setTimeout(180000);const{app,page,feature,snapshot,release}=await fixture();
 try{
  const before=await snapshot(),code='displayHTML("<button>42</button>");';
  await page.evaluate(code=>window.moyu!.create('HTML资源.md','file',[1,2,3].map(i=>'```js {id='+String(i).padStart(4,'0')+'}\n'+code+'\n```').join('\n\n')),code);
  const samples=[];
  for(let cycle=0;cycle<8;cycle++){
   await page.locator('.tree-item[title="HTML资源.md"]').dblclick();
   for(let i=0;i<3;i++){await page.getByLabel('JavaScript 运行模式',{exact:true}).nth(i).selectOption('dom');await page.getByRole('button',{name:'运行代码块',exact:true}).nth(i).click();await expect(page.locator('.html-result iframe')).toHaveCount(i+1);}
   await page.getByRole('button',{name:'关闭 HTML资源',exact:true}).click();await expect(page.locator('.html-result iframe')).toHaveCount(0);
   await expect.poll(()=>page.frames().length).toBe(1);await release();await expect.poll(async()=>(await snapshot()).sandboxes).toBe(0);await page.waitForTimeout(250);samples.push(await snapshot());
  }
  // Renderer exit and V8 idle collection are asynchronous. Keep transient
  // samples, then check retained process memory after an actual idle period.
  await expect.poll(async()=>(await snapshot()).processes,{timeout:30000,intervals:[250,500,1000]}).toBeLessThanOrEqual(before.processes+2);
  const settled=await snapshot(),warm=samples[2];
  console.log(JSON.stringify({kind:'html-idle',before,samples,settled}));
  expect(settled.privateMiB-warm.privateMiB).toBeLessThan(128);
  expect(settled.processes).toBeLessThanOrEqual(warm.processes+1);
  const host=await feature('terminal.open'),wasm=await feature('terminal.open',{shell:'moyu:bash-wasm'});
  await feature('terminal.write',{id:host.id,data:'echo 42\r'});await feature('terminal.write',{id:wasm.id,data:'echo 42\r'});
  await expect.poll(async()=>(await feature('terminal.snapshot',{id:wasm.id})).output).toContain('42');
  await feature('terminal.close-all');await expect.poll(()=>feature('terminal.list')).toHaveLength(0);await expect.poll(async()=>(await snapshot()).sandboxes).toBe(0);
  await expect.poll(()=>{try{process.kill(host.pid,0);return false;}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH';}},{timeout:10000}).toBe(true);
  console.log(JSON.stringify({kind:'html-and-terminals',samples,after:await snapshot()}));
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
