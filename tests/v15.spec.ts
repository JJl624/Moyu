import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment, previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v15-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({
      version: 1,
      values: { 'moyu-save-policy': 'manual', 'moyu-formatbar': 'true' },
    }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
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
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return { app, page, root: path.join(data, '示例知识库'), data, errors };
}
async function create(page: Page, name: string, content = '正文\n') {
  await page.evaluate(async ({ name, content }) => window.moyu!.create(name, 'file', content), {
    name,
    content,
  });
}
async function open(page: Page, name: string, content: string) {
  await create(page, name, content);
  await page.locator('.tree-item[title="' + name + '"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', name);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function save(app: Awaited<ReturnType<typeof fixture>>['app']) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
      x.label === '保存'
    )!.click()
  );
}
async function screenshot(app: Awaited<ReturnType<typeof fixture>>['app'], name: string) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w =>
      w.webContents.getURL().startsWith('moyu://app')
    )!;
    win.focus();
    await win.webContents.executeJavaScript(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    return (await win.webContents.capturePage()).toPNG().toString('base64');
  });
  await fs.writeFile(path.join(project, name), Buffer.from(image, 'base64'));
}
async function suffixSelection(page: Page, raw: ReturnType<Page['locator']>, suffix: string) {
  await raw.evaluate((raw, suffix) => {
    (raw.closest('.ProseMirror') as HTMLElement).focus();
    const start = raw.textContent!.indexOf('|') + 1, range = document.createRange();
    const point = (offset: number) => {
      const walker = document.createTreeWalker(raw, NodeFilter.SHOW_TEXT);
      let total = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode, length = node.textContent!.length;
        if (total + length >= offset) return { node, offset: offset - total };
        total += length;
      }
      throw Error('Missing source text');
    };
    const from = point(start), to = point(start + suffix.length);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, suffix);
}

test('Size edits use raw links only, keep cached media, and restore current dimensions on leaving', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文图片.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#658bc8"/></svg>',
    );
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/绘图.excalidraw' })
    );
    await open(
      page,
      '尺寸即时更新.md',
      '上方\n\n![图片|160](attachments/中文图片.svg)\n\n![绘图|160](attachments/绘图.excalidraw)\n\n结束\n',
    );
    for (let i = 0; i < 2; i++) {
      const region = page.locator('.visual-attachment').nth(i),
        raw = region.locator('.syntax-raw'),
        preview = await previewFor(page, region),
        media = preview.locator(i === 0 ? 'img' : 'svg');
      await expect(media).toHaveCSS('width', '160px');
      await editAttachment(page, region);
      await expect(raw).toBeVisible();
      await expect(media).toBeHidden();
      await media.evaluate((el, i) => {
        (window as any)['media' + i] = el;
      }, i);
      await suffixSelection(page, raw, '160');
      await page.keyboard.type('240');
      await expect(media).toHaveCSS('width', '240px');
      expect(await media.evaluate((el, i) => el === (window as any)['media' + i], i)).toBe(true);
      await suffixSelection(page, raw, '240');
      await page.keyboard.type('50%');
      await expect(media).toHaveCSS('width', '200px');
      expect(await media.evaluate((el, i) => el === (window as any)['media' + i], i)).toBe(true);
      await suffixSelection(page, raw, '50%');
      await page.keyboard.press('Backspace');
      await expect(media).toHaveCSS('width', '400px');
      await page.keyboard.type('80');
      await expect(media).toHaveCSS('width', '80px');
      await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          getSelection()?.focusNode?.parentElement?.closest('.syntax-raw') !== null
        ),
      ).toBe(true);
    }
    await screenshot(app, 'preview-v15-attachments.png');
    await page.locator('.ProseMirror p').last().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '尺寸即时更新.md'), 'utf8')).toContain(
      '图片|80',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Code attribute inputs update fence metadata, height and Mermaid size; invalid drafts never alter the document', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(
      page,
      '属性.md',
      '```text example {height=160 .wide title="{quoted}"}\n第一行\n第二行\n```\n\n```mermaid {size=160}\nflowchart LR\n A --> B\n```\n\n结束\n',
    );
    const first = page.locator('.milkdown-code-block').first(),
      field = first.getByLabel('代码块自定义属性');
    await expect(field).toHaveValue('{height=160 .wide title="{quoted}"}');
    expect(
      await field.evaluate(el =>
        el.closest('.code-attributes')?.previousElementSibling?.classList.contains(
          'language-button',
        )
      ),
    ).toBe(true);
    await field.fill('{height=240 .wide title="{quoted}"}');
    await expect(first.locator('.cm-editor')).toHaveCSS('height', '240px');
    await field.fill('{height=');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(first.locator('.cm-editor')).toHaveCSS('height', '240px');
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('{height=240 .wide title="{quoted}"}');
    await first.locator('.code-resize').dblclick();
    await expect(field).toHaveValue('{.wide title="{quoted}"}');
    await expect(first.locator('.cm-editor')).not.toHaveCSS('height', '240px');
    const diagram = page.locator('.milkdown-code-block').nth(1);
    await expect(diagram.locator('.mermaid-diagram svg')).toHaveCSS('width', '160px');
    expect((await diagram.locator('svg .node').allTextContents()).map(text => text.trim())).toEqual(
      expect.arrayContaining(['A', 'B']),
    );
    await diagram.getByLabel('代码块自定义属性').fill('{size=320}');
    await expect(diagram.locator('.mermaid-diagram svg')).toHaveCSS('width', '320px');
    await page.keyboard.press('Enter');
    await page.getByLabel('显示文档信息', { exact: true }).click();
    await expect(page.getByLabel('关闭文档信息', { exact: true })).toHaveCount(0);
    await expect(page.locator('.right-tabs>[role=tab]')).toHaveCount(3);
    await screenshot(app, 'preview-v15-code-attributes.png');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '属性.md'), 'utf8')).toContain(
      'text example {.wide title="{quoted}"}',
    );
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor')).toContainText('mermaid {size=320}');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.getByLabel('代码块自定义属性').nth(1)).toHaveValue('{size=320}');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('File single clicks use one italic temporary tab; double click, edit or save keeps it; images and drawings behave alike', async () => {
  test.setTimeout(150000);
  const { app, page, root, data, errors } = await fixture();
  try {
    for (const name of ['甲.md', '乙.md', '丙.md', '丁.md', '戊.md', '快速一.md', '快速二.md']) {
      await create(page, name);
    }
    const row = (name: string) => page.locator('.tree-item[title="' + name + '"]');
    await row('甲.md').click();
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '甲.md');
    await expect(page.locator('.tab.preview .tab-name>span').first()).toHaveCSS(
      'font-style',
      'italic',
    );
    await row('乙.md').click();
    await expect(page.locator('.tab-name[title="甲.md"]')).toHaveCount(0);
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '乙.md');
    await row('丙.md').dblclick();
    await expect(page.locator('.tab.active')).not.toHaveClass(/preview/);
    await row('丁.md').click();
    await expect(page.locator('.tab-name[title="丙.md"]')).toBeVisible();
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '丁.md');
    await page.locator('.tab-name[title="丁.md"]').dblclick();
    await expect(page.locator('.tab.active')).not.toHaveClass(/preview/);
    await row('戊.md').click();
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('编辑');
    await expect(page.locator('.tab.active')).not.toHaveClass(/preview/);
    await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();
    await page.evaluate(() => {
      (document.querySelector('.tree-item[title="快速一.md"]') as HTMLElement).click();
      (document.querySelector('.tree-item[title="快速二.md"]') as HTMLElement).click();
    });
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '快速二.md');
    await expect(page.locator('.tab-name[title="快速一.md"]')).toHaveCount(0);
    await save(app);
    await expect(page.locator('.tab.active')).not.toHaveClass(/preview/);
    await page.evaluate(() => window.moyu!.feature('drawing.create', { path: '绘图.excalidraw' }));
    await fs.writeFile(
      path.join(root, '图片.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="blue"/></svg>',
    );
    await expect(row('图片.svg')).toBeVisible();
    await row('绘图.excalidraw').click();
    await expect(page.locator('.drawing-editor')).toBeVisible();
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute(
      'title',
      '绘图.excalidraw',
    );
    await row('图片.svg').click();
    await expect(page.locator('.tab-name[title="绘图.excalidraw"]')).toHaveCount(0);
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '图片.svg');
    await row('图片.svg').dblclick();
    await expect(page.locator('.tab.active')).not.toHaveClass(/preview/);
    await row('乙.md').click();
    await expect(page.locator('.tab.preview .tab-name')).toHaveAttribute('title', '乙.md');
    await expect.poll(async () =>
      JSON.parse(
        JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'))
          .values['moyu-session-' + root],
      ).tabs
    ).not.toContain('乙.md');
    await screenshot(app, 'preview-v15-tabs.png');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Each mode restores its previous viewport instantly across file and mode changes', async () => {
  test.setTimeout(150000);
  const { app, page, errors } = await fixture();
  try {
    await open(
      page,
      '位置.md',
      Array.from({ length: 120 }, (_, i) => '第 ' + i + ' 段正文，记录当前位置。').join('\n\n'),
    );
    await open(page, '其他.md', '另一篇文档\n');
    await page.locator('.tab-name[title="位置.md"]').click();
    const positions: Record<string, number> = {};
    for (const mode of ['预览编辑', '源码', '阅读']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(
        page.locator(
          mode === '阅读'
            ? '.reading-view p'
            : mode === '源码'
            ? '.source-editor .cm-line'
            : '.ProseMirror p',
        ).last(),
      ).toBeAttached();
      if (mode === '源码') await expect(page.locator('.source-editor .cm-content')).toBeFocused();
      await page.evaluate(() =>
        new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      );
      positions[mode] = await page.evaluate(mode => {
        const scroll = document.querySelector(
          mode === '源码' ? '.source-editor .cm-scroller' : '.document-scroll',
        )!;
        scroll.scrollTop = mode === '源码' ? 700 : mode === '阅读' ? 1700 : 1200;
        return scroll.scrollTop;
      }, mode);
      await page.evaluate(() =>
        new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      );
      await page.locator('.tab-name[title="其他.md"]').click();
      await page.locator('.tab-name[title="位置.md"]').click();
      if (mode === '源码') await expect(page.locator('.source-editor .cm-content')).toBeFocused();
      await expect.poll(() =>
        page.evaluate(
          mode =>
            document.querySelector(
              mode === '源码' ? '.source-editor .cm-scroller' : '.document-scroll',
            )!.scrollTop,
          mode,
        )
      ).toBeCloseTo(positions[mode], 0);
    }
    for (const mode of ['预览编辑', '源码', '阅读']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect.poll(() =>
        page.evaluate(
          mode =>
            document.querySelector(
              mode === '源码' ? '.source-editor .cm-scroller' : '.document-scroll',
            )!.scrollTop,
          mode,
        )
      ).toBeCloseTo(positions[mode], 0);
      expect(
        await page.locator('.document-scroll').evaluate(el => getComputedStyle(el).scrollBehavior),
      ).toBe('auto');
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
