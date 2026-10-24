import {test,expect,type Page,type Locator} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const content='正文 `inline`\n\n```js\nconsole.log("'+ '长行'.repeat(70)+'");\n```\n\n```tabs {id=0001}\n:::js 第一段\nconsole.log(1);\n:::py 第二段\nprint(2)\n```\n';
const size=(node:Locator)=>node.evaluate(element=>getComputedStyle(element).fontSize);
async function start(page:Page){await mockAndroid(page,{files:{'note.md':{content}}});await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible({timeout:30000});}
async function settings(page:Page){await page.getByRole('button',{name:'返回笔记',exact:true}).tap();await page.getByRole('button',{name:'设置',exact:true}).tap();}
async function open(page:Page){await page.getByRole('button',{name:'笔记',exact:true}).tap();await page.locator('[data-path="note.md"] .mobile-file-open').tap();}

test('Code size is independent, persists and applies to ordinary and tabbed blocks in reading and editing',async({page})=>{
  await start(page);const read=page.locator('.reading-view');expect(await size(read.locator('pre code').first())).toBe('14px');
  await settings(page);await page.getByLabel('代码块字号',{exact:true}).fill('10');await page.getByLabel('正文字号',{exact:true}).fill('20');await open(page);
  for(const code of await read.locator('pre code').all())expect(await size(code)).toBe('10px');expect(await size(read.locator('p').first())).toBe('20px');expect(await size(read.locator('p > code').first())).toBe('18px');
  await page.getByRole('button',{name:'放大字号',exact:true}).tap();expect(await size(read.locator('pre code').first())).toBe('10px');expect(await size(read.locator('p').first())).toBe('21px');
  await page.getByRole('tab',{name:'编辑',exact:true}).tap();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
  for(const scroller of await page.locator('.milkdown-code-block .cm-scroller').all())expect(await size(scroller)).toBe('10px');
  await page.locator('.milkdown-code-block').nth(1).getByRole('tab',{name:'第二段',exact:true}).tap();expect(await size(page.locator('.milkdown-code-block').nth(1).locator('.cm-scroller'))).toBe('10px');
  await page.reload();await expect(read).toBeVisible();expect(await size(read.locator('pre code').first())).toBe('10px');await settings(page);await expect(page.getByLabel('代码块字号',{exact:true})).toHaveValue('10');await page.getByLabel('代码块字号',{exact:true}).fill('24');await open(page);expect(await size(read.locator('pre code').first())).toBe('24px');
  expect(await page.evaluate(()=>(window as any).__mobileState.files['note.md'].content)).toBe(content);expect(await page.evaluate(()=>(window as any).__mobileState.keyboardVisible)).toBe(false);
});

test('Code blocks use compact padding and scroll long lines without squeezing the phone layout',async({page})=>{
  await start(page);await settings(page);await page.getByRole('switch',{name:'代码块自动换行'}).uncheck();await open(page);
  for(const width of [320,393]){
    await page.setViewportSize({width,height:800});const shell=page.locator('.reading-view .code-block-shell').first(),pre=shell.locator('pre');
    expect(await pre.evaluate(element=>getComputedStyle(element).paddingLeft)).toBe('8px');expect(await pre.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);await pre.evaluate(element=>element.scrollLeft=100);expect(await pre.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
    expect(await shell.evaluate(element=>getComputedStyle(element).marginTop)).toBe('12px');expect((await shell.getByRole('button',{name:'复制代码',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await page.locator('.mobile-document').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  }
  await page.screenshot({path:path.resolve(import.meta.dirname,'../../../work/android-code-reading-compact.png')});await page.getByRole('tab',{name:'编辑',exact:true}).tap();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
  for(const block of await page.locator('.milkdown-code-block').all())expect(await block.evaluate(element=>getComputedStyle(element).paddingLeft)).toBe('8px');
  expect(await page.locator('.mobile-document').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:path.resolve(import.meta.dirname,'../../../work/android-code-editing-compact.png')});
});

test('Touch focus leaves no frame after closing a sheet, while hardware Tab still shows focus',async({page})=>{
  await start(page);await page.getByRole('button',{name:'文档操作',exact:true}).tap();const close=page.getByRole('button',{name:'关闭文档操作',exact:true});await close.focus();expect(await close.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');await close.tap();
  const trigger=page.getByRole('button',{name:'文档操作',exact:true});expect(await trigger.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');await page.keyboard.press('Tab');const focused=page.locator(':focus');expect(await focused.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  await settings(page);const select=page.getByLabel('外观',{exact:true});await select.dispatchEvent('pointerdown',{pointerType:'touch'});await select.focus();expect(await select.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');
});

test('Scroll overflow never reserves width in the document, settings or sheets and remains touch-scrollable',async({page,context})=>{
  await start(page);const scroller=page.locator('.mobile-document');const before=await scroller.evaluate(element=>({width:element.clientWidth,left:element.getBoundingClientRect().left}));
  await scroller.evaluate(element=>{const filler=document.createElement('div');filler.id='scroll-qa';filler.style.height='3000px';element.append(filler);});expect(await scroller.evaluate(element=>element.clientWidth)).toBe(before.width);
  const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:650}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:280,y:650-i*35}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>scroller.evaluate(element=>element.scrollTop)).toBeGreaterThan(50);await cdp.detach();
  expect(await scroller.evaluate(element=>getComputedStyle(element).scrollbarWidth)).toBe('none');await page.reload();await expect(page.locator('.reading-view')).toBeVisible();
  await page.getByRole('button',{name:'文档操作',exact:true}).tap();const sheet=page.locator('.mobile-sheet-content'),sheetWidth=await sheet.evaluate(element=>element.clientWidth);await sheet.evaluate(element=>{const filler=document.createElement('div');filler.style.height='3000px';element.append(filler);});expect(await sheet.evaluate(element=>element.clientWidth)).toBe(sheetWidth);await page.getByRole('button',{name:'关闭文档操作',exact:true}).tap();
  await settings(page);const home=page.locator('.mobile-home-content'),homeWidth=await home.evaluate(element=>element.clientWidth);await home.evaluate(element=>{const filler=document.createElement('div');filler.style.height='3000px';element.append(filler);});expect(await home.evaluate(element=>element.clientWidth)).toBe(homeWidth);expect(await home.evaluate(element=>getComputedStyle(element,'::-webkit-scrollbar').width)).toBe('0px');
});
