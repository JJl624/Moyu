import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),fixtureDocuments=require('./fixtures/preview-documents.cjs');
const project=path.resolve(import.meta.dirname,'..'),base=path.resolve(project,'../../work/e2e');
async function fixture(){
  await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'attachment-previews-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_DEMO:'1',MOYU_TEST:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow(),errors:string[]=[],remote:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1'))remote.push(r.url());});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false)));
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();const root=path.join(data,'示例知识库');
  await fs.writeFile(path.join(root,'资料.pdf'),fixtureDocuments.pdf());await fs.writeFile(path.join(root,'乐谱.alphatex'),fixtureDocuments.score);
  const open=async(name:string)=>{await expect(page.locator(`.tree-item[title="${name}"]`)).toBeVisible();await page.locator(`.tree-item[title="${name}"]`).dblclick();await expect(page.locator('[data-tree-path="'+name+'"]')).toHaveClass(/selected/);if(await page.locator('.editor-host').count())await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');};
  const note=async(source:string)=>{await page.evaluate(content=>window.moyu!.create('附件回归.md','file',content),source);await open('附件回归.md');};
  return {app,page,root,errors,remote,open,note};
}
for(const mode of ['预览编辑','源码'])test(`External PDF drop into an externally copied note works in ${mode} without overwriting the original`,async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await f.note('');
    const bytes=Array.from(Buffer.from(fixtureDocuments.pdf()));
    await f.page.evaluate(bytes=>window.moyu!.feature('attachment.upload',{document:'附件回归.md',name:'资料.pdf',bytes:new Uint8Array(bytes)}),bytes);
    const originalOwner=await fs.readFile(path.join(f.root,'附件回归.assets/document.json'),'utf8');
    await fs.mkdir(path.join(f.root,'Moyu'));
    await fs.copyFile(path.join(f.root,'附件回归.md'),path.join(f.root,'Moyu/附件回归.md'));
    await fs.cp(path.join(f.root,'附件回归.assets'),path.join(f.root,'Moyu/附件回归.assets'),{recursive:true});
    await expect(f.page.locator('.tree-item[title="Moyu"]')).toBeVisible();
    await f.page.locator('.tree-item[title="Moyu"]').click();await f.open('Moyu/附件回归.md');
    await expect(f.page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
    if(mode==='源码')await f.page.getByRole('button',{name:'源码',exact:true}).click();
    const target=f.page.locator(mode==='源码'?'.source-editor .cm-line':'.ProseMirror p').first();
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((el,bytes)=>{
      const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'资料.pdf',{type:'application/pdf'}));
      const box=el.getBoundingClientRect();el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:box.x+5,clientY:box.y+5}));
    },bytes);
    await expect.poll(()=>fs.readFile(path.join(f.root,'Moyu/附件回归.assets/attachments/资料-1.pdf')).catch(()=>Buffer.alloc(0))).toEqual(Buffer.from(bytes));
    if(mode==='预览编辑')await f.page.getByRole('button',{name:'源码',exact:true}).click();
    await expect(f.page.locator('.source-editor .cm-content')).toContainText('[资料.pdf](附件回归.assets/attachments/资料-1.pdf)');
    for(const p of ['附件回归.assets/attachments/资料.pdf','Moyu/附件回归.assets/attachments/资料.pdf'])expect(await fs.readFile(path.join(f.root,p))).toEqual(Buffer.from(bytes));
    expect(await fs.readFile(path.join(f.root,'附件回归.assets/document.json'),'utf8')).toBe(originalOwner);
    expect(JSON.parse(await fs.readFile(path.join(f.root,'Moyu/附件回归.assets/document.json'),'utf8')).document).toBe('Moyu/附件回归.md');
    expect(await fs.readFile(path.join(f.root,'Moyu/附件回归.md'),'utf8')).toBe('');
    await f.page.locator('.save-status').click();
    await expect.poll(()=>fs.readFile(path.join(f.root,'Moyu/附件回归.md'),'utf8')).toContain('资料-1.pdf');
    await f.page.getByRole('button',{name:'阅读',exact:true}).click();
    await expect(f.page.locator('.reading-view [data-preview-kind=pdf] img').first()).toBeVisible({timeout:30000});
    await expect(f.page.locator('.toast')).not.toBeVisible();expect(f.errors).toEqual([]);expect(f.remote).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('A genuinely unrelated attachment directory reports the specific conflict through IPC and preserves its files',async()=>{
  const f=await fixture();try{
    await f.note('');await fs.mkdir(path.join(f.root,'附件回归.assets'));await fs.writeFile(path.join(f.root,'附件回归.assets/保留.txt'),'keep');
    await f.page.locator('.ProseMirror p').first().evaluate(el=>{
      const data=new DataTransfer();data.items.add(new File(['PDF'],'资料.pdf',{type:'application/pdf'}));const box=el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:box.x+5,clientY:box.y+5}));
    });
    await expect(f.page.locator('.toast')).toContainText('同名文件夹已存在，不能作为新的附属目录：附件回归.assets');
    expect(await fs.readdir(path.join(f.root,'附件回归.assets'))).toEqual(['保留.txt']);
    expect(await fs.readFile(path.join(f.root,'附件回归.assets/保留.txt'),'utf8')).toBe('keep');expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Windows standalone PDF and score previews render offline; mixed links and two links remain inline',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='前文 [资料](资料.pdf) 后文\n\n混排 ![资料](资料.pdf) 后文\n\n[资料](资料.pdf)\n\n[乐谱](乐谱.alphatex)\n\n[甲](资料.pdf) [乙](资料.pdf)\n\n尾文';await f.note(source);
    await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf] img').first()).toBeVisible({timeout:60000});
    const score=f.page.locator('.attachment-overlay [data-preview-kind=score]');await score.scrollIntoViewIfNeeded();await expect(score.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:60000});
    await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf]')).toHaveCount(1);
    expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);
    await f.page.getByRole('button',{name:'阅读',exact:true}).click();
    await expect(f.page.locator('.reading-view [data-preview-kind=pdf]')).toHaveCount(1);await expect(f.page.locator('.reading-view [data-preview-kind=score]')).toHaveCount(1);
    expect(f.remote).toEqual([]);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('EmbedPDF replaces PDF.js in the full file tab and provides selectable text and page controls offline',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await f.open('资料.pdf');await expect(f.page.locator('.embedpdf-host img').first()).toBeVisible({timeout:60000});
    await expect.poll(()=>f.page.locator('.embedpdf-host img').first().evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(100);
    await f.page.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(f.page.locator('.embedpdf-host input:not([type=file])').last()).toHaveValue('2');
    await f.page.getByRole('button',{name:'上一页',exact:true}).click();
    await expect(f.page.locator('.embedpdf-host input:not([type=file])').last()).toHaveValue('1');
    await f.page.getByRole('button',{name:'光标模式',exact:true}).click();
    const box=await f.page.locator('.embedpdf-host img').first().boundingBox();if(!box)throw Error('Missing PDF page');
    await f.page.mouse.move(box.x+box.width*0.14,box.y+box.height*0.45);await f.page.mouse.down();await f.page.mouse.move(box.x+box.width*0.6,box.y+box.height*0.45,{steps:12});await f.page.mouse.up();
    await expect.poll(()=>f.page.locator('embedpdf-container').evaluate(async(element:any)=>{
      const registry=await element.registry;return (await registry.getPlugin('selection').provides().getSelectedText().toPromise()).join('');
    })).toContain('First page');
    await f.page.screenshot({path:path.resolve(project,'../../work/v1050-embedpdf.png')});
    expect(f.remote).toEqual([]);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('alphaTex has exclusive source and preview views; browsing never saves the score',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await f.open('乐谱.alphatex');await expect(f.page.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:60000});
    await f.page.getByRole('button',{name:'源码',exact:true}).click();await expect(f.page.locator('.score-sheet')).toHaveCount(0);
    const editor=f.page.locator('.score-source .cm-content');await editor.click();await f.page.keyboard.press('Control+Home');await f.page.keyboard.insertText('\\subtitle "Edited"\n');
    await f.page.getByRole('button',{name:'预览',exact:true}).click();await expect(f.page.locator('.score-source')).toHaveCount(0);await expect(f.page.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:60000});
    expect(await fs.readFile(path.join(f.root,'乐谱.alphatex'),'utf8')).toBe(fixtureDocuments.score);
    await expect(f.page.locator('.save-status')).toContainText('未保存');await f.page.locator('.save-status').click();await expect.poll(()=>fs.readFile(path.join(f.root,'乐谱.alphatex'),'utf8')).toContain('Edited');
    expect(f.remote).toEqual([]);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('List and quote paragraphs preview attachments; heading and soft-break mixed paragraphs do not',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='1. 列表\n\n   [资料](资料.pdf)\n\n> [资料](资料.pdf)\n\n## [资料](资料.pdf)\n\n文字\n[资料](资料.pdf)\n\n结束';await f.note(source);
    await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf]')).toHaveCount(2);
    await f.page.getByRole('button',{name:'阅读',exact:true}).click();await expect(f.page.locator('.reading-view [data-preview-kind=pdf]')).toHaveCount(2);
    expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Typing around a PDF reference disables its preview, undo restores it, and deletion never touches the attachment',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='前文\n\n[资料](资料.pdf)\n\n尾文';await f.note(source);
    const preview=f.page.locator('.attachment-overlay [data-preview-kind=pdf]');await expect(preview.locator('img').first()).toBeVisible({timeout:30000});
    const bytes=await fs.readFile(path.join(f.root,'资料.pdf'));
    await preview.click({button:'right'});await f.page.getByRole('menuitem',{name:'编辑引用',exact:true}).click();const raw=f.page.locator('.ProseMirror .attachment-raw');await expect(raw).toBeVisible();
    await f.page.keyboard.press('Home');await f.page.keyboard.insertText('参考：');
    await f.page.locator('.ProseMirror > p').last().click();await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf]')).toHaveCount(0);
    await f.page.keyboard.press('Control+z');await f.page.locator('.ProseMirror > p').last().click();await expect(preview).toHaveCount(1);
    await f.page.locator('.ProseMirror > p').last().click();await f.page.keyboard.press('Control+a');await f.page.keyboard.press('Backspace');
    await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf]')).toHaveCount(0);
    await f.page.keyboard.press('Control+z');await f.page.locator('.ProseMirror > p').last().click();await expect(preview).toHaveCount(1);
    expect(await fs.readFile(path.join(f.root,'资料.pdf'))).toEqual(bytes);expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);
    expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Insert score creates a local editable attachment and preserves the note manual-save policy',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='前文\n\n在这里';await f.note(source);await f.page.locator('.ProseMirror > p').last().click();await f.page.keyboard.press('End');
    await f.page.keyboard.type('/乐谱');await f.page.getByRole('menu',{name:'插入',exact:true}).getByRole('menuitem',{name:'乐谱',exact:true}).click();
    await expect(f.page.getByLabel('乐谱编辑器')).toBeVisible();await expect(f.page.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:30000});
    const created=await f.page.locator('.score-file-viewer strong').textContent();expect(await fs.readFile(path.join(f.root,created!),'utf8')).toContain('新乐谱');
    expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);
    await f.open('附件回归.md');await f.page.locator('.save-status').click();await expect.poll(()=>fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toContain('.alphatex');
    expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Missing and corrupt previews fall back to their references; switching away cancels pending work',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await fs.writeFile(path.join(f.root,'坏谱.alphatex'),'\\not-a-real-instruction nonsense');
    const source='[缺失资料](不存在.pdf)\n\n[坏谱](坏谱.alphatex)\n\n尾文';await f.note(source);
    await f.page.locator('.ProseMirror > p').last().click();await f.page.locator('.attachment-overlay [data-preview-kind=pdf]').scrollIntoViewIfNeeded();
    await expect(f.page.locator('.attachment-overlay [data-preview-kind=pdf]')).toContainText(/无法|失败|错误|Failed|Error/i,{timeout:30000});
    const score=f.page.locator('.attachment-overlay [data-preview-kind=score]');await score.scrollIntoViewIfNeeded();await expect(score).toHaveAttribute('data-preview-error','true',{timeout:30000});
    expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);
    await f.open('开始使用.md');await expect(f.page.locator('.attachment-overlay [data-preview-kind=score]')).toHaveCount(0);
    await f.page.getByRole('button',{name:'阅读',exact:true}).click();await expect(f.page.locator('.reading-view h1').first()).toBeVisible();expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('EmbedPDF password entry can open an encrypted PDF without changing its file bytes',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await f.open('资料.pdf');await expect(f.page.locator('.embedpdf-host img').first()).toBeVisible({timeout:30000});
    const bytes=await f.page.locator('embedpdf-container').evaluate(async(element:any)=>{
      const registry=await element.registry,manager=registry.getPlugin('document-manager').provides(),engine=registry.getEngine();
      const document=manager.getDocument(manager.getDocumentOrder()[0]);await engine.setDocumentEncryption(document,'moyu-test','owner-test',-1).toPromise();
      return Array.from(new Uint8Array(await engine.saveAsCopy(document).toPromise()));
    });
    const encrypted=Buffer.from(bytes);await fs.writeFile(path.join(f.root,'加密.pdf'),encrypted);await f.open('加密.pdf');
    const password=f.page.locator('.embedpdf-host input[type=password]');await expect(password).toBeVisible({timeout:30000});await password.fill('moyu-test');await password.press('Enter');
    await expect(f.page.locator('.embedpdf-host img').first()).toBeVisible({timeout:30000});expect(await fs.readFile(path.join(f.root,'加密.pdf'))).toEqual(encrypted);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Keyboard entry reveals the reference; dragging across its preview keeps the note structurally unchanged',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='前文\n\n[资料](资料.pdf)\n\n尾文';await f.note(source);
    const preview=f.page.locator('.attachment-overlay [data-preview-kind=pdf]');await expect(preview.locator('img').first()).toBeVisible({timeout:30000});
    await f.page.locator('.ProseMirror > p').first().click();await f.page.keyboard.press('End');await f.page.keyboard.press('ArrowDown');
    await expect(f.page.locator('.ProseMirror .attachment-raw')).toBeVisible();
    await f.page.locator('.ProseMirror > p').last().click();await expect(preview).toBeVisible();
    const start=await f.page.locator('.ProseMirror > p').first().boundingBox(),end=await f.page.locator('.ProseMirror > p').last().boundingBox();if(!start||!end)throw Error('Missing paragraph');
    await f.page.mouse.move(start.x+3,start.y+start.height/2);await f.page.mouse.down();await f.page.mouse.move(end.x+22,end.y+end.height/2,{steps:16});await expect(preview).toBeVisible();await f.page.mouse.up();
    await expect(preview).toBeVisible();expect(await fs.readFile(path.join(f.root,'附件回归.md'),'utf8')).toBe(source);expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('MusicXML supports source editing and Guitar Pro imports stay read-only without modifying bytes',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    await fs.writeFile(path.join(f.root,'交换乐谱.musicxml'),fixtureDocuments.musicxml);const gp=fixtureDocuments.guitarPro();await fs.writeFile(path.join(f.root,'导入.gp'),gp);
    await f.open('交换乐谱.musicxml');await expect(f.page.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:30000});await f.page.getByRole('button',{name:'源码',exact:true}).click();await expect(f.page.locator('.score-source .cm-content')).toContainText('score-partwise');
    await f.open('导入.gp');await expect(f.page.locator('.attachment-score-sheet svg')).not.toHaveCount(0,{timeout:30000});await expect(f.page.getByRole('button',{name:'源码',exact:true})).toHaveCount(0);await expect(f.page.locator('.save-status')).toBeDisabled();
    expect(await fs.readFile(path.join(f.root,'导入.gp'))).toEqual(gp);expect(await fs.readFile(path.join(f.root,'交换乐谱.musicxml'),'utf8')).toBe(fixtureDocuments.musicxml);
    const updated=fixtureDocuments.guitarPro(fixtureDocuments.score.replace('Preview test','Updated GP'));await fs.writeFile(path.join(f.root,'导入.gp'),updated);await expect(f.page.locator('.score-sheet')).toContainText('Updated GP',{timeout:15000});
    expect(f.errors).toEqual([]);
  }finally{await f.app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
