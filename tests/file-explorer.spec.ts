import {_electron as electron, expect, test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),base=path.resolve(project,'../../work/e2e');
test('Explorer toggles owned folders, follows the current document and attachment, sorts files and persists its choices',async()=>{
 test.setTimeout(90000);await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'explorer-'));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env});
 let app=await launch();
 try{
  let page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.ProseMirror h1')).toBeVisible();
  for(const file of ['排序2.md','排序10.md','其他.md'])expect((await page.evaluate(file=>window.moyu!.create(file,'file','# '+file),file)).ok).toBe(true);
  expect((await page.evaluate(()=>window.moyu!.create('普通.assets','folder'))).ok).toBe(true);
  expect((await page.evaluate(()=>window.moyu!.create('排序5','folder'))).ok).toBe(true);
  for(const document of ['排序2.md','其他.md']){
   const r:any=await page.evaluate(document=>window.moyu!.feature('attachment.upload',{document,name:'图.svg',bytes:new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')}),document);expect(r.ok,JSON.stringify(r)).toBe(true);expect(r.data.path).toBe(document.replace('.md','.assets')+'/attachments/图.svg');
  }
  await expect(page.locator('.tree-item[title="普通.assets"]')).toBeVisible();await expect(page.locator('.tree-item[title="排序2.assets"]')).toHaveCount(0);
  await page.getByRole('button',{name:'显示附属文件夹与数据',exact:true}).click();await expect(page.locator('.tree-item[title="排序2.assets"]')).toBeVisible();
  await page.locator('.tree-item[title="排序2.assets"]').click({button:'right'});await expect(page.locator('.context-menu').getByRole('button',{name:'重命名',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'显示附属文件夹与数据',exact:true}).click();
  await page.locator('.tree-item[title="排序2.md"]').dblclick();await page.getByRole('button',{name:'查看当前文档附属目录',exact:true}).click();
  await expect(page.locator('.tree-item[title="排序2.assets"]')).toBeVisible();await expect(page.locator('.tree-item[title="普通.assets"]')).toHaveCount(0);
  await page.getByRole('button',{name:'查看工作空间',exact:true}).click();await page.locator('.tree-item[title="其他.md"]').dblclick();await page.getByRole('button',{name:'查看当前文档附属目录',exact:true}).click();await expect(page.locator('.tree-item[title="其他.assets"]')).toBeVisible();
  await page.locator('.tab').filter({hasText:'排序2'}).click();await expect(page.locator('.tree-item[title="排序2.assets"]')).toBeVisible();
  await page.locator('.tree-item[title="排序2.assets/attachments"]').click();await page.locator('.tree-item[title="排序2.assets/attachments/图.svg"]').dblclick();await expect(page.locator('.tree-item[title="排序2.assets"]')).toBeVisible();
  await page.getByRole('button',{name:'查看工作空间',exact:true}).click();
  await page.getByRole('button',{name:'文件排序',exact:true}).click();
  const menu=page.getByRole('menu',{name:'排序优先级',exact:true}),nameSort=menu.getByRole('menuitem',{name:'文件名',exact:true});
  await expect(menu.getByRole('menuitem')).toHaveCount(4);await expect(nameSort).toHaveAttribute('data-direction','ascending');await nameSort.click();await expect(nameSort).toHaveAttribute('data-direction','descending');
  const order=await page.locator('.tree-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('title')));expect(order.indexOf('排序10.md')).toBeLessThan(order.indexOf('排序2.md'));
  expect(order.indexOf('排序10.md')).toBeLessThan(order.indexOf('排序5'));expect(order.indexOf('排序5')).toBeLessThan(order.indexOf('排序2.md'));
  await nameSort.click();await expect(nameSort).toHaveAttribute('data-direction','ascending');
  await menu.getByRole('menuitem',{name:'文件类型',exact:true}).click();
  await menu.locator('[data-sort-key=type] .sort-grip').dragTo(menu.locator('[data-sort-key=name]'));
  await expect(menu.locator('[data-sort-key]').first()).toHaveAttribute('data-sort-key','type');
  await expect(menu.getByRole('menuitem',{name:'文件类型',exact:true})).toHaveAttribute('data-direction','descending');
  const combined=await page.locator('.tree-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('title')));
  expect(combined.indexOf('排序2.md')).toBeLessThan(combined.indexOf('排序10.md'));expect(combined.indexOf('排序10.md')).toBeLessThan(combined.indexOf('排序5'));
  await menu.getByRole('menuitem',{name:'创建日期',exact:true}).focus();await page.keyboard.press('Alt+ArrowUp');
  await expect(menu.locator('[data-sort-key]').nth(2)).toHaveAttribute('data-sort-key','created');
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
  await page.getByRole('button',{name:'显示附属文件夹与数据',exact:true}).click();
  // Compact header remains inside its sidebar at the smallest supported width.
  await page.locator('.sidebar').evaluate(el=>{(el as HTMLElement).style.width='180px';});expect(await page.locator('.sidebar-title').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);await page.waitForTimeout(400);await app.evaluate(({app})=>app.exit(0));app=await launch();page=await app.firstWindow();await expect(page.locator('.workspace-picker')).toBeVisible();
  await expect(page.getByRole('button',{name:'文件排序',exact:true})).toContainText('文件类型');await expect(page.locator('.tree-item[title="排序2.assets"]')).toBeVisible();
  await page.getByRole('button',{name:'文件排序',exact:true}).click();const restored=page.getByRole('menu',{name:'排序优先级',exact:true});
  expect(await restored.locator('[data-sort-key]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-sort-key')))).toEqual(['type','name','created','updated']);
  await expect(restored.getByRole('menuitem',{name:'文件类型',exact:true})).toHaveAttribute('data-direction','descending');
  await expect(restored.getByRole('menuitem',{name:'文件名',exact:true})).toHaveAttribute('data-direction','ascending');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('A note with no attachments stays lazy in the document folder view and preferences have no file organization category',async()=>{
 await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'explorer-empty-')),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env});
 try{const page=await app.firstWindow();await expect(page.locator('.ProseMirror h1')).toBeVisible();await page.evaluate(()=>window.moyu!.create('空文档.md','file','# 空文档'));await page.locator('.tree-item[title="空文档.md"]').dblclick();await page.getByRole('button',{name:'查看当前文档附属目录',exact:true}).click();await expect(page.getByText('此文档暂无附属目录',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新建文档',exact:true})).toBeDisabled();expect(await fs.stat(path.join(data,'示例知识库/空文档.assets')).catch(()=>null)).toBe(null);
 await page.getByRole('button',{name:'偏好设置',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByText('文件与附件',{exact:true})).toHaveCount(0);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
