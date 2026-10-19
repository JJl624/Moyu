import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');

async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/dirty-roundtrip-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30000 });
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
    w.webContents.setBackgroundThrottling(false);
  });
  return { app, page, data };
}

test('Adding and removing text restores the exact saved Markdown and clears dirty state', async () => {
  const { app, page, data } = await fixture();
  try {
    await app.evaluate(({ dialog }) => {
      (globalThis as any).__unexpectedClosePrompts = 0;
      dialog.showMessageBox = async () => {
        (globalThis as any).__unexpectedClosePrompts++;
        return { response: 2, checkboxChecked: false };
      };
    });
    const fixtures = [
      '',
      '普通文字',
      '普通文字\n',
      '# 标题\r\n\r\n普通文字\r\n',
      '# 标题\n\n普通文字\r\n',
      '* 项目\n\n普通文字\n',
      '```js {id=0001}\nconsole.log(1);\n```\n\n普通文字\n',
    ];
    for (const [index, original] of fixtures.entries()) {
      const name = `恢复原文${index}.md`;
      await page.evaluate(({ name, original }) => window.moyu!.create(name, 'file', original), {
        name,
        original,
      });
      await page.locator(`.tree-item[title="${name}"]`).dblclick();
      await expect(page.locator('.save-status')).toContainText('已保存到本地');
      await page.locator('.ProseMirror > p').last().click();
      await page.keyboard.press('End');
      await page.keyboard.insertText('测试');
      await expect(page.locator('.save-status')).toContainText('本地未保存');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect(page.locator('.save-status')).toContainText('已保存到本地');
      await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await expect.poll(() =>
        page.locator('.source-editor .cm-line').evaluateAll(lines =>
          lines.map(line => line.textContent).join('\n')
        )
      ).toBe(original.replace(/\r\n/g, '\n'));
      await page.locator('.source-editor .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('测试');
      await expect(page.locator('.save-status')).toContainText('本地未保存');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect(page.locator('.save-status')).toContainText('已保存到本地');
      expect(await fs.readFile(path.join(data, '示例知识库', name), 'utf8')).toBe(original);
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      const close = page.getByRole('button', { name: `关闭 恢复原文${index}`, exact: true });
      await close.click();
      await expect(close).toHaveCount(0);
    }
    expect(await app.evaluate(() => (globalThis as any).__unexpectedClosePrompts)).toBe(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test('A completed save advances the rich-editor baseline without hiding a later real edit', async () => {
  const { app, page, data } = await fixture();
  try {
    await page.evaluate(() => window.moyu!.create('保存基线.md', 'file', '正文'));
    await page.locator('.tree-item[title="保存基线.md"]').dblclick();
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('A');
    await expect(page.locator('.save-status')).toContainText('本地未保存');
    await page.locator('.save-status').click();
    await expect(page.locator('.save-status')).toContainText('已保存到本地');
    const saved = await fs.readFile(path.join(data, '示例知识库', '保存基线.md'), 'utf8');
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('B');
    await expect(page.locator('.save-status')).toContainText('本地未保存');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.save-status')).toContainText('已保存到本地');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.save-status')).toContainText('本地未保存');
    await page.keyboard.insertText('A');
    await expect(page.locator('.save-status')).toContainText('已保存到本地');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect.poll(() =>
      page.locator('.source-editor .cm-line').evaluateAll(lines =>
        lines.map(line => line.textContent).join('\n')
      )
    ).toBe(saved);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test('A deliberate source-format edit stays dirty when a later preview edit is reverted', async () => {
  const { app, page } = await fixture();
  try {
    const original = '* 项目\n\n正文\n';
    await page.evaluate(original => window.moyu!.create('源码格式.md', 'file', original), original);
    await page.locator('.tree-item[title="源码格式.md"]').dblclick();
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('-');
    await expect(page.locator('.save-status')).toContainText('本地未保存');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('X');
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('正文X');
    // Allow the Markdown listener to publish the intermediate edit.
    await page.waitForTimeout(250);
    await page.keyboard.press('Backspace');
    await expect(page.locator('.save-status')).toContainText('本地未保存');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect.poll(() =>
      page.locator('.source-editor .cm-line').evaluateAll(lines =>
        lines.map(line => line.textContent).join('\n')
      )
    ).toBe('- 项目\n\n正文\n');
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
