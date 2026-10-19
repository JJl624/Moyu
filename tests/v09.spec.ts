import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture(name: string, policy = 'manual') {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, name + '-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': policy } }),
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
  return { app, page, data, root: path.join(data, '示例知识库'), errors };
}
async function open(page: Page, name: string, content: string) {
  await page.evaluate(async ({ name, content }) => {
    const r = await window.moyu!.create(name + '.md', 'file', content);
    if (!r) throw new Error('create failed');
  }, { name, content });
  await page.locator('.tree-item[title="' + name + '.md"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', name + '.md');
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
test('Manual close supports cancel, discard and save; close-time saving does not write while typing', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture('v09-save');
  try {
    await open(page, '手动保存', '原文\n');
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('未保存');
    await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();
    await page.waitForTimeout(1200);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).toBe('原文\n');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await page.locator('.tab.active .tab-close').click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '手动保存.md');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.locator('.tab.active .tab-close').click();
    await expect(page.locator('.tab-name[title="手动保存.md"]')).toHaveCount(0);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).toBe('原文\n');
    await page.locator('.tree-item[title="手动保存.md"]').click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '手动保存.md');
    await expect(page.locator('.ProseMirror p')).toHaveCount(1);
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('保存');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.locator('.tab.active .tab-close').click();
    await expect(page.locator('.tab-name[title="手动保存.md"]')).toHaveCount(0);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).toContain('原文保存');
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('保存方式').selectOption('close');
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await page.locator('.tree-item[title="手动保存.md"]').click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '手动保存.md');
    await expect(page.locator('.ProseMirror p')).toHaveCount(1);
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('关闭时');
    await page.waitForTimeout(1200);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).not.toContain('关闭时');
    await page.locator('.tab.active .tab-close').click();
    await expect(page.locator('.tab-name[title="手动保存.md"]')).toHaveCount(0);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).toContain('关闭时');
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('保存方式').selectOption('manual');
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await page.locator('.tree-item[title="手动保存.md"]').click();
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', '手动保存.md');
    await expect(page.locator('.ProseMirror p')).toHaveCount(1);
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('退出时保存');
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('moyu://app'))!
        .close();
    });
    await page.waitForTimeout(500);
    expect(page.isClosed()).toBe(false);
    expect(await fs.readFile(path.join(root, '手动保存.md'), 'utf8')).not.toContain('退出时保存');
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('moyu://app'))!
        .close();
    });
    await expect.poll(() => fs.readFile(path.join(root, '手动保存.md'), 'utf8')).toContain(
      '退出时保存',
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Unicode image links load, open inside the app and rename across a dirty note and a closed note', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture('v09-image');
  try {
    const png = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#658bc8"/></svg>',
    );
    await fs.mkdir(path.join(root, 'attachments'), { recursive: true });
    await fs.writeFile(path.join(root, 'attachments/中文 图片.svg'), png);
    const md =
      '![中文图片](attachments/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.svg)\n\n[本地图片](attachments/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.svg)\n\n正文\n';
    await page.evaluate(async () => {
      await window.moyu!.create('引用.md', 'file', '![图片](attachments/中文%20图片.svg)');
    });
    await open(page, '图片测试', md);
    await expect.poll(() =>
      page.locator('.attachment-overlay img').first().evaluate((el: HTMLImageElement) =>
        el.naturalWidth
      )
    ).toBe(320);
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('未保存');
    await editAttachment(page, page.locator('.visual-attachment').first());
    await page.locator('.visual-attachment .syntax-raw').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重命名附件', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('新名字.svg');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await expect.poll(() => fs.readFile(path.join(root, '引用.md'), 'utf8')).toContain(
      '新名字.svg',
    );
    expect(await fs.readFile(path.join(root, '图片测试.md'), 'utf8')).not.toContain('未保存');
    await expect(page.locator('.ProseMirror')).toContainText('未保存');
    await expect(page.locator('.attachment-overlay img').first()).toHaveAttribute(
      'src',
      /新|%E6%96%B0/,
    );
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await page.locator('.reading-view a').filter({ hasText: '本地图片' }).click();
    await expect(page.getByLabel('图片查看器')).toBeVisible();
    await expect(page.locator('.tree-row.selected')).toHaveCount(1);
    await page.getByLabel('放大图片').click();
    await page.getByRole('button', { name: '适应窗口' }).click();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Python and JS data folders mount input, persist actual files, follow companion folders; output remains temporary', async () => {
  test.setTimeout(180000);
  const { app, page, root, errors } = await fixture('v09-code');
  try {
    const md =
      '```python\nprint(7)\n```\n\n```py\nfrom pathlib import Path\nprint(Path("输入.csv").read_text())\nPath("输出.txt").write_text("Python 文件")\n```\n\n```typescript\nconst value: string = await files.readFile("输入.txt");\nconsole.log(value);\nawait files.writeFile("输出.txt", "TS 文件");\n```\n';
    await open(page, '代码数据', md);
    await page.getByRole('button', { name: '运行代码块', exact: true }).nth(0).click();
    await expect(page.locator('.code-output')).toContainText('7', { timeout: 90000 });
    expect(await fs.stat(path.join(root, 'attachments')).catch(() => null)).toBe(null);
    await page.evaluate(async () => {
      const a = window.moyu!;
      const upload = async (language: string, id: string, name: string, value: string) => {
        const r = await a.feature('code.data-upload', {
          document: '代码数据.md',
          language,
          id,
          name,
          bytes: new TextEncoder().encode(value),
        }) as { ok: boolean; error?: { message: string } };
        if (!r.ok) throw new Error(r.error?.message);
      };
      await upload('python', '0002', '输入.csv', '中文数据');
      await upload('typescript', '0003', '输入.txt', 'TS 输入');
    });
    await page.getByRole('button', { name: '运行代码块', exact: true }).nth(1).click();
    await expect(page.locator('.code-output').nth(1)).toContainText('中文数据', { timeout: 90000 });
    await expect.poll(() =>
      fs.readFile(path.join(root, '代码数据.assets/code-data/0002/输出.txt'), 'utf8')
    ).toBe('Python 文件');
    await page.getByRole('button', { name: '运行代码块', exact: true }).nth(2).click();
    await expect(page.locator('.code-output').nth(2)).toContainText('TS 输入');
    expect(
      await fs.readFile(
        path.join(root, '代码数据.assets/code-data/0003/输出.txt'),
        'utf8',
      ),
    ).toBe('TS 文件');
    await page.getByRole('button', { name: '显示文档信息', exact: true }).click();
    await page.getByRole('tab', { name: '数据', exact: true }).click();
    await expect(page.getByLabel('代码块数据')).toContainText('0002');
    await expect(page.getByLabel('代码块数据')).toContainText('输出.txt');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.code-result')).toHaveCount(0);
    expect(await fs.readFile(path.join(root, '代码数据.md'), 'utf8')).not.toContain('results');
    expect(await fs.stat(path.join(root, '.data/recovery')).catch(() => null)).toBe(null);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Edge text selection stays a range and hides active-line overlays; clicks do not steal the caret to a blank paragraph', async () => {
  test.setTimeout(120000);
  const { app, page, errors } = await fixture('v09-selection');
  try {
    await open(
      page,
      '光标测试',
      '第一段文字用于检查光标位置，点击这一行不应该跳到其他段落。\n\n第二段文字用于检查拖选范围，沿着边缘拖动也不应该突然全选整个文档。\n\n```js\nconsole.log(1)\nconsole.log(2)\n```',
    );
    const p = page.locator('.ProseMirror p').first();
    await p.click({ position: { x: 18, y: 15 } });
    await page.keyboard.insertText('插入');
    await expect(p).toContainText('插入');
    const second = page.locator('.ProseMirror p').nth(1), box = (await second.boundingBox())!;
    await page.mouse.move(box.x + 25, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + 12, { steps: 15 });
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected?.length).toBeGreaterThan(2);
    expect(selected).not.toContain('第一段');
    await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
    await page.locator('.milkdown-code-block .cm-content').click();
    await page.keyboard.press('Control+a');
    await expect(page.locator('.milkdown-code-block .cm-editor')).not.toHaveClass(/has-code-selection/);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
