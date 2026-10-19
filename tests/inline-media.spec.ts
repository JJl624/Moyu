import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'inline-media-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
  );
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  const root = path.join(data, '示例知识库');
  await fs.writeFile(
    path.join(root, '中文 图.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="orange"/></svg>',
  );
  await page.evaluate(() =>
    window.moyu!.feature('drawing.create', { path: 'attachments/中文 图.excalidraw' })
  );
  return { app, page, root, errors };
}
async function open(page: Page, file: string, content: string) {
  await page.evaluate(({ file, content }) => window.moyu!.create(file, 'file', content), {
    file,
    content,
  });
  await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', file);
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}
async function save(app: Awaited<ReturnType<typeof electron.launch>>) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
      x.label === '保存'
    )!.click()
  );
}
const image = '![中文 图|180](<中文 图.svg>)', drawing = '[中文 图|100](<attachments/中文 图.excalidraw>)';
test('Inline media preserve both-side text, shared-line layout, live sizing, raw editing, context menus and reading output', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '行内.md', '左' + image + '中' + drawing + '右**加粗**\n\n后文');
    const overlays = page.locator('.attachment-overlay'),
      sources = page.locator('.visual-attachment');
    await expect(overlays.locator('img')).toBeVisible();
    await expect(overlays.locator('svg')).toBeVisible();
    await expect(page.locator('.ProseMirror > p')).toHaveCount(2);
    expect(await sources.evaluateAll(nodes => nodes.every(n => n.parentElement?.tagName === 'P')))
      .toBe(true);
    expect(
      await page.locator('.attachment-space').evaluateAll(nodes =>
        nodes.every(n => n.closest('.inline-syntax'))
      ),
    ).toBe(true);
    const layout = await overlays.evaluateAll(nodes =>
      nodes.map(n => {
        const b = n.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      })
    );
    expect(layout[0].w).toBeCloseTo(180, 0);
    expect(layout[1].w).toBeCloseTo(100, 0);
    expect(layout[1].x).toBeGreaterThan(layout[0].x + layout[0].w);
    expect(Math.abs((layout[0].y + layout[0].h / 2) - (layout[1].y + layout[1].h / 2)))
      .toBeLessThan(5);
    await overlays.first().click();
    await expect(sources.first().locator('.syntax-raw')).toHaveText(image);
    await expect(overlays.locator('img')).toBeHidden();
    await expect(sources.first().locator('.attachment-space')).toBeHidden();
    await expect(overlays.locator('svg')).toBeVisible();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('前');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await page.keyboard.insertText('后');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '行内.md'), 'utf8')).toContain(
      '左前' + image + '后中' + drawing + '右**加粗**',
    );
    // Update only the size text with the real native caret; keep the same image DOM.
    await overlays.first().click();
    await sources.first().locator('.syntax-raw').evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let remaining = el.textContent!.indexOf('180');
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (remaining <= n.textContent!.length) {
          const r = document.createRange();
          r.setStart(n, remaining);
          r.setEnd(n, remaining + 3);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(r);
          break;
        }
        remaining -= n.textContent!.length;
      }
    });
    await page.keyboard.insertText('90');
    await expect(overlays.locator('img')).toBeHidden();
    await page.locator('.ProseMirror > p').last().click();
    await expect(overlays.locator('img')).toHaveCSS('width', '90px');
    await expect(page.locator('.attachment-space').first()).toHaveCSS('width', '90px');
    await expect(sources.first().locator('.syntax-raw')).toBeHidden();
    await overlays.nth(1).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '编辑绘图', exact: true })).toBeVisible();
    await expect(overlays.locator('svg')).toBeVisible();
    await expect(sources.nth(1).locator('.syntax-raw')).toBeHidden();
    await page.keyboard.press('Escape');
    await overlays.nth(1).click();
    await expect(overlays.locator('svg')).toBeHidden();
    await sources.nth(1).locator('.syntax-raw').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '编辑绘图', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '行内.md'), 'utf8')).toContain(
      '![中文 图|90]',
    );
    const saved = await fs.readFile(path.join(root, '行内.md'), 'utf8');
    expect(saved).toContain('左前![中文 图|90](<中文 图.svg>)后中' + drawing + '右**加粗**');
    expect(saved).not.toMatch(/\\!|\\\[|%E[0-9A-F]/);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText(
      '左前![中文 图|90](<中文 图.svg>)后中',
    );
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect.poll(() =>
      page.locator('.reading-view p').first().evaluate(el =>
        [...el.childNodes].filter(n => !(n instanceof Element && n.matches('.resource-preview')))
          .map(n => n.textContent || '').join('')
      )
    ).toBe('左前后中右加粗');
    await expect(page.locator('.reading-view img')).toHaveCSS('width', '90px');
    await expect(page.locator('.reading-view .resource-preview svg')).toHaveCSS('width', '100px');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Images are ordinary list content: single items, Enter splitting, indentation, undo and ordered marker input', async () => {
  test.setTimeout(100000);
  const { app, page, root, errors } = await fixture();
  try {
    for (const raw of [image, drawing]) {
      const file = raw === image ? '图片列表.md' : '绘图列表.md';
      await open(page, file, '- 上一项\n- 左' + raw + '右\n- ' + raw + '\n- 后文');
      const sources = page.locator('.visual-attachment'),
        overlays = page.locator('.attachment-overlay');
      await expect(overlays).toHaveCount(2);
      await expect(page.locator('.list-item')).toHaveCount(4);
      await expect(page.locator('.list-item').nth(1).locator('p')).toHaveCount(1);
      await (await previewFor(page, sources.first())).click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      // The same split as before any ordinary text, not a media continuation.
      await expect(page.locator('.list-item')).toHaveCount(5);
      await expect(page.locator('.list-item').nth(1).locator('p')).toHaveText('左');
      await expect(page.locator('.list-item').nth(2).locator('.syntax-raw')).toHaveText(raw);
      await page.keyboard.insertText('新');
      await expect(page.locator('.list-item').nth(2).locator('p')).toContainText('新');
      await (await previewFor(page, sources.first())).click();
      await page.keyboard.press('Tab');
      await expect.poll(() =>
        sources.first().evaluate(el =>
          !!el.closest('.list-item')!.parentElement!.closest('.list-item')
        )
      ).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect.poll(() =>
        sources.first().evaluate(el =>
          !!el.closest('.list-item')!.parentElement!.closest('.list-item')
        )
      ).toBe(false);
      await (await previewFor(page, sources.last())).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(page.locator('.list-item')).toHaveCount(6);
      await page.keyboard.insertText('新增项');
      await expect(page.locator('.list-item').nth(4).locator('p')).toHaveText('新增项');
      await page.keyboard.press('Control+z');
      await expect(page.locator('.ProseMirror')).not.toContainText('新增项');
      await page.keyboard.press('Control+Shift+z');
      await expect(page.locator('.ProseMirror')).toContainText('新增项');
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, file), 'utf8')).toContain('新增项');
      const saved = await fs.readFile(path.join(root, file), 'utf8');
      expect(saved.split(raw)).toHaveLength(3);
      expect(saved).not.toMatch(/\\!|\\\[|%E[0-9A-F]/);
      await page.getByRole('button', { name: '阅读', exact: true }).click();
      await expect(page.locator('.reading-view li')).toHaveCount(6);
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      await expect(overlays).toHaveCount(2);
      await expect(page.locator('.list-item')).toHaveCount(6);
    }
    await open(page, '建立列表.md', image + '\n\n后文');
    await expect(page.locator('.attachment-overlay')).toHaveCount(1);
    await page.locator('.attachment-overlay').click();
    await page.keyboard.press('Home');
    await page.keyboard.type('3. ');
    await page.keyboard.insertText('前文');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-item p')).toHaveCount(1);
    await expect(page.locator('.list-item p')).toContainText('前文');
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '建立列表.md'), 'utf8')).toContain(
      '3. 前文' + image,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Clipboard images paste inline between text and remain individual list items, with undo/redo and Markdown round trips', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '粘贴.md', '- 上一项\n- 左右\n- 后文');
    await page.locator('.list-item').nth(1).locator('p').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {
      const png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQioAAAAASUVORK5CYII=',
        data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], '粘贴图.png', {
          type: 'image/png',
        }),
      );
      document.querySelector('.ProseMirror')!.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await page.locator('.list-item').last().locator('p').click();
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(3);
    await expect(page.locator('.list-item').nth(1).locator('p')).toHaveCount(1);
    await expect(page.locator('.visual-attachment')).toHaveCount(1);
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '粘贴.md'), 'utf8')).toMatch(
      /[-*] 左!\[.*\]\(.*\.png\)右/,
    );
    await page.keyboard.press('Control+z');
    await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
    await expect(page.locator('.list-item').nth(1).locator('p')).toHaveText('左右');
    await page.keyboard.press('Control+Shift+z');
    await page.locator('.list-item').last().locator('p').click();
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).not.toContainText('blob:');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await page.locator('.list-item').last().locator('p').click();
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('The drawing insert menu places a standard inline link between list text without splitting its paragraph', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '插入绘图.md', '- 左右\n\n后文');
    await page.locator('.list-item p').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('/');
    const menu = page.getByRole('menuitem', { name: 'Excalidraw 绘图', exact: true });
    await expect(menu).toBeEnabled();
    await menu.click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', /\.excalidraw$/);
    await page.locator('.tab-name[title="插入绘图.md"]').dblclick();
    await page.locator('.ProseMirror > p').last().click();
    await expect(page.locator('.attachment-overlay svg')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-item p')).toHaveCount(1);
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '插入绘图.md'), 'utf8')).toMatch(
      /[-*] 左!\[绘图\]\(插入绘图\.assets\/attachments\/未命名绘图\.excalidraw\)右/,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Exiting a code block edits the following inline image paragraph directly at root and inside a list', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    for (const listed of [false, true]) {
      const file = listed ? '代码列表.md' : '代码正文.md',
        code = '```python\nprint(123)\n```\n\n' + image + '右';
      const content = listed
        ? '- 正文\n\n' + code.split('\n').map(line => '  ' + line).join('\n')
        : code;
      await open(page, file, content);
      await expect(page.locator('.attachment-overlay img')).toBeVisible();
      await page.locator('.milkdown-code-block .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Control+Enter');
      await page.keyboard.insertText('左');
      const source = page.locator('.visual-attachment');
      await expect(source.locator('xpath=..')).toContainText('左' + image + '右');
      await expect(source.locator('xpath=..')).toHaveJSProperty('tagName', 'P');
      await expect(page.locator('.milkdown-code-block .cm-content')).not.toContainText('左');
      if (listed) await expect(page.locator('.list-item')).toHaveCount(1);
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, file), 'utf8')).toContain(
        '左' + image + '右',
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Raw-only media selection supports range selection and character deletion without image state', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '原始链接.md', '左' + image + '右\n\n结束');
    const source = page.locator('.inline-syntax'),
      raw = source.locator('.syntax-raw'),
      preview = await previewFor(page, source),
      space = source.locator('.attachment-space');
    await preview.click();
    await expect(raw).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(space).toBeHidden();
    expect(await source.evaluate(el => el.closest('p')!.getBoundingClientRect().height))
      .toBeLessThan(45);
    await page.keyboard.press('Control+a');
    await expect(preview).toBeHidden();
    expect(await page.evaluate(() => getSelection()?.toString())).toContain(image);
    await page.locator('.ProseMirror p').last().click();
    await expect(raw).toBeHidden();
    await expect(preview).toBeVisible();
    await preview.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await expect(raw).toHaveText(image.slice(0, -1));
    await expect(preview).toBeHidden();
    await page.locator('.ProseMirror p').last().click();
    await expect(raw).toBeVisible();
    await expect(preview).toBeHidden();
    await raw.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(')');
    await page.locator('.ProseMirror p').last().click();
    await expect(preview).toBeVisible();
    await expect(raw).toBeHidden();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '原始链接.md'), 'utf8')).toContain(
      '左' + image + '右',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
