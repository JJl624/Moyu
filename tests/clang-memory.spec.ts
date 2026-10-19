import {_electron as electron,expect,test} from './helpers/test';
import{seedRuntimeCache}from'./helpers/runtime-cache';
import fs from 'node:fs/promises';import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
test('Continuous C/C++ compilation keeps one worker, resets globals and input ownership, and preserves C++ constructors and polymorphism',async()=>{
 test.setTimeout(180000);
 const data=await fs.mkdtemp(path.resolve(project,'../../work/clang-continuous-'));
 await seedRuntimeCache(data);
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[]}:{args:[project]}),env});
 try{
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror h1')).toBeVisible();
  const feature=async(action:string,input:any)=>{const r:any=await page.evaluate(({action,input})=>window.moyu!.feature(action,input),{action,input});expect(r.ok,JSON.stringify(r)).toBe(true);return r.data;};
  const run=async(language:string,code:string,extra:any={})=>{const r=await feature('code.run',{language,code,...extra});expect(r.error,JSON.stringify(r)).toBe('');return r;};
  await run('c','static int n=0;printf("%d",++n);');
  const before=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingSetMB:p.memory.workingSetSize/1024})));
  const sandbox=app.windows().find(p=>p.url().startsWith('moyu-run:'))!,worker=sandbox.workers()[0];expect(worker).toBeTruthy();
  for(let i=0;i<24;i++){expect((await run('c',`static int n=0;printf("${i}:%d",++n);`)).output).toBe(`${i}:1`);expect(sandbox.workers()[0]).toBe(worker);}
  expect((await run('c','static int n=0;printf("23:%d",++n);')).output).toBe('23:1');
  const doc='编译文件隔离.md';
  await page.evaluate(doc=>window.moyu!.create(doc,'file','```c\nputs("one");\n```\n\n```c\nputs("two");\n```\n'),doc);
  const upload:any=await page.evaluate(doc=>window.moyu!.feature('code.data-upload',{document:doc,language:'c',id:'0001',name:'private.h',bytes:new TextEncoder().encode('#define ANSWER 42')}),doc);expect(upload.ok,JSON.stringify(upload)).toBe(true);
  expect((await run('c','#include "private.h"\nprintf("%d",ANSWER);',{document:doc,id:'0001'})).output).toBe('42');
  const absent='#if __has_include("private.h")\n#error stale header\n#endif\nputs("absent");';
  expect((await run('c',absent,{document:doc,id:'0002'})).output).toBe('absent\n');
  await feature('code.data-delete',{document:doc,language:'c',id:'0001',name:'private.h'});
  expect((await run('c',absent,{document:doc,id:'0001'})).output).toBe('absent\n');
  const cpp='#include <iostream>\n#include <string>\n#include <memory>\nstruct Base{virtual ~Base()=default;virtual int value()const=0;};\nstruct Derived:Base{int value()const override{return 42;}};\nstd::string text="ready";\nint main(){auto p=std::make_unique<Derived>();std::cout<<text<<":"<<p->value();}';
  expect((await run('cpp',cpp)).output).toBe('ready:42');expect(sandbox.workers()[0]).toBe(worker);
  expect((await run('cpp',cpp)).output).toBe('ready:42');expect(sandbox.workers()).toHaveLength(1);
  const after=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingSetMB:p.memory.workingSetSize/1024})));
  await fs.writeFile(path.resolve(project,'../../work/clang-process-memory-v1719.json'),JSON.stringify({before,after,workers:sandbox.workers().length},null,2));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
