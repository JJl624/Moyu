import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment, previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v11-inline-'));
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

test('Both adjacent caret boundaries reveal full Markdown for math, nested styles, code, links and attachments', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"/>',
    );
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/图.excalidraw' })
    );
    const syntax = [
      '$\\frac{3}{4}$',
      '**加粗 *斜体* `代码` 内容**',
      '*斜体*',
      '~~删除~~',
      '`行内代码`',
      '[网址](https://example.com)',
      '![图片](attachments/中文.svg)',
      '[数据](attachments/输入.csv)',
      '![图|320](attachments/图.excalidraw)',
    ];
    await open(
      page,
      '边界.md',
      syntax.map(raw => '左文' + raw + '右文').join('\n\n') + '\n\n结束\n',
    );
    await expect(page.locator('.inline-syntax')).toHaveCount(syntax.length);
    for (let i = 0; i < syntax.length; i++) {
      const region = page.locator('.inline-syntax').nth(i);
      if (await region.evaluate(e => e.classList.contains('visual-attachment'))) {
        await editAttachment(page, region);
      } else await region.locator('.syntax-preview').click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      if (await region.evaluate(e => e.classList.contains('visual-attachment'))) {
        await expect(region.locator('.syntax-raw')).toBeHidden();
      } else await expect(region.locator('.syntax-raw')).toBeVisible();
      await expect(region.locator('.syntax-raw')).toHaveText(syntax[i]);
      await page.keyboard.press('ArrowLeft');
      await expect(await previewFor(page, region)).toBeVisible();
      if (await region.evaluate(e => e.classList.contains('visual-attachment'))) {
        await editAttachment(page, region);
      } else await region.locator('.syntax-preview').click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowRight');
      await expect(region.locator('.syntax-raw')).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(await previewFor(page, region)).toBeVisible();
    }
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('保存');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '边界.md'), 'utf8')).toContain('结束保存');
    const md = await fs.readFile(path.join(root, '边界.md'), 'utf8');
    for (const raw of syntax) expect(md).toContain(raw);
    expect(md).not.toContain('inlineRaw');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Standard drawing links use sizing in both render modes; renaming retains parameters and HTML embeds vectors', async () => {
  test.setTimeout(150000);
  const { app, page, root, errors } = await fixture();
  try {
    await page.evaluate(async () => {
      await window.moyu!.feature('drawing.create', { path: 'attachments/中文 图.excalidraw' });
      await window.moyu!.create('笔记', 'folder');
    });
    await page.locator('.tree-item[title="笔记"]').click();
    await open(
      page,
      '笔记/嵌入.md',
      '前文\n\n![绘图|320](<../attachments/中文 图.excalidraw>)\n\n[普通网址](https://example.com)\n\n尾文\n',
    );
    const region = page.locator('.inline-syntax[data-syntax="image"]');
    await expect((await previewFor(page, region)).locator('svg')).toBeVisible();
    await expect((await previewFor(page, region)).locator('svg')).toHaveCSS('width', '320px');
    if (await region.evaluate(e => e.classList.contains('visual-attachment'))) {
      await editAttachment(page, region);
    } else await region.locator('.syntax-preview').click();
    await expect(region.locator('.syntax-raw')).toHaveText(
      '![绘图|320](<../attachments/中文 图.excalidraw>)',
    );
    await region.locator('.syntax-raw').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重命名附件', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('改名 图.excalidraw');
    await page.getByRole('dialog').getByRole('button', { name: '保存名称', exact: true }).click();
    await expect.poll(() => fs.readFile(path.join(root, '笔记/嵌入.md'), 'utf8')).toContain(
      '![绘图|320](<../attachments/改名 图.excalidraw>)',
    );
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view .resource-preview svg')).toBeVisible();
    await expect(page.locator('.reading-view .resource-preview svg')).toHaveCSS('width', '320px');
    await page.locator('.reading-view .resource-preview').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '编辑绘图', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const output = path.join(root, '嵌入导出.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('<svg');
    expect(await fs.readdir(path.join(root, 'attachments'))).toEqual(['改名 图.excalidraw']);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Inline source edits and formatting shortcuts retain markers and caret through preview, source, reading and undo', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '标记.md', '前 **加粗** 中 $x+y$ 后\n\n待格式化\n');
    const bold = page.locator('.inline-syntax[data-syntax="strong"]');
    await bold.locator('.syntax-preview').click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('改');
    await expect(bold.locator('.syntax-raw')).toHaveText('**加改粗**');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText('**加改粗**');
    await expect.poll(() =>
      page.evaluate(() => {
        const s = getSelection()!, line = s.anchorNode?.parentElement?.closest('.cm-line');
        if (!line) return -1;
        const r = document.createRange();
        r.setStart(line, 0);
        r.setEnd(s.anchorNode!, s.anchorOffset);
        return r.toString().length;
      })
    ).toBe(6);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view strong')).toHaveText('加改粗');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(bold.locator('.syntax-raw')).toBeVisible();
    await page.keyboard.insertText('续');
    await expect(bold.locator('.syntax-raw')).toHaveText('**加改续粗**');
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('待格式化');
    await page.keyboard.press('Control+b');
    const formatted = page.locator('.inline-syntax').last();
    await expect(formatted.locator('.syntax-raw')).toHaveText('**待格式化**');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.ProseMirror p').last()).toHaveText('待格式化');
    await page.keyboard.press('Control+y');
    await expect(formatted.locator('.syntax-raw')).toHaveText('**待格式化**');
    await page.locator('.ProseMirror p').first().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '标记.md'), 'utf8')).toContain(
      '**待格式化**',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('File links navigate with Ctrl-click; back and forward preserve the original caret and abandon forward branches', async () => {
  test.setTimeout(120000);
  const { app, page, errors } = await fixture();
  try {
    await page.evaluate(async () => {
      await window.moyu!.create('乙.md', 'file', '乙正文\n');
      await window.moyu!.create('丙.md', 'file', '丙正文\n');
    });
    await open(page, '甲.md', '前 $x+y$ 后\n\n[乙](乙.md)\n\n[丙](丙.md)\n');
    const math = page.locator('.inline-syntax[data-syntax="inlineMath"]');
    await math.locator('.syntax-preview').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.locator('.syntax-preview a[href="乙.md"]').click({ modifiers: ['Control'] });
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '乙.md');
    await expect(page.getByRole('button', { name: '后退', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '甲.md');
    await expect(math.locator('.syntax-raw')).toBeVisible();
    await page.keyboard.insertText('回');
    await expect(math.locator('.syntax-raw')).toHaveText('$x回+y$');
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '乙.md');
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await page.locator('.syntax-preview a[href="丙.md"]').click({ modifiers: ['Control'] });
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '丙.md');
    await expect(page.getByRole('button', { name: '前进', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-line').filter({ hasText: '[乙]' }).click({
      modifiers: ['Control'],
    });
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '乙.md');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
