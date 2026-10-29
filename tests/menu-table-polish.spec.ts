import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const data=await fs.mkdtemp(path.resolve(project,'../../work/menu-table-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-theme':'light'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await(await app.browserWindow(page)).evaluate(w=>{w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));return{app,page,errors};
}
async function open(page:Page,name:string,text:string){
  await page.evaluate(({name,text})=>window.moyu!.create(name,'file',text),{name,text});
  await page.locator(`.tree-item[title="${name}"]`).dblclick();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
}
test('Single click edits any table cell; cell dragging and explicit table/row/column selection remain available',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await open(page,'单击表格.md','正文\n\n| 甲 | 乙 |\n| - | - |\n| 一 | 二 |\n| 三 | |\n\n中间\n\n| 丙 | 丁 |\n| - | - |\n| 四 | 五 |\n\n末尾');
    const tables=page.locator('.ProseMirror table.children');await expect(tables).toHaveCount(2);
    for(const [table,index]of [[0,0],[0,3],[1,1],[0,2],[1,0]]){
      const cell=tables.nth(table).locator('td').nth(index);const before=await cell.innerText();
      await page.locator('.ProseMirror>p').last().click();await cell.click();
      await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(0);await page.keyboard.insertText('添');
      await expect(cell).toContainText('添');await page.keyboard.press('Control+z');await expect(cell).toHaveText(before.trim());
    }
    const target=tables.first().locator('td').first();await target.click({button:'right'});
    await page.getByRole('menuitem',{name:'选中表格',exact:true}).click();await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(1);
    await expect(page.locator('.ProseMirror')).toHaveCSS('caret-color','rgba(0, 0, 0, 0)');
    await tables.first().locator('td').last().click();await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(0);
    await page.keyboard.insertText('空格');await expect(tables.first().locator('td').last()).toHaveText('空格');await page.keyboard.press('Control+z');
    const a=(await target.boundingBox())!,b=(await tables.first().locator('td').last().boundingBox())!;
    await page.mouse.move(a.x+10,a.y+10);await page.mouse.down();await page.mouse.move(b.x+10,b.y+10,{steps:8});await page.mouse.up();
    await expect(page.locator('td.selectedCell')).toHaveCount(4);
    for(const role of ['row-drag-handle','col-drag-handle']){
      await target.hover();const handle=tables.first().locator('xpath=ancestor::div[contains(@class,"milkdown-table-block")]').locator(`[data-role="${role}"]`);
      await expect(handle).toHaveAttribute('data-show','true');
      await expect.poll(async()=>{const h=(await handle.boundingBox())!,c=(await target.boundingBox())!;return Math.abs(role==='row-drag-handle'?(h.y+h.height/2)-(c.y+c.height/2):(h.x+h.width/2)-(c.x+c.width/2));}).toBeLessThan(2);
      await handle.click();await expect(page.locator('.selectedCell')).toHaveCount(role==='row-drag-handle'?2:3);
      await target.click();await expect(page.locator('.selectedCell')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Context menus group actual actions, support keyboard submenus and fit light/dark and narrow layouts',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await open(page,'菜单布局.md','选中这些文字\n\n| 用途 | 内容 |\n| - | - |\n| 表格 | 单击编辑 |\n\n末尾');
    const para=page.locator('.ProseMirror>p').first();await para.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
    await para.click({button:'right',position:{x:20,y:10}});
    await expect(page.locator('.menu-clipboard')).toHaveCount(0);
    const formats=page.getByRole('group',{name:'文字格式',exact:true});await expect(formats.getByRole('menuitemcheckbox')).toHaveCount(8);
    for(const name of ['复制文本','剪切','粘贴']){const button=page.getByRole('menuitem',{name,exact:true});await expect(button).toBeVisible();expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual((await formats.boundingBox())!.y+(await formats.boundingBox())!.height);}
    await expect(formats.locator('button svg')).toHaveCount(8);for(const button of await formats.getByRole('menuitemcheckbox').all()){await expect(button).toHaveAttribute('title',(await button.getAttribute('aria-label'))!);await expect(button.locator('span')).toBeHidden();}
    expect((await page.locator('.element-menu').boundingBox())!.height).toBeLessThanOrEqual(192);
    const icons=await formats.getByRole('menuitemcheckbox').all();const boxes=await Promise.all(icons.map(icon=>icon.boundingBox()));expect(new Set(boxes.map(box=>Math.round(box!.y))).size).toBe(2);for(const box of boxes)expect(box!.width).toBeGreaterThanOrEqual(24);
    await page.screenshot({path:path.resolve(project,'../../work/menu-format-light.png')});await page.locator('.element-menu').screenshot({path:path.resolve(project,'../../work/menu-format-detail.png')});
    await formats.getByRole('menuitemcheckbox',{name:'加粗',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(formats.getByRole('menuitemcheckbox',{name:'斜体',exact:true})).toBeFocused();
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await expect(page.locator('.element-menu')).toHaveCount(0);await expect(page.locator('.ProseMirror mark')).toHaveText('选中这些文字');await page.keyboard.press('Control+z');
    const cell=page.locator('.ProseMirror td').first();await cell.click({button:'right'});
    const insert=page.getByRole('menuitem',{name:'插入',exact:true});await insert.focus();await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem',{name:'在下方插入行',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'在右侧插入列',exact:true})).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(insert).toBeFocused();await expect(page.locator('.element-submenu')).toHaveCount(0);
    await page.getByRole('menuitem',{name:'删除',exact:true}).hover();await expect(page.locator('.element-submenu')).toBeVisible();
    await page.screenshot({path:path.resolve(project,'../../work/menu-table-light.png')});await page.keyboard.press('Escape');await expect(page.locator('.element-submenu')).toHaveCount(0);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'切换主题',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await(await app.browserWindow(page)).evaluate(w=>w.setSize(900,640));
    await cell.click();await cell.evaluate(el=>{const b=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:innerWidth-5,clientY:innerHeight-5}));});
    await page.getByRole('menuitem',{name:'插入',exact:true}).hover();
    for(const menu of await page.locator('.element-menu').all()){
      const bounds=(await menu.boundingBox())!,size=page.viewportSize()||await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
      expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(size.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height);
    }
    await page.screenshot({path:path.resolve(project,'../../work/menu-table-narrow.png')});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    const tabs=(await page.locator('.tabbar').boundingBox())!,toolbar=(await page.getByRole('toolbar',{name:'文档工具栏',exact:true}).boundingBox())!;
    expect(toolbar.y).toBeGreaterThanOrEqual(tabs.y+tabs.height);await expect(page.locator('.breadcrumbs strong')).toHaveText('菜单布局');
    await page.screenshot({path:path.resolve(project,'../../work/toolbar-v100-restored.png')});
    await page.getByRole('button',{name:'阅读',exact:true}).click();await page.locator('.reading-view td').first().click({button:'right'});
    await expect(page.getByRole('group',{name:'文字格式',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'插入',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'删除',exact:true})).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
