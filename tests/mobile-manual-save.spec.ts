import {selectMobile} from './helpers/mobile-controls.mjs';
import {test,expect,type Page} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';
const scene=JSON.stringify({type:'excalidraw',version:2,source:'Moyu',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}});
async function start(page:Page){
  await mockAndroid(page,{files:{'开始使用.md':{content:'原文'},'另一篇.md':{content:'另一篇原文'},'画图.excalidraw':{content:scene}}});
  await page.addInitScript(()=>{(window as any).__mobileState.settings['moyu-save-policy']='manual';});
  await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
}
async function disk(page:Page,path='开始使用.md'){return page.evaluate(path=>(window as any).__mobileState.files[path].content,path);}
async function pause(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-pause')));await page.waitForTimeout(1200);}
async function open(page:Page,path:string){await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.locator('[data-path="'+path+'"] .mobile-file-open').click();}

test('Manual text remains a private draft through view changes, navigation, background, sync settings and restart',async({page})=>{
  await start(page);await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('手动草稿');
  await page.getByRole('tab',{name:'阅读',exact:true}).click();await pause(page);expect(await disk(page)).toBe('原文');
  await open(page,'另一篇.md');expect(await disk(page)).toBe('原文');await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();expect(await disk(page)).toBe('原文');await page.getByRole('button',{name:'返回设置',exact:true}).click();
  await page.reload();await open(page,'开始使用.md');await expect(page.locator('.reading-view')).toContainText('手动草稿');expect(await disk(page)).toBe('原文');
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(()=>disk(page)).toBe('手动草稿');
});

test('Saving the current document does not save other manual drafts; discard clears recovery without writing files',async({page})=>{
  await start(page);await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('不要保存');await open(page,'另一篇.md');await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('保存另一篇');await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(()=>disk(page,'另一篇.md')).toBe('保存另一篇');expect(await disk(page)).toBe('原文');
  await page.locator('.mobile-document-title').click();await page.getByRole('button',{name:'关闭 开始使用',exact:true}).click();const prompt=page.getByRole('dialog',{name:'未保存的修改'});await expect(prompt).toBeVisible();await prompt.getByRole('button',{name:'取消',exact:true}).click();expect(await disk(page)).toBe('原文');
  await page.getByRole('button',{name:'关闭 开始使用',exact:true}).click();await prompt.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(page.getByRole('button',{name:'关闭 开始使用',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__mobileState.drafts['开始使用.md'])).toBeUndefined();
  await page.reload();expect(await disk(page)).toBe('原文');
});

test('Drawing edits never auto-save in manual mode, including an actual canvas edit and background event',async({page})=>{
  test.setTimeout(90000);await start(page);await open(page,'画图.excalidraw');await page.getByRole('tab',{name:'编辑',exact:true}).click();
  const canvas=page.locator('.excalidraw canvas.interactive');await expect(canvas).toBeVisible();
  await page.locator('label').filter({has:page.getByTestId('toolbar-rectangle')}).click();const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+80,box.y+250);await page.mouse.down();await page.mouse.move(box.x+220,box.y+350,{steps:8});await page.mouse.up();
  await expect(page.locator('.mobile-document-title small')).toHaveText('未保存');await pause(page);expect(await disk(page,'画图.excalidraw')).toBe(scene);
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('dialog',{name:'同步前处理修改'})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await expect(page.getByRole('button',{name:'返回设置',exact:true})).toBeVisible();expect(await disk(page,'画图.excalidraw')).toBe(scene);await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="画图.excalidraw"] .mobile-file-open').click();
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(async()=>JSON.parse(await disk(page,'画图.excalidraw')).elements.length).toBe(1);
});

test('A recovered manual draft conflicting with disk stays unsaved and creates no extra knowledge-base file',async({page})=>{
  await mockAndroid(page,{files:{'开始使用.md':{content:'云端新内容'}}});await page.addInitScript(()=>{const state=(window as any).__mobileState;state.settings['moyu-save-policy']='manual';state.drafts['开始使用.md']={root:'internal',path:'开始使用.md',content:'本机未保存内容',version:'old'};});await page.goto('/mobile.html');await expect(page.locator('.mobile-conflict')).toBeVisible();await expect(page.locator('.reading-view')).toContainText('本机未保存内容');await pause(page);expect(await disk(page)).toBe('云端新内容');expect(await page.evaluate(()=>Object.keys((window as any).__mobileState.files))).toEqual(['开始使用.md']);
});

for(const policy of ['close','realtime'])test(`${policy}: automatic background saving remains available outside manual mode`,async({page})=>{
  await start(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await selectMobile(page,'保存方式',policy);await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="开始使用.md"] .mobile-file-open').click();await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('仍可自动保存');await pause(page);expect(await disk(page)).toBe('仍可自动保存');
});

test('Manual close can explicitly save; Android Back cancels a pending confirmation without saving',async({page})=>{
  await start(page);await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('确认保存');await page.locator('.mobile-document-title').click();await page.getByRole('button',{name:'关闭 开始使用',exact:true}).click();await expect(page.getByRole('dialog',{name:'未保存的修改'})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(page.getByRole('dialog',{name:'未保存的修改'})).toHaveCount(0);expect(await disk(page)).toBe('原文');await page.getByRole('button',{name:'关闭 开始使用',exact:true}).click();await page.getByRole('button',{name:'保存并继续',exact:true}).click();await expect.poll(()=>disk(page)).toBe('确认保存');
});
