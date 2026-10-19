import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
 const data=await fs.mkdtemp(path.resolve(project,'../../work/markdown-preservation-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible({timeout:30000});
 await(await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
 return{app,page,data};
}
test('Local preview edits retain untouched Markdown spelling, gaps, comments, fences and line endings',async()=>{
 const {app,page,data}=await fixture();
 try{
  const originals=[
   '#   标题\n\n\n段落起点\n\n*   第一项\n*   第二项\n\n~~~js {id=0011}\nconsole.log(1);\n~~~\n\n<!-- 原始注释 -->\n\n保留 \\*星号\\* 和 &amp; 实体\n\n尾段',
   '#   标题\r\n\r\n段落起点\r\n\r\n7) 有序列表\r\n8) 第二项\r\n\r\n>   引用原文\r\n\r\n尾段\r\n',
  ];
  for(const [i,original] of originals.entries()){
   const name=`保持原文${i}.md`;await page.evaluate(({name,original})=>window.moyu!.create(name,'file',original),{name,original});
   await page.locator(`.tree-item[title="${name}"]`).dblclick();
   await page.locator('.ProseMirror > p').filter({hasText:'段落起点'}).click();await page.keyboard.press('End');await page.keyboard.insertText('追加');
   await expect(page.locator('.save-status')).toContainText('本地未保存');await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
   expect(await fs.readFile(path.join(data,'示例知识库',name),'utf8')).toBe(original.replace('段落起点','段落起点追加'));
  }
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Editing a list item or Setext heading retains its source form; structural edits stay parseable',async()=>{
 const {app,page,data}=await fixture();
 try{
  const original='标题原文\n========\n\n*   列表原文\n*   不变的项\n\n尾段';
  await page.evaluate(original=>window.moyu!.create('块内编辑.md','file',original),original);await page.locator('.tree-item[title="块内编辑.md"]').dblclick();
  await page.locator('.ProseMirror h1').click();await page.keyboard.press('End');await page.keyboard.insertText('追加');
  await expect(page.locator('.save-status')).toContainText('本地未保存');await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
  const first=original.replace('标题原文','标题原文追加');expect(await fs.readFile(path.join(data,'示例知识库','块内编辑.md'),'utf8')).toBe(first);
  await page.locator('.ProseMirror li p').filter({hasText:'列表原文'}).click();await page.keyboard.press('End');await page.keyboard.insertText('追加');
  await expect(page.locator('.save-status')).toContainText('本地未保存');await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
  expect(await fs.readFile(path.join(data,'示例知识库','块内编辑.md'),'utf8')).toBe(first.replace('列表原文','列表原文追加'));
  await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.insertText('新增段落');
  await expect(page.locator('.save-status')).toContainText('本地未保存');await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
  const saved=await fs.readFile(path.join(data,'示例知识库','块内编辑.md'),'utf8');expect(saved).toContain('标题原文追加\n========');expect(saved).toContain('*   不变的项');expect(saved).toContain('新增段落');
  await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('新增段落');await page.getByRole('button',{name:'预览编辑',exact:true}).click();await expect(page.locator('.ProseMirror > p').last()).toHaveText('新增段落');
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
