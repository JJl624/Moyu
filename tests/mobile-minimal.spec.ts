import {test,expect} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
import {mobileDavFixture} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
const work=path.resolve(import.meta.dirname,'../../../work');

test('Entering edit or source restores position without focusing; only tapping the document starts typing',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();
  const editorFocused=()=>page.evaluate(()=>!!document.activeElement?.closest('.ProseMirror,.cm-content'));
  for(const mode of ['源码','编辑','源码','编辑']){
    await page.getByRole('tab',{name:mode,exact:true}).click();const host=page.locator(mode==='源码'?'.source-editor':'.editor-host');await expect(host).toBeVisible();await expect(host).not.toHaveAttribute('data-editor-pending','true');
    expect(await editorFocused()).toBe(false);
    const text=page.locator(mode==='源码'?'.source-editor .cm-line':'.ProseMirror p').first();await text.tap();await expect.poll(editorFocused).toBe(true);
  }
  await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-line').filter({hasText:'console.log(42)'}).tap();await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');expect(await editorFocused()).toBe(false);
  await page.getByRole('tab',{name:'阅读',exact:true}).click();expect(await editorFocused()).toBe(false);
});

test('Compact phone navigation keeps file actions reachable and opens vault selection from the home title',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await expect(page.locator('.mobile-home-header,.mobile-brand,.mobile-new-button')).toHaveCount(0);await expect(page.getByRole('button',{name:'选择知识库',exact:true})).toContainText('我的知识库');
  for(const width of [360,393]){
    await page.setViewportSize({width,height:740});const row=(await page.locator('.mobile-file-row').first().boundingBox())!;
    expect(row.y).toBeLessThan(190);expect(row.height).toBeLessThanOrEqual(60);expect(row.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.mobile-app').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    const create=(await page.getByRole('button',{name:'新建',exact:true}).boundingBox())!;expect(create.width).toBeGreaterThanOrEqual(44);expect(create.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({path:path.join(work,'android-minimal-home.png')});
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('button',{name:'选择知识库',exact:true})).toContainText('我的知识库');await page.getByRole('button',{name:'选择知识库',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭知识库',exact:true}).click();
  await page.getByRole('button',{name:'笔记',exact:true}).click();await expect(page.getByLabel('搜索笔记')).toBeVisible();await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button')).toHaveCount(2);await page.getByRole('button',{name:'选择知识库',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();
});

test('Explicit service and directory fields show and use the exact encoded destination, including after reopening',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav);await page.getByLabel('WebDAV 地址',{exact:true}).fill('https://dav.example.test/dav/');await page.getByLabel('同步目录',{exact:true}).fill('/手机 笔记/2026');await page.getByLabel('同步目录',{exact:true}).blur();
    await expect(page.getByLabel('最终同步地址',{exact:true})).toHaveText('https://dav.example.test/dav/手机 笔记/2026/');
    await page.screenshot({path:path.join(work,'android-minimal-webdav.png')});await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.getByRole('dialog',{name:'确认同步范围',exact:true}).getByRole('button',{name:'继续同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已上传'})).toBeVisible();
    expect(dav.files.size).toBe(2);expect([...dav.files.keys()].every(name=>name.startsWith('/dav/手机 笔记/2026/'))).toBe(true);
    await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await expect(page.getByLabel('同步目录',{exact:true})).toHaveValue('/手机 笔记/2026');await expect(page.getByLabel('最终同步地址',{exact:true})).toContainText('/dav/手机 笔记/2026/');
    await page.getByLabel('同步目录',{exact:true}).fill('../错误目录');const before=dav.requests.length;await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('alert')).toContainText('同步目录不能包含');expect(dav.requests).toHaveLength(before);
  }finally{await dav.close();}
});

test('Existing complete WebDAV URLs retain their directory and sync identity',async({page})=>{
  await mockAndroid(page);await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.evaluate(()=>{const state=(window as any).__mobileState;state.davConnections={[state.root]:{url:'https://dav.example.test/dav/My%20Notes/',username:'user',password:'secret'}};});
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await expect(page.getByLabel('同步目录',{exact:true})).toHaveValue('/');await expect(page.getByLabel('最终同步地址',{exact:true})).toHaveText('https://dav.example.test/dav/My Notes/');
  const equal=await page.evaluate(async()=>{const {syncKey,syncURL}=await import('/src/mobile/syncState.ts');const a={url:'https://dav.example.test/dav/My%20Notes/',username:'user',password:'secret'},b={...a,url:'https://dav.example.test/dav/',directory:'/My Notes'};return syncURL(a).href===syncURL(b).href&&await syncKey('internal',a)===await syncKey('internal',b);});expect(equal).toBe(true);
});
