import {selectPreference} from './helpers/runtime-ui';
import {_electron as electron, expect, test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const names=['Frame','Nord','纸张','GitHub','Dracula','Solarized','森林','玫瑰松'];
const snapshotFile=path.join(project,'tests/fixtures/theme-v1713-rendered.json');
test('Rendered themes match 0.17.13 in both modes, editor views, menus and drawing UI',async()=>{
 test.setTimeout(180000);
 const data=await fs.mkdtemp(path.resolve(project,'../../work/theme-rollback-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-theme':'light','moyu-save-policy':'manual'}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.MOYU_THEME_REFERENCE||process.env.MOYU_E2E_EXECUTABLE;
 const app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[project],env});
 const page=await app.firstWindow(),errors:string[]=[],snapshots:Record<string,unknown>={};page.on('pageerror',e=>errors.push(e.message));
 async function style(selector:string){const el=page.locator(selector).first();await expect(el).toBeVisible();return el.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,border:s.borderTopColor,shadow:s.boxShadow};});}
 try{
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  await page.addStyleTag({content:'*, *::before, *::after {transition:none!important;animation:none!important;}'});
  await page.evaluate(()=>window.moyu!.create('主题.md','file','# 标题\n\n正文 `inline` 与 **粗体**\n\n> 引用\n\n```js\nconst name = "text";\n```\n\n结束\n'));
  await page.locator('.tree-item[title="主题.md"]').dblclick();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
  await fs.writeFile(path.join(data,'示例知识库','主题绘图.excalidraw'),JSON.stringify({type:'excalidraw',version:2,source:'moyu',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}}));
  for(const mode of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==mode)await page.getByRole('button',{name:'切换主题',exact:true}).click();
   await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'界面');
   for(const name of names){
    await page.locator('.theme-grid').getByRole('button',{name,exact:true}).click();
    const tokens=await page.locator('.app').evaluate(el=>{const s=getComputedStyle(el);return Object.fromEntries(['--bg','--sidebar','--rail','--surface','--elevated','--text','--heading','--accent','--secondary','--muted','--hover','--selected','--border','--border-strong'].map(key=>[key,s.getPropertyValue(key).trim()]));});
    snapshots[`${mode}/${name}`]={tokens,modal:await style('.modal'),button:await style('.theme-grid button.selected')};
   }
   await page.locator('.theme-grid').getByRole('button',{name:'Frame',exact:true}).click();
   await selectPreference(page,'字体与排版');await page.getByLabel('正文字体',{exact:true}).click();
   snapshots[`${mode}/font`]=await style('.font-options');await page.keyboard.press('Escape');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
   snapshots[`${mode}/editor`]={body:await style('.ProseMirror'),heading:await style('.ProseMirror h1'),quote:await style('.ProseMirror blockquote'),inline:await style('.ProseMirror code'),block:await style('.milkdown-code-block'),code:await style('.milkdown-code-block .cm-editor'),keyword:await style('.milkdown-code-block .tok-keyword')};
   await page.locator('.milkdown-code-block .cm-content').click({button:'right'});snapshots[`${mode}/menu`]=await style('.element-menu');await page.keyboard.press('Escape');
   await page.screenshot({path:path.resolve(project,`../../work/theme-restored-${mode}-v1716.png`)});
   await page.getByRole('button',{name:'源码',exact:true}).click();snapshots[`${mode}/source`]=await style('.source-editor .cm-editor');
   await page.getByRole('button',{name:'阅读',exact:true}).click();snapshots[`${mode}/read`]={body:await style('.reading-view'),inline:await style('.reading-view :not(pre)>code'),block:await style('.reading-view pre')};
   await page.getByRole('button',{name:'预览编辑',exact:true}).click();
   await page.locator('.tree-item[title="主题绘图.excalidraw"]').dblclick();await expect(page.locator('.excalidraw')).toBeVisible();
   snapshots[`${mode}/drawing`]=await page.locator('.excalidraw').evaluate(el=>{const s=getComputedStyle(el);return Object.fromEntries(['--island-bg-color','--color-primary','--color-primary-light','--input-bg-color','--popup-bg-color','--default-bg-color'].map(key=>[key,s.getPropertyValue(key).trim()]));});
   await page.screenshot({path:path.resolve(project,`../../work/theme-restored-drawing-${mode}-v1716.png`)});
   await page.locator('.tab-name[title="主题.md"]').click();
  }
  expect(errors).toEqual([]);
  if(process.env.MOYU_THEME_REFERENCE)await fs.writeFile(snapshotFile,JSON.stringify(snapshots,null,2)+'\n');
  else expect(snapshots).toEqual(JSON.parse(await fs.readFile(snapshotFile,'utf8')));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

