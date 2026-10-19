import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment, previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v14-'));
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
  return { app, page, root: path.join(data, '示例知识库'), errors };
}
async function open(page: Page, name: string, content: string) {
  await page.evaluate(async ({ name, content }) => window.moyu!.create(name, 'file', content), {
    name,
    content,
  });
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

test('ArrowLeft enters inline source from neighboring text; boundary spaces and deletion operate on individual characters', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    const syntax = ['**加粗**', '*斜体*', '`代码`', '$x+y$', '[链接](https://example.com)'];
    await open(page, '逐字.md', syntax.map(s => '左' + s + '右').join('\n\n') + '\n\n结束\n');
    for (let i = 0; i < syntax.length; i++) {
      const paragraph = page.locator('.ProseMirror p').nth(i),
        region = paragraph.locator('.inline-syntax');
      await paragraph.evaluate(p => {
        (p.closest('.ProseMirror') as HTMLElement).focus();
        const node = p.lastChild!, range = document.createRange();
        range.setStart(node, node.textContent!.length);
        range.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      });
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await expect(region.locator('.syntax-raw')).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() =>
          (() => {
            const n = getSelection()?.focusNode;
            return (n instanceof Element ? n : n?.parentElement)?.closest('.syntax-raw')
              ?.textContent;
          })()
        )
      ).toBe(syntax[i]);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.insertText('改');
      await expect(region.locator('.syntax-raw')).toHaveText(
        syntax[i].slice(0, -1) + '改' + syntax[i].slice(-1),
      );
      await page.keyboard.press('Control+z');
      await expect(region.locator('.syntax-raw')).toHaveText(syntax[i]);
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
      await page.keyboard.insertText('空格');
      await expect.poll(() => paragraph.evaluate(p => p.lastChild?.textContent)).toBe('  空格右');
      await region.locator('.syntax-preview').click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Backspace');
      await expect(region.locator('.syntax-raw')).toHaveText(syntax[i].slice(0, -1));
      await page.keyboard.press('Control+z');
      await expect(region.locator('.syntax-raw')).toHaveText(syntax[i]);
      await region.locator('.syntax-raw').click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Delete');
      await expect(region.locator('.syntax-raw')).toHaveText(syntax[i].slice(1));
      await page.keyboard.press('Control+z');
    }
    await page.locator('.ProseMirror p').last().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '逐字.md'), 'utf8')).toContain(
      '**加粗**  空格右',
    );
    const md = await fs.readFile(path.join(root, '逐字.md'), 'utf8');
    for (const s of syntax) expect(md).toContain(s + '  空格右');
    expect(md).not.toContain('\u00a0');
    await open(page, '标记换行.md', '前**加粗**\n\n- 项目**加粗**\n\n前**加粗**后\n');
    await page.locator('.ProseMirror > p').first().locator('.syntax-preview').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror > p').nth(1)).toHaveText('');
    await page.locator('.ProseMirror li .syntax-preview').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror li')).toHaveCount(2);
    await page.locator('.ProseMirror > p').last().locator('.syntax-preview').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('加粗**后', {
      useInnerText: true,
    });
    await page.locator('.ProseMirror p').last().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '标记换行.md'), 'utf8')).toContain(
      '前**\n\n加粗**后',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Image and drawing selections show raw links only; restored previews use edited dimensions', async () => {
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
      '链接编辑.md',
      '上方\n\n![图片|160](attachments/中文图片.svg)\n\n![绘图|160](attachments/绘图.excalidraw)\n\n结束\n',
    );
    for (let i = 0; i < 2; i++) {
      const region = page.locator('.visual-attachment').nth(i),
        preview = await previewFor(page, region),
        media = preview.locator(i === 0 ? 'img' : 'svg'),
        raw = region.locator('.syntax-raw');
      await expect(media).toBeVisible();
      await editAttachment(page, region);
      await expect(raw).toBeVisible();
      await expect(media).toBeHidden();
      expect(await region.locator('.attachment-space').evaluate(el => !!el.closest('p'))).toBe(
        true,
      );
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.keyboard.insertText(
        i === 0 ? '![图片|50%](attachments/中文图片.svg)' : '![绘图|240](attachments/绘图.excalidraw)',
      );
      await expect(media).toHaveCSS('width', i === 0 ? '200px' : '240px');
      await expect(media).toBeHidden();
      await expect(raw).toBeVisible();
      await raw.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '重命名附件', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('.ProseMirror p').last().click();
      await expect(raw).toBeHidden();
      await expect(media).toBeVisible();
    }
    await editAttachment(page, page.locator('.visual-attachment').first());
    await screenshot(app, 'preview-v14-links.png');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '链接编辑.md'), 'utf8')).toContain(
      '![图片|50%](attachments/中文图片.svg)',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Mermaid size attributes work in both modes and language picker; short reading code blocks fit their content', async () => {
  test.setTimeout(150000);
  const { app, page, errors } = await fixture();
  try {
    const code = 'flowchart LR\n A[开始] --> B[完成]';
    await open(
      page,
      '图表.md',
      '```mermaid {size=600}\n' + code + '\n```\n\n```mermaid {size=50%}\n' + code
        + '\n```\n\n```mermaid\n' + code + '\n```\n\n```text\n短代码\n```\n\n结束\n',
    );
    for (const mode of ['预览编辑', '阅读']) {
      if (mode === '阅读') await page.getByRole('button', { name: mode, exact: true }).click();
      const diagrams = page.locator(
        mode === '阅读'
          ? '.reading-view .mermaid-diagram svg'
          : '.ProseMirror .mermaid-diagram svg',
      );
      await expect(diagrams).toHaveCount(3, { timeout: 60000 });
      await expect(diagrams.first()).toHaveCSS('width', '600px');
      const values = await diagrams.evaluateAll(svgs =>
        svgs.map(svg => ({
          width: svg.getBoundingClientRect().width,
          intrinsic: Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2]),
        }))
      );
      expect(values[1].width).toBeCloseTo(values[1].intrinsic / 2, 0);
      expect(values[2].width).toBeCloseTo(values[2].intrinsic, 0);
    }
    const small = await page.locator('.reading-view pre').evaluate(pre => ({
      height: pre.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(pre).lineHeight),
      code: getComputedStyle(pre.querySelector('code')!).display,
    }));
    expect(small.height).toBeLessThan(small.line * 2 + 25);
    expect(small.code).toBe('block');
    await screenshot(app, 'preview-v14-mermaid.png');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await page.locator('.language-button').last().click();
    await page.getByPlaceholder('搜索语言').fill('mermaid');
    await expect(page.locator('.language-list-item')).toHaveCount(1);
    await page.locator('.language-list-item').click();
    await expect(page.locator('.mermaid-diagram')).toHaveCount(4);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Slash opens in the middle of paragraphs, lists and styled text; only three insert items and surrounding text survives', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '插入.md', '前文后文\n\n- 列表正文\n\n**加粗内容**\n\n结束\n');
    const paragraph = page.locator('.ProseMirror > p').first();
    await paragraph.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('/');
    await expect(page.getByRole('menu', { name: '插入', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    await expect(page.getByRole('menuitem', { name: /Excalidraw/ })).toBeEnabled();
    await page.getByRole('menuitem', { name: /代码块/ }).click();
    await expect(page.locator('.milkdown-code-block')).toHaveCount(1);
    await expect(page.locator('.ProseMirror > p').first()).toHaveText('前文');
    await expect(page.locator('.ProseMirror')).toContainText('后文');
    await page.locator('.insert-button').click();
    await expect(page.locator('.popover-menu button')).toHaveCount(3);
    await page.locator('.insert-button').click();
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('/');
    await expect(page.getByRole('menu', { name: '插入', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '表格', exact: true }).click();
    await expect(page.locator('.ProseMirror table.children')).toHaveCount(1);
    await expect(paragraph).toHaveText('前文');
    await page.locator('.ProseMirror li p').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('/');
    await expect(page.getByRole('menu', { name: '插入', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    const bold = page.locator('.inline-syntax[data-syntax="strong"]');
    await bold.locator('.syntax-preview').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('/');
    await expect(page.getByRole('menu', { name: '插入', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.locator('.ProseMirror p').last().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '插入.md'), 'utf8')).toContain('后文');
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('/');
    await expect(page.getByRole('menuitem', { name: 'Excalidraw 绘图', exact: true }))
      .toBeEnabled();
    await page.getByRole('menuitem', { name: 'Excalidraw 绘图', exact: true }).click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', /\.excalidraw$/);
    await page.locator('.tab-name[title="插入.md"]').click();
    await expect(page.locator('.resource-preview svg')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Python time limits persist locally, apply to cached interpreters and stop infinite code without breaking later runs', async () => {
  test.setTimeout(150000);
  const { app, page, errors } = await fixture();
  try {
    await open(page, '时限.md', '```python\nprint(42)\n```\n\n```python\nwhile True: pass\n```\n');
    await page.getByLabel('运行代码块').first().click();
    await expect(page.locator('.code-output').first()).toHaveText('42\n', { timeout: 60000 });
    const windowsBefore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('moyu-run:')).map(
        w => w.id,
      )
    );
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'Python');
    await page.getByLabel('Python 代码执行时限').fill('1');
    await page.getByLabel('Python 环境准备时限').fill('90');
    await page.keyboard.press('Tab');
    await expect.poll(async () =>
      ((await page.evaluate(() => window.moyu!.feature('python.state'))) as any).data
        .executionTimeoutSeconds
    ).toBe(1);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('moyu-run:'))
          .map(w => w.id)
      ),
    ).toEqual(windowsBefore);
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await page.getByLabel('运行代码块').last().click();
    await expect(page.locator('.code-output').last()).toContainText('超过 1 秒，代码已停止。', {
      timeout: 15000,
    });
    await page.getByLabel('运行代码块').first().click();
    await expect(page.locator('.code-output').first()).toHaveText('42\n', { timeout: 60000 });
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'Python');
    await expect(page.getByLabel('Python 代码执行时限')).toHaveValue('1');
    await expect(page.getByLabel('Python 环境准备时限')).toHaveValue('90');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Source dragging stays a text selection; repeated mode switches leave one menu and code resize controls survive virtual remount', async () => {
  test.setTimeout(150000);
  const { app, page, errors } = await fixture();
  try {
    await open(
      page,
      '状态检查.md',
      '开始\n\n前**加粗内容**后\n\n' + Array.from({ length: 12 }, (_, i) =>
        '```text {height=80}\n代码' + i + '\n```').join('\n\n')
        + '\n\n结束\n',
    );
    const raw = page.locator('.inline-syntax .syntax-raw');
    await page.locator('.syntax-preview').click();
    await expect(raw).toBeVisible();
    const box = await raw.boundingBox();
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 1, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        getSelection()?.toString()
      ),
    ).toBe('**加粗内容**');
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    for (const mode of ['源码', '阅读', '预览编辑', '源码', '阅读', '预览编辑']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
    }
    await expect(page.locator('.moyu-insert-menu')).toHaveCount(1);
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    const first = page.locator('.milkdown-code-block').first();
    await first.scrollIntoViewIfNeeded();
    await expect(first.locator('.code-resize')).toBeVisible();
    await page.locator('.ProseMirror p').last().scrollIntoViewIfNeeded();
    await expect(first.locator('.milkdown-code-block-placeholder')).toBeAttached({
      timeout: 15000,
    });
    await first.scrollIntoViewIfNeeded();
    await expect(first.locator('.code-resize')).toBeVisible();
    await expect(first.locator('.cm-editor')).toHaveCSS('height', '80px');
    await first.locator('.code-resize').dblclick();
    await expect(first.locator('.cm-editor')).not.toHaveCSS('height', '80px');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
