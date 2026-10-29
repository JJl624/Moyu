import {editPreviewReference} from './attachment-helper';
import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v169-'));
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
test('Image context viewer stays responsive across repeated open and back operations', async () => {
  const { app, page, errors } = await fixture();
  try {
    await open(page, '图片文档.md', '前文\n\n![图片](图片.svg)\n\n![像素图](中文图片.png)\n\n末尾');
    for (let i = 0; i < 3; i++) {
      await editPreviewReference(page,page.locator('.attachment-overlay').nth(i % 2));
      await page.locator('.visual-attachment .syntax-raw').nth(i % 2).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '查看图片', exact: true }).click();
      await expect(page.locator('.image-viewer img')).toBeVisible();
      await expect(page.locator('.image-viewer header small')).toHaveText(
        i % 2 ? '320 × 240' : '600 × 400',
      );
      await page.getByRole('button', { name: '放大图片' }).click();
      await expect(page.locator('.image-viewer header')).toContainText('125%');
      await page.locator('.tab-name[title="图片文档.md"]').click();
      await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
      await page.locator('.ProseMirror p').last().click();
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Vertical keyboard navigation reveals the image source and leaves it as ordinary text', async () => {
  const { app, page, errors } = await fixture();
  try {
    await open(page, '方向键.md', '上方\n\n![图片|120](图片.svg)\n\n下方');
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.visual-attachment .syntax-raw')).toBeVisible();
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.visual-attachment .syntax-raw')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('X');
    await expect(page.locator('.inline-syntax .syntax-raw')).toHaveText('!X[图片|120](图片.svg)');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Many code blocks and Mermaid restore the exact code caret, inner scroll and viewport', async () => {
  test.setTimeout(150000);
  const { app, page, errors } = await fixture();
  try {
    await open(page, '其他.md', '另一篇文档');
    const content = Array.from({ length: 24 }, (_, i) =>
      `第 ${i} 节\n\n\`\`\`mermaid\nflowchart LR\nA${i}[开始 ${i}] --> B${i}[完成 ${i}]\n\`\`\`\n\n\`\`\`python {height=140}\n`
      + Array.from({ length: 50 }, (_, j) =>
        `v_${i}_${j} = ${j}`).join('\n')
      + '\n```').join('\n\n') + '\n\n尾部';
    await open(page, '很多代码.md', content);
    await expect(page.locator('.mermaid-diagram svg')).toHaveCount(24, { timeout: 30000 });
    const block = page.locator('.milkdown-code-block').nth(35);
    const cm = block.locator('.cm-content');
    await cm.click({ position: { x: 40, y: 12 } });
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const snapshot = async () =>
      page.evaluate(() => {
        const native = getSelection()!, node = native.focusNode;
        const line = node?.parentElement?.closest('.cm-line');
        const code = line?.closest('.milkdown-code-block');
        return {
          line: line?.textContent,
          offset: native.focusOffset,
          top: document.querySelector('.document-scroll')!.scrollTop,
          inner: code?.querySelector('.cm-scroller')?.scrollTop,
        };
      });
    const before = await snapshot();
    expect(before.line).toBe('v_17_22 = 22');
    for (let i = 0; i < 3; i++) {
      await page.locator('.tab-name[title="其他.md"]').click();
      const started = Date.now();
      await page.locator('.tab-name[title="很多代码.md"]').click();
      await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
      console.info('Code/Mermaid return milliseconds:', Date.now() - started);
      expect(Date.now() - started).toBeLessThan(3000);
      const after = await snapshot();
      expect(after.line).toBe(before.line);
      expect(after.offset).toBe(before.offset);
      expect(after.inner).toBeCloseTo(before.inner!, 0);
      expect(after.top).toBeCloseTo(before.top, 0);
    }
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor')).not.toHaveAttribute('data-editor-pending', 'true');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
    const after = await snapshot();
    expect(after.line).toBe(before.line);
    expect(after.offset).toBe(before.offset);
    expect(after.inner).toBeCloseTo(before.inner!, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    await page.keyboard.insertText('RESTORED');
    await expect(page.locator('.cm-line').filter({ hasText: 'v_RESTORED17_22 = 22' })).toHaveCount(
      1,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
