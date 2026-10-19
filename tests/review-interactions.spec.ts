import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function fixture(){
  const data=await fs.mkdtemp(path.join(work,'review-interactions-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  return{app,page,data,root:path.join(data,'示例知识库'),errors};
}
test('Escape cancels IME composition without closing a dialog or an inline filename draft',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'偏好设置',exact:true});
    await dialog.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(dialog).toBeVisible();
    await dialog.dispatchEvent('keydown',{key:'Escape',keyCode:229});await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'新建文档',exact:true}).click();
    const name=page.getByLabel('新文件名称',{exact:true});await name.fill('组合输入');
    await name.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(name).toHaveValue('组合输入');
    await name.press('Escape');await expect(name).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Tabbed code copies the active page in editing and reading, and complete source only in source display',async()=>{
  const{app,page,errors}=await fixture();const raw=':::js 第一页\nconst first = 1;\n:::python 第二页\nprint(2)';
  try{
    await page.evaluate(raw=>window.moyu!.create('复制检查.md','file','```tabs\n'+raw+'\n```'),raw);
    await page.locator('.tree-item[title="复制检查.md"]').dblclick();
    for(const mode of ['预览编辑','阅读']){
      await page.getByRole('button',{name:mode,exact:true}).click();
      const block=page.locator(mode==='阅读'?'.reading-view [data-tabbed-code]':'.ProseMirror .tabbed-code');
      await block.getByRole('tab',{name:'第二页',exact:true}).click();
      await block.getByRole('button',{name:'复制代码',exact:true}).click();
      await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('print(2)');
      await block.getByRole('button',{name:'显示源码',exact:true}).click();
      await block.getByRole('button',{name:'复制代码',exact:true}).click();
      await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(raw);
      await block.getByRole('button',{name:'显示标签页',exact:true}).click();
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Search opens the clicked match in source, preview editing and reading, including repeated jumps in one document',async()=>{
  const{app,page,errors}=await fixture();
  try{
    const content=Array.from({length:100},(_,i)=>i===29||i===79?'JumpTarget_'+(i+1):'普通段落 '+(i+1)).join('\n\n');
    await page.evaluate(content=>window.moyu!.create('搜索定位.md','file',content),content);
    await page.getByRole('button',{name:'源码',exact:true}).click();
    await page.getByRole('button',{name:'全文搜索',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索文件名和内容',exact:true}).fill('JumpTarget');
    const result=page.locator('.search-result').filter({has:page.getByText('搜索定位',{exact:true})});
    await expect(result).toBeVisible();
    await result.locator('[data-search-line="159"]').click();
    await expect(page.locator('.source-editor .cm-activeLine')).toHaveText('JumpTarget_80');
    await page.getByRole('button',{name:'预览编辑',exact:true}).click();
    await result.locator('[data-search-line="59"]').click();
    await expect.poll(()=>page.evaluate(()=>window.getSelection()?.anchorNode?.parentElement?.closest('p')?.textContent)).toBe('JumpTarget_30');
    await page.getByRole('button',{name:'阅读',exact:true}).click();
    await result.locator('[data-search-line="159"]').click();
    await expect(page.locator('.reading-view p').filter({hasText:'JumpTarget_80'})).toBeFocused();
    await result.locator('[data-search-line="59"]').dblclick();
    await expect(page.locator('.reading-view p').filter({hasText:'JumpTarget_30'})).toBeFocused();
    const code=Array.from({length:160},(_,i)=>i===99?'console.log("CodeJumpTarget");':'console.log('+i+');').join('\n');
    await page.evaluate(code=>window.moyu!.create('代码定位.md','file','```js {height=80}\n'+code+'\n```'),code);
    await page.getByRole('textbox',{name:'搜索文件名和内容',exact:true}).fill('CodeJumpTarget');
    await page.locator('.search-result').filter({hasText:'代码定位'}).locator('small').click();
    const codeView=page.locator('.reading-view .code-block-shell code');
    await expect.poll(()=>codeView.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    expect(await codeView.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.textContent?.includes('CodeJumpTarget')){const range=document.createRange();range.selectNode(node);const r=range.getBoundingClientRect(),box=el.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom;}return false;})).toBe(true);
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Source font changes retain the CodeMirror instance and its undo history',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await page.evaluate(()=>window.moyu!.create('字体检查.md','file','original'));
    await page.locator('.tree-item[title="字体检查.md"]').dblclick();await page.getByRole('button',{name:'源码',exact:true}).click();
    const source=page.locator('.source-editor .cm-content');await source.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' edited');
    await page.evaluate(()=>{(window as any).reviewSource=document.querySelector('.source-editor .cm-editor');});
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    const size=page.getByRole('slider',{name:'文字大小',exact:true});await size.focus();await size.press('ArrowRight');
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).reviewSource===document.querySelector('.source-editor .cm-editor'))).toBe(true);
    await source.click();await page.keyboard.press('Control+z');await expect(source).toHaveText('original');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Native sidebar shortcut is distinct from bold; non-Markdown text history remains available in the left sidebar',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    const shortcut=await app.evaluate(({Menu})=>Menu.getApplicationMenu()!.items.find(i=>i.label==='视图')!.submenu!.items.find(i=>i.label==='切换侧栏')!.accelerator);
    expect(shortcut).toBe('CmdOrCtrl+Alt+B');
    await app.evaluate(({BrowserWindow})=>{const web=BrowserWindow.getAllWindows()[0].webContents;web.sendInputEvent({type:'keyDown',keyCode:'B',modifiers:['control','alt']});web.sendInputEvent({type:'keyUp',keyCode:'B',modifiers:['control','alt']});});await expect(page.locator('.sidebar')).toHaveCount(0);
    await app.evaluate(({BrowserWindow})=>{const web=BrowserWindow.getAllWindows()[0].webContents;web.sendInputEvent({type:'keyDown',keyCode:'B',modifiers:['control','alt']});web.sendInputEvent({type:'keyUp',keyCode:'B',modifiers:['control','alt']});});await expect(page.locator('.sidebar')).toBeVisible();
    await page.evaluate(()=>window.moyu!.create('加粗检查.md','file','待加粗'));
    await page.locator('.tree-item[title="加粗检查.md"]').dblclick();
    await page.locator('.ProseMirror p').click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+b');
    await expect(page.locator('.ProseMirror .moyu-source-strong')).toHaveText('待加粗');await expect(page.locator('.sidebar')).toBeVisible();
    await fs.writeFile(path.join(root,'历史检查.txt'),'plain text');
    await page.locator('.tree-item[title="历史检查.txt"]').dblclick();
    await expect(page.locator('.text-file-editor')).toBeVisible();
    await page.getByRole('button',{name:'文档历史',exact:true}).click();
    await expect(page.locator('.sidebar .document-history')).toBeVisible();
    await expect(page.getByRole('button',{name:'刷新文档历史',exact:true})).toBeEnabled();
    await expect(page.getByText('此文件不支持文档历史',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
