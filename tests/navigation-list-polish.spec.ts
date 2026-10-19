import { _electron as electron, expect, test, type Page, type Locator } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/navigation-list-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({version: 1, values: {'moyu-save-policy': 'manual'}}));
  const env = {...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: '1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE ? {executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env} : {args: [project], env});
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return {app, page, data, errors};
}
async function open(page: Page, file: string, content?: string) {
  if (content !== undefined) expect((await page.evaluate(({file, content}) => window.moyu!.create(file, 'file', content), {file, content})).ok).toBe(true);
  await expect(page.locator(`.tree-item[title="${file}"]`)).toBeVisible();
  await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', file);
  if (/\.md$/.test(file)) await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}
async function caret(target: Locator) {
  await target.evaluate(el => {
    el.closest<HTMLElement>('.ProseMirror')!.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    if (!walker.nextNode()) throw Error('Missing list text');
    getSelection()!.setBaseAndExtent(walker.currentNode, 0, walker.currentNode, 0);
  });
  await target.page().waitForTimeout(50);
}
const itemDepth = (target: Locator) => target.locator('xpath=ancestor::li').count();

test('A list item with its own children indents below the preceding mixed-content item; a first item keeps its level', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await fs.writeFile(path.join(data, '示例知识库', '图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50"><rect width="90" height="50"/></svg>');
    for (const marker of ['-', '1.']) {
      const pad = marker === '-' ? '  ' : '   ';
      await open(page, marker === '-' ? '无序缩进.md' : '有序缩进.md', `${marker} 第一项\n${pad}- 子项\n${pad}- 另一个子项\n\n${pad}  12312![绘图](图.svg)\n${marker} 123\n\n${pad}-\n${pad}- 第二项\n\n末尾`);
      const item = page.locator('.ProseMirror p').filter({hasText: /^123$/});
      await expect(item).toHaveCount(1);
      await expect.poll(() => itemDepth(item)).toBe(1);
      await caret(item); await page.keyboard.press('Tab');
      await expect.poll(() => itemDepth(item)).toBe(2);
      await expect(page.locator('.visual-attachment')).toHaveCount(1);
      await expect(page.locator('.ProseMirror p').filter({hasText: /^第二项$/})).toBeVisible();
      await page.keyboard.press('Shift+Tab'); await expect.poll(() => itemDepth(item)).toBe(1);
      await item.click({button: 'right'});
      await page.getByRole('menuitem', {name: '增加缩进', exact: true}).click();
      await expect.poll(() => itemDepth(item)).toBe(2);
      await page.locator('.ProseMirror').focus(); await page.keyboard.press('Control+z');
      await expect.poll(() => itemDepth(item)).toBe(1);
      const first = page.locator('.ProseMirror p').filter({hasText: /^第一项$/});
      await caret(first); await page.keyboard.press('Tab'); await expect.poll(() => itemDepth(first)).toBe(1);
      await first.click({button: 'right'}); await expect(page.getByRole('menuitem', {name: '增加缩进', exact: true})).toBeDisabled();
      await page.keyboard.press('Escape');
    }
    // Changing the bullet marker starts a separate CommonMark list, as in the reported file.
    await open(page, '不同标记.md', '* 第一项\n  * 子项\n  * 另一个子项\n\n    12312![绘图](图.svg)\n\n- 123\n  *\n  * 第二项\n');
    await expect(page.locator('.ProseMirror > ul')).toHaveCount(2);
    const firstOfNewList = page.locator('.ProseMirror > ul').nth(1).locator('p').first();
    await expect(firstOfNewList).toContainText('123');
    await caret(firstOfNewList); await page.keyboard.press('Tab'); await expect.poll(() => itemDepth(firstOfNewList)).toBe(1);
    await firstOfNewList.click({button: 'right'}); await expect(page.getByRole('menuitem', {name: '增加缩进', exact: true})).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});

test('Tool pages omit the workspace picker; file navigation remains available and the window-control gap is draggable', async () => {
  const {app, page, errors} = await fixture();
  try {
    const tools = page.getByRole('navigation', {name: '工具栏'});
    for (const name of ['全文搜索', '收藏', '文档历史', 'WebDAV 同步', 'Excalidraw 绘图']) {
      await tools.getByRole('button', {name, exact: true}).click();
      await expect(page.locator('.sidebar .workspace-picker')).toHaveCount(0);
    }
    await tools.getByRole('button', {name: '文件', exact: true}).click();
    await expect(page.locator('.sidebar .workspace-picker')).toHaveCount(1);
    await page.getByRole('button', {name: '知识库导航', exact: true}).click();
    await expect(page.getByRole('dialog', {name: '知识库', exact: true})).toBeVisible();
    await page.getByRole('button', {name: '关闭对话框', exact: true}).click();
    const gap = page.locator('.window-drag-space');
    await expect(gap).toBeVisible();
    await expect(gap).toHaveCSS('-webkit-app-region', 'drag');
    expect(await gap.evaluate(el => {
      const bounds = el.getBoundingClientRect(), info = el.previousElementSibling!.getBoundingClientRect(), controls = el.nextElementSibling!.getBoundingClientRect();
      return bounds.width >= 12 && bounds.height > 20 && bounds.left >= info.right && bounds.right <= controls.left;
    })).toBe(true);
    await expect(page.locator('.window-controls')).toHaveCSS('-webkit-app-region', 'no-drag');
    await expect(page.getByRole('button', {name: '最小化窗口', exact: true})).toHaveCSS('-webkit-app-region', 'no-drag');
    await page.screenshot({path: path.resolve(project, '../../work/navigation-toolbar-v1720.png')});
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});

test('The left close button remains visible at minimum width and closes Markdown, text and image files to the previous tab', async () => {
  const {app, page, data, errors} = await fixture();
  try {
    await open(page, '前一个.md', '# 前一个');
    for (const file of ['当前.md', '当前.txt', '当前.svg']) {
      if (file.endsWith('.md')) await open(page, file, '# 当前');
      else {
        await fs.writeFile(path.join(data, '示例知识库', file), file.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50"><rect width="90" height="50"/></svg>' : '当前');
        await open(page, file);
      }
      const close = page.getByRole('button', {name: '关闭当前文档', exact: true});
      await expect(close).toBeVisible();
      expect(await close.evaluate(button => button.parentElement!.firstElementChild === button)).toBe(true);
      if (!file.endsWith('.svg')) await expect(page.locator('.breadcrumbs').getByRole('button', {name: '关闭当前文档', exact: true})).toBeVisible();
      await expect(page.locator('.document-actions').getByRole('button', {name: '关闭当前文档', exact: true})).toHaveCount(0);
      await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(900, 650));
      await expect(close).toBeVisible();
      await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 850));
      await close.click();
      await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '前一个.md');
      await expect(page.locator(`.tab-name[title="${file}"]`)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => {});}
});
