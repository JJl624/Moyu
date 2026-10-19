import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'data-comments-'));
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
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();
  await page.evaluate(() => {
    const pixel = document.createElement('div');
    pixel.style.cssText =
      'position:fixed;bottom:0;right:0;width:1px;height:1px;pointer-events:none';
    document.body.append(pixel);
    let odd = false;
    setInterval(() => pixel.style.backgroundColor = (odd = !odd) ? '#111' : '#222', 16);
  });
  return { app, page, data, root: path.join(data, '示例知识库'), errors };
}
async function open(page: any, name: string) {
  await expect(page.locator(`.tree-item[title="${name}"]`)).toBeVisible();
  await page.locator(`.tree-item[title="${name}"]`).dblclick();
  await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
}

test('HTML comments are editable, preserve multiline/list source and stay absent in reading mode', async () => {
  const { app, page, root, errors } = await fixture();
  const markdown =
    '<!-- 独立注释\n第二行 -->\n\n前文<!-- 行内注释 -->后文\n\n- 列表\n\n  <!-- 列表注释\n  内容 -->\n\n```html {id=0001}\n<!-- 代码示例 -->\n```\n\n最后一段\n';
  try {
    await fs.writeFile(path.join(root, '注释.md'), markdown);
    await open(page, '注释.md');
    await expect(page.locator('.comment-block')).toHaveCount(2);
    await expect(page.locator('span[data-type="html"]')).toHaveCount(0);
    await expect(page.locator('.inline-syntax[data-syntax="html"]')).toContainText('行内注释');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText('<!-- 列表注释');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    const block = page.locator('.comment-block').first();
    await block.click({ position: { x: 30, y: 8 } });
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('修改');
    await expect(block).toContainText('修改');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('新增');
    await expect(block).toContainText('新增');
    await page.locator('.save-status').click();
    await expect.poll(() => fs.readFile(path.join(root, '注释.md'), 'utf8')).toContain('新增');
    const saved = await fs.readFile(path.join(root, '注释.md'), 'utf8');
    expect(saved).toContain('<!-- 修改\n新增独立注释\n第二行 -->');
    expect(saved).toContain('<!-- 列表注释\n  内容 -->');
    expect(saved).not.toContain('&lt;');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view')).toContainText('前文后文');
    await expect(page.locator('.reading-view')).not.toContainText('独立注释');
    await expect(page.locator('.reading-view')).not.toContainText('行内注释');
    await expect(page.locator('.reading-view')).toContainText('代码示例');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.locator('.comment-block').first()).toContainText('修改');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Comment delimiter input/deletion and a pending inline comment keep character editing and source', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(path.join(root, '输入.md'), '文字\n');
    await open(page, '输入.md');
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.type('<!-- draft -->');
    await expect(page.locator('.inline-syntax')).toContainText('<!-- draft -->');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('-');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '输入.md'), 'utf8')).toContain(
      '文字<!-- draft -->',
    );
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.locator('.inline-syntax')).toContainText('<!-- draft');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).not.toContainText('\\<!--');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('App temporary/crash paths live under its data root, and cursor/scroll/idle do not write application documents', async () => {
  const { app, page, data, root, errors } = await fixture();
  try {
    const paths = await app.evaluate(({ app }) => ({
      temp: app.getPath('temp'),
      cache: app.getPath('userData'),
      session: app.getPath('sessionData'),
      crash: app.getPath('crashDumps'),
      logs: app.getPath('logs'),
      env: process.env.TEMP,
    }));
    for (const value of Object.values(paths)) {
      expect(path.relative(data, value!)).not.toMatch(/^\.\./);
    }
    expect(paths.temp).toBe(paths.env);
    const entries = await page.evaluate(() => window.moyu!.feature('data.list'));
    expect(entries.ok).toBe(true);
    expect(entries.data.find((e: any) => e.id === 'cache').path).toBe(paths.cache);
    expect(paths.temp).toBe(path.join(paths.cache, 'temp'));
    await fs.writeFile(
      path.join(root, '静态.md'),
      '# 标题\n\n文字段落\n\n```py {id=0001}\nprint(1)\n```\n',
    );
    await open(page, '静态.md');
    await page.waitForTimeout(1300);
    const names = [
      path.join(data, 'settings.json'),
      path.join(root, '.data/document_map.json'),
      path.join(root, '静态.md'),
    ];
    const before = await Promise.all(
      names.map(async file => ({
        file,
        mtime: (await fs.stat(file)).mtimeMs,
        content: await fs.readFile(file, 'utf8'),
      })),
    );
    await page.locator('.ProseMirror p').click();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
    }
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(3500);
    for (const item of before) {
      expect((await fs.stat(item.file)).mtimeMs).toBe(item.mtime);
      expect(await fs.readFile(item.file, 'utf8')).toBe(item.content);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
