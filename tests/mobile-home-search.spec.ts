import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const work=path.resolve(import.meta.dirname,'../../../work');
async function home(page:Page){
  await mockAndroid(page,{files:{'根文档.md':{content:'# 根文档\n\n根内容'},'课程/算法/快速排序.md':{content:'# 快速排序\n\n'+Array.from({length:40},(_,index)=>'说明 '+index+'\n').join('\n')+'\n检索目标正文\n'},'其他/索引.md':{content:'# 索引\n\n其他内容'}},folders:['课程','课程/算法','其他']});
  await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();
}

test('Home searches titles and body, jumps to the matching line and preserves the query when returning',async({page})=>{
  await home(page);await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button')).toHaveCount(2);await expect(page.getByRole('button',{name:'搜索',exact:true})).toHaveCount(0);
  const input=page.getByLabel('搜索笔记');await input.fill('快速排序');await expect(page.locator('.mobile-search-results article')).toHaveCount(1);await expect(page.locator('.mobile-search-results')).toContainText('课程/算法');
  await input.fill('检索目标正文');await expect(page.locator('.mobile-search-match')).toHaveText(/检索目标正文/);await page.screenshot({path:path.join(work,'android-home-search.png')});
  await input.press('Enter');expect(await input.evaluate(element=>element===document.activeElement)).toBe(false);await page.locator('.mobile-search-match').click();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  await expect.poll(()=>page.locator('.mobile-document').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);await expect(page.locator('.reading-view p').filter({hasText:'检索目标正文'})).toBeInViewport();
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await expect(input).toHaveValue('检索目标正文');expect(await input.evaluate(element=>element===document.activeElement)).toBe(false);await expect(page.locator('.mobile-search-match')).toHaveText(/检索目标正文/);
  await page.getByRole('button',{name:'清空搜索',exact:true}).click();await expect(page.getByRole('tree',{name:'文档目录'})).toBeVisible();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeVisible();
});

test('Clearing search and Android back restore expanded folders and the creation destination',async({page})=>{
  await home(page);const row=(name:string)=>page.locator('[data-path="'+name+'"]');await row('课程').locator('.mobile-file-open').click();await row('课程/算法').locator('.mobile-file-open').click();
  await page.getByLabel('搜索笔记').fill('不存在的内容');await expect(page.getByText('没有找到相关笔记',{exact:true})).toBeVisible();await expect(page.getByRole('tree',{name:'文档目录'})).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new Event('moyu-mobile-back')));await expect(page.getByLabel('搜索笔记')).toHaveValue('');await expect(row('课程')).toHaveAttribute('aria-expanded','true');await expect(row('课程/算法')).toHaveAttribute('aria-selected','true');await expect(row('课程/算法/快速排序.md')).toBeVisible();
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('新笔记');await page.getByRole('button',{name:'确定',exact:true}).click();expect(await page.evaluate(()=>!!(window as any).__mobileState.files['课程/算法/新笔记.md'])).toBe(true);
});

test('A slow previous search never replaces a later query or resurrects cleared results',async({page})=>{
  await home(page);await page.evaluate(()=>{
    const bridge=(window as any).MoyuNative,post=bridge.postMessage.bind(bridge),receive=bridge.onmessage;
    bridge.postMessage=(text:string)=>{const value=JSON.parse(text);if(value.method==='search'&&value.args[0]==='根内容'){(window as any).__oldId=value.id;(window as any).__releaseSearch=()=>post(text);}else post(text);};
    bridge.onmessage=(event:MessageEvent<string>)=>{if(JSON.parse(event.data).id===(window as any).__oldId)(window as any).__oldReceived=true;receive(event);};
  });
  await page.getByLabel('搜索笔记').fill('根内容');await expect.poll(()=>page.evaluate(()=>!!(window as any).__releaseSearch)).toBe(true);await page.getByLabel('搜索笔记').fill('其他内容');await expect(page.locator('.mobile-search-results article')).toHaveCount(1);await expect(page.locator('.mobile-search-results')).toContainText('索引');
  await page.evaluate(()=>(window as any).__releaseSearch());await expect.poll(()=>page.evaluate(()=>(window as any).__oldReceived)).toBe(true);await expect(page.locator('.mobile-search-results')).toContainText('索引');await expect(page.locator('.mobile-search-results')).not.toContainText('根文档');
  await page.getByRole('button',{name:'清空搜索',exact:true}).click();await expect(page.locator('.mobile-search-results')).toHaveCount(0);await expect(page.getByRole('tree',{name:'文档目录'})).toBeVisible();
});
