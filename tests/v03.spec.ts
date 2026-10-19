import {test,expect,_electron as electron,type Page} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const work=path.resolve(project,'../../work/e2e');
async function invoke<T>(page:Page,action:string,input?:unknown):Promise<T> {
  const r=await page.evaluate(async args=>await window.moyu!.feature(args.action,args.input),{action,input}) as unknown as {ok:boolean;data:T;error:{message:string}};
  if(!r.ok)throw new Error(r.error.message);return r.data;
}
test('Visible file storage, navigation, system fonts, independent typography, reading and element menus',async()=>{
  test.setTimeout(120000);await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'v03-'));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.MOYU_DEMO;
  const app=await electron.launch({args:[project],env});const errors:string[]=[];
  try {
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await expect(page.getByRole('region',{name:'知识库导航'})).toBeVisible();
    expect(await fs.readdir(data)).not.toContain('示例知识库');
    await page.screenshot({path:path.join(project,'preview-navigation.png')});
    await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},data);
    await page.getByLabel('知识库名称',{exact:true}).fill('测试知识库');
    await page.getByRole('checkbox',{name:'加入示例文档'}).uncheck();
    await page.getByRole('button',{name:'选择位置并创建'}).click();
    const root=path.join(data,'测试知识库');await expect.poll(()=>fs.readdir(root)).toEqual([]);
    const md='# 阅读验证\n\n- ## 列表中的标题\n\n  ```typescript\n  const total: number = 21 * 2;\n  console.log(total);\n  ```\n\n  | 姓名 | 数量 |\n  | --- | --- |\n  | 编辑器 | 1 |\n\n- [ ] 只读任务\n\n**加粗** 与 $x^2$\n\n<script>window.hacked = true</script>\n';
    await page.evaluate(async ({md})=>{await window.moyu!.create('阅读验证.md','file',md);},{md});
    await page.getByRole('button',{name:'阅读验证',exact:true}).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('阅读验证');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    await page.getByRole('button',{name:'选择源码界面字体',exact:true}).click();
    await expect.poll(()=>page.getByRole('option').count()).toBeGreaterThan(2);await page.keyboard.press('Escape');
    await page.getByLabel('源码界面字体',{exact:true}).fill('Consolas');
    await page.getByLabel('源码界面字号',{exact:true}).fill('19');
    await page.getByRole('button',{name:'阅读正文',exact:true}).click();
    await page.getByLabel('阅读正文字体',{exact:true}).fill('Georgia');
    await page.getByLabel('阅读正文字号',{exact:true}).fill('22');
    await page.getByRole('button',{name:'界面',exact:true}).click();
    await page.getByRole('button',{name:'Nord',exact:true}).click();
    await page.screenshot({path:path.join(project,'preview-themes.png')});
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await expect(page.locator('.app')).toHaveCSS('background-color','rgb(46, 52, 64)');
    await page.getByRole('button',{name:'源码',exact:true}).click();
    await expect(page.locator('.cm-scroller')).toHaveCSS('font-family',/Consolas/);
    await expect(page.locator('.cm-editor')).toHaveCSS('font-size','19px');
    await page.getByRole('button',{name:'阅读',exact:true}).click();
    await expect(page.locator('.reading-view li h2')).toHaveText('列表中的标题');
    await expect(page.locator('.reading-view li table')).toBeVisible();
    await expect(page.locator('.reading-view input[type=checkbox]')).toBeDisabled();
    await expect(page.locator('.reading-view [contenteditable=true], .ProseMirror, .cm-editor')).toHaveCount(0);
    await expect(page.locator('.reading-view')).toHaveCSS('font-family',/Georgia/);
    await expect(page.locator('.reading-view')).toHaveCSS('font-size','22px');
    expect(await page.evaluate(()=>('hacked' in window))).toBe(false);
    await expect(page.locator('.reading-view .katex')).toBeVisible();
    await expect(page.getByRole('button',{name:'阅读',exact:true})).toHaveClass('selected');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(project,'preview-reading.png')});
    await page.locator('.reading-view pre').click({button:'right'});
    await page.getByRole('menuitem',{name:'运行代码块',exact:true}).click();
    await expect(page.locator('.code-output')).toHaveText('42\n');
    await page.screenshot({path:path.join(project,'preview-code.png')});
    await page.getByRole('button',{name:'关闭运行结果',exact:true}).click();
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    await page.getByRole('button',{name:'数据与运行环境',exact:true}).click();
    await expect(page.locator('.data-preferences')).toContainText('settings.json');
    await page.screenshot({path:path.join(project,'preview-data.png')});
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).values['moyu-appearance']).toContain('Consolas');
    expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
    expect(errors).toEqual([]);
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  } finally {if(app.process().exitCode===null) await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Python and JS/TS execute offline in fresh sandboxes with denied host/network access, cancellation and timeout',async()=>{
  test.setTimeout(180000);await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'runner-'));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.MOYU_DEMO;
  const app=await electron.launch({args:[project],env});
  try {
    const page=await app.firstWindow();await expect(page.getByRole('region',{name:'知识库导航'})).toBeVisible();
    const run=(language:string,code:string)=>invoke<{output:string;error:string}>(page,'code.run',{language,code});
    expect(await run('python','import math\nprint(math.sqrt(81))\nprint("离线 Python")')).toMatchObject({output:'9.0\n离线 Python\n',error:''});
    expect(await run('typescript','enum Direction { Left, Right }; const n: number = 42; console.log(n, Direction.Right)')).toMatchObject({output:'42 1\n',error:''});
    expect((await run('js','console.log(typeof process, typeof require, typeof window); globalThis.secret = 42')).output).toBe('undefined undefined undefined\n');
    expect((await run('js','console.log(typeof globalThis.secret); try { await fetch("https://example.com/"); } catch { console.log("network blocked"); } try { await fetch("moyu-asset://vault/secret.md"); } catch { console.log("files blocked"); }')).output).toBe('undefined\nnetwork blocked\nfiles blocked\n');
    expect((await run('python','from js import fetch\ntry:\n    await fetch("https://example.com/")\nexcept Exception:\n    print("network blocked")\ntry:\n    open("C:/Users/Liang/Documents/private.txt")\nexcept Exception:\n    print("files blocked")')).output).toContain('network blocked\nfiles blocked\n');
    expect((await run('js','console.log("x".repeat(200000));')).output.length).toBeLessThanOrEqual(65536);
    expect((await run('js','while (true) {}')).error).toContain('10 秒');
    const longRun=run('js','while (true) {}');await new Promise(resolve=>setTimeout(resolve,1000));await invoke(page,'code.stop');await expect(longRun).rejects.toThrow('已停止');
    expect((await run('js','return 6 * 7')).output).toBe('42\n');
  } finally {await app.evaluate(({app})=>app.exit(0));}
});
