import {_electron as electron, expect, test, type Page, type Locator} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
 const data=await fs.mkdtemp(path.resolve(project,'../../work/theme-links-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-theme':'light','moyu-save-policy':'manual'}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('.ProseMirror h1')).toBeVisible();
 return {app,page,data,errors};
}
async function open(page:Page,file:string,content:string){await page.evaluate(({file,content})=>window.moyu!.create(file,'file',content),{file,content});await page.locator(`.tree-item[title="${file}"]`).dblclick();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');}
async function select(el:Locator,from:number,to=from){await el.evaluate((el,{from,to})=>{const node=el.firstChild!;const r=document.createRange();r.setStart(node,from);r.setEnd(node,to);const s=getSelection()!;s.removeAllRanges();s.addRange(r);el.closest<HTMLElement>('[contenteditable=true]')!.focus();document.dispatchEvent(new Event('selectionchange'));},{from,to});}
test('Selection context menu inserts editable Markdown; ordinary link clicks reveal source and Ctrl clicks navigate once',async()=>{
 const {app,page,data,errors}=await fixture();
 try{
  await app.evaluate(({ipcMain})=>{(globalThis as any).__external=[];ipcMain.removeHandler('moyu:external');ipcMain.handle('moyu:external',(_event,url)=>{(globalThis as any).__external.push(url);return {ok:true,data:null};});});
  await page.evaluate(()=>window.moyu!.create('目标.md','file','# 目标\n'));
  await fs.writeFile(path.join(data,'示例知识库','图.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="gold"/></svg>');
  await fs.copyFile(path.join(project,'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'),path.join(data,'示例知识库','图.excalidraw'));
  await open(page,'链接.md','选择文字\n\n[普通链接](目标.md)\n\n[**加粗链接**](目标.md)\n\n[网页](https://example.com/)\n\nhttps://example.org\n\n![图](图.svg)\n\n[绘图](图.excalidraw)\n\n结束段落\n');
  const first=page.locator('.ProseMirror > p').first();await first.click();await select(first,0,4);
  await expect(page.locator('.milkdown-toolbar')).toHaveCount(0);
  await first.click({button:'right',position:{x:8,y:8}});
  await page.getByRole('menuitemcheckbox',{name:'链接',exact:true}).click();
  const source=first.locator('.syntax-raw');await expect(source).toHaveText('[选择文字]()');
  await page.keyboard.insertText('目标.md');await expect(source).toHaveText('[选择文字](目标.md)');
  await expect(page.locator('.milkdown-link-edit,.milkdown-link-preview')).toHaveCount(0);
  await page.locator('.ProseMirror > p').last().click();
  for(const label of ['选择文字','普通链接','加粗链接','网页','https://example.org']){
   const link=page.locator('.syntax-preview a').filter({hasText:label});await link.click();
   await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','链接.md');
   await expect(page.locator('.inline-syntax.editing .syntax-raw')).toBeVisible();
   await page.locator('.ProseMirror > p').last().click();
  }
  const image=page.locator('.attachment-overlay').filter({has:page.locator('img')});await expect(image).toBeVisible();await image.click();
  await expect(page.locator('.visual-attachment.editing .syntax-raw')).toHaveText('![图](图.svg)');
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','链接.md');
  await page.locator('.ProseMirror > p').last().click();
  expect(await app.evaluate(()=>(globalThis as any).__external)).toEqual([]);
  await page.evaluate(()=>{(window as any).__links=[];window.addEventListener('moyu-open-link',e=>(window as any).__links.push((e as CustomEvent).detail));});
  await page.locator('.syntax-preview a').filter({hasText:'普通链接'}).click({modifiers:['Control']});
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','目标.md');
  expect(await page.evaluate(()=>(window as any).__links.map((v:any)=>v.href))).toEqual(['目标.md']);
  await page.locator('.tab-name[title="链接.md"]').click();
  await expect(page.locator('.ProseMirror > p').first().locator('.syntax-raw')).toHaveText('[选择文字](目标.md)');
  await page.getByRole('button',{name:'本地未保存',exact:true}).click();
  await expect.poll(()=>fs.readFile(path.join(data,'示例知识库','链接.md'),'utf8')).toContain('[选择文字](目标.md)');
  await page.locator('.ProseMirror > p').last().click();
  await image.click({modifiers:['Control']});
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','图.svg');
  expect(await page.evaluate(()=>(window as any).__links.map((v:any)=>v.href))).toEqual(['目标.md','图.svg']);
  await page.locator('.tab-name[title="链接.md"]').click();
  await page.locator('.ProseMirror > p').last().click();
  await page.locator('.attachment-overlay').filter({has:page.locator('svg')}).click();
  await expect(page.locator('.inline-syntax.editing .syntax-raw')).toHaveText('[绘图](图.excalidraw)');
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','链接.md');
  await page.locator('.ProseMirror > p').last().click();
  await page.locator('.attachment-overlay').filter({has:page.locator('svg')}).click({modifiers:['Control']});
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','图.excalidraw');
  expect(await page.evaluate(()=>(window as any).__links.map((v:any)=>v.href))).toEqual(['目标.md','图.svg','图.excalidraw']);
  await page.locator('.tab-name[title="链接.md"]').click();
  const regular=page.locator('.syntax-preview a').filter({hasText:'普通链接'});await regular.click();
  const raw=page.locator('.inline-syntax.editing .syntax-raw').filter({hasText:'[普通链接](目标.md)'});
  await raw.click({modifiers:['Control']});await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','目标.md');
  expect(await page.evaluate(()=>(window as any).__links.length)).toBe(4);
  await page.locator('.tab-name[title="链接.md"]').click();await page.locator('.ProseMirror > p').last().click();
  await page.locator('.syntax-preview a').filter({hasText:'网页'}).click({modifiers:['Control']});
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__external)).toEqual(['https://example.com/']);
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','链接.md');
  expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
