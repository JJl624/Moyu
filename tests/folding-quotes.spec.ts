import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const markdown='> 普通引用\n\n> [-] 一级折叠\n> 一级内容\n>\n> > [+] 二级折叠\n> > 二级内容\n> >\n> > - 项目 A\n> > - 项目 B\n>\n> 一级内容继续\n\n> [+] 默认展开\n> 默认可见内容\n\n末尾\n';
async function fixture(){
 const data=await fs.mkdtemp(path.resolve(project,'../../work/folding-quotes-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await(await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();});
 await page.evaluate(markdown=>window.moyu!.create('折叠.md','file',markdown),markdown);await page.locator('.tree-item[title="折叠.md"]').dblclick();
 return{app,page,data,errors};
}
test('Preview and reading folds preserve source, edit their body, retain independent nested states and do not dirty a document on toggle',async()=>{
 const{app,page,data,errors}=await fixture();
 try{
  const outer=page.locator('.ProseMirror > blockquote.folding-quote').first(),nested=outer.locator('blockquote.folding-quote');
  await expect(outer).toHaveAttribute('data-fold-open','false');await expect(outer.locator('p').filter({hasText:'一级内容继续'})).toBeHidden();
  await expect(nested).toHaveAttribute('data-fold-open','true');
  await outer.getByRole('button',{name:'展开：一级折叠',exact:true}).click();await expect(nested.locator('li').first()).toBeVisible();
  await nested.getByRole('button',{name:'折叠：二级折叠',exact:true}).click();
  await outer.getByRole('button',{name:'折叠：一级折叠',exact:true}).click();await outer.getByRole('button',{name:'展开：一级折叠',exact:true}).click();
  await expect(nested).toHaveAttribute('data-fold-open','false');
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('> [-] 一级折叠');
  expect(await fs.readFile(path.join(data,'示例知识库','折叠.md'),'utf8')).toBe(markdown);
  await page.getByRole('button',{name:'阅读',exact:true}).click();
  const reading=page.locator('.reading-view > details').first();await expect(reading).not.toHaveAttribute('open');
  await reading.locator(':scope > summary').click();await expect(reading.locator('li').first()).toBeVisible();
  await page.getByRole('button',{name:'预览编辑',exact:true}).click();
  await page.getByRole('button',{name:'展开：一级折叠',exact:true}).click();
  const body=page.locator('.ProseMirror p').filter({hasText:'一级内容继续'});await body.click();await page.keyboard.press('End');await page.keyboard.type('追加');await expect(body).toContainText('一级内容继续追加');
  await expect(page.locator('.save-status')).toContainText('本地未保存');
  await page.locator('.save-status').click();
  await expect.poll(()=>fs.readFile(path.join(data,'示例知识库','折叠.md'),'utf8')).toContain('一级内容继续追加');
  const saved=await fs.readFile(path.join(data,'示例知识库','折叠.md'),'utf8');expect(saved).toContain('> [-] 一级折叠');expect(saved).toContain('> > [+] 二级折叠');
  await page.getByRole('button',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').focus();await page.keyboard.press('ArrowLeft');
  await expect.poll(()=>page.evaluate(()=>{const node=document.getSelection()?.anchorNode;return(node instanceof Element?node:node?.parentElement)?.closest('.cm-line')?.textContent;})).toContain('一级内容继续追加');
  await page.getByRole('button',{name:'预览编辑',exact:true}).click();
  await page.screenshot({path:path.resolve(project,'../../work/folding-quotes-preview.png')});
  expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Typed quote markers create folds and HTML/PDF exports keep nested content',async()=>{
 const{app,page,data,errors}=await fixture();
 try{
  await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('> ');await page.keyboard.type('[+] 新折叠');
  await expect(page.getByRole('button',{name:'折叠：新折叠',exact:true})).toBeVisible();
  await page.keyboard.press('Enter');await page.keyboard.type('新增正文');await page.keyboard.press('Control+s');
  await app.evaluate(({dialog},base)=>{dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:process.getBuiltinModule('path').join(base,process.getBuiltinModule('path').basename(options.defaultPath!))});},data);
  await page.getByRole('button',{name:'更多文档操作',exact:true}).click();await page.getByRole('button',{name:'导出 HTML',exact:true}).click();
  const file=path.join(data,'折叠.html');await expect.poll(()=>fs.readFile(file,'utf8').catch(()=>'')).toContain('<details');
  const html=await fs.readFile(file,'utf8');expect(html).toContain('项目 A');expect(html).toContain('新增正文');expect(html).toMatch(/<details class="folding-quote"><summary>一级折叠/);
  await app.evaluate(({app})=>{app.on('web-contents-created',(_event,wc)=>{const original=wc.printToPDF.bind(wc);wc.printToPDF=async options=>{(globalThis as any).__foldPrint=await wc.executeJavaScript('[...document.querySelectorAll("details")].map(n=>n.open)');return original(options);};});});
  await page.getByRole('button',{name:'更多文档操作',exact:true}).click();await page.getByRole('button',{name:'导出 PDF',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__foldPrint)).toEqual([true,true,true,true]);
  await expect.poll(()=>fs.stat(path.join(data,'折叠.pdf')).then(s=>s.size,()=>0)).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Styled headings, tables, code and escaped markers retain their Markdown behavior inside quotes',async()=>{
 const{app,page,errors}=await fixture();
 try{
  const raw='> [+] **标题** ==说明==\n> 正文 __下划线__\n>\n> | 名称 |\n> | --- |\n> | 内容 |\n>\n> ```text\n> [-] 代码\n> ```\n\n> \\[-] 普通文字\n';
  await page.evaluate(raw=>window.moyu!.create('内容.md','file',raw),raw);await page.locator('.tree-item[title="内容.md"]').dblclick();
  await expect(page.locator('.ProseMirror blockquote > p').first().locator('strong')).toHaveText('标题');
  await expect(page.locator('.ProseMirror blockquote > p').first().locator('mark')).toHaveText('说明');
  await expect(page.locator('.ProseMirror u')).toHaveText('下划线');await expect(page.locator('.ProseMirror td').last()).toContainText('内容');
  await expect(page.locator('.ProseMirror blockquote.folding-quote')).toHaveCount(1);
  await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view details summary strong')).toHaveText('标题');await expect(page.locator('.reading-view details code')).toHaveText('[-] 代码');await expect(page.locator('.reading-view > blockquote')).toContainText('[-] 普通文字');expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
