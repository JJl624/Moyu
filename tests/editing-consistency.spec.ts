import {editPreviewReference} from './attachment-helper';
import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test, type Page, type Locator } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/editing-consistency-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({version: 1, values: {'moyu-save-policy': 'manual'}}));
  const env = {...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: '1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE
    ? {executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env} : {args: [project], env});
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return {app, page, data, errors};
}
async function open(page: Page, file: string, content: string) {
  await page.evaluate(({file, content}) => window.moyu!.create(file, 'file', content), {file, content});
  await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}
async function place(element: Locator, start: number, end = start) {
  await element.evaluate((el, {start, end}) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes: Node[] = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('.syntax-preview')) nodes.push(walker.currentNode);
    const point = (offset: number): [Node, number] => {
      for (const node of nodes) {if (offset <= node.textContent!.length) return [node, offset]; offset -= node.textContent!.length;}
      throw Error('Text offset unavailable');
    };
    const a = point(start), b = point(end);
    el.closest<HTMLElement>('.ProseMirror')!.focus({preventScroll: true});
    document.getSelection()!.setBaseAndExtent(a[0], a[1], b[0], b[1]);
  }, {start, end});
  await element.page().waitForTimeout(40);
}
async function raw(element: Locator) {
  return element.evaluate(el => {const copy = el.cloneNode(true) as HTMLElement; copy.querySelectorAll('.syntax-preview').forEach(n => n.remove()); return copy.textContent;});
}
test('Only custom body highlighting is removed; native code and source highlighting remains', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await open(page, '原生高亮.md', '正文\n\n```js\nconsole.log(1)\nconsole.log(2)\n```\n');
    await page.locator('.ProseMirror p').click(); await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', {name: '切换主题', exact: true}).click();
      await page.getByRole('button', {name: '预览编辑', exact: true}).click();
      await page.locator('.milkdown-code-block .cm-content').click();
      await expect(page.locator('.milkdown-code-block .cm-activeLine')).toHaveCount(1);
      await expect(page.locator('.milkdown-code-block .cm-activeLine')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.getByRole('button', {name: '源码', exact: true}).click();
      await page.locator('.source-editor .cm-content').click();
      await expect(page.locator('.source-editor .cm-activeLine')).toHaveCount(1);
      await expect(page.locator('.source-editor .cm-activeLine')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await page.getByRole('button', {name: '偏好设置', exact: true}).click();
    await selectPreference(page,'编辑');
    await expect(page.getByRole('switch', {name: '高亮光标所在行'})).toHaveCount(0);
    expect(JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8')).values).not.toHaveProperty('moyu-highlight-line');
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Tail paragraph insertion survives removal of the body highlighting plugin', async () => {
  const {app, page, errors} = await fixture();
  try {
    await open(page, '末尾编辑.md', '```js\nconsole.log(1)\n```\n');
    await page.locator('.ProseMirror').evaluate(el => {
      const rect = el.querySelector('.milkdown-code-block')!.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, button: 0, clientX: rect.left + 30, clientY: rect.bottom + 12}));
    });
    await expect(page.locator('.ProseMirror > p')).toHaveCount(1);
    await page.keyboard.insertText('末尾输入'); await expect(page.locator('.ProseMirror > p')).toHaveText('末尾输入');
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0); expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Tab before an image stays at the same position; list indentation and outdent preserve source', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await fs.writeFile(path.join(data, '示例知识库', '图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');
    await open(page, 'Tab.md', '前文\n\n![图](图.svg)\n\n- 第一项\n- ![图](图.svg)\n\n后文\n');
    const regions = page.locator('.visual-attachment');
    await editPreviewReference(page,page.locator('.attachment-overlay').first());
    await place(regions.first().locator('.syntax-raw'), 0);
    await page.keyboard.press('Tab');
    await expect.poll(() => raw(page.locator('.ProseMirror > p').nth(1))).toBe('    ![图](图.svg)');
    expect(await regions.first().evaluate(el => el.contains(getSelection()?.focusNode || null))).toBe(true);
    const first = page.locator('.ProseMirror li').first().locator('p').first();
    await first.click(); await place(first, 0); await page.keyboard.press('Tab');
    await expect(page.locator('.ProseMirror li')).toHaveCount(2);
    expect(await first.evaluate(el => el.contains(getSelection()?.focusNode || null))).toBe(true);
    await editPreviewReference(page,page.locator('.attachment-overlay').last()); await place(regions.last().locator('.syntax-raw'), 0);
    await page.keyboard.press('Tab'); await expect(page.locator('.ProseMirror li li')).toHaveCount(1);
    expect(await regions.last().evaluate(el => el.contains(getSelection()?.focusNode || null))).toBe(true);
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('.ProseMirror li li')).toHaveCount(0);
    await expect.poll(() => raw(regions.last())).toBe('![图](图.svg)'); expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Pasted Markdown and rich HTML styles use the same editable delimiters', async () => {
  const {app, page, errors} = await fixture();
  try {
    for (const html of ['', '<p>前 <code>�</code> <span style="font-weight:700">粗体</span> 后</p>']) {
      await open(page, html ? 'HTML粘贴.md' : 'Markdown粘贴.md', '待替换\n');
      const paragraph = page.locator('.ProseMirror p'); await paragraph.click(); await place(paragraph, 0, 3);
      await paragraph.evaluate((el, html) => {
        const data = new DataTransfer(); data.setData('text/plain', '前 `�` **粗体** 后'); if (html) data.setData('text/html', html);
        el.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}));
      }, html);
      await expect.poll(() => raw(paragraph)).toBe('前 `�` **粗体** 后');
      const code = paragraph.locator('.inline-syntax').filter({hasText: '�'}).first();
      await code.click(); await expect(code.locator('.syntax-raw')).toHaveText('`�`');
      await place(code.locator('.syntax-raw'), 3); await page.keyboard.press('Backspace');
      await expect.poll(() => raw(paragraph)).toBe('前 `� **粗体** 后');
      await page.keyboard.type('`'); await expect.poll(() => raw(paragraph)).toBe('前 `�` **粗体** 后');
      await page.getByRole('button', {name: '源码', exact: true}).click();
      await expect(page.locator('.source-editor .cm-content')).toHaveText('前 `�` **粗体** 后');
      await page.getByRole('button', {name: '预览编辑', exact: true}).click();
    }
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Quote context action removes only the selected layer and undo restores it', async () => {
  const {app, page, errors} = await fixture();
  try {
    for (const [file, content, expected] of [
      ['单层引用.md', '> 前文\n>\n> 中间内容\n>\n> 后文\n', '> 前文\n\n中间内容\n\n> 后文'],
      ['嵌套引用.md', '> > 中间内容\n', '> 中间内容'],
    ]) {
      await open(page, file, content); const paragraph = page.locator('.ProseMirror blockquote p').filter({hasText: '中间内容'});
      await paragraph.click(); await place(paragraph, 0, 4);
      // Right-click inside selected characters, rather than the paragraph's empty center.
      const point = await paragraph.evaluate(() => {const r=getSelection()!.getRangeAt(0).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
      await page.mouse.click(point.x,point.y,{button:'right'});
      await page.getByRole('menuitem', {name: '去除一层引用', exact: true}).click();
      await page.locator('.ProseMirror').focus();
      await page.keyboard.press('Control+z');
      await expect(page.locator('.ProseMirror blockquote')).toHaveCount(file === '嵌套引用.md' ? 2 : 1);
      await page.keyboard.press('Control+Shift+z');
      await page.getByRole('button', {name: '源码', exact: true}).click();
      await expect.poll(() => page.locator('.source-editor .cm-line').allTextContents().then(lines => lines.join('\n'))).toBe(expected + '\n');
      await page.getByRole('button', {name: '预览编辑', exact: true}).click();
    }
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Startup does not recreate the absent legacy userData folder', async () => {
  const home = await fs.mkdtemp(path.resolve(project, '../../work/legacy-startup-'));
  const appData = path.join(home, 'app-data'), documents = path.join(home, 'documents');
  await fs.mkdir(appData); await fs.mkdir(documents);
  const entry = path.join(home, 'entry.cjs');
  await fs.writeFile(entry, `const {app}=require('electron');app.setName('moyu-editor');app.setPath('appData',${JSON.stringify(appData)});app.setPath('documents',${JSON.stringify(documents)});require(${JSON.stringify(path.join(project, 'electron/main.cjs'))});`);
  const env = {...process.env, MOYU_DEMO: '1', MOYU_TEST: '1', MOYU_TEST_OFFSCREEN: '1'};
  delete env.ELECTRON_RUN_AS_NODE; delete env.MOYU_USER_DATA;
  for (let pass=0; pass<2; pass++) {
    const app = await electron.launch({args: [entry], env});
    try {
      const page = await app.firstWindow(); await expect(page.locator('.ProseMirror h1')).toBeVisible();
      const result: any = await page.evaluate(() => window.moyu!.feature('data.list'));
      expect(result.ok).toBe(true); expect(result.data.find((x:any) => x.id === 'directory').path).toBe(path.join(documents, 'MoyuData'));
      expect(await fs.stat(path.join(appData, 'moyu-editor')).catch(() => null)).toBeNull();
    } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
    expect(await fs.stat(path.join(appData, 'moyu-editor')).catch(() => null)).toBeNull();
  }
});
test('Image previews and context menus remeasure when the window shrinks and returns', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await fs.writeFile(path.join(data, '示例知识库', '大图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240"/></svg>');
    await open(page, '调整大小.md', '前文\n\n![图](大图.svg)\n\n后文\n');
    const overlay = page.locator('.attachment-overlay'), space = page.locator('.attachment-space');
    await expect(overlay.locator('img')).toBeVisible();
    await expect.poll(() => overlay.locator('img').evaluate((el:HTMLImageElement) => el.naturalWidth)).toBe(1200);
    const original = await overlay.boundingBox();
    const bounds = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getBounds());
    for (const width of [850, bounds.width]) {
      await app.evaluate(({BrowserWindow}, width) => BrowserWindow.getAllWindows()[0].setSize(width, 820), width);
      await expect.poll(async () => {
        const a = (await overlay.boundingBox())!, b = (await space.boundingBox())!;
        return Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.width-b.width)+Math.abs(a.height-b.height);
      }).toBeLessThan(3);
    }
    expect(Math.abs((await overlay.boundingBox())!.width-original!.width)).toBeLessThan(2);
    await page.locator('.ProseMirror p').last().click({button: 'right'}); const menu = page.getByRole('menu');
    for (const width of [850, bounds.width]) {
      await app.evaluate(({BrowserWindow}, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), width);
      await expect.poll(() => menu.evaluate(el => {const r=el.getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('Old environment cleanup is explicit and missing old directories remain absent', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await expect.poll(() => page.evaluate(() => window.moyu!.feature('data.cleanup-list'))).toMatchObject({ok: true, data: []});
    expect(await fs.stat(path.join(data, 'programs')).catch(() => null)).toBeNull();
    const old = path.join(data, 'programs', '0.17.1-64-0123456789abcdef'); await fs.mkdir(old, {recursive: true}); await fs.writeFile(path.join(old, 'test.txt'), 'fixture');
    await page.getByRole('button', {name: '偏好设置', exact: true}).click();
    await selectPreference(page,'数据与运行环境');
    const section = page.getByLabel('旧环境', {exact: true}); await expect(section).toContainText(old);
    await section.locator('summary').click();
    await section.getByRole('button', {name: /^删除数据 /}).click();
    expect(await fs.stat(old).catch(() => null)).not.toBeNull();
    await section.getByRole('button', {name: '确认清理', exact: true}).click();
    await expect(section).toHaveCount(0); expect(await fs.stat(old).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(data, 'settings.json')).catch(() => null)).not.toBeNull(); expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
test('New and reusable preview tabs open after the current tab; closing selects its left neighbor', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    for (const file of ['A.md', 'B.md', 'C.md', 'D.txt', 'E.md', 'F.txt']) {
      await fs.writeFile(path.join(data, '示例知识库', file), file);
    }
    const tab = (file: string) => page.locator(`.tab-name[title="${file}"]`);
    const titles = () => page.locator('.tab-name').evaluateAll(elements => elements.map(el => el.getAttribute('title')));
    const prefix = await titles();
    for (const file of ['A.md', 'B.md', 'C.md']) await page.locator(`.tree-item[title="${file}"]`).dblclick();
    await tab('A.md').click(); await page.locator('.tree-item[title="D.txt"]').dblclick();
    await expect.poll(titles).toEqual([...prefix, 'A.md', 'D.txt', 'B.md', 'C.md']);
    await page.locator('.tab.active .tab-close').click(); await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', 'A.md');
    await page.locator('.tree-item[title="E.md"]').click(); await expect(page.locator('.tab.active')).toHaveClass(/preview/);
    await expect.poll(titles).toEqual([...prefix, 'A.md', 'E.md', 'B.md', 'C.md']);
    await tab('B.md').click(); await page.locator('.tree-item[title="F.txt"]').click();
    await expect.poll(titles).toEqual([...prefix, 'A.md', 'B.md', 'F.txt', 'C.md']);
    await page.locator('.tab.active .tab-close').click(); await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', 'B.md');
    await tab('A.md').click(); await page.locator('.tab-name[title="C.md"]').locator('..').getByRole('button', {name: /关闭/}).click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', 'A.md');
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
