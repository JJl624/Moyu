import {selectPreference} from './helpers/runtime-ui';
import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');

test('Settings survive a real restart in one English-named file; cache children are shown only under their directory',async()=>{
 const data=await fs.mkdtemp(path.join(work,'config-restart-'));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_SKIP_BUNDLED:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 let app=await launch();
 try{
  let page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  const show=async()=>{await (await app.browserWindow(page)).evaluate(window=>{window.show();window.focus();window.webContents.focus();window.webContents.setBackgroundThrottling(false);});};
  await show();
  const invoke=(action:string,input:unknown)=>page.evaluate(async({action,input})=>{const result=await window.moyu!.feature(action,input);if(!result.ok)throw Error(result.error?.message);return result.data;},{action,input});
  const [saved] = await Promise.all([
   invoke('preferences.set-many',{values:{'moyu-theme':'light','moyu-appearance':JSON.stringify({sidebarWidth:280})}}),
   invoke('code.runtime-configure',{language:'javascript',settings:{executionTimeoutSeconds:27}}),
   invoke('code.runtime-configure',{language:'sql',settings:{maxRows:31}}),
  ]);
  expect(saved).toBeUndefined();
  // DPAPI remains available in the desktop test just as in the normal app.
  await invoke('connections.save',{kind:'webdav',url:'https://example.com/dav',username:'reader',password:'test-secret'});
  const before=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));
  expect(before.values['moyu-theme']).toBe('light');expect(before.code.javascript.executionTimeoutSeconds).toBe(27);
  expect(Object.keys(before.connections)).toHaveLength(1);
  expect(JSON.stringify(before)).not.toContain('test-secret');
  await app.evaluate(({app})=>app.exit(0));await app.close().catch(()=>{});
  app=await launch();page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  await show();
  const settings:any=await invoke('preferences.get',{});expect(settings['moyu-theme']).toBe('light');
  const runtime:any=await invoke('code.runtime-state',{language:'javascript'});expect(runtime.settings.executionTimeoutSeconds).toBe(27);
  const sql:any=await invoke('code.runtime-state',{language:'sql'});expect(sql.settings.maxRows).toBe(31);
  const connection:any=await invoke('connections.get',{});expect(connection.webdav.username).toBe('reader');
  const password:any=await invoke('connections.password',{root:path.join(data,'示例知识库')});expect(password.password).toBe('test-secret');
  const files=await fs.readdir(data);expect(files.filter(name=>name.endsWith('.json'))).toEqual(['settings.json']);
  for(const name of ['cache','temp','crashes','logs'])expect(await fs.stat(path.join(data,'cache',...(name==='cache'?[]:[name])))).toBeTruthy();
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  await selectPreference(page,'数据与运行环境');
  const group=page.getByLabel('应用配置',{exact:true});await group.locator('summary').click();
  await expect(group.locator('.data-location')).toHaveCount(1);await expect(group).toContainText('settings.json');
  const caches=page.getByLabel('缓存与日志',{exact:true});await caches.locator('summary').click();
  await expect(caches.locator('.data-location')).toHaveCount(1);
  await caches.getByRole('button',{name:'展开 运行缓存',exact:true}).click();
  for(const name of ['temp','logs','crashes'])await expect(caches.getByRole('button',{name,exact:true})).toBeVisible();
  await page.locator('.modal').screenshot({path:path.join(work,'data-organized-v192.png'),animations:'disabled'});
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
