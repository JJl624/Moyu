import {_electron as electron,expect,test} from './helpers/test';
import {selectPreference} from './helpers/runtime-ui';
import fs from 'node:fs/promises';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..'),work=path.resolve(project,'../../work');
test.setTimeout(120000);
async function fixture(theme='light'){
 const data=await fs.mkdtemp(path.join(work,'code-preferences-'));
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,values:{'moyu-theme':theme}}));
 const env={...process.env,MOYU_USER_DATA:data,MOYU_TEST:'1',MOYU_DEMO:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.MOYU_E2E_EXECUTABLE?{executablePath:process.env.MOYU_E2E_EXECUTABLE,args:[],env}:{args:[project],env});
 const page=await app.firstWindow();await expect(page.locator('.ProseMirror')).toBeVisible();
 await (await app.browserWindow(page)).evaluate(w=>{w.show();w.focus();w.webContents.focus();w.webContents.setBackgroundThrottling(false);});
 await page.getByRole('button',{name:'偏好设置',exact:true}).click();
 return{app,page,data};
}
for(const theme of ['light','dark'])test(`One code category exposes every language and common formatting with compact aligned layout (${theme})`,async()=>{
 const {app,page}=await fixture(theme);
 try{
  await expect(page.locator('.pref-tabs > button')).toHaveText(['字体与排版','界面','编辑','WebDAV','终端','代码','数据与运行环境']);
  await (await app.browserWindow(page)).evaluate(w=>w.setSize(900,700));
  await selectPreference(page,'通用');
  const tabs=page.getByRole('tablist',{name:'代码语言',exact:true});
  await expect(tabs.getByRole('tab')).toHaveText(['通用','Python','JavaScript','C / C++','C#','Java','SQL','Lua','Ruby','Bash']);
  await expect(page.getByLabel('代码块默认缩进空格数',{exact:true})).toBeVisible();
  await expect(page.getByLabel('dprint 配置 JSON',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'参考',exact:true}).click();await expect(page.locator('.formatting-reference')).toBeVisible();
  await page.getByRole('tab',{name:'配置',exact:true}).click();
  await page.locator('.modal').screenshot({path:path.join(work,`code-${theme}-general-v195.png`),animations:'disabled'});
  await tabs.screenshot({path:path.join(work,`code-tabs-${theme}-v195.png`),animations:'disabled'});
  const edges=await tabs.evaluate(el=>{const box=el.getBoundingClientRect(),content=el.closest('.pref-content')!,parent=content.getBoundingClientRect();return{left:box.left-parent.left,top:box.top-parent.top,right:box.right-parent.left-content.clientWidth};});
  expect(Math.abs(edges.left)).toBeLessThan(1);
  expect(Math.abs(edges.top)).toBeLessThan(1);
  expect(Math.abs(edges.right)).toBeLessThan(1);
  const layout=await tabs.evaluate(el=>{const box=el.getBoundingClientRect();const buttons=Array.from(el.querySelectorAll('button')).map(item=>{const b=item.getBoundingClientRect();return{width:b.width,top:b.top,height:b.height,overflow:item.scrollWidth>item.clientWidth};});return{width:box.width,parent:el.parentElement!.getBoundingClientRect().width,buttons};});
  expect(layout.width).toBeCloseTo(layout.parent,0);
  expect(Math.max(...layout.buttons.map(b=>b.width))-Math.min(...layout.buttons.map(b=>b.width))).toBeLessThan(1);
  expect(new Set(layout.buttons.map(b=>b.top)).size).toBe(1);
  expect(layout.buttons.every(b=>b.height===32&&!b.overflow)).toBe(true);
  for(const position of [40,100,250]){
   await page.locator('.code-preferences > [role=tabpanel]').evaluate((el,top)=>{el.scrollTop=top;},position);
   expect(await page.locator('.code-language-bar').evaluate(el=>el.getBoundingClientRect().bottom<=el.nextElementSibling!.getBoundingClientRect().top)).toBe(true);
  }
  await page.locator('.code-preferences > [role=tabpanel]').evaluate(el=>{el.scrollTop=0;});
  const buttonBoxes=()=>tabs.getByRole('tab').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,fontWeight:getComputedStyle(el).fontWeight};}));
  const fixedBoxes=await buttonBoxes();
  for(const name of ['Python','JavaScript','C / C++','C#','Java','SQL','Lua','Ruby','Bash']){
   await tabs.getByRole('tab',{name,exact:true}).click();
   await expect(tabs.getByRole('tab',{name,exact:true})).toHaveAttribute('aria-selected','true');
   expect(await buttonBoxes()).toEqual(fixedBoxes);
   await expect(page.getByRole('tab',{name:'运行设置',exact:true})).toBeVisible();
   const group=page.getByRole('tabpanel',{name:'运行设置',exact:true}).locator('.pref-section').filter({has:page.getByRole('heading',{name:'运行时限',exact:true})});
   expect(await group.evaluate(el=>{const head=el.querySelector('.pref-section-heading')!;return head.nextElementSibling!.getBoundingClientRect().top-head.getBoundingClientRect().bottom;})).toBe(12);
   expect(await group.locator('input').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(90);
   expect(await page.locator('.pref-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   if(['Python','JavaScript'].includes(name))await page.locator('.modal').screenshot({path:path.join(work,`code-${theme}-${name}-v195.png`),animations:'disabled'});
   await page.getByRole('tab',{name:'环境',exact:true}).click();await expect(page.getByRole('tabpanel',{name:'环境',exact:true})).toBeVisible();expect(await buttonBoxes()).toEqual(fixedBoxes);
  }
  await tabs.getByRole('tab',{name:'Bash',exact:true}).focus();await page.keyboard.press('Home');await expect(tabs.getByRole('tab',{name:'通用',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(tabs.getByRole('tab',{name:'Python',exact:true})).toBeFocused();
  await selectPreference(page,'编辑');await expect(page.getByLabel('代码块默认缩进空格数',{exact:true})).toHaveCount(0);await expect(page.getByLabel('dprint 配置 JSON',{exact:true})).toHaveCount(0);
  await selectPreference(page,'代码');await expect(tabs.getByRole('tab',{name:'Python',exact:true})).toHaveAttribute('aria-selected','true');
 }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Language changes validate drafts, save only corrected settings and reset only the active language',async()=>{
 const {app,page,data}=await fixture();
 try{
  await selectPreference(page,'JavaScript');const tabs=page.getByRole('tablist',{name:'代码语言',exact:true});
  const execution=page.getByLabel('JavaScript / TypeScript 代码执行时限',{exact:true});await execution.fill('0');
  await tabs.getByRole('tab',{name:'Python',exact:true}).click();await expect(tabs.getByRole('tab',{name:'JavaScript',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.runtime-notice[role=alert]')).toBeVisible();
  await expect(execution).toBeFocused();
  await execution.fill('17');await tabs.getByRole('tab',{name:'Python',exact:true}).click();
  await expect(tabs.getByRole('tab',{name:'Python',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByLabel('Python 代码执行时限',{exact:true}).fill('23');await page.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(page.getByLabel('Python 代码执行时限',{exact:true})).toHaveValue('10');
  await tabs.getByRole('tab',{name:'JavaScript',exact:true}).click();await expect(execution).toHaveValue('17');
  await tabs.getByRole('tab',{name:'通用',exact:true}).click();const json=page.getByLabel('dprint 配置 JSON',{exact:true}),valid=await json.inputValue();
  await json.fill('{');await tabs.getByRole('tab',{name:'Python',exact:true}).click();await expect(tabs.getByRole('tab',{name:'通用',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.code-formatting [role=alert]')).toBeVisible();
  await expect(json).toBeFocused();
  await json.fill(valid);await tabs.getByRole('tab',{name:'Python',exact:true}).click();await expect(tabs.getByRole('tab',{name:'Python',exact:true})).toHaveAttribute('aria-selected','true');
  expect(JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).code.javascript.executionTimeoutSeconds).toBe(17);
 }finally{await app.evaluate(({app})=>app.exit(0));}
});

test('Common indentation and formatting reset together without changing language execution settings',async()=>{
 const {app,page,data}=await fixture();
 try{
  await selectPreference(page,'JavaScript');await page.getByLabel('JavaScript / TypeScript 代码执行时限',{exact:true}).fill('19');
  await selectPreference(page,'通用');const indent=page.getByLabel('代码块默认缩进空格数',{exact:true});await indent.fill('6');await indent.press('Enter');
  const json=page.getByLabel('dprint 配置 JSON',{exact:true}),config=JSON.parse(await json.inputValue());config.indentWidth=6;
  await json.fill(JSON.stringify(config));await page.getByRole('button',{name:'恢复默认',exact:true}).click();
  await expect(indent).toHaveValue('2');
  await expect.poll(async()=>JSON.parse(await json.inputValue()).indentWidth).toBe(2);
  await selectPreference(page,'JavaScript');await expect(page.getByLabel('JavaScript / TypeScript 代码执行时限',{exact:true})).toHaveValue('19');
  expect(JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')).values['moyu-code-indent']).toBe('2');
 }finally{await app.evaluate(({app})=>app.exit(0));}
});
