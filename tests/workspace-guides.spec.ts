import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
test('New workspaces include three deletable guides with working diagrams, math and local attachments; existing/empty workspaces stay intact', async () => {
  test.setTimeout(240000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'workspace-guides-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_TEST_OFFSCREEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOYU_DEMO;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    );
    await expect(page.getByRole('region', { name: '知识库导航' })).toBeVisible();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, data);
    await page.getByLabel('知识库名称', { exact: true }).fill('示例工作空间');
    await expect(page.getByRole('checkbox', { name: '加入示例文档' })).toBeChecked();
    await page.getByRole('button', { name: '选择位置并创建', exact: true }).click();
    await expect(page.locator('.ProseMirror h1')).toContainText('markdown完全语法示例');
    const root = path.join(data, '示例工作空间'),
      files = [
        'mermaid绘图大全.md',
        '公式和代码示例.md',
        'markdown完全语法示例.md',
      ];
    expect((await fs.readdir(root)).filter(n => n.endsWith('.md')).sort()).toEqual(
      [...files].sort(),
    );
    for (const file of files) {
      expect(await fs.readFile(path.join(root, file), 'utf8')).toBe(
        await fs.readFile(path.join(project, 'resources/workspace-guide', file), 'utf8'),
      );
    }
    await page.locator('.tree-item[title="公式和代码示例.md"]').dblclick();
    const editingTabs = page.locator('.ProseMirror .tabbed-code');
    await expect(editingTabs.getByRole('tab')).toHaveCount(3);
    await editingTabs.getByRole('tab', { name: 'JavaScript 示例', exact: true }).click();
    await expect(editingTabs.locator('.cm-content')).toHaveText('console.log("Hello");');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view .katex')).toHaveCount(5);
    const readingTabs = page.locator('.reading-view .tabbed-code');
    await expect(readingTabs.getByRole('tab')).toHaveCount(3);
    await readingTabs.getByRole('tab', { name: 'C++ 示例', exact: true }).click();
    await expect(readingTabs.locator('[data-code-pane="2"] pre code')).toHaveText('std::cout << "Hello";');
    await page.locator('.reading-view h1').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.resolve(project, '../../work/guide-formula-v1720.png')});
    await page.locator('.tree-item[title="markdown完全语法示例.md"]').dblclick();
    await expect(page.locator('.reading-view .resource-preview svg')).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.locator('.reading-view img')).toHaveCount(2);
    await expect.poll(() =>
      page.locator('.reading-view img').evaluateAll(images =>
        images.every(image => (image as HTMLImageElement).naturalWidth > 0)
      )
    ).toBe(true);
    await expect(page.locator('.reading-view li pre code')).toContainText('列表中的代码');
    await expect(page.locator('.reading-view .mermaid-diagram > svg')).toHaveCount(1);
    await page.locator('.reading-view h1').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.resolve(project, '../../work/guide-markdown-v1720.png')});
    await page.locator('.tree-item[title="mermaid绘图大全.md"]').dblclick();
    await expect.poll(async () => {
      const failures = await page.locator('.diagram-error').allTextContents();
      if (failures.length) throw new Error(failures.join('\n'));
      return page.locator('.reading-view .mermaid-diagram > svg').count();
    }, { timeout: 90000 }).toBe(31);
    await expect(page.locator('.reading-view .mermaid-diagram > svg')).toHaveCount(31, {
      timeout: 90000,
    });
    await expect(page.locator('.diagram-error')).toHaveCount(0);
    await page.locator('.reading-view h1').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.resolve(project, '../../work/guide-mermaid-v1720.png')});
    const svgCount = 31;
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('.reading-view .mermaid-diagram > svg')).toHaveCount(svgCount);
    await page.locator('.tree-item[title="markdown完全语法示例.md"]').dblclick();
    // Removing a guide is an ordinary filesystem action. Reopening does not seed again.
    await fs.unlink(path.join(root, 'mermaid绘图大全.md'));
    await page.locator('.workspace-picker').click();
    const dialog = page.getByRole('dialog', { name: '知识库', exact: true });
    await dialog.getByLabel('知识库名称', { exact: true }).fill('空工作空间');
    await dialog.getByRole('checkbox', { name: '加入示例文档' }).uncheck();
    await dialog.getByRole('button', { name: '选择位置并创建', exact: true }).click();
    await expect(page.locator('.workspace-picker')).toContainText('空工作空间');
    expect((await fs.readdir(path.join(data, '空工作空间'))).filter(n => n.endsWith('.md')))
      .toEqual([]);
    await page.locator('.workspace-picker').click();
    await dialog.locator('.recent-vaults button').filter({ hasText: '示例工作空间' }).click();
    expect(await fs.stat(path.join(root, 'mermaid绘图大全.md')).catch(() => null)).toBeNull();
    expect(await fs.readFile(path.join(root, 'markdown完全语法示例.md'), 'utf8')).toContain(
      '# markdown完全语法示例',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
