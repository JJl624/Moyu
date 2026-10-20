import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function fixture(theme='light'){
  const data=await fs.mkdtemp(path.join(work,'explorer-layout-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-theme':theme,'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  return{app,page,data,root:path.join(data,'示例知识库')};
}
for(const theme of ['light','dark'])test(`Narrow explorer preserves single-line sorting, readable navigation and fixed icons (${theme})`,async()=>{
  const{app,page,root}=await fixture(theme),document='很长的文档名称用于检查附属目录与排序栏.md';
  try{
    await page.evaluate(document=>window.moyu!.create(document,'file','# 标题\n\n内容'),document);
    await page.locator(`.tree-item[title="${document}"]`).dblclick();
    const divider=page.getByRole('separator',{name:'文件管理器与编辑器分隔条',exact:true});
    const resize=async(width:number)=>{
      let current=Number(await divider.getAttribute('aria-valuenow'));await divider.focus();
      while(current!==width){await divider.press(current>width?'Shift+ArrowLeft':'Shift+ArrowRight');current=Number(await divider.getAttribute('aria-valuenow'));}
    };
    await resize(180);const sidebar=page.locator('.file-sidebar'),heading=sidebar.locator('.sidebar-title');
    expect((await heading.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    expect(await heading.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const buttons=await heading.getByRole('button').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}));
    for(let i=0;i<buttons.length;i++){
      expect(buttons[i].width).toBeGreaterThanOrEqual(24);expect(buttons[i].height).toBeGreaterThanOrEqual(24);
      for(let j=i+1;j<buttons.length;j++)expect(Math.max(0,Math.min(buttons[i].right,buttons[j].right)-Math.max(buttons[i].x,buttons[j].x))*Math.max(0,Math.min(buttons[i].bottom,buttons[j].bottom)-Math.max(buttons[i].y,buttons[j].y))).toBe(0);
    }
    await page.getByRole('button',{name:'查看当前文档附属目录',exact:true}).click();
    await expect(page.getByText('此文档暂无附属目录',{exact:true})).toBeVisible();
    const sort=page.getByRole('button',{name:'文件排序',exact:true}),controls=sidebar.locator('.file-explorer-controls');
    await sort.click();const menu=page.getByRole('menu',{name:'排序优先级',exact:true});
    const date=menu.getByRole('menuitem',{name:'修改日期',exact:true});await date.focus();await date.press('Alt+ArrowUp');await date.press('Alt+ArrowUp');await page.keyboard.press('Escape');
    await expect(sort).toContainText('修改日期');
    expect(await sort.locator('span').evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
    expect((await sort.locator('span').boundingBox())!.height).toBeLessThan(25);
    expect(await controls.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const owner=sidebar.locator('.explorer-owner');await expect(owner).toHaveAttribute('title',document);
    expect((await owner.boundingBox())!.y).toBeGreaterThanOrEqual((await sort.boundingBox())!.y+(await sort.boundingBox())!.height);
    const box=(await sidebar.boundingBox())!;await page.screenshot({path:path.join(work,`explorer-empty-${theme}-v0200.png`),clip:{x:box.x,y:box.y,width:box.width,height:220}});
    expect(await fs.stat(path.join(root,document.replace('.md','.assets'))).catch(()=>null)).toBe(null);
    await resize(340);expect((await heading.boundingBox())!.height).toBeLessThan(50);await resize(180);
    expect((await heading.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    await page.getByRole('button',{name:'查看工作空间',exact:true}).click();
    const folders=Array.from({length:6},(_,i)=>'长文件夹名称'+(i+1)),paths=folders.map((_,i)=>folders.slice(0,i+1).join('/'));
    await page.evaluate(async(paths)=>{for(const folder of paths)await window.moyu!.create(folder,'folder');await window.moyu!.create(paths.at(-1)+'/很长的文件名用于观察截断.md','file','内容');},paths);
    for(const folder of paths)await page.locator(`.tree-item[title="${folder}"]`).click();
    const last=sidebar.locator(`[data-tree-path="${paths.at(-1)}/很长的文件名用于观察截断.md"]`);
    await expect(last).toBeVisible();expect(await last.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await last.locator('.tree-item>.file-icon').evaluate(el=>el.getBoundingClientRect().width)).toBe(17);
    expect((await last.locator('.tree-more').boundingBox())!.width).toBe(23);
    await sidebar.evaluate(el=>{(el as HTMLElement).style.setProperty('--size-files','20px');(el as HTMLElement).style.setProperty('--ui-size','20px');});
    expect(await heading.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await last.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await sidebar.screenshot({path:path.join(work,`explorer-tree-${theme}-v0200.png`)});
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Drag expansion waits two seconds at each folder level and cancels after leaving',async()=>{
  const{app,page,root}=await fixture();
  try{
    await page.evaluate(async()=>{for(const folder of ['目标','目标/子目录','目标/子目录/孙目录','取消','取消/子目录'])await window.moyu!.create(folder,'folder');await window.moyu!.create('拖动.md','file','保留内容');await window.moyu!.create('取消.md','file','不移动');});
    const source=page.locator('[data-tree-path="拖动.md"]'),transfer=await page.evaluateHandle(()=>new DataTransfer());
    await source.dispatchEvent('dragstart',{dataTransfer:transfer});
    for(const [folder,child]of [['目标','目标/子目录'],['目标/子目录','目标/子目录/孙目录']]){
      const row=page.locator(`[data-tree-path="${folder}"]`),box=(await row.boundingBox())!;
      await row.dispatchEvent('dragover',{dataTransfer:transfer,clientY:box.y+box.height/2});await expect(row).toHaveClass(/drag-destination/);
      await page.waitForTimeout(550);await expect(page.locator(`[data-tree-path="${child}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-tree-path="${child}"]`)).toBeVisible({timeout:2000});
    }
    const child=page.locator('[data-tree-path="目标/子目录"]'),box=(await child.boundingBox())!;
    await child.dispatchEvent('drop',{dataTransfer:transfer,clientY:box.y+box.height/2});
    await expect.poll(()=>fs.readFile(path.join(root,'目标/子目录/拖动.md'),'utf8').catch(()=>null)).toBe('保留内容');
    const cancel=page.locator('[data-tree-path="取消.md"]'),target=page.locator('[data-tree-path="取消"]'),bounds=(await target.boundingBox())!;
    await cancel.dispatchEvent('dragstart',{dataTransfer:transfer});await target.dispatchEvent('dragover',{dataTransfer:transfer,clientY:bounds.y+bounds.height/2});
    await target.dispatchEvent('dragleave',{relatedTarget:null});await cancel.dispatchEvent('dragend',{dataTransfer:transfer});
    await page.waitForTimeout(1100);await expect(page.locator('[data-tree-path="取消/子目录"]')).toHaveCount(0);
    expect(await fs.readFile(path.join(root,'取消.md'),'utf8')).toBe('不移动');
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
