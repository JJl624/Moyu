import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v1613-'));
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
  const page = await app.firstWindow(), errors: string[] = [];
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
  );
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    const pixel = document.createElement('div');
    pixel.setAttribute('aria-hidden', 'true');
    pixel.style.cssText =
      'position:fixed;bottom:0;right:0;width:1px;height:1px;pointer-events:none;z-index:99999';
    document.body.append(pixel);
    let odd = false;
    setInterval(() => {
      pixel.style.backgroundColor = (odd = !odd) ? '#111' : '#222';
    }, 16);
  });
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  const root = path.join(data, '示例知识库');
  await fs.writeFile(
    path.join(root, '图片.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="red"/></svg>',
  );
  const png = await app.evaluate(({ nativeImage }) =>
    nativeImage.createFromBitmap(Buffer.alloc(320 * 240 * 4, 255), { width: 320, height: 240 })
      .toPNG().toString('base64')
  );
  await fs.writeFile(path.join(root, '中文图片.png'), Buffer.from(png, 'base64'));
  return { app, page, root, errors };
}
async function open(page: Page, name: string, content: string) {
  await page.evaluate(async ({ name, content }) => window.moyu!.create(name, 'file', content), {
    name,
    content,
  });
  await page.locator('.tree-item[title="' + name + '"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', name);
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}

test('Deleting adjacent text enters image source at either edge without deleting its delimiters', async () => {
  test.setTimeout(90000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.copyFile(
      path.join(project, 'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'),
      path.join(root, '绘图.excalidraw'),
    );
    for (
      const [index, link] of [
        '![图片](图片.svg)',
        '![图片](中文图片.png)',
        '[绘图](绘图.excalidraw)',
      ].entries()
    ) {
      for (const list of [false, true]) {
        for (const backward of [false, true]) {
          for (const [markerIndex, marker] of ['字', '🙂', 'e\u0301'].entries()) {
            const file = '删除-' + index + '-' + list + '-' + backward + '-' + markerIndex + '.md';
            await open(page, file, (list ? '- ' : '') + marker + link + marker + '\n\n后文');
            const paragraph = page.locator('.ProseMirror p').first(),
              raw = page.locator('.inline-syntax .syntax-raw'),
              preview = page.locator('.attachment-overlay');
            await expect(preview).toBeVisible();
            await paragraph.evaluate((p, backward) => {
              const node = backward ? p.lastChild! : p.firstChild!;
              const range = document.createRange();
              range.setStart(node, backward ? node.textContent!.length : 0);
              range.collapse(true);
              getSelection()!.removeAllRanges();
              getSelection()!.addRange(range);
              (p.closest('.ProseMirror') as HTMLElement).focus();
            }, backward);
            await page.keyboard.press(backward ? 'Backspace' : 'Delete');
            await expect(raw).toBeVisible();
            await expect(preview).toBeHidden();
            await expect(raw).toHaveText(link);
            expect(
              await page.evaluate(() => {
                const s = getSelection()!,
                  p = s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement;
                return !!p?.closest('.syntax-raw');
              }),
            ).toBe(true);
            await page.keyboard.press(backward ? 'Backspace' : 'Delete');
            await expect(raw).toHaveText(backward ? link.slice(0, -1) : link.slice(1));
            await page.keyboard.press('Control+z');
            await expect(raw).toHaveText(link);
            await app.evaluate(({ Menu }) =>
              Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
                x.label === '保存'
              )!.click()
            );
            await expect.poll(() => fs.readFile(path.join(root, file), 'utf8')).toContain(
              backward ? marker + link : link + marker,
            );
            if (list) await expect(page.locator('.list-item')).toHaveCount(1);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Reading renders display math and LaTeX fences after editing without shifting following code attributes', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    const content =
      '行内公式：$a^2+b^2=c^2$。\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n\n```latex\n\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}\n```\n\n```math\nE=mc^2\n```\n\n```python {height=160}\nprint(1)\n```\n\n尾文';
    await open(page, '公式.md', content);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view .katex-display')).toHaveCount(3);
    await expect(page.locator('.reading-view .katex')).toHaveCount(4);
    await expect(page.locator('.reading-view .katex-error')).toHaveCount(0);
    await expect(page.locator('.reading-view .code-block-shell')).toHaveCount(1);
    await expect(page.locator('.reading-view code.language-python')).toHaveCSS(
      'max-height',
      '160px',
    );
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('新增');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '公式.md'), 'utf8')).toContain('新增');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view .katex-display')).toHaveCount(3);
    await expect(page.locator('.reading-view .katex')).toHaveCount(4);
    await expect(page.locator('.reading-view .katex-error')).toHaveCount(0);
    await expect(page.locator('.reading-view code.language-python')).toHaveCSS(
      'max-height',
      '160px',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
