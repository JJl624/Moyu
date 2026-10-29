import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project=path.resolve(import.meta.dirname,'..');
test('Code movement updates list numbering immediately, including undo, redo and saved reload',async()=>{
  test.setTimeout(100000);
  const data=await fs.mkdtemp(path.resolve(project,'../../work/list-numbering-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual','moyu-formatbar':'true'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  try{
    const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    for(const first of [1,5]){
      const name=`序号${first}.md`,source=`${first}. 上方甲\n${first+1}. 上方乙\n\n\`\`\`text\n11\n\`\`\`\n\n1. 下方甲\n2. 下方乙`;
      expect((await page.evaluate(({name,source})=>window.moyu!.create(name,'file',source),{name,source})).ok).toBe(true);
      await page.locator(`.tree-item[title="${name}"]`).dblclick();
      const code=page.locator('.milkdown-code-block'),labels=page.locator('.ProseMirror .label-wrapper .ordered'),sequence=[first,first+1,first+2,first+3].map(n=>n+'.');
      const move=async(label:string)=>{await code.click({button:'right'});await page.getByRole('menuitem',{name:label,exact:true}).click();};
      await move('缩进至列表');await expect(labels).toHaveText(sequence);await expect(page.locator('.ProseMirror ol')).toHaveCount(1);
      await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(labels).toHaveText([first+'.',first+1+'.','1.','2.']);
      await page.getByRole('button',{name:'重做',exact:true}).click();await expect(labels).toHaveText(sequence);
      await move('脱离列表');await expect(labels).toHaveText([first+'.',first+1+'.','1.','2.']);await expect(page.locator('.ProseMirror ol').last()).not.toHaveAttribute('start');
      await move('缩进至列表');await expect(labels).toHaveText(sequence);await expect(page.locator('.ProseMirror ol')).toHaveCount(1);
      await page.locator('.ProseMirror p').filter({hasText:/^下方甲$/}).click();await page.keyboard.press('End');await page.keyboard.press('Backspace');await expect(labels).toHaveText(sequence);
      await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.ProseMirror p').filter({hasText:/^下方甲$/})).toHaveCount(1);await expect(labels).toHaveText(sequence);
      await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
      await expect.poll(()=>fs.readFile(path.join(data,'示例知识库',name),'utf8')).toContain(`\n${first+2}. 下方甲`);
      await page.reload();await expect(labels).toHaveText(sequence);
    }
    const name='混合编号.md',source='1. 33\n\n3) <br />\n\n   <br />';
    expect((await page.evaluate(({name,source})=>window.moyu!.create(name,'file',source),{name,source})).ok).toBe(true);
    await page.locator(`.tree-item[title="${name}"]`).dblclick();
    const labels=page.locator('.ProseMirror .label-wrapper .ordered');await expect(labels).toHaveText(['1.','2.']);
    await page.getByRole('button',{name:'阅读',exact:true}).click();await expect(page.locator('.reading-view ol')).toHaveCount(1);
    await page.getByRole('button',{name:'预览编辑',exact:true}).click();await expect(labels).toHaveText(['1.','2.']);
    await page.locator('.ProseMirror p').first().click();await page.keyboard.press('End');await page.keyboard.insertText('4');
    await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
    await page.reload();await expect(labels).toHaveText(['1.','2.']);
    await expect(page.locator('.ProseMirror .list-item').last().locator('p')).toHaveCount(2);
    const gapName='列表分隔.md',gapSource='1. alpha\n2. beta\n\n分隔段落\n\n1. gamma\n2. delta';
    expect((await page.evaluate(({name,source})=>window.moyu!.create(name,'file',source),{name:gapName,source:gapSource})).ok).toBe(true);
    await page.locator(`.tree-item[title="${gapName}"]`).dblclick();
    await page.locator('.ProseMirror p').filter({hasText:/^分隔段落$/}).click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
    await expect(labels).toHaveText(['1.','2.','1.','2.']);await page.locator('.save-status').click();await expect(page.locator('.save-status')).toContainText('已保存到本地');
    await expect.poll(()=>fs.readFile(path.join(data,'示例知识库',gapName),'utf8')).toContain('<br />');await page.reload();await expect(labels).toHaveText(['1.','2.','1.','2.']);await expect(page.locator('.ProseMirror > p')).toHaveCount(1);
    expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));await fs.rm(data,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
