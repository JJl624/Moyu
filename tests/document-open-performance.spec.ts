import {test,expect} from './helpers/test';
import {attachmentFixture} from './helpers/attachment-fixture';
import {performanceDocuments} from './fixtures/performance-documents.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Document opening and repeated switching retain content and report renderer costs',async()=>{
  test.setTimeout(180000);const f=await attachmentFixture();try{
    await fs.writeFile(path.join(f.root,'性能图片.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="80"><rect width="220" height="80" fill="#89abc0"/></svg>');
    const samples=[{name:'短文',markdown:'# 短文\n\n内容'},...performanceDocuments];
    for(const sample of samples)await f.page.evaluate(sample=>window.moyu!.create(sample.name+'.md','file',sample.markdown),sample);
    for(const sample of samples)await expect(f.page.locator(`.tree-item[title="${sample.name}.md"]`)).toBeVisible();
    const saved=new Map<string,string>();for(const sample of samples)saved.set(sample.name,await fs.readFile(path.join(f.root,sample.name+'.md'),'utf8'));
    const cdp=await f.page.context().newCDPSession(f.page);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m:any)=>[m.name,m.value]));
    const rows=[];
    for(let round=0;round<3;round++)for(const sample of samples){
      const before=await metrics(),started=Date.now();const tab=f.page.locator(`.tab-name[title="${sample.name}.md"]`);
      if(await tab.count())await tab.evaluate((button:HTMLElement)=>button.click());else await f.page.locator(`.tree-item[title="${sample.name}.md"]`).dblclick();
      await expect(f.page.locator('.ProseMirror h1').first()).toHaveText('# '+sample.name);
      await expect(f.page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
      const after=await metrics();rows.push({document:sample.name,round,ms:Date.now()-started,cpuMs:(after.TaskDuration-before.TaskDuration)*1000,layouts:after.LayoutCount-before.LayoutCount,codeViews:await f.page.locator('.milkdown-code-block .cm-editor').count()});
      if(round>0&&sample.name==='密集代码')expect(after.LayoutCount-before.LayoutCount).toBeLessThan(45);
      await expect(f.page.locator('.save-status')).not.toContainText('未保存');
    }
    const profile=(await cdp.send('Profiler.stop')).profile;
    const counts=new Map<number,number>();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
    const hotspots=profile.nodes.map((n:any)=>({name:n.callFrame.functionName,url:path.basename(n.callFrame.url),samples:counts.get(n.id)||0})).filter((n:any)=>n.samples).sort((a:any,b:any)=>b.samples-a.samples).slice(0,25);
    const label=process.env.MOYU_AUDIT_LABEL||'current';await fs.writeFile(path.resolve('../../work/v1063-open-'+label+'.json'),JSON.stringify({rows,hotspots},null,2));await fs.writeFile(path.resolve('../../work/v1063-open-'+label+'.cpuprofile'),JSON.stringify(profile));console.log(JSON.stringify(rows));
    for(const sample of samples)expect(await fs.readFile(path.join(f.root,sample.name+'.md'),'utf8')).toBe(saved.get(sample.name));
  }finally{await f.close();}
});
