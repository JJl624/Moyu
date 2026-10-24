import {test,expect} from '@playwright/test';
import {mockAndroid} from './helpers/mobile-native-mock';
import {mobileDavFixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';

test('Nested folders retain their hierarchy, collapse reliably and place new files in the selected folder',async({page})=>{
  await mockAndroid(page,{files:{'课程/算法/排序/快速排序.md':{content:'# 快速排序'},'课程/说明.md':{content:'# 说明'},'根文档.md':{content:'# 根文档'}},folders:['课程','课程/算法','课程/算法/排序']});await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  const row=(path:string)=>page.locator('.mobile-file-tree [data-path="'+path+'"]');
  await row('课程').locator('.mobile-file-open').click();await row('课程/算法').locator('.mobile-file-open').click();await row('课程/算法/排序').locator('.mobile-file-open').click();
  await expect(row('课程/算法/排序/快速排序.md')).toHaveAttribute('aria-level','4');await expect(row('根文档.md')).toBeVisible();await expect(row('课程/算法/排序')).toHaveAttribute('aria-selected','true');await expect(page.getByRole('navigation',{name:'文件位置'})).toHaveCount(0);
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('归并排序');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>!!(window as any).__mobileState.files['课程/算法/排序/归并排序.md'])).toBe(true);
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await row('课程').locator('.mobile-file-open').click();await expect(row('课程')).toHaveAttribute('aria-expanded','false');await expect(row('课程/算法')).toHaveCount(0);
  await page.setViewportSize({width:360,height:740});expect(await page.locator('.mobile-file-tree').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});

test('File and folder cloud states reflect saved changes, remote updates, conflicts and restart',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav);await runMobileSync(page);await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'笔记',exact:true}).click();
    const row=(path:string)=>page.locator('.mobile-file-tree [data-path="'+path+'"]');
    await expect(row('开始使用.md').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','synced');await expect(row('读书笔记').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','synced');
    await page.evaluate(()=>{(window as any).__mobileState.files['开始使用.md'].content='# 本地修改';window.dispatchEvent(new Event('moyu-mobile-resume'));});await expect(row('开始使用.md').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','pending');
    dav.files.set('/读书笔记/第一章.md',Buffer.from('# 另一端更新'));await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();await page.getByRole('button',{name:'查看云端目录',exact:false}).click();await page.getByRole('button',{name:'返回同步设置',exact:true}).click();await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'笔记',exact:true}).click();
    await expect(row('读书笔记').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','remote');await row('读书笔记').locator('.mobile-file-open').click();await expect(row('读书笔记/第一章.md').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','remote');
    dav.files.set('/开始使用.md',Buffer.from('# 云端冲突'));await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toContainText('1 项需处理');await expect(row('开始使用.md').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','conflict');await expect(page.getByRole('button',{name:'立即同步',exact:true})).toContainText('1 项需处理');
    await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect(row('开始使用.md').locator('[data-sync-state]')).toHaveAttribute('data-sync-state','conflict');
  }finally{await dav.close();}
});

test('Foreground automatic sync requests first-run confirmation and uploads after a deliberate save',async({page})=>{
  const dav=await davServer();try{
    await mobileDavFixture(page,dav);await page.getByText('同步选项',{exact:true}).click();await page.getByLabel('启动或回到前台时同步',{exact:true}).check();await page.getByLabel('保存后同步',{exact:true}).check();await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-resume')));
    await expect(page.getByRole('button',{name:'立即同步',exact:true})).toContainText('首次同步待确认');expect(dav.files.size).toBe(0);
    await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已上传'})).toBeVisible();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
    await page.locator('[data-path="开始使用.md"] .mobile-file-open').click();await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('# 自动同步后的内容');await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const state=(window as any).__mobileState,{readSummary,syncKey}=await import('/src/mobile/syncState.ts');return readSummary(await syncKey(state.root,state.davConnections[state.root])).pendingUploads;}),{timeout:45000}).toEqual(['开始使用.md']);expect(dav.files.get('/开始使用.md')?.toString()).not.toBe('# 自动同步后的内容');
    const before=dav.requests.length;await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-pause')));await expect(page.locator('.mobile-document-title')).toContainText('已保存');expect(dav.requests.slice(before).filter((request:any)=>request.method==='PUT')).toHaveLength(0);
  }finally{await dav.close();}
});
