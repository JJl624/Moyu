import {stopScore} from './attachment-helper';
import {_electron as electron,test,expect} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function fixture(){
  const data=await fs.mkdtemp(path.join(work,'math-score-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow(),errors:string[]=[],requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();const root=path.join(data,'示例知识库');
  const open=async(name:string,source:string)=>{await page.evaluate(({name,source})=>window.moyu!.create(name,'file',source),{name,source});await page.locator('.tree-item[title="'+name+'"]').dblclick();await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');};
  const close=async()=>{try{expect(errors).toEqual([]);}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}};
  return {app,page,root,data,errors,requests,open,close};
}
test('MathLive assists a nested display formula offline; cancel is clean and apply is a single undoable edit',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='1. 前文\n\n   $$\n   x+1\n   $$\n\n   后文';await f.open('公式.md',source);
    await f.page.getByRole('button',{name:'公式辅助输入',exact:true}).click();const dialog=f.page.getByRole('dialog',{name:'公式',exact:true}),latex=dialog.getByLabel('公式 LaTeX',{exact:true});
    await expect(dialog.locator('math-field')).toBeVisible();await expect(latex).toHaveValue('x+1');await expect(latex).toBeHidden();await dialog.locator('math-field').locator('[part=virtual-keyboard-toggle]').click();
    await expect.poll(()=>f.page.evaluate(()=>window.mathVirtualKeyboard.visible)).toBe(true);
    await expect.poll(async()=> (await dialog.locator('.formula-keyboard').boundingBox())?.height||0).toBeGreaterThan(150);
    await f.page.screenshot({path:path.join(work,'v1055-math-keyboard.png')});
    await dialog.locator('math-field').evaluate((field:any)=>field.executeCommand('selectAll'));await dialog.locator('.formula-keyboard .MLK__layer.is-visible [data-keycap-value="7"]').click();await expect(latex).toHaveValue('7');
    await dialog.locator('.formula-source summary').click();await latex.fill('\\frac{1}{2}');await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await fs.readFile(path.join(f.root,'公式.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
    await f.page.getByRole('button',{name:'公式辅助输入',exact:true}).click();await expect(latex).toHaveValue('x+1');await dialog.locator('.formula-source summary').click();await latex.fill('\\frac{1}{2}');
    expect(await dialog.locator('math-field').evaluate((field:any)=>field.value)).toBe('\\frac{1}{2}');await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(f.page.locator('.math-block .cm-content')).toHaveText('\\frac{1}{2}');await expect(f.page.locator('.save-status')).toContainText('未保存');expect(await fs.readFile(path.join(f.root,'公式.md'),'utf8')).toBe(source);
    await f.page.keyboard.press('Control+z');await expect(f.page.locator('.math-block .cm-content')).toHaveText('x+1');await f.page.keyboard.press('Control+y');await expect(f.page.locator('.math-block .cm-content')).toHaveText('\\frac{1}{2}');
    await f.page.locator('.save-status').click();await expect.poll(()=>fs.readFile(path.join(f.root,'公式.md'),'utf8')).toContain('   \\frac{1}{2}');expect(f.requests.filter(url=>/^https?:/.test(url))).toEqual([]);
  }finally{await f.close();}
});
test('MathLive edits the clicked inline formula and accepts visual keyboard input without replacing neighboring text',async()=>{
  const f=await fixture();try{
    await f.open('行内公式.md','前 $x$ 中 $y$ 后\n\n尾文');await f.page.locator('.ProseMirror > p').last().click();
    await f.page.locator('.inline-math .math-render').last().click({button:'right'});await f.page.getByRole('menuitem',{name:'公式辅助输入',exact:true}).click();
    const dialog=f.page.getByRole('dialog',{name:'公式',exact:true}),field=dialog.locator('math-field'),latex=dialog.getByLabel('公式 LaTeX',{exact:true});await expect(latex).toHaveValue('y');await expect(field).toBeVisible();
    await field.evaluate((field:any)=>{field.focus();field.executeCommand('selectAll');});await f.page.keyboard.type('1/2');await expect(latex).toHaveValue(/\\frac(?:\{1\}\{2\}|12)/);const inserted=await latex.inputValue();
    await f.page.screenshot({path:path.join(work,'v1055-mathlive.png')});await dialog.getByRole('button',{name:'应用',exact:true}).click();await f.page.getByRole('button',{name:'源码',exact:true}).click();await expect(f.page.locator('.source-editor .cm-content')).toContainText('前 $x$ 中 $'+inserted+'$ 后');
    expect(await fs.readFile(path.join(f.root,'行内公式.md'),'utf8')).toBe('前 $x$ 中 $y$ 后\n\n尾文');
  }finally{await f.close();}
});
test('The formula insert action uses a draft and preserves surrounding prose and undo',async()=>{
  const f=await fixture();try{
    await f.open('插入公式.md','前 后');await f.page.locator('.ProseMirror p').click();await f.page.keyboard.press('Home');await f.page.keyboard.press('ArrowRight');
    await f.page.getByRole('button',{name:'显示格式工具栏',exact:true}).click();await f.page.locator('.formatbar').getByRole('button',{name:'插入',exact:true}).click();await f.page.locator('.popover-menu').getByRole('button',{name:'公式辅助输入',exact:true}).click();
    const dialog=f.page.getByRole('dialog',{name:'公式',exact:true});await expect(dialog.locator('math-field')).toBeVisible();await dialog.locator('.formula-source summary').click();await dialog.getByLabel('公式 LaTeX',{exact:true}).fill('a^2');await dialog.getByRole('button',{name:'应用',exact:true}).click();
    await f.page.getByRole('button',{name:'源码',exact:true}).click();await expect(f.page.locator('.source-editor .cm-content')).toHaveText('前$a^2$ 后');expect(await fs.readFile(path.join(f.root,'插入公式.md'),'utf8')).toBe('前 后');
  }finally{await f.close();}
});
test('Source-mode formula assistance preserves quoted prefixes, CRLF and atomic undo',async()=>{
  const f=await fixture();try{
    const source='前文\r\n\r\n> $$\r\n> x+1\r\n> $$\r\n\r\n尾文';await f.open('源码公式.md',source);await f.page.getByRole('button',{name:'源码',exact:true}).click();
    await f.page.locator('.source-editor .cm-line').filter({hasText:'x+1'}).click();await f.page.getByRole('button',{name:'显示格式工具栏',exact:true}).click();await f.page.locator('.formatbar').getByRole('button',{name:'插入',exact:true}).click();await f.page.locator('.popover-menu').getByRole('button',{name:'公式辅助输入',exact:true}).click();
    const dialog=f.page.getByRole('dialog',{name:'公式',exact:true});await expect(dialog.getByLabel('公式 LaTeX',{exact:true})).toHaveValue('x+1');await expect(dialog.locator('math-field')).toBeVisible();await dialog.locator('.formula-source summary').click();await dialog.getByLabel('公式 LaTeX',{exact:true}).fill('a+b\nc');await dialog.getByRole('button',{name:'应用',exact:true}).click();
    await expect.poll(async()=> (await f.page.locator('.source-editor .cm-line').allTextContents()).join('\n')).toContain('> a+b\n> c');await f.page.keyboard.press('Control+z');await expect(f.page.locator('.source-editor .cm-content')).toContainText('x+1');await f.page.keyboard.press('Control+y');await f.page.locator('.save-status').click();await expect.poll(()=>fs.readFile(path.join(f.root,'源码公式.md'),'utf8')).toBe(source.replace('> x+1','> a+b\r\n> c'));
  }finally{await f.close();}
});
test('Drawing selection outlines its actual SVG rather than the full paragraph width',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>window.moyu!.feature('drawing.create',{path:'图.excalidraw'}));await f.open('选图.md','前文\n\n[图|180](图.excalidraw)\n\n尾文');const overlay=f.page.locator('.attachment-overlay'),svg=overlay.locator('svg');await expect(svg).toBeVisible();
    await f.page.locator('.ProseMirror p').last().click();await f.page.keyboard.press('Control+a');await expect(overlay).toHaveClass(/range-selected/);await expect(overlay).toHaveCSS('outline-style','none');await expect(svg).toHaveCSS('outline-width','2px');expect((await svg.boundingBox())!.width).toBeLessThan((await overlay.boundingBox())!.width/2);
    await f.page.keyboard.press('Control+c');expect(await f.app.evaluate(({clipboard})=>clipboard.readText())).toContain('[图|180](图.excalidraw)');
  }finally{await f.close();}
});
test('All tracks initially means all tracks; selection, notation and audio stay consistent after layout changes',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const bars='<measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>';
    const xml='<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Alpha</part-name></score-part><score-part id="P2"><part-name>Beta</part-name></score-part></part-list><part id="P1">'+bars+'</part><part id="P2">'+bars+'</part></score-partwise>';
    await fs.writeFile(path.join(f.root,'双轨.musicxml'),xml);await f.open('音轨.md','前文\n\n[乐谱](双轨.musicxml)\n\n尾文');const card=f.page.locator('[data-preview-kind=score]'),sheet=card.locator('.attachment-score-sheet');await card.scrollIntoViewIfNeeded();await expect(sheet).toContainText('Alpha',{timeout:60000});await expect(sheet).toContainText('Beta');
    const tracks=card.getByLabel('乐谱音轨',{exact:true});await tracks.selectOption('1');await expect(sheet).toContainText('Beta');await expect(sheet).not.toContainText('Alpha');
    await card.getByLabel('乐谱缩放',{exact:true}).selectOption('0.7');await card.getByLabel('乐谱布局',{exact:true}).selectOption('horizontal');await expect(tracks).toHaveValue('1');await expect(sheet).not.toContainText('Alpha');
    await tracks.selectOption('0');await expect(sheet).toContainText('Alpha');await expect(sheet).not.toContainText('Beta');await tracks.selectOption('all');await expect(sheet).toContainText('Alpha');await expect(sheet).toContainText('Beta');expect(await fs.readFile(path.join(f.root,'双轨.musicxml'),'utf8')).toBe(xml);
  }finally{await f.close();}
});
test('Official Worklet playback has an audible signal, seekable progress, volume and safe fast stop/disposal',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    await f.page.evaluate(()=>{
      const state=(window as any).__audio={worklets:0,scriptProcessors:0,peak:0,analyser:null};
      const Context=window.AudioContext;(window as any).AudioContext=new Proxy(Context,{construct(Target,args){const ctx=Reflect.construct(Target,args) as AudioContext;const add=ctx.audioWorklet.addModule.bind(ctx.audioWorklet);ctx.audioWorklet.addModule=async(...args:Parameters<typeof add>)=>{await new Promise(resolve=>setTimeout(resolve,200));return add(...args);};const script=ctx.createScriptProcessor.bind(ctx);ctx.createScriptProcessor=(...args)=>{state.scriptProcessors++;return script(...args);};return ctx;}});
      const Worklet=window.AudioWorkletNode;(window as any).AudioWorkletNode=new Proxy(Worklet,{construct(Target,args){const node=Reflect.construct(Target,args) as AudioWorkletNode;if(args[1]==='alphatab'){state.worklets++;const ctx=args[0] as AudioContext,analyser=ctx.createAnalyser();analyser.fftSize=2048;node.connect(analyser);analyser.connect(ctx.createMediaStreamDestination());state.analyser=analyser;}return node;}});
    });
    const tune='\\title "Playback"\n\\tempo 120\n.\n'+Array.from({length:8},()=>':8 0.1 1.1 2.1 3.1 0.1 1.1 2.1 3.1 |').join('\n');await fs.writeFile(path.join(f.root,'播放.alphatex'),tune);const source='前文\n\n[乐谱](播放.alphatex)\n\n尾文';await f.open('播放.md',source);
    const card=f.page.locator('[data-preview-kind=score]');await card.scrollIntoViewIfNeeded();await card.getByRole('button',{name:'播放乐谱',exact:true}).click();await expect(card.getByRole('button',{name:'暂停乐谱',exact:true})).toBeEnabled({timeout:45000});await stopScore(f.page,card);
    await card.getByRole('button',{name:'播放乐谱',exact:true}).click();await expect.poll(()=>f.page.evaluate(()=>{const state=(window as any).__audio;if(!state.analyser)return 0;const samples=new Float32Array(2048);state.analyser.getFloatTimeDomainData(samples);state.peak=Math.max(state.peak,...samples.map(Math.abs));return state.peak;}),{timeout:15000}).toBeGreaterThan(0.001);
    const progress=card.getByRole('slider',{name:'播放位置',exact:true});await expect(progress).toBeEnabled();expect(await f.page.evaluate(()=>(window as any).__audio.scriptProcessors)).toBe(0);expect(await f.page.evaluate(()=>(window as any).__audio.peak)).toBeLessThan(0.999);
    await progress.evaluate((input:HTMLInputElement)=>{input.value='5000';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});await expect(card.getByLabel('播放进度',{exact:true})).toContainText('0:05 /');await expect(card.locator('.at-cursor-beat')).toBeAttached();await expect.poll(async()=> (await card.locator('.at-cursor-beat').boundingBox())?.width||0).toBeCloseTo(3,0);
    await card.getByRole('button',{name:'播放选项',exact:true}).click();await card.getByRole('slider',{name:'乐谱音量',exact:true}).evaluate((input:HTMLInputElement)=>{input.value='40';input.dispatchEvent(new Event('input',{bubbles:true}));});await f.page.keyboard.press('Escape');await card.getByLabel('乐谱缩放',{exact:true}).selectOption('0.7');await expect.poll(async()=>Number(await progress.inputValue()),{timeout:10000}).toBeGreaterThan(5000);
    await f.page.screenshot({path:path.join(work,'v1055-score-player.png')});await stopScore(f.page,card);await card.getByRole('button',{name:'播放乐谱',exact:true}).click();await f.page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();await f.page.waitForTimeout(400);
    expect(await fs.readFile(path.join(f.root,'播放.md'),'utf8')).toBe(source);expect(f.requests.filter(url=>/^https?:/.test(url))).toEqual([]);
  }finally{await f.close();}
});

test('Formula stays compact in a small window; keyboard, optional source and shortcut remain usable',async()=>{
  const f=await fixture();try{
    await f.app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(600,400);window.setSize(860,620);});
    await f.open('公式布局.md','$$\nx+1\n$$');await f.page.getByRole('button',{name:'切换主题',exact:true}).click();
    await f.page.getByRole('button',{name:'公式辅助输入',exact:true}).click();const dialog=f.page.getByRole('dialog',{name:'公式',exact:true}),field=dialog.locator('math-field'),source=dialog.getByLabel('公式 LaTeX',{exact:true});
    await expect(field).toBeVisible();await expect(source).toBeHidden();await expect(dialog.getByText(/块公式|行内公式/)).toHaveCount(0);await expect(dialog.locator('[part=virtual-keyboard-toggle]')).toHaveCount(1);
    // A native menu accelerator must not switch the backing editor out from
    // under a modal draft owned by a separate component.
    await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('moyu:command','mode'));
    await f.page.screenshot({path:path.join(work,'v1055-formula-compact.png')});
    await field.locator('[part=virtual-keyboard-toggle]').click();await expect.poll(async()=> (await dialog.locator('.formula-keyboard').boundingBox())?.height||0).toBeGreaterThan(150);
    const bottom=await dialog.getByRole('button',{name:'应用',exact:true}).boundingBox();expect(bottom!.y+bottom!.height).toBeLessThan(await f.page.evaluate(()=>innerHeight));
    await f.page.screenshot({path:path.join(work,'v1055-formula-small-keyboard.png')});
    await field.locator('[part=virtual-keyboard-toggle]').click();await dialog.locator('summary').focus();await f.page.keyboard.press('Space');await expect(source).toBeVisible();await source.fill('x^2');await source.press('Control+Enter');await expect(dialog).toHaveCount(0);
    await expect(f.page.locator('.math-block .cm-content')).toHaveText('x^2');await f.page.keyboard.press('Control+z');await expect(f.page.locator('.math-block .cm-content')).toHaveText('x+1');expect(await fs.readFile(path.join(f.root,'公式布局.md'),'utf8')).toBe('$$\nx+1\n$$');
  }finally{await f.close();}
});

test('Score controls fit narrow previews and native options dismiss without changing editor content',async()=>{
  const f=await fixture();try{
    await fs.writeFile(path.join(f.root,'界面.alphatex'),'\\title "UI"\n\\tempo 120\n.\n:4 0.1 1.1 2.1 3.1 |');
    const source='1. 列表\n\n   [乐谱|240](界面.alphatex)\n\n[乐谱|320](界面.alphatex)\n\n[乐谱|640](界面.alphatex)\n\n尾文';await f.open('乐谱布局.md',source);
    const cards=f.page.locator('[data-preview-kind=score]');await expect(cards).toHaveCount(3);
    for(let i=0;i<3;i++){
      const card=cards.nth(i);await card.scrollIntoViewIfNeeded();await expect(card.locator('.attachment-score-sheet svg').first()).toBeVisible({timeout:45000});
      const viewport=card.locator('.attachment-score-viewport');await expect(viewport).toHaveAttribute('style',/height:/);
      expect(await viewport.evaluate(host=>host.clientHeight)).toBeLessThanOrEqual(400);
      const sheetBounds=(await viewport.boundingBox())!,transportBounds=(await card.locator('.score-transport').boundingBox())!,toolbarBounds=(await card.locator('.score-controls').boundingBox())!;
      expect(transportBounds.y+transportBounds.height).toBeLessThanOrEqual(sheetBounds.y+1);expect(transportBounds.y).toBe(toolbarBounds.y);expect(toolbarBounds.y+toolbarBounds.height).toBeLessThanOrEqual(sheetBounds.y+1);
      expect(await card.locator('.score-player').evaluate(host=>{const bounds=host.getBoundingClientRect();return [...host.querySelectorAll('.score-transport>*,.score-controls>*')].every(control=>{const rect=control.getBoundingClientRect();return !control.getClientRects().length||rect.left>=bounds.left-1&&rect.right<=bounds.right+1;});})).toBe(true);
      const more=card.getByRole('button',{name:'播放选项',exact:true}),options=card.getByRole('dialog',{name:'播放选项',exact:true});await expect(options).toBeHidden();await more.focus();await more.press('Enter');await expect(options).toBeVisible();await expect(more).toHaveAttribute('aria-expanded','true');await expect(options.getByRole('slider',{name:'乐谱音量',exact:true})).toBeFocused();
      const bounds=(await options.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(await f.page.evaluate(()=>innerWidth));expect(bounds.y+bounds.height).toBeLessThanOrEqual(await f.page.evaluate(()=>innerHeight));
      const looping=await options.getByRole('button',{name:'循环播放',exact:true}).getAttribute('aria-pressed');await options.getByRole('button',{name:'循环播放',exact:true}).click();await expect(options.getByRole('button',{name:'循环播放',exact:true})).toHaveAttribute('aria-pressed',String(looping!=='true'));
      await f.page.screenshot({path:path.join(work,'v1055-score-width-'+[240,320,640][i]+'.png')});await f.page.keyboard.press('Escape');await expect(options).toBeHidden();await expect(more).toBeFocused();await expect(more).toHaveAttribute('aria-expanded','false');
      await more.click();await expect(options).toBeVisible();await f.page.locator('.ProseMirror > p').last().click();await expect(options).toBeHidden();
      if(i===2){
        const handle=card.getByRole('separator',{name:'调整乐谱视窗高度',exact:true});await handle.scrollIntoViewIfNeeded();const initial=(await viewport.boundingBox())!,grip=(await handle.boundingBox())!;await f.page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await f.page.mouse.down();await f.page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2+48,{steps:5});await f.page.mouse.up();
        await expect.poll(async()=> (await viewport.boundingBox())!.height).toBeGreaterThan(initial.height+20);const resized=(await viewport.boundingBox())!.height;await card.getByLabel('乐谱缩放',{exact:true}).selectOption('0.7');await expect.poll(async()=> (await viewport.boundingBox())!.height).toBeCloseTo(resized,0);
        await f.page.getByRole('button',{name:'切换主题',exact:true}).click();await more.click();await expect(options).toBeVisible();await f.page.screenshot({path:path.join(work,'v1055-score-light.png')});await f.page.keyboard.press('Escape');
      }
    }
    await expect(f.page.locator('.save-status')).not.toContainText('未保存');expect(await fs.readFile(path.join(f.root,'乐谱布局.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});

test('Formula insertion in ordinary code gives actionable feedback without changing the code',async()=>{
  const f=await fixture();try{
    const source='```javascript {id=0001}\nconst x = 1;\n```';await f.open('非公式.md',source);await f.page.locator('.milkdown-code-block .cm-content').click();
    await f.page.getByRole('button',{name:'显示格式工具栏',exact:true}).click();await f.page.locator('.formatbar').getByRole('button',{name:'插入',exact:true}).click();await f.page.locator('.popover-menu').getByRole('button',{name:'公式辅助输入',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'公式',exact:true})).toHaveCount(0);await expect(f.page.locator('.toast')).toHaveText('请将光标放在正文或公式中。');await expect(f.page.locator('.milkdown-code-block .cm-content')).toHaveText('const x = 1;');expect(await fs.readFile(path.join(f.root,'非公式.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('Formula actions share a wrapping toolbar and survive preview toggles, scrolling and editor remounts',async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='前文\n\n$$\nx+1\n$$\n\n'+Array.from({length:40},(_,i)=>'占位段落 '+i).join('\n\n')+'\n\n末尾';await f.open('公式工具条.md',source);
    const card=f.page.locator('.math-block'),group=card.locator('.tools-button-group'),assist=group.getByRole('button',{name:'公式辅助输入',exact:true});
    await expect(assist).toBeVisible();await expect(group.locator(':scope > button')).toHaveCount(3);
    // Focused/selected code may intentionally stay mounted while off-screen.
    // Assert the user-facing scroll behavior, then exercise a real editor remount.
    await f.page.locator('.ProseMirror > p').last().click();await expect.poll(async()=>{const box=(await card.boundingBox())!;return box.y+box.height;}).toBeLessThan(0);
    await card.scrollIntoViewIfNeeded();await expect(assist).toBeVisible();await expect(group.locator('.formula-assist-trigger')).toHaveCount(1);
    const aligned=()=>card.evaluate(card=>{
      const outer=card.getBoundingClientRect(),header=card.querySelector('.tools')!.getBoundingClientRect(),buttons=[...card.querySelectorAll('.tools-button-group > button')].map(button=>button.getBoundingClientRect());
      return buttons.every(button=>button.left>=outer.left-1&&button.right<=outer.right+1&&button.bottom<=header.bottom+1)&&buttons.every((a,i)=>buttons.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1));
    });
    for(const zoom of [1,1.5]){
      await f.app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
      for(const width of [180,240,360,748])for(const font of [12,24]){
        await card.evaluate((card,{width,font})=>{card.style.width=width+'px';card.style.maxWidth='100%';card.style.fontSize=font+'px';},{width,font});
        await expect.poll(aligned).toBe(true);
      }
      await card.locator('.preview-toggle-button').click();await expect(assist).toBeVisible();await card.locator('.preview-toggle-button').click();await expect(group.locator('.formula-assist-trigger')).toHaveCount(1);
    }
    await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));await card.evaluate(card=>{card.style.width='240px';card.style.fontSize='';});await card.scrollIntoViewIfNeeded();await f.page.screenshot({path:path.join(work,'v1056-formula-toolbar.png')});
    await f.page.getByRole('button',{name:'切换主题',exact:true}).click();await expect.poll(aligned).toBe(true);await f.page.screenshot({path:path.join(work,'v1056-formula-toolbar-light.png')});
    await assist.click();const dialog=f.page.getByRole('dialog',{name:'公式',exact:true});await expect(dialog.locator('math-field')).toBeVisible();await expect(dialog.getByLabel('公式 LaTeX',{exact:true})).toHaveValue('x+1');await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await f.page.getByRole('button',{name:'源码',exact:true}).click();await f.page.getByRole('button',{name:'预览编辑',exact:true}).click();await card.scrollIntoViewIfNeeded();await expect(assist).toBeVisible();
    await expect(group.locator('.formula-assist-trigger')).toHaveCount(1);await expect.poll(aligned).toBe(true);await expect(f.page.locator('.save-status')).not.toContainText('未保存');expect(await fs.readFile(path.join(f.root,'公式工具条.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
