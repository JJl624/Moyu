import {_electron as electron, expect, test, type Page} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseBlocks} from '../shared/code-documents.mjs';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const base=path.resolve(project,'../../work/e2e');await fs.mkdir(base,{recursive:true});
  const data=await fs.mkdtemp(path.join(base,'performance-attachments-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return{app,page,data,root:path.join(data,'示例知识库'),errors};
}
async function open(page:Page,file:string,content:string){
  const result:any=await page.evaluate(v=>window.moyu!.create(v.file,'file',v.content),{file,content});expect(result.ok).toBe(true);
  await page.locator('.tree-item[title="'+file+'"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title',file);
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
}
test('Local attachment deletion uses confirmation and recycling from preview, raw link and reading menus; remote links offer no deletion',async()=>{
  const{app,page,root,data,errors}=await fixture();
  try{
    // Isolate the real recycling transaction without adding test data to the OS recycle bin.
    await app.evaluate(async({shell},base)=>{
      const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');await fs.mkdir(path.join(base,'recycled'),{recursive:true});
      shell.trashItem=async file=>{await fs.rename(file,path.join(base,'recycled',path.basename(file)));};
    },data);
    for(const name of ['中文 图片.svg','阅读图片.svg'])await fs.writeFile(path.join(root,name),'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="orange"/></svg>');
    await fs.writeFile(path.join(root,'附件.txt'),'附件内容');
    await page.evaluate(()=>window.moyu!.feature('drawing.create',{path:'绘图.excalidraw'}));
    const markdown='![图片](<中文 图片.svg>)\n\n![阅读图片](阅读图片.svg)\n\n[绘图](绘图.excalidraw)\n\n[文本附件](附件.txt)\n\n[远程](https://example.com/photo.png)\n\n结束';
    await open(page,'删除附件.md',markdown);
    const menu=page.getByRole('menuitem',{name:'删除附件',exact:true}),confirm=page.getByRole('dialog').getByRole('button',{name:'移至回收站',exact:true});
    await page.locator('.attachment-overlay img').first().click({button:'right'});await menu.click();
    await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    await expect(page.locator('.attachment-overlay img')).toHaveCount(2);
    expect(await fs.readFile(path.join(root,'中文 图片.svg'),'utf8')).toContain('<svg');
    await page.locator('.attachment-overlay img').first().click();
    await page.locator('.visual-attachment').first().locator('.syntax-raw').click({button:'right'});await menu.click();await confirm.click();
    // The transaction stages the file before recycling it. Wait for the UI to
    // commit the complete deletion, not just for the original path to vanish.
    await expect(page.locator('.visual-attachment')).toHaveCount(2);
    await expect.poll(()=>fs.access(path.join(root,'中文 图片.svg')).then(()=>true,()=>false)).toBe(false);
    const recycled=(await fs.readdir(path.join(data,'recycled'),{recursive:true})).find(p=>p.endsWith('中文 图片.svg'));
    expect(recycled).toBeTruthy();expect(await fs.readFile(path.join(data,'recycled',recycled!),'utf8')).toContain('<svg');
    await page.getByRole('button',{name:'阅读',exact:true}).click();
    await page.locator('.reading-view img').first().click({button:'right'});await menu.click();await confirm.click();
    await expect.poll(()=>fs.access(path.join(root,'阅读图片.svg')).then(()=>true,()=>false)).toBe(false);
    await page.locator('.reading-view .resource-preview svg').click({button:'right'});await menu.click();await confirm.click();
    await expect.poll(()=>fs.access(path.join(root,'绘图.excalidraw')).then(()=>true,()=>false)).toBe(false);
    await page.locator('.reading-view a').filter({hasText:'文本附件'}).click({button:'right'});await menu.click();await confirm.click();
    await expect.poll(()=>fs.access(path.join(root,'附件.txt')).then(()=>true,()=>false)).toBe(false);
    await page.locator('.reading-view a').filter({hasText:'远程'}).click({button:'right'});await expect(menu).toHaveCount(0);await page.keyboard.press('Escape');
    expect(await fs.readFile(path.join(root,'删除附件.md'),'utf8')).toBe(markdown);
    await page.getByRole('button',{name:'源码',exact:true}).click();
    const source=page.locator('.source-editor .cm-content');
    await expect(source).not.toContainText('中文 图片.svg');
    await expect(source).not.toContainText('阅读图片.svg');
    await expect(source).not.toContainText('绘图.excalidraw');
    await expect(source).not.toContainText('附件.txt');
    await expect(source).toContainText('https://example.com/photo.png');
    await expect(source).toContainText('结束');
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Failed recycling preserves the link; deleting one duplicate preserves surrounding text and respects manual saving',async()=>{
  const{app,page,root,data,errors}=await fixture();
  try{
    await fs.writeFile(path.join(root,'重复.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>');
    const markdown='前文 ![相同](重复.svg) 中间 ![相同](重复.svg) 后文';
    await open(page,'重复.md',markdown);
    const menu=page.getByRole('menuitem',{name:'删除附件',exact:true}),dialog=page.getByRole('dialog');
    await app.evaluate(({shell})=>{shell.trashItem=async()=>{throw new Error('模拟回收站失败');};});
    await page.locator('.attachment-overlay img').nth(1).click({button:'right'});await menu.click();await dialog.getByRole('button',{name:'移至回收站',exact:true}).click();
    await expect(dialog).toContainText('模拟回收站失败');await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await expect(page.locator('.attachment-overlay img')).toHaveCount(2);expect(await fs.readFile(path.join(root,'重复.svg'),'utf8')).toContain('<svg');
    await app.evaluate(async({shell},base)=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');await fs.mkdir(path.join(base,'recycled'),{recursive:true});shell.trashItem=async file=>fs.rename(file,path.join(base,'recycled',path.basename(file)));},data);
    await page.locator('.attachment-overlay img').nth(1).click({button:'right'});await menu.click();await dialog.getByRole('button',{name:'移至回收站',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.locator('.visual-attachment')).toHaveCount(1);
    await expect(page.locator('.ProseMirror')).toContainText('中间');await expect(page.locator('.ProseMirror')).toContainText('后文');
    expect(await fs.readFile(path.join(root,'重复.md'),'utf8')).toBe(markdown);
    await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toHaveText('前文 ![相同](重复.svg) 中间  后文');
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Source attachment deletion removes the clicked link rather than its entire line',async()=>{
  const{app,page,root,data,errors}=await fixture();
  try{
    await fs.writeFile(path.join(root,'源附件.txt'),'文件');
    await app.evaluate(async({shell},base)=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');await fs.mkdir(path.join(base,'recycled'),{recursive:true});shell.trashItem=async file=>fs.rename(file,path.join(base,'recycled',path.basename(file)));},data);
    await open(page,'源码删除.md','前文 [数据](源附件.txt) 后文');await page.getByRole('button',{name:'源码',exact:true}).click();
    const target=page.locator('.source-editor .cm-line').filter({hasText:'前文'});
    const coords=await target.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode,at=node.textContent!.indexOf('数据');if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);const box=range.getBoundingClientRect();return{x:box.x+2,y:box.y+box.height/2};}}throw Error('Link text missing');});
    await page.mouse.click(coords.x,coords.y,{button:'right'});await page.getByRole('menuitem',{name:'删除附件',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'移至回收站',exact:true}).click();
    await expect(page.locator('.source-editor .cm-content')).toHaveText('前文  后文');
    await page.keyboard.press('Control+z');await expect(page.locator('.source-editor .cm-content')).toHaveText('前文 [数据](源附件.txt) 后文');
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Dragging text keeps previews rendered until release without moving the drag anchor',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    await fs.writeFile(path.join(root,'拖选.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="orange"/></svg>');
    await open(page,'拖选.md','这一段文字用于拖动选择，图片在下一段，未拖到图片时应该保持预览。\n\n![图片](拖选.svg)\n\n结束');
    const first=page.locator('.ProseMirror > p').first(),preview=page.locator('.attachment-overlay'),raw=page.locator('.visual-attachment .syntax-raw');
    await expect(preview.locator('img')).toBeVisible();
    const box=(await first.boundingBox())!,image=(await preview.boundingBox())!;
    await page.mouse.move(box.x+5,box.y+10);await page.mouse.down();await page.mouse.move(box.x+180,box.y+10,{steps:12});
    await expect(preview.locator('img')).toBeVisible();await expect(raw).toBeHidden();
    const anchor=await page.evaluate(()=>({text:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset}));
    // A transient native range crossing an overlay must not fold an unreached image.
    await first.evaluate(el=>{const end=el.nextElementSibling!.nextElementSibling!.firstChild!;getSelection()!.extend(end,1);});
    await expect(preview.locator('img')).toBeVisible();await expect(raw).toBeHidden();
    await page.mouse.move(image.x+10,image.y+10,{steps:12});
    await expect(raw).toBeHidden();await expect(preview).toBeVisible();await expect(preview).toHaveClass(/drag-selected/);
    expect(await page.evaluate(()=>({text:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset}))).toEqual(anchor);
    await page.mouse.up();await expect(raw).toBeVisible();await expect(preview).toBeHidden();await page.locator('.ProseMirror > p').last().click();await expect(preview.locator('img')).toBeVisible();
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('The full formula/code guide keeps arrow navigation, code editing, execution, formatting and text selection consistent',async()=>{
  test.setTimeout(90000);
  const{app,page,root,errors}=await fixture();
  try{
    const markdown=await fs.readFile(path.join(project,'resources/workspace-guide/公式和代码示例.md'),'utf8');
    await fs.cp(path.join(project,'resources/workspace-guide/公式和代码示例.assets'),path.join(root,'公式和代码示例.assets'),{recursive:true});
    await open(page,'性能示例.md',markdown);
    const codeCount=parseBlocks(markdown).length,blocks=page.locator('.milkdown-code-block');await expect(blocks).toHaveCount(codeCount+2);
    await expect(page.locator('.code-attributes-input')).toHaveCount(codeCount);
    await expect(page.locator('.math-block')).toHaveCount(2);
    const js=blocks.filter({hasText:'console.log("平均值:"'}).first();await js.getByRole('button',{name:'运行代码块',exact:true}).click();
    await expect(js.locator('.code-output')).toHaveText('平均值: 5\n');
    await js.locator('.cm-content').click();await page.keyboard.press('Home');for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
    const before=await js.locator('.cm-content').evaluate(el=>{const point=getSelection()!.getRangeAt(0);return{node:point.startContainer.textContent,offset:point.startOffset};});
    for(let i=0;i<30;i++)await page.keyboard.press(i%2?'ArrowRight':'ArrowLeft');
    expect(await js.locator('.cm-content').evaluate(el=>{const point=getSelection()!.getRangeAt(0);return{node:point.startContainer.textContent,offset:point.startOffset};})).toEqual(before);
    await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('// 性能回归\nconst  extra = 1;');
    await expect(js.locator('.cm-content')).toContainText('// 性能回归');
    await js.locator('.cm-content').click({button:'right'});await page.getByRole('menuitem',{name:'格式化代码',exact:true}).click();
    await expect(js.locator('.cm-content')).toContainText('const extra = 1;');
    const paragraph=page.locator('.ProseMirror > p').filter({hasText:'语言只控制高亮'}).first();await paragraph.scrollIntoViewIfNeeded();await paragraph.click();const box=(await paragraph.boundingBox())!;
    await page.mouse.move(box.x+5,box.y+10);await page.mouse.down();await page.mouse.move(box.x+260,box.y+10,{steps:30});await page.mouse.up();
    expect(await page.evaluate(()=>getSelection()?.toString())).toContain('语言');
    await app.evaluate(({Menu})=>Menu.getApplicationMenu()!.items.flatMap(x=>x.submenu?.items||[]).find(x=>x.label==='保存')!.click());
    await expect.poll(()=>fs.readFile(path.join(root,'性能示例.md'),'utf8')).toContain('// 性能回归');
    await expect(page.locator('.milkdown-code-block')).toHaveCount(codeCount+2);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Repeated drags through an image continue beyond its source without a selectionchange feedback loop',async()=>{
 const {app,page,root,errors}=await fixture();
 try{
  await fs.writeFile(path.join(root,'拖动.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="orange"/></svg>');
  await open(page,'连续拖选.md','开始选择这段文字\n\n![图片](拖动.svg)\n\n末尾继续选择文字\n');
  await page.evaluate(()=>{(window as any).__selectionEvents=0;document.addEventListener('selectionchange',()=>{(window as any).__selectionEvents++;});});
  for(let attempt=0;attempt<3;attempt++){
   await page.locator('.ProseMirror > p').last().click();
   const preview=page.locator('.attachment-overlay');await expect(preview.locator('img')).toBeVisible();await expect.poll(async()=> (await preview.boundingBox())?.height || 0).toBeGreaterThan(90);
   const first=(await page.locator('.ProseMirror > p').first().boundingBox())!,image=(await preview.boundingBox())!;
   await page.mouse.move(first.x+3,first.y+10);await page.mouse.down();await page.mouse.move(first.x+80,first.y+10,{steps:10});
   await expect(preview).toBeVisible();const anchor=await page.evaluate(()=>({text:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset}));
   await page.mouse.move(image.x+15,image.y+10,{steps:10});
   await expect(preview).toBeVisible();await expect(preview).toHaveClass(/drag-selected/);
   const last=(await page.locator('.ProseMirror > p').last().boundingBox())!;
   await page.mouse.move(last.x+120,last.y+10,{steps:20});
   expect(await page.evaluate(()=>({text:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset}))).toEqual(anchor);
   await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toContain('末尾');
   const before=await page.evaluate(()=>(window as any).__selectionEvents);await page.waitForTimeout(200);
   expect((await page.evaluate(()=>(window as any).__selectionEvents))-before).toBeLessThan(10);
   await page.mouse.up();await expect(preview).toBeHidden();
  }
  expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
