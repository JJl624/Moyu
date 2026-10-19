import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
test('Drawing previews release selection when clicking blank canvas or an empty list marker', async () => {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'drawing-release-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
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
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/未命名绘图 1.excalidraw' })
    );
    const drawing = path.join(data, '示例知识库/attachments/未命名绘图 1.excalidraw');
    const scene = JSON.parse(await fs.readFile(drawing, 'utf8'));
    scene.elements = [{
      type: 'rectangle',
      id: 'rectangle',
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: '#ffec99',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: [],
      updated: 1,
      link: null,
      locked: false,
    }];
    await fs.writeFile(drawing, JSON.stringify(scene));
    const raw = '[未命名绘图 1](<attachments/未命名绘图 1.excalidraw>)';
    await page.evaluate(async raw => window.moyu!.create('释放.md', 'file', raw), raw);
    await page.locator('.tree-item[title="释放.md"]').dblclick();
    const preview = page.locator('.attachment-overlay'),
      source = page.locator('.visual-attachment .syntax-raw');
    await expect(preview.locator('svg')).toBeVisible();
    const setTheme = async (theme: 'dark' | 'light') => {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', { name: '切换主题', exact: true }).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    };
    await setTheme('dark');
    await expect(preview.locator('svg')).toHaveAttribute(
      'filter',
      'invert(93%) hue-rotate(180deg)',
    );
    await setTheme('light');
    await expect(preview.locator('svg')).not.toHaveAttribute('filter');
    await preview.click();
    await expect(preview).toBeHidden();
    const point = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror')!.getBoundingClientRect(),
        space = document.querySelector('.visual-attachment')!.closest('p')!.getBoundingClientRect();
      return { x: editor.left + 15, y: space.bottom + 20 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.ProseMirror p')).toHaveCount(2);
    await expect(preview).toBeVisible();
    await expect(source).toBeHidden();
    await page.keyboard.insertText('独立段落');
    await expect(page.locator('.ProseMirror p').last()).toHaveText('独立段落');
    await page.evaluate(
      async raw => window.moyu!.create('列表释放.md', 'file', '-\n- ' + raw),
      raw,
    );
    await page.locator('.tree-item[title="列表释放.md"]').dblclick();
    // Image-only list entries are ordinary items; clicking the empty peer releases the link.
    await expect(page.locator('.list-item')).toHaveCount(2);
    expect(await page.locator('.visual-attachment').evaluate(el => !!el.closest('.list-item')))
      .toBe(true);
    await expect(preview.locator('svg')).toBeVisible();
    await preview.click();
    await expect(source).toBeVisible();
    await page.locator('.list-item').first().locator('.label').click();
    await expect(preview).toBeVisible();
    await expect(source).toBeHidden();
    await page.keyboard.insertText('空列表项');
    await expect(page.locator('.list-item').first().locator('p')).toHaveText('空列表项');
    await page.evaluate(
      async raw => window.moyu!.create('正文绘图.md', 'file', '- 正文\n- ' + raw + '\n- 后文'),
      raw,
    );
    await page.locator('.tree-item[title="正文绘图.md"]').dblclick();
    await expect(preview.locator('svg')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(3);
    await expect(page.locator('.list-item').nth(1).locator('p')).toHaveCount(1);
    await preview.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(source).toBeHidden();
    await expect(preview).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(4);
    await page.keyboard.insertText('图片之后');
    await expect(page.locator('.list-item').nth(2).locator('p')).toHaveText('图片之后');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view li')).toHaveCount(4);
    await setTheme('dark');
    await expect(page.locator('.reading-view .resource-preview svg')).toHaveAttribute(
      'filter',
      'invert(93%) hue-rotate(180deg)',
    );
    await setTheme('light');
    await expect(page.locator('.reading-view .resource-preview svg')).not.toHaveAttribute('filter');
    await setTheme('dark');
    await page.locator('.tree-item[title="附件"]').click();
    await page.locator('.tree-item[title="attachments/未命名绘图 1.excalidraw"]').dblclick();
    await expect(page.locator('.drawing-editor .excalidraw').first()).toHaveClass(/theme--dark/);
    await setTheme('light');
    await expect(page.locator('.drawing-editor .excalidraw').first()).not.toHaveClass(
      /theme--dark/,
    );
    await page.evaluate(() => window.moyu!.create('粘贴列表.md', 'file', '- 正文\n- '));
    await page.locator('.tree-item[title="粘贴列表.md"]').dblclick();
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await page.locator('.list-item').last().locator('p').click({ position: { x: 10, y: 8 } });
    await page.evaluate(() => {
      const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQioAAAAASUVORK5CYII=';
      const data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], '粘贴图.png', {
          type: 'image/png',
        }),
      );
      document.querySelector('.ProseMirror')!.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(2);
    await expect(page.locator('.list-item').last().locator('p')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.attachment-overlay img')).toBeVisible();
    await expect(page.locator('.list-item')).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
