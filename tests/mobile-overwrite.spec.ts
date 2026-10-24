import {test,expect,type Page} from '@playwright/test';
import {mobileDavFixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
const initial={files:{'a.md':{content:'原文 A'},'b.md':{content:'原文 B'}}};
async function start(page:Page,dav:any){await mobileDavFixture(page,dav,{initial});await runMobileSync(page);}
async function edit(page:Page){await page.evaluate(()=>{const state=(window as any).__mobileState;state.files['a.md'].content='手机 A';state.files['b.md'].content='手机 B';localStorage.setItem('moyu-android-test',JSON.stringify(state));});}
async function pending(page:Page){return page.evaluate(async()=>{const state=(window as any).__mobileState,{readSummary,syncKey}=await import('/src/mobile/syncState.ts');return readSummary(await syncKey(state.root,state.davConnections[state.root])).pendingUploads;});}
const dialog=(page:Page)=>page.getByRole('dialog',{name:'确认覆盖云端',exact:true});

test('Manual sync asks once for the complete overwrite list; cancel preserves both sides and approval applies only that run',async({page})=>{
  const dav=await davServer();try{await start(page,dav);await edit(page);const bar=await page.evaluate(()=>(window as any).__mobileState.systemBars.background);const before=dav.requests.length;await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(dialog(page)).toContainText('2 个云端文件');await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.systemBars.background)).not.toBe(bar);await expect(dialog(page).locator('li')).toHaveText(['a.md','b.md']);expect(dav.requests.slice(before).some((request:any)=>request.method==='PUT')).toBe(false);
    await dialog(page).getByRole('button',{name:'取消上传',exact:true}).click();await expect(dialog(page)).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.systemBars.background)).toBe(bar);await expect.poll(()=>pending(page)).toEqual(['a.md','b.md']);expect(dav.files.get('/a.md')?.toString()).toBe('原文 A');expect(dav.files.get('/b.md')?.toString()).toBe('原文 B');
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await dialog(page).getByRole('button',{name:'覆盖云端',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已上传 2 个'})).toBeVisible();expect(dav.files.get('/a.md')?.toString()).toBe('手机 A');expect(dav.files.get('/b.md')?.toString()).toBe('手机 B');expect(await pending(page)).toEqual([]);
    await edit(page);await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content='又一次修改');await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(dialog(page).locator('li')).toHaveText(['a.md']);await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(dialog(page)).toHaveCount(0);expect(dav.files.get('/a.md')?.toString()).toBe('手机 A');
  }finally{await dav.close();}
});

test('Startup still downloads new cloud files, defers overwrites without a modal, and Home offers explicit approval',async({page})=>{
  const dav=await davServer();try{await start(page,dav);await edit(page);dav.files.set('/cloud.md',Buffer.from('云端新增'));await page.evaluate(()=>{const state=(window as any).__mobileState;state.davConnections[state.root].sync={onOpen:true,retries:0};localStorage.setItem('moyu-android-test',JSON.stringify(state));});const before=dav.requests.length;await page.reload();await expect.poll(()=>pending(page)).toEqual(['a.md','b.md']);await expect(dialog(page)).toHaveCount(0);expect(dav.files.get('/a.md')?.toString()).toBe('原文 A');expect(dav.requests.slice(before).some((request:any)=>request.method==='PUT')).toBe(false);expect(await page.evaluate(()=>(window as any).__mobileState.files['cloud.md'].content)).toBe('云端新增');
    await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toContainText('2 个文件待确认上传');await page.getByRole('button',{name:'立即同步',exact:true}).click();await dialog(page).getByRole('button',{name:'覆盖云端',exact:true}).click();await expect.poll(()=>dav.files.get('/a.md')?.toString()).toBe('手机 A');await expect.poll(()=>pending(page)).toEqual([]);
  }finally{await dav.close();}
});

for(const side of ['local','remote'])test(`A ${side} change while the confirmation is open prevents a stale overwrite`,async({page})=>{
  const dav=await davServer();try{await start(page,dav);await edit(page);await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(dialog(page)).toBeVisible();if(side==='local')await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content='确认时的新修改');else dav.files.set('/a.md',Buffer.from('确认时的云端修改'));
    await dialog(page).getByRole('button',{name:'覆盖云端',exact:true}).click();await expect(page.getByRole('alert')).toContainText(side==='local'?'本地文件已改变':'云端文件已改变');expect(dav.files.get('/a.md')?.toString()).toBe(side==='local'?'原文 A':'确认时的云端修改');expect(dav.files.get('/b.md')?.toString()).toBe('原文 B');
  }finally{await dav.close();}
});

test('Leaving the foreground dismisses confirmation and cannot upload later',async({page})=>{
  const dav=await davServer();try{await start(page,dav);await edit(page);await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(dialog(page)).toBeVisible();const before=dav.requests.length;await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-pause')));await expect(dialog(page)).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('已取消同步');expect(dav.requests.slice(before).some((request:any)=>request.method==='PUT')).toBe(false);expect(dav.files.get('/a.md')?.toString()).toBe('原文 A');
  }finally{await dav.close();}
});

test('Resolving a conflict with local content or both copies also requires confirmation; cancel leaves the conflict open',async({page})=>{
  const dav=await davServer();try{await start(page,dav);await edit(page);dav.files.set('/a.md',Buffer.from('电脑 A'));await page.getByRole('button',{name:'立即同步',exact:true}).click();await dialog(page).getByRole('button',{name:'取消上传',exact:true}).click();await page.getByRole('button',{name:'处理 1 项冲突',exact:true}).click();await page.getByRole('button',{name:'保留本地',exact:true}).click();await expect(dialog(page).locator('li')).toHaveText(['a.md']);await dialog(page).getByRole('button',{name:'取消上传',exact:true}).click();await expect(page.getByRole('button',{name:'保留两份',exact:true})).toBeVisible();expect(dav.files.get('/a.md')?.toString()).toBe('电脑 A');
    await page.getByRole('button',{name:'保留两份',exact:true}).click();await dialog(page).getByRole('button',{name:'覆盖云端',exact:true}).click();await expect.poll(()=>dav.files.get('/a.md')?.toString()).toBe('手机 A');expect(dav.files.get('/a-远端-1.md')?.toString()).toBe('电脑 A');
  }finally{await dav.close();}
});

test('The service root requires a separate scope confirmation before any directory is downloaded',async({page})=>{
  const dav=await davServer();try{dav.directories.add('/NewNotes');dav.files.set('/NewNotes/private.md',Buffer.from('其他应用的数据'));await start(page,dav);await page.evaluate(async()=>{const state=(window as any).__mobileState,{settingsStore}=await import('/src/settingsStore.ts'),{syncKey}=await import('/src/mobile/syncState.ts');settingsStore.setItem((await syncKey(state.root,state.davConnections[state.root]))+'-directory-reviewed','0');await settingsStore.flush();});const before=dav.requests.length;
    await page.getByRole('button',{name:'立即同步',exact:true}).click();const scope=page.getByRole('dialog',{name:'确认同步范围',exact:true});await expect(scope).toContainText('全部文件和子目录');expect(dav.requests.length).toBe(before);await scope.getByRole('button',{name:'取消同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'同步目录待确认'})).toBeVisible();expect(dav.requests.length).toBe(before);
    const result=await page.evaluate(async()=>{const state=(window as any).__mobileState,{MobileSyncJob}=await import('/src/mobile/sync.ts');return new MobileSyncJob(state.davConnections[state.root],state.root,()=>{}).run();});expect(result.needsDirectoryConfirmation).toBe(true);expect(dav.requests.length).toBe(before);
  }finally{await dav.close();}
});

test('Changing directories asks before any transfer, then allows normal sync without extra upload restrictions',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav,{directory:'/Moyu',initial});await runMobileSync(page);dav.directories.add('/NewNotes');dav.files.set('/NewNotes/private.md',Buffer.from('其他应用的原始数据'));
    const scope=page.getByRole('dialog',{name:'确认同步范围',exact:true});
    await page.getByLabel('同步目录',{exact:true}).fill('/');await page.getByLabel('同步目录',{exact:true}).blur();const first=dav.requests.length;await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(scope).toContainText('全部文件和子目录');expect(dav.requests.length).toBe(first);await scope.getByRole('button',{name:'取消同步',exact:true}).click();expect(dav.requests.length).toBe(first);
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await scope.getByRole('button',{name:'继续同步',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!(window as any).__mobileState.files['NewNotes/private.md'])).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(0);expect(dav.files.get('/NewNotes/private.md')?.toString()).toBe('其他应用的原始数据');
    await page.getByLabel('同步目录',{exact:true}).fill('/Moyu');await page.getByLabel('同步目录',{exact:true}).blur();const before=dav.requests.length;
    const result=await page.evaluate(async()=>{const state=(window as any).__mobileState,{MobileSyncJob}=await import('/src/mobile/sync.ts');return new MobileSyncJob(state.davConnections[state.root],state.root,()=>{}).run();});expect(result.needsDirectoryConfirmation).toBe(true);expect(dav.requests.length).toBe(before);expect(dav.files.has('/Moyu/NewNotes/private.md')).toBe(false);
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(scope).toContainText('同步目录已更改');await expect(scope).toContainText('https://dav.example.test/Moyu/');await scope.getByRole('button',{name:'取消同步',exact:true}).click();expect(dav.requests.length).toBe(before);
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await scope.getByRole('button',{name:'继续同步',exact:true}).click();await expect.poll(()=>dav.files.get('/Moyu/NewNotes/private.md')?.toString()).toBe('其他应用的原始数据');await expect(page.getByRole('dialog')).toHaveCount(0);expect(dav.files.get('/NewNotes/private.md')?.toString()).toBe('其他应用的原始数据');
    await page.getByLabel('同步目录',{exact:true}).fill('/');await page.getByLabel('同步目录',{exact:true}).blur();const requests=dav.requests.length;await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(scope).toBeVisible();expect(dav.requests.length).toBe(requests);await scope.getByRole('button',{name:'取消同步',exact:true}).click();
  }finally{await dav.close();}
});
