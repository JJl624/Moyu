import {stopScore} from './attachment-helper';
import {attachmentFixture as fixture,previewRefs as refs} from './helpers/attachment-fixture';
import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),documents=require('./fixtures/preview-documents.cjs');
const project=path.resolve(import.meta.dirname,'..');
test('Folder create actions disappear after pointer activation and remain accessible by keyboard',async()=>{
  const f=await fixture();try{
    for(const name of ['甲目录','乙目录'])await f.page.evaluate(name=>window.moyu!.create(name,'folder'),name);
    const row=f.page.locator('[data-tree-path="甲目录"]'),actions=row.locator('.tree-create');
    await row.hover();await expect(actions).toBeVisible();await row.locator('.tree-item').click();
    await f.page.locator('.ProseMirror').hover();await expect(actions).toBeHidden();
    await row.hover();await row.getByRole('button',{name:'在 甲目录 下新建文档',exact:true}).click();
    await f.page.locator('.file-name-form input').fill('新笔记');await f.page.locator('.file-name-form input').press('Enter');
    await f.page.locator('[data-tree-path="乙目录"] .tree-item').click();await f.page.locator('.ProseMirror').hover();await expect(actions).toBeHidden();
    await row.locator('.tree-item').focus();await f.page.keyboard.press('Tab');await expect(row.getByRole('button',{name:'在 甲目录 下新建文档',exact:true})).toBeFocused();await expect(actions).toBeVisible();
  }finally{await f.close();}
});

test('Image and drawing context outlines use only the actual media, including nested blocks and preserved selections',async()=>{
  const f=await fixture();try{
    const source='前文\n\n'+refs.slice(0,2).map(([,raw])=>raw).join('\n\n')+'\n\n1. 列表\n\n   ![列表图|90](图片.svg)\n\n> [引用图|100](图.excalidraw)\n\n尾文';await f.note('右键边框.md',source);
    const tail=f.page.locator('.ProseMirror > p').last(),overlays=f.page.locator('.attachment-overlay');await tail.click();await expect(overlays).toHaveCount(4);
    for(const overlay of await overlays.all()){
      const media=overlay.locator('.attachment-preview-body > :is(img,svg)'),caption=overlay.locator('.attachment-preview-caption');await media.scrollIntoViewIfNeeded();await expect(media).toBeVisible();
      const before=await media.boundingBox();await media.click({button:'right'});await expect(f.page.getByRole('menuitem',{name:'编辑引用',exact:true})).toBeVisible();
      await expect(overlay).toHaveClass(/context-target/);await expect(overlay).toHaveCSS('outline-style','none');await expect(overlay).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(media).toHaveCSS('outline-width','1px');await expect(media).toHaveCSS('outline-style','solid');await expect(caption).toHaveCSS('outline-style','none');
      expect((await overlay.boundingBox())!.width).toBeGreaterThan(before!.width+20);expect(await media.boundingBox()).toEqual(before);await expect(f.page.locator('.visual-attachment.editing')).toHaveCount(0);
      await f.page.keyboard.press('Escape');await expect(overlay).not.toHaveClass(/context-target/);await expect(media).toHaveCSS('outline-style','none');
      await media.click({button:'right'});await tail.click();await expect(f.page.getByRole('menu')).toHaveCount(0);await expect(media).toHaveCSS('outline-style','none');
    }
    await tail.click();await f.page.keyboard.press('Control+a');const first=overlays.first(),media=first.locator('.attachment-preview-body > img');await expect(first).toHaveClass(/range-selected/);await expect(media).toHaveCSS('outline-width','2px');
    await media.click({button:'right'});await expect(first).toHaveClass(/context-target/);await expect(first).toHaveCSS('outline-style','none');await expect(media).toHaveCSS('outline-width','1px');await f.page.screenshot({path:path.resolve(project,'../../work/v1058-image-context.png')});
    await f.page.keyboard.press('Escape');await expect(first).toHaveClass(/range-selected/);await expect(media).toHaveCSS('outline-width','2px');
    await tail.click();expect(await fs.readFile(path.join(f.root,'右键边框.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});
test('All media use name links inline and centered block previews; hidden captions reveal on hover without reflow',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='开头 '+refs.map(([,raw])=>raw).join(' 中间 ')+' 结束\n\n'+refs.map(([,raw])=>raw).join('\n\n')+'\n\n尾文';await f.note('统一.md',source);
    const first=f.page.locator('.ProseMirror > p').first();await expect(first.locator('.visual-attachment')).toHaveCount(0);await expect(first.locator('a')).toHaveCount(4);await expect(first).toContainText('图片');
    await first.locator('a').first().click();await expect(first.locator('.attachment-raw:visible')).toHaveText(refs[0][1]);await f.page.locator('.ProseMirror > p').last().click();
    for(const [kind]of refs){const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await card.scrollIntoViewIfNeeded();await expect(card.locator(kind==='pdf'?'img':kind==='image'?'img':kind==='score'?'.attachment-score-sheet svg':'svg').first()).toBeVisible({timeout:60000});await expect(card.locator('.attachment-preview-caption')).toBeVisible();}
    const captions=f.page.locator('.attachment-overlay .attachment-preview-caption');expect(await captions.allTextContents()).toEqual(['图片','绘图','资料','乐谱']);
    expect(await captions.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).userSelect==='none'&&node.tagName==='BUTTON'&&node.getAttribute('contenteditable')!=='true'))).toBe(true);
    const image=f.page.locator('.attachment-overlay [data-preview-kind=image]');await image.scrollIntoViewIfNeeded();await expect(image.locator('img')).toHaveCSS('width','90px');
    const centered=await image.evaluate(card=>{const image=card.querySelector('img')!,outer=card.getBoundingClientRect(),inner=image.getBoundingClientRect();return Math.abs((outer.left+outer.right-inner.left-inner.right)/2);});expect(centered).toBeLessThan(2);
    await f.page.getByRole('button',{name:'偏好设置',exact:true}).click();await f.page.locator('.pref-tabs').getByRole('button',{name:'界面',exact:true}).click();
    const before=await image.boundingBox();
    await f.page.getByRole('switch',{name:'显示附件预览名称',exact:true}).click();await f.page.getByRole('button',{name:'关闭对话框',exact:true}).click();await f.page.locator('.ProseMirror > p').last().hover();await expect(captions.first()).toHaveCSS('opacity','0');
    await image.hover();await expect(captions.first()).toHaveCSS('opacity','1');expect((await image.boundingBox())!.height).toBe(before!.height);
    await f.page.locator('.ProseMirror > p').last().hover();await expect(captions.first()).toHaveCSS('opacity','0');
    await image.focus();await expect(captions.first()).toHaveCSS('opacity','1');await f.page.keyboard.press('Space');await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);await f.edit(image);await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveText(refs[0][1]);await f.page.locator('.ProseMirror > p').last().click();
    await f.page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();await expect(f.page.locator('.reading-view p').first().locator('[data-preview-kind]')).toHaveCount(0);await expect(f.page.locator('.reading-view [data-preview-kind]')).toHaveCount(4);
    const reading=f.page.locator('.reading-view [data-preview-kind=image]'),readCaption=reading.locator('.attachment-preview-caption');await f.page.locator('.reading-view p').first().hover();await expect(readCaption).toHaveCSS('opacity','0');await reading.hover();await expect(readCaption).toHaveCSS('opacity','1');await expect(reading.locator('button')).toHaveCount(0);expect(await fs.readFile(path.join(f.root,'统一.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('Single clicks select previews; captions and context menus edit references, and gaps and real empty lines remain independent',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='前文\n\n'+refs.map(([,raw])=>raw+'\n\n<br />').join('\n\n')+'\n\n尾文';await f.note('点击边界.md',source);
    await f.page.addStyleTag({content:'.ProseMirror p:has(.block-attachment){margin-bottom:36px!important}'});
    const tail=f.page.locator('.ProseMirror > p').last();await tail.click();
    for(const [kind,raw]of refs){
      const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await card.scrollIntoViewIfNeeded();await expect(card.locator(kind==='score'?'.attachment-score-sheet svg':kind==='drawing'?'svg':'img').first()).toBeVisible({timeout:60000});
      const body=card.locator('.attachment-preview-body');
      // PDF and score bodies contain their own controls, images/drawings do not.
      await body.click();
      await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);
      const owner=f.page.locator('.block-attachment').filter({hasText:raw});
      const p=owner.locator('xpath=ancestor::p[1]');await expect(p).toHaveCount(1);
      await card.scrollIntoViewIfNeeded();const box=(await card.boundingBox())!;
      await f.page.mouse.click(box.x+box.width/2,box.y+box.height+6);
      await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);
      const empty=p.locator('xpath=following-sibling::p[1]');await empty.click();
      await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);
      const caret=await empty.evaluate(p=>{const s=getSelection();return !!s?.isCollapsed&&!!s.focusNode&&p.contains(s.focusNode);});expect(caret).toBe(true);
      await card.locator('.attachment-preview-caption').click();
      await expect(owner.locator('.attachment-raw')).toBeVisible();await expect(owner.locator('.attachment-raw')).toHaveText(raw);
      const nameStart=raw.startsWith('![')?2:1;
      const caretPrefix=()=>owner.locator('.syntax-raw').evaluate(e=>{const s=getSelection();if(!s?.isCollapsed||!s.focusNode||!e.contains(s.focusNode))return null;const r=document.createRange();r.selectNodeContents(e);r.setEnd(s.focusNode,s.focusOffset);return r.toString();});
      await expect.poll(caretPrefix).toBe(raw.slice(0,nameStart));
      await tail.click();await card.scrollIntoViewIfNeeded();await card.locator('.attachment-preview-caption').focus();await f.page.keyboard.press('Enter');await expect(owner.locator('.attachment-raw')).toBeVisible();await expect.poll(caretPrefix).toBe(raw.slice(0,nameStart));
      await tail.click();await card.scrollIntoViewIfNeeded();await card.click({button:'right'});await f.page.getByRole('menuitem',{name:'编辑引用',exact:true}).focus();await f.page.keyboard.press('Enter');await expect(owner.locator('.attachment-raw')).toBeVisible();
      await tail.click();
    }
    expect(await fs.readFile(path.join(f.root,'点击边界.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('List and quote attachment footers stay compact; empty alt has an editing entry and keyboard navigation still reveals source',async()=>{
  const f=await fixture();try{
    const source='前文\n\n1. 列表\n\n   ![](图片.svg)\n\n   <br />\n\n> ![引图](图片.svg)\n>\n> <br />\n\n尾文';await f.note('嵌套附件.md',source);
    const tail=f.page.locator('.ProseMirror > p').last();await tail.click();
    const cards=f.page.locator('.attachment-overlay [data-preview-kind=image]');await expect(cards).toHaveCount(2);
    await expect(cards.first().locator('.attachment-preview-caption')).toHaveText('图片.svg');
    for(const [index,selector]of ['.ProseMirror li .block-attachment','.ProseMirror blockquote .block-attachment'].entries()){
      const card=cards.nth(index),owner=f.page.locator(selector),p=owner.locator('xpath=ancestor::p[1]');await card.scrollIntoViewIfNeeded();
      await expect(card.locator('img')).toBeVisible();await expect(card.locator('.attachment-caption-slot')).toHaveCSS('height','26px');
      await expect.poll(async()=>Math.abs((await p.boundingBox())!.height-(await card.boundingBox())!.height)).toBeLessThan(2);
      await card.locator('img').click();await expect(owner.locator('.syntax-raw')).toBeHidden();
      const empty=p.locator('xpath=following-sibling::p[1]');await empty.click();await expect(owner.locator('.syntax-raw')).toBeHidden();
      await f.page.keyboard.press('ArrowUp');await expect(owner.locator('.syntax-raw')).toBeVisible();
      await tail.click();await card.scrollIntoViewIfNeeded();await card.locator('.attachment-preview-caption').click();
      await expect.poll(()=>owner.locator('.syntax-raw').evaluate(e=>{const s=getSelection();if(!s?.isCollapsed||!s.focusNode||!e.contains(s.focusNode))return null;const r=document.createRange();r.selectNodeContents(e);r.setEnd(s.focusNode,s.focusOffset);return r.toString();})).toBe('![');
      await f.page.keyboard.insertText('新');await expect(owner.locator('.syntax-raw')).toHaveText(index===0?'![新](图片.svg)':'![新引图](图片.svg)');await f.page.keyboard.press('Control+z');await expect(owner.locator('.syntax-raw')).toHaveText(index===0?'![](图片.svg)':'![引图](图片.svg)');
      await tail.click();await f.edit(card);await expect(owner.locator('.syntax-raw')).toBeVisible();await tail.click();
    }
    await cards.first().scrollIntoViewIfNeeded();await f.page.screenshot({path:path.resolve(project,'../../work/v1057-caption-ui.png')});
    expect(await fs.readFile(path.join(f.root,'嵌套附件.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('Dragging from a preview or its caption selects Markdown without activating reference editing',async()=>{
  const f=await fixture();try{
    const source='开始\n\n![一](图片.svg)\n\n中间\n\n![二](图片.svg)\n\n结束';await f.note('附件起拖.md',source);
    const cards=f.page.locator('.attachment-overlay [data-preview-kind=image]'),tail=f.page.locator('.ProseMirror > p').last();
    await expect(cards.locator('img')).toHaveCount(2);await tail.click();
    for(const selector of ['img','.attachment-preview-caption']){
      const target=cards.first().locator(selector);await target.scrollIntoViewIfNeeded();const start=(await target.boundingBox())!,end=(await tail.boundingBox())!;
      await f.page.mouse.move(start.x+start.width/2,start.y+start.height/2);await f.page.mouse.down();
      await f.page.mouse.move(start.x+start.width/2+6,start.y+start.height/2,{steps:2});
      await expect(f.page.locator('.visual-attachment.editing')).toHaveCount(0);
      await f.page.mouse.move(end.x+18,end.y+end.height/2,{steps:16});await f.page.mouse.up();
      await expect(f.page.locator('.attachment-overlay.range-selected')).toHaveCount(2);await expect(f.page.locator('.visual-attachment.editing')).toHaveCount(0);
      await f.page.keyboard.press('Control+c');const copied=await f.app.evaluate(({clipboard})=>clipboard.readText());expect(copied).toContain('![一](图片.svg)');expect(copied).toContain('![二](图片.svg)');expect(copied.replace('![一](图片.svg)','').replace('![二](图片.svg)','')).not.toMatch(/[一二]/);await tail.click();
    }
    expect(await fs.readFile(path.join(f.root,'附件起拖.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
test('Inline PDF controls read the full file, remember pages across mode changes and reopening, and never edit the note',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='前文\n\n[资料](资料.pdf)\n\n尾文';await f.note('PDF.md',source);
    const reader=f.page.locator('.attachment-overlay .attachment-pdf-viewport');await expect(reader.locator('img').first()).toBeVisible({timeout:60000});
    const pageInput=reader.locator('input:not([type=file])').last();await expect(pageInput).toHaveValue('1');await reader.getByRole('button',{name:'下一页',exact:true}).click();await expect(pageInput).toHaveValue('2');
    await reader.getByRole('button',{name:'放大',exact:true}).click();await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
    await reader.click({button:'right'});await expect(f.page.getByRole('menuitem',{name:'查看 PDF',exact:true})).toBeVisible();await f.page.keyboard.press('Escape');
    await f.page.getByRole('button',{name:'阅读',exact:true}).click();const read=f.page.locator('.reading-view .attachment-pdf-viewport');await expect(read.locator('img').first()).toBeVisible({timeout:60000});await expect(read.locator('input:not([type=file])').last()).toHaveValue('2');
    await f.page.getByRole('button',{name:'源码',exact:true}).click();await f.page.getByRole('button',{name:'阅读',exact:true}).click();await expect(read.locator('input:not([type=file])').last()).toHaveValue('2',{timeout:60000});
    expect(await fs.readFile(path.join(f.root,'PDF.md'),'utf8')).toBe(source);expect(await fs.stat(path.join(f.root,'PDF.assets/attachments')).catch(()=>null)).toBeNull();
    await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(path.join(f.root,'PDF.assets/document.json'),'utf8')).attachmentViews?.['资料.pdf']?.pdfPage;}catch{return null;}}).toBe(2);
    await f.page.screenshot({path:path.resolve(project,'../../work/v1053-pdf-controls.png')});
    await f.app.evaluate(({app})=>app.exit(0));
    const env={...process.env,MOYU_USER_DATA:f.data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
    const reopened=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
    try{const page=await reopened.firstWindow();page.on('pageerror',error=>f.errors.push(error.message));await page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();const reader=page.locator('.reading-view .attachment-pdf-viewport');await expect(reader.locator('input:not([type=file])').last()).toHaveValue('2',{timeout:60000});}
    finally{await reopened.evaluate(({app})=>app.exit(0)).catch(()=>{});}
  }finally{await f.close();}
});

test('PDF preview contains reading actions only and Ctrl-wheel changes PDF zoom by exactly five percentage points',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='前文\n\n[资料](资料.pdf)\n\n尾文';await f.note('PDF精简.md',source);
    for(const mode of ['预览编辑','阅读']){
      await f.page.getByRole('button',{name:mode,exact:true}).click();const reader=f.page.locator(mode==='阅读'?'.reading-view embedpdf-container':'.attachment-overlay embedpdf-container');await expect(reader.locator('img').first()).toBeVisible({timeout:60000});
      const disabled=await reader.evaluate(async(element:any)=>{const r=await element.registry,c=r.getPlugin('commands').provides();return ['document:fullscreen','document:protect','document:close','document:print','document:export'].map(id=>({id,disabled:c.resolve(id).disabled}));});expect(disabled.every(command=>command.disabled)).toBe(true);
      await expect(reader.getByRole('button',{name:'菜单',exact:true})).toHaveCount(0);
      const zoom=()=>reader.evaluate(async(element:any)=>(await element.registry).getPlugin('zoom').provides().getState().currentZoomLevel);
      const appZoom=await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
      for(const delta of [-120,600,-1]){
        const before=await zoom();await reader.scrollIntoViewIfNeeded();const bounds=(await reader.boundingBox())!;await f.page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await f.page.keyboard.down('Control');try{await f.page.mouse.wheel(0,delta);}finally{await f.page.keyboard.up('Control');}
        await expect.poll(zoom).toBeCloseTo(before+(delta<0?.05:-.05),2);await f.page.waitForTimeout(220);expect(await zoom()).toBeCloseTo(before+(delta<0?.05:-.05),2);
      }
      expect(await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(appZoom);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
    }
    expect(await fs.readFile(path.join(f.root,'PDF精简.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
for(const [kind,raw]of refs)test(`Undo and redo around ${kind} restore a visible source caret rather than leaving it in the preview`,async()=>{
  test.setTimeout(90000);const f=await fixture();try{
    const source='前文\n\n'+raw+'\n\n尾文';await f.note('撤销.md',source);
    const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await expect(card).toBeVisible({timeout:30000});await f.edit(card);
    await f.page.keyboard.press('Home');await f.page.keyboard.insertText('左');await f.page.keyboard.press('End');await f.page.keyboard.insertText('右');
    await f.page.keyboard.press('Control+z');await f.page.keyboard.press('Control+z');
    const rawView=f.page.locator('.ProseMirror .attachment-raw:visible');await expect(rawView).toHaveText(raw);
    const caret=await rawView.evaluate(raw=>{const selection=getSelection();if(!selection?.rangeCount||!selection.isCollapsed)return null;const range=selection.getRangeAt(0).cloneRange();range.collapse(true);const caret=range.getBoundingClientRect(),rect=raw.getBoundingClientRect(),node=selection.focusNode,element=node instanceof Element?node:node?.parentElement;return {caret:{x:caret.x,y:caret.y,height:caret.height},raw:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom},invalid:!!element?.closest('.attachment-space,.syntax-preview')};});
    expect(caret).not.toBeNull();expect(caret!.invalid).toBe(false);expect(caret!.caret.height).toBeGreaterThan(0);expect(caret!.caret.y).toBeGreaterThanOrEqual(caret!.raw.y-2);expect(caret!.caret.y).toBeLessThan(caret!.raw.bottom+2);
    await f.page.keyboard.press('Control+y');await f.page.keyboard.press('Control+z');await f.page.locator('.ProseMirror > p').last().click();await expect(card).toBeVisible();
    expect(await fs.readFile(path.join(f.root,'撤销.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
test('Dragging across all preview kinds keeps previews highlighted and copies Markdown without captions or controls',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const source='开始\n\n'+refs.map(([,raw])=>raw).join('\n\n')+'\n\n结束';await f.note('拖选.md',source);
    await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1900));
    for(const [kind]of refs){const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await card.scrollIntoViewIfNeeded();await expect(card.locator(kind==='score'?'.attachment-score-sheet svg':kind==='drawing'?'svg':'img').first()).toBeVisible({timeout:60000});}
    const first=f.page.locator('.ProseMirror > p').first(),last=f.page.locator('.ProseMirror > p').last();await first.scrollIntoViewIfNeeded();const a=(await first.boundingBox())!;const b=(await last.boundingBox())!;
    await last.click();
    await f.page.mouse.move(a.x+2,a.y+a.height/2);await f.page.mouse.down();await f.page.mouse.move(b.x+25,b.y+b.height/2,{steps:20});await f.page.mouse.up();
    await expect(f.page.locator('.attachment-overlay.range-selected')).toHaveCount(4);await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);
    await f.page.keyboard.press('Control+c');const copied=await f.app.evaluate(({clipboard})=>clipboard.readText());for(const [,raw]of refs)expect(copied).toContain(raw);expect(copied).not.toMatch(/节拍器|全部音轨|播放速度/);
    await last.click();await f.page.mouse.move(b.x+25,b.y+b.height/2);await f.page.mouse.down();await f.page.mouse.move(a.x+2,a.y+a.height/2,{steps:24});await f.page.mouse.up();await expect(f.page.locator('.attachment-overlay.range-selected')).toHaveCount(4);
    await f.page.keyboard.press('Control+c');const reverse=await f.app.evaluate(({clipboard})=>clipboard.readText());for(const [,raw]of refs)expect(reverse).toContain(raw);
    await f.page.keyboard.press('Backspace');await expect(f.page.locator('.attachment-overlay [data-preview-kind]')).toHaveCount(0);await f.page.keyboard.press('Control+z');await expect(f.page.locator('.attachment-overlay [data-preview-kind]')).toHaveCount(4);
    for(const file of ['图片.svg','图.excalidraw','资料.pdf','乐谱.alphatex'])expect(await fs.stat(path.join(f.root,file))).toBeTruthy();expect(await fs.readFile(path.join(f.root,'拖选.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
test('Score controls zoom, scroll, select tracks and play offline without writing score or note files',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    const bars=Array.from({length:96},(_,i)=>'<measure number="'+(i+1)+'">'+(i?'':'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>')+'<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>').join('');
    const xml='<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>钢琴</part-name></score-part><score-part id="P2"><part-name>吉他</part-name></score-part></part-list><part id="P1">'+bars+'</part><part id="P2">'+bars+'</part></score-partwise>';
    await fs.writeFile(path.join(f.root,'练习.musicxml'),xml);const source='前文\n\n[练习](练习.musicxml)\n\n尾文';await f.note('乐谱控件.md',source);
    const card=f.page.locator('.attachment-overlay [data-preview-kind=score]'),viewport=card.locator('.attachment-score-viewport');await card.scrollIntoViewIfNeeded();await expect(card.locator('.attachment-score-sheet svg').first()).toBeVisible({timeout:60000});
    expect(await viewport.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);await viewport.evaluate(element=>element.scrollTop=element.scrollHeight);expect(await viewport.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    await card.getByLabel('乐谱缩放',{exact:true}).selectOption('0.5');await card.getByLabel('乐谱布局',{exact:true}).selectOption('horizontal');
    await expect.poll(()=>viewport.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
    await card.getByLabel('乐谱音轨',{exact:true}).selectOption('1');await expect(card.getByLabel('乐谱音轨',{exact:true})).toHaveValue('1');
    await card.getByRole('button',{name:'播放选项',exact:true}).click();await card.getByLabel('播放速度',{exact:true}).selectOption('1.25');await card.getByRole('button',{name:'循环播放',exact:true}).click();await card.getByRole('button',{name:'节拍器',exact:true}).click();await f.page.keyboard.press('Escape');
    expect(f.requests.filter(url=>url.includes('soundfont/sonivox'))).toEqual([]);
    await card.getByRole('button',{name:'播放乐谱',exact:true}).click();await expect(card.getByRole('button',{name:'暂停乐谱',exact:true})).toBeEnabled({timeout:45000});
    await expect.poll(()=>card.getByLabel('播放进度',{exact:true}).textContent(),{timeout:10000}).not.toBe('0:00');
    expect(f.requests.some(url=>url.includes('/vendor/alphatab/soundfont/sonivox.sf3'))).toBe(true);await card.getByRole('button',{name:'暂停乐谱',exact:true}).click();await expect(card.getByRole('button',{name:'播放乐谱',exact:true})).toBeVisible();await stopScore(f.page,card);
    await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
    expect(await fs.readFile(path.join(f.root,'练习.musicxml'),'utf8')).toBe(xml);expect(await fs.readFile(path.join(f.root,'乐谱控件.md'),'utf8')).toBe(source);expect(f.requests.filter(url=>/^https?:/.test(url))).toEqual([]);
    await f.page.screenshot({path:path.resolve(project,'../../work/v1053-score-controls.png')});
  }finally{await f.close();}
});

test('Starting another score pauses previous playback and changing mode safely disposes both players',async()=>{
  test.setTimeout(120000);const f=await fixture();try{
    await fs.writeFile(path.join(f.root,'第二.alphatex'),documents.score);
    const source='前文\n\n[甲](乐谱.alphatex)\n\n[乙](第二.alphatex)\n\n尾文';await f.note('双乐谱.md',source);
    const scores=f.page.locator('.attachment-overlay [data-preview-kind=score]');
    await scores.first().scrollIntoViewIfNeeded();await scores.first().getByRole('button',{name:'播放乐谱',exact:true}).click();await expect(scores.first().getByRole('button',{name:'暂停乐谱',exact:true})).toBeEnabled({timeout:45000});
    await expect.poll(()=>scores.first().getByLabel('播放进度',{exact:true}).textContent(),{timeout:10000}).not.toBe('0:00');
    await scores.last().scrollIntoViewIfNeeded();await scores.last().getByRole('button',{name:'播放乐谱',exact:true}).click();await expect(scores.last().getByRole('button',{name:'暂停乐谱',exact:true})).toBeEnabled({timeout:45000});await expect(scores.first().getByRole('button',{name:'播放乐谱',exact:true})).toBeEnabled();
    await f.page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();await expect(f.page.locator('.reading-view [data-preview-kind=score]')).toHaveCount(2);await expect(f.page.locator('.reading-view [data-playing=true]')).toHaveCount(0);
    expect(await fs.readFile(path.join(f.root,'双乐谱.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
