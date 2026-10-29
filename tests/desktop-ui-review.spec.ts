import {_electron as electron,test,expect} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function fixture(){
  const data=await fs.mkdtemp(path.join(work,'desktop-ui-')),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.ProseMirror h1').first()).toBeVisible();
  const close=async()=>{try{expect(errors).toEqual([]);}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}};return {app,page,close};
}
test('Each settings category opens at its beginning, preserves a single current item and fits small windows',async()=>{
  const f=await fixture();try{
    await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,720));await f.page.getByRole('button',{name:'偏好设置',exact:true}).click();
    const nav=f.page.getByRole('navigation',{name:'设置分类',exact:true}),content=f.page.locator('.pref-content');
    for(const category of ['字体与排版','界面','编辑','终端','代码','WebDAV','数据与运行环境','字体与排版']){
      await nav.getByRole('button',{name:category,exact:true}).click();await expect(nav.locator('[aria-current=page]')).toHaveText(category);await expect.poll(()=>content.evaluate(node=>node.scrollTop)).toBe(0);expect(await content.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      const footer=(await f.page.locator('.pref-bottom').boundingBox())!;expect(footer.y+footer.height).toBeLessThanOrEqual(await f.page.evaluate(()=>innerHeight));
      await content.evaluate(node=>node.scrollTop=node.scrollHeight);
    }
    await f.page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  }finally{await f.close();}
});
test('Search begins with the input and history uses contextual policy details instead of a permanent footer',async()=>{
  const f=await fixture();try{
    await f.page.getByRole('button',{name:'全文搜索',exact:true}).click();await expect(f.page.getByPlaceholder('搜索文件名和内容…')).toBeVisible();await expect(f.page.locator('.search-meta')).toHaveCount(0);
    await f.page.getByPlaceholder('搜索文件名和内容…').fill('开始');await expect(f.page.locator('.search-meta')).toContainText('篇匹配文档');
    await f.page.getByRole('button',{name:'清空搜索',exact:true}).click();await expect(f.page.locator('.search-meta')).toHaveCount(0);
    await f.page.getByRole('button',{name:'文档历史',exact:true}).click();await expect(f.page.locator('.history-owner .history-policy')).toHaveAttribute('title',/保留/);await expect(f.page.locator('.document-history > .history-policy')).toHaveCount(0);
    await expect(f.page.locator('.history-owner .history-policy')).toBeVisible();
  }finally{await f.close();}
});
