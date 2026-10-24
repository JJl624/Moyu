import {test,expect} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const work=path.resolve(import.meta.dirname,'../../../work');
const line='const veryLongIdentifier = "'+ 'abcdefghijklmnop'.repeat(14)+'";';
const markdown='# 手机上的阅读\n\n'+ 'https://example.test/'.repeat(14)+'\n\n- 一级项目\n\n  - 二级项目\n\n    ```js\n    '+line+'\n    ```\n\n    | 名称 | 输入 | 输出 | 说明 |\n    | --- | --- | --- | --- |\n    | 数据 | 原始数组 | 排序结果 | 示例说明 |\n\n> [+] 一级引用\n> 内容\n>\n> > [-] 二级引用\n> > 隐藏的内容\n\n```tabs\n:::js 第一页\nconsole.log("first");\n:::py 第二页\nprint("second")\n```\n';
async function start(page:any){await mockAndroid(page,{files:{'phone.md':{content:markdown}}});await page.goto('/mobile.html');await expect(page.locator('.reading-view h1')).toHaveText('手机上的阅读');}

test('Narrow reading contains wide code and tables, keeps nested content usable and opens folded quotes by touch',async({page})=>{
  await start(page);await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('switch',{name:'代码块自动换行',exact:true}).uncheck();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('[data-path="phone.md"] .mobile-file-open').click();await expect(page.locator('.reading-view')).toBeVisible();
  for(const width of [320,393,720]){
    await page.setViewportSize({width,height:800});
    const document=page.locator('.mobile-document');expect(await document.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const nested=page.locator('.reading-view li li'),code=nested.locator('.code-block-shell'),table=nested.locator('.mobile-table-scroll');expect((await code.boundingBox())!.width).toBeGreaterThan(width*.65);
    const pre=code.locator('pre');expect(await pre.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);await pre.evaluate(element=>{element.scrollLeft=element.scrollWidth;});expect(await pre.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
    if(width===320){expect(await table.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);await table.evaluate(element=>{element.scrollLeft=element.scrollWidth;});expect(await table.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);}
    const copy=(await code.getByRole('button',{name:'复制代码',exact:true}).boundingBox())!;expect(copy.height).toBeGreaterThanOrEqual(40);expect((await pre.boundingBox())!.y-copy.y).toBeLessThanOrEqual(45);
  }
  await page.setViewportSize({width:360,height:800});const inner=page.locator('.reading-view details details');await expect(inner).not.toHaveAttribute('open');await inner.locator('summary').tap();await expect(inner).toHaveAttribute('open','');await expect(inner).toContainText('隐藏的内容');
  await page.locator('.mobile-document').evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:path.join(work,'android-reading-compact.png')});
});

test('Tabbed code has one copy action and copies only the touched page',async({page})=>{
  await start(page);const tabs=page.locator('.reading-view .tabbed-code');await expect(tabs.getByRole('button',{name:'复制代码',exact:true})).toHaveCount(1);await expect(tabs.locator('..').getByRole('button',{name:'复制代码',exact:true})).toHaveCount(1);
  await tabs.getByRole('tab',{name:'第二页',exact:true}).tap();await tabs.getByRole('button',{name:'复制代码',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.clipboard)).toBe('print("second")');
  await tabs.getByRole('button',{name:'显示源码',exact:true}).tap();await tabs.getByRole('button',{name:'复制代码',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.clipboard)).toContain(':::js 第一页');
});
