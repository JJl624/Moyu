import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const work=path.resolve(import.meta.dirname,'../../../work');
const longText=Array.from({length:65},(_,index)=>`第 ${index} 段：用于检查长文档的阅读和编辑位置。`).join('\n\n');
const content='# 复杂文档\n\n'+longText+'\n\n| 名称 | 用途 | 输入 | 输出 | 备注 |\n| --- | --- | --- | --- | --- |\n| 快速排序 | 排序 | 数组 | 有序数组 | 原地操作 |\n\n```javascript\nconsole.log("复制这段代码");\n```\n\n> [+] 折叠标题\n> 折叠内容\n\n![示意图](a.assets/attachments/a.svg)\n';
async function start(page:Page){
  await mockAndroid(page,{files:{'a.md':{content},'b.md':{content:'# B'},'目标/已有.md':{content:'# 已有'},'a.assets/attachments/a.svg':{content:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="300" fill="blue"/></svg>'}},folders:['目标']});
  await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.locator('[data-path="a.md"] .mobile-file-open').click();
}
async function home(page:Page){await start(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();}
async function select(page:Page,name:string){await page.getByRole('button',{name:'操作 '+name,exact:true}).click();await page.getByRole('button',{name:'选择多个',exact:true}).click();}

test('Compact fixed-width view controls, focus reading and pinned formatting actions fit a small keyboard viewport',async({page})=>{
  await start(page);await page.setViewportSize({width:360,height:430});
  const positions=[];
  for(const name of ['编辑','源码','阅读']){
    await page.getByRole('tab',{name,exact:true}).click();
    const button=page.getByRole('tab',{name:'阅读',exact:true}),box=(await button.boundingBox())!,visual=(await button.locator('span').boundingBox())!;
    expect(box.width).toBe(44);expect(box.height).toBe(44);expect(visual.height).toBe(28);positions.push(box.x);
  }
  expect(new Set(positions).size).toBe(1);await page.getByRole('button',{name:'专注阅读',exact:true}).click();await expect(page.locator('.mobile-editor-header')).toBeHidden();await page.getByRole('button',{name:'退出专注阅读'}).click();await expect(page.locator('.mobile-editor-header')).toBeVisible();
  await page.getByRole('tab',{name:'源码',exact:true}).click();
  for(const name of ['全部格式','放大字号','缩小字号']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.x+box.width).toBeLessThanOrEqual(360);expect(box.y+box.height).toBeLessThanOrEqual(430);}
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await expect(page.getByRole('button',{name:'关闭全部格式'})).toBeInViewport();
  const panel=page.getByRole('dialog',{name:'全部格式'});expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(406);
  await page.screenshot({path:path.join(work,'android-compact-formatting.png')});
});

test('Cancelling a format sheet preserves selection without focusing; choosing a format toggles the same selection',async({page})=>{
  await start(page);await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');await source.fill('待加粗文字');await source.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(page.getByRole('dialog')).toHaveCount(0);expect(await source.evaluate(element=>element===document.activeElement)).toBe(false);
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'加粗',exact:true}).click();await expect(source).toHaveText('**待加粗文字**');
  await page.getByRole('button',{name:'加粗',exact:true}).click();await expect(source).toHaveText('待加粗文字');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(source).toHaveText('**待加粗文字**');
});

test('Wide tables scroll independently; code copies exactly; images support full-screen zoom and Android back',async({page,context})=>{
  await start(page);const wrapper=page.getByRole('region',{name:'表格，可左右滑动'});await wrapper.scrollIntoViewIfNeeded();await expect(wrapper).toHaveAttribute('data-overflow','true');
  await wrapper.evaluate(element=>element.scrollLeft=150);expect(await wrapper.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);expect(await page.locator('.mobile-document').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.getByRole('button',{name:'复制代码',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.clipboard)).toBe('console.log("复制这段代码");');
  await page.getByRole('button',{name:'全屏查看示意图',exact:true}).click();const viewer=page.getByRole('dialog',{name:'全屏查看'});await expect(viewer).toBeVisible();await viewer.getByRole('button',{name:'放大',exact:true}).click();await expect(viewer.locator('output')).toHaveText('150%');
  expect(await viewer.locator('.mobile-media-pan').evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
  await viewer.getByRole('button',{name:'还原大小',exact:true}).click();const cdp=await context.newCDPSession(page),box=(await viewer.locator('.mobile-media-pan').boundingBox())!,y=box.y+box.height/2;
  for(let tap=0;tap<2;tap++){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}await expect(viewer.locator('output')).toHaveText('200%');await viewer.getByRole('button',{name:'还原大小',exact:true}).click();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y,id:1},{x:230,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:130,y,id:1},{x:250,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(viewer.locator('output')).toHaveText('150%');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:260,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:160,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect(await viewer.locator('.mobile-media-pan').evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);await cdp.detach();
  await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(viewer).toHaveCount(0);await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();
  const summary=page.locator('summary');await summary.scrollIntoViewIfNeeded();expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);await summary.click();await expect(page.getByText('折叠内容',{exact:true})).toBeHidden();
});

test('Returning to the file list preserves expansion and scroll; reopening an open document restores reading position',async({page})=>{
  await home(page);await page.evaluate(()=>{for(let index=0;index<35;index++)(window as any).__mobileState.files['0-'+String(index).padStart(2,'0')+'.md']={content:'文档'};window.dispatchEvent(new Event('moyu-mobile-resume'));});await expect(page.locator('[data-path="0-34.md"]')).toHaveCount(1);await page.locator('[data-path="目标"] .mobile-file-open').click();await page.locator('[data-path="a.md"] .mobile-file-open').scrollIntoViewIfNeeded();const listPosition=await page.locator('.mobile-home-content').evaluate(element=>element.scrollTop);expect(listPosition).toBeGreaterThan(0);await page.locator('[data-path="a.md"] .mobile-file-open').click();await expect(page.locator('.reading-view')).toContainText('第 64 段');
  await page.locator('.mobile-document').evaluate(element=>element.scrollTop=900);await expect.poll(()=>page.locator('.mobile-document').evaluate(element=>element.scrollTop)).toBe(900);
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect.poll(()=>page.locator('.mobile-home-content').evaluate(element=>element.scrollTop)).toBe(listPosition);await expect(page.locator('[data-path="目标"]')).toHaveAttribute('aria-expanded','true');await expect(page.locator('[data-path="目标/已有.md"]')).toBeVisible();await page.locator('[data-path="a.md"] .mobile-file-open').click();await expect.poll(()=>page.locator('.mobile-document').evaluate(element=>element.scrollTop)).toBe(900);
});

test('Long press selects without opening, scrolling cancels long press, and batch move keeps attachment references',async({page})=>{
  await home(page);const a=page.locator('[data-path="a.md"] .mobile-file-open');
  await a.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:2,clientX:60,clientY:200});await a.dispatchEvent('pointermove',{pointerType:'touch',pointerId:2,clientX:60,clientY:225});await page.waitForTimeout(500);await expect(page.getByRole('toolbar',{name:'文件批量操作'})).toHaveCount(0);await a.dispatchEvent('pointercancel',{pointerId:2});
  await a.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:3,clientX:60,clientY:200});await expect(page.getByRole('toolbar',{name:'文件批量操作'})).toBeVisible();await a.dispatchEvent('pointerup',{pointerId:3});await a.dispatchEvent('click');await expect(page.locator('[data-path="a.md"]')).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveCount(0);
  await page.locator('[data-path="b.md"] .mobile-file-open').click();await page.getByRole('toolbar',{name:'文件批量操作'}).getByRole('button',{name:'移动',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('button',{name:'移到这里',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const files=await page.evaluate(()=>(window as any).__mobileState.files);expect(files['目标/a.md'].content).toContain('a.assets/attachments/a.svg');expect(files['目标/a.assets/attachments/a.svg']).toBeTruthy();expect(files['目标/b.md']).toBeTruthy();expect(files['a.md']).toBeUndefined();
});

test('Batch move validates all names before moving, sharing passes selected files, Android back cancels selection',async({page})=>{
  await home(page);await page.evaluate(()=>{(window as any).__mobileState.files['目标/b.md']={content:'已有同名内容'};window.dispatchEvent(new Event('moyu-mobile-resume'));});await select(page,'a.md');await page.locator('[data-path="b.md"] .mobile-file-open').click();
  const tools=page.getByRole('toolbar',{name:'文件批量操作'});await tools.getByRole('button',{name:'分享',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.sharedFiles)).toEqual(['a.md','b.md']);
  await tools.getByRole('button',{name:'移动',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('button',{name:'移到这里',exact:true}).click();await expect(page.getByRole('alert')).toContainText('目标文件夹已有');expect(await page.evaluate(()=>!!(window as any).__mobileState.files['a.md'])).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(page.getByRole('dialog')).toHaveCount(0);await expect(tools).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(tools).toHaveCount(0);
});

test('Selecting a folder and its child deletes only once and leaves the other files intact',async({page})=>{
  await home(page);await page.locator('[data-path="目标"] .mobile-file-open').click();await select(page,'目标');await page.locator('[data-path="目标/已有.md"] .mobile-file-open').click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('toolbar',{name:'文件批量操作'}).getByRole('button',{name:'回收站',exact:true}).click();
  await expect(page.getByRole('toolbar',{name:'文件批量操作'})).toHaveCount(0);const state=await page.evaluate(()=>(window as any).__mobileState);expect(state.trash).toHaveLength(1);expect(state.files['目标/已有.md']).toBeUndefined();expect(state.files['a.md']).toBeTruthy();
});

test('Sync details expose the last failure and lead to configuration without discarding the file list',async({page})=>{
  await home(page);await page.getByRole('button',{name:'同步详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'同步详情'})).toContainText('尚未同步');await page.getByRole('button',{name:'同步设置与冲突处理',exact:true}).click();await expect(page.getByLabel('WebDAV 地址',{exact:true})).toBeVisible();await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('tree',{name:'文档目录'})).toBeVisible();
});
