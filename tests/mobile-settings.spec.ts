import {selectMobile} from './helpers/mobile-controls.mjs';
import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const work=path.resolve(import.meta.dirname,'../../../work');
async function settings(page:Page){await mockAndroid(page);await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();}

test('Settings group related controls, align rows and preserve touch targets on a narrow phone',async({page})=>{
  await settings(page);await expect(page.locator('.mobile-settings-group > h2')).toHaveText(['界面','字体与排版','编辑','文件与同步','软件更新']);
  for(const width of [320,393,740]){
    await page.setViewportSize({width,height:800});
    const geometry=await page.locator('.mobile-setting-row').evaluateAll(rows=>rows.map(row=>{const label=row.querySelector('span')!.getBoundingClientRect(),control=row.querySelector('[role=combobox],input')!.getBoundingClientRect();return{height:row.getBoundingClientRect().height,label:label.x,control:control.x,right:control.right};}));
    for(const row of geometry){expect(row.height).toBeGreaterThanOrEqual(48);expect(row.right).toBeLessThanOrEqual(width);expect(Math.abs(row.label-geometry[0].label)).toBeLessThan(1);}
    for(const field of await page.locator('.mobile-setting-row input:not([type=checkbox]),.mobile-setting-row [role=combobox]').all())expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.mobile-home-content').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  }
  await page.setViewportSize({width:393,height:851});await page.screenshot({path:path.join(work,'android-settings-light.png')});
  await selectMobile(page,'外观','dark');await page.screenshot({path:path.join(work,'android-settings-dark.png')});
});

test('All settings remain usable with large UI text; values persist and file actions remain reachable',async({page})=>{
  await settings(page);await page.setViewportSize({width:320,height:568});await page.getByLabel('界面字号',{exact:true}).fill('24');await page.getByLabel('正文字号',{exact:true}).fill('10');await page.getByLabel('行高',{exact:true}).fill('2.4');await page.getByLabel('表格缩放',{exact:true}).fill('150');await selectMobile(page,'保存方式','close');
  expect(await page.locator('.mobile-home-content').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  for(const control of await page.locator('.mobile-setting-row input:not([type=checkbox]),.mobile-setting-row [role=combobox]').all()){await control.scrollIntoViewIfNeeded();const box=(await control.boundingBox())!;expect(box.width).toBeGreaterThan(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);}
  await page.getByRole('button',{name:'编辑工具栏',exact:true}).click();await page.getByRole('button',{name:'关闭编辑工具栏',exact:true}).click();await page.getByRole('button',{name:'选择知识库',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭知识库',exact:true}).click();await page.getByRole('button',{name:'回收站',exact:true}).click();await expect(page.getByRole('dialog',{name:'回收站',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭回收站',exact:true}).click();
  await page.locator('.mobile-home-content').evaluate(element=>element.scrollTop=0);await page.screenshot({path:path.join(work,'android-settings-large-text.png')});await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  for(const [label,value]of [['界面字号','24'],['正文字号','10'],['行高','2.4'],['表格缩放','150'],['保存方式','close']])if(label==='保存方式')await expect(page.getByRole('combobox',{name:label,exact:true})).toHaveAttribute('data-value',value);else await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
});

test('WebDAV options separate automation, content and network; toggles and compact numeric fields persist',async({page})=>{
  await settings(page);await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByText('同步选项',{exact:true}).click();await expect(page.locator('.mobile-sync-option-group > h3')).toHaveText(['自动同步','同步内容','网络']);
  await page.setViewportSize({width:320,height:740});await page.getByLabel('启动或回到前台时同步',{exact:true}).check();await page.getByLabel('保存后同步',{exact:true}).check();await page.getByLabel('定时同步间隔',{exact:true}).fill('5');await page.getByLabel('请求超时',{exact:true}).fill('30');await page.getByLabel('失败重试次数',{exact:true}).fill('2');await page.getByLabel('单文件大小上限',{exact:true}).fill('64');await selectMobile(page,'删除策略','keep');await page.getByLabel('排除规则',{exact:true}).fill('*.tmp\n草稿/');await page.getByLabel('排除规则',{exact:true}).blur();
  expect(await page.locator('.mobile-home-content').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  for(const input of await page.locator('.mobile-sync-option fieldset input').all())expect((await input.boundingBox())!.width).toBeLessThan(105);
  for(const unit of await page.locator('.mobile-sync-option fieldset small').all())expect(await unit.evaluate(element=>element.getBoundingClientRect().height<=parseFloat(getComputedStyle(element).lineHeight)+1)).toBe(true);
  await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByText('同步选项',{exact:true}).click();await expect(page.getByLabel('启动或回到前台时同步',{exact:true})).toBeChecked();await expect(page.getByLabel('定时同步间隔',{exact:true})).toHaveValue('5');await expect(page.getByLabel('请求超时',{exact:true})).toHaveValue('30');await expect(page.getByRole('combobox',{name:'删除策略',exact:true})).toHaveAttribute('data-value','keep');await expect(page.getByLabel('排除规则',{exact:true})).toHaveValue('*.tmp\n草稿/');await page.locator('.mobile-sync-options summary').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(work,'android-settings-sync.png')});
});

test('Vertical touch scrolling across a font slider does not change it; horizontal adjustment still works',async({page,context})=>{
  await settings(page);await page.getByLabel('正文字号',{exact:true}).scrollIntoViewIfNeeded();const slider=page.getByLabel('正文字号',{exact:true}),box=(await slider.boundingBox())!,cdp=await context.newCDPSession(page);
  const x=box.x+8,y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(slider).toHaveValue('17');
  await slider.scrollIntoViewIfNeeded();const next=(await slider.boundingBox())!,start=next.x+next.width/2,top=next.y+next.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y:top}]});for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+step*6,y:top}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(slider).not.toHaveValue('17');await cdp.detach();
});

test('Page size controls sit beside view tabs, respect bounds and leave UI size, file content and keyboard alone',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await page.setViewportSize({width:320,height:740});
  for(const mode of ['阅读','编辑','源码']){
    await page.getByRole('tab',{name:mode,exact:true}).click();await page.getByRole('button',{name:'放大字号',exact:true}).click();await expect(page.getByRole('group',{name:'页面字号 18 px'})).toBeVisible();await page.getByRole('button',{name:'缩小字号',exact:true}).click();
    const boxes=await page.locator('.mobile-mode-bar button,.mobile-editor-header button').evaluateAll(elements=>elements.map(element=>{const b=element.getBoundingClientRect();return{x:b.x,right:b.right};}));for(const box of boxes){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(320);}
    expect(await page.evaluate(()=>(window as any).__mobileState.keyboardVisible)).toBe(false);
  }
  await expect(page.locator('.mobile-document-title small')).toHaveText('已保存');for(let i=0;i<7;i++)await page.getByRole('button',{name:'缩小字号',exact:true}).click();await expect(page.getByRole('button',{name:'缩小字号',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('正文字号',{exact:true})).toHaveValue('10');await expect(page.getByLabel('界面字号',{exact:true})).toHaveValue('14');
});
