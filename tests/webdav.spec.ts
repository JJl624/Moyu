import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { davServer } = require('./helpers/dav-server.cjs');
const project = path.resolve(import.meta.dirname, '..');

test('WebDAV panel synchronizes saved edits, refreshes open documents, resolves conflicts and protects a missing collection', async () => {
  test.setTimeout(90000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'webdav-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: '1',
    MOYU_DEMO: '1',
    MOYU_TEST_OFFSCREEN: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const server = await davServer({ denyRoot: true });
  server.directories.add('/Moyu');
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow(), root = path.join(data, '示例知识库');
    page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    );
    await page.evaluate(() => {
      const pixel = document.createElement('div');
      pixel.style.cssText =
        'position:fixed;bottom:0;right:0;width:1px;height:1px;pointer-events:none';
      document.body.append(pixel);
      let odd = false;
      setInterval(() => {
        pixel.style.backgroundColor = (odd = !odd) ? '#111' : '#222';
      }, 16);
    });
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    await page.evaluate(() => window.moyu!.create('同步测试.md', 'file', '# 同步测试\n\n原文'));
    await page.locator('.tree-item[title="同步测试.md"]').dblclick();
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('未保存编辑');
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    await page.getByRole('button', { name: 'WebDAV 设置', exact: true }).click();
    await page.getByRole('textbox', { name: 'WebDAV 地址', exact: true }).fill(server.url);
    await page.getByRole('textbox', { name: '用户名', exact: true }).fill('user');
    await page.getByRole('textbox', { name: '密码', exact: true }).fill('secret');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.locator('.feature-message')).toHaveText('连接成功');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const synchronize = async () => {
      await page.getByRole('button', { name: '立即同步', exact: true }).click();
      await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
      if (await page.getByRole('button', { name: '开始同步', exact: true }).count()) {
        await page.getByRole('button', { name: '开始同步', exact: true }).click();
        await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
      }
    };
    await synchronize();
    await expect(page.locator('.feature-message')).toContainText('已同步');
    expect(server.files.get('/Moyu/同步测试.md').toString()).not.toContain('未保存编辑');
    expect(await fs.readFile(path.join(root, '同步测试.md'), 'utf8')).not.toContain('未保存编辑');
    await expect(page.locator('.ProseMirror')).toContainText('未保存编辑');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('moyu:command', 'save'));
    await expect.poll(() => fs.readFile(path.join(root, '同步测试.md'), 'utf8')).toContain('未保存编辑');
    await synchronize();
    expect(server.files.get('/Moyu/同步测试.md').toString()).toContain('未保存编辑');
    server.files.set('/Moyu/同步测试.md', Buffer.from('# 同步测试\n\n远端正文'));
    server.files.set('/Moyu/下载.md', Buffer.from('# 下载'));
    await synchronize();
    await expect(page.locator('.ProseMirror')).toContainText('远端正文');
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.locator('.tree-item[title="下载.md"]')).toBeVisible();
    await expect(page.getByLabel('同步测试.md，WebDAV：已同步', { exact: true })).toBeVisible();
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('本地更改');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('moyu:command', 'save'));
    await expect.poll(() => fs.readFile(path.join(root, '同步测试.md'), 'utf8')).toContain('本地更改');
    server.files.set('/Moyu/同步测试.md', Buffer.from('# 同步测试\n\n冲突远端'));
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    await synchronize();
    await expect(page.locator('.sync-conflict')).toContainText('同步测试.md 冲突');
    server.directories.add('/Other');
    await page.getByRole('button', { name: 'WebDAV 设置', exact: true }).click();
    await page.getByRole('textbox', { name: '远端目录', exact: true }).fill('/Other');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(page.locator('.sync-conflict')).toHaveCount(0);
    await synchronize();
    expect(server.files.get('/Other/同步测试.md').toString()).toContain('本地更改');
    await page.getByRole('button', { name: 'WebDAV 设置', exact: true }).click();
    await page.getByRole('textbox', { name: '远端目录', exact: true }).fill('/Moyu');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(page.locator('.sync-conflict')).toContainText('同步测试.md 冲突');
    await page.locator('.sync-conflict summary').click();
    await page.getByRole('button', { name: '保留远端', exact: true }).click();
    await expect(page.locator('.sync-conflict')).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toContainText('冲突远端');
    const copies = await fs.readdir(path.join(root, '.data', 'conflicts'));
    expect(copies).toHaveLength(2);
    expect(copies[0]).toContain('同步测试-远端冲突');
    expect(await fs.readFile(path.join(root, '同步测试.md'), 'utf8')).not.toContain('本地更改');
    server.files.delete('/Moyu/下载.md');
    await synchronize();
    await assertAbsent(path.join(root, '下载.md'));
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.locator('.tree-item[title="下载.md"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    const keep = await fs.readFile(path.join(root, '同步测试.md'), 'utf8');
    server.files.clear();
    server.directories.delete('/Moyu');
    await synchronize();
    await expect(page.locator('.feature-error')).toContainText('远端同步目录不存在');
    expect(await fs.readFile(path.join(root, '同步测试.md'), 'utf8')).toBe(keep);
    expect(server.directories.has('/Moyu')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await server.close();
  }
});
async function assertAbsent(file: string) {
  await expect.poll(() =>
    fs.stat(file).then(() => true, e => {
      if (e.code !== 'ENOENT') throw e;
      return false;
    })
  ).toBe(false);
}
