import {test,expect,type Page,type Locator} from '@playwright/test';
import path from 'node:path';
import {mockAndroid} from './helpers/mobile-native-mock';
const work=path.resolve(import.meta.dirname,'../../../work');
const bar=(page:Page)=>page.getByRole('toolbar',{name:'文本格式'});
const action=(page:Page,name:string)=>bar(page).getByRole('button',{name,exact:true});
const depth=(locator:Locator)=>locator.evaluate(element=>{let count=0;for(let node=element.parentElement;node;node=node.parentElement)if(node.classList.contains('list-item'))count++;return count;});
async function start(page:Page,content:string,order?:string[]){
  await mockAndroid(page,{files:{'note.md':{content}}});
  await page.addInitScript(order=>{const state=(window as any).__mobileState;state.settings['moyu-save-policy']='manual';if(order)state.settings['moyu-mobile-shortcut-order']=JSON.stringify(order);},order);
  await page.goto('/mobile.html');await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible({timeout:30000});await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
}
test('Code blocks use live context, move one list level at a time and leave a typing paragraph in the same item',async({page})=>{
  await start(page,'1. 一级\n\n   1. 二级\n\n      ```js {id=0001}\n      console.log(42);\n      ```\n\n      后续文字\n\n2. 尾项\n');
  const code=page.locator('.milkdown-code-block');await code.locator('.cm-content').tap();await expect(action(page,'脱离列表')).toBeVisible();await expect(action(page,'加粗')).toBeDisabled();expect(await depth(code)).toBe(2);
  await expect(action(page,'复制代码')).toHaveCount(0);await expect(action(page,'在前面插入段落')).toHaveCount(0);
  await action(page,'脱离列表').tap();expect(await depth(code)).toBe(1);await expect(action(page,'缩进至列表')).toBeVisible();await action(page,'缩进至列表').tap();expect(await depth(code)).toBe(2);
  await action(page,'块后换行').tap();await page.keyboard.insertText('块后的新段落');const paragraph=page.locator('.ProseMirror p').filter({hasText:'块后的新段落'});await expect(paragraph).toBeVisible();expect(await depth(paragraph)).toBe(2);await expect(page.locator('.ProseMirror')).toContainText('尾项');
});
test('Tables inside a list expose row, column, copy and list controls without moving the target cell',async({page})=>{
  await start(page,'- 项目\n\n  | 名称 | 值 |\n  | --- | --- |\n  | 甲 | 1 |\n\n  尾部\n');
  const table=page.locator('.ProseMirror table.children');await table.locator('td p').first().tap();await expect(action(page,'添加行')).toBeVisible();await action(page,'添加行').tap();await expect(table.locator('tr')).toHaveCount(3);await table.locator('tr').last().locator('td p').first().tap();await action(page,'删除行').tap();await expect(table.locator('tr')).toHaveCount(2);
  await table.locator('td p').first().tap();await action(page,'添加列').tap();await expect(table.locator('tr').first().locator('th,td')).toHaveCount(3);await table.locator('td p').nth(1).tap();await action(page,'删除列').tap();await expect(table.locator('tr').first().locator('th,td')).toHaveCount(2);
  await table.locator('td p').first().tap();await action(page,'复制表格').tap();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.clipboard)).toContain('甲\t1');
  await table.locator('td p').first().tap();await page.screenshot({path:path.join(work,'android-context-table.png')});await action(page,'脱离列表').tap();expect(await depth(table)).toBe(0);await action(page,'缩进至列表').tap();expect(await depth(table)).toBe(1);
  await table.locator('td p').first().tap();await action(page,'块后换行').tap();await page.keyboard.insertText('表后的新段落');expect(await depth(page.locator('.ProseMirror p').filter({hasText:'表后的新段落'}))).toBe(1);
});
test('Nested quotes remove only the current layer; fold controls change the nearest default',async({page})=>{
  await start(page,'> 外层\n>\n> > 内层\n> > 内层正文\n>\n> 外层继续\n');await page.locator('.ProseMirror blockquote blockquote p').first().tap({position:{x:12,y:10}});await expect(action(page,'去除一层引用')).toBeVisible();await action(page,'去除一层引用').tap();await expect(page.locator('.ProseMirror > blockquote > p').filter({hasText:/^内层$/})).toBeVisible();await expect(page.locator('.ProseMirror blockquote blockquote')).toContainText('内层正文');await page.getByRole('button',{name:'撤销',exact:true}).tap();await expect(page.locator('.ProseMirror blockquote blockquote p')).toContainText('内层\n内层正文');
});
test('Folding default controls reflect the nearest quote and preserve the outer quote',async({page})=>{
  await start(page,'> [+] 一级\n> 一级内容\n>\n> > [-] 二级\n> > 二级正文\n');
  const nested=page.locator('.ProseMirror blockquote blockquote');await nested.getByRole('button',{name:'展开：二级',exact:true}).tap();await nested.locator('p').filter({hasText:'二级正文'}).tap();await expect(action(page,'默认展开')).toHaveAttribute('aria-pressed','false');await action(page,'默认展开').tap();await expect(action(page,'默认折叠')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('> [+] 一级');await expect(page.locator('.source-editor')).toContainText('> > [+] 二级');
});
test('Pinned contextual controls keep their order, disable outside their context and do not duplicate automatic controls',async({page})=>{
  const order=['bold','indent','outdentBlock','unquote','paragraphAfter'];await start(page,'普通文字\n\n- 第一项\n- 第二项\n\n> 引用文字\n',order);
  await page.locator('.ProseMirror p').filter({hasText:'普通文字'}).tap();await expect(action(page,'增加缩进')).toBeDisabled();await expect(action(page,'脱离列表')).toBeDisabled();await expect(action(page,'去除一层引用')).toBeDisabled();
  await page.locator('.ProseMirror p').filter({hasText:'第二项'}).tap();await expect(action(page,'增加缩进')).toBeEnabled();await expect(bar(page).locator('[data-format-action="indent"]')).toHaveCount(1);await action(page,'增加缩进').tap();expect(await depth(page.locator('.ProseMirror p').filter({hasText:'第二项'}))).toBe(2);
  await page.locator('.ProseMirror blockquote p').tap();await expect(action(page,'去除一层引用')).toBeEnabled();await expect(bar(page).locator('[data-format-action="unquote"]')).toHaveCount(1);await page.screenshot({path:path.join(work,'android-context-quote.png')});
  await page.getByRole('button',{name:'全部格式',exact:true}).tap();await page.getByRole('button',{name:'自定义工具栏',exact:true}).tap();const rows=page.locator('[data-shortcut]');expect(await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-shortcut')))).toEqual(order);
  for(const label of ['行间公式','正文','缩进至列表'])await expect(page.getByRole('button',{name:'添加 '+label,exact:true})).toBeVisible();
});
test('Inline styles reflect the caret and toggle; compact context controls fit narrow screens and themes',async({page})=>{
  await start(page,'**加粗文字**\n\n普通文字');await page.locator('.ProseMirror strong,.ProseMirror .inline-syntax').filter({hasText:'加粗文字'}).first().tap();await expect(action(page,'加粗')).toHaveAttribute('aria-pressed','true');await action(page,'加粗').tap();await expect(action(page,'加粗')).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'全部格式',exact:true}).tap();await page.getByRole('dialog').getByRole('button',{name:'行间公式',exact:true}).tap();await expect(page.locator('.ProseMirror .milkdown-code-block,.ProseMirror .math-block')).toHaveCount(1);
  for(const width of [320,393]){await page.setViewportSize({width,height:740});expect(await bar(page).evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);for(const button of await bar(page).locator('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
});
test('Copying a code tab copies the active tab instead of the full multi-tab source',async({page})=>{
  await start(page,'```tabs {id=0001}\n:::js 第一段\nconsole.log(1);\n:::py 第二段\nprint(2)\n```\n');const code=page.locator('.milkdown-code-block');await code.getByRole('tab',{name:'第二段',exact:true}).click();await code.locator('.cm-content').tap();await expect(action(page,'复制代码')).toHaveCount(0);await page.getByRole('tab',{name:'阅读',exact:true}).click();await page.locator('.tabbed-code').getByRole('tab',{name:'第二段',exact:true}).click();await page.locator('.tabbed-code').getByRole('button',{name:'复制代码',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__mobileState.clipboard)).toBe('print(2)');
});
test('Converting a heading to body text removes its visible Markdown heading marker',async({page})=>{
  await start(page,'## 标题文字\n\n正文');await page.locator('.ProseMirror h2').tap();await page.getByRole('button',{name:'全部格式',exact:true}).tap();await page.getByRole('dialog').getByRole('button',{name:'正文',exact:true}).tap();await expect(page.locator('.ProseMirror h2')).toHaveCount(0);await expect(page.locator('.ProseMirror p').first()).toHaveText('标题文字');await page.getByRole('tab',{name:'源码',exact:true}).tap();await expect(page.locator('.source-editor')).not.toContainText('##');
});
test('An image has block and list controls without treating ordinary inline formatting as an attachment',async({page})=>{
  await start(page,'- 项目\n\n  ![图片](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiPjwvc3ZnPg==)\n\n  **粗体文字**\n');
  const image=page.locator('.ProseMirror .visual-attachment');if(!await image.locator('.syntax-raw').isVisible()){const id=await image.getAttribute('data-attachment-preview');await page.locator('#'+id).tap();}await image.locator('.syntax-raw').tap();await expect(action(page,'脱离列表')).toBeVisible();await action(page,'脱离列表').tap();expect(await depth(image)).toBe(0);await action(page,'缩进至列表').tap();expect(await depth(image)).toBe(1);
  await page.locator('.ProseMirror .inline-syntax').filter({hasText:'粗体文字'}).tap();await expect(bar(page).locator('.mobile-context-format[data-format-action="outdentBlock"]')).toHaveCount(0);await expect(action(page,'减少缩进')).toBeVisible();
});
test('Source mode has no redundant copy shortcut inside or outside a fence',async({page})=>{
  await start(page,'```js\nconsole.log(1);\n```\n\n正文');await page.getByRole('tab',{name:'源码',exact:true}).tap();const source=page.locator('.source-editor .cm-content');await source.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowDown');await expect(action(page,'复制代码')).toHaveCount(0);await page.keyboard.press('Control+End');await expect(action(page,'复制代码')).toHaveCount(0);
});
