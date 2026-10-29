import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project=path.resolve(import.meta.dirname,'..');
test('Backspace from the paragraph after empty code enters code without removing its list item',async()=>{
  test.setTimeout(100000);
  const data=await fs.mkdtemp(path.resolve(project,'../../work/code-boundary-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-formatbar':'true'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  try{
    const page=await app.firstWindow();await expect(page.locator('.ProseMirror h1')).toBeVisible();
    for(const language of ['text','html','tabs']){
      const name=language+'边界.md',source='1. sss\n2. 1\n3. <br />\n\n   ```'+language+'\n   ```\n\n   <br />\n\n4. 3\n5. 3';
      expect((await page.evaluate(({name,source})=>window.moyu!.create(name,'file',source),{name,source})).ok).toBe(true);await page.locator(`.tree-item[title="${name}"]`).dblclick();
      const code=page.locator('.milkdown-code-block');if(language==='tabs')await code.getByRole('button',{name:'显示源码',exact:true}).click();
      await code.locator('xpath=following-sibling::p[1]').click();await page.keyboard.press('Backspace');await expect(code).toHaveCount(1);await expect(code.locator('.cm-content')).toBeFocused();
      for(const width of [284,220,160]){
        await code.evaluate((el,width)=>{el.style.width=width+'px';el.style.boxSizing='border-box';},width);
        expect(await code.locator('.language-button').evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
        const layout=await code.locator('.tools').evaluate(el=>{const frame=el.getBoundingClientRect();return [...el.children].filter(child=>getComputedStyle(child).display!=='none'&&!child.classList.contains('language-picker')).map(child=>{const box=child.getBoundingClientRect();return{class:child.className,left:box.x-frame.x,right:box.right-frame.right,width:box.width};});});
        if(layout.some(child=>child.left< -1||child.right>1))await code.screenshot({path:path.resolve(project,'../../work/v1047-desktop-narrow.png')});
        expect(layout.every(child=>child.left>=-1&&child.right<=1),language+', '+width+': '+JSON.stringify(layout)).toBe(true);
        if(process.env.MOYU_QA_LAYOUT_IMAGES==='1'&&(width===284||width===160))await code.screenshot({path:path.resolve(project,'../../work/v1047-header-'+language+'-'+width+'.png')});
      }
      await code.evaluate(el=>el.style.width='');
      await expect(page.locator('.ProseMirror .label-wrapper .ordered')).toHaveText(['1.','2.','3.','4.','5.']);
      await page.keyboard.insertText('7');await expect(code.locator('.cm-content')).toHaveText('7');await page.keyboard.press('Backspace');await expect(code.locator('.cm-content')).toHaveText('');
      await page.keyboard.press('Backspace');await expect(code).toHaveCount(0);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(code.locator('.cm-content')).toBeFocused();
      await page.keyboard.insertText('8');await expect(code.locator('.cm-content')).toHaveText('8');
    }
  }finally{await app.evaluate(({app})=>app.exit(0));await fs.rm(data,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
