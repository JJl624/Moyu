import {_electron as electron,expect,test} from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
const example=`total=0
for value in 2 4 6 8; do total=$((total + value)); done
printf "总和：%s\\n" "$total"
mkdir -p output/nested
printf "%s\\n" "$total" > output/nested/total.txt
if [ -f output/nested/total.txt ]; then cat output/nested/total.txt; fi`;

async function fixture(code:string){
  const data=await fs.mkdtemp(path.join(work,'nested-artifacts-'));
  await fs.cp(path.join(work,'runtime-v184/runtimes/bash'),path.join(data,'runtimes/bash'),{recursive:true});
  const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1',MOYU_TEST_SKIP_BUNDLED:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
  const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(window=>{window.show();window.focus();window.webContents.focus();});
  const document='嵌套输出.md',markdown='```bash {id=0001}\n'+code+'\n```';
  const response:any=await page.evaluate(input=>window.moyu!.create(input.document,'file',input.markdown),{document,markdown});expect(response.ok,JSON.stringify(response)).toBe(true);
  await page.locator('.tree-item[title="嵌套输出.md"]').dblclick();
  await page.getByRole('button',{name:'运行代码块',exact:true}).click();
  await expect(page.locator('.run-artifact').first()).toBeVisible({timeout:30000});
  return{app,page,data,root:path.join(data,'示例知识库'),markdown};
}

test('Nested Bash output uses a leaf export name and preserves its source path, contents and filename validation',async()=>{
  const {app,page,data,root}=await fixture(example);
  try{
    await expect(page.locator('.code-output')).toHaveText('总和：20\n20\n');
    const artifact=page.locator('.run-artifact[data-output-path="nested/total.txt"]');
    const input=artifact.getByRole('textbox',{name:'结果文件名',exact:true});
    await expect(input).toHaveValue('total.txt');await expect(input).toHaveAttribute('aria-invalid','false');
    await expect(artifact.getByLabel('原始结果路径',{exact:true})).toHaveText('nested/total.txt');
    await expect(artifact.getByLabel('文件内容预览',{exact:true})).toHaveText('20\n');
    await expect(artifact.locator('.run-file-preview > small')).toHaveText('文件 3 B');
    await expect(artifact.getByRole('alert')).toHaveCount(0);
    const exported=path.join(data,'exported-total.txt');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async(...args)=>{(globalThis as any).__artifactDefault=args.at(-1)?.defaultPath;return{canceled:false,filePath:file};};},exported);
    await artifact.getByRole('button',{name:'保存为文件',exact:true}).click();
    await expect.poll(()=>fs.readFile(exported,'utf8').catch(()=>null)).toBe('20\n');
    expect(await app.evaluate(()=> (globalThis as any).__artifactDefault)).toBe('total.txt');
    await artifact.getByRole('button',{name:'保存到附件',exact:true}).click();
    await expect.poll(()=>fs.readFile(path.join(root,'嵌套输出.assets/attachments/total.txt'),'utf8').catch(()=>null)).toBe('20\n');
    await input.fill('../outside.txt');await expect(input).toHaveAttribute('aria-invalid','true');
    await expect(artifact.getByRole('button',{name:'保存为文件',exact:true})).toBeDisabled();
    await expect(artifact.getByRole('button',{name:'保存到附件',exact:true})).toBeDisabled();
    await input.fill('结果20.txt');
    await expect(artifact.getByRole('alert')).toHaveCount(0);
    await artifact.getByRole('button',{name:'保存到附件',exact:true}).click();
    await expect.poll(()=>fs.readFile(path.join(root,'嵌套输出.assets/attachments/结果20.txt'),'utf8').catch(()=>null)).toBe('20\n');
    expect(await fs.readFile(path.join(root,'嵌套输出.assets/code-data/0001/output/nested/total.txt'),'utf8')).toBe('20\n');
    await page.getByRole('button',{name:'阅读',exact:true}).click();
    await expect(artifact.getByLabel('原始结果路径',{exact:true})).toHaveText('nested/total.txt');
    await expect(artifact.getByRole('alert')).toHaveCount(0);
    await expect(artifact.getByRole('button',{name:'保存为文件',exact:true})).toBeEnabled();
    await page.screenshot({path:path.join(work,'nested-result-v191.png')});
  }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Same-named files from separate output folders keep distinct paths and save attachments without overwriting',async()=>{
  const {app,page,root}=await fixture('mkdir -p output/a output/b\nprintf first > output/a/total.txt\nprintf second > output/b/total.txt');
  try{
    for(const [directory,content,saved]of [['a','first','total.txt'],['b','second','total-1.txt']]){
      const artifact=page.locator('.run-artifact[data-output-path="'+directory+'/total.txt"]');
      await expect(artifact.getByRole('textbox',{name:'结果文件名',exact:true})).toHaveValue('total.txt');
      await expect(artifact.getByLabel('原始结果路径',{exact:true})).toHaveText(directory+'/total.txt');
      await artifact.getByRole('button',{name:'保存到附件',exact:true}).click();
      await expect.poll(()=>fs.readFile(path.join(root,'嵌套输出.assets/attachments',saved),'utf8').catch(()=>null)).toBe(content);
      expect(await fs.readFile(path.join(root,'嵌套输出.assets/code-data/0001/output',directory,'total.txt'),'utf8')).toBe(content);
    }
    await expect(page.locator('.run-artifact [role=alert]')).toHaveCount(0);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
