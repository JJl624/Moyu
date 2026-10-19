import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
async function fixture(offscreen = false) {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v161-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: '1',
    MOYU_DEMO: '1',
    MOYU_TEST_OFFSCREEN: offscreen ? '1' : '',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? {
        executablePath: process.env.MOYU_E2E_EXECUTABLE,
        args: ['--disable-backgrounding-occluded-windows'],
      }
      : { args: [project, '--disable-backgrounding-occluded-windows'] }),
    env,
  });
  const page = await app.firstWindow(), errors: string[] = [];
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
  );
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return { app, page, root: path.join(data, '示例知识库'), errors };
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

test('Large image and drawing clicks always focus the link; preview spacers occupy inline positions and adjacent text remains independent', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(
      path.join(root, '大图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#eeee99"/></svg>',
    );
    await page.evaluate(() => window.moyu!.feature('drawing.create', { path: '绘图.excalidraw' }));
    await open(
      page,
      '边界.md',
      '前文\n\n![大图](大图.svg)\n\n123\n\n![绘图|300](绘图.excalidraw)\n\n## 一点小技巧\n\n末尾',
    );
    await expect(page.locator('.attachment-space')).toHaveCount(2);
    expect(
      await page.locator('.attachment-space').evaluateAll(spaces =>
        spaces.every(space => !!space.closest('p') && !!space.closest('.inline-syntax'))
      ),
    ).toBe(true);
    for (const source of await page.locator('.visual-attachment').all()) {
      await expect(source.locator('.syntax-raw')).toBeHidden();
      expect(await source.evaluate(el => el.closest('p')!.getBoundingClientRect().height))
        .toBeGreaterThan(0);
    }
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const index of [0, 1]) {
        const preview = page.locator('.attachment-overlay').nth(index),
          source = page.locator('.visual-attachment').nth(index);
        await preview.locator('img,svg').click();
        await expect(source.locator('.syntax-raw')).toBeVisible();
        await expect(preview).toBeHidden();
        await expect(source.locator('.attachment-space')).toBeHidden();
        expect(await source.evaluate(el => el.contains(getSelection()?.focusNode || null))).toBe(
          true,
        );
        const geometry = await page.evaluate(() => {
          const sel = getSelection()!,
            raw = sel.focusNode?.parentElement?.closest('.syntax-raw'),
            p = raw?.closest('p');
          const caret = sel.getRangeAt(0).getBoundingClientRect();

          return {
            paragraph: p?.getBoundingClientRect().height || 0,
            caret: caret.height,
            caretTop: caret.top,
          };
        });
        expect(geometry.paragraph).toBeGreaterThanOrEqual(geometry.caret);
        expect(geometry.paragraph).toBeGreaterThan(0);
        expect(geometry.caret).toBeLessThan(40);
        expect(Math.abs(geometry.lineTop - geometry.caretTop)).toBeLessThan(15);
        const below = index === 0
          ? page.locator('.ProseMirror p').filter({ hasText: /^123$/ })
          : page.locator('.ProseMirror h2');
        await below.click({ position: { x: 12, y: 10 } });
        await expect(source.locator('.syntax-raw')).toBeHidden();
        expect(await source.evaluate(el => el.closest('p')!.getBoundingClientRect().height))
          .toBeGreaterThan(0);
        expect(await below.evaluate(el => el.contains(getSelection()?.focusNode || null))).toBe(
          true,
        );
      }
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(project, 'preview-v161-boundaries.png') });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Enter after an image creates a real paragraph; clicking its empty line or text never activates the image link', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(
      path.join(root, '图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><rect width="400" height="220"/></svg>',
    );
    await open(page, '新行.md', '![图](图.svg)');
    await expect(page.locator('.visual-attachment .syntax-raw')).toBeHidden();
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    expect(
      await page.locator('.visual-attachment').evaluate(el =>
        el.closest('p')!.getBoundingClientRect().height
      ),
    ).toBeGreaterThan(0);
    await page.locator('.attachment-overlay img').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const below = page.locator('.ProseMirror p').last(),
      raw = page.locator('.visual-attachment .syntax-raw');
    await expect(page.locator('.ProseMirror p')).toHaveCount(2);
    await expect(raw).toBeHidden();
    const imageBox = (await page.locator('.attachment-overlay img').boundingBox())!;
    expect((await below.boundingBox())!.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
    await below.click({ position: { x: 5, y: 10 } });
    await expect(raw).toBeHidden();
    await page.keyboard.insertText('123');
    await expect(below).toHaveText('123');
    await page.locator('.attachment-overlay img').click();
    await below.click({ position: { x: 10, y: 10 } });
    await expect(raw).toBeHidden();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '新行.md'), 'utf8')).toContain(
      '![图](图.svg)\n\n123',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Every first visible frame after document and mode changes has the restored viewport, including loaded media and long code', async () => {
  test.setTimeout(100000);
  const { app, page, root, errors } = await fixture(true);
  try {
    await fs.writeFile(
      path.join(root, '图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240"/></svg>',
    );
    await open(page, '其他.md', '别的页面');
    await open(
      page,
      '位置.md',
      Array.from({ length: 20 }, (_, i) => `第${i}段\n\n![图|160](图.svg)`).join('\n\n')
        + '\n\n定位行XYZ\n\n```python {height=160}\n' + Array.from({ length: 60 }, (_, i) =>
          'v' + i + ' = ' + i).join('\n')
        + '\n```\n\n末尾',
    );
    await page.locator('.ProseMirror p').filter({ hasText: /^定位行XYZ$/ }).click({
      position: { x: 30, y: 10 },
    });
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const driver = document.createElement('div');
      driver.id = 'moyu-test-paint-driver';
      driver.setAttribute('aria-hidden', 'true');
      driver.style.cssText =
        'position:fixed;bottom:0;right:0;width:1px;height:1px;pointer-events:none;z-index:99999';
      document.body.append(driver);
    });
    const sample = async (mode: 'rich' | 'source' | 'read', action: () => Promise<void>) => {
      await page.evaluate(({ mode }) => {
        const data: { top: number; height: number; anchorTop: number | null }[] = [];
        (window as any).moyuFrames = { data, stop: false };
        const state = (window as any).moyuFrames;
        const frame = () => {
          if (state.stop) return;
          if (
            document.querySelector('.tab.active .tab-name')?.getAttribute('title') === '位置.md'
          ) {
            const editor = document.querySelector<HTMLElement>(
              mode === 'rich'
                ? '.editor-host'
                : mode === 'source'
                ? '.source-editor'
                : '.reading-view',
            );
            if (
              editor && !editor.hasAttribute('data-editor-pending')
              && getComputedStyle(editor).visibility === 'visible'
            ) {
              const scope = mode === 'source'
                ? editor.querySelector('.cm-scroller')
                : editor.closest('.document-scroll');
              if (scope) {
                const anchor = [...editor.querySelectorAll(mode === 'source' ? '.cm-line' : 'p')]
                  .find(line => line.textContent === '定位行XYZ');
                data.push({
                  top: scope.scrollTop,
                  height: scope.scrollHeight,
                  anchorTop: anchor?.getBoundingClientRect().top ?? null,
                });
              }
            }
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, { mode });
      await action();
      await expect(
        page.locator(
          mode === 'read' ? '.reading-view' : mode === 'source' ? '.source-editor' : '.editor-host',
        ),
      ).toBeAttached();
      // Invalidate a fixed pixel to drive hidden-window paints without blocking
      // on Chromium's screenshot/compositor handshake.
      for (let i = 0; i < 15; i++) {
        await page.evaluate(async i => {
          document.getElementById('moyu-test-paint-driver')!.style.backgroundColor = i % 2
            ? '#111'
            : '#222';
          await new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        }, i);
      }
      await expect.poll(() => page.evaluate(() => (window as any).moyuFrames.data.length))
        .toBeGreaterThan(12);
      const frames = await page.evaluate(() => {
        const state = (window as any).moyuFrames;
        state.stop = true;
        return state.data;
      });
      expect(frames[0].top).toBeCloseTo(frames.at(-1).top, 0);
      for (const frame of frames) {
        expect(frame.anchorTop).not.toBeNull();
        expect(frame.top).toBeCloseTo(frames[0].top, 0);
        expect(frame.anchorTop).toBeCloseTo(frames[0].anchorTop, 0);
      }
      // CodeMirror estimates offscreen wrapped line heights. Its total height
      // can converge after paint without moving the viewport or restored text.
      if (mode !== 'source') expect(frames[0].height).toBeCloseTo(frames.at(-1).height, 0);
    };
    await page.locator('.tab-name[title="其他.md"]').click();
    await sample('rich', async () => {
      await page.locator('.tab-name[title="位置.md"]').click();
    });
    await sample('source', async () => {
      await page.getByRole('button', { name: '源码', exact: true }).click();
    });
    await sample('rich', async () => {
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    });
    await sample('read', async () => {
      await page.getByRole('button', { name: '阅读', exact: true }).click();
    });
    await sample('rich', async () => {
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
