import {selectMobile} from './helpers/mobile-controls.mjs';
import { test, expect } from '@playwright/test';
import { mockAndroid } from './helpers/mobile-native-mock';
import path from 'node:path';
const work=path.resolve(import.meta.dirname,'../../../work');
test.use({viewport:{width:393,height:851},isMobile:true,hasTouch:true,deviceScaleFactor:1});
test.beforeEach(async({page})=>{await mockAndroid(page);await page.goto('http://127.0.0.1:5184/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.ProseMirror')).toHaveCount(0);await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect(page.locator('.mobile-file-list')).toBeVisible();});

test('Phone navigation, rich/source reading, formatting, save, reload and a small keyboard viewport',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('旅行清单');await page.getByRole('button',{name:'确定',exact:true}).click();
  await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await page.getByRole('tab',{name:'编辑',exact:true}).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();await page.locator('.ProseMirror').click();await page.keyboard.insertText('第一行\n第二行');
  await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('第一行');await expect(page.locator('.source-editor')).toContainText('第二行');
  await page.getByRole('tab',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view')).toContainText('第一行');
  await expect(page.getByRole('button',{name:'运行代码块',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:/终端/})).toHaveCount(0);
  await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');await page.locator('.ProseMirror').focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+End');
  await page.getByRole('button',{name:'加粗',exact:true}).click();await expect(page.locator('.moyu-source-strong').first()).toHaveText('第一行');
  await page.getByRole('button',{name:'加粗',exact:true}).click();await expect(page.locator('.moyu-source-strong')).toHaveCount(0);
  await page.setViewportSize({width:360,height:430});await expect(page.getByRole('toolbar',{name:'文本格式'})).toBeVisible();
  const bar=(await page.getByRole('toolbar',{name:'文本格式'}).boundingBox())!;expect(bar.y+bar.height).toBeLessThanOrEqual(431);
  expect(await page.locator('.mobile-app').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.locator('.mobile-document-title')).toContainText('已保存');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect(page.getByRole('button',{name:/旅行清单/}).first()).toBeVisible();
  await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.reading-view')).toContainText('第二行');expect(await page.evaluate(()=>(window as any).__mobileState.files['旅行清单.md'].content)).toContain('第二行');expect(errors).toEqual([]);
});

test('File naming, shared reference rewriting, search, recycle restore and independent back navigation',async({page})=>{
  await page.evaluate(()=>{const state=(window as any).__mobileState;state.files['引用.md']={content:'[第一章](读书笔记/第一章.md)\n\n```txt\n[原样](读书笔记/第一章.md)\n```',updated:Date.now()};window.dispatchEvent(new Event('moyu-mobile-resume'));});
  await page.getByRole('button',{name:'读书笔记 1 项',exact:true}).click();await page.getByRole('button',{name:'操作 第一章.md',exact:true}).click();await page.getByRole('button',{name:'重命名',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('第二章.md');await page.getByRole('button',{name:'确定',exact:true}).click();
  await expect(page.getByRole('button',{name:/第二章/}).first()).toBeVisible();
  const content=await page.evaluate(()=>(window as any).__mobileState.files['引用.md'].content);expect(content).toContain('[第一章](读书笔记/第二章.md)');expect(content).toContain('[原样](读书笔记/第一章.md)');
  await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await page.getByLabel('搜索笔记').fill('重要内容');
  await expect(page.locator('.mobile-search-results article')).toHaveCount(1);await page.locator('.mobile-search-match').click();await expect(page.locator('.reading-view')).toContainText('重要内容');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'清空搜索',exact:true}).click();await page.getByRole('button',{name:'操作 引用.md',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'移入回收站',exact:true}).click();await expect(page.getByRole('button',{name:'操作 引用.md',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'回收站',exact:true}).click();await page.getByRole('button',{name:'恢复',exact:true}).click();await expect(page.getByText('回收站为空。')).toBeVisible();
});

test('Save conflicts retain the current buffer, show diff and allow a deliberate resolution',async({page})=>{
  await page.getByRole('button',{name:'开始使用',exact:false}).first().click();await page.getByRole('tab',{name:'源码',exact:true}).click();
  const source=page.locator('.source-editor .cm-content');await source.focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n本地新增');
  await page.evaluate(()=>{(window as any).__mobileState.files['开始使用.md']={content:'# 云端修改\n\n其他应用的新内容',updated:Date.now()};});
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.getByRole('button',{name:'查看差异',exact:true})).toBeVisible();await expect(source).toContainText('本地新增');
  await page.getByRole('button',{name:'查看差异',exact:true}).click();await expect(page.getByRole('dialog',{name:'文档差异'})).toBeVisible();await expect(page.locator('.history-diff-editors [data-side=left]')).toContainText('云端修改');
  await page.getByRole('button',{name:'保留当前内容',exact:true}).click();await expect(page.getByRole('dialog',{name:'文档差异'})).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.files['开始使用.md'].content)).toContain('本地新增');
});

test('Every file open resets to reading, including HTML, plain text and an already opened document',async({page})=>{
  await page.evaluate(()=>{const state=(window as any).__mobileState;state.files['页面.html']={content:'<h1>页面内容</h1>',updated:Date.now()};state.files['记录.txt']={content:'纯文字内容',updated:Date.now()};window.dispatchEvent(new Event('moyu-mobile-resume'));});
  for(const name of ['开始使用','记录','页面','开始使用']){
    await page.locator('.mobile-file-list .mobile-file-open').filter({has:page.locator('strong',{hasText:new RegExp('^'+name+'$')})}).click();
    await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.source-editor,.ProseMirror')).toHaveCount(0);
    await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toBeVisible();
    await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  }
});

test('Move uses a folder picker and updates the inventory without requiring a typed path',async({page})=>{
  await page.getByRole('button',{name:'操作 开始使用.md',exact:true}).click();await page.getByRole('button',{name:'移动',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'移动到文件夹',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'移到这里',exact:true})).toBeDisabled();
  await page.getByRole('dialog').getByRole('button',{name:'读书笔记',exact:true}).click();await page.getByRole('button',{name:'移到这里',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__mobileState.files['读书笔记/开始使用.md'].content)).toContain('开始使用');
});

for(const theme of ['light','dark'])test(`Phone and tablet touch layouts and theme (${theme})`,async({page})=>{
  await page.getByRole('button',{name:'设置',exact:true}).click();await selectMobile(page,'外观',theme);await page.getByRole('button',{name:'笔记',exact:true}).click();
  await page.screenshot({path:path.join(work,`android-home-${theme}.png`)});
  await page.getByRole('button',{name:'开始使用',exact:false}).first().click();await expect(page.locator('.reading-view')).toBeVisible();
  for(const size of [{width:360,height:740},{width:800,height:600}]){await page.setViewportSize(size);expect(await page.locator('.mobile-app').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
  await page.setViewportSize({width:393,height:851});await page.screenshot({path:path.join(work,`android-reading-${theme}.png`)});
  await page.getByRole('button',{name:'文档操作',exact:true}).click();await expect(page.getByRole('dialog',{name:'文档操作'})).toBeVisible();await page.screenshot({path:path.join(work,`android-sheet-${theme}.png`)});
});
