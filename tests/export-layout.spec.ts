import {selectPreference} from './helpers/runtime-ui';
import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
async function fixture(){
  const data=await fs.mkdtemp(path.resolve(project,'../../work/export-layout-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-theme':'light','moyu-preset':'dracula'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return{app,page,data,root:path.join(data,'示例知识库'),errors};
}
const nested='1. 第一层\n   1. 第二层\n      1. 第三层\n         1. 第四层\n            1. 第五层\n               1. 第六层\n2. 下一个同级\n3. 最后一个同级\n';
test('Nested list spacing does not accumulate when returning to a sibling at any depth',async()=>{
  const{app,page,errors}=await fixture();
  try{
    await page.evaluate(content=>window.moyu!.create('多级列表.md','file',content),nested);await page.locator('.tree-item[title="多级列表.md"]').dblclick();
    await expect(page.locator('.ProseMirror')).toContainText('第六层');
    const measure=async(selector:string)=>page.locator(selector).evaluate(el=>{
      const texts=Array.from(el.querySelectorAll('p')).filter(p=>/第六层|下一个同级|最后一个同级/.test(p.textContent||''));
      const rects=texts.map(p=>p.getBoundingClientRect());
      return{afterNested:rects[1].top-rects[0].bottom,normal:rects[2].top-rects[1].bottom};
    });
    const rich=await measure('.ProseMirror');expect(Math.abs(rich.afterNested-rich.normal)).toBeLessThan(2);
    await page.screenshot({path:path.resolve(project,'../../work/nested-list-rich-v1719.png')});
    await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view')).toContainText('第六层');
    // Tight Markdown lists contain text directly in li rather than p.
    const reading=await page.locator('.reading-view').evaluate(el=>{const boxes=['第六层','下一个同级','最后一个同级'].map(text=>{const li=Array.from(el.querySelectorAll('li')).find(li=>li.firstChild?.textContent===text)!;const range=document.createRange();range.selectNodeContents(li.firstChild!);return range.getBoundingClientRect();});return{nested:boxes[1].top-boxes[0].bottom,normal:boxes[2].top-boxes[1].bottom};});
    expect(Math.abs(reading.nested-reading.normal)).toBeLessThan(2);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('PDF and HTML preserve the reading palette, typography, highlighted code, vector diagrams and complete paginated content',async()=>{
  test.setTimeout(120000);const{app,page,data,root,errors}=await fixture();
  try{
    await fs.writeFile(path.join(root,'图像.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="70"><rect width="280" height="70" fill="#7c63c7"/><text x="20" y="45" fill="white" font-size="24">SVG Preview</text></svg>');
    await fs.copyFile(path.join(project,'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'),path.join(root,'示例绘图.excalidraw'));
    const markdown='# 导出样式测试\n\n正文 **加粗**、*斜体*、==高亮==、`行内代码` 与公式 $\\frac{3}{4}$。\n\n> 引用内有代码\n>\n> ```js\n> const greeting = "hello";\n> console.log(greeting);\n> ```\n\n![图像|280](图像.svg)\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n\n```mermaid\nflowchart LR\n  A[开始] --> B[处理] --> C[完成]\n```\n\n'+nested+'\n| 项目 | 状态 |\n| --- | --- |\n'+Array.from({length:65},(_,i)=>`| 表格行 ${i+1} | 完成 |\n`).join('')+'\n```tabs\n:::js JavaScript\nconsole.log("FIRST TAB");\n:::python Python\nprint("SECOND TAB")\n```\n\n```js\n'+Array.from({length:80},(_,i)=>`console.log("长代码 ${i+1}");\n`).join('')+'```\n\n导出文档结束';
    await page.evaluate(content=>window.moyu!.create('导出测试.md','file',content),markdown.replace('![图像|280](图像.svg)','![图像|280](图像.svg)\n\n[绘图|200](示例绘图.excalidraw)'));await page.locator('.tree-item[title="导出测试.md"]').dblclick();
    await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view .mermaid-diagram svg')).toBeVisible();
    expect(await page.locator('.reading-view [data-language="mermaid"]').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await selectPreference(page,'界面');await page.locator('.theme-grid').getByRole('button',{name:'Dracula',exact:true}).click();await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    const selectors=['.reading-view','.reading-view h1','.reading-view blockquote','.reading-view pre','.reading-view th','.reading-view .katex'];
    const snapshot=()=>page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{const s=getComputedStyle(document.querySelector(selector)!);return[selector,{font:s.fontFamily,size:s.fontSize,color:s.color,background:s.backgroundColor,border:s.borderLeftColor}];})),selectors);
    await app.evaluate(({app,dialog},root)=>{
      (globalThis as any).__pdfPrint=[];dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:process.getBuiltinModule('path').join(root,process.getBuiltinModule('path').basename(options.defaultPath!))});
      app.on('web-contents-created',(_event,wc)=>{const original=wc.printToPDF.bind(wc);wc.printToPDF=async options=>{
        const styles=await wc.executeJavaScript(`Object.fromEntries(${JSON.stringify(['.reading-view','.reading-view h1','.reading-view blockquote','.reading-view pre','.reading-view th','.reading-view .katex'])}.map(selector=>{const s=getComputedStyle(document.querySelector(selector));return [selector,{font:s.fontFamily,size:s.fontSize,color:s.color,background:s.backgroundColor,border:s.borderLeftColor}];}))`);
        (globalThis as any).__pdfPrint.push({styles,options});return original(options);
      };});
    },root);
    for(const mode of ['light','dark']){
      await Promise.all(['导出测试.html','导出测试.pdf'].map(file=>fs.unlink(path.join(root,file)).catch(()=>{})));
      if(await page.locator('html').getAttribute('data-theme')!==mode)await page.getByRole('button',{name:'切换主题',exact:true}).click();
      const expected=await snapshot();await page.getByRole('button',{name:'更多文档操作',exact:true}).click();await page.getByRole('button',{name:'导出 HTML',exact:true}).click();
      const htmlPath=path.join(root,'导出测试.html');await expect.poll(()=>fs.access(htmlPath).then(()=>true,()=>false)).toBe(true);const html=await fs.readFile(htmlPath,'utf8');expect(html).toContain('data:image/svg+xml');expect(html).toContain('data:font/woff2');expect(html).toContain('导出文档结束');expect(html).toContain('SECOND TAB');
      await page.getByRole('button',{name:'更多文档操作',exact:true}).click();await page.getByRole('button',{name:'导出 PDF',exact:true}).click();const pdfPath=path.join(root,'导出测试.pdf');await expect.poll(()=>fs.stat(pdfPath).then(s=>s.size,()=>0)).toBeGreaterThan(10000);
      await expect.poll(()=>app.evaluate(()=>(globalThis as any).__pdfPrint.length)).toBe(mode==='light'?1:2);
      const printed=await app.evaluate(()=>(globalThis as any).__pdfPrint.at(-1));expect(printed.options.printBackground).toBe(true);expect(printed.styles).toEqual(expected);
      await fs.copyFile(pdfPath,path.resolve(project,`../../work/export-${mode}-v1719.pdf`));await fs.copyFile(htmlPath,path.resolve(project,`../../work/export-${mode}-v1719.html`));
      await page.keyboard.press('Escape');await page.locator('.tree-item[title="导出测试.pdf"]').dblclick();await expect(page.locator('.textLayer')).toContainText('导出样式测试');
      const count=await page.locator('.pdf-viewer header').innerText();console.log('PDF pages:',mode,count);
      await page.locator('.pdf-viewer canvas').screenshot({path:path.resolve(project,`../../work/export-${mode}-v1719-page1.png`)});
      await page.getByLabel('PDF 页码',{exact:true}).fill('2');await page.waitForTimeout(100);await expect(page.locator('.pdf-pages')).toHaveAttribute('aria-busy','false');
      let text='';const pages=Number(await page.getByLabel('PDF 页码',{exact:true}).getAttribute('max'));
      for(let number=1;number<=pages;number++){
        await page.getByLabel('PDF 页码',{exact:true}).fill(String(number));await page.waitForTimeout(100);await expect(page.locator('.pdf-pages')).toHaveAttribute('aria-busy','false');
        text+=await page.locator('.textLayer').innerText();
        const png=await page.locator('.pdf-viewer canvas').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL('image/png').split(',')[1]);
        await fs.writeFile(path.resolve(project,`../../work/export-${mode}-v1719-page${number}.png`),Buffer.from(png,'base64'));
      }
      expect(text).toContain('导出文档结束');expect(text).toContain('FIRST TAB');expect(text).toContain('SECOND TAB');expect(text).toContain('65');expect(text).toContain('80');
      await page.getByRole('button',{name:'关闭当前文档',exact:true}).click();await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','导出测试.md');
    }
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Editor close button uses the same save confirmation and previous-tab choice as the tab cross',async()=>{
  const{app,page,errors}=await fixture();
  try{
    for(const file of ['前一个.md','当前.md']){await page.evaluate(file=>window.moyu!.create(file,'file','# '+file),file);await page.locator('.tree-item[title="'+file+'"]').dblclick();}
    await page.locator('.ProseMirror h1').click();await page.keyboard.press('End');await page.keyboard.type('修改');
    await app.evaluate(({dialog})=>{(globalThis as any).__closeCalls=0;dialog.showMessageBox=async()=>{(globalThis as any).__closeCalls++;return{response:2,checkboxChecked:false};};});
    await page.getByRole('button',{name:'关闭当前文档',exact:true}).click();await expect.poll(()=>app.evaluate(()=>(globalThis as any).__closeCalls)).toBe(1);await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','当前.md');
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});await page.getByRole('button',{name:'关闭当前文档',exact:true}).click();await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','前一个.md');await expect(page.locator('.tab-name[title="当前.md"]')).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
