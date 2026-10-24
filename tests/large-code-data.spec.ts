import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
test('JavaScript, C and SQLite persist data above 20 MB, and subsequent runs can read it',async()=>{
 test.setTimeout(180000);
 const data=await fs.mkdtemp(path.resolve(project,'../../work/large-code-data-'));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_OFFSCREEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env}),page=await app.firstWindow();
 try{
  await expect(page.locator('.ProseMirror')).toBeVisible();
  for(const language of ['js','c','sql']){
   const document=language+'-large.md',id='0001';
   const created:any=await page.evaluate(({document,language})=>window.moyu!.create(document,'file','```'+language+' {id=0001}\n\n```'),{document,language});expect(created.ok).toBe(true);
   const code=language==='js'?'await files.writeFile("large.bin",new Uint8Array(21*1024*1024)); console.log((await files.readFile("large.bin","bytes")).length);'
    :language==='c'?'FILE *f=fopen("large.bin","wb"); fseek(f,21*1024*1024-1,SEEK_SET); fputc(65,f); fclose(f); puts("saved");'
    :'CREATE TABLE payload(data BLOB); INSERT INTO payload VALUES(zeroblob(21*1024*1024));';
   const result:any=await page.evaluate(input=>window.moyu!.feature('code.run',input),{document,id,language,code});expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.data.error,JSON.stringify(result.data)).toBe('');
   const listed:any=await page.evaluate(input=>window.moyu!.feature('code.data-list',input),{document});expect(listed.ok).toBe(true);
   const file=listed.data[0].files[0];expect(file.size).toBeGreaterThanOrEqual(21*1024*1024);expect((await fs.stat(path.join(data,'示例知识库',file.path))).size).toBe(file.size);
   const read=language==='js'?'console.log((await files.readFile("large.bin","bytes")).length);'
    :language==='c'?'FILE *f=fopen("large.bin","rb");fseek(f,0,SEEK_END);printf("%ld",ftell(f));fclose(f);'
    :'SELECT length(data) AS bytes FROM payload;';
   const again:any=await page.evaluate(input=>window.moyu!.feature('code.run',input),{document,id,language,code:read});expect(again.ok,JSON.stringify(again)).toBe(true);expect(again.data.error,JSON.stringify(again.data)).toBe('');
   if(language!=='sql')expect(again.data.output.trim()).toBe(String(21*1024*1024));
   else{
    const rows:any=await page.evaluate(token=>window.moyu!.feature('code.result-page',{token,page:0}),again.data.artifacts[0].token);expect(rows.data.rows).toEqual([[String(21*1024*1024)]]);
   }
  }
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
