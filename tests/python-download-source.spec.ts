import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');

async function fixture(theme = 'light') {
  const data = await fs.mkdtemp(path.join(work, 'python-source-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({version:1,values:{'moyu-theme':theme}}));
  const env = {...process.env, MOYU_USER_DATA:data, MOYU_TEST:'1', MOYU_TEST_SKIP_BUNDLED:'1', MOYU_DEMO:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE
    ? {executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env} : {args:[project],env});
  const page = await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(window => {window.show();window.focus();window.webContents.focus();});
  await app.evaluate(() => {globalThis.fetch = async () => {throw Error('Unexpected network');};});
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  const open = async () => {
    await selectPreference(page,'Python');
    await page.getByRole('tab',{name:'环境',exact:true}).click();
    await expect(page.getByLabel('Python 下载源',{exact:true})).toBeVisible();
  };
  await open();
  const state = async () => (await page.evaluate(() => window.moyu!.feature('python.state')) as any).data;
  return {app,page,data,open,state};
}

for (const theme of ['light','dark']) test('Python source selection edits inline, preserves saved sources and validates before applying ('+theme+')', async () => {
  const {app,page,data,open,state} = await fixture(theme);
  try {
    const source = page.getByLabel('Python 下载源',{exact:true});
    await expect(page.getByRole('button',{name:'添加镜像',exact:true})).toHaveCount(0);
    await expect(page.locator('.runtime-mirror-fields')).toHaveCount(0);
    await expect(page.getByLabel('Python 镜像地址',{exact:true})).toHaveCount(0);
    await source.selectOption('custom');
    await expect(page.getByLabel('Python 镜像地址',{exact:true})).toBeVisible();
    expect((await state()).mirrors).toHaveLength(1);
    await source.selectOption('0');
    expect((await state()).mirrors).toHaveLength(1);
    await source.selectOption('custom');
    await page.getByLabel('Python 镜像名称',{exact:true}).fill('测试镜像');
    await page.getByLabel('Python 镜像地址',{exact:true}).fill('invalid');
    await page.getByLabel('Python 镜像地址',{exact:true}).press('Tab');
    await expect(page.locator('.runtime-notice[role=alert]')).toBeVisible();
    expect((await state()).mirrors.some((mirror:any)=>mirror.base==='invalid')).toBe(false);
    await page.getByLabel('Python 镜像地址',{exact:true}).fill('https://mirror.example.com/pyodide/');
    await page.getByLabel('Python 镜像地址',{exact:true}).press('Enter');
    await expect(page.locator('.runtime-notice[role=alert]')).toHaveCount(0);
    await page.getByLabel('Python 镜像目录结构',{exact:true}).selectOption('version');
    await page.getByLabel('Python 版本列表地址',{exact:true}).fill('https://index.example.com/');
    await page.getByLabel('Python 版本列表地址',{exact:true}).press('Enter');
    await expect.poll(async()=> (await state()).mirrors[1]).toEqual({name:'测试镜像',base:'https://mirror.example.com/pyodide/',index:'https://index.example.com/',layout:'version'});
    const inventory:any=await page.evaluate(()=>window.moyu!.feature('runtime.contents',{language:'python',version:'314.0.7'}));
    expect(inventory.ok,JSON.stringify(inventory)).toBe(true);
    expect(inventory.data.groups[0].files.every((file:any)=>file.url.startsWith('https://mirror.example.com/pyodide/314.0.7/'))).toBe(true);
    await selectPreference(page,'Lua');
    await open();
    await expect(source).toHaveValue('1');
    await expect(page.getByLabel('Python 镜像名称',{exact:true})).toHaveValue('测试镜像');
    await expect(page.getByLabel('Python 镜像目录结构',{exact:true})).toHaveValue('version');
    const saved=JSON.parse(await fs.readFile(path.join(data,'Python/settings.json'),'utf8'));
    expect(saved.mirrors[1].index).toBe('https://index.example.com/');
    await page.screenshot({path:path.join(work,'python-source-'+theme+'-v1826.png')});
    expect(await page.locator('.python-download-source').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
    await source.selectOption('0');
    await expect(page.getByLabel('Python 镜像地址',{exact:true})).toHaveCount(0);
    await source.selectOption('1');
    await page.getByRole('button',{name:'移除镜像',exact:true}).click();
    await expect(source).toHaveValue('0');
    await expect.poll(async()=> (await state()).mirrors.length).toBe(1);
  } finally {await app.evaluate(({app})=>app.exit(0));}
});
