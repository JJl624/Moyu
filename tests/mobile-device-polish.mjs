import {chromium,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const sdk=process.env.ANDROID_HOME,serial=process.env.ANDROID_SERIAL||'emulator-5580',app='app.moyu.notes.debug';
if(!sdk||!serial.startsWith('emulator-'))throw Error('Use an Android test emulator and set ANDROID_HOME.');
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true}).trim();
const output=path.resolve(import.meta.dirname,'../../../work');
const keyboard=()=>/(?:mInputShown|inputShown|isInputViewShown)\s*=\s*true/.test(shell('shell','dumpsys','input_method'));
shell('shell','am','force-stop',app);shell('shell','am','start','-n',app+'/app.moyu.notes.MainActivity');
let pid='';await expect.poll(()=>{try{return pid=shell('shell','pidof',app);}catch{return '';}},{timeout:30000}).not.toBe('');
shell('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
await expect.poll(async()=>{try{return(await(await fetch('http://127.0.0.1:9222/json')).json()).some(page=>page.url?.includes('/mobile.html'));}catch{return false;}},{timeout:30000}).toBe(true);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{noDefaults:true}),page=browser.contexts()[0].pages().find(page=>page.url().includes('/mobile.html'));page.setDefaultTimeout(30000);
async function native(method,...args){return page.evaluate(async({method,args})=>{
  const bridge=window.MoyuNative,previous=bridge.onmessage,id='touch-qa-'+crypto.randomUUID();
  try{return await new Promise((resolve,reject)=>{bridge.onmessage=event=>{const reply=JSON.parse(event.data);if(reply.id===id)reply.ok?resolve(reply.data):reject(Error(reply.error?.message));else previous?.(event);};bridge.postMessage(JSON.stringify({id,method,args}));});}finally{bridge.onmessage=previous;}
},{method,args});}
async function tap(locator){
  await locator.scrollIntoViewIfNeeded();
  let xml='';await expect.poll(()=>{try{const result=shell('shell','uiautomator','dump','/sdcard/moyu-touch-qa.xml');if(!result.includes('dumped'))return false;xml=shell('shell','cat','/sdcard/moyu-touch-qa.xml');return xml.includes('android.webkit.WebView');}catch{return false;}},{timeout:15000}).toBe(true);
  const bounds=xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/),box=await locator.boundingBox();if(!bounds||!box)throw Error('Native touch bounds unavailable.');
  const scale=(Number(bounds[3])-Number(bounds[1]))/await page.evaluate(()=>innerWidth);
  shell('shell','input','tap',String(Math.round(Number(bounds[1])+(box.x+Math.min(20,box.width/2))*scale)),String(Math.round(Number(bounds[2])+(box.y+Math.min(20,box.height/2))*scale)));
}
async function confirmNative(button){
  // Prevent Playwright's default auto-dismiss; accept the real Android dialog.
  const keepOpen=()=>{};page.on('dialog',keepOpen);
  try{const clicking=button.click();let bounds;
    await expect.poll(()=>{try{shell('shell','uiautomator','dump','/sdcard/moyu-touch-confirm.xml');const xml=shell('shell','cat','/sdcard/moyu-touch-confirm.xml'),node=xml.match(/<node[^>]*resource-id="android:id\/button1"[^>]*>/)?.[0];bounds=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);return !!bounds;}catch{return false;}},{timeout:15000}).toBe(true);
    shell('shell','input','tap',String(Math.round((Number(bounds[1])+Number(bounds[3]))/2)),String(Math.round((Number(bounds[2])+Number(bounds[4]))/2)));await clicking;
  }finally{page.off('dialog',keepOpen);}
}
const folder='touch-qa-'+Date.now(),note=folder+'/note.md',destination=folder+'/destination';
const original='# 手机交互\n\n普通文字\n\n| 名称 | 输入 | 输出 | 用途 | 备注 |\n| --- | --- | --- | --- | --- |\n| 排序 | 数组 | 数组 | 排序 | 原地 |\n\n```js {id=0001}\nconsole.log("native-clipboard");\n```\n\n![图片](note.assets/attachments/view.svg)\n\n> [+] 引用\n> 内容\n';
try{
  await expect(page.locator('.mobile-mode-tabs,.mobile-file-list').first()).toBeVisible({timeout:30000});
  const fullHeight=await page.evaluate(()=>visualViewport?.height||innerHeight);
  await native('create',folder,'folder','');await native('create',destination,'folder','');await native('create',note,'file',original);
  await native('create',folder+'/other.md','file','# Other');
  await native('create',folder+'/nested.md','file','- 一级项目\n\n  - 二级项目\n\n    ```js {id=0002}\n    console.log(1);\n    ```\n\n    | 名称 | 值 |\n    | --- | --- |\n    | 数据 | 1 |\n\n    ![图片](note.assets/attachments/view.svg)\n\n    后续文字\n');
  await native('create',folder+'/removed','folder','');await native('create',folder+'/removed/child.md','file','# Child');
  await native('feature','mobile.write-bytes',{root:'internal',path:folder+'/note.assets/attachments/view.svg',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="300" fill="teal"/></svg>').toString('base64')});
  await page.reload();await expect(page.locator('.mobile-mode-tabs,.mobile-file-list').first()).toBeVisible();if(await page.getByRole('button',{name:'返回笔记',exact:true}).count())await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.locator('[data-path="'+folder+'"] .mobile-file-open').click();await page.locator('[data-path="'+note+'"] .mobile-file-open').click();await expect(page.getByRole('region',{name:'表格，可左右滑动'})).toHaveAttribute('data-overflow','true');
  if(!process.argv.includes('--history-only')){
  await page.getByRole('button',{name:'复制代码',exact:true}).click();await page.getByRole('tab',{name:'源码',exact:true}).click();const source=page.locator('.source-editor .cm-content');await expect(source).toBeVisible();await expect.poll(keyboard).toBe(false);await tap(source);await expect.poll(keyboard).toBe(true);
  await source.fill('');shell('shell','input','keyevent','KEYCODE_PASTE');await expect(source).toContainText('console.log("native-clipboard");');await source.fill(original);
  shell('shell','input','keyevent','KEYCODE_BACK');await expect.poll(keyboard).toBe(false);await expect(page.getByRole('tab',{name:'源码',exact:true})).toHaveAttribute('aria-selected','true');
  // Use the actual Android DocumentsUI cancellation result, not a bridge stub.
  await source.click();await page.keyboard.press('ControlOrMeta+A');await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toContain('# 手机交互');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('button',{name:'插入附件',exact:true}).click();await expect.poll(()=>shell('shell','dumpsys','activity','activities')).toMatch(/DocumentsActivity|documentsui.*PickActivity/);
  shell('shell','input','keyevent','KEYCODE_BACK');await expect.poll(async()=>(await source.locator('.cm-line').allTextContents()).join('\n')).toBe(original);await expect.poll(async()=>(await native('read',note)).content).toBe(original);
  console.log('PASS: canceling the Android attachment picker preserves the selected source and saved bytes.');
  await page.getByRole('button',{name:'全部格式',exact:true}).click();await expect(page.getByRole('dialog',{name:'全部格式'})).toBeVisible();await expect.poll(keyboard).toBe(false);await expect.poll(()=>page.evaluate(()=>visualViewport?.height||innerHeight)).toBeGreaterThanOrEqual(fullHeight-1);shell('shell','input','keyevent','KEYCODE_BACK');await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(keyboard).toBe(false);
  await page.getByRole('tab',{name:'阅读',exact:true}).click();await page.getByRole('button',{name:'全屏查看图片',exact:true}).click();await expect(page.getByRole('dialog',{name:'全屏查看'})).toBeVisible();await page.getByRole('button',{name:'放大',exact:true}).click();await expect(page.locator('.mobile-media-viewer output')).toHaveText('150%');
  await fs.writeFile(path.join(output,'android-device-media.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024}));shell('shell','input','keyevent','KEYCODE_BACK');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'操作 note.md',exact:true}).click();await page.getByRole('button',{name:'选择多个',exact:true}).click();await page.locator('[data-path="'+folder+'/other.md"] .mobile-file-open').click();await page.getByRole('toolbar',{name:'文件批量操作'}).getByRole('button',{name:'移动',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'destination',exact:true}).click();await page.getByRole('button',{name:'移到这里',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved=await native('read',destination+'/note.md');expect(moved.content).toBe(original);expect(await native('feature','file.exists',{path:destination+'/note.assets/attachments/view.svg'})).toBe(true);expect(await native('feature','file.exists',{path:destination+'/other.md'})).toBe(true);
  // A chooser is launched only on the isolated debug app. Verify the payload
  // was copied into app cache and dismiss it with the system back key.
  await native('feature','mobile.share-files',{root:'internal',paths:[destination+'/note.md',destination+'/other.md']});
  await expect.poll(()=>shell('shell','dumpsys','activity','activities')).toContain('ChooserActivity');shell('shell','input','keyevent','KEYCODE_BACK');
  await page.locator('[data-path="'+folder+'/removed"] .mobile-file-open').click();await page.getByRole('button',{name:'操作 removed',exact:true}).click();await confirmNative(page.getByRole('button',{name:'移入回收站',exact:true}));await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('after-delete.txt');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  expect(await native('feature','file.exists',{path:folder+'/after-delete.txt'})).toBe(true);expect(await native('feature','file.exists',{path:folder+'/removed/after-delete.txt'})).toBe(false);await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'编辑工具栏',exact:true}).click();await page.getByRole('button',{name:'下移 加粗',exact:true}).click();await expect(page.locator('[data-shortcut]').first()).toHaveAttribute('data-shortcut','italic');await page.getByRole('button',{name:'恢复默认工具栏',exact:true}).click();await page.getByRole('button',{name:'关闭编辑工具栏',exact:true}).click();
  shell('shell','input','keyevent','KEYCODE_BACK');await expect(page.getByRole('tree',{name:'文档目录'})).toBeVisible();await expect(page.locator('[data-path="'+folder+'"]')).toHaveAttribute('aria-selected','true');await page.getByRole('button',{name:'选择知识库',exact:true}).click();await expect(page.getByRole('dialog',{name:'知识库',exact:true})).toBeVisible();shell('shell','input','keyevent','KEYCODE_BACK');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('[data-path="'+folder+'/nested.md"] .mobile-file-open').click();await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');await expect.poll(keyboard).toBe(false);
  const nestedCode=page.locator('.milkdown-code-block .cm-content'),nestedTable=page.locator('.ProseMirror table.children');await tap(nestedCode);await expect.poll(keyboard).toBe(true);
  for(const [target,text]of [[nestedCode,'代码和表格之间'],[nestedTable.locator('td p').first(),'表格和图片之间']]){
    await tap(target);await page.getByRole('button',{name:'全部格式',exact:true}).click();await page.getByRole('dialog',{name:'全部格式'}).getByRole('button',{name:'块后换行',exact:true}).click();
    await expect.poll(()=>page.locator('.ProseMirror').evaluate(element=>element===document.activeElement)).toBe(true);await native('feature','mobile.copy-text',{text});shell('shell','input','keyevent','KEYCODE_PASTE');const paragraph=page.locator('.ProseMirror p').filter({hasText:text});await expect(paragraph).toBeVisible();expect(await paragraph.evaluate(element=>{let depth=0;for(let node=element.parentElement;node;node=node.parentElement)if(node.classList.contains('list-item'))depth++;return depth;})).toBe(2);
  }
  await page.getByRole('button',{name:'保存文档',exact:true}).click();expect((await native('read',folder+'/nested.md')).content).toContain('    代码和表格之间');expect((await native('read',folder+'/nested.md')).content).toContain('    表格和图片之间');
  await fs.writeFile(path.join(output,'android-native-list-editing.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024}));
  console.log('PASS: real Android touches and clipboard paste insert list paragraphs between code, table and image without changing indentation.');
  console.log('PASS: native clipboard paste, canceled system attachment picker, keyboard and sheet back order, media zoom, attachment-aware batch moves, new-file destination after folder deletion, native multi-file sharing and shortcut ordering.');
  }
  for(const name of ['history-source.md','history-rich.md'])await native('create',folder+'/'+name,'file','原文');
  await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.locator('[data-path="'+folder+'"] .mobile-file-open').click();
  for(const [mode,name]of [['源码','history-source.md'],['编辑','history-rich.md']]){
    await page.locator('[data-path="'+folder+'/'+name+'"] .mobile-file-open').click();await page.getByRole('tab',{name:mode,exact:true}).click();const host=page.locator(mode==='源码'?'.source-editor':'.editor-host');await expect(host).not.toHaveAttribute('data-editor-pending','true');const content=page.locator(mode==='源码'?'.source-editor .cm-content':'.ProseMirror');
    await expect.poll(keyboard).toBe(false);await tap(content);await expect.poll(keyboard).toBe(true);await page.keyboard.press('End');await native('feature','mobile.copy-text',{text:'新增'});shell('shell','input','keyevent','KEYCODE_PASTE');await expect(content).toHaveText('原文新增');
    await tap(page.getByRole('button',{name:'撤销',exact:true}));await expect(content).toHaveText('原文');await expect.poll(keyboard).toBe(true);await tap(page.getByRole('button',{name:'重做',exact:true}));await expect(content).toHaveText('原文新增');await expect.poll(keyboard).toBe(true);
    shell('shell','input','keyevent','KEYCODE_BACK');await expect.poll(keyboard).toBe(false);await expect.poll(()=>page.evaluate(()=>visualViewport?.height||innerHeight)).toBeGreaterThanOrEqual(fullHeight-1);
    for(const [action,text]of [['撤销','原文'],['重做','原文新增']]){await tap(page.getByRole('button',{name:action,exact:true}));await expect(content).toHaveText(text);let stable=0;await expect.poll(()=>{stable=keyboard()?0:stable+1;return stable;},{intervals:[100,150,200]}).toBeGreaterThanOrEqual(3);}
    await page.getByRole('button',{name:'保存文档',exact:true}).click();await page.getByRole('button',{name:'返回笔记',exact:true}).click();console.log('PASS: '+mode+' native undo/redo keep both open and closed keyboard states unchanged.');
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('.mobile-settings-group > h2')).toHaveText(['界面','阅读','编辑','文件与同步']);await fs.writeFile(path.join(output,'android-settings-native.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024}));
}finally{await browser.close();}
