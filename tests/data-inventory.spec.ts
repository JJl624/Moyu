import {selectPreference} from './helpers/runtime-ui';
import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
test('Data settings group actual application, runtime, cache, workspace files without export tracking; unknown/hidden files remain browsable',async()=>{
 const data=await fs.mkdtemp(path.resolve(project,'../../work/inventory-ui-'));
 await fs.mkdir(path.join(data,'Python/Runtime/0.28.0'),{recursive:true});await fs.mkdir(path.join(data,'Python/Runtime/0.29.0'),{recursive:true});
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-theme':'light'}}));
 await fs.mkdir(path.join(data,'未知目录'));await fs.writeFile(path.join(data,'未知目录/中文文件.txt'),'内容');
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(data,'导出.html'));
  const exported=await page.evaluate(()=>window.moyu!.exportFile('html','文档.md','<p>导出</p>'));expect(exported.ok).toBe(true);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'数据与运行环境');
  for(const name of ['应用配置','运行环境','缓存与日志','知识库文件'])await expect(page.locator('.data-group').getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.locator('.data-group[aria-label="导出文件"]')).toHaveCount(0);expect(await fs.stat(path.join(data,'exports.json')).catch(()=>null)).toBeNull();
  await page.screenshot({path:path.resolve(project,'../../work/data-categories-v1715.png')});
  await page.locator('.data-group[aria-label="应用配置"] > summary').click();await page.getByRole('button',{name:'展开 应用数据目录',exact:true}).click();
  const tree=page.locator('.data-preferences > .data-location .data-file-tree').first();
  await tree.getByRole('button',{name:'未知目录',exact:true}).click();await expect(tree).toContainText('中文文件.txt');await expect(tree).not.toContainText('exports.json');
  const list:any=await page.evaluate(()=>window.moyu!.feature('data.list'));expect(list.ok).toBe(true);
  expect(list.data.filter((x:any)=>x.id==='python')).toHaveLength(1);
  expect(list.data.filter((x:any)=>x.id.startsWith('python-packages-'))).toHaveLength(0);
  const runtimes=page.locator('.data-group[aria-label="运行环境"]');
  if(await runtimes.getAttribute('open')===null)await runtimes.locator(':scope > summary').click();
  await expect(runtimes).not.toContainText('Python 管理');
  await expect(runtimes.getByRole('button',{name:'删除数据 Python',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'展开 Python',exact:true}).click();
  await runtimes.getByRole('button',{name:'Runtime',exact:true}).click();
  await expect(runtimes.getByRole('button',{name:'0.28.0',exact:true})).toBeVisible();
  await expect(runtimes.getByRole('button',{name:'0.29.0',exact:true})).toBeVisible();
  for(const id of ['cache','vault','program','python','settings'])expect(list.data.some((x:any)=>x.id===id&&x.group)).toBe(true);
  expect(list.data.filter((x:any)=>x.group==='application').map((x:any)=>x.id)).toEqual(['settings']);
  expect(list.data.filter((x:any)=>x.group==='cache').map((x:any)=>x.id)).toEqual(['cache']);
  const caches=page.locator('.data-group[aria-label="缓存与日志"]');await caches.locator(':scope > summary').click();
  await caches.getByRole('button',{name:'展开 运行缓存',exact:true}).click();
  for(const name of ['temp','logs','crashes'])await expect(caches.getByRole('button',{name,exact:true})).toBeVisible();
  await page.locator('.data-group[aria-label="知识库文件"] > summary').click();await page.getByRole('button',{name:'展开 知识库数据',exact:true}).click();await expect(page.locator('.data-group[aria-label="知识库文件"]')).toContainText('attachment_map.json');
  await page.screenshot({path:path.resolve(project,'../../work/data-grouped-v1715.png')});expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

