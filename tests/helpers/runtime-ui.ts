import type {Page} from '@playwright/test';
const languages = new Set(['通用','Python','JavaScript','C / C++','C#','Java','SQL','Lua','Ruby','Bash']);
export async function selectPreference(page:Page,name:string){
  if(languages.has(name)){
    await page.locator('.pref-tabs').getByRole('button',{name:'代码',exact:true}).click();
    await page.getByRole('tablist',{name:'代码语言',exact:true}).getByRole('tab',{name,exact:true}).click();
  }else await page.locator('.pref-tabs').getByRole('button',{name,exact:true}).click();
}
export async function openRuntimeInstaller(page:Page){const button=page.getByRole('button',{name:'添加环境',exact:true});if(await button.count()&&await button.isVisible())await button.click();}
