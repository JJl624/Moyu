import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { davServer } = require('./helpers/dav-server.cjs');
const project = path.resolve(import.meta.dirname, '..');
async function fixture(options = {}) {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/webdav-ui-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-theme':'light'}}));
  const env = {...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow(),server=await davServer(options),root=path.join(data,'示例知识库'),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return {app,page,server,root,data,errors,close:async()=>{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();}};
}

test('WebDAV settings persist policies and exclusions; automatic saved-file sync follows its trigger setting',async()=>{
  test.setTimeout(90000);const f=await fixture(),{page,app,root,server,errors}=f;
  try{
    await page.evaluate(()=>window.moyu!.create('自动同步.md','file','# 自动同步\n\n原文'));
    await fs.mkdir(path.join(root,'自动同步.assets','code-data','0001'),{recursive:true});await fs.mkdir(path.join(root,'自动同步.assets','attachments'),{recursive:true});
    await fs.writeFile(path.join(root,'自动同步.assets','code-data','0001','data.txt'),'data');await fs.writeFile(path.join(root,'自动同步.assets','attachments','中文.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(root,'ignored.tmp'),'skip');
    await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'WebDAV 设置',exact:true}).click();
    await page.getByRole('textbox',{name:'WebDAV 地址',exact:true}).fill(server.url);await page.getByRole('textbox',{name:'用户名',exact:true}).fill('user');await page.getByRole('textbox',{name:'密码',exact:true}).fill('secret');
    await page.getByRole('switch',{name:'打开知识库后同步',exact:true}).click();
    await page.getByRole('button',{name:'恢复默认',exact:true}).click();
    await expect(page.getByRole('switch',{name:'打开知识库后同步',exact:true})).toHaveAttribute('aria-checked','false');
    await expect(page.getByRole('textbox',{name:'WebDAV 地址',exact:true})).toHaveValue(server.url);
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.getByRole('switch',{name:'保存后同步',exact:true}).click();await page.getByRole('switch',{name:'同步代码数据',exact:true}).click();await page.getByRole('textbox',{name:'排除规则',exact:true}).fill('*.tmp');
    await page.locator('.dav-advanced summary').click();await page.getByRole('spinbutton',{name:'请求超时',exact:true}).fill('45');await page.getByRole('spinbutton',{name:'请求超时',exact:true}).press('Tab');
    await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'保存配置',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'清除密码',exact:true}).click();
    await page.getByRole('textbox',{name:'密码',exact:true}).fill('secret');
    await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.locator('.feature-message')).toContainText('连接成功');
    const config:any=await page.evaluate(()=>window.moyu!.feature('connections.get'));expect(config.data.webdav.sync).toMatchObject({afterSave:true,includeCodeData:false,excludes:'*.tmp',timeout:45});expect(config.data.webdav.password).toBeUndefined();
    await page.screenshot({path:path.resolve(project,'../../work/webdav-settings-light-v1721.png')});
    await page.locator('.pref-content').evaluate(el => el.scrollTop = 0);
    await expect(page.locator('.dav-number small').first()).toHaveCSS('white-space', 'nowrap');
    await page.screenshot({path:path.resolve(project,'../../work/webdav-settings-connection-v1721.png')});
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('dialog',{name:'首次同步',exact:true})).toBeVisible();expect(server.files.size).toBe(0);
    await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
    expect(server.files.has('/Moyu/ignored.tmp')).toBe(false);expect(server.files.has('/Moyu/自动同步.assets/code-data/0001/data.txt')).toBe(false);expect(server.files.has('/Moyu/自动同步.assets/attachments/中文.svg')).toBe(true);
    await page.getByRole('button',{name:'文件',exact:true}).click();await page.locator('.tree-item[title="自动同步.md"]').dblclick();
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');await page.locator('.ProseMirror p').last().click();await page.keyboard.press('End');await page.keyboard.insertText('保存后上传');
    await page.waitForTimeout(2300);expect(server.files.get('/Moyu/自动同步.md').toString()).not.toContain('保存后上传');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('moyu:command','save'));
    await expect.poll(()=>server.files.get('/Moyu/自动同步.md')?.toString(),{timeout:45000}).toContain('保存后上传');
    await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'WebDAV 设置',exact:true}).click();
    await page.getByRole('switch',{name:'保存后同步',exact:true}).click();await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    const saved:any=await page.evaluate(()=>window.moyu!.read('自动同步.md'));await page.evaluate(d=>window.moyu!.save(d.path,d.content+'\n\n手动同步',d.version),saved.data);
    await page.waitForTimeout(2300);expect(server.files.get('/Moyu/自动同步.md').toString()).not.toContain('手动同步');
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>server.files.get('/Moyu/自动同步.md')?.toString()).toContain('手动同步');
    await page.screenshot({path:path.resolve(project,'../../work/webdav-panel-light-v1721.png')});expect(errors).toEqual([]);
  }finally{await f.close();}
});

test('WebDAV progress can cancel a slow transfer, leaving the local document intact and allowing another sync',async()=>{
  test.setTimeout(60000);const f=await fixture(),{page,server,root,errors}=f;
  try{
    await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret',sync:{timeout:5,retries:0}}),server.url);
    await page.evaluate(()=>window.moyu!.create('slow.md','file','original'));await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
    server.files.set('/Moyu/slow.md',Buffer.from('remote updated'));server.delay({path:'/Moyu/slow.md',method:'GET',ms:10000});
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>server.requests.filter((r:any)=>r.path==='/Moyu/slow.md'&&r.method==='GET').length).toBe(1);
    await expect(page.locator('.dav-progress')).toContainText('扫描文件');await page.getByRole('button',{name:'取消同步',exact:true}).click();
    await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();expect(await fs.readFile(path.join(root,'slow.md'),'utf8')).toBe('original');
    expect(await fs.readdir(path.join(root,'.data/sync/transfers'))).toHaveLength(0);
    server.delay(null);await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>fs.readFile(path.join(root,'slow.md'),'utf8')).toBe('remote updated');expect(errors).toEqual([]);
  }finally{await f.close();}
});

test('A document saved during a real desktop upload is automatically uploaded again after that upload finishes',async()=>{
  test.setTimeout(90000);const f=await fixture(),{page,server}=f;
  try{
    await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret',sync:{retries:0}}),server.url);
    await page.evaluate(()=>window.moyu!.create('queued.md','file','# base'));
    const first:any=await page.evaluate(()=>window.moyu!.feature('webdav.sync',{}));
    if(first.data.needsConfirmation){const approved:any=await page.evaluate(token=>window.moyu!.feature('webdav.sync',{token}),first.data.token);expect(approved.ok).toBe(true);}
    await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret',sync:{afterSave:true,retries:0}}),server.url);
    const edit=async(content:string)=>page.evaluate(async content=>{const read=await window.moyu!.read('queued.md');if(!read.ok)throw Error('read failed');return window.moyu!.save('queued.md',content,read.data.version);},content);
    await edit('# first');server.delay({method:'PUT',path:'/Moyu/queued.md',ms:4000});const before=server.requests.length;
    await page.evaluate(()=>{(window as any).__manualSync=window.moyu!.feature('webdav.sync',{});});
    await expect.poll(()=>server.requests.slice(before).some((request:any)=>request.method==='PUT'&&request.path==='/Moyu/queued.md')).toBe(true);
    await edit('# saved while uploading');const manual:any=await page.evaluate(()=>(window as any).__manualSync);expect(manual.ok).toBe(true);
    await expect.poll(()=>server.files.get('/Moyu/queued.md')?.toString(),{timeout:45000}).toBe('# saved while uploading');
    expect(server.requests.slice(before).filter((request:any)=>request.method==='PUT'&&request.path==='/Moyu/queued.md')).toHaveLength(2);
  }finally{await f.close();}
});

test('Restarting the desktop app with startup sync enabled downloads the cloud update into the open document',async()=>{
  test.setTimeout(90000);const f=await fixture(),{app,page,server,data,root}=f;let restarted:any;
  try{
    await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret',sync:{onOpen:true,retries:0}}),server.url);
    await page.evaluate(()=>window.moyu!.create('startup.md','file','# startup\n\nbase'));
    const first:any=await page.evaluate(()=>window.moyu!.feature('webdav.sync',{}));
    if(first.data.needsConfirmation)await page.evaluate(token=>window.moyu!.feature('webdav.sync',{token}),first.data.token);
    await page.locator('.tree-item[title="startup.md"]').dblclick();await expect(page.locator('.ProseMirror')).toContainText('base');
    await app.close();server.files.set('/Moyu/startup.md',Buffer.from('# startup\n\nremote after restart'));
    const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1',MOYU_TEST_SKIP_BUNDLED:'1'};delete env.ELECTRON_RUN_AS_NODE;
    restarted=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});const restored=await restarted.firstWindow();
    await expect.poll(()=>fs.readFile(path.join(root,'startup.md'),'utf8'),{timeout:20000}).toContain('remote after restart');await expect(restored.locator('.ProseMirror')).toContainText('remote after restart');
  }finally{if(restarted)await restarted.evaluate(({app}:any)=>app.exit(0));await f.close();}
});

test('WebDAV UI reviews remote deletion, keeps conflict copies and restores document ownership after a download',async()=>{
  test.setTimeout(90000);const f=await fixture(),{page,root,server,errors}=f;
  try{
    const configure:any=await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret'}),server.url);expect(configure.ok).toBe(true);
    await page.evaluate(()=>window.moyu!.create('冲突.md','file','# 冲突\n\nbase'));
    await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
    const old:any=await page.evaluate(()=>window.moyu!.read('冲突.md'));await page.evaluate(d=>window.moyu!.save(d.path,'# 冲突\n\nlocal',d.version),old.data);server.files.set('/Moyu/冲突.md',Buffer.from('# 冲突\n\nremote'));
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.locator('.sync-conflict')).toContainText('冲突.md');await page.locator('.sync-conflict summary').click();await expect(page.locator('.sync-conflict .history-diff-editors')).toBeVisible();await expect(page.getByLabel('本地',{exact:true})).toContainText('local');await expect(page.getByLabel('远端',{exact:true})).toContainText('remote');await page.screenshot({path:path.resolve(project,'../../work/webdav-diff-v1817.png')});await page.getByRole('button',{name:'保留两份',exact:true}).click();await expect(page.locator('.sync-conflict')).toHaveCount(0);
    expect(await fs.readFile(path.join(root,'冲突-远端-1.md'),'utf8')).toContain('remote');expect(server.files.get('/Moyu/冲突.md').toString()).toContain('local');
    server.files.delete('/Moyu/冲突-远端-1.md');await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('dialog',{name:'确认同步删除',exact:true})).toBeVisible();expect(await fs.stat(path.join(root,'冲突-远端-1.md'))).toBeTruthy();
    await page.getByRole('button',{name:'取消',exact:true}).click();expect(await fs.stat(path.join(root,'冲突-远端-1.md'))).toBeTruthy();
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect.poll(()=>fs.stat(path.join(root,'冲突-远端-1.md')).then(()=>true,()=>false)).toBe(false);
    server.files.set('/Moyu/下载.md',Buffer.from('# 下载\n\n```python {id=0001}\nprint(1)\n```\n\n![图](<下载.assets/attachments/中文.svg>)'));
    server.directories.add('/Moyu/下载.assets');server.directories.add('/Moyu/下载.assets/attachments');server.files.set('/Moyu/下载.assets/document.json',Buffer.from('{"version":2,"document":"下载.md","nextId":2,"blocks":["0001"]}'));server.files.set('/Moyu/下载.assets/attachments/中文.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="red"/></svg>'));
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
    const map=JSON.parse(await fs.readFile(path.join(root,'.data/document_map.json'),'utf8'));expect(map.documents['下载.md'].directory).toBe('下载.assets');
    await page.getByRole('button',{name:'文件',exact:true}).click();await expect(page.locator('.tree-item[title="下载.md"]')).toBeVisible();await page.locator('.tree-item[title="下载.md"]').dblclick();await expect(page.locator('.syntax-preview img')).toBeVisible();
    const attachmentMap=JSON.parse(await fs.readFile(path.join(root,'.data/attachment_map.json'),'utf8'));expect(JSON.stringify(attachmentMap)).toContain('下载.assets/attachments/中文.svg');expect(errors).toEqual([]);
  }finally{await f.close();}
});

test('WebDAV reveals saved credentials explicitly and browses cached cloud structure without background requests',async()=>{
  const f=await fixture(),{page,server,root,errors}=f;try{
    await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret'}),server.url);
    server.directories.add('/Moyu');server.directories.add('/Moyu/资料');server.files.set('/Moyu/资料/中文.txt',Buffer.from('hello'));server.directories.add('/Moyu/空目录');
    await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'WebDAV 设置',exact:true}).click();
    await expect(page.locator('.pref-tabs button')).toHaveText(['字体与排版','界面','编辑','WebDAV','终端','代码','数据与运行环境']);
    await expect(page.getByRole('button',{name:'保存配置',exact:true})).toHaveCount(0);await expect(page.getByRole('switch',{name:'暂停自动同步',exact:true})).toHaveCount(0);
    const password=page.getByRole('textbox',{name:'密码',exact:true});await expect(password).toHaveValue('');await expect(password).toHaveAttribute('type','password');
    await page.getByRole('button',{name:'显示密码',exact:true}).click();await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue('secret');
    await page.getByRole('button',{name:'隐藏密码',exact:true}).click();await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue('');
    const config:any=await page.evaluate(()=>window.moyu!.feature('connections.get'));expect(config.data.webdav.password).toBeUndefined();
    const toggle=page.getByRole('switch',{name:'保存后同步',exact:true});for(let i=0;i<4;i++)await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked','false');

    const stored=Object.values(JSON.parse(await fs.readFile(path.join(f.data,'settings.json'),'utf8')).connections)[0] as any;expect(stored.webdav.secret).toBeUndefined();expect(stored.webdav.password).toBe('secret');
    const bounds=await page.locator('.dav-preferences').evaluate(el=>{const fields=el.querySelector('fieldset')!;const buttons=fields.querySelector('.dav-connection-actions')!,sync=el.querySelectorAll('h3')[1];return buttons.getBoundingClientRect().top<sync.getBoundingClientRect().top;});expect(bounds).toBe(true);
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.getByRole('tab',{name:'云端目录',exact:true}).click();
    const at=server.requests.length;await page.waitForTimeout(350);expect(server.requests.length).toBe(at);
    await page.getByRole('button',{name:'刷新云端目录',exact:true}).click();await expect(page.getByRole('treeitem',{name:/资料/})).toBeVisible();
    expect(server.requests.slice(at).every((r:any)=>r.method==='PROPFIND')).toBe(true);expect(await fs.stat(path.join(root,'资料/中文.txt')).then(()=>true,()=>false)).toBe(false);
    const cached=server.requests.length;await page.getByRole('treeitem',{name:/资料/}).click();await expect(page.getByRole('treeitem',{name:/中文.txt/})).toBeVisible();
    await page.getByLabel('筛选云端文件').fill('中文');await expect(page.getByRole('treeitem',{name:/中文.txt/})).toBeVisible();await page.waitForTimeout(350);expect(server.requests.length).toBe(cached);
    await page.screenshot({path:path.resolve(project,'../../work/webdav-cloud-v1722.png')});expect(errors).toEqual([]);
  }finally{await f.close();}
});

test('Bare server validators synchronize repeated edits; cloud dates are visible and records use only the panel scrollbar',async()=>{
 const f=await fixture({etagStyle:'bare',numericETag:true,lastModified:'Mon, 12 Oct 2026 04:00:00 GMT',created:'2026-10-01T00:00:00Z'}),{page,server,root,errors}=f;try{
  await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret',sync:{excludes:'*.tmp'}}),server.url);
  await page.evaluate(()=>window.moyu!.create('测试.md','file','原文'));
  for(let i=0;i<13;i++)await fs.writeFile(path.join(root,'跳过'+i+'.tmp'),'ignored');
  await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
  for(const text of ['更改1','更改2']){const r:any=await page.evaluate(()=>window.moyu!.read('测试.md'));await page.evaluate(v=>window.moyu!.save(v.path,v.content,v.version),{path:'测试.md',content:text,version:r.data.version});await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>server.files.get('/Moyu/测试.md')?.toString()).toBe(text);await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();await expect(page.locator('.dav-panel .feature-error')).toHaveCount(0);}
  await expect(page.locator('.dav-record-list')).toHaveCSS('max-height','none');await expect(page.locator('.dav-record-list')).toHaveCSS('overflow-y','visible');
  await page.locator('.dav-report summary').click();await expect(page.locator('.dav-report .dav-file-list')).toHaveCSS('max-height','none');await expect(page.locator('.dav-report .dav-file-list')).toHaveCSS('overflow-y','visible');await expect(page.locator('.dav-report .dav-file-list')).toContainText('跳过12.tmp');
  const list=await page.locator('.dav-report .dav-file-list').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));expect(list.height).toBe(list.scroll);expect(list.height).toBeGreaterThan(220);
  await page.screenshot({path:path.resolve(project,'../../work/webdav-records-v1723.png')});
  await page.getByRole('tab',{name:'云端目录',exact:true}).click();await page.getByLabel('筛选云端文件').fill('测试.md');await expect(page.getByLabel('云端修改时间',{exact:true})).toHaveAttribute('datetime','2026-10-12T04:00:00.000Z');
  const count=server.requests.length;await page.waitForTimeout(300);expect(server.requests.length).toBe(count);await page.screenshot({path:path.resolve(project,'../../work/webdav-cloud-time-v1723.png')});expect(errors).toEqual([]);
 }finally{await f.close();}
});

 test('cloud refresh does not impersonate synchronization and immediate sync refreshes uploaded structure',async()=>{const f=await fixture(),{page,server}=f;try{
  await page.evaluate(url=>window.moyu!.feature('connections.save',{kind:'webdav',url,directory:'/Moyu',username:'user',password:'secret'}),server.url);server.directories.add('/Moyu');server.delay({path:'/Moyu',method:'PROPFIND',ms:1000});await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('tab',{name:'云端目录',exact:true}).click();await page.getByRole('button',{name:'刷新云端目录',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'正在同步…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();server.delay(null);
  await page.evaluate(()=>window.moyu!.create('同步后可见.md','file','hello'));await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('dialog',{name:'首次同步'})).toBeVisible();await page.getByRole('button',{name:'开始同步',exact:true}).click();await expect(page.getByRole('dialog',{name:'首次同步'})).toHaveCount(0);await page.getByLabel('筛选云端文件').fill('同步后可见.md');await expect(page.getByRole('treeitem').filter({hasText:'同步后可见.md'})).toBeVisible();
 }finally{await f.close();}});
