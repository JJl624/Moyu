import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');

test('Heading marker input and deletion preserve one source prefix', async () => {
  test.setTimeout(90000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'headings-'));
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
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  try {
    const page = await app.firstWindow(), errors: string[] = [];
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
    for (const listed of [false, true]) {
      for (let level = 1; level <= 6; level++) {
        const prefix = '#'.repeat(level);
        const file = '标题-' + listed + '-' + level + '.md';
        await page.evaluate(
          ({ file, listed }) => window.moyu!.create(file, 'file', (listed ? '- ' : '') + '原文\n'),
          { file, listed },
        );
        await page.locator('.tree-item[title="' + file + '"]').dblclick();
        await expect(page.locator('.editor-host')).not.toHaveAttribute(
          'data-editor-pending',
          'true',
        );
        await page.locator('.ProseMirror p').click();
        await page.keyboard.press('Home');
        await page.keyboard.type(prefix + ' ');
        const heading = page.locator('.ProseMirror h' + level);
        await expect(heading).toHaveText(prefix + ' 原文');
        await heading.dispatchEvent('compositionend', { data: '' });
        // ProseMirror rechecks input rules asynchronously after composition ends.
        await page.waitForTimeout(70);
        await expect(heading).toHaveText(prefix + ' 原文');
        // A second space after a visible source marker is ordinary text.
        await page.keyboard.press('Space');
        await expect(heading).toHaveText(prefix + '  原文');
        await page.keyboard.press('Backspace');
        await expect(heading).toHaveText(prefix + ' 原文');
        await page.keyboard.press('Backspace');
        await expect(page.locator('.ProseMirror p')).toHaveText(prefix + '原文');
        await page.keyboard.press('Space');
        await expect(heading).toHaveText(prefix + ' 原文');
        await page.keyboard.press('Home');
        for (let i = 0; i < level; i++) await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        await expect(heading).toHaveText(prefix + '  原文');
        await page.keyboard.press('Backspace');
        await expect(heading).toHaveText(prefix + ' 原文');
        await page.keyboard.press('Control+z');
        await expect(heading).toHaveText(prefix + '  原文');
        await page.keyboard.press('Control+Shift+z');
        await expect(heading).toHaveText(prefix + ' 原文');
        await page.getByRole('button', { name: '源码', exact: true }).click();
        await expect(page.locator('.source-editor .cm-content')).toHaveText(
          (listed ? '* ' : '') + prefix + ' 原文',
        );
        await page.getByRole('button', { name: '预览编辑', exact: true }).click();
        await expect(heading).toHaveText(prefix + ' 原文');
        if (listed) await expect(page.locator('.list-item')).toHaveCount(1);
        await app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
            x.label === '保存'
          )!.click()
        );
        await expect.poll(() => fs.readFile(path.join(data, '示例知识库', file), 'utf8')).toBe(
          (listed ? '* ' : '') + prefix + ' 原文\n',
        );
        await heading.click();
        await page.keyboard.press('End');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await expect(heading).toHaveText(prefix + ' ');
        await heading.dispatchEvent('compositionend', { data: '' });
        await page.waitForTimeout(70);
        await expect(heading).toHaveText(prefix + ' ');
        await page.keyboard.insertText('原文');
        await expect(heading).toHaveText(prefix + ' 原文');
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
