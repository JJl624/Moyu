import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/close-paste-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env } : { args: [project], env });
  const page = await app.firstWindow(); await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w => { w.show(); w.focus(); w.webContents.focus(); });
  return { app, page, data, root: path.join(data, '示例知识库') };
}
async function dirtyPair(page: import('@playwright/test').Page) {
  for (const name of ['A', 'B']) {
    await page.evaluate(name => window.moyu!.create(name + '.md', 'file', name + '-original'), name);
    await page.locator(`.tree-item[title="${name}.md"]`).dblclick();
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('-' + name + '-new');
  }
}
for (const target of ['tab', 'window']) test(`Closing ${target} B while A saves preserves both latest buffers`, async () => {
  const { app, page, root } = await fixture();
  try {
    await dirtyPair(page);
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'编辑');
    await page.getByLabel('保存方式', { exact: true }).selectOption('close'); await page.keyboard.press('Escape');
    await app.evaluate(() => {
      const filesystem = process.getBuiltinModule('fs/promises'), original = filesystem.writeFile;
      filesystem.writeFile = async (...args: Parameters<typeof original>) => {
        if (typeof args[1] === 'string' && args[1].includes('A-new') && String(args[0]).endsWith('.tmp')) {
          (globalThis as any).__saveBlocked = true;
          await new Promise<void>(resolve => { (globalThis as any).__releaseSave = resolve; });
        }
        return original(...args);
      };
    });
    await page.getByRole('button', { name: '关闭 A', exact: true }).click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__saveBlocked)).toBe(true);
    if (target === 'tab') await page.getByRole('button', { name: '关闭 B', exact: true }).click();
    else await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await app.evaluate(() => { (globalThis as any).__releaseSave(); });
    await expect.poll(() => fs.readFile(path.join(root, 'A.md'), 'utf8')).toContain('A-new');
    await expect.poll(() => fs.readFile(path.join(root, 'B.md'), 'utf8')).toContain('B-new');
    if (target === 'tab') await expect(page.getByRole('button', { name: '关闭 B', exact: true })).toHaveCount(0);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
test('Discarding A never reuses that decision for a separately cancelled B close', async () => {
  const { app, page, root } = await fixture();
  try {
    await dirtyPair(page);
    await app.evaluate(({ dialog }) => {
      (globalThis as any).__closePrompts = [];
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args.at(-1); (globalThis as any).__closePrompts.push(options.detail);
        if (options.detail.includes('A.md')) return new Promise(resolve => { (globalThis as any).__discardA = () => resolve({ response: 1, checkboxChecked: false }); });
        return { response: 2, checkboxChecked: false };
      };
    });
    await page.getByRole('button', { name: '关闭 A', exact: true }).click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__discardA)).toBe(true);
    await page.getByRole('button', { name: '关闭 B', exact: true }).click();
    await app.evaluate(() => (globalThis as any).__discardA());
    await expect.poll(() => app.evaluate(() => (globalThis as any).__closePrompts)).toEqual(['A.md', 'B.md']);
    await expect(page.getByRole('button', { name: '关闭 B', exact: true })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toContainText('B-new');
    expect(await fs.readFile(path.join(root, 'B.md'), 'utf8')).toBe('B-original');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
for (const mode of ['preview', 'source']) test(`External image descriptions remain alt text in ${mode}, never filenames`, async () => {
  const { app, page, root } = await fixture();
  try {
    await page.evaluate(() => window.moyu!.create('粘贴图片.md', 'file', '位置\n'));
    await page.locator('.tree-item[title="粘贴图片.md"]').dblclick();
    if (mode === 'source') await page.getByRole('button', { name: '源码', exact: true }).click();
    const selector = mode === 'source' ? '.source-editor .cm-content' : '.ProseMirror';
    const png = (await fs.readFile(path.join(project, 'resources/icon.png'))).toString('base64');
    for (const [index, alt] of ['avatar/01.png', 'https://example.com/avatar/01.png', 'folder\\avatar.png', '', '名字 [01].png'].entries()) {
      await page.locator(selector).focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
      await page.locator(selector).evaluate((element, { png, alt, file }) => {
        const data = new DataTransfer(), image = document.createElement('img'); image.src = 'data:image/png;base64,' + png; image.alt = alt;
        data.setData('text/html', image.outerHTML);
        if (file) data.items.add(new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'external.png', { type: 'image/png' }));
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, { png, alt, file: index % 2 === 1 });
      const label = alt.replace(/[\\\[\]]/g, '\\$&');
      if (mode === 'source') await expect(page.locator(selector)).toContainText('![' + label + '](');
      else await expect(page.locator('.visual-attachment')).toHaveCount(index + 1);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('moyu:command', 'save'));
      await expect.poll(() => fs.readFile(path.join(root, '粘贴图片.md'), 'utf8')).toContain('![' + label + '](');
    }
    const names = await fs.readdir(path.join(root, '粘贴图片.assets/attachments'));
    expect(names).toHaveLength(5); expect(names.every(name => !/[\\/:]/.test(name))).toBe(true);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
