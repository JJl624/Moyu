import { _electron as electron, expect, test, type Page, type Locator } from './helpers/test';
import fs from 'node:fs/promises';import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){const data=await fs.mkdtemp(path.resolve(project,'../../work/inline-delimiters-')),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]},env}),page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));await expect(page.locator('.ProseMirror h1')).toBeVisible();return{app,page,data};}
async function open(page:Page,file:string,markdown:string){await page.evaluate(({file,markdown})=>window.moyu!.create(file,'file',markdown),{file,markdown});await page.locator(`.tree-item[title="${file}"]`).dblclick();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');}
async function place(element:Locator,end=false){await element.evaluate(async(el,end)=>{for(let pass=0;pass<2;pass++){const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let found=false;while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest('.syntax-preview'))continue;const index=node.textContent!.indexOf('标题');if(index>=0){document.getSelection()!.collapse(node,index+(end?2:0));found=true;break;}}if(!found)throw Error('Title text missing');await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}},end);}
async function raw(element:Locator){return element.evaluate(el=>{const clone=el.cloneNode(true) as HTMLElement;clone.querySelectorAll('.syntax-preview').forEach(el=>el.remove());return clone.textContent;});}
async function wrap(page:Page,element:Locator,marker:string,closing=marker){await element.click();await place(element);await page.keyboard.type(marker);await place(element,true);await page.keyboard.type(closing);}
async function source(page:Page,expected:string){await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor .cm-content')).toHaveText(expected);await page.getByRole('button',{name:'预览编辑',exact:true}).click();}

test('Strong markers on headings and list headings never duplicate markers, lose heading levels or repeat title text',async()=>{
 test.setTimeout(180000);const{app,page}=await fixture();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{for(const listed of [false,true])for(const level of [1,3,6])for(const marker of ['**','__']){
  const prefix='#'.repeat(level)+' ',file=`标题-${listed}-${level}-${marker==='**'?'星号':'下划线'}.md`;await open(page,file,(listed?'- ':'')+prefix+'标题\n');const heading=page.locator(`.ProseMirror h${level}`);await wrap(page,heading,marker);await expect.poll(()=>raw(heading)).toBe(prefix+marker+'标题'+marker);await source(page,(listed?'* ':'')+prefix+marker+'标题'+marker);await expect(page.locator(`.ProseMirror h${level} .syntax-preview ${marker==='__'?'u':'strong'}`)).toHaveText('标题');
 }expect(errors).toEqual([]);}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('All inline delimiters are character-exact when typed after another source region',async()=>{
 test.setTimeout(180000);const{app,page}=await fixture();
 try{await page.evaluate(()=>window.moyu!.create('图片.svg','file','<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'));
 const formats=[...['*','_','**','__','***','___','~~','==','`','``','$'].map(marker=>[marker,marker]),['[','](链接.md)'],['![','](图片.svg)']];
 for(const before of ['', '**已有** '])for(const [index,[marker,closing]]of formats.entries()){
  const file=`行内-${before?'相邻':'普通'}-${index}.md`;await open(page,file,before+'标题\n');const paragraph=page.locator('.ProseMirror p');await wrap(page,paragraph,marker,closing);await expect.poll(()=>raw(paragraph)).toBe(before+marker+'标题'+closing);await source(page,before+marker+'标题'+closing);
 }}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Composition replay, single-character deletion and undo/redo preserve heading source and delimiters',async()=>{
 const{app,page}=await fixture();
 try{for(const marker of ['**','__']){await open(page,marker==='**'?'提交星号.md':'提交下划线.md','## 标题\n');const heading=page.locator('.ProseMirror h2');await wrap(page,heading,marker);
  for(let i=0;i<3;i++)await heading.dispatchEvent('compositionend',{data:''});await page.waitForTimeout(100);await expect.poll(()=>raw(heading)).toBe('## '+marker+'标题'+marker);
  await page.waitForTimeout(600);await page.keyboard.press('Backspace');await expect.poll(()=>raw(heading)).toBe('## '+marker+'标题'+marker.slice(0,-1));await page.keyboard.press('Control+z');await expect.poll(()=>raw(heading)).toBe('## '+marker+'标题'+marker);await page.keyboard.press('Control+Shift+z');await expect.poll(()=>raw(heading)).toBe('## '+marker+'标题'+marker.slice(0,-1));await page.keyboard.type(marker.slice(-1));await source(page,'## '+marker+'标题'+marker);
 }}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Horizontal rules are one pixel without inherited padding in both themes and modes',async()=>{
 const{app,page}=await fixture();try{await open(page,'分割线.md','上文\n\n---\n\n下文\n');for(const mode of ['预览编辑','阅读'])for(const theme of ['light','dark']){
  await page.getByRole('button',{name:mode,exact:true}).click();if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换主题',exact:true}).click();const rule=page.locator(mode==='阅读'?'.reading-view hr':'.ProseMirror hr');await expect(rule).toHaveCSS('padding-top','0px');expect(await rule.evaluate(el=>el.getBoundingClientRect().height)).toBe(1);await page.screenshot({path:path.resolve(project,`../../work/v1710-rule-${mode}-${theme}.png`)});
 }}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Typing after a source draft containing several styles uses the remapped caret position',async()=>{
 const{app,page}=await fixture();try{
  await open(page,'边界草稿.md','**标题**\n');await page.locator('.ProseMirror p').click();
  await page.locator('.syntax-raw').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);});
  await page.keyboard.insertText('**标题** **后文**');await page.keyboard.press('End');await page.keyboard.type('Z');
  await expect.poll(()=>raw(page.locator('.ProseMirror p'))).toBe('**标题** **后文**Z');await source(page,'**标题** **后文**Z');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
