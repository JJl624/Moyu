import {chromium,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {guideCorpus} from './helpers/guide-corpus.ts';

const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
if(!sdk)throw Error('Set ANDROID_HOME.');
const serial=process.env.ANDROID_SERIAL||'emulator-5580',appPackage='app.moyu.notes.debug';
if(!serial.startsWith('emulator-'))throw Error('Use a test emulator.');
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const command=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true}).trim();
const work=path.resolve(import.meta.dirname,'../../../work'),corpus=await guideCorpus();
const files=Object.fromEntries(Object.entries(corpus.files).map(([name,file])=>[name,file.base64||Buffer.from(file.content).toString('base64')]));
const desktopReport=await fs.readFile(path.join(work,'mobile-complex-documents-report.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const expected=desktopReport||Object.keys(files).filter(name=>name.endsWith('.md')).sort().map(name=>({path:name}));
command('shell','am','start','-n',appPackage+'/app.moyu.notes.MainActivity');
let pid='';await expect.poll(()=>{try{return pid=command('shell','pidof',appPackage);}catch{return '';}},{timeout:30000}).not.toBe('');
command('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
await expect.poll(async()=>{try{return(await(await fetch('http://127.0.0.1:9222/json')).json()).some(page=>page.url?.includes('/mobile.html'));}catch{return false;}},{timeout:30000}).toBe(true);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{noDefaults:true});
const page=browser.contexts()[0].pages().find(page=>page.url().includes('/mobile.html'));
page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function native(action,input){return page.evaluate(async({action,input})=>{
  const native=window.MoyuNative,original=native.onmessage,id='device-corpus-'+crypto.randomUUID();
  try{return await new Promise((resolve,reject)=>{
    native.onmessage=event=>{const reply=JSON.parse(event.data);if(reply.id===id){reply.ok?resolve(reply.data):reject(Error(reply.error?.message));}else original?.(event);};
    native.postMessage(JSON.stringify({id,method:'feature',args:[action,input]}));
  });}finally{native.onmessage=original;}
},{action,input});}
async function home(){if(await page.getByRole('button',{name:'返回笔记',exact:true}).count())await page.getByRole('button',{name:'返回笔记',exact:true}).click();}
try{
  await expect(page.locator('.mobile-app')).toBeVisible();await home();
  const hashes=await native('mobile.file-hashes',{root:'internal',paths:Object.keys(files)});
  for(const [name,base64]of Object.entries(files))await native('mobile.write-bytes',{root:'internal',path:name,base64,...(hashes[name]?{expected:hashes[name]}:{})});
  await page.reload();await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');await home();
  const folder=page.locator('.mobile-file-tree [data-path="代码示例"]');
  await expect(folder).toHaveAttribute('aria-level','1');
  if(await folder.getAttribute('aria-expanded')!=='true')await folder.locator('.mobile-file-open').click();
  await expect(page.locator('.mobile-file-tree [data-path="代码示例/Python.md"]')).toHaveAttribute('aria-level','2');
  await page.screenshot({path:path.join(work,'android-corpus-tree-device.png')});
  const report=[];
  for(const entry of expected){
    await home();
    if(entry.path.startsWith('代码示例/')&&await folder.getAttribute('aria-expanded')!=='true')await folder.locator('.mobile-file-open').click();
    await page.locator('.mobile-file-tree [data-path="'+entry.path+'"] .mobile-file-open').click();
    await expect(page.getByRole('tab',{name:'阅读',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.reading-view')).toBeVisible();
    await expect(page.locator('.reading-view[data-editor-pending]')).toHaveCount(0,{timeout:120000});
    await expect(page.locator('.reading-view .diagram-error')).toHaveCount(0);
    const actual=await page.locator('.reading-view').evaluate(root=>({headings:[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(element=>element.tagName+':'+element.textContent),code:[...root.querySelectorAll('pre code')].map(element=>element.textContent),cells:[...root.querySelectorAll('th,td')].map(element=>element.textContent),folds:[...root.querySelectorAll('details.folding-quote summary')].map(element=>element.textContent),images:[...root.querySelectorAll('img[data-resource-link]')].map(element=>element.getAttribute('data-resource-link')),drawings:root.querySelectorAll('.resource-preview svg').length,math:root.querySelectorAll('.katex').length,diagrams:root.querySelectorAll('.mermaid-diagram > svg').length,tabs:[...root.querySelectorAll('.tabbed-code [role=tab]')].map(element=>element.textContent)}));
    const {path:name,...desktop}=entry;if(desktopReport)expect(actual,name).toEqual(desktop);else expect(actual.headings.length,name).toBeGreaterThan(0);
    if(entry.path==='mermaid绘图大全.md'){expect(actual.diagrams).toBe(31);await page.screenshot({path:path.join(work,'android-corpus-graphs-device.png')});}
    await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.ProseMirror')).toBeVisible({timeout:60000});
    await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toBeVisible();
    await page.getByRole('button',{name:'保存文档',exact:true}).click();await expect(page.locator('.mobile-document-title')).toContainText('已保存');
    report.push({path:name,diagrams:actual.diagrams,drawings:actual.drawings,math:actual.math});console.log('PASS:',name);
  }
  await home();
  const final=await native('mobile.file-hashes',{root:'internal',paths:Object.keys(files)});
  for(const [name,base64]of Object.entries(files))expect(final[name],name).toBe(createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex'));
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(work,'android-device-corpus-report.json'),JSON.stringify({files:Object.keys(files).length,documents:report,desktopComparison:!!desktopReport,checks:['native file writes and streaming SHA-256','hierarchy','reading default for every document','edit/source/save preserves every original byte'],errors},null,2));
  console.log('PASS: actual Android WebView corpus, '+report.length+' documents and '+Object.keys(files).length+' unchanged files.');
}finally{await browser.close();}
