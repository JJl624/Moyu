import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
test('Tabs exit at the current empty editor, bare declarations focus language, and formatting changes only that page', async () => {
  test.setTimeout(120000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'tabs-input-'));
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
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    );
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const source =
      '# 标签操作\n\n```tabs\n:::text 一\n\n```\n\n```tabs\n:::py 二\nprint( 1+2 )\n:::JS 三\nconst x=1;\n```\n\n结束\n';
    await page.evaluate(source => window.moyu!.create('标签操作.md', 'file', source), source);
    await page.locator('.tree-item[title="标签操作.md"]').dblclick();
    const blocks = page.locator('.ProseMirror .tabbed-code'),
      first = blocks.nth(0),
      second = blocks.nth(1);
    for (let i = 0; i < 4; i++) {
      await page.locator('.ProseMirror h1').click();
      await first.locator('.cm-content').click();
      await page.keyboard.press('ArrowDown');
      await expect.poll(() =>
        page.evaluate(() => {
          const node = window.getSelection()?.anchorNode;
          const element = node instanceof Element ? node : node?.parentElement;
          return !!element?.closest('.ProseMirror p') && !element.closest('.milkdown-code-block');
        })
      ).toBeTruthy();
    }
    const cm = second.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() =>
      page.evaluate(() =>
        window.getSelection()?.anchorNode?.parentElement?.closest('.ProseMirror p')?.textContent
      )
    ).toBe('结束');
    await cm.click();
    await cm.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '运行代码块', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click();
    await expect(cm).toHaveText('print(1 + 2)');
    await second.getByRole('tab', { name: '三', exact: true }).click();
    await expect(cm).toHaveText('const x=1;');
    await second.getByRole('tab', { name: '二', exact: true }).click();
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(':::');
    await expect(second.getByRole('tab')).toHaveCount(3);
    const language = second.getByLabel('标签页语言', { exact: true });
    await expect(language).toBeFocused();
    await expect(language).toHaveValue('');
    await page.keyboard.type('python');
    await expect(language).toHaveValue('python');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('print( 4+5 )');
    await expect(cm).toHaveText('print( 4+5 )');
    await cm.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click();
    await expect(cm).toHaveText('print(4 + 5)');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    const raw = page.locator('.source-editor .cm-content');
    await expect.poll(async () => (await raw.locator('.cm-line').allTextContents()).join('\n'))
      .toContain(':::python\nprint(4 + 5)');
    const markdown = (await raw.locator('.cm-line').allTextContents()).join('\n');
    expect(markdown).toContain(':::JS 三\nconst x=1;');
    expect(markdown).toContain(':::py 二\nprint(1 + 2)');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('A bare tab in a list leaves to the current item before creating a sibling', async () => {
  const data = await fs.mkdtemp(path.resolve(project, '../../work/e2e/tabs-list-'));
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
    const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    await page.evaluate(() =>
      window.moyu!.create('列表标签输入.md', 'file', '- 项目\n\n  ```tabs\n  :::\n  ```\n')
    );
    await page.locator('.tree-item[title="列表标签输入.md"]').dblclick();
    await page.locator('.tabbed-code .cm-content').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.insertText('同一项');
    await expect(page.locator('.ProseMirror li')).toHaveCount(1);
    await expect(page.locator('.ProseMirror li')).toContainText('同一项');
    await expect(page.locator('.ProseMirror li .tabbed-code')).toHaveCount(1);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
