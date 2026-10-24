import {expect,type Page} from '@playwright/test';
import {mockAndroid} from './mobile-native-mock';
export async function attachMobileDav(page:Page,dav:any){
  const requests=new Map<string,AbortController>();
  await page.exposeFunction('__mobileDav',async(input:any)=>{
    const controller=new AbortController();requests.set(input.id,controller);
    try{
      const response=await fetch(dav.url+new URL(input.url).pathname,{method:input.method,headers:{Authorization:'Basic '+Buffer.from(input.username+':'+input.password).toString('base64'),...input.headers},body:input.body===undefined?undefined:input.binary?Buffer.from(input.body,'base64'):input.body,signal:controller.signal});
      const bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,etag:response.headers.get('etag')||'',modified:response.headers.get('last-modified')||'',retryAfter:response.headers.get('retry-after')||'',body:bytes.toString(input.responseBinary?'base64':'utf8')};
    }finally{requests.delete(input.id);}
  });
  await page.exposeFunction('__mobileDavCancel',({job}:any)=>{for(const [id,controller]of requests)if(id.startsWith(job+'-'))controller.abort();return true;});
}
export async function mobileDavFixture(page:Page,dav:any,options:{directory?:string;initial?:Parameters<typeof mockAndroid>[1]}={}){
  await attachMobileDav(page,dav);await mockAndroid(page,options.initial);await page.goto('/mobile.html');
  await expect(page.locator('.mobile-file-list,.mobile-mode-bar,.mobile-empty h2').first()).toBeVisible({timeout:30000});
  if(await page.getByRole('button',{name:'返回笔记',exact:true}).count())await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();
  await page.getByLabel('WebDAV 地址',{exact:true}).fill('https://dav.example.test/');await page.getByLabel('同步目录',{exact:true}).fill(options.directory||'/');await page.getByLabel('WebDAV 用户名',{exact:true}).fill('user');await page.getByLabel('WebDAV 密码',{exact:true}).fill('secret');
  // This fixture's isolated root is an explicitly selected test destination.
  await page.getByLabel('WebDAV 密码',{exact:true}).blur();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.davConnections?.[(window as any).__mobileState.root]?.password)).toBe('secret');
  await page.evaluate(async()=>{const state=(window as any).__mobileState,{settingsStore}=await import('/src/settingsStore.ts'),{syncKey,syncRootKey}=await import('/src/mobile/syncState.ts');const key=await syncKey(state.root,state.davConnections[state.root]);settingsStore.setItem(key+'-directory-reviewed','1');settingsStore.setItem(await syncRootKey(state.root),key);await settingsStore.flush();});
}
export async function runMobileSync(page:Page){
  return page.evaluate(async()=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const {refreshAndroidWorkspace}=await import('/src/mobile/native.ts');const state=(window as any).__mobileState;const config=state.davConnections[state.root];const result=await new MobileSyncJob(config,state.root,()=>{},()=>true,()=>true).run();await refreshAndroidWorkspace();return result;});
}
