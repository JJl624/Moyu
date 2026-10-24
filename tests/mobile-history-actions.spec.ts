import {test,expect} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';

for(const mode of ['源码','编辑'])test(`${mode}: upper undo and redo preserve focus instead of opening the keyboard`,async({page})=>{
  await mockAndroid(page,{files:{'history.md':{content:'原文'}}});await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'撤销',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:mode,exact:true}).click();const host=page.locator(mode==='源码'?'.source-editor':'.editor-host');await expect(host).not.toHaveAttribute('data-editor-pending','true');const content=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await expect(content).toBeVisible();
  const toolbar=page.getByRole('toolbar',{name:'文本格式'});await expect(toolbar.getByRole('button',{name:'撤销',exact:true})).toHaveCount(0);await expect(toolbar.getByRole('button',{name:'重做',exact:true})).toHaveCount(0);
  for(const width of [320,393]){await page.setViewportSize({width,height:740});for(const name of ['撤销','重做']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!,document=(await page.locator('.mobile-document').boundingBox())!;expect(box.y+box.height).toBeLessThanOrEqual(document.y);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.width).toBeGreaterThanOrEqual(44);}}
  await content.tap();await page.keyboard.press('End');await page.keyboard.insertText('新增');await expect(content).toHaveText('原文新增');await content.evaluate(element=>(element as HTMLElement).blur());
  const focused=()=>page.evaluate(()=>!!document.activeElement?.closest('.ProseMirror,.cm-content'));
  expect(await focused()).toBe(false);await page.getByRole('button',{name:'撤销',exact:true}).tap();await expect(content).toHaveText('原文');expect(await focused()).toBe(false);await page.getByRole('button',{name:'重做',exact:true}).tap();await expect(content).toHaveText('原文新增');expect(await focused()).toBe(false);
  await content.tap();await expect.poll(focused).toBe(true);await page.getByRole('button',{name:'撤销',exact:true}).tap();await expect(content).toHaveText('原文');expect(await focused()).toBe(true);await page.getByRole('button',{name:'重做',exact:true}).tap();await expect(content).toHaveText('原文新增');expect(await focused()).toBe(true);
  // Android Back hides the IME while leaving this DOM focused.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('moyu-mobile-keyboard',{detail:false})));expect(await focused()).toBe(true);await page.getByRole('button',{name:'撤销',exact:true}).tap();await expect(content).toHaveText('原文');expect(await focused()).toBe(false);await page.getByRole('button',{name:'重做',exact:true}).tap();await expect(content).toHaveText('原文新增');expect(await focused()).toBe(false);
});
