import {test,expect} from '@playwright/test';
import {mobileDavFixture as fixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
test('Mobile WebDAV uploads, downloads, compares two-sided edits, resolves differences and refreshes the vault',async({page})=>{
  const dav=await davServer();dav.files.set('/云端.md',Buffer.from('# 云端文档'));
  try{
    await fixture(page,dav);await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByText('连接成功',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已上传'})).toBeVisible();
    expect(dav.files.get('/开始使用.md')?.toString()).toContain('开始使用');expect(await page.evaluate(()=>(window as any).__mobileState.files['云端.md'].content)).toBe('# 云端文档');
    const writes=dav.requests.filter((request:any)=>request.method==='PUT').length;
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByText('文件没有变化',{exact:true})).toBeVisible();expect(dav.requests.filter((request:any)=>request.method==='PUT')).toHaveLength(writes);
    await page.evaluate(()=>{(window as any).__mobileState.files['开始使用.md'].content='# 手机修改';});dav.files.set('/开始使用.md',Buffer.from('# 另一端修改'));
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'处理 1 项冲突',exact:true})).toBeVisible();expect(dav.files.get('/开始使用.md')?.toString()).toBe('# 另一端修改');
    await page.getByRole('button',{name:'处理 1 项冲突',exact:true}).click();await expect(page.locator('.history-diff-editors')).toContainText('手机修改');await expect(page.locator('.history-diff-editors')).toContainText('另一端修改');
    await page.getByRole('button',{name:'使用云端',exact:true}).click();await expect(page.getByText('两端都有修改',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__mobileState.files['开始使用.md'].content)).toBe('# 另一端修改');
    await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'查看云端目录',exact:false}).click();await expect(page.locator('.mobile-cloud-list')).toContainText('云端.md');await expect(page.locator('.mobile-cloud-list [data-path="云端.md"] small')).toContainText(/\d+ (B|KB)/);
  }finally{await dav.close();}
});

test('Deletion review rejects a reappeared cloud file and excluded files never become deletions',async({page})=>{
  const dav=await davServer();
  try{
    await fixture(page,dav,{initial:{files:{'main.md':{content:'base'},'ignored.md':{content:'excluded'},'main.assets/code-data/0001/input.txt':{content:'input'}}}});
    await runMobileSync(page);dav.files.delete('/main.md');
    const result=await runMobileSync(page);expect(result.conflicts.map(item=>item.path)).toEqual(['main.md']);
    dav.files.set('/main.md',Buffer.from('reappeared'));
    await expect(page.evaluate(async conflict=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const state=(window as any).__mobileState;await new MobileSyncJob(state.davConnections[state.root],state.root,()=>{}).resolve(conflict,'remote');},result.conflicts[0])).rejects.toThrow('云端文件已改变');
    expect(await page.evaluate(()=>(window as any).__mobileState.files['main.md'].content)).toBe('base');
    dav.files.set('/main.md',Buffer.from('base'));
    await page.evaluate(()=>{const state=(window as any).__mobileState;state.davConnections[state.root].sync={includeCodeData:false,excludes:'ignored.md',deletion:'sync'};delete state.files['ignored.md'];delete state.files['main.assets/code-data/0001/input.txt'];});
    const skipped=await runMobileSync(page);expect(skipped.conflicts).toHaveLength(0);expect(skipped.skipped.map(item=>item.path)).toEqual(['ignored.md','main.assets/code-data/0001/input.txt']);
    expect(dav.files.has('/ignored.md')).toBe(true);expect(dav.files.has('/main.assets/code-data/0001/input.txt')).toBe(true);
    dav.files.delete('/main.md');await page.evaluate(()=>{const state=(window as any).__mobileState;state.davConnections[state.root].sync.deletion='keep';});
    expect((await runMobileSync(page)).conflicts).toHaveLength(0);expect(await page.evaluate(()=>(window as any).__mobileState.files['main.md'].content)).toBe('base');
    await page.evaluate(()=>{const state=(window as any).__mobileState;state.davConnections[state.root].sync.deletion='sync';});await runMobileSync(page);expect(await page.evaluate(()=>(window as any).__mobileState.files['main.md'])).toBeUndefined();
  }finally{await dav.close();}
});
test('Android back cancels an active sync without hiding the operation or changing files',async({page})=>{
  const dav=await davServer();dav.delay({method:'PROPFIND',path:'/',ms:10000});
  try{
    await fixture(page,dav);await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'中断同步',exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));
    await expect(page.getByRole('alert')).toContainText('已取消同步');await expect(page.getByRole('heading',{name:'WebDAV 同步',exact:true})).toBeVisible();expect(dav.files.size).toBe(0);
    await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'文件与同步',exact:true})).toBeVisible();
  }finally{await dav.close();}
});
