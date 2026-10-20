import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const data=await fs.mkdtemp(path.resolve(project,'../../work/format-toggle-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-theme':'light'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await(await app.browserWindow(page)).evaluate(w=>{w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));return{app,page,errors};
}
async function open(page:Page,name:string,text:string){
  await page.getByRole('button',{name:'预览编辑',exact:true}).click();
  await page.evaluate(({name,text})=>window.moyu!.create(name,'file',text),{name,text});
  await page.locator(`.tree-item[title="${name}"]`).dblclick();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function menu(page:Page,mode:string){
  const editor=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await editor.locator(mode==='源码'?'.cm-line':'p').first().click();await editor.focus();await page.keyboard.press('Control+a');
  await editor.locator(mode==='源码'?'.cm-line':'p').first().click({button:'right',position:{x:15,y:10}});
}
for(const mode of ['预览编辑','源码'])test(mode+' toggles each existing format off, shows its state and supports undo',async()=>{
  test.setTimeout(90000);const{app,page,errors}=await fixture();
  try{
    for(const [label,raw]of [['加粗','**示例文字**'],['斜体','*示例文字*'],['删除线','~~示例文字~~'],['高亮','==示例文字=='],['下划线','__示例文字__'],['行内代码','`示例文字`'],['行内公式','$示例文字$'],['链接','[示例文字](https://example.com)']]){
      await open(page,mode+label+'.md',raw);if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
      await menu(page,mode);const action=page.getByRole('menuitemcheckbox',{name:label,exact:true});await expect(action).toBeChecked();await expect(action).toHaveAttribute('title','取消'+label);
      await action.click();await expect(page.locator('.element-menu')).toHaveCount(0);
      const editor=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await expect(editor).toHaveText('示例文字');
      await page.keyboard.press('Control+z');
      if(mode==='源码')await expect(editor).toHaveText(raw);else await expect(editor.locator('[data-inline-source]').first()).toHaveAttribute('data-syntax-raw',raw);
      await menu(page,mode);await expect(action).toBeChecked();await action.click();
      await menu(page,mode);await expect(action).not.toBeChecked();await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toHaveText('示例文字');
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
test('Nested styles and mixed multi-paragraph selections toggle independently in both editors',async()=>{
  const{app,page,errors}=await fixture();
  try{
    for(const mode of ['预览编辑','源码']){
      for(const [name,raw,remove,expected,remaining]of [['嵌套','__**示例文字**__','加粗','__示例文字__','下划线'],['跨段','**第一段**\n\n**第二段**','加粗','第一段\n\n第二段',''],['混合','**示例**文字','加粗','**示例文字**','加粗']]){
        await open(page,mode+name+'.md',raw);if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
        await menu(page,mode);const action=page.getByRole('menuitemcheckbox',{name:remove,exact:true});if(name==='混合')await expect(action).not.toBeChecked();else await expect(action).toBeChecked();await action.click();
        if(remaining){await menu(page,mode);await expect(page.getByRole('menuitemcheckbox',{name:remaining,exact:true})).toBeChecked();await page.screenshot({path:path.resolve(project,'../../work/format-active-'+mode+'.png')});await page.keyboard.press('Escape');}
        await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toBeVisible();await expect.poll(async()=>(await page.locator('.source-editor .cm-line').allTextContents()).join('\n').trimEnd()).toBe(expected);
      }
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

for(const mode of ['预览编辑','源码'])test(mode+' keyboard formatting toggles on and off without reselection',async()=>{
  const{app,page,errors}=await fixture();
  try{
    for(const [key,raw]of [['Control+b','**示例文字**'],['Control+i','*示例文字*'],['Control+Alt+x','~~示例文字~~']]){
      await open(page,mode+key.replaceAll('+','')+'.md','示例文字');
      if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
      const editor=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');
      await editor.focus();await page.keyboard.press('Control+a');await page.keyboard.press(key);
      if(mode==='源码')await expect(editor).toHaveText(raw);else await expect(editor.locator('[data-inline-source]')).toHaveAttribute('data-syntax-raw',raw);
      await page.keyboard.press(key);await expect(editor).toHaveText('示例文字');
      await page.keyboard.press('Control+z');
      if(mode==='源码')await expect(editor).toHaveText(raw);else await expect(editor.locator('[data-inline-source]')).toHaveAttribute('data-syntax-raw',raw);
      await page.keyboard.press(key);await expect(editor).toHaveText('示例文字');
      await editor.focus();await page.keyboard.press('Control+a');await page.keyboard.press(key);await page.keyboard.press(key);await expect(editor).toHaveText('示例文字');
    }
    for(const key of ['Control+b','Control+i','Control+Alt+x']){
      await open(page,mode+key.replaceAll('+','')+'空样式.md','');if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
      const empty=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await empty.focus();await page.keyboard.press(key);await page.keyboard.press(key);await expect(empty).toHaveText('');
    }
    await open(page,mode+'嵌套快捷键.md','__**示例文字**__');if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
    const editor=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');await editor.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+b');
    if(mode==='源码')await expect(editor).toHaveText('__示例文字__');else await expect(editor.locator('[data-inline-source]')).toHaveAttribute('data-syntax-raw','__示例文字__');
    await editor.dispatchEvent('keydown',{key:'b',ctrlKey:true,isComposing:true});
    if(mode==='源码')await expect(editor).toHaveText('__示例文字__');else await expect(editor.locator('[data-inline-source]')).toHaveAttribute('data-syntax-raw','__示例文字__');
    await open(page,mode+'代码快捷键.md','```js\nconst value = 1;\n```');
    if(mode==='源码')await page.getByRole('button',{name:'源码',exact:true}).click();
    const code=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror .cm-content');
    await expect(code).toBeVisible();
    const original=(await code.locator('.cm-line').allTextContents()).join('\n');
    await code.focus();await page.keyboard.press('Control+a');
    for(const key of ['Control+b','Control+i','Control+Alt+x'])await page.keyboard.press(key);
    expect((await code.locator('.cm-line').allTextContents()).join('\n')).toBe(original);
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Empty drawings have a visible frame in editing and reading, in both themes, while retaining their width',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await page.evaluate(()=>window.moyu!.feature('drawing.create',{path:'attachments/空白.excalidraw'}));
    await open(page,'空白绘图边框.md','前文\n\n![绘图|180](attachments/空白.excalidraw)\n\n后文');
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换主题',exact:true}).click();
      for(const mode of ['预览编辑','阅读']){
        await page.getByRole('button',{name:mode,exact:true}).click();
        const frame=page.locator(mode==='阅读'?'.reading-view .resource-preview>svg':'.attachment-overlay .resource-preview>svg');await expect(frame).toBeVisible();
        const style=await frame.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{border:s.borderTopWidth,style:s.borderTopStyle,color:s.borderTopColor,width:r.width,height:r.height};});
        expect(style.border).toBe('1px');expect(style.style).toBe('solid');expect(style.color).not.toBe('rgba(0, 0, 0, 0)');expect(style.width).toBeCloseTo(180,0);expect(style.height).toBeGreaterThan(40);
        await page.screenshot({path:path.resolve(project,'../../work/drawing-frame-'+theme+'-'+mode+'.png'),clip:(await frame.boundingBox())!});
      }
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
