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

const folder='manual-qa-'+Date.now(),note=folder+'/'+folder+'-note.md',drawing=folder+'/drawing.excalidraw';
const scene=JSON.stringify({type:'excalidraw',version:2,source:'Moyu',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}});
let previous;
try{
  await expect(page.locator('.mobile-mode-tabs,.mobile-file-list').first()).toBeVisible({timeout:30000});
  const state=await native('load');if(state.root!=='internal')throw Error('Use the debug internal vault for this test.');
  previous=await native('feature','preferences.get');
  await native('feature','preferences.set-many',{values:{'moyu-save-policy':'manual','moyu-mobile-size':'17'}});
  await native('create',folder,'folder','');await native('create',note,'file','原文');await native('create',drawing,'file',scene);
  await page.reload();await expect(page.locator('.mobile-mode-tabs,.mobile-file-list').first()).toBeVisible();
  if(await page.getByRole('button',{name:'返回笔记',exact:true}).count())await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await page.locator('[data-path="'+folder+'"] .mobile-file-open').click();await page.locator('[data-path="'+drawing+'"] .mobile-file-open').click();await page.getByRole('tab',{name:'编辑',exact:true}).click();
  const canvas=page.locator('canvas.interactive');await expect(canvas).toBeVisible();await page.locator('label').filter({has:page.getByTestId('toolbar-rectangle')}).click();
  shell('shell','uiautomator','dump','/sdcard/moyu-touch-qa.xml');const xml=shell('shell','cat','/sdcard/moyu-touch-qa.xml'),bounds=xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/),box=await canvas.boundingBox();if(!bounds||!box)throw Error('Missing canvas touch bounds');
  const scale=(Number(bounds[3])-Number(bounds[1]))/await page.evaluate(()=>innerWidth),x=box.x+80,y=box.y+250;
  shell('shell','input','swipe',String(Math.round(Number(bounds[1])+x*scale)),String(Math.round(Number(bounds[2])+y*scale)),String(Math.round(Number(bounds[1])+(x+120)*scale)),String(Math.round(Number(bounds[2])+(y+90)*scale)),'500');
  await expect(page.locator('.mobile-document-title small')).toHaveText('未保存');await page.waitForTimeout(1300);expect((await native('read',drawing)).content).toBe(scene);
  shell('shell','input','keyevent','KEYCODE_HOME');await page.waitForTimeout(1000);expect((await native('read',drawing)).content).toBe(scene);shell('shell','am','start','-n',app+'/app.moyu.notes.MainActivity');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();expect((await native('read',drawing)).content).toBe(scene);await page.locator('[data-path="'+drawing+'"] .mobile-file-open').click();await tap(page.getByRole('button',{name:'保存文档',exact:true}));await expect.poll(async()=>JSON.parse((await native('read',drawing)).content).elements.length).toBe(1);
  console.log('PASS: real Android canvas touch, Home/background and navigation keep manual edits private until Save.');
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.locator('[data-path="'+note+'"] .mobile-file-open').click();await page.getByRole('tab',{name:'源码',exact:true}).click();await page.locator('.source-editor .cm-content').fill('手动文本草稿');shell('shell','input','keyevent','KEYCODE_BACK');await expect.poll(keyboard).toBe(false);await tap(page.getByRole('button',{name:'放大字号',exact:true}));await expect(page.getByRole('group',{name:'页面字号 18 px'})).toBeVisible();await expect.poll(keyboard).toBe(false);expect((await native('read',note)).content).toBe('原文');
  await fs.writeFile(path.join(output,'android-0111-editor-native.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024}));
  await page.locator('.mobile-document-title').click();await page.getByRole('button',{name:'关闭 '+folder+'-note',exact:true}).click();await expect(page.getByRole('dialog',{name:'未保存的修改'})).toBeVisible();await tap(page.getByRole('button',{name:'放弃修改',exact:true}));expect((await native('read',note)).content).toBe('原文');expect((await native('feature','mobile.drafts')).some(draft=>draft.path===note)).toBe(false);
  console.log('PASS: page font buttons keep IME closed; explicit discard leaves the native file unchanged and removes the recovery draft.');
}finally{
  if(previous)await native('feature','preferences.set-many',{values:{'moyu-save-policy':previous['moyu-save-policy']||'realtime','moyu-mobile-size':previous['moyu-mobile-size']||'17'}});
  await browser.close();
}
