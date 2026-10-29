import {test,expect} from './helpers/test';
import {attachmentFixture,previewRefs} from './helpers/attachment-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Attachment panel location selects the preview instead of entering the reference name, including list and quote previews',async()=>{
  test.setTimeout(120000);const f=await attachmentFixture();try{
    const source='前文\n\n'+previewRefs.map(([,raw],i)=>i===0?'1. 列表\n\n   '+raw:i===1?'> '+raw:raw).join('\n\n')+'\n\n尾文';await f.note('附件定位.md',source);await f.page.locator('.ProseMirror > p').last().click();
    await f.page.getByRole('button',{name:'显示文档信息',exact:true}).click();await f.page.getByRole('tab',{name:'附件',exact:true}).click();const panel=f.page.getByRole('region',{name:'本文件附件'});
    for(const [kind]of previewRefs){
      const file={image:'图片.svg',drawing:'图.excalidraw',pdf:'资料.pdf',score:'乐谱.alphatex'}[kind];await panel.getByRole('button',{name:'定位 '+file,exact:true}).click();
      const card=f.page.locator(`.attachment-overlay [data-preview-kind=${kind}]`);await expect(card.locator('..')).toHaveClass(/range-selected/);await expect(f.page.locator('.ProseMirror .attachment-raw:visible')).toHaveCount(0);
      const outside=await card.evaluate(card=>{const a=card.getBoundingClientRect(),b=card.closest('.document-scroll')!.getBoundingClientRect();return a.bottom<b.top||a.top>b.bottom;});expect(outside).toBe(false);
    }
    await f.page.getByRole('toolbar',{name:'文档工具栏',exact:true}).getByRole('button',{name:'阅读',exact:true}).click();
    for(const [kind]of previewRefs){const file={image:'图片.svg',drawing:'图.excalidraw',pdf:'资料.pdf',score:'乐谱.alphatex'}[kind];await panel.getByRole('button',{name:'定位 '+file,exact:true}).click();await expect(f.page.locator(`.reading-view [data-preview-kind=${kind}]`)).toHaveClass(/preview-selected/);}
    expect(await fs.readFile(path.join(f.root,'附件定位.md'),'utf8')).toBe(source);await expect(f.page.locator('.save-status')).not.toContainText('未保存');
  }finally{await f.close();}
});

test('PDF page changes after restoring the current page persist in vertical and horizontal layouts and flush on close',async()=>{
  test.setTimeout(180000);const f=await attachmentFixture();try{
    for(const layout of ['vertical','horizontal'])for(const initial of [1,2]){
      const name=`页码-${layout}-${initial}`,document=name+'.md',source='前文\n\n[资料](资料.pdf)\n\n尾文';
      await f.page.evaluate(async({document,source,layout,initial})=>{await window.moyu!.create(document,'file',source);await window.moyu!.feature('attachment.views-update',{document,root:'',key:'资料.pdf',patch:{pdfPage:initial,pdfScroll:layout,pdfZoom:'fit-page'}});},{document,source,layout,initial});
      await expect(f.page.locator(`.tree-item[title="${document}"]`)).toBeVisible();await f.page.locator(`.tree-item[title="${document}"]`).dblclick();
      const reader=f.page.locator('.attachment-overlay .attachment-pdf-viewport');await expect(reader.locator('img').first()).toBeVisible({timeout:60000});const input=reader.locator('input:not([type=file])').last();await expect(input).toHaveValue(String(initial));
      const next=initial===1?2:1;await reader.getByRole('button',{name:initial===1?'下一页':'上一页',exact:true}).click();await expect(input).toHaveValue(String(next));
      // Closing immediately must flush the same owner record, not leave the page
      // in a renderer-only cache that happens to survive a mode switch.
      await f.page.locator(`.tab-name[title="${document}"]`).locator('..').locator('.tab-close').click();
      const record=path.join(f.root,name+'.assets/document.json');await expect.poll(async()=>JSON.parse(await fs.readFile(record,'utf8')).attachmentViews['资料.pdf'].pdfPage,{message:`${layout}: ${initial} -> ${next} on close`}).toBe(next);
      await f.page.locator(`.tree-item[title="${document}"]`).dblclick();
      const restored=f.page.locator('.attachment-overlay embedpdf-container');
      await expect.poll(async()=>restored.evaluate(async(e:any)=>{const r=await e.registry,p=(name:string)=>r.getPlugin(name).provides();return{page:p('scroll').getCurrentPage(),gates:p('viewport').getGates(),zoom:p('zoom').getState(),metrics:p('viewport').getMetrics()};}),{message:`Reopen ${document}`,timeout:10000}).toMatchObject({page:next});
      const settled=await restored.evaluate(async(e:any)=>{const scroll=(await e.registry).getPlugin('scroll').provides();let commands=0;const off=scroll.onPageChangeState((event:any)=>{if(event.state.isChanging)commands++;});for(let i=0;i<16;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));off();return{commands,page:scroll.getCurrentPage()};});
      expect(settled.page).toBe(next);expect(settled.commands).toBeLessThanOrEqual(3);
      expect(await fs.readFile(path.join(f.root,document),'utf8')).toBe(source);
    }
  }finally{await f.close();}
});

test('Standalone PDF pages survive closing and reopening without changing the PDF or Markdown',async()=>{
  const f=await attachmentFixture();try{
    await f.note('切换页.md','# 切换页\n\n正文');const original=await fs.readFile(path.join(f.root,'资料.pdf'));
    const file=f.page.locator('.tree-item[title="资料.pdf"]');await expect(file).toBeVisible();await file.dblclick();const reader=f.page.locator('.pdf-viewer embedpdf-container'),input=reader.locator('input:not([type=file])').last();await expect(input).toHaveValue('1',{timeout:60000});
    await reader.getByRole('button',{name:'下一页',exact:true}).click();await expect(input).toHaveValue('2');await f.page.locator('.tab-name[title="资料.pdf"]').locator('..').locator('.tab-close').click();await file.dblclick();await expect(input).toHaveValue('2',{timeout:60000});
    await reader.getByRole('button',{name:'上一页',exact:true}).click();await expect(input).toHaveValue('1');await f.page.locator('.tab-name[title="资料.pdf"]').locator('..').locator('.tab-close').click();await file.dblclick();await expect(input).toHaveValue('1',{timeout:60000});
    expect(await fs.readFile(path.join(f.root,'资料.pdf'))).toEqual(original);expect(await fs.readFile(path.join(f.root,'切换页.md'),'utf8')).toBe('# 切换页\n\n正文');
  }finally{await f.close();}
});
