import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test, type Locator, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
const checked = new Map<string, Set<string>>();
async function choose(page: Page, category: string, label: string) {
  const parent=['在下方插入行','在右侧插入列'].includes(label)?'插入':['删除当前行','删除当前列','删除表格'].includes(label)?'删除':null;
  if(parent)await page.locator('.element-menu:not(.element-submenu)').getByRole('menuitem',{name:parent,exact:true}).hover();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  if (!checked.has(category)) checked.set(category, new Set());
  checked.get(category)!.add(label);
  await expect(page.locator('.element-menu')).toHaveCount(0);
}
async function context(target: Locator) { await target.click({ button: 'right' }); }
async function fixture(offscreen=true) {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/context-actions-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual', 'moyu-theme': 'light' } }));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: offscreen?'1':'0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env } : { args: [project], env });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  await app.evaluate(async ({ shell, dialog }, base) => {
    const fs = process.getBuiltinModule('fs/promises'), path = process.getBuiltinModule('path');
    await fs.mkdir(path.join(base, 'recycled'), { recursive: true });
    await fs.mkdir(path.join(base, 'exports'), { recursive: true });
    (globalThis as any).__menuCalls = [];
    shell.showItemInFolder = file => { (globalThis as any).__menuCalls.push(['reveal', file]); };
    shell.openExternal = async url => { (globalThis as any).__menuCalls.push(['external', url]); };
    shell.trashItem = async file => { await fs.rename(file, path.join(base, 'recycled', path.basename(file))); };
    dialog.showSaveDialog = async (_window, options) => {
      const filePath = path.join(base, 'exports', path.basename(options.defaultPath!));
      (globalThis as any).__menuCalls.push(['export', filePath]);
      return { canceled: false, filePath };
    };
  }, data);
  return { app, page, data, root: path.join(data, '示例知识库'), errors };
}
async function open(page: Page, file: string, content?: string) {
  if (content !== undefined) expect((await page.evaluate(({ file, content }) => window.moyu!.create(file, 'file', content), { file, content })).ok).toBe(true);
  await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', file);
  if (/\.(md|markdown)$/i.test(file)) await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}
async function nativeSelection(el: Locator, from: number, to = from) {
  await el.evaluate((el, { from, to }) => {
    el.closest<HTMLElement>('.ProseMirror')!.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const at = (offset: number) => { for (const text of texts) { if (offset <= text.length) return { text, offset }; offset -= text.length; } throw Error('Text offset missing'); };
    const a = at(from), b = at(to); getSelection()!.setBaseAndExtent(a.text, a.offset, b.text, b.offset);
  }, { from, to });
}
test.afterAll(async () => {
  await fs.writeFile(path.resolve(project, '../../work/context-menu-checked-' + (process.env.MOYU_E2E_EXECUTABLE ? 'packaged' : 'source') + '-v1719.json'), JSON.stringify(Object.fromEntries([...checked].map(([key, values]) => [key, [...values]])), null, 2));
});

test('Quote/unquote works inside every inline marker, only transforms the caret soft line and does not trigger viewport restoration', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    for (const [name, raw] of [['加粗','**加粗**'],['斜体','*斜体*'],['代码','`code`'],['公式','$x^2$'],['高亮','==高亮=='],['链接','[链接](https://example.com)']]) {
      await open(page, name + '引用.md', `前行\n本行 ${raw} 结束\n后行\n\n\`\`\`markdown\nnext block\n\`\`\`\n`);
      await expect(page.locator('.ProseMirror')).toContainText('本行');
      const source = page.locator('.inline-syntax').filter({ hasText: raw }).first(); await source.click();
      const text = source.locator('.syntax-raw'); await expect(text).toBeVisible();
      await nativeSelection(text, Math.min(2, raw.length - 1)); await context(text);
      await choose(page, '行内' + name, '引用');
      const quote = page.locator('.ProseMirror blockquote'); await expect(quote).toContainText('本行');
      await expect(quote).not.toContainText('前行'); await expect(quote).not.toContainText('后行');
      if (name === '加粗') await page.screenshot({path:path.resolve(project,'../../work/context-quote-v1719.png')});
      await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
      await context(quote.locator('.syntax-raw')); await choose(page, '行内' + name, '去除一层引用'); await expect(quote).toHaveCount(0);
      await page.locator('.save-status').click(); await expect.poll(() => fs.readFile(path.join(root, name + '引用.md'), 'utf8')).toContain(raw);
    }
    // Right-click a different paragraph while the old caret remains in code.
    await open(page, '右键目标.md', '目标正文\n\n```js\noldCaret();\n```\n\n后文');
    await page.locator('.cm-content').click(); await context(page.locator('.ProseMirror > p').first());
    await choose(page, '正文', '引用'); await expect(page.locator('blockquote')).toHaveText('目标正文');
    await expect(page.locator('blockquote .milkdown-code-block')).toHaveCount(0);
    await context(page.locator('blockquote p')); await choose(page, '正文', '去除一层引用'); await expect(page.locator('blockquote')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Text copy/cut/paste and select-all retain the menu selection in paragraphs, source, text files and input fields', async () => {
  const { app, page, root, errors } = await fixture();
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await open(page, '文本操作.md', 'alpha beta gamma\n');
    const paragraph = page.locator('.ProseMirror > p').first(); await paragraph.click(); await nativeSelection(paragraph, 6, 10);
    await paragraph.click({ button: 'right', position: { x: 60, y: 12 } }); await choose(page, '正文', '复制文本'); await expect.poll(clipboard).toBe('beta');
    await nativeSelection(paragraph, 6, 10); await paragraph.click({ button: 'right', position: { x: 60, y: 12 } }); await choose(page, '正文', '剪切'); await expect(paragraph).toHaveText('alpha  gamma'); await expect.poll(clipboard).toBe('beta');
    await context(paragraph); await choose(page, '正文', '粘贴'); await expect(paragraph).toContainText('beta');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    const source = page.locator('.source-editor .cm-content'); await source.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
    const selected = await page.evaluate(() => getSelection()!.toString()); await context(source.locator('.cm-line').first()); await choose(page, '源码', '复制文本'); await expect.poll(clipboard).toBe(selected);
    await context(source.locator('.cm-line').first()); await choose(page, '源码', '剪切'); await expect(source).not.toContainText('alpha');
    await context(source.locator('.cm-line').first()); await choose(page, '源码', '粘贴'); await expect(source).toContainText('alpha');
    await fs.writeFile(path.join(root, '编辑.txt'), 'alpha beta'); await open(page, '编辑.txt'); const cm = page.locator('.text-file-editor .cm-content'); await cm.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
    await context(cm); await choose(page, '文本文件', '复制'); await expect.poll(clipboard).toBe('alpha beta');
    await context(cm); await choose(page, '文本文件', '剪切'); await expect(cm).not.toContainText('alpha');
    await context(cm); await choose(page, '文本文件', '粘贴'); await expect(cm).toContainText('alpha beta');
    await context(cm); await choose(page, '文本文件', '全选'); expect(await page.evaluate(() => getSelection()!.toString())).toBe('alpha beta');
    await page.getByRole('button', { name: '偏好设置', exact: true }).click(); await selectPreference(page,'通用');
    const field = page.getByLabel('dprint 配置 JSON'); await field.fill('alpha beta'); await field.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(6, 10));
    await context(field); await page.screenshot({path:path.resolve(project,'../../work/context-input-v1719.png')}); await choose(page, '输入框', '复制'); await expect.poll(clipboard).toBe('beta');
    await context(field); await choose(page, '输入框', '剪切'); await expect(field).toHaveValue('alpha ');
    await context(field); await choose(page, '输入框', '粘贴'); await expect(field).toHaveValue('alpha beta');
    await context(field); await choose(page, '输入框', '全选'); expect(await field.evaluate(el => (el as HTMLTextAreaElement).selectionEnd! - (el as HTMLTextAreaElement).selectionStart!)).toBe(10);
    await context(field); await page.keyboard.press('Escape'); await expect(page.locator('.element-menu')).toHaveCount(0); await expect(page.getByRole('dialog')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Every table context command acts on the clicked table and cell, copies document text and remains undoable', async () => {
  const { app, page, errors } = await fixture(); const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await open(page, '表格操作.md', '| first | keep |\n| - | - |\n| 0 | 0 |\n\n正文\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n尾部');
    await expect(page.locator('.ProseMirror')).toContainText('尾部');
    const tables = page.locator('.ProseMirror table.children'), table = tables.nth(1); await expect(tables).toHaveCount(2); await tables.first().locator('td').first().click();
    await context(table.locator('td').last()); await choose(page, '表格单元格', '复制单元格'); await expect.poll(clipboard).toBe('2');
    await context(table.locator('td').last()); await choose(page, '表格单元格', '复制表格文本'); await expect.poll(clipboard).toBe('a\tb\n1\t2');
    await table.locator('xpath=ancestor::div[contains(@class,"milkdown-table-block")]').evaluate(el=>{const box=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+6,clientY:box.top+6,button:2}));});await choose(page,'表格边框','复制表格文本');await expect.poll(clipboard).toBe('a\tb\n1\t2');
    await context(table.locator('td').last()); await choose(page, '表格单元格', '在下方插入行'); await expect(table.locator('tr')).toHaveCount(3); await expect(tables.first().locator('tr')).toHaveCount(2);
    await context(table.locator('td').first()); await choose(page, '表格单元格', '在右侧插入列'); await expect(table.locator('tr').first().locator('th')).toHaveCount(3);
    await context(table.locator('td').last()); await choose(page, '表格单元格', '删除当前行'); await expect(table.locator('tr')).toHaveCount(2);
    await context(table.locator('td').nth(1)); await choose(page, '表格单元格', '删除当前列'); await expect(table.locator('tr').first().locator('th')).toHaveCount(2);
    await context(table.locator('td').first()); await choose(page, '表格单元格', '选中表格'); await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(1);
    await context(table.locator('td').first()); await choose(page, '表格单元格', '删除表格'); await expect(tables).toHaveCount(1); await page.keyboard.press('Control+z'); await expect(tables).toHaveCount(2);
    await page.getByRole('button', { name: '阅读', exact: true }).click(); await context(page.locator('.reading-view table').last().locator('td').first());
    await expect(page.getByRole('menuitem', { name: /删除|插入|引用|脱离/ })).toHaveCount(0); await choose(page, '阅读表格', '复制单元格'); await expect.poll(clipboard).toBe('1');
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Heading/list/quote/formula menus copy semantic content, indent the clicked item and transform complete resources', async () => {
  const { app, page, errors } = await fixture(); const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await open(page, '块操作.md', '# 标题\n\n- 第一项\n- 第二项\n\n```js\nconsole.log(1);\n```\n\n> 引用正文\n\n$$\nx^2+y^2\n$$\n\n末尾');
    await context(page.locator('.ProseMirror h1')); await choose(page, '标题', '复制标题'); await expect.poll(clipboard).toBe('标题');
    const item = page.locator('.ProseMirror li p').filter({ hasText: '第二项' }); await context(item); await choose(page, '列表', '复制列表项'); await expect.poll(clipboard).toBe('第二项');
    await context(item); await choose(page, '列表', '增加缩进'); await expect(item.locator('xpath=ancestor::ul')).toHaveCount(2);
    await context(item); await choose(page, '列表', '减少缩进'); await expect(item.locator('xpath=ancestor::ul')).toHaveCount(1);
    await context(page.locator('.ProseMirror li p').first()); await expect(page.getByRole('menuitem', { name: '增加缩进', exact: true })).toBeDisabled(); await page.keyboard.press('Escape');
    const code = page.locator('.milkdown-code-block:not(.math-block)'); await context(code); await choose(page, '代码块', '缩进至列表'); await expect(code.locator('xpath=ancestor::li')).toHaveCount(1);
    await context(code); await choose(page, '代码块', '脱离列表'); await expect(code.locator('xpath=ancestor::li')).toHaveCount(0);
    await context(code); await choose(page, '代码块', '引用'); await expect(code.locator('xpath=ancestor::blockquote')).toHaveCount(1);
    await context(code); await choose(page, '代码块', '去除一层引用'); await expect(code.locator('xpath=ancestor::blockquote')).toHaveCount(0);
    await context(page.locator('.ProseMirror blockquote')); await choose(page, '引用', '复制引用'); await expect.poll(clipboard).toBe('引用正文');
    const math = page.locator('.math-block'); await context(math); await choose(page, '公式块', '复制公式'); await expect.poll(clipboard).toBe('x^2+y^2');
    await context(math); await choose(page, '公式块', '引用'); await expect(math.locator('xpath=ancestor::blockquote')).toHaveCount(1);
    await context(math); await choose(page, '公式块', '去除一层引用'); await expect(math.locator('xpath=ancestor::blockquote')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Ordinary and tabbed code menus copy/format the clicked code, run the correct block, reveal its data and export only result text', async () => {
  test.setTimeout(90000); const { app, page, data, root, errors } = await fixture(); const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await open(page, '代码菜单.md', '```js {id=0011}\nconsole.log( 1+2 );\n```\n\n```tabs {id=0012}\n:::js One\nconst  value=1;\n:::python Two\nprint( 2 )\n```\n\n结束');
    const code = page.locator('.milkdown-code-block').first(); await context(code.locator('.cm-content')); await choose(page, '代码块', '复制代码'); await expect.poll(clipboard).toBe('console.log( 1+2 );');
    await context(code.locator('.cm-content')); await choose(page, '代码块', '格式化代码'); await expect(code.locator('.cm-content')).toContainText('console.log(1 + 2);');
    await context(code.locator('.cm-content')); await choose(page, '代码块', '运行代码块'); await expect(code.locator('.code-output')).toHaveText('3\n');
    await context(code.locator('.cm-content')); await choose(page, '代码块', '查看数据目录'); await expect(page.getByRole('tab', { name: '数据', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.code-data-group.selected')).toContainText('0011');
    const output = code.locator('.code-output'); await context(output); await choose(page, '运行结果', '复制运行结果'); await expect.poll(clipboard).toBe('3\n');
    await context(output); await choose(page, '运行结果', '保存结果为文本文件'); await expect.poll(async () => fs.readdir(path.join(data, 'exports'))).toContain('代码菜单-运行结果.txt'); expect(await fs.readFile(path.join(data, 'exports/代码菜单-运行结果.txt'), 'utf8')).toBe('3\n');
    await context(output); await choose(page, '运行结果', '保存文本到附件'); await expect.poll(async () => fs.readdir(path.join(root, '代码菜单.assets/attachments')).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).toContain('代码菜单-运行结果.txt');
    const tabs = page.locator('[data-tabbed-code]'); await context(tabs.locator('.cm-content')); await choose(page, '标签代码', '复制代码'); await expect.poll(clipboard).toBe('const  value=1;');
    await context(tabs.locator('.cm-content')); await choose(page, '标签代码', '格式化代码'); await expect(tabs.locator('.cm-content')).toHaveText('const value = 1;');
    await context(tabs.locator('.cm-content')); await expect(page.getByRole('menuitem', { name: '运行代码块', exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Local images, drawing previews, Markdown links and external links open, copy, reveal and rename their actual targets', async () => {
  const { app, page, root, errors } = await fixture(); const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await fs.writeFile(path.join(root, '中文图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');
    await page.evaluate(() => window.moyu!.feature('drawing.create', { path: '绘图.excalidraw' }));
    await page.evaluate(() => window.moyu!.create('目标.md','file','目标文档'));
    await open(page, '链接菜单.md', '![图片|80](中文图.svg)\n\n[绘图](绘图.excalidraw)\n\n[本地](目标.md)\n\n[网页](https://example.com/test)\n\n末尾');
    await page.locator('.ProseMirror > p').last().click();
    const preview = page.locator('.attachment-overlay img'); await context(preview); await expect(page.locator('.visual-attachment.editing')).toHaveCount(0);
    await choose(page, '图片', '复制链接'); await expect.poll(clipboard).toBe('![图片|80](中文图.svg)');
    await context(preview); await choose(page, '图片', '复制链接地址'); await expect.poll(clipboard).toBe('中文图.svg');
    await context(preview); await choose(page, '图片', '在文件夹中显示'); expect(await app.evaluate(() => (globalThis as any).__menuCalls.at(-1))).toEqual(['reveal',path.join(root,'中文图.svg')]);
    await context(preview); await choose(page, '图片', '查看图片'); await expect(page.locator('.image-viewer')).toBeVisible();
    await page.locator('.tab-name[title="链接菜单.md"]').click(); await context(preview); await choose(page, '图片', '重命名附件'); await page.getByLabel('名称', { exact: true }).fill('新中文图.svg'); await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await expect.poll(() => fs.access(path.join(root,'新中文图.svg')).then(()=>true,()=>false)).toBe(true); await expect(preview).toHaveAttribute('src',new RegExp(encodeURIComponent('新中文图.svg')));
    const drawing = page.locator('.attachment-overlay svg'); await context(drawing); await choose(page, '绘图', '编辑绘图'); await expect(page.locator('.drawing-editor')).toBeVisible(); await page.locator('.tab-name[title="链接菜单.md"]').click();
    const local = page.locator('.inline-syntax').filter({ hasText: '本地' }); await context(local); await choose(page, 'Markdown链接', '打开链接'); await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','目标.md'); await page.locator('.tab-name[title="链接菜单.md"]').click();
    await context(local); await choose(page, 'Markdown链接', '重命名文件'); await page.getByLabel('名称',{exact:true}).fill('新目标'); await page.getByRole('button',{name:'保存名称',exact:true}).click(); await expect.poll(() => fs.access(path.join(root,'新目标.md')).then(()=>true,()=>false)).toBe(true);
    const remote = page.locator('.inline-syntax').filter({ hasText: '网页' }); await context(remote); await choose(page, '外部链接', '打开链接'); expect(await app.evaluate(() => (globalThis as any).__menuCalls.at(-1))).toEqual(['external','https://example.com/test']);
    await context(remote); await choose(page, '外部链接', '复制链接'); await expect.poll(clipboard).toBe('[网页](https://example.com/test)');
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Each tab closing command retains the clicked tab and closes exactly the intended neighbors', async () => {
  const { app, page, errors } = await fixture(); const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await open(page, '页A.md', 'A'); await open(page, '页B.md', 'B'); await open(page, '页C.md', 'C');
    const tab = page.locator('.tab-name[title="页B.md"]'); await context(tab); await choose(page, '标签页', '复制文件路径'); await expect.poll(clipboard).toBe('页B.md');
    await context(tab); await choose(page, '标签页', '关闭右侧'); await expect(page.locator('.tab-name[title="页C.md"]')).toHaveCount(0); await expect(tab).toBeVisible();
    await open(page,'页C.md'); await context(tab); await choose(page,'标签页','关闭左侧'); await expect(page.locator('.tab-name[title="页A.md"]')).toHaveCount(0); await expect(tab).toBeVisible();
    await open(page,'页A.md'); await context(tab); await choose(page,'标签页','关闭其他'); await expect(page.locator('.tab')).toHaveCount(1); await expect(tab).toBeVisible(); expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('Explorer folder/file menus create, favorite, copy, cut, paste, rename, reveal and recycle the clicked path', async () => {
  const {app,page,root,errors}=await fixture();
  const row=(name:string)=>page.locator(`.tree-item[title="${name}"]`);
  const fileMenu=page.locator('.context-menu:not(.element-menu)');
  const chooseFile=async(label:string)=>{await fileMenu.getByRole('button',{name:label,exact:true}).click();if(!checked.has('文件管理'))checked.set('文件管理',new Set());checked.get('文件管理')!.add(label);await expect(fileMenu).toHaveCount(0);};
  const exists=(name:string)=>fs.access(path.join(root,name)).then(()=>true,()=>false);
  try{
    expect((await page.evaluate(()=>window.moyu!.create('菜单目录','folder'))).ok).toBe(true);
    await context(row('菜单目录'));await fileMenu.screenshot({path:path.resolve(project,'../../work/menu-files-detail.png')});await chooseFile('在这里新建文档');await page.getByLabel('新文件名称',{exact:true}).fill('菜单文档');await page.getByLabel('新文件名称',{exact:true}).press('Enter');await expect.poll(()=>exists('菜单目录/菜单文档.md')).toBe(true);
    await context(row('菜单目录'));await chooseFile('新建子文件夹');await page.getByLabel('新文件夹名称',{exact:true}).fill('子目录');await page.getByLabel('新文件夹名称',{exact:true}).press('Enter');await expect.poll(()=>exists('菜单目录/子目录')).toBe(true);
    if(!await row('菜单目录/菜单文档.md').count())await row('菜单目录').click();await expect(row('菜单目录/菜单文档.md')).toBeVisible();
    await context(row('菜单目录/菜单文档.md'));await chooseFile('收藏文档');await context(row('菜单目录/菜单文档.md'));await expect(fileMenu.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();await chooseFile('取消收藏');
    await context(row('菜单目录/菜单文档.md'));await chooseFile('复制');await context(row('菜单目录/子目录'));await chooseFile('粘贴');await expect.poll(()=>exists('菜单目录/子目录/菜单文档.md')).toBe(true);await expect.poll(()=>exists('菜单目录/菜单文档.md')).toBe(true);
    await context(row('菜单目录/菜单文档.md'));await chooseFile('剪切');await context(row('菜单目录/子目录'));await chooseFile('粘贴');await expect(page.getByRole('status')).toContainText('已经存在'); // A collision must preserve the original.
    await expect.poll(()=>exists('菜单目录/菜单文档.md')).toBe(true);
    await context(row('菜单目录/菜单文档.md'));await chooseFile('重命名');await page.getByLabel('名称',{exact:true}).fill('改名文档');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect.poll(()=>exists('菜单目录/改名文档.md')).toBe(true);
    await context(row('菜单目录/改名文档.md'));await chooseFile('剪切');await context(row('菜单目录/子目录'));await chooseFile('粘贴');await expect.poll(()=>exists('菜单目录/子目录/改名文档.md')).toBe(true);await expect.poll(()=>exists('菜单目录/改名文档.md')).toBe(false);
    await context(row('菜单目录/子目录'));await chooseFile('重命名');await page.getByLabel('名称',{exact:true}).fill('更名目录');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect.poll(()=>exists('菜单目录/更名目录/改名文档.md')).toBe(true);
    await context(row('菜单目录/更名目录'));await chooseFile('在文件管理器中显示');expect(await app.evaluate(()=>(globalThis as any).__menuCalls.at(-1))).toEqual(['reveal',path.join(root,'菜单目录/更名目录')]);
    await context(row('菜单目录/更名目录'));await chooseFile('复制');await context(row('菜单目录'));await chooseFile('粘贴');await expect.poll(()=>exists('菜单目录/更名目录 副本/改名文档.md')).toBe(true);
    expect((await page.evaluate(()=>window.moyu!.create('接收目录','folder'))).ok).toBe(true);await context(row('菜单目录/更名目录 副本'));await chooseFile('剪切');await context(row('接收目录'));await chooseFile('粘贴');await expect.poll(()=>exists('接收目录/更名目录 副本/改名文档.md')).toBe(true);await expect.poll(()=>exists('菜单目录/更名目录 副本')).toBe(false);
    await context(row('菜单目录/更名目录'));await chooseFile('移至回收站');await page.getByRole('dialog').getByRole('button',{name:'移至回收站',exact:true}).click();await expect.poll(()=>exists('菜单目录/更名目录')).toBe(false);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Image viewer and reading links copy, open, rename, reveal and recycle without Markdown edit commands',async()=>{
  const{app,page,root,errors}=await fixture();const clipboard=()=>app.evaluate(({clipboard})=>clipboard.readText());
  try{
    await fs.writeFile(path.join(root,'独立图.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');
    await open(page,'独立图.svg');const image=page.locator('.image-viewer img');
    await context(image);await choose(page,'图片查看器','复制图片路径');await expect.poll(clipboard).toBe('独立图.svg');
    await context(image);await choose(page,'图片查看器','复制图片说明');await expect.poll(clipboard).toBe('独立图.svg');
    await context(image);await choose(page,'图片查看器','查看图片');await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','独立图.svg');
    await context(image);await choose(page,'图片查看器','在文件夹中显示图片');expect(await app.evaluate(()=>(globalThis as any).__menuCalls.at(-1))).toEqual(['reveal',path.join(root,'独立图.svg')]);
    await context(image);await choose(page,'图片查看器','重命名附件');await page.getByLabel('名称',{exact:true}).fill('更名图.svg');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(image).toHaveAttribute('alt','更名图.svg');
    await context(image);await choose(page,'图片查看器','删除附件');await page.getByRole('dialog').getByRole('button',{name:'移至回收站',exact:true}).click();await expect.poll(()=>fs.access(path.join(root,'更名图.svg')).then(()=>true,()=>false)).toBe(false);
    await open(page,'阅读链接.md','[远程文字](https://example.com/read)\n\n[本地文字](阅读目标.md)\n\n[数据](文本附件.txt)\n\n末尾');await page.evaluate(()=>window.moyu!.create('阅读目标.md','file','目标'));await fs.writeFile(path.join(root,'文本附件.txt'),'data');
    await page.getByRole('button',{name:'阅读',exact:true}).click();const remote=page.locator('.reading-view a').filter({hasText:'远程文字'}),local=page.locator('.reading-view a').filter({hasText:'本地文字'}),attachment=page.locator('.reading-view a').filter({hasText:'数据'});
    await context(remote);await choose(page,'阅读链接','复制链接文字');await expect.poll(clipboard).toBe('远程文字');
    await context(remote);await choose(page,'阅读链接','复制链接地址');await expect.poll(clipboard).toBe('https://example.com/read');
    await context(remote);await choose(page,'阅读链接','打开链接');expect(await app.evaluate(()=>(globalThis as any).__menuCalls.at(-1))).toEqual(['external','https://example.com/read']);
    await context(local);await choose(page,'阅读本地链接','打开链接');await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title','阅读目标.md');await page.locator('.tab-name[title="阅读链接.md"]').click();
    await context(local);await choose(page,'阅读本地链接','重命名文件');await page.getByLabel('名称',{exact:true}).fill('更名目标');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(local).toHaveAttribute('href','更名目标.md');
    await context(attachment);await choose(page,'阅读附件','重命名附件');await page.getByLabel('名称',{exact:true}).fill('更名附件.txt');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(attachment).toHaveAttribute('href','更名附件.txt');
    await context(attachment);await choose(page,'阅读附件','删除附件');await page.getByRole('dialog').getByRole('button',{name:'移至回收站',exact:true}).click();await expect(attachment).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Result file previews copy their own text and PDF selection menus copy readable text',async()=>{
  const{app,page,root,errors}=await fixture(false);const clipboard=()=>app.evaluate(({clipboard})=>clipboard.readText());
  try{
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();window.webContents.focus();});
    await open(page,'结果文件.md','```python\nwith open("/output/message.txt", "w") as f:\n    f.write("artifact text")\nprint("console output")\n```');await context(page.locator('.milkdown-code-block .cm-content'));await choose(page,'代码块','运行代码块');
    const text=page.getByLabel('文件内容预览');await expect(text).toHaveText('artifact text',{timeout:30000});await context(text);await choose(page,'结果文件','复制文本');await expect.poll(clipboard).toBe('artifact text');
    const stream='BT /F1 24 Tf 40 100 Td (PDF menu text) Tj ET',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf='%PDF-1.4\n',offsets:number[]=[];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF`;
    await fs.writeFile(path.join(root,'菜单.pdf'),pdf);await open(page,'菜单.pdf');const reader=page.locator('.pdf-viewer embedpdf-container');await expect(reader.locator('img').first()).toBeVisible();
    // EmbedPDF owns its text selection; browser DOM ranges from PDF.js no
    // longer represent a selected PDF range. Use its public range API, then
    // exercise the real reader copy control and native clipboard.
    const pointer=await reader.evaluate(async(element:any)=>(await element.registry).getPlugin('commands').provides().resolve('pointer:toggle').label);await reader.getByRole('button',{name:pointer,exact:true}).click();
    await reader.evaluate(async(element:any)=>{const selection=(await element.registry).getPlugin('selection').provides();await new Promise((resolve,reject)=>selection.setSelection({start:{page:0,index:0},end:{page:0,index:1000}}).wait(resolve,reject));});
    await reader.getByRole('button',{name:'复制',exact:true}).click();await expect.poll(clipboard).toBe('PDF menu text');
    await page.evaluate(()=>{const frame=document.createElement('iframe');frame.title='剪贴板权限边界';frame.srcdoc='<button>尝试写入</button>';frame.style.cssText='position:fixed;left:10px;top:100px;z-index:10000;width:200px;height:70px;background:white';document.body.append(frame);});
    const child=page.frameLocator('iframe[title="剪贴板权限边界"]'),attempt=child.getByRole('button',{name:'尝试写入',exact:true});await attempt.evaluate(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('child frame');document.body.textContent='ALLOWED';}catch{document.body.textContent='DENIED';}}));await attempt.click();await expect(child.locator('body')).toHaveText('DENIED');expect(await clipboard()).toBe('PDF menu text');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});

test('Reading code and formulas copy source and run/reveal the correct block; ordinary attachment links open internally',async()=>{
  const{app,page,root,errors}=await fixture();const clipboard=()=>app.evaluate(({clipboard})=>clipboard.readText());
  try{
    await fs.writeFile(path.join(root,'打开附件.txt'),'attachment data');
    await open(page,'阅读代码.md','[文件](打开附件.txt)\n\n```js {id=0013}\nconsole.log(42);\n```\n\n```tabs {id=0014}\n:::js One\nconsole.log(1);\n:::python Two\nprint(2)\n```\n\n$$\nx^2\n$$\n\n末尾');
    await context(page.locator('.inline-syntax').filter({hasText:'文件'}));await choose(page,'文件附件','打开附件');await expect(page.locator('.text-file-editor .cm-content')).toHaveText('attachment data');await page.locator('.tab-name[title="阅读代码.md"]').click();
    await page.getByRole('button',{name:'阅读',exact:true}).click();const code=page.locator('.reading-view .code-block-shell').first();
    await context(code.locator(':scope > pre'));await choose(page,'阅读代码','复制代码');await expect.poll(clipboard).toBe('console.log(42);');
    await context(code.locator(':scope > pre'));await choose(page,'阅读代码','运行代码块');await expect(page.locator('.code-output')).toHaveText('42\n');
    await context(code.locator(':scope > pre'));await choose(page,'阅读代码','查看数据目录');await expect(page.locator('.code-data-group.selected')).toContainText('0013');
    const tabs=page.locator('.reading-view [data-tabbed-code]');await tabs.getByRole('tab',{name:'Two',exact:true}).click();await context(tabs.locator('[data-code-pane="1"] code'));await choose(page,'阅读标签代码','复制代码');await expect.poll(clipboard).toBe(':::js One\nconsole.log(1);\n:::python Two\nprint(2)');
    await context(page.locator('.reading-view .katex-display'));await expect(page.getByRole('menuitem',{name:/引用|格式化|运行|插入/})).toHaveCount(0);await choose(page,'阅读公式','复制公式');await expect.poll(clipboard).toBe('x^2');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
