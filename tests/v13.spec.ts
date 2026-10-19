import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment, previewFor } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v13-'));
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

test('Image and drawing dimensions accept pixel width or intrinsic percent scale in editing, reading and vector export', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文 图 (1).svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#658bc8"/></svg>',
    );
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/中文 绘图.excalidraw' })
    );
    const md =
      '开始\n\n![图片|160](<attachments/中文 图 (1).svg>)\n\n![图片|50%](<attachments/中文 图 (1).svg>)\n\n![图片|160px](<attachments/中文 图 (1).svg>)\n\n![绘图|160](<attachments/中文 绘图.excalidraw>)\n\n![绘图|50%](<attachments/中文 绘图.excalidraw>)\n\n结束\n';
    await open(page, '尺寸.md', md);
    for (const mode of ['预览编辑', '阅读']) {
      if (mode === '阅读') await page.getByRole('button', { name: mode, exact: true }).click();
      const scope = page.locator(mode === '阅读' ? '.reading-view' : '.editor-host'),
        images = scope.locator('img'),
        drawings = scope.locator('.resource-preview svg');
      await expect(images).toHaveCount(3);
      await expect(drawings).toHaveCount(2);
      await expect(images.nth(0)).toHaveCSS('width', '160px');
      await expect(images.nth(0)).toHaveCSS('height', '80px');
      await expect(images.nth(1)).toHaveCSS('width', '200px');
      await expect(images.nth(1)).toHaveCSS('height', '100px');
      await expect(images.nth(2)).toHaveCSS('width', '400px');
      await expect(drawings.nth(0)).toHaveCSS('width', '160px');
      const scaled = await drawings.nth(1).evaluate(svg => ({
        width: svg.getBoundingClientRect().width,
        intrinsic: Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2]),
      }));
      expect(scaled.width).toBeCloseTo(scaled.intrinsic / 2, 0);
    }
    await screenshot(app, 'preview-v13-attachments.png');
    const output = path.join(root, '尺寸.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('width: 160px');
    expect(await fs.readFile(output, 'utf8')).toContain('<svg');
    expect(await fs.readFile(path.join(root, '尺寸.md'), 'utf8')).toBe(md);
    expect(await fs.readdir(path.join(root, 'attachments'))).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Inline source preserves formatting, arrows traverse markers, and heading hashes remain editable across modes', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(
      page,
      '标记样式.md',
      '### 标题\n\n前 **加粗** 中 *斜体* 中 `代码` 中 $x+y$ 后\n\n结束\n',
    );
    const bold = page.locator('.inline-syntax[data-syntax="strong"]');
    const before = await bold.locator('.syntax-preview strong').evaluate(e => ({
      weight: getComputedStyle(e).fontWeight,
      color: getComputedStyle(e).color,
    }));
    await bold.locator('.syntax-preview').click();
    await expect(bold.locator('.moyu-source-strong')).toHaveCSS('font-weight', before.weight);
    await expect(bold.locator('.moyu-source-strong')).toHaveCSS('color', before.color);
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('改');
    await expect(bold.locator('.syntax-raw')).toHaveText('**加粗改**');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('**加粗改**');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() =>
      page.evaluate(() => {
        const s = getSelection()!,
          raw = (s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement)
            ?.closest('.syntax-raw');
        if (!raw) return -1;
        const range = document.createRange();
        range.setStart(raw, 0);
        range.setEnd(s.focusNode!, s.focusOffset);
        return range.toString().length;
      })
    ).toBe(0);
    await page.keyboard.press('ArrowRight');
    const code = page.locator('.inline-syntax[data-syntax="inlineCode"]');
    await code.locator('.syntax-preview').click();
    await expect(code.locator('.moyu-source-inlineCode')).toHaveCSS('font-family', /./);
    await page.keyboard.press('Home');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('改');
    await expect(code.locator('.syntax-raw')).toHaveText('`代改码`');
    const heading = page.locator('.ProseMirror h3');
    await heading.click();
    await expect(heading.locator('.moyu-heading-marker')).toBeVisible();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('#');
    await expect(page.locator('.ProseMirror h4')).toContainText('#### 标题');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText('#### 标题');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.locator('.reading-view h4')).toHaveText('标题');
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(page.locator('.ProseMirror h4 .moyu-heading-marker')).toBeVisible();
    await page.locator('.ProseMirror p').last().click();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '标记样式.md'), 'utf8')).toContain(
      '#### 标题',
    );
    const md = await fs.readFile(path.join(root, '标记样式.md'), 'utf8');
    expect(md).not.toContain('#### ####');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Encoded filenames and legacy drawing embeds become readable standard Markdown without altering code examples', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(
      path.join(root, 'attachments/中文 图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"/>',
    );
    await page.evaluate(() =>
      window.moyu!.feature('drawing.create', { path: 'attachments/中文 图.excalidraw' })
    );
    const raw =
      '开始\n\n**![图片](attachments/%E4%B8%AD%E6%96%87%20图.svg)**\n\n![[中文 图.excalidraw|160x80]]\n\n```md\n![[中文 图.excalidraw]]\n![示例](attachments/中文%20图.svg)\n```\n\n结束\n';
    await open(page, '链接.md', raw);
    await expect(page.locator('.resource-preview svg')).toBeVisible();
    const drawing = page.locator('.attachment-link[data-resource-path="attachments/中文 图.excalidraw"]');
    await editAttachment(page, drawing);
    await expect(drawing.locator('.syntax-raw')).toHaveText(
      '![中文 图.excalidraw|160](<attachments/中文 图.excalidraw>)',
    );
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await expect(drawing.locator('.syntax-raw')).toBeHidden();
    await page.locator('.ProseMirror p').last().click();
    await expect((await previewFor(page, drawing)).locator('svg')).toBeVisible();
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '链接.md'), 'utf8')).toContain(
      '**![图片](<attachments/中文 图.svg>)**',
    );
    const md = await fs.readFile(path.join(root, '链接.md'), 'utf8');
    expect(md).toContain('```md\n![[中文 图.excalidraw]]\n![示例](attachments/中文%20图.svg)\n```');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Run actions survive language controls, source/reading remounts and code edits without reserved gaps on unsupported code', async () => {
  test.setTimeout(120000);
  const { app, page, errors } = await fixture();
  try {
    await open(
      page,
      '运行按钮.md',
      '```javascript\nconsole.log(42)\n```\n\n```css\na { color: red; }\n```\n\n结束\n',
    );
    await expect(page.getByLabel('运行代码块')).toHaveCount(1);
    await page.getByLabel('运行代码块').click();
    await expect(page.locator('.code-output')).toContainText('42');
    const content = page.locator('.milkdown-code-block .cm-content').first();
    await content.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(';');
    await expect(page.getByLabel('运行代码块')).toHaveCount(1);
    await page.locator('.language-button').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('运行代码块')).toHaveCount(1);
    for (const mode of ['源码', '阅读', '预览编辑']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.getByLabel('运行代码块')).toHaveCount(mode === '预览编辑' ? 1 : 0);
    }
    await page.getByLabel('运行代码块').click();
    await expect(page.locator('.code-output')).toContainText('42');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
