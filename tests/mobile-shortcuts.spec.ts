import {test,expect} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';

test('Shortcut order can be changed from the format sheet, survives restart and retains the selected text',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');await source.fill('排序后加粗');await source.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('button',{name:'自定义工具栏',exact:true}).click();const sorting=page.getByRole('dialog',{name:'编辑工具栏'});await expect(sorting).toBeVisible();await sorting.getByRole('button',{name:'下移 加粗',exact:true}).click();
  await expect(sorting.locator('[data-shortcut]').first()).toHaveAttribute('data-shortcut','italic');await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(page.getByRole('dialog',{name:'全部格式'})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'加粗',exact:true}).click();await expect(source).toHaveText('**排序后加粗**');
  await expect(page.getByRole('toolbar',{name:'文本格式'}).getByRole('button').first()).toHaveAttribute('aria-label','斜体');await page.getByRole('button',{name:'保存文档',exact:true}).click();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'编辑工具栏',exact:true}).click();await expect(sorting.locator('[data-shortcut]').first()).toHaveAttribute('data-shortcut','italic');await page.getByRole('button',{name:'关闭编辑工具栏',exact:true}).click();
  await page.reload();await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.getByRole('toolbar',{name:'文本格式'}).getByRole('button').first()).toHaveAttribute('aria-label','斜体');await expect(source).toHaveText('**排序后加粗**');
});

test('The reorder handle supports real touch dragging; only the handle captures a gesture',async({page,context})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'编辑工具栏',exact:true}).click();
  const first=(await page.getByRole('button',{name:'拖动排序 加粗',exact:true}).boundingBox())!,target=(await page.locator('[data-shortcut="highlight"]').boundingBox())!,cdp=await context.newCDPSession(page);
  const x=first.x+first.width/2,y=first.y+first.height/2,to=target.y+target.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(to-y)*step/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await expect(page.locator('[data-shortcut]').nth(3)).toHaveAttribute('data-shortcut','bold');await page.getByRole('button',{name:'恢复默认工具栏',exact:true}).click();await expect(page.locator('[data-shortcut]').first()).toHaveAttribute('data-shortcut','bold');
});

test('Explicit fold defaults change the nearest quote only and do not change markers inside code',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');
  await source.fill('> [-] 一级\n> 内容\n>\n> > [+] 二级\n> > 二级内容\n');await source.focus();await page.keyboard.press('Control+Home');for(let index=0;index<4;index++)await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'默认折叠',exact:true}).click();await expect(source).toContainText('> [-] 一级');await expect(source).toContainText('> > [-] 二级');
  const result=await page.evaluate(async()=>{const{sourceFoldAt}=await import('/src/mobile/foldQuote.ts');return[sourceFoldAt('```txt\n> [-] 文字\n```',15),sourceFoldAt('> \\[-] 普通引用',10)];});expect(result).toEqual([null,null]);
});

test('Any format can be pinned, removed and reordered without a limit; the plus menu always stays complete',async({page,context})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.getByRole('tab',{name:'源码',exact:true}).click();await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('button',{name:'自定义工具栏',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'编辑工具栏'});
  for(const label of ['行内公式','链接','折叠引用','表格','代码块','标签页','一级标题','无序列表','插入附件'])await panel.getByRole('button',{name:'添加 '+label,exact:true}).click();
  await expect(panel.locator('[data-shortcut]')).toHaveCount(15);await panel.getByRole('button',{name:'移除 删除线',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await page.getByRole('button',{name:'关闭全部格式',exact:true}).click();
  const toolbar=page.getByRole('toolbar',{name:'文本格式'});await expect(toolbar.getByRole('button')).toHaveCount(15);
  expect(await toolbar.locator('.mobile-format-scroll').evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
  const before=await page.locator('.source-editor .cm-content').innerText(),box=(await toolbar.locator('.mobile-format-scroll').boundingBox())!,cdp=await context.newCDPSession(page),x=box.x+box.width-20,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*20,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>toolbar.locator('.mobile-format-scroll').evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);expect(await page.locator('.source-editor .cm-content').innerText()).toBe(before);await cdp.detach();
  await toolbar.getByRole('button',{name:'标签页',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toContainText('```tabs');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'删除线',exact:true})).toBeVisible();await page.getByRole('button',{name:'自定义工具栏',exact:true}).click();
  while(await panel.getByRole('button',{name:/^移除 /}).count())await panel.getByRole('button',{name:/^移除 /}).first().click();await expect(panel.locator('[data-shortcut]')).toHaveCount(0);await page.getByRole('button',{name:'关闭编辑工具栏',exact:true}).click();await page.reload();await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(toolbar.getByRole('button')).toHaveCount(1);await expect(toolbar.getByRole('button',{name:'全部格式',exact:true})).toBeVisible();
});

test('Attachment insertion belongs to the complete insert menu and preserves the selection',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');await source.fill('前面后面');await source.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:'插入附件',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'插入附件',exact:true}).click();await expect(source).toContainText('前面![图片.svg]');await expect(source).toContainText('后面');
});
