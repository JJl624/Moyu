import {chromium,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
if(!sdk)throw Error('Set ANDROID_HOME.');
const serial=process.env.ANDROID_SERIAL||'emulator-5580';
if(!serial.startsWith('emulator-'))throw Error('Run this regression on a disposable emulator.');
const appPackage=process.env.MOYU_ANDROID_PACKAGE||'app.moyu.notes.debug',component=appPackage+'/app.moyu.notes.MainActivity';
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{windowsHide:true,encoding:'utf8'}).trim();
const output=path.resolve(import.meta.dirname,'../../../work');
const keyboardVisible=()=>/(?:mInputShown|inputShown|isInputViewShown)\s*=\s*true/.test(shell('shell','dumpsys','input_method'));
async function connect(){
  let pid='';await expect.poll(()=>{try{pid=shell('shell','pidof',appPackage);return pid;}catch{return '';}},{timeout:30000}).not.toBe('');shell('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
  await expect.poll(async()=>{try{const pages=await(await fetch('http://127.0.0.1:9222/json')).json();return pages.some(page=>page.url?.includes('/mobile.html'));}catch{return false;}},{timeout:30000}).toBe(true);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{noDefaults:true});
  const page=browser.contexts()[0].pages().find(page=>page.url().includes('/mobile.html'));if(!page)throw Error('WebView not found.');
  page.setDefaultTimeout(20000);return{browser,page};
}
async function tapDocument(page,locator){
  shell('shell','uiautomator','dump','/sdcard/moyu-device-layout.xml');
  const xml=shell('shell','cat','/sdcard/moyu-device-layout.xml'),bounds=xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!bounds)throw Error('WebView bounds unavailable.');
  const box=await locator.boundingBox();if(!box)throw Error('Editor is not visible.');
  const width=await page.evaluate(()=>innerWidth),scale=(Number(bounds[3])-Number(bounds[1]))/width;
  shell('shell','input','tap',String(Math.round(Number(bounds[1])+(box.x+Math.min(box.width/2,20))*scale)),String(Math.round(Number(bounds[2])+(box.y+Math.min(box.height/2,20))*scale)));
}
shell('shell','am','start','-n',component);
let {browser,page}=await connect();
try{
  await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('button',{name:'新建文档',exact:true}).click();
  const filename='device-qa-'+Date.now()+'.md';await page.getByLabel('名称',{exact:true}).fill(filename);await page.getByRole('button',{name:'确定',exact:true}).click();
  await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'源码',exact:true}).click();
  const source=page.locator('.source-editor .cm-content');await expect(source).toBeVisible();
  await expect(page.locator('.source-editor')).not.toHaveAttribute('data-editor-pending','true');
  expect(await source.evaluate(element=>element===document.activeElement)).toBe(false);
  await expect.poll(keyboardVisible).toBe(false);await tapDocument(page,source);await expect.poll(keyboardVisible).toBe(true);
  await source.fill('# Android 设备测试\n\n第一行\n第二行\n\n> [+] 折叠标题\n> 内容\n');
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.locator('.mobile-document-title')).toContainText('已保存');
  await page.getByRole('tab',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view')).toContainText('第二行');
  await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');expect(await page.locator('.ProseMirror').evaluate(element=>element===document.activeElement)).toBe(false);await expect.poll(keyboardVisible).toBe(false);
  await tapDocument(page,page.locator('.ProseMirror p').first());await expect.poll(keyboardVisible).toBe(true);
  const viewport=await page.evaluate(()=>({height:innerHeight,width:innerWidth})),bar=await page.getByRole('toolbar',{name:'文本格式'}).boundingBox();
  if(!bar||bar.y+bar.height>viewport.height+1)throw Error('Formatting bar is outside the viewport.');
  await page.screenshot({path:path.join(output,'android-device-editing.png')});
  await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(source).toBeVisible();await expect.poll(keyboardVisible).toBe(false);await tapDocument(page,source);await source.fill('# Android 设备测试\n\n后台保存内容');
  shell('shell','input','keyevent','KEYCODE_HOME');
  await expect.poll(()=>shell('shell','run-as',appPackage,'cat','files/vault/'+filename)).toContain('后台保存内容');
  await browser.close();shell('shell','am','force-stop',appPackage);shell('shell','am','start','-n',component);
  ({browser,page}=await connect());
  await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.reading-view')).toContainText('后台保存内容');
  await expect(page.locator('.source-editor,.ProseMirror')).toHaveCount(0);
  await page.screenshot({path:path.join(output,'android-device-reading.png')});
  await page.getByRole('button',{name:'文档操作',exact:true}).click();await page.getByRole('button',{name:'文档历史',exact:true}).click();await expect(page.getByRole('dialog',{name:'文档历史'})).toBeVisible();
  await page.getByRole('button',{name:'关闭文档历史',exact:true}).click();await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  const screenshot=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024});await fs.writeFile(path.join(output,'android-device-home.png'),screenshot);
  console.log('PASS: actual Android WebView, read defaults, deferred keyboard until document tap, native save, soft-keyboard viewport, background save, process restart and SQLite history.');
}finally{await browser.close();}
