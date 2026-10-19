import {test,expect,_electron as electron} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),base=path.resolve(project,'../../work/e2e');

test('Knowledge base dialog preserves mounted editor, cursor, outputs and unsaved tabs; closes and switches safely',async()=>{
  test.setTimeout(120000);
  await fs.mkdir(base,{recursive:true});
  const data=await fs.mkdtemp(path.join(base,'v061-navigation-')),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({...(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:['--disable-backgrounding-occluded-windows']}:{args:[project,'--disable-backgrounding-occluded-windows']}),env});
  try {
    const page=await app.firstWindow(),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const original='# 导航验证\n\n正文\n\n```js\nconsole.log(42)\n```\n';
    await page.evaluate(async content=>{await window.moyu!.create('导航验证.md','file',content);},original);
    await page.locator('.tree-item[title="导航验证.md"]').click();
    await page.getByRole('button',{name:'运行代码块',exact:true}).click();
    await expect(page.locator('.code-output')).toHaveText('42\n');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await page.getByLabel('保存方式').selectOption('close');
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await page.getByRole('button',{name:'源码',exact:true}).click();
    await page.locator('.source-editor .cm-content').click();
    await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('X');
    await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();
    await page.evaluate(()=>{(window as unknown as {navEditor:Element|null}).navEditor=document.querySelector('.source-editor .cm-content');});
    const dialog=page.getByRole('dialog',{name:'知识库',exact:true});
    const check=async()=>{
      await expect(dialog).toBeVisible();
      await expect(page.locator('.sidebar')).toBeVisible();
      await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','导航验证.md');
      await expect(page.locator('.code-output')).toHaveCount(0);
      expect(await page.evaluate(()=>(window as unknown as {navEditor:Element}).navEditor===document.querySelector('.source-editor .cm-content'))).toBe(true);
      expect(await fs.readFile(path.join(data,'示例知识库/导航验证.md'),'utf8')).toBe(original);
    };
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();await check();
    if(!process.env.MOYU_E2E_EXECUTABLE){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(project,'preview-v061-navigation-dark.png'),animations:'disabled'});}
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await page.locator('.workspace-picker').click();await check();
    await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();await check();
    await page.locator('.modal-overlay').click({position:{x:5,y:5}});await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'切换主题',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.evaluate(()=>{(window as unknown as {navEditor:Element|null}).navEditor=document.querySelector('.source-editor .cm-content');});
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();await check();
    if(!process.env.MOYU_E2E_EXECUTABLE){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(project,'preview-v061-navigation-light.png'),animations:'disabled'});}
    await dialog.locator('.recent-vaults button.current').click();await expect(dialog).toHaveCount(0);
    await page.locator('.source-editor .cm-content').evaluate((el:HTMLElement)=>el.focus());
    await page.keyboard.insertText('Y');
    await expect(page.locator('.source-editor .cm-content')).toContainText('# XY导航验证');
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();
    await dialog.getByRole('button',{name:'打开知识库',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'打开知识库',exact:true})).toBeEnabled();await expect(dialog).toBeVisible();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','导航验证.md');
    const other=path.join(data,'另一知识库');await fs.mkdir(path.join(other,'目录'),{recursive:true});
    await fs.writeFile(path.join(other,'开始使用.md'),'# 另一知识库\n');await fs.writeFile(path.join(other,'目录/笔记.md'),'# 子笔记\n');
    await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},other);
    await dialog.getByRole('button',{name:'打开知识库',exact:true}).click();
    await expect(dialog).toHaveCount(0);await expect(page.locator('.ProseMirror h1')).toHaveText('另一知识库');
    await expect(page.locator('.workspace-picker')).toHaveAttribute('title',other);
    await expect(page.locator('.tree-item[title="目录/笔记.md"]')).toBeVisible();
    expect(await fs.readFile(path.join(data,'示例知识库/导航验证.md'),'utf8')).toContain('# XY导航验证');
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();
    await expect(dialog.locator('.recent-vaults button')).toHaveCount(2);
    await dialog.locator('.recent-vaults button').filter({hasText:'示例知识库'}).click();
    await expect(dialog).toHaveCount(0);await expect(page.locator('.workspace-picker')).toHaveAttribute('title',path.join(data,'示例知识库'));
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('First launch still creates a knowledge base from visible onboarding',async()=>{
  await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'v061-first-'));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.MOYU_DEMO;
  const app=await electron.launch({...(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:['--disable-backgrounding-occluded-windows']}:{args:[project,'--disable-backgrounding-occluded-windows']}),env});
  try {
    const page=await app.firstWindow();await expect(page.getByRole('region',{name:'知识库导航',exact:true})).toBeVisible();
    await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},data);
    await page.getByLabel('知识库名称',{exact:true}).fill('新知识库');
    await page.getByRole('button',{name:'选择位置并创建',exact:true}).click();
    await expect(page.getByRole('region',{name:'知识库导航',exact:true})).toHaveCount(0);
    await expect(page.locator('.workspace-picker')).toContainText('新知识库');
    await page.getByRole('button',{name:'知识库导航',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
