import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture(name: string, scientific = false) {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, name + '-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  if (scientific) {
    const cached = process.env.MOYU_TEST_PYTHON_CACHE;
    if (!cached) {
      throw new Error('Provide a verified local Python cache for the scientific regression.');
    }
    await fs.cp(cached, path.join(data, 'Python'), { recursive: true });
  }
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
    await window.moyu!.create(name + '.md', 'file', content);
  }, { name, content });
  await page.locator('.tree-item[title="' + name + '.md"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', name + '.md');
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function formatBlock(page: Page, index: number) {
  await page.locator('.milkdown-code-block .cm-content').nth(index).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click();
}
test('Code formatting uses style preferences, supports undo and source fences, and never executes Python source', async () => {
  test.setTimeout(180000);
  const { app, page, root, errors } = await fixture('v09-format');
  try {
    await open(
      page,
      '格式化',
      '```ts {height=160}\nconst obj={a:"value",b:[1,2]};console.log(obj)\n```\n\n```python\nif True:\n  print( 1+2 )\nraise RuntimeError("must-not-run")\n```\n',
    );
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'通用');
    const json = page.getByLabel('dprint 配置 JSON'), config = JSON.parse(await json.inputValue());
    config.typescript.quoteStyle = 'alwaysSingle';
    config.typescript.semiColons = 'asi';
    config.indentWidth = 4;
    config.typescript['objectExpression.trailingCommas'] = 'never';
    await json.fill(JSON.stringify(config));
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.locator('.code-formatting [role=status]')).toContainText('已应用');
    const sizes = await page.locator('.preferences select').evaluateAll(elements =>
      elements.map(el => {
        const s = getComputedStyle(el), select = el as HTMLSelectElement;
        const c = document.createElement('canvas').getContext('2d')!;
        c.font = s.font;
        return {
          height: el.clientHeight,
          line: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4,
          available: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
          text: c.measureText(select.selectedOptions[0]?.text || '').width,
        };
      })
    );
    for (const s of sizes) {
      expect(s.height).toBeGreaterThan(s.line + 8);
      expect(s.available).toBeGreaterThanOrEqual(s.text);
    }
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await formatBlock(page, 0);
    await expect(page.locator('.milkdown-code-block .cm-content').first()).toContainText(
      "a: 'value'",
    );
    await expect(page.locator('.milkdown-code-block .cm-content').first()).not.toContainText(';');
    await page.locator('.milkdown-code-block .cm-content').first().click();
    await page.keyboard.press('Control+z');
    await expect(page.locator('.milkdown-code-block .cm-content').first()).toContainText(
      'const obj={',
    );
    await formatBlock(page, 0);
    await formatBlock(page, 1);
    await expect(page.locator('.milkdown-code-block .cm-content').nth(1)).toContainText(
      'print(1 + 2)',
      { timeout: 90000 },
    );
    await expect(page.locator('.milkdown-code-block .cm-content').nth(1)).toContainText(
      'raise RuntimeError',
    );
    await expect(page.locator('.code-output')).toHaveCount(0);
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '格式化.md'), 'utf8')).toContain(
      'height=160',
    );
    expect(await fs.stat(path.join(root, 'attachments')).catch(() => null)).toBeNull();
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-content').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('- 列表\n\n  ```ts {height=160}\n  const foo={x:"a"};\n  ```\n');
    await page.locator('.source-editor .cm-line').filter({ hasText: 'const foo=' }).click({
      button: 'right',
    });
    await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click();
    await expect(page.locator('.source-editor')).toContainText("x: 'a'");
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '格式化.md'), 'utf8')).toMatch(
      /\n  const foo = \{ x: 'a' \}\n  ```/,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Formula boundaries can be crossed; empty paragraphs produce no synthetic br; nested quote code has contrast', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture('v09-math');
  try {
    await open(
      page,
      '公式边界',
      '前文 $x+y$ 后文\n\n> 引用内容\n>\n> ```js\n> console.log(1)\n> ```\n',
    );
    await page.locator('.inline-math .math-render').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('外侧右');
    await expect(page.locator('.inline-math .math-raw')).toBeHidden();
    await page.locator('.inline-math .math-render').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText('外侧左');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '公式边界.md'), 'utf8')).toContain(
      '外侧左$x+y$外侧右',
    );
    const quote = await page.locator('.ProseMirror blockquote').evaluate(el =>
        getComputedStyle(el).backgroundColor
      ),
      code = await page.locator('.ProseMirror blockquote .milkdown-code-block').evaluate(el =>
        getComputedStyle(el).backgroundColor
      );
    expect(code).not.toBe(quote);
    await page.locator('.ProseMirror > p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '公式边界.md'), 'utf8')).not.toContain(
      '<br',
    );
    await open(page, '显式换行', '正文<br />明确换行\n');
    await page.locator('.ProseMirror p').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('保留');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(path.join(root, '显式换行.md'), 'utf8')).toMatch(
      /<br\s*\/?\s*>/,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Installed scientific packages filter correctly and plt.show produces SVG without the Agg warning, entirely offline', async () => {
  test.skip(
    !process.env.MOYU_TEST_PYTHON_CACHE,
    'Requires an already verified local cache, no automatic network installation.',
  );
  test.setTimeout(180000);
  const { app, page, root, errors } = await fixture('v09-show', true);
  try {
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'Python');
    await page.getByLabel('筛选 Python 包状态').selectOption('installed');
    await expect(page.getByLabel('Python 包列表')).toContainText('matplotlib');
    expect(
      await page.getByLabel('Python 包列表').getByRole('button', { name: '安装', exact: true })
        .count(),
    ).toBe(0);
    await page.getByLabel('筛选 Python 包状态').selectOption('available');
    expect(
      await page.getByLabel('Python 包列表').getByRole('button', { name: '卸载', exact: true })
        .count(),
    ).toBe(0);
    await selectPreference(page,'数据与运行环境');
    const entry = page.locator('.data-location').filter({ hasText: 'Python 包安装目录' });
    await expect(entry).toContainText('314.0.7');
    await expect(entry.getByRole('button', { name: '删除数据', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭对话框' }).click();
    const md =
      '```python\nimport pandas as pd\nimport matplotlib.pyplot as plt\nimport warnings\nwarnings.warn("keep-user-warning", UserWarning)\ndisplay(pd.DataFrame({"a":[1,2]}))\nplt.plot([1,2],[2,1])\nplt.show()\nprint("show-ok")\n```\n';
    await open(page, '绘图结果', md);
    await app.evaluate(({ session }) => {
      session.fromPartition('moyu-run-python').webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/.test(details.url) })
      );
    });
    await page.getByLabel('运行代码块').click();
    await expect(page.locator('.code-output')).toContainText('show-ok', { timeout: 90000 });
    await expect(page.locator('.code-output')).toContainText('keep-user-warning');
    await expect(page.locator('.code-output')).not.toContainText('FigureCanvasAgg');
    await expect(page.locator('.run-artifact img')).toHaveCount(1);
    await expect(page.locator('.run-artifact img')).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml;base64,/,
    );
    await expect(page.locator('.run-artifact table')).toContainText('a');
    expect(await fs.readFile(path.join(root, '绘图结果.md'), 'utf8')).toBe(md);
    expect(await fs.stat(path.join(root, 'attachments')).catch(() => null)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Drawings switch to raw links before text line highlighting, and deleting an open folder closes every affected tab', async () => {
  test.setTimeout(150000);
  const { app, page, root, errors } = await fixture('v09-consistency');
  try {
    const scene = {
      type: 'excalidraw',
      version: 2,
      source: 'Moyu',
      elements: [{
        id: 'rect',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        angle: 0,
        strokeColor: '#222222',
        backgroundColor: '#77aadd',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 17,
        version: 1,
        versionNonce: 12,
        index: 'a0',
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    await fs.mkdir(path.join(root, 'attachments'));
    await fs.writeFile(path.join(root, 'attachments/图.excalidraw'), JSON.stringify(scene));
    await open(page, '绘图高亮', '上方文字\n\n![图](attachments/图.excalidraw)\n\n下方文字\n');
    await expect(page.locator('.resource-preview svg')).toBeVisible();
    for (const theme of ['dark', 'light']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByLabel('切换主题').click();
      }
      await page.locator('.ProseMirror p').first().click();
      await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
      await page.locator('.resource-preview').click();
      await expect(page.locator('.attachment-raw')).toBeVisible();
      await expect(page.locator('.resource-preview')).toBeHidden();
      await expect(page.locator('.moyu-caret-line')).toHaveCount(0);
      await expect(page.locator('.attachment-link')).not.toHaveClass(/selected/);
      await page.locator('.ProseMirror p').last().click();
      await expect(page.locator('.resource-preview')).toBeVisible();
    }
    scene.elements[0].backgroundColor = '#dd5577';
    await fs.writeFile(path.join(root, 'attachments/图.excalidraw'), JSON.stringify(scene));
    await expect.poll(() => page.locator('.resource-preview svg').evaluate(el => el.innerHTML))
      .toContain('#dd5577');
    const capture = async (name: string) => {
      const image = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('app'))!
          .webContents.capturePage()).toPNG().toString('base64')
      );
      await fs.writeFile(path.join(project, name), Buffer.from(image, 'base64'));
    };
    await page.getByLabel('偏好设置').click();
    await selectPreference(page,'通用');
    await capture('preview-v12-settings.png');
    await page.getByLabel('关闭对话框').click();
    await page.locator('.ProseMirror p').last().click();
    await capture('preview-v12-editor.png');
    await page.evaluate(async () => {
      await window.moyu!.create('待删', 'folder');
      await window.moyu!.create('待删/甲.md', 'file', '甲');
      await window.moyu!.create('待删/乙.md', 'file', '乙');
    });
    await page.locator('.tree-item[title="待删"]').click();
    for (const name of ['甲', '乙']) {
      await page.locator('.tree-item[title="待删/' + name + '.md"]').click();
      await expect(page.locator('.tab.active .tab-name')).toHaveAttribute(
        'title',
        '待删/' + name + '.md',
      );
    }
    await page.locator('.tree-item[title="待删"]').click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '移至回收站', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: '移至回收站', exact: true }).click();
    await expect(page.locator('.tab-name[title^="待删/"]')).toHaveCount(0);
    expect(await fs.stat(path.join(root, '待删')).catch(() => null)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Explicit Python and TS downloads use each code block data root, while arbitrary fetch stays isolated', async () => {
  test.setTimeout(150000);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('download-data');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/input.txt';
  const { app, page, root, errors } = await fixture('v09-download');
  try {
    await open(
      page,
      '下载数据',
      '```python\nawait download("' + url
        + '", "中文数据.txt")\nprint(open("中文数据.txt").read())\n```\n\n```ts\nawait files.download("'
        + url
        + '", "输入.txt");\nconsole.log(await files.readFile("输入.txt"));\ntry { await fetch("'
        + url + '"); } catch { console.log("isolated"); }\n```\n',
    );
    await page.getByLabel('运行代码块').first().click();
    await expect(page.locator('.code-output').first()).toContainText('download-data', {
      timeout: 90000,
    });
    expect(
      await fs.readFile(
        path.join(root, 'attachments/code-data/下载数据.md/Python_01/中文数据.txt'),
        'utf8',
      ),
    ).toBe('download-data');
    await page.getByLabel('运行代码块').nth(1).click();
    await expect(page.locator('.code-output').nth(1)).toContainText('isolated');
    expect(
      await fs.readFile(
        path.join(root, 'attachments/code-data/下载数据.md/TypeScript_01/输入.txt'),
        'utf8',
      ),
    ).toBe('download-data');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
