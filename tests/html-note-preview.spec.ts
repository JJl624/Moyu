import {_electron as electron,test,expect} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('HTML fences keep the ordinary language menu and can return to another code language',async()=>{
  const project=path.resolve(import.meta.dirname,'..'),base=path.resolve(project,'../../work/e2e');await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'html-language-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1',MOYU_TEST_SKIP_BUNDLED:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env});
  try{
    const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));await expect(page.locator('.ProseMirror')).toBeVisible();
    const code='<button id="demo">Preview</button>',original='```text {id=00ab preview=pin previewHeight=220}\n'+code+'\n```';
    await page.evaluate(({original})=>window.moyu!.create('HTML语言.md','file',original),{original});await page.locator('.tree-item[title="HTML语言.md"]').dblclick();
    await page.getByRole('button',{name:'预览编辑',exact:true}).click();
    const block=page.locator('.milkdown-code-block'),language=block.locator('button.language-button');await language.click();
    const menu=block.locator('.code-language-menu'),search=menu.getByPlaceholder('搜索语言');await expect(search).toBeFocused();await search.fill('html');
    await menu.getByRole('option',{name:'HTML',exact:true}).click();await expect(block).toHaveAttribute('data-html-code','true');await expect(block.frameLocator('iframe').locator('#demo')).toBeVisible();
    const switchGeometry=()=>block.getByRole('tablist',{name:'HTML 视图',exact:true}).evaluate(element=>{const owner=element.closest('.milkdown-code-block')!.getBoundingClientRect(),box=element.getBoundingClientRect();return{x:box.x-owner.x,y:box.y-owner.y,width:box.width,height:box.height};});
    const previewSwitch=await switchGeometry();
    await expect(language).toBeHidden();await expect(block.locator('.copy-button')).toBeHidden();
    await block.getByRole('tab',{name:'HTML 源码',exact:true}).click();await expect(block.locator('.code-attributes-input')).toBeVisible();await expect(block.locator('.copy-button')).toBeVisible();
    const sourceSwitch=await switchGeometry();for(const key of ['x','y','width','height'] as const)expect(Math.abs(sourceSwitch[key]-previewSwitch[key])).toBeLessThanOrEqual(.75);
    const buttonBox=(await block.locator('.tools').boundingBox())!,toolsBox=(await block.locator('.html-note-tools').boundingBox())!;
    expect(buttonBox.x+buttonBox.width).toBeLessThanOrEqual(toolsBox.x+1);
    await language.click();await search.fill('javascript');
    await search.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});await expect(menu).toBeVisible();
    await menu.getByRole('option',{name:'JavaScript',exact:true}).click();
    await expect(block.locator('.html-preview-ui')).toHaveCount(0);await expect(block).not.toHaveAttribute('data-html-source');await expect(block.locator('.cm-content')).toHaveText(code);await expect(block.locator('.code-id')).toHaveText('00ab');
    expect((await page.evaluate(async()=>window.moyu!.read('HTML语言.md'))) as any).toMatchObject({ok:true,data:{content:original}});
  }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});}
});

test('Desktop HTML notes share the portable preview, preserve the live page when pinned and save their dimensions in Markdown',async()=>{
  test.setTimeout(120000);
  const project=path.resolve(import.meta.dirname,'..'),base=path.resolve(project,'../../work/e2e');await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'html-note-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1',MOYU_TEST_SKIP_BUNDLED:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env});
  try{
    const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.evaluate(()=>window.moyu!.create('HTML预览测试.md','file','```html\n<button id="demo" onclick="this.textContent=\'已点击\'">点击</button>\n```\n\n尾段'));
    await page.locator('.tree-item[title="HTML预览测试.md"]').dblclick();await page.getByRole('button',{name:'阅读',exact:true}).click();await page.getByRole('tab',{name:'预览 HTML',exact:true}).click();
    const frame=page.frameLocator('.html-note-window iframe');await expect(frame.locator('#demo')).toBeVisible();await frame.locator('#demo').evaluate(element=>(element as HTMLButtonElement).click());await expect(frame.locator('#demo')).toHaveText('已点击');
    const block=page.locator('.reading-view .code-block-shell'),bar=page.locator('.html-note-tools');expect(Math.abs((await bar.boundingBox())!.y-(await block.boundingBox())!.y)).toBeLessThanOrEqual(2);await expect(block.locator('pre')).toBeHidden();
    await page.getByRole('button',{name:'钉住 HTML 预览',exact:true}).click();await expect(page.getByRole('button',{name:'取消钉住 HTML 预览',exact:true})).toBeVisible();await expect(frame.locator('#demo')).toHaveText('已点击');
    const height=page.getByRole('separator',{name:'调整 HTML 预览高度',exact:true});await height.focus();await page.keyboard.press('ArrowDown');await expect(height).toHaveAttribute('aria-valuenow','290');await expect(frame.locator('#demo')).toHaveText('已点击');
    await page.getByTitle('保存当前文档',{exact:true}).click();await expect.poll(()=>page.evaluate(async()=>((await window.moyu!.read('HTML预览测试.md')) as any).data.content)).toContain('previewHeight=290');
    const stored=await page.evaluate(async()=>((await window.moyu!.read('HTML预览测试.md')) as any).data);expect(stored.content).toContain('preview=pin');const offset=await page.locator('.reading-view p').filter({hasText:'尾段'}).getAttribute('data-source-from');expect(Number(offset)).toBe(stored.content.indexOf('尾段'));
    await page.getByRole('tab',{name:'HTML 源码',exact:true}).click();await expect(block.locator('pre')).toBeVisible();await expect(page.locator('.html-note-window')).toHaveCount(0);
    await page.getByRole('tab',{name:'预览 HTML',exact:true}).click();await expect(block.locator('pre')).toBeHidden();await expect(frame.locator('#demo')).toHaveText('点击');
    await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toContainText('preview=pin');
  }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});}
});
