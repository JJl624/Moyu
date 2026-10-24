import {selectMobile} from './helpers/mobile-controls.mjs';
import {chromium,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT,serial=process.env.ANDROID_SERIAL||'emulator-5580',appPackage='app.moyu.notes.debug';
if(!sdk||!serial.startsWith('emulator-'))throw Error('Set ANDROID_HOME and use a test emulator.');
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'),output=path.resolve(import.meta.dirname,'../../../work');
const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{windowsHide:true,encoding:'utf8'}).trim();
shell('shell','am','force-stop',appPackage);shell('shell','am','start','-n',appPackage+'/app.moyu.notes.MainActivity');
let pid='';await expect.poll(()=>{try{return pid=shell('shell','pidof',appPackage);}catch{return '';}},{timeout:30000}).not.toBe('');shell('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
await expect.poll(async()=>{try{return(await(await fetch('http://127.0.0.1:9222/json')).json()).some(page=>page.url?.includes('/mobile.html'));}catch{return false;}},{timeout:30000}).toBe(true);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{noDefaults:true}),page=browser.contexts()[0].pages().find(page=>page.url().includes('/mobile.html'));page.setDefaultTimeout(30000);
const screenshot=async name=>{await page.screenshot({path:path.join(output,name+'-web.png')});await fs.writeFile(path.join(output,name+'.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:8*1024*1024}));};
try{
  await expect(page.getByRole('tab',{name:'阅读',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  for(const theme of ['light','dark']){
    await selectMobile(page,'外观',theme);await page.getByRole('button',{name:'笔记',exact:true}).click();await screenshot('android-bars-'+theme+'-home');
    await page.getByRole('button',{name:'新建',exact:true}).click();await screenshot('android-bars-'+theme+'-sheet');await page.getByRole('button',{name:'关闭新建',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  }
  await page.getByLabel('正文字号',{exact:true}).focus();await page.keyboard.press('Home');await expect(page.getByLabel('正文字号',{exact:true})).toHaveValue('10');await page.getByLabel('界面字号',{exact:true}).focus();await page.keyboard.press('End');
  await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.mobile-file-open').filter({has:page.locator('.mobile-file-details strong',{hasText:/device-qa-/})}).last().click();await expect(page.locator('.reading-view')).toBeVisible();expect(await page.locator('.reading-view').evaluate(element=>getComputedStyle(element).fontSize)).toBe('10px');
  await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');await page.getByRole('button',{name:'全部格式',exact:true}).click();await expect(page.getByRole('dialog',{name:'全部格式'}).getByRole('button',{name:'表格',exact:true})).toBeVisible();await screenshot('android-bars-dark-styles');await page.getByRole('button',{name:'关闭全部格式',exact:true}).click();
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  for(const [label,value]of [['界面字号','14'],['正文字号','17']]){const input=page.getByLabel(label,{exact:true});await input.focus();await page.keyboard.press('Home');for(let index=10;index<Number(value);index++)await page.keyboard.press('ArrowRight');await expect(input).toHaveValue(value);}
  await selectMobile(page,'外观','system');
  console.log('PASS: Android system-bar surfaces, light/dark sheets, independent font sizes and extended styles.');
}finally{await browser.close();}
