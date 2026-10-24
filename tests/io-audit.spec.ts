import {_electron as electron,test,expect} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
test('Desktop save/watch events share one scan; equal saves and new attachments do not reread unrelated notes',async()=>{
  const data=await fs.mkdtemp(path.resolve(project,'../../work/io-audit-ui-'));
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-save-policy':'manual'}}));
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow(),root=path.join(data,'示例知识库');
  try{
    await expect(page.locator('.ProseMirror h1')).toBeVisible();expect((await page.evaluate(()=>window.moyu!.list())).data.root).toBe(root);await page.evaluate(()=>window.moyu!.create('io-note.md','file','original'));await page.waitForTimeout(1100);
    await app.evaluate((_electron,root)=>{
      const nodeModule=process.getBuiltinModule('node:module'),mainRequire=nodeModule.createRequire(process.cwd()+'/package.json');
      const fs:any=mainRequire('node:fs/promises'),path:any=mainRequire('node:path'),audit={scans:0,reads:[] as string[],directories:[] as string[]};(globalThis as any).__ioAudit=audit;
      const readdir=fs.readdir,readFile=fs.readFile;
      fs.readdir=async function(file:any,...args:any[]){audit.directories.push(String(file));if(path.resolve(String(file))===root)audit.scans++;return readdir.call(this,file,...args);};
      fs.readFile=async function(file:any,...args:any[]){const name=String(file);if(name.startsWith(root+path.sep)&&/\.(md|markdown)$/i.test(name))audit.reads.push(path.relative(root,name));return readFile.call(this,file,...args);};
    },root);
    const save=async(content:string)=>{const result=await page.evaluate(async content=>{const doc=(await window.moyu!.read('io-note.md')).data;return window.moyu!.save(doc.path,content,doc.version);},content);expect(result.ok).toBe(true);};
    await save('edited');await page.waitForTimeout(1100);
    let audit=await app.evaluate(()=>(globalThis as any).__ioAudit);expect(audit.scans,JSON.stringify(audit)).toBe(1);expect(audit.reads.every((name:string)=>name==='io-note.md')).toBe(true);
    await app.evaluate(()=>{(globalThis as any).__ioAudit.scans=0;(globalThis as any).__ioAudit.reads=[];});
    const stamp=(await fs.stat(path.join(root,'io-note.md'))).mtimeMs;await save('edited');await page.waitForTimeout(700);
    audit=await app.evaluate(()=>(globalThis as any).__ioAudit);expect(audit.scans).toBe(0);expect((await fs.stat(path.join(root,'io-note.md'))).mtimeMs).toBe(stamp);
    await app.evaluate(()=>{(globalThis as any).__ioAudit.scans=0;(globalThis as any).__ioAudit.reads=[];});
    await fs.writeFile(path.join(root,'io-photo.svg'),'<svg/>');await page.waitForTimeout(1100);audit=await app.evaluate(()=>(globalThis as any).__ioAudit);
    expect(audit.scans).toBe(1);expect(audit.reads).toEqual([]);
    const idle=audit.scans;await page.waitForTimeout(700);expect(await app.evaluate(()=>(globalThis as any).__ioAudit.scans)).toBe(idle);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
