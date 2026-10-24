import {test,expect,_electron as electron,type Page} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {guideCorpus,guideRoot} from './helpers/guide-corpus';
import {mockAndroid} from './helpers/mobile-native-mock';
import {mobileDavFixture,runMobileSync} from './helpers/mobile-dav-fixture';
import {davServer} from './helpers/dav-server.cjs';
const require=createRequire(import.meta.url),{Vault}=require('../electron/vault.cjs'),{WebDAVSync}=require('../electron/sync.cjs');
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
async function temporary(prefix:string){await fs.mkdir(work,{recursive:true});return fs.mkdtemp(path.join(work,prefix));}
async function cleanup(directory:string){if(path.dirname(directory)!==work)throw Error('Unexpected cleanup path');try{await fs.rm(directory,{recursive:true,force:true});}catch{console.warn('Manual cleanup needed: '+directory);}}
async function mobileEdit(page:Page,file:string,content:string){await page.evaluate(({file,content})=>{const state=(window as any).__mobileState;state.files[file]={content,updated:Date.now()};},{file,content});}
async function mobileBytes(page:Page){return page.evaluate(()=>Object.fromEntries(Object.entries((window as any).__mobileState.files).map(([name,value]:any)=>[name,value.base64||btoa(unescape(encodeURIComponent(value.content)))])));}
async function mobileResolve(page:Page,conflict:any,choice:'local'|'remote'|'both'){return page.evaluate(async({conflict,choice})=>{const {MobileSyncJob}=await import('/src/mobile/sync.ts');const state=(window as any).__mobileState;await new MobileSyncJob(state.davConnections[state.root],state.root,()=>{},()=>true).resolve(conflict,choice);},{conflict,choice});}

test('All guide files survive desktop → cloud → phone → cloud → desktop, including code data and binary attachments',async({page})=>{
  test.setTimeout(240000);const directory=await temporary('mobile-sync-corpus-'),root=path.join(directory,'vault');await fs.cp(guideRoot,root,{recursive:true});
  const corpus=await guideCorpus(),vault=await new Vault(root).init(),dav=await davServer(),desktop=new WebDAVSync(vault,async()=>({url:dav.url,directory:'/Moyu',username:'user',password:'secret',sync:{retries:0}}));
  try{
    await desktop.sync();expect(dav.files.size).toBe(Object.keys(corpus.files).length);
    await mobileDavFixture(page,dav,{directory:'/Moyu/',initial:{files:{}}});let result=await runMobileSync(page);expect(result.conflicts).toEqual([]);expect(result.downloaded).toBe(Object.keys(corpus.files).length);
    const downloaded=await mobileBytes(page);for(const [name,value]of Object.entries(corpus.files))expect(downloaded[name],name).toBe(value.base64||Buffer.from(value.content).toString('base64'));
    const start=dav.requests.length;result=await runMobileSync(page);expect(result.uploaded+result.downloaded).toBe(0);expect(dav.requests.slice(start).filter((request:any)=>['PUT','GET','DELETE','MKCOL'].includes(request.method))).toHaveLength(0);
    const python='代码示例/Python.md',pythonText=corpus.files[python].content+'\n\n手机添加的说明。';await mobileEdit(page,python,pythonText);
    const binaryName='公式和代码示例.assets/attachments/二进制 100%.bin',binary=Buffer.from([0,255,128,13,10,0,1,2]);await page.evaluate(({binaryName,base64})=>{(window as any).__mobileState.files[binaryName]={content:'',base64,updated:Date.now()};},{binaryName,base64:binary.toString('base64')});
    result=await runMobileSync(page);expect(result.uploaded).toBe(2);await desktop.sync();expect(await fs.readFile(path.join(root,python),'utf8')).toBe(pythonText);expect(await fs.readFile(path.join(root,binaryName))).toEqual(binary);
    const cpp='代码示例/C-C++.md',cppText=corpus.files[cpp].content+'\n\n电脑添加的说明。',before=await vault.read(cpp);await vault.save(cpp,cppText,before.version);await desktop.sync();expect((await runMobileSync(page)).downloaded).toBe(1);expect((await mobileBytes(page))[cpp]).toBe(Buffer.from(cppText).toString('base64'));
    const sql='代码示例/SQL.md',desktopSQL=corpus.files[sql].content+'\n\n电脑修改 SQL。',phoneSQL=corpus.files[sql].content+'\n\n手机修改 SQL。';await mobileEdit(page,sql,phoneSQL);const prior=await vault.read(sql);await vault.save(sql,desktopSQL,prior.version);await desktop.sync();
    result=await runMobileSync(page);expect(result.conflicts.map((item:any)=>item.path)).toEqual([sql]);expect(await fs.readFile(path.join(root,sql),'utf8')).toBe(desktopSQL);
    await mobileResolve(page,result.conflicts[0],'both');await desktop.sync();expect(await fs.readFile(path.join(root,sql),'utf8')).toBe(phoneSQL);expect(await fs.readFile(path.join(root,'代码示例/SQL-远端-1.md'),'utf8')).toBe(desktopSQL);
    const helper='代码示例/Python.assets/code-data/0003/helper.py';await page.evaluate(helper=>{delete (window as any).__mobileState.files[helper];},helper);result=await runMobileSync(page);expect(result.conflicts.map((item:any)=>item.path)).toEqual([helper]);expect(dav.files.has('/Moyu/'+helper)).toBe(true);
    await mobileResolve(page,result.conflicts[0],'local');const review=await desktop.sync();expect(review.needsConfirmation).toBe(true);await desktop.sync({token:review.token});expect(await fs.stat(path.join(root,helper)).catch(()=>null)).toBe(null);
    const final=await mobileBytes(page);for(const [name,base64]of Object.entries(final))expect(await fs.readFile(path.join(root,name)),name).toEqual(Buffer.from(base64 as string,'base64'));
    await fs.writeFile(path.join(work,'mobile-sync-corpus-report.json'),JSON.stringify({files:Object.keys(corpus.files).length,markdown:Object.keys(corpus.files).filter(name=>name.endsWith('.md')).length,checks:['exact initial bytes','unchanged sync without content transfers','phone and desktop edits','binary attachment','keep both','confirmed code-data deletion'],finalFiles:Object.keys(final).length},null,2));
  }finally{await desktop.cancel();await dav.close();await cleanup(directory);}
});

test('Nutstore-style numeric and mixed ETags, lost upload responses and racing writes stay compatible with desktop sync',async({page})=>{
  test.setTimeout(120000);const directory=await temporary('mobile-etag-parity-'),vault=await new Vault(directory).init(),dav=await davServer({numericETag:true,etagStyle:'mixed'}),desktop=new WebDAVSync(vault,async()=>({url:dav.url,directory:'/Moyu',username:'user',password:'secret',sync:{retries:0}}));
  try{
    await vault.create('a.md','file','base');await desktop.sync();await mobileDavFixture(page,dav,{directory:'/Moyu/',initial:{files:{'a.md':{content:'base'}}}});await runMobileSync(page);
    await mobileEdit(page,'a.md','phone');expect((await runMobileSync(page)).conflicts).toHaveLength(0);expect(dav.files.get('/Moyu/a.md')?.toString()).toBe('phone');expect(dav.requests.filter((request:any)=>request.method==='PUT').at(-1).headers['if-match']).toMatch(/^\d+$/);
    const start=dav.requests.length;await runMobileSync(page);expect(dav.requests.slice(start).some((request:any)=>['GET','PUT'].includes(request.method))).toBe(false);
    await mobileEdit(page,'a.md','new phone');dav.loseNextPut('/Moyu/a.md');expect((await runMobileSync(page)).conflicts).toHaveLength(0);expect(dav.files.get('/Moyu/a.md')?.toString()).toBe('new phone');
    await mobileEdit(page,'a.md','must remain local');dav.setRace({path:'/Moyu/a.md',method:'PUT',content:'concurrent writer'});await expect(runMobileSync(page)).rejects.toThrow('云端文件已改变');expect(dav.files.get('/Moyu/a.md')?.toString()).toBe('concurrent writer');expect((await mobileBytes(page))['a.md']).toBe(Buffer.from('must remain local').toString('base64'));
    await desktop.sync();expect((await vault.read('a.md')).content).toBe('concurrent writer');
  }finally{await desktop.cancel();await dav.close();await cleanup(directory);}
});

async function rendered(page:Page){
  await expect(page.locator('.reading-view')).toBeVisible();await expect(page.locator('.reading-view[data-editor-pending]')).toHaveCount(0,{timeout:90000});
  await expect(page.locator('.reading-view .diagram-error')).toHaveCount(0);
  return page.locator('.reading-view').evaluate(root=>({headings:[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(element=>element.tagName+':'+element.textContent),code:[...root.querySelectorAll('pre code')].map(element=>element.textContent),cells:[...root.querySelectorAll('th,td')].map(element=>element.textContent),folds:[...root.querySelectorAll('details.folding-quote summary')].map(element=>element.textContent),images:[...root.querySelectorAll('img[data-resource-link]')].map(element=>element.getAttribute('data-resource-link')),drawings:root.querySelectorAll('.resource-preview svg').length,math:root.querySelectorAll('.katex').length,diagrams:root.querySelectorAll('.mermaid-diagram > svg').length,tabs:[...root.querySelectorAll('.tabbed-code [role=tab]')].map(element=>element.textContent)}));
}
test('Every complex guide renders equivalently on phone and desktop and survives entering edit/source without rewriting',async({page})=>{
  test.setTimeout(300000);const corpus=await guideCorpus(),data=await temporary('mobile-render-corpus-'),env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_SKIP_BUNDLED:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  await fs.cp(guideRoot,path.join(data,'示例知识库'),{recursive:true,filter:source=>path.basename(source)!=='.data'});
  const app=await electron.launch({args:[project],env}),desktop=await app.firstWindow(),errors:string[]=[];desktop.on('pageerror',error=>errors.push(error.message));page.on('pageerror',error=>errors.push(error.message));
  try{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));await expect(desktop.locator('.ProseMirror')).toBeVisible({timeout:60000});await desktop.getByRole('button',{name:'阅读',exact:true}).click();
    await mockAndroid(page,corpus);await page.goto('/mobile.html');await expect(page.locator('.reading-view')).toBeVisible({timeout:30000});
    const documents=Object.keys(corpus.files).filter(name=>name.endsWith('.md')).sort(),report:any[]=[];
    for(const name of documents){
      await test.step(name,async()=>{
        if(await page.getByRole('button',{name:'返回笔记',exact:true}).count())await page.getByRole('button',{name:'返回笔记',exact:true}).click();
        if(name.startsWith('代码示例/')){const folder=page.locator('.mobile-file-tree [data-path="代码示例"]');if(await folder.getAttribute('aria-expanded')!=='true')await folder.locator('.mobile-file-open').click();}
        await page.locator('.mobile-file-tree [data-path="'+name+'"] .mobile-file-open').click();
        if(name.startsWith('代码示例/')&&!await desktop.locator('.tree-item[title="'+name+'"]').count())await desktop.locator('.tree-item[title="代码示例"]').click();
        await desktop.locator('.tree-item[title="'+name+'"]').dblclick();const expected=await rendered(desktop),actual=await rendered(page);expect(actual,name).toEqual(expected);
        await page.getByRole('tab',{name:'编辑',exact:true}).click();await expect(page.locator('.ProseMirror')).toBeVisible();await page.getByRole('tab',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toBeVisible();await expect(page.getByRole('button',{name:'保存文档',exact:true})).toHaveCount(0);
        expect(await page.evaluate(name=>(window as any).__mobileState.files[name].content,name),name).toBe(corpus.files[name].content);
        await desktop.getByRole('button',{name:'预览编辑',exact:true}).click();await expect(desktop.locator('.ProseMirror')).toBeVisible();await desktop.getByRole('button',{name:'源码',exact:true}).click();await expect(desktop.locator('.source-editor')).toBeVisible();expect(await fs.readFile(path.join(data,'示例知识库',name),'utf8')).toBe(corpus.files[name].content);await desktop.getByRole('button',{name:'阅读',exact:true}).click();
        report.push({path:name,...actual});
      });
    }
    expect(report.find(entry=>entry.path==='mermaid绘图大全.md').diagrams).toBe(31);expect(errors).toEqual([]);await fs.writeFile(path.join(work,'mobile-complex-documents-report.json'),JSON.stringify(report,null,2));
  }finally{await app.evaluate(({app})=>app.exit(0));if(app.process().exitCode===null)await new Promise(resolve=>app.process().once('exit',resolve));await cleanup(data);}
});
