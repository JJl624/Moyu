import {test,expect,_electron as electron,type Page} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work/e2e');
async function fixture(name:string) {
  await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,name+'-'));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[project,'--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],env});
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror h1')).toBeVisible();return {app,page,data,root:path.join(data,'示例知识库')};
}
async function open(page:Page,name:string,content:string) {await page.evaluate(async({name,content})=>{await window.moyu!.create(name+'.md','file',content);},{name,content});await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('.ProseMirror')).toBeVisible();}
test('Block gaps, tail insertion, caret visibility, Chinese toolbar, splitter and exact inherited typography',async()=>{
  test.setTimeout(180000);const {app,page,data}=await fixture('v05-editing'),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await open(page,'交互验证','第一段文字\n\n第二段文字\n\n```js\nconsole.log(42)\n```\n\n```python\nprint(42)\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconsole.log(8)\n```\n');
    const blocks=page.locator('.ProseMirror > :not(.ProseMirror-widget,.prosemirror-virtual-cursor)');await expect(blocks).toHaveCount(6);
    for(const i of [0,1,2,3,4]) {
      await blocks.nth(i+1).scrollIntoViewIfNeeded();const a=await blocks.nth(i).boundingBox(),b=await blocks.nth(i+1).boundingBox();expect(b!.y-a!.y-a!.height).toBeGreaterThan(1);
      await page.mouse.dblclick(Math.max(a!.x,b!.x)+100,(a!.y+a!.height+b!.y)/2);await expect(blocks).toHaveCount(7);
      await page.keyboard.type('插入段落');await expect(blocks.nth(i+1)).toHaveText('插入段落');await page.keyboard.press('Control+z');if(await blocks.count()!==6)await page.keyboard.press('Control+z');await expect(blocks).toHaveCount(6);
    }
    const last=blocks.nth(5);await last.scrollIntoViewIfNeeded();const end=await last.boundingBox();await page.mouse.click(end!.x+120,end!.y+end!.height+20);await expect(blocks).toHaveCount(7);await page.keyboard.type('末尾输入');await expect(blocks.last()).toHaveText('末尾输入');
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    await page.keyboard.press('Home');await page.keyboard.press('Shift+End');const toolbar=page.locator('.milkdown-toolbar[data-show=true]');await expect(toolbar).toBeVisible();await expect(toolbar.getByRole('button',{name:'加粗',exact:true})).toBeVisible();await page.keyboard.press('ArrowRight');
    await page.locator('.ProseMirror p').first().hover();await expect(page.locator('.milkdown-block-handle')).toBeHidden();
    const divider=page.getByRole('separator',{name:'文件管理器与编辑器分隔条'}),start=Number(await divider.getAttribute('aria-valuenow')),rect=await divider.boundingBox();
    await page.mouse.move(rect!.x+2,rect!.y+200);await page.mouse.down();await page.mouse.move(rect!.x+82,rect!.y+200,{steps:6});await page.mouse.up();await expect(divider).toHaveAttribute('aria-valuenow',String(start+80));
    await expect.poll(async()=>JSON.parse(JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).values['moyu-appearance']).sidebarWidth).toBe(start+80);
    await divider.press('ArrowLeft');await expect(divider).toHaveAttribute('aria-valuenow',String(start+75));await divider.dblclick();await expect(divider).toHaveAttribute('aria-valuenow','260');
    expect(await page.locator('.sidebar-title').evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('switch',{name:'高亮光标所在行'})).toHaveCount(0);
    await page.getByRole('button',{name:'字体与排版',exact:true}).click();await page.getByRole('button',{name:'选择正文字体',exact:true}).click();await expect.poll(()=>page.getByRole('option').count()).toBeGreaterThan(100);
    const popup=page.getByRole('listbox');await popup.hover();await page.mouse.wheel(0,800);await expect.poll(()=>popup.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);await page.keyboard.press('Escape');await expect(page.locator('.preferences')).toBeVisible();
    await page.getByLabel('界面字体',{exact:true}).fill('Segoe UI');await page.keyboard.press('Escape');await page.getByRole('button',{name:'文件浏览器',exact:true}).click();await expect(page.getByLabel('当前字体继承关系')).toContainText('继承 界面字体（Segoe UI）');
    await page.getByLabel('文件浏览器字体',{exact:true}).fill('Arial');await page.keyboard.press('Escape');await expect(page.getByLabel('当前字体继承关系')).toContainText('字号：继承 界面字号');
    for(const [label,value] of [['文字大小','18'],['代码字号','15'],['标题比例','1.15'],['正文行高','1.85'],['段落间距','17'],['列表间距','9'],['正文宽度','790']]) {await page.getByLabel(label+'数值',{exact:true}).fill(value);await page.getByLabel(label+'数值',{exact:true}).press('Tab');await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);}
    await page.getByRole('button',{name:'界面',exact:true}).click();await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'字体与排版',exact:true}).click();await page.getByLabel('界面字号数值',{exact:true}).fill('15');await page.getByLabel('界面字号数值',{exact:true}).press('Tab');await page.getByLabel('侧栏宽度数值',{exact:true}).fill('281');await page.getByLabel('侧栏宽度数值',{exact:true}).press('Tab');await page.getByRole('button',{name:'字体与排版',exact:true}).click();await expect(page.getByLabel('文件浏览器字号',{exact:true})).toHaveValue('15');await expect(page.getByLabel('文件浏览器字体',{exact:true})).toHaveValue('Arial');
    await page.screenshot({path:path.join(project,'preview-v05-fonts.png')});await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.locator('.ProseMirror p').first().click();await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    await page.locator('.milkdown-code-block .cm-content').first().click();await expect(page.locator('.cm-activeLineGutter').first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('switch',{name:'高亮光标所在行'})).toHaveCount(0);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.locator('.ProseMirror p').first().click();await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    await page.locator('.milkdown-code-block .cm-content').first().click();await expect(page.locator('.milkdown-code-block .cm-activeLine').first()).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await page.getByRole('button',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').click();await expect(page.locator('.source-editor .cm-activeLine')).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');await page.getByRole('button',{name:'预览编辑',exact:true}).click();
    const code=page.locator('.milkdown-code-block').first();await code.scrollIntoViewIfNeeded();
    await code.evaluate(el=>{const clock={start:0,end:0};(window as unknown as {testClock:typeof clock}).testClock=clock;el.querySelector('button[aria-label="运行代码块"]')!.addEventListener('click',()=>clock.start=performance.now(),{capture:true,once:true});const observer=new MutationObserver(()=>{if(clock.start&&el.querySelector('.code-output')?.textContent==='42\n'){clock.end=performance.now();observer.disconnect();}});observer.observe(el,{subtree:true,childList:true,characterData:true});});
    await code.getByRole('button',{name:'运行代码块',exact:true}).click();await expect(code.locator('.code-output')).toHaveText('42\n');const wall=await page.evaluate(()=>{const c=(window as unknown as {testClock:{start:number;end:number}}).testClock;return c.end-c.start;}),label=await code.locator('.code-result header small').textContent();const elapsed=Number(label!.match(/总耗时\s*([\d.]+)/)?.[1]);expect(elapsed).toBeGreaterThan(0);expect(Math.abs(wall-elapsed)).toBeLessThan(500);
    await page.screenshot({path:path.join(project,'preview-v05-editing.png')});expect(errors).toEqual([]);
  } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
