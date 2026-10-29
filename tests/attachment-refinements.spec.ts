import {test,expect} from './helpers/test';
import {attachmentFixture} from './helpers/attachment-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Image viewer resizes, remembers its document window, stays within the pane, and does not edit the note',async()=>{
  const f=await attachmentFixture();try{
    const source='前文\n\n![图片](图片.svg)\n\n[绘图](图.excalidraw)\n\n尾文';await f.note('窗口.md',source);await f.page.locator('.ProseMirror > p').last().click();
    await f.page.locator('.attachment-overlay img').dblclick();const viewer=f.page.getByRole('dialog',{name:'文档图片查看器',exact:true});await expect(viewer).toBeVisible();const before=(await viewer.boundingBox())!,handle=viewer.getByRole('button',{name:'调整图片查看器大小',exact:true}),box=(await handle.boundingBox())!;
    await f.page.mouse.move(box.x+10,box.y+10);await f.page.mouse.down();await f.page.mouse.move(box.x-90,box.y-50,{steps:8});await f.page.mouse.up();const after=(await viewer.boundingBox())!;expect(after.width).toBeCloseTo(before.width-200,0);expect(after.height).toBeCloseTo(before.height-120,0);
    await f.page.keyboard.press('ArrowRight');await expect(viewer.getByLabel('图片位置')).toHaveText('2 / 2');expect((await viewer.boundingBox())!.width).toBe(after.width);await f.page.keyboard.press('Escape');
    await f.page.locator('.attachment-overlay img').dblclick();await expect.poll(async()=>(await viewer.boundingBox())?.width).toBe(after.width);await expect.poll(async()=>(await viewer.boundingBox())?.height).toBe(after.height);await viewer.getByRole('button',{name:'关闭图片查看器',exact:true}).focus();await f.page.keyboard.press('Tab');await expect(handle).toBeFocused();await handle.press('ArrowLeft');await expect.poll(async()=>(await viewer.boundingBox())?.width).toBe(after.width-24);await expect(viewer.getByLabel('图片位置')).toHaveText('1 / 2');
    await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,700));await expect.poll(async()=>{const v=(await viewer.boundingBox())!;return v.width<=900&&v.height<=700;}).toBe(true);await handle.dblclick();await f.page.keyboard.press('Escape');
    const file=path.join(f.root,'窗口.assets/document.json');await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(file,'utf8')).attachmentViews['moyu-view:image-window'].imageWindowWidth;}catch{return null;}}).toBe(0);
    expect(await fs.readFile(path.join(f.root,'窗口.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('PDF and score resize handles reveal without reflow and their wheel boundaries hand scrolling to the document',async()=>{
  test.setTimeout(120000);const f=await attachmentFixture();try{
    const source='前文\n\n[资料](资料.pdf)\n\n[乐谱](乐谱.alphatex)\n\n'+Array.from({length:30},(_,i)=>'段落 '+i).join('\n\n');await f.note('滚动.md',source);
    const scroll=f.page.locator('.document-scroll');
    for(const kind of ['pdf','score']){
      const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await card.scrollIntoViewIfNeeded();await expect(card.locator(kind==='pdf'?'img':'.attachment-score-sheet svg').first()).toBeVisible({timeout:60000});const grip=card.getByRole('separator');await f.page.getByRole('button',{name:'文件',exact:true}).hover();await expect(grip).toHaveCSS('opacity','0');const before=(await card.boundingBox())!.height;await card.hover();await expect(grip).toHaveCSS('opacity','1');expect((await card.boundingBox())!.height).toBe(before);
      // Find the renderer's real scrolling viewport, including PDF shadow DOM.
      await scroll.evaluate(e=>e.scrollTop+=100);
      const point=await card.evaluate(card=>{let found:HTMLElement|null=null;const visit=(root:Element|ShadowRoot)=>{for(const node of root.querySelectorAll<HTMLElement>('*')){if(node.shadowRoot)visit(node.shadowRoot);if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+5)found=node;}};visit(card);if(found){(found as HTMLElement).scrollTop=0;const b=(found as HTMLElement).getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};}const b=card.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
      if(kind==='pdf'){const reader=card.locator('embedpdf-container');await reader.evaluate(async(e:any)=>(await e.registry).getPlugin('viewport').provides().scrollTo({x:0,y:200,behavior:'instant'}));await expect.poll(()=>reader.evaluate(async(e:any)=>(await e.registry).getPlugin('viewport').provides().getMetrics().scrollTop)).toBeGreaterThan(100);const outside=await scroll.evaluate(e=>e.scrollTop);const inside=await reader.evaluate(async(e:any)=>(await e.registry).getPlugin('viewport').provides().getMetrics().scrollTop);await f.page.mouse.move(point.x,point.y);await f.page.mouse.wheel(0,100);await expect.poll(()=>reader.evaluate(async(e:any)=>(await e.registry).getPlugin('viewport').provides().getMetrics().scrollTop)).toBeGreaterThan(inside);expect(await scroll.evaluate(e=>e.scrollTop)).toBe(outside);await reader.evaluate(async(e:any)=>(await e.registry).getPlugin('viewport').provides().scrollTo({x:0,y:0,behavior:'instant'}));}
      const top=await scroll.evaluate(e=>e.scrollTop);await f.page.mouse.move(point.x,point.y);await f.page.mouse.wheel(0,-150);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeLessThan(top);
      await card.scrollIntoViewIfNeeded();await card.evaluate(card=>{const visit=(root:Element|ShadowRoot)=>{for(const node of root.querySelectorAll<HTMLElement>('*')){if(node.shadowRoot)visit(node.shadowRoot);if(/auto|scroll/.test(getComputedStyle(node).overflowY))node.scrollTop=node.scrollHeight;}};visit(card);});const middle=await scroll.evaluate(e=>e.scrollTop);const box=(await card.boundingBox())!;await f.page.mouse.move(box.x+box.width/2,Math.min(box.y+box.height/2,600));await f.page.mouse.wheel(0,150);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(middle);
    }
    expect(await fs.readFile(path.join(f.root,'滚动.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});

test('Score transport is one compact top row and narrow previews retain all controls in the options menu',async()=>{
  const f=await attachmentFixture();try{
    await f.note('乐谱栏.md','前文\n\n[乐谱](乐谱.alphatex)\n\n尾文');const card=f.page.locator('[data-preview-kind=score]');await card.scrollIntoViewIfNeeded();await expect(card.locator('.attachment-score-sheet svg').first()).toBeVisible({timeout:60000});
    const row=card.getByRole('toolbar',{name:'乐谱控件'}),viewport=card.locator('.attachment-score-viewport');const main=(await row.boundingBox())!;expect(main.y+main.height).toBeLessThanOrEqual((await viewport.boundingBox())!.y+1);await expect(row.getByLabel('播放位置',{exact:true})).toBeVisible();await expect(row.getByLabel('乐谱缩放',{exact:true})).toBeVisible();expect((await row.getByLabel('乐谱音轨',{exact:true}).boundingBox())!.width).toBeLessThanOrEqual(120);
    await f.page.screenshot({path:path.resolve('../../work/v1060-score-wide.png')});await card.locator('.attachment-preview-body').evaluate(e=>e.style.width='260px');await expect(card.locator('.score-player')).toHaveAttribute('data-compact','true');await expect(row.getByLabel('乐谱缩放',{exact:true})).toHaveCount(0);await row.getByRole('button',{name:'播放选项',exact:true}).click();const options=card.getByRole('dialog',{name:'播放选项'});await expect(options.getByLabel('乐谱缩放',{exact:true})).toBeVisible();await options.getByLabel('乐谱缩放',{exact:true}).selectOption('0.7');await expect(options.getByLabel('乐谱布局',{exact:true})).toBeVisible();await expect(options.getByRole('button',{name:'停止播放'})).toBeVisible();await f.page.screenshot({path:path.resolve('../../work/v1060-score-options.png')});await f.page.keyboard.press('Escape');
    expect(await row.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await f.page.screenshot({path:path.resolve('../../work/v1060-score-compact.png')});
  }finally{await f.close();}
});

test('Attachment scrolling uses native wheel behavior in editing and reading, including repeated and reverse scrolling',async()=>{
  const f=await attachmentFixture();try{
    const source='前文\n\n[乐谱](乐谱.alphatex)\n\n'+Array.from({length:45},(_,i)=>'段落 '+i).join('\n\n');await f.note('滚动交接.md',source);
    const card=f.page.locator('.attachment-overlay [data-preview-kind=score]');await card.scrollIntoViewIfNeeded();await expect(card.locator('.attachment-score-sheet svg').first()).toBeVisible({timeout:60000});
    for(const mode of ['edit','read']){
      if(mode==='read')await f.page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();
      const active=f.page.locator(`${mode==='edit'?'.attachment-overlay ':'.reading-view '}[data-preview-kind=score]`),scroll=f.page.locator('.document-scroll');await active.scrollIntoViewIfNeeded();await expect(active.locator('.attachment-score-sheet svg').first()).toBeVisible({timeout:60000});
      const check=await active.evaluate(async card=>{
        const outer=card.closest<HTMLElement>('.document-scroll')!,caption=card.querySelector('.attachment-preview-caption')!;const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        // Untrusted wheel events have no native scroll action. If these move the
        // note later, custom JS has taken ownership again.
        await frame();await frame();const before=outer.scrollTop;const prevented=[];
        for(const target of [caption,outer.querySelector('p')!])for(const deltaY of [100,2,-100]){
          const event=new WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaY});target.dispatchEvent(event);prevented.push(event.defaultPrevented);
        }
        for(let i=0;i<12;i++)await frame();return{before,after:outer.scrollTop,prevented};
      });
      expect(check.prevented).toEqual([false,false,false,false,false,false]);expect(check.after).toBe(check.before);
      // Trusted input must still scroll from the preview and then from body text.
      await active.locator('.attachment-preview-caption').hover();const start=await scroll.evaluate(e=>e.scrollTop);for(let i=0;i<4;i++)await f.page.mouse.wheel(0,60);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(start);
      const body=f.page.locator(mode==='edit'?'.ProseMirror > p':'.reading-view > p').last();await body.scrollIntoViewIfNeeded();await body.hover();const lower=await scroll.evaluate(e=>e.scrollTop);for(let i=0;i<4;i++)await f.page.mouse.wheel(0,-60);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeLessThan(lower);
    }
    expect(await fs.readFile(path.join(f.root,'滚动交接.md'),'utf8')).toBe(source);
  }finally{await f.close();}
});
