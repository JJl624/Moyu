import {test,expect} from '@playwright/test';
import {mobileDavFixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';

for(const etagStyle of ['quoted','bare','mixed'])test(`${etagStyle}: unchanged sync lists once; successful uploads never download the uploaded body`,async({page})=>{
  const dav=await davServer({etagStyle,numericETag:true});try{
    await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'base'}}}});let result=await runMobileSync(page);expect(result.uploaded).toBe(1);expect(dav.requests.filter((request:any)=>request.method==='GET')).toHaveLength(0);
    const bodyReads=await page.evaluate(()=>(window as any).__mobileCalls['mobile.read-bytes']||0);
    let offset=dav.requests.length;await runMobileSync(page);expect(dav.requests.slice(offset).map((request:any)=>[request.method,request.headers.depth])).toEqual([['PROPFIND','1']]);expect(await page.evaluate(()=>(window as any).__mobileCalls['mobile.read-bytes']||0)).toBe(bodyReads);
    await page.evaluate(()=>{const state=(window as any).__mobileState;state.files['a.md'].content='local updated';});offset=dav.requests.length;await runMobileSync(page);const requests=dav.requests.slice(offset);expect(requests.filter((request:any)=>request.method==='PUT')).toHaveLength(1);expect(requests.filter((request:any)=>request.method==='GET')).toHaveLength(0);expect(dav.files.get('/a.md')?.toString()).toBe('local updated');
    dav.files.set('/a.md',Buffer.from('remote updated'));result=await runMobileSync(page);expect(result.downloaded).toBe(1);expect(await page.evaluate(()=>(window as any).__mobileState.files['a.md'].content)).toBe('remote updated');
  }finally{await dav.close();}
});

test('Resolving one mobile conflict checks its ETag without downloading other conflicts or re-listing the tree',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'base'},'b.md':{content:'base'},'nested/c.md':{content:'unrelated'}},folders:['nested']}});await runMobileSync(page);await page.evaluate(()=>{const state=(window as any).__mobileState;for(const path of ['a.md','b.md'])state.files[path].content='local '+path;});for(const path of ['a.md','b.md'])dav.files.set('/'+path,Buffer.from('remote '+path));const conflicts=(await runMobileSync(page)).conflicts;expect(conflicts).toHaveLength(2);
    const offset=dav.requests.length;await page.evaluate(async conflict=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const state=(window as any).__mobileState;await new MobileSyncJob(state.davConnections[state.root],state.root,()=>{},()=>true).resolve(conflict,'local');},conflicts[0]);const requests=dav.requests.slice(offset);expect(requests.map((request:any)=>request.method)).toEqual(['HEAD','PUT']);expect(requests.every((request:any)=>request.path==='/a.md')).toBe(true);
    expect(dav.files.get('/a.md')?.toString()).toBe('local a.md');expect(dav.files.get('/b.md')?.toString()).toBe('remote b.md');
    const offset2=dav.requests.length;await page.evaluate(async conflict=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const state=(window as any).__mobileState;await new MobileSyncJob(state.davConnections[state.root],state.root,()=>{}).resolve(conflict,'remote');},conflicts[1]);expect(dav.requests.slice(offset2).map((request:any)=>request.method)).toEqual(['HEAD']);expect(await page.evaluate(()=>(window as any).__mobileState.files['b.md'].content)).toBe('remote b.md');
  }finally{await dav.close();}
});

for(const status of [429,503])test(`HTTP ${status} Retry-After blocks repeated manual operations and does not retry PUT blindly`,async({page})=>{
  const dav=await davServer();try{await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'base'}}}});dav.fail({method:'PUT',path:'/a.md',status,headers:{'Retry-After':'120'},times:20});const attempt=()=>page.evaluate(async()=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const state=(window as any).__mobileState;try{await new MobileSyncJob(state.davConnections[state.root],state.root,()=>{},()=>true).run();return'';}catch(error){return(error as Error).message;}});expect(await attempt()).toContain('后重试');const count=dav.requests.length;expect(dav.requests.filter((request:any)=>request.method==='PUT')).toHaveLength(1);expect(dav.requests.some((request:any)=>['GET','HEAD'].includes(request.method))).toBe(false);expect(await attempt()).toContain('后重试');expect(dav.requests.length).toBe(count);
  }finally{await dav.close();}
});

test('Automatic resume and save events coalesce, including a manual sync followed by returning from settings',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav,{initial:{files:{'a.md':{content:'base'}}}});await runMobileSync(page);await page.evaluate(async()=>{const {mobileFeature}=await import('/src/mobile/native.ts');const state=(window as any).__mobileState,config={...state.davConnections[state.root],sync:{onOpen:true,afterSave:true}};await mobileFeature('mobile.webdav-config',{root:state.root,config});window.dispatchEvent(new Event('moyu-mobile-sync-config'));});await page.reload();await expect(page.locator('.reading-view')).toBeVisible();await expect.poll(()=>dav.requests.filter((request:any)=>request.method==='PROPFIND').length).toBeGreaterThan(1);await expect.poll(()=>page.evaluate(async()=>!(await import('/src/mobile/syncState.ts')).currentSyncOperation())).toBe(true);await page.clock.install();const offset=dav.requests.length;
    for(let i=0;i<10;i++)await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-resume')));await page.clock.runFor(5000);expect(dav.requests.length).toBe(offset);await page.clock.fastForward(30000);await page.clock.runFor(500);await expect.poll(()=>dav.requests.length).toBe(offset+1);
  }finally{await dav.close();}
});
