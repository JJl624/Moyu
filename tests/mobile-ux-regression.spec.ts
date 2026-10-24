import {test,expect,type Page} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';
import path from 'node:path';
const work=path.resolve(import.meta.dirname,'../../../work');

async function start(page:Page){
  await mockAndroid(page,{files:{'a.md':{content:'保留这段文字'},'资料/子目录/笔记.md':{content:'# 笔记\n\n正文'}},folders:['资料','资料/子目录']});
  await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();
}
async function home(page:Page){await start(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();}
async function create(page:Page,name:string){
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();
  await page.getByRole('textbox',{name:'名称',exact:true}).fill(name);await page.getByRole('button',{name:'确定',exact:true}).click();
}
async function back(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));}

for(const mode of ['源码','编辑'])test(`Canceling the attachment picker preserves selected text, dirty state and undo history (${mode})`,async({page})=>{
  const warnings:string[]=[];page.on('console',event=>{if(event.type()==='warning'&&event.text().includes('TextSelection'))warnings.push(event.text());});
  await home(page);await page.locator('[data-path="a.md"] .mobile-file-open').click();await page.getByRole('tab',{name:mode,exact:true}).click();const source=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await source.click();await page.keyboard.press('ControlOrMeta+A');
  await expect.poll(()=>page.evaluate(()=>getSelection()?.toString().trim())).toBe('保留这段文字');
  await page.evaluate(()=>(window as any).__mobileState.cancelAttachment=true);await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('button',{name:'插入附件',exact:true}).click();
  await expect(source).toHaveText('保留这段文字');await expect(page.locator('.mobile-document-title small')).toHaveText('已保存');
  await page.keyboard.type('替换');await expect(source).toHaveText('替换');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(source).toHaveText('保留这段文字');
  expect(warnings).toEqual([]);
});

test('External deletion removes vanished selections without changing the remaining batch operation',async({page})=>{
  await home(page);await page.getByRole('button',{name:'操作 a.md',exact:true}).click();await page.getByRole('button',{name:'选择多个',exact:true}).click();await page.locator('[data-path="资料"] .mobile-file-open').click();
  await expect(page.locator('.mobile-list-heading h1')).toHaveText('已选 2 项');await page.evaluate(()=>{delete (window as any).__mobileState.files['a.md'];window.dispatchEvent(new Event('moyu-mobile-resume'));});
  await expect(page.locator('[data-path="a.md"]')).toHaveCount(0);await expect(page.locator('.mobile-list-heading h1')).toHaveText('已选 1 项');await expect(page.locator('[data-path="资料"]')).toHaveAttribute('aria-selected','true');
  await back(page);await expect(page.getByRole('toolbar',{name:'文件批量操作'})).toHaveCount(0);
});

for(const batch of [false,true])test(`Deleting the current creation folder returns new files to its existing parent (${batch?'batch':'single'})`,async({page})=>{
  await home(page);await page.locator('[data-path="资料"] .mobile-file-open').click();await page.locator('[data-path="资料/子目录"] .mobile-file-open').click();
  await page.getByRole('button',{name:'操作 子目录',exact:true}).click();
  if(batch){await page.getByRole('button',{name:'选择多个',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('toolbar',{name:'文件批量操作'}).getByRole('button',{name:'回收站',exact:true}).click();await expect(page.getByRole('toolbar',{name:'文件批量操作'})).toHaveCount(0);}
  else {page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'移入回收站',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
  await expect(page.locator('[data-path="资料/子目录"]')).toHaveCount(0);await create(page,'新笔记');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  const files=await page.evaluate(()=>(window as any).__mobileState.files);expect(files['资料/新笔记.md']).toBeTruthy();expect(files['资料/子目录/新笔记.md']).toBeUndefined();
});

test('An externally removed folder is not silently recreated by New; existing ancestors remain selected',async({page})=>{
  await home(page);await page.locator('[data-path="资料"] .mobile-file-open').click();await page.locator('[data-path="资料/子目录"] .mobile-file-open').click();
  await page.evaluate(()=>{const state=(window as any).__mobileState;delete state.files['资料/子目录/笔记.md'];state.folders=['资料'];window.dispatchEvent(new Event('moyu-mobile-resume'));});
  await expect(page.locator('[data-path="资料/子目录"]')).toHaveCount(0);await create(page,'offline.txt');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>!!(window as any).__mobileState.files['资料/offline.txt'])).toBe(true);
});

test('Renaming and moving the selected folder keep New pointed at its new location',async({page})=>{
  await home(page);await page.locator('[data-path="资料"] .mobile-file-open').click();await page.locator('[data-path="资料/子目录"] .mobile-file-open').click();
  await page.getByRole('button',{name:'操作 资料',exact:true}).click();await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByRole('textbox',{name:'名称',exact:true}).fill('重命名资料');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-path="重命名资料/子目录"]')).toHaveAttribute('aria-selected','true');await page.getByRole('button',{name:'操作 子目录',exact:true}).click();await page.getByRole('button',{name:'移动',exact:true}).click();await page.getByRole('button',{name:'上一级文件夹',exact:true}).click();await page.getByRole('button',{name:'移到这里',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-path="子目录"]')).toHaveAttribute('aria-selected','true');await create(page,'移动后');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();expect(await page.evaluate(()=>!!(window as any).__mobileState.files['子目录/移动后.md'])).toBe(true);
});

test('Invalid and duplicate names retain input; correction creates exactly one file with the requested extension',async({page})=>{
  await home(page);await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();
  const input=page.getByRole('textbox',{name:'名称',exact:true}),submit=page.getByRole('button',{name:'确定',exact:true});await expect(submit).toBeDisabled();
  await input.fill('bad/name');await submit.click();await expect(page.getByRole('alert')).toContainText('名称不能包含斜杠');await expect(input).toHaveValue('bad/name');
  await input.fill('a.md');await submit.click();await expect(page.getByRole('alert')).toContainText('已经存在');await expect(input).toHaveValue('a.md');
  await input.fill('  记录.txt  ');await submit.click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  const files=await page.evaluate(()=>(window as any).__mobileState.files);expect(files['记录.txt']).toBeTruthy();expect(files['记录.txt.md']).toBeUndefined();expect(files['a.md'].content).toBe('保留这段文字');
});

test('Native back unwinds nested creation panels and validation errors before returning to the list',async({page})=>{
  await home(page);await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.getByRole('textbox',{name:'名称',exact:true}).fill('bad/name');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await back(page);await expect(page.getByRole('dialog',{name:'新建',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await back(page);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('tree')).toBeVisible();
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文件夹',exact:true}).click();await page.getByRole('button',{name:'关闭新建文件夹',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>!!document.activeElement?.closest('input,textarea,[contenteditable]'))).toBe(false);
});

test('Back from settings returns to the list without changing its selected folder',async({page})=>{
  await home(page);await page.locator('[data-path="资料"] .mobile-file-open').click();await page.locator('[data-path="资料/子目录"] .mobile-file-open').click();await page.getByRole('button',{name:'设置',exact:true}).click();await back(page);
  await expect(page.getByRole('tree',{name:'文档目录'})).toBeVisible();await expect(page.locator('[data-path="资料/子目录"]')).toHaveAttribute('aria-selected','true');
});

test('Large interface text on a narrow phone keeps settings and nested panels within the viewport',async({page})=>{
  await home(page);await page.setViewportSize({width:320,height:568});await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('slider',{name:'界面字号',exact:true}).fill('24');
  expect(await page.locator('.mobile-home-content').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  for(const label of ['界面字号','正文字号','保存方式']){const text=page.locator('.mobile-settings-section label > span,.mobile-select-heading > span').filter({hasText:label});expect(await text.evaluate(element=>element.getBoundingClientRect().height<=parseFloat(getComputedStyle(element).lineHeight)+1)).toBe(true);}
  for(const label of ['外观','配色','保存方式']){const box=(await page.getByLabel(label,{exact:true}).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);}
  await page.screenshot({path:path.join(work,'android-ux-narrow-settings.png')});
  await page.getByRole('button',{name:'编辑工具栏',exact:true}).click();const panel=page.getByRole('dialog');await expect(page.getByRole('button',{name:'关闭编辑工具栏',exact:true})).toBeInViewport();expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await panel.locator('.mobile-sheet-content').evaluate(element=>element.scrollTop=element.scrollHeight);await expect(page.getByRole('button',{name:'恢复默认工具栏',exact:true})).toBeInViewport();
  await page.setViewportSize({width:740,height:360});await expect(page.getByRole('button',{name:'关闭编辑工具栏',exact:true})).toBeInViewport();expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(336);await panel.locator('.mobile-sheet-content').evaluate(element=>element.scrollTop=element.scrollHeight);await expect(page.getByRole('button',{name:'恢复默认工具栏',exact:true})).toBeInViewport();
  await page.screenshot({path:path.join(work,'android-ux-landscape-shortcuts.png')});
});

test('The home vault title opens selection; canceling the device picker keeps the current vault and folder',async({page})=>{
  await home(page);await page.locator('[data-path="资料"] .mobile-file-open').click();const title=page.getByRole('button',{name:'选择知识库',exact:true});await expect(title).toContainText('我的知识库');await title.click();
  await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();await page.getByRole('button',{name:'选择设备上的文件夹',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();await back(page);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-path="资料"]')).toHaveAttribute('aria-selected','true');
  await page.evaluate(()=>{(window as any).__mobileState.vaultName='我的知识库名称很长也不能把新建和已打开的文档按钮挤出手机屏幕';window.dispatchEvent(new Event('moyu-mobile-resume'));});await expect(title).toContainText('名称很长');await page.setViewportSize({width:320,height:568});
  const text=title.locator('span');expect(await text.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);const box=(await page.getByRole('button',{name:'已打开的文档',exact:true}).boundingBox())!;expect(box.x+box.width).toBeLessThanOrEqual(320);await page.screenshot({path:path.join(work,'android-ux-home-title.png')});
});

test('An empty vault provides an actionable New button and opens new notes in reading mode',async({page})=>{
  await mockAndroid(page,{files:{}});await page.goto('/mobile.html');await expect(page.getByRole('heading',{name:'写下第一篇笔记',exact:true})).toBeVisible();await page.getByRole('button',{name:'新建笔记',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('第一篇');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('button',{name:'开始编辑',exact:true})).toBeVisible();
});
