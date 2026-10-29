import {_electron as electron,expect,type Locator} from './test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),documents=require('../fixtures/preview-documents.cjs');
const project=path.resolve(import.meta.dirname,'../..'),base=path.resolve(project,'../../work/e2e');
export const previewRefs=[['image','![图片|90](图片.svg)'],['drawing','[绘图](图.excalidraw)'],['pdf','[资料](资料.pdf)'],['score','[乐谱](乐谱.alphatex)']] as const;
export async function attachmentFixture(){
  await fs.mkdir(base,{recursive:true});const data=await fs.mkdtemp(path.join(base,'attachment-interaction-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow(),errors:string[]=[],requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.webContents.setBackgroundThrottling(false)));
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();const root=path.join(data,'示例知识库');
  await fs.writeFile(path.join(root,'图片.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="orange"/></svg>');
  await fs.writeFile(path.join(root,'资料.pdf'),documents.pdf({width:595,height:842}));await fs.writeFile(path.join(root,'乐谱.alphatex'),documents.score);
  await page.evaluate(()=>window.moyu!.feature('drawing.create',{path:'图.excalidraw'}));
  const note=async(name:string,content:string)=>{await page.getByRole('button',{name:'预览编辑',exact:true}).click();await page.evaluate(({name,content})=>window.moyu!.create(name,'file',content),{name,content});await expect(page.locator(`.tree-item[title="${name}"]`)).toBeVisible();await page.locator(`.tree-item[title="${name}"]`).dblclick();await expect(page.locator('[data-tree-path="'+name+'"]')).toHaveClass(/selected/);await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending','true');};
  const close=async()=>{try{expect(errors).toEqual([]);}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}};
  const edit=async(card:Locator)=>{await card.click({button:'right'});await page.getByRole('menuitem',{name:'编辑引用',exact:true}).click();await expect(page.locator('.ProseMirror .attachment-raw:visible')).toBeVisible();};
  return{app,page,root,data,errors,requests,note,close,edit};
}
