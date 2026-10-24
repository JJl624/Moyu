import {selectMobile} from './helpers/mobile-controls.mjs';
import {test,expect} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
import {mobileDavFixture} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
const work=path.resolve(import.meta.dirname,'../../../work');
async function start(page:any){await mockAndroid(page);await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();}

test('All formats include extended syntax, headings and lists; defaults keep the shortcut bar compact',async({page})=>{
  await start(page);await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');await expect(source).toBeVisible();
  const select=async(text:string)=>{await source.fill(text);await source.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');};
  await select('文字');await page.getByRole('button',{name:'全部格式',exact:true}).click();const menu=page.getByRole('dialog',{name:'全部格式',exact:true});
  for(const name of ['删除线','行内代码','下划线','高亮','行内公式','折叠引用','表格','标签页'])await expect(menu.getByRole('button',{name,exact:true})).toBeVisible();
  await expect(menu.getByRole('button',{name:/默认折叠引用|默认展开引用/})).toHaveCount(0);
  for(const label of ['一级标题','二级标题','三级标题','无序列表','有序列表','任务列表'])await expect(menu.getByRole('button',{name:label,exact:true})).toBeVisible();await expect(page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:/标题|列表/})).toHaveCount(0);
  await page.screenshot({path:path.join(work,'android-styles-extended.png')});await menu.getByRole('button',{name:'下划线',exact:true}).click();await expect(source).toContainText('__文字__');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await menu.getByRole('button',{name:'下划线',exact:true}).click();await expect(source).toHaveText('文字');
  await select('标题\n内容');await page.getByRole('button',{name:'全部格式',exact:true}).click();await menu.getByRole('button',{name:'折叠引用',exact:true}).click();await expect(source).toContainText('> [-] 标题');await expect(source).toContainText('> 内容');
  for(const open of [false,true]){
    if(open){await source.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('End');await page.getByRole('button',{name:'全部格式',exact:true}).click();await menu.getByRole('button',{name:'默认展开',exact:true}).click();await expect(source).toContainText('> [+] 标题');}
    await page.getByRole('tab',{name:'阅读',exact:true}).click();await expect(page.locator('details.folding-quote summary')).toContainText('标题');expect(await page.locator('details.folding-quote').evaluate(element=>element.hasAttribute('open'))).toBe(open);await page.getByRole('tab',{name:'源码',exact:true}).click();
  }
  await select('');await page.getByRole('button',{name:'全部格式',exact:true}).click();await menu.getByRole('button',{name:'表格',exact:true}).click();await page.getByRole('tab',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view table')).toBeVisible();
});

test('UI and document sizes adjust independently down to 10 and survive restart',async({page})=>{
  await start(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('界面字号',{exact:true}).focus();await page.keyboard.press('Home');await expect(page.getByLabel('界面字号',{exact:true})).toHaveValue('10');await expect(page.getByLabel('正文字号',{exact:true})).toHaveValue('17');
  await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="开始使用.md"] .mobile-file-open').click();expect(await page.locator('.reading-view').evaluate(element=>getComputedStyle(element).fontSize)).toBe('17px');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('正文字号',{exact:true}).focus();await page.keyboard.press('Home');await page.getByLabel('界面字号',{exact:true}).focus();await page.keyboard.press('End');
  await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="开始使用.md"] .mobile-file-open').click();expect(await page.locator('.reading-view').evaluate(element=>getComputedStyle(element).fontSize)).toBe('10px');expect(parseFloat(await page.locator('.mobile-document-title strong').evaluate(element=>getComputedStyle(element).fontSize))).toBeGreaterThan(24);
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.settings['moyu-mobile-ui-size'])).toBe('24');await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();expect(await page.locator('.reading-view').evaluate(element=>getComputedStyle(element).fontSize)).toBe('10px');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('界面字号',{exact:true})).toHaveValue('24');await expect(page.getByLabel('正文字号',{exact:true})).toHaveValue('10');await page.setViewportSize({width:360,height:740});expect(await page.locator('.mobile-app').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});

test('Rich editing can turn selected text into a folding quote without escaping its marker',async({page})=>{
  await mockAndroid(page,{files:{'折叠.md':{content:'# 标题\n\n折叠标题'} }});await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
  await page.locator('.ProseMirror p').first().tap({position:{x:20,y:16}});await page.locator('.ProseMirror p').first().selectText();await expect.poll(()=>page.evaluate(()=>document.getSelection()?.toString())).toBe('折叠标题');await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog',{name:'全部格式'}).getByRole('button',{name:'折叠引用',exact:true}).click();
  await page.getByRole('tab',{name:'阅读',exact:true}).click();await expect(page.locator('details.folding-quote summary')).toHaveText('折叠标题');expect(await page.locator('details.folding-quote').evaluate(element=>element.hasAttribute('open'))).toBe(false);
  await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('> [-] 折叠标题');
  await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');await page.locator('.folding-quote > p').first().click();await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'默认展开',exact:true}).click();await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('> [+] 折叠标题');
});

test('System bar surfaces follow home, reading, dark theme and the modal backdrop',async({page})=>{
  await start(page);const bars=()=>page.evaluate(()=>(window as any).__mobileState.systemBars);await expect.poll(async()=>(await bars())?.background).toBe('#ffffff');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();const home=await page.locator('.mobile-app').evaluate(element=>getComputedStyle(element).getPropertyValue('--sidebar').trim());await expect.poll(async()=>(await bars()).background).toBe(home);
  await page.getByRole('button',{name:'新建',exact:true}).click();await expect.poll(async()=>(await bars()).background).not.toBe(home);await page.getByRole('button',{name:'关闭新建',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await selectMobile(page,'外观','dark');await expect.poll(async()=>(await bars()).theme).toBe('dark');expect((await bars()).background).not.toBe('#ffffff');await page.screenshot({path:path.join(work,'android-theme-dark-settings.png')});
});

test('Home sync transfers immediately, stays in the file list, includes code data, and can be cancelled',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'# 文档'},'a.assets/attachments/image.png':{content:'image'},'a.assets/code-data/0001/input.txt':{content:'data'}}}});await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.getByRole('button',{name:'立即同步',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'已上传 3 个'})).toBeVisible();await expect(page.getByRole('button',{name:'选择知识库',exact:true})).toBeVisible();expect(dav.files.has('/a.assets/code-data/0001/input.txt')).toBe(true);expect(dav.files.has('/a.assets/attachments/image.png')).toBe(true);
    dav.delay({method:'PROPFIND',path:'/',ms:10000});await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'中断同步',exact:true})).toBeVisible();await page.getByRole('button',{name:'中断同步',exact:true}).click();await expect(page.getByRole('alert')).toContainText('已取消同步');await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
  }finally{await dav.close();}
});
