import {editPreviewReference} from './attachment-helper';
import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v1610-'));
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

test('Image tab close and text file visits preserve the Markdown mode', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '模式.md', '正文\n\n![图片|160](图片.svg)\n\n末尾');
    await fs.writeFile(path.join(root, '文本.txt'), '普通文本');
    for (const label of ['预览编辑', '源码', '阅读']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.tree-item[title="图片.svg"]').dblclick();
      await expect(page.locator('.image-viewer img')).toBeVisible();
      await page.locator('.tab.active .tab-close').click();
      await expect(page.locator('.mode-switch button.selected')).toHaveText(label);
      await page.locator('.tree-item[title="文本.txt"]').dblclick();
      await expect(page.locator('.text-file-editor')).toBeVisible();
      await page.locator('.tab-name[title="模式.md"]').click();
      await expect(page.locator('.mode-switch button.selected')).toHaveText(label);
      await page.locator('.tab-name[title="文本.txt"]').click();
      await page.locator('.tab.active .tab-close').click();
      await expect(page.locator('.mode-switch button.selected')).toHaveText(label);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Editor context menu retains the caret and image right click keeps the preview', async () => {
  const { app, page, errors } = await fixture();
  try {
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/测试.excalidraw' })
    );
    await open(
      page,
      '右键.md',
      '前文\n\n![图片|160](图片.svg)\n\n[绘图|100](attachments/测试.excalidraw)\n\n末尾',
    );
    const paragraph = page.locator('.ProseMirror p').last(),
      line = page.locator('.moyu-caret-line');
    await paragraph.click();
    await page.keyboard.press('Home');
    await expect(line).toHaveCount(0);
    await paragraph.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(line).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ProseMirror')).toBeFocused();
    await expect(line).toHaveCount(0);
    for (const [index, label] of [[0, '查看图片'], [1, '编辑绘图']] as const) {
      await expect.poll(() => page.evaluate(() => getSelection()?.focusOffset)).toBe(0);
      const caret = await page.evaluate(() => ({
        text: getSelection()?.focusNode?.textContent,
        offset: getSelection()?.focusOffset,
      }));
      const preview = page.locator('.attachment-overlay').nth(index);
      await preview.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
      await expect(preview).toBeVisible();
      await expect(preview).toHaveClass(/context-target/);
      await expect(page.locator('.visual-attachment .syntax-raw').nth(index)).toBeHidden();
      await expect(line).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          text: getSelection()?.focusNode?.textContent,
          offset: getSelection()?.focusOffset,
        })),
      ).toEqual(caret);
      await page.keyboard.press('Escape');
      await expect(preview).not.toHaveClass(/context-target/);
      await expect(page.locator('.ProseMirror')).toBeFocused();
      await preview.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
      await preview.click({ position: { x: 4, y: 4 } });
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(preview).not.toHaveClass(/context-target/);
      await expect(page.locator('.visual-attachment .syntax-raw').nth(index)).toBeHidden();
      await editPreviewReference(page,preview);
      await expect(page.locator('.visual-attachment .syntax-raw').nth(index)).toBeVisible();
      await expect(page.locator('.ProseMirror')).toBeFocused();
      await paragraph.click();
      await page.keyboard.press('Home');
      await expect(preview).toBeVisible();
    }
    await editPreviewReference(page,page.locator('.attachment-overlay').first());
    await expect(page.locator('.visual-attachment .syntax-raw').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Backspace and Delete join image paragraphs without deleting links, including list content', async () => {
  const { app, page, root, errors } = await fixture();
  const first = '![第一张|160](图片.svg)';
  const save = () =>
    app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
  try {
    await fs.copyFile(
      path.join(project, 'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'),
      path.join(root, '绘图.excalidraw'),
    );
    for (const mixed of [false, true]) {
      const second = mixed ? '[绘图|160](绘图.excalidraw)' : '![第二张|160](图片.svg)';
      for (const list of [false, true]) {
        for (const key of ['Backspace', 'Delete']) {
          const name = (list ? '列表' : '段落') + (mixed ? '混排' : '') + key + '.md';
          await open(
            page,
            name,
            list
              ? '- 图片\n\n  ' + first + '\n\n  ' + second + '\n\n末尾'
              : first + '\n\n' + second + '\n\n末尾',
          );
          await page.locator('.ProseMirror p').last().click();
          await expect(page.locator('.attachment-overlay :is(img,svg)')).toHaveCount(2);
          await editPreviewReference(page,page.locator('.attachment-overlay').nth(key === 'Backspace' ? 1 : 0));
          await page.keyboard.press(key === 'Backspace' ? 'Home' : 'End');
          await page.keyboard.press(key);
          await expect(page.locator('.attachment-link.editing .syntax-raw').first()).toBeVisible();
          await expect(page.locator('.attachment-link')).toHaveCount(2);
          expect(
            await page.locator('.attachment-link').evaluateAll(nodes =>
              nodes[0].parentElement === nodes[1].parentElement
            ),
          ).toBe(true);
          await save();
          await expect.poll(() => fs.readFile(path.join(root, name), 'utf8')).toContain(
            first + second,
          );
          await page.locator('.ProseMirror p').last().click();
          // Joined references share a paragraph, so both become name links.
          await expect(page.locator('.attachment-overlay :is(img,svg)')).toHaveCount(0);
          await expect(page.locator('.attachment-link a')).toHaveText(['第一张',mixed?'绘图':'第二张']);
          await page.keyboard.press('Control+z');
          await expect(page.locator('.visual-attachment')).toHaveCount(2);
          expect(
            await page.locator('.visual-attachment').evaluateAll(nodes =>
              nodes[0].parentElement !== nodes[1].parentElement
            ),
          ).toBe(true);
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Preferences keep functional controls with compact text and explicit font inheritance', async () => {
  const { app, page, errors } = await fixture();
  try {
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '偏好设置', exact: true });
    await expect(dialog.getByLabel('当前字体继承关系')).toContainText('继承 代码字体');
    await expect(dialog).not.toContainText('包含系统本地化名称');
    for (const label of ['编辑', '数据与运行环境', 'Python']) {
      await dialog.getByRole('button', { name: label, exact: true }).click();
      await expect(dialog).not.toContainText('·');
      await expect(dialog).not.toContainText('临时界面内容');
      if (label === '编辑') {
        await expect(dialog.getByLabel('保存方式', { exact: true })).toBeVisible();
        await expect(dialog.getByLabel('dprint 配置 JSON', { exact: true })).toBeVisible();
        await expect(dialog).not.toContainText('点击最后一个元素');
      }
      if (label === 'Python') {
        await expect(dialog.getByLabel('Python 代码执行时限', { exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: '刷新可用版本', exact: true }))
          .toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
