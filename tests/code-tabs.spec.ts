import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
test('Tabbed fences edit the original Markdown, manage pages, and keep cursor and unified height', async () => {
  test.setTimeout(120000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'tabs-'));
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
      setInterval(() => pixel.style.backgroundColor = (odd = !odd) ? '#111' : '#222', 16);
    });
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const raw = ':::PY 第一个标签页\nprint("hello")\n:::c++ 第二个标签页\nint value = 42;';
    await page.evaluate(
      ({ raw }) =>
        window.moyu!.create(
          '标签代码.md',
          'file',
          '开始\n\n```tabs {height=160}\n' + raw + '\n```\n\n结束\n\n```js\nconsole.log(1);\n```\n',
        ),
      { raw },
    );
    await page.locator('.tree-item[title="标签代码.md"]').dblclick();
    const block = page.locator('.ProseMirror .tabbed-code'), cm = block.locator('.cm-content');
    await expect(block).toHaveCount(1);
    await expect(block.getByRole('tab')).toHaveCount(2);
    await expect(cm).toHaveText('print("hello")');
    await expect(cm.locator('.tok-keyword,.tok-string')).not.toHaveCount(0);
    await expect(block.locator('.code-inline-actions')).toHaveCount(0);
    await expect(page.locator('.milkdown-code-block:not(.tabbed-code) .code-inline-actions'))
      .toHaveCount(1);
    expect(
      await block.locator('.tabs-frame').evaluate(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
    ).toBe(160);
    await block.getByRole('tab', { name: '第二个标签页', exact: true }).click();
    await expect(cm).toHaveText('int value = 42;');
    await expect(cm.locator('.tok-typeName,.tok-number')).not.toHaveCount(0);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('// second');
    await expect(cm).toHaveText('int value = 42;// second');
    await block.getByRole('button', { name: '显示源码', exact: true }).click();
    await expect.poll(async () => (await cm.locator('.cm-line').allTextContents()).join('\n')).toBe(
      raw + '\n// second',
    );
    await block.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      raw + '\n// second',
    );
    await block.getByRole('button', { name: '显示标签页', exact: true }).click();
    await expect(block.getByRole('tab', { name: '第二个标签页' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await block.getByRole('button', { name: '新建代码标签页' }).click();
    await expect(block.getByRole('tab')).toHaveCount(3);
    await expect(block.getByRole('tab', { name: '标签页 1', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(block.getByLabel('标签页语言', { exact: true })).toHaveValue('text');
    await block.getByRole('textbox', { name: '标签页标题' }).fill('第三页');
    await page.keyboard.press('Enter');
    await expect(block.getByRole('tab', { name: '第三页' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await block.getByLabel('标签页语言', { exact: true }).fill('JS');
    await page.keyboard.press('Enter');
    await cm.click();
    await page.keyboard.insertText('const third = 3;');
    await expect(cm).toHaveText('const third = 3;');
    await expect(cm.locator('.tok-keyword')).not.toHaveCount(0);
    await block.getByRole('button', { name: '向左移动标签页' }).click();
    expect(await block.getByRole('tab').allTextContents()).toEqual([
      '第一个标签页',
      '第三页',
      '第二个标签页',
    ]);
    await block.getByRole('button', { name: '删除标签页' }).click();
    await expect(block.getByRole('tab')).toHaveCount(2);
    await cm.click();
    await page.keyboard.press('Control+z');
    await expect(block.getByRole('tab')).toHaveCount(3);
    await page.keyboard.press('Control+y');
    await expect(block.getByRole('tab')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(block.getByRole('tab')).toHaveCount(3);
    await page.keyboard.press('Control+Shift+Z');
    await expect(block.getByRole('tab')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(block.getByRole('tab')).toHaveCount(3);
    await block.getByRole('tab', { name: '第二个标签页' }).click();
    await cm.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const caret = await cm.evaluate(el => {
      const selection = window.getSelection()!;
      return { text: selection.anchorNode?.textContent, offset: selection.anchorOffset };
    });
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText(':::JS 第三页');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(block.getByRole('tab', { name: '第二个标签页' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => cm.evaluate(el => {
        const s = window.getSelection()!;
        return { text: s.anchorNode?.textContent, offset: s.anchorOffset };
      })).toEqual(caret);
    await page.locator('.tree-item[title="开始使用.md"]').dblclick();
    await page.locator('.tree-item[title="标签代码.md"]').dblclick();
    await expect(block.getByRole('tab', { name: '第二个标签页' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => cm.evaluate(() => {
        const s = window.getSelection()!;
        return { text: s.anchorNode?.textContent, offset: s.anchorOffset };
      })).toEqual(caret);
    await block.getByRole('button', { name: '显示源码', exact: true }).click();
    await page.locator('.tree-item[title="开始使用.md"]').dblclick();
    await page.locator('.tree-item[title="标签代码.md"]').dblclick();
    await expect(block).toHaveAttribute('data-tabs-display', 'source');
    await block.getByRole('button', { name: '显示标签页', exact: true }).click();
    await block.getByRole('textbox', { name: '代码块自定义属性' }).fill('{height=240}');
    expect(
      await block.locator('.tabs-frame').evaluate(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
    ).toBe(240);
    const resize = block.locator('.code-resize'), handle = (await resize.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 40, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(block.getByLabel('代码块自定义属性')).toHaveValue('{height=280}');
    await expect(block.locator('.tabs-frame')).toHaveCSS('height', '280px');
    await resize.dblclick();
    await expect(block.getByLabel('代码块自定义属性')).toHaveValue('');
    await block.getByLabel('代码块自定义属性').fill('{height=240}');
    await block.getByRole('tab', { name: '第一个标签页' }).click();
    expect(
      await block.locator('.tabs-frame').evaluate(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
    ).toBe(240);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    const reading = page.locator('.reading-view .tabbed-code');
    await expect(reading.getByRole('tab')).toHaveCount(3);
    await expect(reading.locator('[data-code-pane="0"]')).toBeVisible();
    await reading.getByRole('tab', { name: '第三页' }).click();
    await expect(reading.locator('[data-code-pane="1"]')).toBeVisible();
    await expect(reading.locator('[data-code-pane="1"] .tok-keyword')).not.toHaveCount(0);
    expect(
      await reading.locator('.tabs-frame').evaluate(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
    ).toBe(240);
    await reading.getByRole('button', { name: '显示源码' }).click();
    await expect(reading.locator('[data-tabs-raw]')).toBeVisible();
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(data, '示例知识库', '标签代码.md'), 'utf8'))
      .toContain('```tabs {height=240 id=0001}');
    const saved = await fs.readFile(path.join(data, '示例知识库', '标签代码.md'), 'utf8');
    expect(saved).toContain('```tabs {height=240 id=0001}');
    expect(saved).toContain(':::JS 第三页\nconst third = 3;');
    expect(saved).toContain(':::c++ 第二个标签页\nint value = 42;\n// second');
    await page.screenshot({ path: path.join(base, 'tabs-edit.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Empty tabs and source declarations switch safely; nested diagram previews and exports retain all pages', async () => {
  test.setTimeout(90000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'tabs-preview-'));
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
      let on = false;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;right:0';
      document.body.append(el);
      setInterval(() => el.style.background = (on = !on) ? '#111' : '#222', 16);
    });
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    await page.evaluate(() => window.moyu!.create('空标签.md', 'file', '```tabs\n\n```\n'));
    await page.locator('.tree-item[title="空标签.md"]').dblclick();
    const block = page.locator('.ProseMirror .tabbed-code'), cm = block.locator('.cm-content');
    await expect(block.getByRole('tab')).toHaveCount(0);
    await block.getByRole('button', { name: '新建代码标签页' }).click();
    await expect(block.getByRole('tab')).toHaveCount(1);
    await expect(block.getByRole('textbox', { name: '标签页标题' })).toHaveValue('标签页 1');
    await expect(block.getByLabel('标签页语言', { exact: true })).toHaveValue('text');
    await block.getByRole('textbox', { name: '标签页标题' }).fill('空');
    await page.keyboard.press('Enter');
    await cm.click();
    await page.keyboard.insertText('first');
    await page.keyboard.press('Enter');
    await expect(cm.locator('.cm-line')).toHaveCount(2);
    await block.getByRole('button', { name: '显示源码' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(':::JS 二\nconst x = 2;');
    await block.getByRole('button', { name: '显示标签页' }).click();
    await expect(block.getByRole('tab')).toHaveCount(2);
    await expect(cm).toHaveText('const x = 2;');
    await block.getByRole('tab', { name: '空', exact: true }).click();
    await expect(cm.locator('.cm-line')).toHaveCount(1);
    await block.getByRole('button', { name: '管理代码标签页' }).click();
    await block.getByRole('textbox', { name: '标签页标题' }).fill('');
    await page.keyboard.press('Enter');
    await expect(block.getByRole('tab', { name: '纯文本', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const input =
      '```tabs {height=220}\n:::mermaid 图\nflowchart LR\nA[开始] --> B[结束]\n:::latex 公式\nx^2 + y^2 = z^2\n:::py 代码\nprint(42)\n```\n';
    await page.evaluate(({ input }) => window.moyu!.create('标签预览.md', 'file', input), {
      input,
    });
    await page.locator('.tree-item[title="标签预览.md"]').dblclick();
    await expect(block.locator('.tabs-live-preview svg')).toBeVisible();
    await block.getByRole('tab', { name: '公式', exact: true }).click();
    await expect(block.locator('.tabs-live-preview .katex')).toBeVisible();
    await block.getByRole('button', { name: '新建代码标签页' }).click();
    await expect(block.getByRole('tab', { name: '标签页 1', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(block.getByLabel('标签页语言', { exact: true })).toHaveValue('text');
    await expect(block.locator('.tabs-live-preview .katex')).toHaveCount(0);
    await cm.click();
    await page.keyboard.press('Control+z');
    await expect(block.getByRole('tab')).toHaveCount(3);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    const reading = page.locator('.reading-view .tabbed-code');
    await expect(reading.locator('[data-code-pane="0"] svg')).toBeVisible();
    await reading.getByRole('tab', { name: '公式', exact: true }).click();
    await expect(reading.locator('[data-code-pane="1"] .katex')).toBeVisible();
    await reading.getByRole('tab', { name: '代码', exact: true }).click();
    await expect(reading.locator('[data-code-pane="2"] pre code')).toHaveText('print(42)');
    const output = path.join(data, '示例知识库', '标签导出.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('<svg');
    const html = await fs.readFile(output, 'utf8');
    expect(html).toContain('class="katex"');
    expect(html.replace(/<[^>]*>/g, '')).toContain('print(42)');
    expect(html).not.toMatch(/<section[^>]*hidden/);
    expect(html).not.toContain('data-tabs-raw');
    expect(html).not.toContain('data:image/png');
    await page.screenshot({ path: path.join(base, 'tabs-read.png') });
    await reading.getByRole('tab', { name: '图', exact: true }).click();
    const oldSvg = await reading.locator('svg').first().evaluate(el => el.id);
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect.poll(() => reading.locator('svg').first().evaluate(el => el.id)).not.toBe(oldSvg);
    await expect(page.locator('.diagram-error')).toHaveCount(0);
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    const transition = '```text\n:::python 一\nprint(1)\n:::cpp 二\nint x = 2;\n```\n';
    await page.evaluate(
      ({ transition }) => window.moyu!.create('切换语言.md', 'file', transition),
      { transition },
    );
    await page.locator('.tree-item[title="切换语言.md"]').dblclick();
    const normal = page.locator('.ProseMirror .milkdown-code-block:not(.tabbed-code)');
    await expect(normal.locator('.language-button')).toContainText('text');
    await expect(normal.locator('[class*="tok-"]')).toHaveCount(0);
    await normal.locator('.language-button').click();
    await normal.getByPlaceholder('搜索语言').fill('tabs');
    await normal.locator('.language-list-item').first().click();
    await expect(block.getByRole('tab')).toHaveCount(2);
    await cm.click();
    await page.keyboard.press('Control+z');
    await expect(normal).toHaveCount(1);
    await expect(block).toHaveCount(0);
    await normal.locator('.cm-content').click();
    await page.keyboard.press('Control+y');
    await expect(block.getByRole('tab')).toHaveCount(2);
    const lines = Array.from({ length: 100 }, (_, i) => '# 行 ' + i).join('\n');
    const list = '- 列表中的标签代码\n\n  ```tabs {height=150}\n  :::py 长代码\n'
      + lines.split('\n').map(line => '  ' + line).join('\n')
      + '\n  :::unknown 原文\n  <not-html>\n  ```\n\n结束';
    await page.evaluate(({ list }) => window.moyu!.create('列表标签.md', 'file', list), { list });
    await page.locator('.tree-item[title="列表标签.md"]').dblclick();
    await expect(page.locator('.list-item .tabbed-code')).toHaveCount(1);
    await expect(block.locator('.cm-editor')).toHaveCount(1);
    await cm.locator('.cm-line').first().click();
    await page.keyboard.press('Control+End');
    await expect(cm).toContainText('# 行 99');
    const scroll = await block.locator('.tabs-editor').evaluate(el => el.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    await block.getByRole('tab', { name: '原文', exact: true }).click();
    await expect(cm).toHaveText('<not-html>');
    expect(await cm.locator('not-html').count()).toBe(0);
    await block.getByRole('tab', { name: '长代码', exact: true }).click();
    expect(await block.locator('.tabs-editor').evaluate(el => el.scrollTop)).toBeCloseTo(scroll, 0);
    await page.locator('.tree-item[title="切换语言.md"]').dblclick();
    await page.locator('.tree-item[title="列表标签.md"]').dblclick();
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
    expect(await block.locator('.tabs-editor').evaluate(el => el.scrollTop)).toBeCloseTo(scroll, 0);
    await expect(block.locator('.cm-editor')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
