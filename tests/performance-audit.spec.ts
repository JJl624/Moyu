import {_electron as electron, expect, test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
test('Dense code documents stay responsive and idle does not rewrite application data',async()=>{
  test.setTimeout(120000);
  const data=await fs.mkdtemp(path.resolve(project,'../../work/performance-audit-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const content='# 密集代码\n\n'+Array.from({length:80},(_,i)=>'段落 '+i+'\n\n```js {id='+i.toString(16).padStart(4,'0')+'}\n'+Array.from({length:8},(_,j)=>`const value${j} = ${i+j};`).join('\n')+'\n```\n\n').join('')+'末尾';
    await page.evaluate(content=>window.moyu!.create('密集代码.md','file',content),content);
    await page.locator('.tree-item[title="密集代码.md"]').dblclick();await expect(page.locator('.milkdown-code-block')).toHaveCount(80);
    await expect(page.locator('.code-actions')).toHaveCount(80);await page.waitForTimeout(2500);
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    await app.evaluate(()=>{const fs=process.getBuiltinModule('fs/promises');const writes:string[]=[];(globalThis as any).__auditWrites=writes;const write=fs.writeFile;fs.writeFile=async(...args:Parameters<typeof write>)=>{writes.push(String(args[0]));return write(...args);};const open=fs.open;fs.open=async(...args:Parameters<typeof open>)=>{const handle=await open(...args),writeFile=handle.writeFile.bind(handle),write=handle.write.bind(handle);handle.writeFile=async(...values:Parameters<typeof writeFile>)=>{writes.push(String(args[0]));return writeFile(...values);};handle.write=async(...values:Parameters<typeof write>)=>{writes.push(String(args[0]));return(write as any)(...values);};return handle;};});
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m:{name:string;value:number})=>[m.name,m.value]));
    await app.evaluate(({app})=>app.getAppMetrics());
    const before=await metrics();await page.waitForTimeout(3500);const idle=await metrics();
    const processes=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,CPUPercent:p.cpu.percentCPUUsage,workingSetMB:p.memory.workingSetSize/1024})));
    const idleWrites=await app.evaluate(()=>(globalThis as any).__auditWrites as string[]);expect(idleWrites).toEqual([]);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    await page.locator('.milkdown-code-block .cm-content').first().click();
    const latencies:number[]=[];const begin=Date.now();
    for(let i=0;i<35;i++){
      const t=Date.now();await page.keyboard.press(i%2?'ArrowRight':'ArrowLeft');
      await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>r())));latencies.push(Date.now()-t);
    }
    for(let i=0;i<10;i++)await page.mouse.wheel(0,i<5?480:-480);
    const active=await metrics(),profile=await cdp.send('Profiler.stop');
    await cdp.send('HeapProfiler.collectGarbage');const heap=await metrics();
    const total=profile.profile.samples?.length||1,times=new Map<number,number>();for(const id of profile.profile.samples||[])times.set(id,(times.get(id)||0)+1);
    const hotspots=profile.profile.nodes.map((n:any)=>({name:n.callFrame.functionName,url:path.basename(n.callFrame.url),percent:(times.get(n.id)||0)*100/total})).filter((n:any)=>n.percent>0.5).sort((a:any,b:any)=>b.percent-a.percent).slice(0,15);
    const report={idleCPUSeconds:idle.TaskDuration-before.TaskDuration,processes,idleWrites,idleLayouts:idle.LayoutCount-before.LayoutCount,interactionCPUSeconds:active.TaskDuration-idle.TaskDuration,wallMs:Date.now()-begin,medianKeyMs:latencies.sort((a,b)=>a-b)[17],p95KeyMs:latencies[33],retainedHeapMB:heap.JSHeapUsedSize/1048576,hotspots};
    await page.evaluate(()=>window.moyu!.create('短文.md','file','# 短文\n\n内容'));
    for(let i=0;i<6;i++){
      await page.locator('.tree-item[title="短文.md"]').dblclick();await expect(page.locator('.milkdown-code-block')).toHaveCount(0);
      await page.locator('.tab-name[title="密集代码.md"]').click();await expect(page.locator('.code-actions')).toHaveCount(80);
    }
    await page.waitForTimeout(1500);await cdp.send('HeapProfiler.collectGarbage');const afterSwitch=await metrics();
    const memoryGrowthMB=(afterSwitch.JSHeapUsedSize-heap.JSHeapUsedSize)/1048576;
    await fs.writeFile(path.resolve(project,'../../work/performance-audit-'+(process.env.MOYU_AUDIT_LABEL||'current')+'.json'),JSON.stringify({...report,memoryGrowthMB},null,2));console.log(JSON.stringify({...report,memoryGrowthMB}));
    expect(memoryGrowthMB).toBeLessThan(10);
    expect(report.idleCPUSeconds).toBeLessThan(0.35);expect(report.p95KeyMs).toBeLessThan(300);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
