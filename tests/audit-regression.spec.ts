import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(data?:string){
  data ||= await fs.mkdtemp(path.resolve(project,'../../work/audit-v187-desktop-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});const page=await app.firstWindow();await expect(page.locator('.ProseMirror, .reading-view').first()).toBeVisible();
  return {app,page,data,root:path.join(data,'示例知识库')};
}
test('Source editing preserves Windows line endings and the edited cursor after mode switching',async()=>{
  const {app,page,root}=await fixture();try{
    const content='首行\r\n第二行😀\r\n尾行';await page.evaluate(content=>window.moyu!.create('行尾.md','file',content),content);await page.locator('.tree-item[title="行尾.md"]').dblclick();await page.getByRole('button',{name:'源码',exact:true}).click();
    await page.locator('.source-editor .cm-content').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(' edited');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('moyu:command','save'));
    await expect.poll(()=>fs.readFile(path.join(root,'行尾.md'),'utf8')).toBe(content+' edited');
    await page.getByRole('button',{name:'预览编辑',exact:true}).click();await page.getByRole('button',{name:'源码',exact:true}).click();await page.keyboard.insertText('!');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('moyu:command','save'));await expect.poll(()=>fs.readFile(path.join(root,'行尾.md'),'utf8')).toContain('edited!');
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('A legal ffff ID never prevents typing, saving or opening source mode',async()=>{
  const {app,page,root}=await fixture();try{
    const content='```text {id=ffff}\nold\n```\n\n```js\nconsole.log(1)\n```';await page.evaluate(content=>window.moyu!.create('满额.md','file',content),content);await page.locator('.tree-item[title="满额.md"]').dblclick();await expect(page.locator('.ProseMirror')).toContainText('old');
    await page.locator('.ProseMirror').focus();await page.keyboard.press('Control+End');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.keyboard.insertText('continued');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('moyu:command','save'));await expect.poll(()=>fs.readFile(path.join(root,'满额.md'),'utf8')).toContain('continued');await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('id=ffff');
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Application shortcuts do not replace an open settings dialog',async()=>{
  const {app,page}=await fixture();try{await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.keyboard.press('Control+n');await expect(page.getByRole('dialog')).toContainText('偏好设置');await expect(page.getByRole('dialog')).not.toContainText('文档名称');}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Recovery path conflicts open read-only and preserve externally changed files',async()=>{
  let {app,page,data,root}=await fixture();await app.evaluate(({app})=>app.exit(0));
  await fs.writeFile(path.join(root,'恢复旧.md'),'before');await fs.writeFile(path.join(root,'恢复新.md'),'external');await fs.writeFile(path.join(root,'.data/rename-transaction.json'),JSON.stringify({moves:[{from:'恢复旧.md',to:'恢复新.md'}],edits:[],configuration:[]}));
  ({app,page}=await fixture(data));try{const resultState:any=await page.evaluate(()=>window.moyu!.list());expect(resultState.data.readOnly).toBe(true);expect(resultState.data.warnings?.join('')).toContain('只读');const result:any=await page.evaluate(()=>window.moyu!.save('恢复新.md','overwrite','anything'));expect(result.ok).toBe(false);expect(await fs.readFile(path.join(root,'恢复新.md'),'utf8')).toBe('external');expect((await fs.stat(path.join(root,'.data/rename-transaction.json'))).isFile()).toBe(true);}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('Java formatter formats normally and downloaded formatter code has no Node or host network access',async()=>{
  test.setTimeout(90000);const data=await fs.mkdtemp(path.resolve(project,'../../work/audit-v187-java-'));await fs.cp(path.resolve(project,'../../work/runtime-v183/runtimes/java'),path.join(data,'runtimes/java'),{recursive:true});
  const {app,page}=await fixture(data);try{
    const input={language:'java',code:'public class Main{public static void main(String[] args){System.out.println(42);}}',config:{lineWidth:100,indentWidth:4,useTabs:false,newLineKind:'lf'},pluginConfig:{}};
    const normal:any=await page.evaluate(input=>window.moyu!.feature('code.format',input),input);expect(normal.ok,JSON.stringify(normal)).toBe(true);expect(normal.data).toContain('\n');
    const directory=path.join(data,'runtimes/java/Runtime/2026.10.12');await fs.writeFile(path.join(directory,'formatter-browser.mjs'),`export async function format(){const types=[typeof process,typeof require,typeof Buffer];for(const url of ['file:///C:/Windows/win.ini','http://127.0.0.1:1/'])try{await fetch(url);types.push('unexpected');}catch{types.push('blocked');}return JSON.stringify(types);}`);
    const isolated:any=await page.evaluate(input=>window.moyu!.feature('code.format',input),input);expect(isolated.ok,JSON.stringify(isolated)).toBe(true);expect(JSON.parse(isolated.data)).toEqual(['undefined','undefined','undefined','blocked','blocked']);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
