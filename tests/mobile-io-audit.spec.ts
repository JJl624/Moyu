import {test,expect} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';
test('Mobile recovery coalesces typing, flushes before save and never recreates discarded drafts',async({page})=>{
  await mockAndroid(page,{files:{'note.md':{content:'original'}}});await page.goto('/mobile.html');await expect(page.locator('.mobile-mode-bar')).toBeVisible({timeout:30000});
  const result=await page.evaluate(async()=>{
    const {mobileFeature,flushMobileDrafts,nativeCall}=await import('/src/mobile/native.ts');const state=(window as any).__mobileState,calls=(window as any).__mobileCalls;
    const doc=await nativeCall<any>('read','note.md'),pending=[];
    for(let i=0;i<100;i++)pending.push(mobileFeature('mobile.draft',{root:state.root,path:'note.md',version:doc.version,content:'draft '+i}));
    const before=calls['mobile.draft']||0;await flushMobileDrafts();await Promise.all(pending);const after=calls['mobile.draft']||0,latest=state.drafts['note.md'].content;
    const queued=mobileFeature('mobile.draft',{root:state.root,path:'note.md',version:doc.version,content:'discard me'});await mobileFeature('mobile.draft-clear',{path:'note.md'});await queued;await flushMobileDrafts();const discarded=!state.drafts['note.md'];
    const newer=mobileFeature('mobile.draft',{root:state.root,path:'note.md',version:doc.version,content:'save me'});await nativeCall('save','note.md','save me',doc.version,state.root);await newer;await flushMobileDrafts();
    return{before,after,latest,discarded,saved:state.files['note.md'].content,draft:state.drafts['note.md']};
  });
  expect(result).toEqual({before:0,after:1,latest:'draft 99',discarded:true,saved:'save me',draft:undefined});
});
test('Overlapping workspace refreshes share one native directory traversal',async({page})=>{
  await mockAndroid(page,{files:{'note.md':{content:'original'}}});await page.goto('/mobile.html');await expect(page.locator('.mobile-mode-bar')).toBeVisible({timeout:30000});
  const calls=await page.evaluate(async()=>{const {refreshAndroidWorkspace}=await import('/src/mobile/native.ts'),state=(window as any).__mobileCalls;const before=state.list||0;await Promise.all(Array.from({length:10},()=>refreshAndroidWorkspace()));return(state.list||0)-before;});expect(calls).toBe(1);
});
test('A refresh after a write does not reuse or publish an older in-flight snapshot',async({page})=>{
  await mockAndroid(page,{files:{'note.md':{content:'original'}}});await page.goto('/mobile.html');await expect(page.locator('.mobile-mode-bar')).toBeVisible({timeout:30000});
  const result=await page.evaluate(async()=>{
    const {refreshAndroidWorkspace,nativeCall}=await import('/src/mobile/native.ts'),bridge=window.MoyuNative!,originalPost=bridge.postMessage.bind(bridge),originalReply=bridge.onmessage!;let heldId='',held:MessageEvent<string>|undefined;
    const count=()=>(window as any).__mobileCalls.list||0,before=count();
    bridge.postMessage=message=>{const value=JSON.parse(message);if(value.method==='list'&&!heldId)heldId=value.id;originalPost(message);};
    bridge.onmessage=event=>{if(JSON.parse(event.data).id===heldId)held=event;else originalReply(event);};
    try{
      const older=refreshAndroidWorkspace();for(let i=0;i<8&&!held;i++)await new Promise(resolve=>setTimeout(resolve,0));
      await nativeCall('create','new.md','file','new');const newer=refreshAndroidWorkspace();for(let i=0;i<8;i++)await Promise.resolve();const reads=count()-before;
      if(held)originalReply(held);await Promise.all([older,newer]);return reads;
    }finally{bridge.postMessage=originalPost;bridge.onmessage=originalReply;}
  });expect(result).toBe(2);
});
