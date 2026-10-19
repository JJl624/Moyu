import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment, previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v11-attachments-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
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
async function open(page: Page, content: string) {
  await page.evaluate(
    async content => window.moyu!.create('附件编辑.md', 'file', content),
    content,
  );
  await page.locator('.tree-item[title="附件编辑.md"]').dblclick();
  await expect(page.locator('.attachment-link')).toHaveCount(3);
}
test('Images, drawings and file links reveal source at either caret boundary; editing, deletion, undo and context actions work uniformly', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文图片.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#658bc8"/></svg>',
    );
    await fs.writeFile(path.join(root, 'attachments/输入.csv'), 'a,b\n1,2');
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/图.excalidraw' })
    );
    const md =
      '前文\n\n![中文图片](attachments/中文图片.svg)\n\n![图](attachments/图.excalidraw)\n\n[数据](attachments/输入.csv)\n\n尾文\n';
    await open(page, md);
    await expect(page.locator('.attachment-image img')).toBeVisible();
    await expect(page.locator('.resource-preview svg')).toBeVisible();
    for (
      const [index, raw] of [
        '![中文图片](attachments/中文图片.svg)',
        '![图](attachments/图.excalidraw)',
        '[数据](attachments/输入.csv)',
      ].entries()
    ) {
      const link = page.locator('.attachment-link').nth(index);
      await editAttachment(page, link);
      await expect(link.locator('.attachment-raw')).toBeVisible();
      await expect(link.locator('.attachment-raw')).toHaveText(raw);
      await expect(await previewFor(page, link)).toBeHidden();
      await expect(link).not.toHaveClass(/selected/);
      await link.locator('.attachment-raw').click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '复制链接', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '重命名附件', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '编辑资源链接', exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole('menuitem', { name: '删除资源链接', exact: true })).toHaveCount(
        0,
      );
      if (index === 1) {
        await expect(page.getByRole('menuitem', { name: '编辑绘图', exact: true })).toBeVisible();
      }
      if (index === 0) {
        await expect(page.getByRole('menuitem', { name: '查看图片', exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await page.locator('.ProseMirror p').last().click();
      await expect(await previewFor(page, link)).toBeVisible();
      await expect(link.locator('.attachment-raw')).toBeHidden();
    }
    const image = page.locator('.attachment-link').first();
    await editAttachment(page, image);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(image.locator('.attachment-raw')).toBeVisible();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText('左侧');
    await expect(image.locator('.attachment-raw')).toBeHidden();
    await page.locator('.ProseMirror p').last().click();
    await expect(await previewFor(page, image)).toBeVisible();
    await editAttachment(page, image);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(image.locator('.attachment-raw')).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('右侧');
    await expect(await previewFor(page, image)).toBeVisible();
    const file = page.locator('.attachment-link').last();
    await file.locator('.attachment-preview').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      '[数据](attachments/输入.csv)',
    );
    await page.keyboard.press('Backspace');
    await expect(page.locator('.attachment-link')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.attachment-link')).toHaveCount(3);
    await page.locator('.ProseMirror p').last().click();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '附件编辑.md'), 'utf8')).toContain(
      '左侧![中文图片](attachments/中文图片.svg)右侧',
    );
    expect(await fs.readdir(path.join(root, 'attachments'))).toHaveLength(3);
    const output = path.join(root, '附件导出.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('<svg');
    const html = await fs.readFile(output, 'utf8');
    expect(html).toContain('href="attachments/输入.csv"');
    expect(html).toContain('data:image/svg+xml');
    expect(html).not.toContain('attachment-raw');
    expect(html).not.toContain('attachmentRaw');
    expect(await fs.readdir(path.join(root, 'attachments'))).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Raw attachment text and URL caret survive mode changes, incomplete edits and reopening; source has attachment context actions', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文图片.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>',
    );
    await fs.writeFile(path.join(root, 'attachments/输入.csv'), 'a');
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/图.excalidraw' })
    );
    await open(
      page,
      '![图片](attachments/中文图片.svg)\n\n![图](attachments/图.excalidraw)\n\n[数据](attachments/输入.csv)\n\n尾文',
    );
    const link = page.locator('.inline-syntax').nth(1);
    await editAttachment(page, link);
    await page.keyboard.press('Home');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => {
        const s = getSelection()!, line = s.anchorNode?.parentElement?.closest('.cm-line');
        if (!line) return -1;
        const range = document.createRange();
        range.setStart(line, 0);
        range.setEnd(s.anchorNode!, s.anchorOffset);
        return range.toString().length;
      })
    ).toBe(8);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view .resource-preview svg')).toBeVisible();
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(link.locator('.syntax-raw')).toBeVisible();
    await page.keyboard.insertText('改');
    await expect(link.locator('.syntax-raw')).toContainText('改');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.locator('.ProseMirror p').last().click();
    await expect(link.locator('.syntax-raw')).toBeVisible();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '附件编辑.md'), 'utf8')).toContain(
      '![图](attachments/改图.excalidraw',
    );
    const saved = await fs.readFile(path.join(root, '附件编辑.md'), 'utf8');
    expect(saved).not.toContain('attachmentRaw');
    expect(saved).not.toContain('\\[');
    await page.locator('.tab.active .tab-close').click();
    await page.locator('.tree-item[title="附件编辑.md"]').click();
    await expect(page.locator('.ProseMirror')).toContainText('![图](attachments/改图.excalidraw');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-line').filter({ hasText: '[数据]' }).click({
      button: 'right',
    });
    await expect(page.getByRole('menuitem', { name: '重命名附件', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '复制链接', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
