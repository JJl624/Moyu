import {selectPreference} from './helpers/runtime-ui';
import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
 const data=await fs.mkdtemp(path.resolve(project,'../../work/interface-polish-')),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]}),env}),page=await app.firstWindow();await expect(page.locator('.ProseMirror h1')).toBeVisible();return {app,page,data};
}
test('Highlight source editing, compact knowledge base navigation, neutral folder/data visibility, and paired font controls work in both themes',async()=>{
 test.setTimeout(120000);const {app,page,data}=await fixture();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await expect(page.locator('.sidebar-title>.workspace-picker')).toHaveCount(1);await expect(page.locator('.sidebar-title')).not.toContainText('工作空间');
  await page.getByRole('button',{name:'知识库导航',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  await expect(page.locator('.tree-item[title=".data"]')).toHaveCount(0);
  const visibility=page.getByRole('button',{name:'显示附属文件夹与数据',exact:true});await visibility.click();await expect(visibility).not.toHaveClass(/active/);await expect(page.locator('.tree-item[title=".data"]')).toBeVisible();await visibility.click();await expect(page.locator('.tree-item[title=".data"]')).toHaveCount(0);
  const file='高亮验证.md',markdown='## 标题\n\n前 ==高亮 **加粗**== 后\n\n`==代码==` 与 \\==普通文字==\n';
  await page.evaluate(({file,markdown})=>window.moyu!.create(file,'file',markdown),{file,markdown});await page.locator(`.tree-item[title="${file}"]`).dblclick();
  const preview=page.locator('.syntax-preview mark');await expect(preview).toContainText('高亮');await expect(preview.locator('strong')).toHaveText('加粗');
  await preview.click();await expect(page.locator('[data-syntax=highlight].editing .syntax-raw')).toContainText('==高亮 **加粗**==');await expect(page.locator('.moyu-source-highlight').first()).toBeVisible();
  await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('==高亮 **加粗**==');
  await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view mark')).toHaveText('高亮 加粗');await expect(page.locator('.reading-view code')).toHaveText('==代码==');
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  for(const [font,size]of [['正文字体','文字大小'],['标题字体','标题比例'],['代码字体','代码字号'],['界面字体','界面字号']])await expect(page.locator('.default-font-field').filter({has:page.getByLabel(font,{exact:true})}).getByLabel(size+'数值',{exact:true})).toBeVisible();
  await page.screenshot({path:path.resolve(project,'../../work/fonts-polish.png')});
  await page.getByLabel('文字大小数值',{exact:true}).fill('18');await page.getByLabel('标题比例数值',{exact:true}).fill('1.2');await page.getByLabel('界面字号数值',{exact:true}).fill('14');await page.getByLabel('界面字号数值',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'阅读正文',exact:true}).click();await page.getByLabel('阅读正文字号',{exact:true}).fill('26');await page.getByLabel('阅读正文字号',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'阅读标题',exact:true}).click();await expect(page.getByLabel('阅读标题字号',{exact:true})).toHaveCount(0);await page.getByLabel('阅读标题比例',{exact:true}).fill('0.95');await page.getByLabel('阅读标题比例',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'界面',exact:true}).click();await expect(page.getByLabel('界面字号数值',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  await expect(page.locator('.reading-view h2')).toHaveCSS('font-size','33.9625px');await page.getByRole('button',{name:'预览编辑',exact:true}).click();await expect(page.locator('.ProseMirror h2')).toHaveCSS('font-size','29.7px');
  for(const theme of ['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换主题',exact:true}).click();await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view mark')).toBeVisible();await page.screenshot({path:path.resolve(project,`../../work/interface-polish-${theme}.png`)});}
  await page.getByRole('button',{name:'预览编辑',exact:true}).click();await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type('==typed==');await expect(page.locator('[data-syntax=highlight]').filter({hasText:'typed'})).toHaveCount(1);
  expect(await fs.readFile(path.join(data,'示例知识库',file),'utf8')).toContain('==高亮 **加粗**==');expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('External-save conflict highlights modified characters and resolution preserves the chosen version',async()=>{
 const {app,page,data}=await fixture();
 try{
  const file='冲突验证.md',original='共同开头\n\n版本：原文\n\n共同结尾\n';await page.evaluate(({file,original})=>window.moyu!.create(file,'file',original),{file,original});await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'编辑');await page.getByLabel('保存方式',{exact:true}).selectOption('manual');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  await page.getByRole('button',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').click();await page.keyboard.press('Control+a');await page.keyboard.insertText(original.replace('原文','本地'));
  await expect(page.getByRole('button',{name:'本地未保存',exact:true})).toBeVisible();await fs.writeFile(path.join(data,'示例知识库',file),original.replace('原文','磁盘'));await page.getByRole('button',{name:'本地未保存',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'保留哪个版本？'})).toBeVisible();await expect(page.locator('.conflict-compare .diff-left')).toHaveText('本地');await expect(page.locator('.conflict-compare .diff-right')).toHaveText('磁盘');await expect(page.locator('.conflict-compare .diff-left')).not.toContainText('共同');
  await page.screenshot({path:path.resolve(project,'../../work/conflict-polish.png')});await page.getByRole('button',{name:'使用磁盘版本',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('磁盘');expect(await fs.readFile(path.join(data,'示例知识库',file),'utf8')).toContain('磁盘');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Mindmap round, circle, square and multiline labels are horizontally centered in both themes and modes',async()=>{
 test.setTimeout(120000);const {app,page}=await fixture();
 try{
  const code='mindmap\n  root((mindmap))\n    round(圆角节点)\n    square[方形节点]\n    circle((中文与 English))\n    multiline(第一行<br/>Second line)',markdown='```mermaid\n'+code+'\n```\n';
  await page.evaluate(markdown=>window.moyu!.create('思维导图.md','file',markdown),markdown);await page.locator('.tree-item[title="思维导图.md"]').dblclick();
  for(const mode of ['预览编辑','阅读']){
   await page.getByRole('button',{name:mode,exact:true}).click();
   for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换主题',exact:true}).click();
    const svg=page.locator('.mermaid-diagram>svg');await expect(svg).toHaveCount(1,{timeout:30000});
    await expect.poll(()=>svg.evaluate(svg=>Array.from(svg.querySelectorAll<SVGGElement>('.mindmap-node')).map(node=>{
     const rows=node.querySelectorAll<SVGTSpanElement>('.label .text-outer-tspan'),center=new DOMPoint(0,0).matrixTransform(node.getScreenCTM()!);
     return Array.from(rows).map(row=>{const box=row.getBoundingClientRect();return Math.abs(box.left+box.width/2-center.x);});
    }).flat())).toEqual(expect.arrayContaining([expect.any(Number)]));
    const offsets=await svg.evaluate(svg=>Array.from(svg.querySelectorAll<SVGGElement>('.mindmap-node')).flatMap(node=>{const center=new DOMPoint(0,0).matrixTransform(node.getScreenCTM()!);return Array.from(node.querySelectorAll('.label .text-outer-tspan')).map(row=>{const b=row.getBoundingClientRect();return Math.abs(b.left+b.width/2-center.x);});}));
    expect(offsets.length).toBeGreaterThanOrEqual(5);for(const offset of offsets)expect(offset).toBeLessThan(2);
    await page.screenshot({path:path.resolve(project,`../../work/mindmap-centered-${mode}-${theme}.png`)});
   }
  }
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
