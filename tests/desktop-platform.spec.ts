import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const data=await fs.mkdtemp(path.resolve(project,'../../work/desktop-platform-'));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'0'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  await(await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  return{app,page,data,root:path.join(data,'示例知识库'),errors};
}
test('Desktop fonts, detected host shells, terminal output, hidden sessions and exit work on the native platform',async()=>{
  const{app,page,root,errors}=await fixture();
  try{
    const fonts:any=await page.evaluate(()=>window.moyu!.feature('fonts.list'));
    expect(fonts.ok,JSON.stringify(fonts)).toBe(true);expect(fonts.data.length).toBeGreaterThan(0);
    const shells:any=await page.evaluate(()=>window.moyu!.feature('terminal.shells'));
    expect(shells.ok,JSON.stringify(shells)).toBe(true);expect(shells.data.some((s:any)=>s.shell!=='moyu:bash-wasm')).toBe(true);
    await page.getByRole('button',{name:/^(打开|显示)终端$/,exact:true}).click();await expect(page.locator('.terminal-screen .xterm')).toBeVisible();
    await page.locator('.terminal-screen').click();await page.keyboard.type('echo native-42>terminal-platform.txt');await page.keyboard.press('Enter');
    await expect.poll(()=>fs.readFile(path.join(root,'terminal-platform.txt'),'utf8').catch(()=>'' )).toContain('native-42');
    await page.getByRole('button',{name:'隐藏终端',exact:true}).last().click();await expect(page.locator('.terminal-panel')).toBeHidden();
    const before:any=await page.evaluate(()=>window.moyu!.feature('terminal.list'));expect(before.data).toHaveLength(1);
    await page.getByRole('button',{name:/^(打开|显示)终端$/,exact:true}).click();
    const after:any=await page.evaluate(()=>window.moyu!.feature('terminal.list'));expect(after.data[0].id).toBe(before.data[0].id);
    await page.locator('.terminal-screen').click();await page.keyboard.type('exit');await page.keyboard.press('Enter');
    await expect(page.locator('.terminal-panel')).toBeHidden();
    await expect.poll(async()=>{const r:any=await page.evaluate(()=>window.moyu!.feature('terminal.list'));return r.data.length;}).toBe(0);
    const wasm:any=await page.evaluate(()=>window.moyu!.feature('terminal.open',{shell:'moyu:bash-wasm'}));expect(wasm.ok,JSON.stringify(wasm)).toBe(true);
    await page.evaluate(id=>window.moyu!.feature('terminal.write',{id,data:'echo wasm-42\r'}),wasm.data.id);
    await expect.poll(async()=>{const r:any=await page.evaluate(id=>window.moyu!.feature('terminal.snapshot',{id}),wasm.data.id);return r.data?.output||'';}).toContain('wasm-42');
    await page.evaluate(()=>window.moyu!.feature('terminal.close-all'));
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Bundled languages run offline on the native platform, use sandbox files and retain Java and C# formatting',async()=>{
  test.setTimeout(240000);const{app,page,errors}=await fixture();
  try{
    const cases=[['js','console.log(6*7);'],['ts','const value: number = 42; console.log(value);'],['python','print(6*7)'],['c','printf("%d",6*7);'],['cpp','std::cout << 6*7;'],['lua','print(6*7)'],['ruby','puts 6*7'],['bash','echo $((6*7))'],['java','System.out.println(6*7);'],['csharp','Console.WriteLine(6*7);']];
    for(const [language,code]of cases){
      const result:any=await page.evaluate(input=>window.moyu!.feature('code.run',input),{language,code,scope:'memory'});
      expect(result.ok,language+JSON.stringify(result)).toBe(true);expect(result.data.error,language+JSON.stringify(result)).toBe('');expect(result.data.output.trim()).toBe('42');
    }
    const sql:any=await page.evaluate(()=>window.moyu!.feature('code.run',{language:'sql',code:'SELECT 42 AS answer;',scope:'memory'}));
    expect(sql.ok,JSON.stringify(sql)).toBe(true);expect(sql.data.error).toBe('');
    const rows:any=await page.evaluate(token=>window.moyu!.feature('code.result-page',{token}),sql.data.artifacts[0].token);expect(rows.data.rows).toEqual([['42']]);
    for(const [language,code]of [['java','public class Main{public static void main(String[] args){System.out.println(42);}}'],['csharp','class Program{static void Main(){System.Console.WriteLine(42);}}']]){
      const result:any=await page.evaluate(input=>window.moyu!.feature('code.format',input),{language,code,config:{lineWidth:100,indentWidth:4,useTabs:false,newLineKind:'lf'},pluginConfig:{}});
      expect(result.ok,language+JSON.stringify(result)).toBe(true);expect(result.data).toContain('42');expect(result.data).not.toBe(code);
    }
    const blocked:any=await page.evaluate(()=>window.moyu!.feature('code.run',{language:'python',code:'from pathlib import Path\nprint(Path("/etc/passwd").exists())'}));
    expect(blocked.data.output.trim()).toBe('False');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('TypeScript DOM results render and interact inside a sandbox on the native platform',async()=>{
  const{app,page,errors}=await fixture();
  try{
    const content='```ts\nconst start: number = 41; document.body.innerHTML = `<button id="answer">${start}</button>`; document.querySelector("button").onclick = event => event.target.textContent = String(start + 1);\n```';
    await page.evaluate(content=>window.moyu!.create('DOM平台.md','file',content),content);
    await page.locator('.tree-item[title="DOM平台.md"]').dblclick();
    await page.getByLabel('JavaScript 运行模式',{exact:true}).selectOption('dom');await page.getByRole('button',{name:'运行代码块',exact:true}).click();
    const button=page.frameLocator('iframe[title="HTML 运行结果"]').locator('#answer');await expect(button).toHaveText('41');await button.click();await expect(button).toHaveText('42');
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
