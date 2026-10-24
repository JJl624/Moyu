import {selectMobile} from './helpers/mobile-controls.mjs';
import {test,expect,type Page} from '@playwright/test';
import {mobileDavFixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
const seed={files:{'a.md':{content:'# 初始内容'}}};
async function configure(page:Page,sync:Record<string,unknown>,extra:Record<string,unknown>={}){
  await page.evaluate(async({sync,extra})=>{const{mobileFeature}=await import('/src/mobile/native.ts');const state=(window as any).__mobileState,config={...state.davConnections[state.root],...extra,sync:{...state.davConnections[state.root].sync,...sync}};await mobileFeature('mobile.webdav-config',{root:state.root,config});window.dispatchEvent(new Event('moyu-mobile-sync-config'));},{sync,extra});
}
async function summary(page:Page){return page.evaluate(async()=>{const{syncKey,readSummary}=await import('/src/mobile/syncState.ts');const state=(window as any).__mobileState;return readSummary(await syncKey(state.root,state.davConnections[state.root]));});}
async function idle(page:Page){await expect.poll(()=>page.evaluate(async()=>!(await import('/src/mobile/syncState.ts')).currentSyncOperation())).toBe(true);}
async function restart(page:Page){await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');}
async function resumed(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-resume')));}
async function paused(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-pause')));}
const checks=(dav:any,from=0)=>dav.requests.slice(from).filter((request:any)=>request.method==='PROPFIND'&&request.headers.depth==='1');
async function synced(page:Page,dav:any,settings:Record<string,unknown>={onOpen:true}){
  await mobileDavFixture(page,dav,{initial:seed});await runMobileSync(page);await configure(page,{retries:0,...settings});
}
async function source(page:Page){
  await restart(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await selectMobile(page,'保存方式','manual');await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="a.md"] .mobile-file-open').click();
  await page.getByRole('tab',{name:'源码',exact:true}).click();return page.locator('.source-editor .cm-content');
}

test('Cold startup downloads a newer cloud copy and refreshes the open document once',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);dav.files.set('/a.md',Buffer.from('# 启动时更新'));const before=dav.requests.length;await restart(page);await expect(page.locator('.reading-view')).toContainText('启动时更新');await idle(page);expect(checks(dav,before)).toHaveLength(1);expect(dav.requests.slice(before).some((item:any)=>['PUT','DELETE'].includes(item.method))).toBe(false);}finally{await dav.close();}
});

test('Saving one document while another stays dirty queues sync until the remaining draft is discarded',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'原文 A'},'b.md':{content:'原文 B'}}}});await runMobileSync(page);await configure(page,{onOpen:false,afterSave:true});await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await selectMobile(page,'保存方式','manual');await page.getByRole('button',{name:'笔记',exact:true}).click();
    await page.locator('[data-path="a.md"] .mobile-file-open').click();await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('保留在本机的 A 草稿');await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.locator('[data-path="b.md"] .mobile-file-open').click();await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('已保存的 B');const before=dav.requests.length;await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.getByRole('button',{name:'保存文档',exact:true})).toHaveCount(0);await page.waitForTimeout(1500);expect(dav.requests.length).toBe(before);
    await page.locator('.mobile-document-title').click();await page.getByRole('button',{name:'关闭 a',exact:true}).click();await page.getByRole('dialog',{name:'未保存的修改'}).getByRole('button',{name:'放弃修改',exact:true}).click();await expect.poll(async()=>(await summary(page)).pendingUploads,{timeout:45000}).toEqual(['b.md']);expect(dav.files.get('/a.md')?.toString()).toBe('原文 A');expect(dav.files.get('/b.md')?.toString()).toBe('原文 B');
  }finally{await dav.close();}
});

test('Manual sync checks drafts first and cancellation leaves both disk and cloud unchanged',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false,afterSave:false});const edit=await source(page);await edit.fill('# 手机误操作草稿');await paused(page);await resumed(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();const before=dav.requests.length;await page.getByRole('button',{name:'立即同步',exact:true}).click();const dialog=page.getByRole('dialog',{name:'同步前处理修改'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(dav.requests.length).toBe(before);expect(dav.files.get('/a.md')?.toString()).toBe('# 初始内容');expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 初始内容');await page.locator('[data-path="a.md"] .mobile-file-open').click();await expect(page.locator('.reading-view')).toContainText('手机误操作草稿');}finally{await dav.close();}
});

test('Automatic sync defers while any open document has a draft, without prompting or touching the server',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false,afterSave:false});const edit=await source(page);await edit.fill('保留的草稿');dav.files.set('/a.md',Buffer.from('电脑新内容'));const before=dav.requests.length;await configure(page,{onOpen:true});await resumed(page);await page.waitForTimeout(1900);expect(dav.requests.length).toBe(before);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(edit).toContainText('保留的草稿');expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 初始内容');}finally{await dav.close();}
});

test('First automatic startup requests confirmation without touching the server or replacing either copy',async({page})=>{
  const dav=await davServer();try{dav.files.set('/a.md',Buffer.from('# 另一份文件'));await mobileDavFixture(page,dav,{initial:seed});await configure(page,{onOpen:true});const before=dav.requests.length;await restart(page);await expect.poll(async()=>(await summary(page)).needsConfirmation).toBe(true);expect(dav.requests.length).toBe(before);expect(dav.files.get('/a.md')?.toString()).toBe('# 另一份文件');expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 初始内容');}finally{await dav.close();}
});

test('Disabled startup sync stays disabled after restart and foreground events',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false});dav.files.set('/a.md',Buffer.from('# 不自动下载'));const before=dav.requests.length;await restart(page);await resumed(page);await page.waitForTimeout(1700);expect(dav.requests.length).toBe(before);await expect(page.locator('.reading-view')).toContainText('初始内容');}finally{await dav.close();}
});

test('Pausing cancels a scheduled startup; rapid foreground events coalesce into one sync',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);dav.files.set('/a.md',Buffer.from('# 恢复后下载'));const before=dav.requests.length;await restart(page);await paused(page);await page.waitForTimeout(1600);expect(dav.requests.length).toBe(before);for(let n=0;n<8;n++)await resumed(page);await expect(page.locator('.reading-view')).toContainText('恢复后下载');await idle(page);expect(checks(dav,before)).toHaveLength(1);}finally{await dav.close();}
});

test('A save during an active automatic download remains queued and both overwrites await confirmation',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false,afterSave:true});const edit=await source(page);dav.files.set('/remote.md',Buffer.from('# 云端新增'));dav.delay({method:'GET',path:'/remote.md',ms:3000});const before=dav.requests.length;
    await edit.fill('# 第一次保存');await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(()=>dav.requests.slice(before).some((item:any)=>item.method==='GET'&&item.path==='/remote.md')).toBe(true);
    await edit.fill('# 同步期间第二次保存');await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(()=>checks(dav,before).length,{timeout:45000}).toBeGreaterThanOrEqual(2);await idle(page);expect((await summary(page)).pendingUploads).toEqual(['a.md']);expect(dav.files.get('/a.md')?.toString()).toBe('# 初始内容');expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 同步期间第二次保存');
  }finally{await dav.close();}
});

test('A paused in-flight download is cancelled; foreground retry completes without partial local content',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);dav.files.set('/a.md',Buffer.from('# 下载完整内容'));dav.delay({method:'GET',path:'/a.md',ms:6000});const before=dav.requests.length;await restart(page);await expect.poll(()=>dav.requests.slice(before).some((item:any)=>item.method==='GET'&&item.path==='/a.md')).toBe(true);await paused(page);await idle(page);expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 初始内容');dav.delay(null);await resumed(page);await expect(page.locator('.reading-view')).toContainText('下载完整内容',{timeout:45000});}finally{await dav.close();}
});

test('Startup retries transient failures, but authorization errors are shown and not retried',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);await configure(page,{retries:2});dav.files.set('/a.md',Buffer.from('# 重试后下载'));dav.fail({method:'PROPFIND',path:'/',status:503,times:2});let before=dav.requests.length;await restart(page);await expect(page.locator('.reading-view')).toContainText('重试后下载');await idle(page);expect(checks(dav,before)).toHaveLength(3);
    await configure(page,{}, {password:'wrong'});before=dav.requests.length;await restart(page);await expect.poll(async()=>(await summary(page)).error).toBe('用户名或密码错误。');expect(checks(dav,before)).toHaveLength(1);await configure(page,{}, {password:'secret'});await resumed(page);await expect.poll(async()=>(await summary(page)).error,{timeout:45000}).toBe('');
  }catch(error){console.log('Sync retry diagnostics',await summary(page),dav.requests.map((item:any)=>[item.method,item.path,item.headers.depth]));throw error;}finally{await dav.close();}
});

test('Two-sided startup edits preserve both contents and report a conflict',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);dav.files.set('/a.md',Buffer.from('# 云端修改'));await page.evaluate(()=>{const state=(window as any).__mobileState;state.files['a.md'].content='# 本地修改';localStorage.setItem('moyu-android-test',JSON.stringify(state));});const before=dav.requests.length;await restart(page);await expect.poll(async()=>(await summary(page)).conflicts).toEqual(['a.md']);expect(dav.files.get('/a.md')?.toString()).toBe('# 云端修改');await expect(page.locator('.reading-view')).toContainText('本地修改');expect(dav.requests.slice(before).some((item:any)=>['PUT','DELETE'].includes(item.method))).toBe(false);}finally{await dav.close();}
});

test('Remote deletion at startup is reviewed by default; a missing sync directory is never recreated',async({page})=>{
  const dav=await davServer();try{await mobileDavFixture(page,dav,{initial:seed,directory:'/Moyu'});await runMobileSync(page);await configure(page,{onOpen:true,retries:0});dav.files.delete('/Moyu/a.md');await restart(page);await expect.poll(async()=>(await summary(page)).conflicts).toEqual(['a.md']);expect(await page.evaluate(()=>!!(window as any).__mobileState.files['a.md'])).toBe(true);
    dav.directories.delete('/Moyu');const before=dav.requests.length;await resumed(page);await expect.poll(async()=>(await summary(page)).error,{timeout:45000}).toContain('云端同步目录不存在');expect(dav.requests.slice(before).some((item:any)=>['PUT','DELETE','MKCOL'].includes(item.method))).toBe(false);
  }finally{await dav.close();}
});

test('Foreground sync waits for a manual draft and explicit save is reviewed against the changed cloud copy',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);const edit=await source(page);await edit.fill('# 尚未保存的内容');dav.files.set('/a.md',Buffer.from('# 新的云端内容'));const before=dav.requests.length;await resumed(page);await page.waitForTimeout(1800);expect(dav.requests.length).toBe(before);expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 初始内容');await expect(edit).toContainText('尚未保存的内容');await page.getByRole('button',{name:'保存文档',exact:true}).click();expect(dav.files.get('/a.md')?.toString()).toBe('# 新的云端内容');await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toContainText('需处理');expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('# 尚未保存的内容');}finally{await dav.close();}
});

test('Pausing while a startup identity is being computed prevents a late network job',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);await restart(page);await page.evaluate(()=>{
    const digest=crypto.subtle.digest.bind(crypto.subtle);let blocked=false;
    crypto.subtle.digest=(algorithm,data)=>{if(!blocked&&new TextDecoder().decode(data).startsWith('internal\nhttps://dav.example.test/\n')){blocked=true;return new Promise(resolve=>{(window as any).__releaseDigest=()=>resolve(digest(algorithm,data));});}return digest(algorithm,data);};
  });const before=dav.requests.length;await expect.poll(()=>page.evaluate(()=>typeof(window as any).__releaseDigest)).toBe('function');await paused(page);await page.evaluate(()=>(window as any).__releaseDigest());await page.waitForTimeout(1600);expect(dav.requests.length).toBe(before);}finally{await dav.close();}
});

test('A pause received before configuration loads is not lost',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);await page.getByText('同步选项',{exact:true}).click();await page.getByLabel('启动或回到前台时同步',{exact:true}).check();await page.getByLabel('启动或回到前台时同步',{exact:true}).blur();await page.evaluate(()=>{
    const bridge=(window as any).MoyuNative,post=bridge.postMessage.bind(bridge),pending:string[]=[];(window as any).__releaseConfig=()=>{bridge.postMessage=post;for(const text of pending)post(text);};
    bridge.postMessage=(text:string)=>{const request=JSON.parse(text);if(request.method==='feature'&&request.args[0]==='mobile.webdav-config'&&!request.args[1]?.config)pending.push(text);else post(text);};
  });await page.getByRole('button',{name:'返回设置',exact:true}).click();const before=dav.requests.length;await paused(page);await page.evaluate(()=>(window as any).__releaseConfig());await page.waitForTimeout(1600);expect(dav.requests.length).toBe(before);}finally{await dav.close();}
});

test('A background save waits until foreground even with startup sync disabled',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false,afterSave:true});const edit=await source(page);await edit.fill('# 后台保存');const before=dav.requests.length;await paused(page);await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.locator('.mobile-document-title')).toContainText('已保存');await page.waitForTimeout(1600);expect(dav.requests.length).toBe(before);expect(dav.files.get('/a.md')?.toString()).toBe('# 初始内容');await resumed(page);await expect.poll(async()=>(await summary(page)).pendingUploads).toEqual(['a.md']);expect(dav.files.get('/a.md')?.toString()).toBe('# 初始内容');}finally{await dav.close();}
});

test('Disabling startup sync cancels a pending startup timer',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);const before=dav.requests.length;await restart(page);await configure(page,{onOpen:false});await page.waitForTimeout(1800);expect(dav.requests.length).toBe(before);}finally{await dav.close();}
});

test('Changing the cloud directory requires a new first sync and never reuses the previous baseline',async({page})=>{
  const dav=await davServer();try{await synced(page,dav);await configure(page,{}, {directory:'/Other'});const before=dav.requests.length;await restart(page);await expect.poll(async()=>(await summary(page)).needsConfirmation).toBe(true);expect(dav.requests.length).toBe(before);expect(dav.directories.has('/Other')).toBe(false);}finally{await dav.close();}
});

test('Invalid saved addresses produce a readable error without an unhandled startup rejection',async({page})=>{
  const dav=await davServer(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));try{await synced(page,dav);await configure(page,{}, {url:'invalid-address'});const before=dav.requests.length;await restart(page);await expect(page.getByRole('alert')).toContainText('请填写有效的 HTTPS 服务地址');expect(errors).toEqual([]);expect(dav.requests.length).toBe(before);}finally{await dav.close();}
});

test('Interval sync runs in foreground and defers background ticks until foreground returns',async({page})=>{
  const dav=await davServer();try{await synced(page,dav,{onOpen:false,interval:1});await page.clock.install();await restart(page);await page.waitForTimeout(200);dav.files.set('/a.md',Buffer.from('# 定时下载'));await page.clock.fastForward(61000);await page.clock.runFor(1500);await expect(page.locator('.reading-view')).toContainText('定时下载');await idle(page);
    await paused(page);dav.files.set('/a.md',Buffer.from('# 后台定时等待'));const before=dav.requests.length;await page.clock.fastForward(61000);await page.clock.runFor(1500);expect(dav.requests.length).toBe(before);await resumed(page);await page.clock.runFor(1500);await expect(page.locator('.reading-view')).toContainText('后台定时等待');
  }finally{await dav.close();}
});
