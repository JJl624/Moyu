import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/context-settings-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-theme':'light'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_DEMO:'1',MOYU_TEST:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return {app,page,data,root:path.join(data,'示例知识库'),errors};
}
async function open(page:Page,file:string,content:string){await page.evaluate(({file,content})=>window.moyu!.create(file,'file',content),{file,content});await page.locator(`.tree-item[title="${file}"]`).dblclick();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');}
async function settings(page:Page,category:string){await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,category);}

test('Resource outdent acts once per list level, survives save and undo and disappears at root',async()=>{
  const {app,page,root,errors}=await fixture();try{
    await fs.writeFile(path.join(root,'图.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');
    for(const [name,source,selector] of [['代码','```python {id=00ab}\nprint(1)\n```','.milkdown-code-block'],['表格','| a | b |\n| - | - |\n| 1 | 2 |','.milkdown-table-block'],['公式','$$\nx^2\n$$','.math-block'],['图片','![图](图.svg)','.visual-attachment']]){
      await open(page,name+'脱离.md','- 外层\n\n  - 内层\n\n'+source.split('\n').map(line=>'    '+line).join('\n')+'\n\n    后续内容\n\n末尾');
      const block=page.locator(selector).first();await expect(block).toBeVisible();
      const depth=()=>block.locator('xpath=ancestor::ul | ancestor::ol').count();await expect.poll(depth).toBe(2);
      for(const expected of [1,0]){
        await (name==='图片'?page.locator('.attachment-overlay img'):block).click({button:'right'});await page.getByRole('menuitem',{name:'脱离列表',exact:true}).click();await expect.poll(depth).toBe(expected);
      }
      await (name==='图片'?page.locator('.attachment-overlay img'):block).click({button:'right'});await expect(page.getByRole('menuitem',{name:'脱离列表',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
      await page.locator('.save-status').click();await expect.poll(()=>fs.readFile(path.join(root,name+'脱离.md'),'utf8')).toMatch(/\n(?:```python|\| a|\$\$|!\[图)/);
      if(name==='代码')expect(await fs.readFile(path.join(root,name+'脱离.md'),'utf8')).toContain('id=00ab');
      await expect(page.locator('.ProseMirror')).toContainText('后续内容');await page.locator('.ProseMirror').focus();await page.keyboard.press('Control+z');await expect.poll(depth).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Context menus contain only matching operations, keep tab commands and hide Markdown mutations in reading',async()=>{
  const {app,page,errors}=await fixture();try{
    await open(page,'菜单.md','# 标题\n\n正文 **粗体** 与 `code`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n```python\nprint(1)\n```\n\n```markdown\ntext\n```\n\n[另一个文档](目标.md)\n\n末尾');
    await page.evaluate(()=>window.moyu!.create('目标.md','file','目标'));
    for(const selector of ['.ProseMirror h1','.ProseMirror > p','.inline-syntax','.milkdown-table-block td','.math-block .cm-content','.milkdown-code-block:not(.math-block) .cm-content']){
      await page.locator(selector).first().click({button:'right'});
      await expect(page.getByRole('menuitem',{name:/^(加粗|斜体|设为.*标题|转为.*标题|转换?为列表|行内代码)$/})).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.locator('.milkdown-table-block').dispatchEvent('contextmenu',{clientX:400,clientY:300});
    await expect(page.getByRole('menuitem',{name:'复制表格文本',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:/复制单元格|删除当前行|在下方插入行|引用|插入空白/})).toHaveCount(0);await page.keyboard.press('Escape');
    await page.locator('.math-block .cm-content').click({button:'right'});await expect(page.getByRole('menuitem',{name:'复制公式',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:/列表项|运行代码|格式化代码|查看数据/})).toHaveCount(0);await page.keyboard.press('Escape');
    await page.locator('.milkdown-code-block:not(.math-block) .cm-content').last().click({button:'right'});await expect(page.getByRole('menuitem',{name:/运行代码|格式化代码/})).toHaveCount(0);await page.keyboard.press('Escape');
    const link=page.locator('.inline-syntax').filter({hasText:'另一个文档'});await link.click({button:'right'});await expect(page.getByRole('menuitem',{name:'重命名文件',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:/删除附件|重命名附件|编辑绘图/})).toHaveCount(0);await page.keyboard.press('Escape');
    await page.locator('.tab.active .tab-name').click({button:'right'});await expect(page.getByRole('menuitem',{name:'关闭其他',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'阅读',exact:true}).click();await page.locator('.reading-view td').first().click({button:'right'});await expect(page.getByRole('menuitem',{name:/删除表格|引用|插入行|插入列|脱离列表|缩进至列表/})).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Formatting preview runs the selected plugin and configuration apply automatically on blur; validation preserves the saved configuration',async()=>{
  const {app,page,data,errors}=await fixture();try{
    await settings(page,'通用');const section=page.locator('.code-formatting'),json=page.getByLabel('dprint 配置 JSON'),preview=page.getByRole('button',{name:'格式化示例代码',exact:true});
    await expect(section.locator('select')).toHaveCount(1);await expect(preview).toHaveAttribute('data-formatted','false');
    const config=JSON.parse(await json.inputValue());config.typescript.quoteStyle='alwaysSingle';await json.fill(JSON.stringify(config));
    await preview.click();await expect(preview).toHaveAttribute('data-formatted','true');await expect(preview).toContainText("'Moyu'");
    const stored=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));expect(JSON.parse(stored.values['moyu-code-formatting']).typescript.quoteStyle).toBe('alwaysSingle');
    for(const language of ['typescript','python','c','cpp','sql','lua']){
      await page.getByLabel('预览语言').selectOption(language);await expect(preview).toHaveAttribute('data-formatted','false');
      await page.getByRole('button',{name:'更新格式化预览',exact:true}).click();await expect(preview).toHaveAttribute('data-formatted','true');expect((await preview.textContent())!.length).toBeGreaterThan(20);
    }
    config.stylua.unknownOption=true;await json.fill(JSON.stringify(config));await page.getByRole('button',{name:'更新格式化预览',exact:true}).click();await expect(section.getByRole('alert')).toContainText('unknownOption');await expect(preview).toHaveAttribute('data-formatted','false');
    delete config.stylua.unknownOption;await json.fill(JSON.stringify(config));await json.press('Tab');
    await expect.poll(async()=>JSON.parse(JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).values['moyu-code-formatting']||'{}').typescript?.quoteStyle).toBe('alwaysSingle');
    await page.screenshot({path:path.resolve(project,'../../work/formatting-preview-v1718.png')});
    await json.fill('{');await page.getByRole('button',{name:'更新格式化预览',exact:true}).click();await expect(section.getByRole('alert')).toBeVisible();expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Data settings use aligned compact rows, retain file browsing and remain usable in both themes and narrow windows',async()=>{
  const {app,page,data,errors}=await fixture();try{
    await fs.mkdir(path.join(data,'未知目录'));await fs.writeFile(path.join(data,'未知目录/文件.txt'),'内容');await settings(page,'数据与运行环境');
    await page.locator('.data-group[aria-label="应用配置"] > summary').click();await page.getByRole('button',{name:'展开 应用数据目录',exact:true}).click();
    await page.getByRole('button',{name:'未知目录',exact:true}).click();await expect(page.locator('.data-file-tree').first()).toContainText('文件.txt');
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme){await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.getByRole('button',{name:'切换主题',exact:true}).click();await settings(page,'数据与运行环境');await page.locator('.data-group[aria-label="应用配置"] > summary').click();}
      const overflow=await page.locator('.data-preferences').evaluate(el=>el.scrollWidth>el.clientWidth);expect(overflow).toBe(false);
      await expect(page.locator('.data-location').first()).toHaveCSS('display','grid');
      await expect(page.locator('.data-location-actions').first().getByRole('button')).toHaveCSS('width','24px');
      await page.screenshot({path:path.resolve(project,'../../work/data-settings-'+theme+'-v1718.png')});
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,680));expect(await page.locator('.data-preferences').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Empty documents, empty paragraphs and display math contain no placeholder prompt',async()=>{
  const {app,page,errors}=await fixture();try{
    await open(page,'无提示.md','');await expect(page.locator('[data-placeholder]')).toHaveCount(0);
    await page.locator('.ProseMirror').click();await page.keyboard.insertText('$$');await page.keyboard.press('Enter');await expect(page.locator('.math-block')).toHaveCount(1);
    await expect(page.locator('[data-placeholder]')).toHaveCount(0);await page.keyboard.press('Control+Enter');await expect(page.locator('[data-placeholder]')).toHaveCount(0);
    await page.locator('.ProseMirror').evaluate(el=>{const content=getComputedStyle(el,'::before').content;if(content.includes('输入内容'))throw Error('Placeholder remains');});expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Preference drafts commit on Enter, category switch and close; invalid JSON stays visible; Python does not refresh remotely',async()=>{
  const {app,page,data,errors}=await fixture();try{
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'JavaScript');
    const input=page.getByLabel('JavaScript / TypeScript 代码执行时限',{exact:true});await input.fill('15');await input.press('Enter');
    await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).code?.javascript?.executionTimeoutSeconds).toBe(15);
    await input.fill('16');await selectPreference(page,'SQL');
    await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).code?.javascript?.executionTimeoutSeconds).toBe(16);
    const name=page.getByLabel('SQL 数据库文件名',{exact:true});await name.fill('local.sqlite');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).code?.sql?.databaseFile).toBe('local.sqlite');
    await settings(page,'Python');await page.getByLabel('Python 代码执行时限',{exact:true}).fill('25');await page.keyboard.press('Tab');
    await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'Python/settings.json'),'utf8')).executionTimeoutSeconds).toBe(25);
    await page.getByRole('button',{name:'恢复默认',exact:true}).click();await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'Python/settings.json'),'utf8')).executionTimeoutSeconds).toBe(10);
    await selectPreference(page,'通用');const json=page.getByLabel('dprint 配置 JSON');const valid=await json.inputValue();
    await json.fill('{');await selectPreference(page,'SQL');await expect(json).toBeVisible();await expect(page.locator('.code-formatting').getByRole('alert')).toBeVisible();
    await json.fill(valid);await selectPreference(page,'SQL');await expect(page.locator('.runtime-version')).toContainText('sql.js');
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.getByRole('button',{name:'源码',exact:true}).click();
    await page.locator('.source-editor .cm-content').click();await page.keyboard.press('Control+f');const search=page.locator('.source-editor .cm-search');await expect(search).toBeVisible();
    await expect(search.getByRole('textbox',{name:'查找',exact:true})).toBeVisible();await expect(search.getByRole('textbox',{name:'替换',exact:true})).toBeVisible();
    await expect(search.getByRole('button',{name:'全部替换',exact:true})).toBeVisible();await expect(search.getByLabel('区分大小写',{exact:true})).toBeVisible();expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
