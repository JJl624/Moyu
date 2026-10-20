import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const data=await fs.mkdtemp(path.resolve(project,'../../work/editing-drag-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await(await app.browserWindow(page)).evaluate(w=>{w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  return{app,page,data,root:path.join(data,'示例知识库'),errors};
}
async function open(page:Page,name:string,text='位置'){
  await page.evaluate(({name,text})=>window.moyu!.create(name,'file',text),{name,text});
  await page.locator(`.tree-item[title="${name}"]`).dblclick();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
}
async function source(page:Page){await page.getByRole('button',{name:'源码',exact:true}).click();const cm=page.locator('.source-editor .cm-content');await expect(cm).toBeVisible();return cm;}

test('Multiline plain-text paste retains soft breaks, blank lines, Markdown and CRLF; HTML retains its own blocks',async()=>{
  const{app,page,errors}=await fixture();
  try{
    const samples=['第一行\n第二行\n第三行','第一行\r\n第二行\r\n\r\n第三行','## 标题\n第一行\n第二行\n\n- 项一\n- 项二','文字 **加粗**\n==高亮== 和 __下划线__'];
    for(const [i,text]of samples.entries()){
      await open(page,`粘贴${i}.md`,'');await page.locator('.ProseMirror').focus();
      await app.evaluate(({clipboard},text)=>clipboard.writeText(text),text);await page.keyboard.press('Control+v');
      const cm=await source(page);expect((await cm.locator('.cm-line').allTextContents()).join('\n').trimEnd().replace(/\r\n/g,'\n')).toBe(text.replace(/\r\n/g,'\n').replace(/^(#{1,6} [^\n]+)\n(?!\n)/gm,'$1\n\n').replace(/^- /gm,'* '));
      await page.getByRole('button',{name:'预览编辑',exact:true}).click();
    }
    await open(page,'HTML粘贴.md','');await page.locator('.ProseMirror').focus();
    await page.locator('.ProseMirror').evaluate(el=>{const data=new DataTransfer();data.setData('text/html','<p>甲<br>乙</p><p><strong>丙</strong></p>');data.setData('text/plain','甲\n乙\n丙');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
    await expect(page.locator('.ProseMirror p')).toHaveCount(2);await expect(page.locator('.ProseMirror br:not(.ProseMirror-trailingBreak)')).toHaveCount(1);
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Selection formatting lives in the context menu, including highlight and underline, in preview and source',async()=>{
  const{app,page,errors}=await fixture();
  try{
    for(const mode of ['预览编辑','源码'])for(const [label,marker]of [['加粗','**'],['高亮','=='],['下划线','__'],['删除线','~~'],['行内代码','`']]){
      await page.getByRole('button',{name:'预览编辑',exact:true}).click();await open(page,`${mode}-${label}.md`,'选中文字');
      if(mode==='源码')await source(page);
      const editor=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');
      await editor.focus();await page.keyboard.press('Control+a');
      await expect(page.locator('.milkdown-toolbar')).toHaveCount(0);
      const clicked=mode==='源码'?editor.locator('.cm-line').first():editor.locator('p').first();
      await clicked.click({button:'right',position:{x:8,y:8}});
      await page.getByRole('menuitemcheckbox',{name:label,exact:true}).click({timeout:3000});
      const cm=mode==='源码'?editor:await source(page);await expect(cm).toHaveText(marker+'选中文字'+marker);
    }
    for(const mode of ['预览编辑','源码']){
      await page.getByRole('button',{name:'预览编辑',exact:true}).click();await open(page,mode+'链接.md','选择文字');
      if(mode==='源码')await source(page);
      const edit=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await edit.focus();await page.keyboard.press('Control+a');
      await edit.locator(mode==='源码'?'.cm-line':'p').first().click({button:'right',position:{x:8,y:8}});
      await page.getByRole('menuitemcheckbox',{name:'链接',exact:true}).click();await page.keyboard.insertText('目标.md');
      const cm=mode==='源码'?edit:await source(page);await expect(cm).toHaveText('[选择文字](目标.md)');
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Folder creation targets the row folder; header creation always targets root; document toolbar retains the 1.0 layout',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    await page.evaluate(()=>window.moyu!.create('父目录','folder'));
    const folder=page.locator('[data-tree-path="父目录"]');await folder.hover();
    await page.getByRole('button',{name:'在 父目录 下新建文档',exact:true}).click();
    await page.locator('.file-name-form input').fill('子文档');await page.locator('.file-name-form input').press('Enter');
    await expect.poll(()=>fs.readFile(path.join(root,'父目录/子文档.md'),'utf8').catch(()=>null)).not.toBe(null);
    await page.getByRole('button',{name:'新建文档',exact:true}).click();
    await page.locator('.file-name-form input').fill('根文档');await page.locator('.file-name-form input').press('Enter');
    await expect.poll(()=>fs.stat(path.join(root,'根文档.md')).then(()=>true).catch(()=>false)).toBe(true);
    await folder.hover();await page.getByRole('button',{name:'在 父目录 下新建文件夹',exact:true}).click();
    await page.locator('.file-name-form input').fill('子目录');await page.locator('.file-name-form input').press('Enter');
    await expect.poll(()=>fs.stat(path.join(root,'父目录/子目录')).then(s=>s.isDirectory()).catch(()=>false)).toBe(true);
    await open(page,'正文.md','# 正文标题\n\n普通段落');
    await expect(page.locator('.document-toolbar')).toBeVisible();await expect(page.locator('.breadcrumbs strong')).toHaveText('正文');await expect(page.locator('.ProseMirror h1')).toContainText('正文标题');
    await expect(page.locator('.tabbar .document-actions')).toHaveCount(0);
    const tabs=(await page.locator('.tabbar').boundingBox())!,controls=(await page.getByRole('toolbar',{name:'文档工具栏',exact:true}).boundingBox())!;
    expect(controls.y).toBeGreaterThanOrEqual(tabs.y+tabs.height);
    await expect(page.getByRole('button',{name:'关闭当前文档',exact:true})).toBeVisible();
    await page.screenshot({path:path.resolve(project,'../../work/editing-chrome.png')});expect(errors).toEqual([]);
    await page.getByRole('button',{name:'查看当前文档附属目录',exact:true}).click();
    await page.getByRole('button',{name:'新建文档',exact:true}).click();
    await page.locator('.file-name-form input').fill('从附件视图新建');await page.locator('.file-name-form input').press('Enter');
    await expect.poll(()=>fs.stat(path.join(root,'从附件视图新建.md')).then(()=>true).catch(()=>false)).toBe(true);
    await(await app.browserWindow(page)).evaluate(w=>w.setSize(900,640));
    expect(await page.locator('.tabbar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:path.resolve(project,'../../work/editing-chrome-narrow.png')});
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Folder action icons align with the row; new files retain explicit extensions',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    const folderName='公式和代码示例';
    await page.evaluate(name=>window.moyu!.create(name,'folder'),folderName);
    const row=page.locator('[data-tree-path="'+folderName+'"]');
    for(const width of [180,220,340]){
      await page.locator('.file-sidebar').evaluate((el,width)=>{(el as HTMLElement).style.width=width+'px';},width);
      await row.hover();
      const geometry=await row.evaluate(el=>{
        const rect=el.getBoundingClientRect(),center=rect.y+rect.height/2;
        return {overflow:el.scrollWidth>el.clientWidth,center,icons:Array.from(el.querySelectorAll('.tree-create button>svg,.tree-more>svg,.tree-item>svg')).map(icon=>{const r=icon.getBoundingClientRect();return{x:r.x,right:r.right,center:r.y+r.height/2};}),right:rect.right};
      });
      expect(geometry.overflow).toBe(false);expect(geometry.icons).toHaveLength(4);
      for(const icon of geometry.icons){expect(Math.abs(icon.center-geometry.center)).toBeLessThan(1);expect(icon.right).toBeLessThanOrEqual(geometry.right);}
    }
    await page.screenshot({path:path.resolve(project,'../../work/folder-icons-aligned.png'),clip:(await row.boundingBox())!});
    for(const [name,expected]of [['无后缀','无后缀.md'],['说明.txt','说明.txt'],['页面.html','页面.html'],['模块.test.js','模块.test.js'],['大写.MD','大写.MD'],['压缩.tar.gz','压缩.tar.gz']]){
      await row.hover();await row.getByRole('button',{name:'在 '+folderName+' 下新建文档',exact:true}).click();
      const input=page.locator('.file-name-form input');await expect(input).toHaveValue('');
      await input.fill(name);await input.press('Enter');
      await expect.poll(()=>fs.stat(path.join(root,folderName,expected)).then(s=>s.isFile()).catch(()=>false)).toBe(true);
      await expect(input).toHaveCount(0);
      if(expected!==name+'.md')expect(await fs.stat(path.join(root,folderName,name+'.md')).catch(()=>null)).toBe(null);
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('File dragging supports wheel, right-click toggles, two-second hover, cancellation and moving',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    for(const name of ['目标','目标/子目录'])await page.evaluate(name=>window.moyu!.create(name,'folder'),name);
    await open(page,'拖动.md','保留内容');
    const from=page.locator('[data-tree-path="拖动.md"]'),folder=page.locator('[data-tree-path="目标"]');
    const a=(await from.boundingBox())!,b=(await folder.boundingBox())!;
    await page.mouse.move(a.x+65,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+65,b.y+b.height/2,{steps:12});
    await expect(page.locator('body')).toHaveClass(/dragging-tree-file/);
    await page.waitForTimeout(1100);await expect(page.locator('[data-tree-path="目标/子目录"]')).toHaveCount(0);
    await expect(page.locator('[data-tree-path="目标/子目录"]')).toBeVisible({timeout:1800});
    await page.mouse.click(b.x+65,b.y+b.height/2,{button:'right'});await expect(page.locator('[data-tree-path="目标/子目录"]')).toHaveCount(0);
    await page.mouse.click(b.x+65,b.y+b.height/2,{button:'right'});await expect(page.locator('[data-tree-path="目标/子目录"]')).toBeVisible();
    await expect(page.locator('.context-menu')).toHaveCount(0);await page.keyboard.press('Escape');await page.mouse.up();
    expect(await fs.readFile(path.join(root,'拖动.md'),'utf8')).toBe('保留内容');
    // Starting on an expanded folder must also close it after two seconds.
    await from.hover();await page.mouse.down();await page.mouse.move(b.x+65,b.y+b.height/2,{steps:12});
    await expect(page.locator('[data-tree-path="目标/子目录"]')).toHaveCount(0,{timeout:3000});await page.mouse.up();
    await expect.poll(()=>fs.readFile(path.join(root,'目标/拖动.md'),'utf8').catch(()=>null)).toBe('保留内容');
    await page.mouse.move(b.x+65,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+85,b.y+b.height/2,{steps:5});
    await expect(page.locator('[data-tree-path="目标/子目录"]')).toBeVisible({timeout:3000});await page.keyboard.press('Escape');await page.mouse.up();
    expect(await fs.readFile(path.join(root,'目标/拖动.md'),'utf8')).toBe('保留内容');
    for(let i=0;i<45;i++)await page.evaluate(i=>window.moyu!.create('滚动'+String(i).padStart(2,'0')+'.md','file','x'),i);
    const scroll=page.locator('.sidebar-scroll');await scroll.evaluate(el=>el.scrollTop=0);
    const row=page.locator('[data-tree-path="滚动00.md"]');await row.scrollIntoViewIfNeeded();await row.hover();await page.mouse.down();await page.mouse.move(b.x+70,b.y+15,{steps:8});
    const before=await scroll.evaluate(el=>el.scrollTop);await page.mouse.wheel(0,400);
    await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(before+100);await page.keyboard.press('Escape');await page.mouse.up();
    await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='drag-frame';frame.srcdoc='<p>预览</p>';frame.style.cssText='position:fixed;left:500px;top:180px;width:160px;height:100px;z-index:500';document.body.append(frame);});
    await row.scrollIntoViewIfNeeded();await row.hover();await page.mouse.down();await page.mouse.move(560,220,{steps:8});await page.mouse.up();
    await expect(page.locator('body')).not.toHaveClass(/dragging-tree-file/);await page.locator('#drag-frame').evaluate(el=>el.remove());
    expect(await fs.readFile(path.join(root,'滚动00.md'),'utf8')).toBe('x');
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Files drag into preview/source as relative links; external files become attachments without moving originals',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    await fs.writeFile(path.join(root,'sample.csv'),'a,b\n1,2');await expect(page.locator('[data-tree-path="sample.csv"]')).toBeVisible();
    for(const mode of ['预览编辑','源码']){
      await page.getByRole('button',{name:'预览编辑',exact:true}).click();await open(page,`拖入-${mode}.md`,'位置');
      if(mode==='源码')await source(page);
      const from=page.locator('[data-tree-path="sample.csv"]'),to=page.locator(mode==='源码'?'.source-editor .cm-line':'.ProseMirror p').first();
      await from.dragTo(to,{targetPosition:{x:20,y:10}});
      const cm=mode==='源码'?page.locator('.source-editor .cm-content'):await source(page);
      await expect(cm).toContainText('[sample.csv](sample.csv)');expect(await fs.readFile(path.join(root,'sample.csv'),'utf8')).toBe('a,b\n1,2');
      if(mode==='预览编辑')await page.getByRole('button',{name:'预览编辑',exact:true}).click();
      const external=page.locator(mode==='源码'?'.source-editor .cm-line':'.ProseMirror p').first();
      await external.evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['外部文件'],'导入.txt',{type:'text/plain'}));data.items.add(new File(['第二个文件'],'导入2.txt',{type:'text/plain'}));const b=el.getBoundingClientRect();el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:b.x+8,clientY:b.y+8}));});
      if(mode==='预览编辑'){
        await expect(page.locator('.ProseMirror')).toContainText('导入2.txt');
        await source(page);
      }
      await expect(page.locator('.source-editor .cm-content')).toContainText('[导入.txt](');
      await expect.poll(()=>fs.readFile(path.join(root,`拖入-${mode}.assets/attachments/导入.txt`),'utf8').catch(()=>null)).toBe('外部文件');
      await expect(page.locator('.source-editor .cm-content')).toContainText('[导入2.txt](');
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
