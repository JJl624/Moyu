import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'), base = path.resolve(project, '../../work/e2e');
async function fixture(name: string) {
  await fs.mkdir(base,{recursive:true}); const data = await fs.mkdtemp(path.join(base,name+'-'));
  const env = {...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({...process.env.MOYU_E2E_EXECUTABLE ? {executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]} : {args:[project]},env});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.ProseMirror h1')).toBeVisible();return{app,page,data,errors};
}
async function blockInput(page:Page,action:string,input:any){if(!input.document||input.id||!/^code\.(run|data-upload|data-delete)$/.test(action))return input;const response:any=await page.evaluate(document=>window.moyu!.read(document),input.document);const normalized:any=await page.evaluate(v=>window.moyu!.feature('code.normalize',v),{document:input.document,content:response.data.content});const canonical=(l:string)=>/^(cpp|c\+\+|cc|cxx)$/i.test(l)?'cpp':/^(sql|sqlite)$/i.test(l)?'sql':/^(py|python)$/i.test(l)?'python':l.toLowerCase();const block=normalized.data.blocks.filter((b:any)=>canonical(b.language)===canonical(input.language))[(input.index||1)-1];return {...input,id:block.id,markdown:normalized.data.content};}
async function feature(page:Page,action:string,input:any={}){
  input=await blockInput(page,action,input);const r:any=await page.evaluate(({action,input})=>window.moyu!.feature(action,input),{action,input});expect(r.ok,JSON.stringify(r)).toBe(true);if(action==='code.run')for(const a of r.data.artifacts||[])if(a.kind==='table'){const pageResult:any=await page.evaluate(token=>window.moyu!.feature('code.result-page',{token,page:0}),a.token);a.rows=pageResult.data.rows;}return r.data;}
async function upload(page:Page,document:string,language:string,index:number,name:string,text:string){const input=await blockInput(page,'code.data-upload',{document,language,index,name});const r:any=await page.evaluate(v=>window.moyu!.feature('code.data-upload',{...v,bytes:new TextEncoder().encode(v.text)}),{...input,text});expect(r.ok,JSON.stringify(r)).toBe(true);}

test('SQL databases persist only in their own block folders; results are tables, limits apply, errors preserve the old database and other blocks remain separate',async()=>{
  test.setTimeout(120000);const{app,page,data,errors}=await fixture('sql-data');try{
    const document='数据库.md';await page.evaluate(document=>window.moyu!.create(document,'file','```sql\nSELECT 42;\n```\n\n```sqlite\nSELECT 1;\n```'),document);
    const run=(index:number,code:string)=>feature(page,'code.run',{document,language:index===1?'sql':'sqlite',index,code});
    const simple=await run(1,'SELECT 42 AS answer;');expect(simple.error,JSON.stringify(simple)).toBe('');expect(simple.artifacts[0].rows).toEqual([['42']]);expect(await feature(page,'code.data-list',{document})).toEqual([]);
    const created=await run(1,'CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES(1,\'中文\'); SELECT * FROM items;');expect(created.error,JSON.stringify(created)).toBe('');expect(created.artifacts[0].columns).toEqual(['id','name']);expect(created.artifacts[0].rows).toEqual([['1','中文']]);
    const groups=await feature(page,'code.data-list',{document});expect(groups.map((g:any)=>g.key)).toEqual(['0001']);const file=path.join(data,'示例知识库',groups[0].path,'database.sqlite'),bytes=await fs.readFile(file),stat=await fs.stat(file);expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\0');
    const failed=await run(1,'INSERT INTO items VALUES(2,\'error\');SELECT * FROM missing;');expect(failed.error).toContain('missing');expect(await fs.readFile(file)).toEqual(bytes);
    expect((await run(2,'SELECT * FROM items;')).error).toContain('items');expect((await run(1,'SELECT count(*) FROM items;')).artifacts[0].rows).toEqual([['1']]);expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
    await feature(page,'code.runtime-configure',{language:'sql',settings:{maxRows:2}});expect((await run(1,'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3;')).artifacts[0].rows).toEqual([['1'],['2']]);
    expect((await run(1,'CREATE TABLE p(id PRIMARY KEY);CREATE TABLE c(pid REFERENCES p(id));INSERT INTO c VALUES(99);')).error).toContain('FOREIGN KEY');expect(await fs.readFile(file)).toEqual(bytes);
    await feature(page,'code.runtime-configure',{language:'sql',settings:{foreignKeys:false}});expect((await run(1,'CREATE TABLE p(id PRIMARY KEY);CREATE TABLE c(pid REFERENCES p(id));INSERT INTO c VALUES(99);')).error).toBe('');expect(errors).toEqual([]);
    expect((await run(2,'PRAGMA user_version=7;')).error).toBe('');expect((await run(2,'PRAGMA user_version;')).artifacts[0].rows).toEqual([['7']]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Lua uses fresh variables and filesystem, reads block-local stdin and modules, saves I/O, and SQL/Lua cannot access host APIs or survive a stop timeout',async()=>{
  test.setTimeout(120000);const{app,page,data,errors}=await fixture('lua-io');try{
    const document='Lua.md';await page.evaluate(document=>window.moyu!.create(document,'file','```lua\nprint(42)\n```\n\n```lua\nprint(1)\n```'),document);
    const run=(index:number,code:string)=>feature(page,'code.run',{document,language:'lua',index,code});
    await upload(page,document,'lua',1,'stdin.txt','21\n');await upload(page,document,'lua',1,'calc.lua','return { twice=function(n) return n*2 end }');
    const result=await run(1,'local calc=require("calc"); n=io.read("*n"); print(calc.twice(n)); local f=assert(io.open("output/结果.txt","w"));f:write("保存");f:close();');expect(result.error,JSON.stringify(result)).toBe('');expect(result.output).toBe('42\n');expect(result.artifacts[0].name).toBe('结果.txt');
    const folder=(await feature(page,'code.data-list',{document}))[0].path;expect(await fs.readFile(path.join(data,'示例知识库',folder,'output/结果.txt'),'utf8')).toBe('保存');
    expect((await run(1,'print(n == nil);print(io.read("*n"))')).output).toBe('true\n21\n');expect((await run(2,'require("calc")')).error).toContain('calc');
    const standard=await run(1,'io.write("A"); print("B"); io.stdout:write("C"); io.stderr:write("D"); print(js == nil, globalThis == nil, process == nil, fetch == nil);');expect(standard.error,JSON.stringify(standard)).toBe('');expect(standard.output).toBe('AB\nCDtrue\ttrue\ttrue\ttrue\n');
    const host=path.join(data,'HOST.txt');await fs.writeFile(host,'HOST_SECRET');
    const isolated=await run(1,`print(os.execute == nil, os.getenv == nil, io.popen == nil, package.loadlib == nil);print(io.open(${JSON.stringify(host.replaceAll('\\','/'))},"r") == nil)`);expect(isolated.error,JSON.stringify(isolated)).toBe('');expect(isolated.output).toContain('true\ttrue\ttrue\ttrue');expect(isolated.output).toContain('true');
    await feature(page,'code.runtime-configure',{language:'lua',settings:{enableModules:false,executionTimeoutSeconds:1}});expect((await run(1,'require("calc")')).error).toContain('nil');expect((await run(1,'while true do end')).error).toContain('超过 1 秒');expect((await run(1,'print(42)')).output).toBe('42\n');
    await feature(page,'code.runtime-configure',{language:'sql',settings:{executionTimeoutSeconds:1}});const sql=(code:string)=>feature(page,'code.run',{language:'sql',code});expect((await sql(`ATTACH DATABASE '${host.replaceAll('\\','/')}' AS host;`)).error).toContain('ATTACH');expect((await sql('SELECT load_extension(\'host\');')).error).not.toBe('');expect((await sql('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n;')).error).toContain('超过 1 秒');expect((await sql('SELECT 42;')).artifacts[0].rows).toEqual([['42']]);
    expect(await fs.readFile(host,'utf8')).toBe('HOST_SECRET');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('SQL/Lua run buttons and table UI, settings, dprint configuration and active-tab formatting are integrated without modifying the document with results',async()=>{
  test.setTimeout(120000);const{app,page,data,errors}=await fixture('sql-lua-ui');try{
    const document='SQL和Lua.md',source='```sql\nselect 42 as answer;\n```\n\n```lua\nprint( 6*7 )\n```\n\n```tabs\n:::sql SQL\nselect 1 from users where id>1;\n:::lua Lua\nlocal x=1;print( x )\n```';await page.evaluate(v=>window.moyu!.create(v.document,'file',v.source),{document,source});await page.locator('.tree-item[title="SQL和Lua.md"]').dblclick();await expect(page.getByRole('button',{name:'运行代码块',exact:true})).toHaveCount(2);
    await page.getByRole('button',{name:'运行代码块',exact:true}).first().click();await expect(page.locator('.run-artifact table')).toContainText('42');await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.code-result')).toHaveCount(0);await page.getByRole('button',{name:'预览编辑',exact:true}).click();
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'SQL');await expect(page.locator('.runtime-version')).toContainText('sql.js');await page.getByLabel('SQL 数据库文件名',{exact:true}).fill('数据库.sqlite');await page.getByLabel('SQL 查询行数上限',{exact:true}).fill('20');await page.keyboard.press('Tab');await selectPreference(page,'Lua');await expect(page.locator('.runtime-version')).toContainText('Wasmoon');await page.getByLabel('Lua 标准输入文件',{exact:true}).fill('输入.txt');await page.keyboard.press('Tab');
    await selectPreference(page,'通用');const json=page.getByLabel('dprint 配置 JSON'),config=JSON.parse(await json.inputValue());config.stylua.quoteStyle='ForceSingle';await json.fill(JSON.stringify(config));await json.press('Tab');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    const editors=page.locator('.milkdown-code-block:not(.tabbed-code) .cm-content');await editors.nth(1).click({button:'right'});await page.getByRole('menuitem',{name:'格式化代码',exact:true}).click();await expect(editors.nth(1)).toContainText('print(6 * 7)');await page.locator('.tabs-editor .cm-content').click({button:'right'});await page.getByRole('menuitem',{name:'格式化代码',exact:true}).click();await expect(page.locator('.tabs-editor .cm-content')).toContainText('where id>1');
    const saved=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).code;expect(saved.sql.databaseFile).toBe('数据库.sqlite');expect(saved.lua.stdinFile).toBe('输入.txt');expect((await feature(page,'data.list')).filter((entry:any)=>['sql','lua'].includes(entry.id)).every((entry:any)=>entry.exists&&entry.readonly)).toBe(true);expect(errors).toEqual([]);
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    for(const name of ['SQL','Lua']){await selectPreference(page,name);await expect(page.locator('.runtime-version')).toBeVisible();await page.screenshot({path:path.join(base,name.toLowerCase()+'-settings-v1620.png')});}
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('SQL memory is independent per run, retains result tables, ignores existing files and never creates a data directory',async()=>{
  const {app,page,data,errors}=await fixture('sql-memory');try{
    const document='内存.md',code='CREATE TABLE t(v); INSERT INTO t VALUES (42); SELECT * FROM t;';
    await page.evaluate(v=>window.moyu!.create(v.document,'file','```sql {id=0001}\n'+v.code+'\n```\n\n```sql {id=0002}\nSELECT 1;\n```'),{document,code});
    await page.locator('.tree-item[title="内存.md"]').dblclick();
    const select=page.getByLabel('数据库范围').first();await expect(select.locator('option')).toHaveText(['块级','全局','内存']);await select.selectOption('memory');
    await page.getByRole('button',{name:'运行代码块',exact:true}).first().click();await expect(page.locator('.run-artifact table')).toContainText('42');
    expect(await fs.stat(path.join(data,'示例知识库/内存.assets')).then(()=>true,()=>false)).toBe(false);
    const second=await feature(page,'code.run',{document,id:'0001',language:'sql',scope:'memory',code:'SELECT * FROM t;'});expect(second.error).toContain('no such table');
    const other=await feature(page,'code.run',{document,id:'0002',language:'sql',scope:'memory',code:'SELECT * FROM t;'});expect(other.error).toContain('no such table');
    await expect(page.locator('.run-artifact table')).toContainText('42');
    const disk=await feature(page,'code.run',{document,id:'0001',language:'sql',scope:'block',code});expect(disk.error).toBe('');
    const file=path.join(data,'示例知识库/内存.assets/code-data/0001/database.sqlite'),before=await fs.readFile(file),stamp=(await fs.stat(file)).mtimeMs;
    const fresh=await feature(page,'code.run',{document,id:'0001',language:'sql',scope:'memory',code:'SELECT * FROM t;'});expect(fresh.error).toContain('no such table');
    expect(await fs.readFile(file)).toEqual(before);expect((await fs.stat(file)).mtimeMs).toBe(stamp);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
