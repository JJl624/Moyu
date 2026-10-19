import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v1612-'));
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

test('Tab before standalone images inserts indentation without leaving their editable links', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.copyFile(
      path.join(project, 'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'),
      path.join(root, '绘图.excalidraw'),
    );
    for (
      const [index, value] of [
        '![图片](图片.svg)',
        '![图片](中文图片.png)',
        '[绘图](绘图.excalidraw)',
      ].entries()
    ) {
      const name = 'Tab-' + index + '.md';
      await open(page, name, value + '\n\n后文');
      const raw = page.locator('.visual-attachment .syntax-raw'),
        preview = page.locator('.attachment-overlay');
      await preview.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Tab');
      await expect(raw).toBeVisible();
      await expect(preview).toBeHidden();
      await expect(page.locator('.ProseMirror')).toBeFocused();
      expect(
        await page.evaluate(() => {
          const n = getSelection()!;
          const el = (n.focusNode instanceof Element ? n.focusNode : n.focusNode?.parentElement)
            ?.closest('.syntax-raw');
          const r = document.createRange();
          r.setStart(el!, 0);
          r.setEnd(n.focusNode!, n.focusOffset);
          return r.toString();
        }),
      ).toMatch(/^ *$/);
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
          x.label === '保存'
        )!.click()
      );
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await expect(page.locator('.source-editor .cm-content')).toBeVisible();
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
      await expect(page.locator('.visual-attachment')).toHaveCount(1);
      await expect(page.locator('.milkdown-code-block')).toHaveCount(0);
      await page.keyboard.insertText('前');
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
          x.label === '保存'
        )!.click()
      );
      await expect.poll(() => fs.readFile(path.join(root, name), 'utf8')).toContain('前' + value);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Dragging into media reveals their links once and keeps selection layout stable until release', async () => {
  test.setTimeout(120000);
  const { app, page, errors } = await fixture();
  try {
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/拖选.excalidraw' })
    );
    for (
      const [index, value] of [
        '![图片|160](图片.svg)',
        '![图片|160](中文图片.png)',
        '[绘图|160](attachments/拖选.excalidraw)',
      ].entries()
    ) {
      for (const list of [false, true]) {
        for (const sameLine of [false, true]) {
          for (const reverse of [false, true]) {
            await open(
              page,
              '拖选-' + index + '-' + list + '-' + sameLine + '-' + reverse + '.md',
              list
                ? '- 起始文字\n- 左' + value + '右\n- 结束文字'
                : '起始文字\n\n左' + value + '右\n\n结束文字',
            );
            const preview = page.locator('.attachment-overlay'),
              raw = page.locator('.visual-attachment .syntax-raw');
            await expect(preview).toBeVisible();
            const image = (await preview.boundingBox())!,
              first = (await page.locator('.ProseMirror p').nth(sameLine ? 1 : reverse ? 2 : 0)
                .boundingBox())!;
            await preview.evaluate(el => {
              (window as any).dragToggles = 0;
              (window as any).dragObserver = new MutationObserver(records => {
                (window as any).dragToggles += records.length;
              });
              (window as any).dragObserver.observe(el, {
                attributes: true,
                attributeFilter: ['hidden'],
              });
            });
            const startX = reverse
              ? first.x + Math.min(first.width - 2, sameLine ? first.width - 2 : 55)
              : first.x + 2;
            await page.mouse.move(startX, first.y + first.height / 2);
            await page.mouse.down();
            const anchor = await page.evaluate(() => ({
              text: getSelection()?.anchorNode?.textContent,
              offset: getSelection()?.anchorOffset,
            }));
            await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2, {
              steps: 12,
            });
            await expect(raw).toBeVisible();
            await expect(preview).toBeHidden();
            for (let i = 0; i < 6; i++) {
              await page.mouse.move(startX + (reverse ? -i : i), first.y + first.height / 2);
              await expect(raw).toBeVisible();
              await expect(preview).toBeHidden();
            }
            const paragraph = (await raw.locator('xpath=ancestor::p').boundingBox())!;
            await page.mouse.move(
              reverse ? paragraph.x + 2 : paragraph.x + paragraph.width - 2,
              paragraph.y + paragraph.height / 2,
              { steps: 8 },
            );
            await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toContain(
              value,
            );
            expect(
              await page.evaluate(() => ({
                text: getSelection()?.anchorNode?.textContent,
                offset: getSelection()?.anchorOffset,
              })),
            ).toEqual(anchor);
            expect(await page.evaluate(() => (window as any).dragToggles)).toBe(1);
            await page.mouse.up();
            await page.evaluate(() => (window as any).dragObserver.disconnect());
            await page.locator('.ProseMirror p').last().click();
            await expect(preview).toBeVisible();
            await expect(raw).toBeHidden();
          }
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await page.mouse.up().catch(() => {});
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
